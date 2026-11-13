// 판정 캐시 키. 판정이 의존하는 입력만 남긴 정규화 튜플을 JSON.stringify한다.
import { STAT_IDS, moveStatRefs } from '../core'
import type { BattleConditions, MoveStatRefs, PokemonSet } from '../core'
import type { Snapshot, StatId } from '../data/schema'
import { variantNature, withNature } from './natures'
import { relevantStats } from './relevance'
import type { NatureVariants, RowTask, TabPlan } from './types'

const BOOST_STATS = ['atk', 'def', 'spa', 'spd', 'spe'] as const

/** 계산에 쓰는 특성(메가면 메가 폼 첫 특성). 해석할 수 없으면 세트 특성 그대로. */
export function calcAbility(game: Snapshot, set: PokemonSet): string {
  if (set.mega !== true) return set.ability
  const entry = game.data.megas.find((m) => m.base === set.species && m.stone === set.item)
  const forme = entry === undefined ? undefined : game.data.species[entry.forme]
  return forme?.abilities[0] ?? set.ability
}

function normalizeSet(set: PokemonSet, stats: readonly StatId[], exclude: readonly StatId[]): unknown[] {
  const sp = STAT_IDS.filter((s) => stats.includes(s) && !exclude.includes(s)).map((s) => [s, set.sp[s]])
  const boosts = BOOST_STATS.filter((s) => (set.boosts?.[s] ?? 0) !== 0).map((s) => [s, set.boosts?.[s]])
  return [set.species, set.ability, set.item ?? null, set.nature, set.mega === true, set.status ?? 'none', boosts, set.curHp ?? null, sp]
}

/** 객체 키를 정렬해 같은 조건이 같은 문자열이 되게 한다. */
function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical)
  if (typeof v === 'object' && v !== null) {
    const o = v as Record<string, unknown>
    return Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => [k, canonical(o[k])])
  }
  return v ?? null
}

interface KeyParts {
  /** 키의 작업 종류. variant는 같은 세트의 sweep과 같은 키 공간을 쓴다 */
  kind: string
  judge: 'damage' | 'speed'
  options: Record<string, boolean>
  side: 'attacker' | 'defender' | null
  stats: readonly StatId[]
  attacker: PokemonSet
  defender: PokemonSet
  moveId: string | null
  refs: MoveStatRefs | undefined
  conditions: BattleConditions
  /** 양 끝·극단은 변형 성격 칸까지 담아 변형 id가 키에 들어간다 */
  natures: NatureVariants | null
}

function partsOf(plan: TabPlan, task: RowTask): KeyParts {
  if (task.kind === 'probe') {
    // 현재 세트 그대로라 관여 SP를 모두 넣는다(side는 judgeDamage 관점, 덮어쓰는 능력치 없음).
    const filter = task.target === 'filter' ? plan.filters[task.id] : undefined
    const row = task.target === 'row' ? plan.rows[task.id] : undefined
    const spec = filter ?? row
    if (spec === undefined) throw new Error(`단건 판정 대상 ${task.id}가 계획에 없다`)
    const moveId = spec.moveId
    if (moveId === undefined) throw new Error(`단건 판정 대상 ${task.id}에 기술이 없다`)
    return {
      kind: 'probe',
      judge: 'damage',
      options: {},
      side: filter !== undefined ? 'defender' : (row?.sweep?.side ?? 'attacker'),
      stats: [],
      attacker: spec.attacker,
      defender: spec.defender,
      moveId,
      refs: row?.refs ?? moveStatRefs(plan.game, moveId),
      conditions: spec.conditions,
      natures: null,
    }
  }
  if (task.kind === 'ends' || task.kind === 'sweep' || task.kind === 'variant') {
    const spec = plan.rows[task.rowId]
    if (spec?.sweep === undefined) throw new Error(`행 ${task.rowId}에 스윕 대상이 없다`)
    let { attacker, defender } = spec
    if (task.kind === 'variant') {
      if (spec.natures === undefined) throw new Error(`행 ${task.rowId}에 성격 변형이 없다`)
      const nature = variantNature(spec.natures, task.nature)
      if (plan.mySide === 'attacker') attacker = withNature(attacker, nature)
      else defender = withNature(defender, nature)
    }
    return {
      kind: task.kind === 'ends' ? 'ends' : 'sweep',
      judge: spec.judge,
      options: task.kind === 'ends' ? { ignoreSpTotal: true } : { judgeOverBudget: true },
      side: spec.sweep.side,
      stats: [spec.sweep.stat],
      attacker,
      defender,
      moveId: spec.moveId ?? null,
      refs: spec.refs,
      conditions: spec.conditions,
      natures: task.kind === 'ends' ? (spec.natures ?? null) : null,
    }
  }
  if (task.kind === 'extreme' || task.kind === 'pair') {
    const spec = plan.filters[task.filterId]
    if (spec === undefined) throw new Error(`극단 필터 ${task.filterId}가 계획에 없다`)
    return {
      kind: task.kind,
      judge: 'damage',
      options: { ignoreSpTotal: true },
      side: 'defender',
      stats: spec.stats,
      attacker: spec.attacker,
      defender: task.kind === 'pair' ? withNature(spec.defender, variantNature(spec.natures, task.nature)) : spec.defender,
      moveId: spec.moveId,
      refs: moveStatRefs(plan.game, spec.moveId),
      conditions: spec.conditions,
      natures: task.kind === 'extreme' ? spec.natures : null,
    }
  }
  const spec = plan.fixed[task.fixedId]
  if (spec === undefined) throw new Error(`고정 판정 ${task.fixedId}가 계획에 없다`)
  return {
    kind: 'fixed',
    judge: 'damage',
    options: {},
    side: null,
    stats: [],
    attacker: spec.attacker,
    defender: spec.defender,
    moveId: spec.moveId,
    refs: moveStatRefs(plan.game, spec.moveId),
    conditions: spec.conditions,
    natures: null,
  }
}

/**
 * 세트 moves는 키에 넣지 않는다: 합법성 검증은 계획 단계(내 세트 validateSet, 상대 resolveAssumption)에서 끝났다는 전제다.
 * 스윕·양 끝·극단·쌍 판정은 덮어쓰는 능력치 SP를 빼고, 고정 판정은 관여 SP를 그대로 넣는다.
 * 대미지 칸 범주는 rollTier(p, rollSteps)라 rollSteps를 넣고, 스피드는 넣지 않는다.
 */
export function judgementKey(plan: TabPlan, task: RowTask): string {
  const p = partsOf(plan, task)
  const rel = relevantStats(p.judge, p.refs, calcAbility(plan.game, p.attacker))
  const exclude = (side: 'attacker' | 'defender') => (p.side === side ? p.stats : [])
  return JSON.stringify([
    plan.game.manifest.regulation.id,
    p.kind,
    p.judge,
    canonical(p.options),
    p.side,
    p.stats,
    normalizeSet(p.attacker, rel.attacker, exclude('attacker')),
    normalizeSet(p.defender, rel.defender, exclude('defender')),
    p.moveId,
    canonical(p.conditions),
    p.natures === null ? null : [p.natures.stat, p.natures.neutral, p.natures.plus],
    p.judge === 'speed' ? null : ['rollSteps', plan.rollSteps],
  ])
}
