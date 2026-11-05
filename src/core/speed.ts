// 스피드 엔진(자체 구현). 엔진 비공개 getFinalSpeed와 같은 4096 체인·반올림이되, 999 상한은 두지 않는다. 트릭룸은 다루지 않는다.
import type { Snapshot } from '../data/schema'
import type { BattleConditions, OutspeedResult, PokemonSet, SpeedOrder, SpeedResult, Terrain, Weather } from './types'
import { normalizeConditions, type NormalizedConditions } from './conditions'
import { CoreInputError, isPlainObject } from './errors'
import { remainingBudget, validateSet, type ResolvedSet } from './set'
import { natureMultiplier, statValue } from './stats'

/** 조건(날씨·필드)이 맞을 때 ×2인 특성 */
const CONDITIONAL_DOUBLE_ABILITY: Record<string, (weather: Weather, terrain: Terrain) => boolean> = {
  swiftswim: (w) => w === 'Rain',
  chlorophyll: (w) => w === 'Sun',
  sandrush: (w) => w === 'Sand',
  slushrush: (w) => w === 'Snow',
  surgesurfer: (_, t) => t === 'Electric',
}
const QUICK_FEET = 'quickfeet'
const ITEM_MOD: Record<string, number> = { choicescarf: 6144, ironball: 2048 }
/** 게임에서 스피드를 바꾸지만 이 모듈이 구현하지 않은 보정. 조용히 무시하지 않고 거부한다. */
const UNSUPPORTED_SPEED_ABILITIES = ['slowstart', 'protosynthesis', 'quarkdrive']
const UNSUPPORTED_SPEED_ITEMS = ['machobrace', 'poweranklet', 'powerband', 'powerbelt', 'powerbracer', 'powerlens', 'powerweight', 'quickpowder']
/** 스피드와 무관하게 행동 순서를 바꾸는 보정. 순서 비교에서 거부한다. */
const ORDER_ABILITIES = ['stall', 'quickdraw', 'myceliummight']
const ORDER_ITEMS = ['quickclaw', 'laggingtail', 'fullincense', 'custapberry']

const pokeRound = (n: number) => (n % 1 > 0.5 ? Math.ceil(n) : Math.floor(n))

function chainMods(mods: number[]): number {
  let m = 4096
  for (const mod of mods) if (mod !== 4096) m = (m * mod + 2048) >> 12
  return Math.max(410, Math.min(131172, m))
}

export function boostedStat(stat: number, stage: number): number {
  return stage >= 0 ? Math.floor((stat * (2 + stage)) / 2) : Math.floor((stat * 2) / (2 - stage))
}

/** 앱 최종 스피드. 대미지 래퍼도 엔진 스피드 대조에 이 값을 쓴다. */
export function speedOf(r: ResolvedSet, c: NormalizedConditions, side: 'attacker' | 'defender'): number {
  if (UNSUPPORTED_SPEED_ABILITIES.includes(r.ability)) {
    throw new CoreInputError('ability', `${r.ability}의 스피드 보정은 지원하지 않는다`)
  }
  if (r.item !== undefined && UNSUPPORTED_SPEED_ITEMS.includes(r.item)) {
    throw new CoreInputError('item', `${r.item}의 스피드 보정은 지원하지 않는다`)
  }
  let speed = boostedStat(r.stats.spe, r.boosts.spe)
  // 순서: 순풍 → 특성 → 도구(엔진 getFinalSpeed와 같은 체인 순서)
  const mods: number[] = []
  if (c[side].tailwind) mods.push(8192)
  const quickFeet = r.ability === QUICK_FEET && r.status !== 'none'
  if (CONDITIONAL_DOUBLE_ABILITY[r.ability]?.(c.weather, c.terrain)) mods.push(8192)
  else if (quickFeet) mods.push(6144)
  if (r.item !== undefined && ITEM_MOD[r.item] !== undefined) mods.push(ITEM_MOD[r.item])
  speed = pokeRound((speed * chainMods(mods)) / 4096)
  if (r.status === 'par' && !quickFeet) speed = Math.floor((speed * 50) / 100)
  return speed
}

function assertOrderBySpeed(r: ResolvedSet, field: string): void {
  if (ORDER_ABILITIES.includes(r.ability)) {
    throw new CoreInputError(`${field}.ability`, `${r.ability}은 스피드와 별개로 행동 순서를 바꾸므로 순서 비교를 지원하지 않는다`)
  }
  if (r.item !== undefined && ORDER_ITEMS.includes(r.item)) {
    throw new CoreInputError(`${field}.item`, `${r.item}은 스피드와 별개로 행동 순서를 바꾸므로 순서 비교를 지원하지 않는다`)
  }
}

/** side는 conditions의 어느 쪽 순풍을 적용할지 정한다(기본 attacker). */
export function finalSpeed(
  snapshot: Snapshot,
  set: PokemonSet,
  conditions?: BattleConditions,
  side: 'attacker' | 'defender' = 'attacker',
): number {
  if (side !== 'attacker' && side !== 'defender') throw new CoreInputError('side', `attacker|defender여야 한다(받은 값: ${String(side)})`)
  return speedOf(validateSet(snapshot, set), normalizeConditions(conditions), side)
}

export function speedOrder(a: number, b: number): SpeedOrder {
  return a > b ? 'first' : a < b ? 'second' : 'tie'
}

function firstMovePriority(snapshot: Snapshot, r: ResolvedSet): number | undefined {
  const id = r.set.moves[0]
  return id === undefined ? undefined : snapshot.data.moves[id].priority
}

/** 행동 순서는 스피드만으로 정한다. 우선도는 각 세트 첫 기술의 값을 별도 정보로 돌려준다. */
export function compareSpeed(snapshot: Snapshot, a: PokemonSet, b: PokemonSet, conditions?: BattleConditions): SpeedResult {
  const ra = validateSet(snapshot, a)
  const rb = validateSet(snapshot, b)
  assertOrderBySpeed(ra, 'a')
  assertOrderBySpeed(rb, 'b')
  const c = normalizeConditions(conditions)
  const attackerSpeed = speedOf(ra, c, 'attacker')
  const defenderSpeed = speedOf(rb, c, 'defender')
  const out: SpeedResult = { attackerSpeed, defenderSpeed, order: speedOrder(attackerSpeed, defenderSpeed) }
  const ap = firstMovePriority(snapshot, ra)
  const dp = firstMovePriority(snapshot, rb)
  if (ap !== undefined) out.attackerPriority = ap
  if (dp !== undefined) out.defenderPriority = dp
  return out
}

/**
 * set(attacker 쪽 조건 적용)이 목표를 엄격히 앞지르는 최소 스피드 SP. 성격·도구·조건은 고정한다.
 * 목표가 세트면 defender 쪽 조건으로 그 최종 스피드를 구한다.
 */
export function minSpToOutspeed(
  snapshot: Snapshot,
  set: PokemonSet,
  target: number | PokemonSet,
  conditions?: BattleConditions,
): OutspeedResult {
  const c = normalizeConditions(conditions)
  const r = validateSet(snapshot, set)
  let targetSpeed: number
  if (typeof target === 'number') {
    if (!Number.isInteger(target) || target < 0) throw new CoreInputError('target', `0 이상 정수여야 한다(받은 값: ${target})`)
    targetSpeed = target
  } else if (!isPlainObject(target)) {
    throw new CoreInputError('target', `스피드 수치 또는 세트여야 한다(받은 값: ${String(target)})`)
  } else {
    targetSpeed = speedOf(validateSet(snapshot, target), c, 'defender')
  }
  const max = snapshot.manifest.rules.spMaxPerStat
  const remaining = remainingBudget(snapshot, set, 'spe')
  for (let sp = 0; sp <= max; sp++) {
    // 예산 초과 SP도 판정해야 하므로 세트 재검증 없이 스피드 실능만 바꾼다.
    const spe = statValue('spe', r.species.baseStats.spe, sp, natureMultiplier(r.nature, 'spe'))
    if (speedOf({ ...r, stats: { ...r.stats, spe } }, c, 'attacker') > targetSpeed) {
      return sp <= remaining ? { kind: 'ok', sp } : { kind: 'over-budget', sp, remaining }
    }
  }
  return { kind: 'impossible' }
}
