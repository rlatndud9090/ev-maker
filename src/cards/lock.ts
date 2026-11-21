// 컷 고정 도메인 코어: 고정 타입, 갈래·합치기·상태 파생, 갈래 예산. 판정은 하지 않고 해석 결과(선택지 SP·계단)를 입력으로 받는다.
import { TIER_ORDER, tierRank, type PokemonSet } from '../core'
import type { Snapshot, StatId } from '../data/schema'
import { branchNature, type BranchPlus } from './lockNature'
import type { NatureSign, SpeedBadgeOrigin } from './speedChart'
import type { Category, PresetIndex, SpeedConditionKind } from './types'

export type { BranchPlus } from './lockNature'

export type LockKind = 'speed' | 'attack' | 'defense'
/** "이 단계 이상". 공격·방어는 코어 TIER_ORDER, 스피드는 'first'(선공) */
export type LockStage = 'guaranteed-ohko' | 'high-roll-ohko' | 'guaranteed-survive' | 'low-roll-ohko' | 'first'

export type LockTargetKey =
  | {
      kind: 'attack' | 'defense'
      source: 'ladder' | 'custom'
      opponentId: string
      category: Category | null
      bundle: { ladder: string } | { preset: PresetIndex } | { added: string }
      item: string | null
      /** cards itemKey(기술, 조건) */
      itemKey: string
    }
  | {
      kind: 'speed'
      origin: SpeedBadgeOrigin
      opponentId: string
      bundle: { sp: number; nature: NatureSign } | { preset: PresetIndex }
      /** speedChart 조건 키 */
      condition: string
      filterKind: SpeedConditionKind | null
    }

export interface CutLock {
  seq: number
  kind: LockKind
  target: LockTargetKey
  stage: LockStage
  /** 공격·스피드 [stat], 방어 ['hp', 'def' | 'spd'] */
  stats: readonly StatId[]
  /**
   * 방어 쌍 배분(방어만). 없으면 합 최소. 'h-max' = 다른 고정을 뺀 예산·능력치당 최대 안에서 H를 가장 높이고 그 H의 최소 B/D로
   * 고정 단계를 정확히 내는 배분(사용자 결정 2026-11-21, 핀 메뉴 2단)
   */
  allocation?: 'h-max'
}

/** 인덱스 = H SP 0~최대, 값 = 그 H에서 단계에 닿는 최소 B/D SP(null = 불가) */
export type Stairs = readonly (number | null)[]

export type LockOptions =
  | { shape: 'single'; stat: StatId; neutral: number | null; plus: number | null }
  | {
      shape: 'pair'
      defense: 'def' | 'spd'
      neutral: Stairs | null
      plus: Stairs | null
      /**
       * 고정 단계 한 단계 위(순위 + 1)의 계단(같은 두 성격, null = 어느 H에서도 닿지 않음). H 최대 배분의 단계 정확 검사에만 쓴다.
       * 위 단계가 있는데 없으면(계산하지 않음·오류) H 최대를 검사할 수 없어 합 최소로 둔다
       */
      next?: { neutral: Stairs | null; plus: Stairs | null }
    }

export type LockResolution = { kind: 'ok'; options: LockOptions } | { kind: 'set-error' } | { kind: 'missing' } | { kind: 'unreachable'; reason?: string }

export type LockStatus =
  | { kind: 'active' }
  | { kind: 'set-error' }
  | { kind: 'missing' }
  | { kind: 'unreachable'; reason?: string }
  | { kind: 'nature-conflict' }
  /** over = 66만 넘는 갈래들 중 최소 초과량 */
  | { kind: 'sp-short'; over: number }

export interface Branch {
  /** 'out' | 'plus:<stat>' */
  id: string
  plus: BranchPlus
  nature: string
  lockedSp: Readonly<Partial<Record<StatId, number>>>
  lockedSum: number
  choice: ReadonlyMap<number, 'neutral' | 'plus'>
}

export interface LockDerivation {
  /** seq 순 */
  locks: readonly CutLock[]
  statuses: ReadonlyMap<number, LockStatus>
  /** 고정 능력치 갈래(그 능력치를 처음 쓰는 고정의 seq 순) 다음 'out' */
  branches: readonly Branch[]
  baseId: string | null
  /** 활성 고정의 능력치(STAT_ORDER 순) */
  lockedStats: readonly StatId[]
  /** max(0, 기준 갈래 고정 합 + 고정 밖 내 세트 SP 합 − spTotal). 활성 고정이 없으면 0 */
  overTotal: number
}

export interface DeriveLocksInput {
  game: Snapshot
  /** 고정 전 값이 들어 있는 내 세트 */
  mySet: PokemonSet
  locks: readonly CutLock[]
  /** seq → 해석. 없는 seq는 missing으로 본다 */
  resolutions: ReadonlyMap<number, LockResolution>
  baseChoice: string | null
}

const STAT_ORDER: readonly StatId[] = ['hp', 'atk', 'def', 'spa', 'spd', 'spe']

/** 대상 키의 구조 직렬화(JSON 배열). 같은 대상이면 같은 문자열 */
export function lockTargetId(t: LockTargetKey): string {
  if (t.kind === 'speed') {
    const bundle = 'preset' in t.bundle ? ['preset', t.bundle.preset] : ['sp', t.bundle.sp, t.bundle.nature]
    return JSON.stringify([t.kind, t.origin, t.opponentId, bundle, t.condition, t.filterKind])
  }
  const bundle = 'ladder' in t.bundle ? ['ladder', t.bundle.ladder] : 'preset' in t.bundle ? ['preset', t.bundle.preset] : ['added', t.bundle.added]
  return JSON.stringify([t.kind, t.source, t.opponentId, t.category, bundle, t.item, t.itemKey])
}

export const sameLockTarget = (a: LockTargetKey, b: LockTargetKey): boolean => lockTargetId(a) === lockTargetId(b)

/**
 * 새 고정(stats)과 H 밖 능력치가 겹치는 기존 고정. 새 고정을 걸면 이들은 해제된다(같은 능력치는 고정 하나, 사용자 결정 2026-11-21).
 * H만 공유하는 방어 쌍(H+B·H+D)은 겹치지 않는다
 */
export function conflictingLocks(locks: readonly CutLock[], stats: readonly StatId[]): CutLock[] {
  const own = stats.filter((s) => s !== 'hp')
  return locks.filter((l) => l.stats.some((s) => s !== 'hp' && own.includes(s)))
}

/** 상승안이 가는 능력치(H 단일 고정은 상승 대상이 아니다) */
function plusStatOf(o: LockOptions): Exclude<StatId, 'hp'> | null {
  if (o.shape === 'pair') return o.plus === null ? null : o.defense
  return o.plus === null || o.stat === 'hp' ? null : o.stat
}

interface Usable {
  lock: CutLock
  options: LockOptions
}

/** 쌍: hMax = H 최대 배분 고정(단계 정확 검사가 가능할 때만), next = 한 단계 위 계단(null = 위 단계가 없거나 닿지 않음) */
type Need = { shape: 'single'; stat: StatId; sp: number } | { shape: 'pair'; defense: 'def' | 'spd'; stairs: Stairs; hMax: boolean; next: Stairs | null }

/** 방어 고정 단계에 한 단계 위가 있는지 */
const hasUpperStage = (stage: LockStage): boolean => {
  const order = TIER_ORDER.defense as readonly string[]
  return order.includes(stage) && tierRank('defense', stage) + 1 < order.length
}

function needOf(o: LockOptions, usePlus: boolean, lock: Pick<CutLock, 'stage' | 'allocation'>): Need | null {
  if (o.shape === 'single') {
    const sp = usePlus ? o.plus : o.neutral
    return sp === null ? null : { shape: 'single', stat: o.stat, sp }
  }
  const stairs = usePlus ? o.plus : o.neutral
  if (stairs === null) return null
  const upper = hasUpperStage(lock.stage)
  const next = upper ? (o.next === undefined ? undefined : usePlus ? o.next.plus : o.next.neutral) : null
  const hMax = lock.allocation === 'h-max' && next !== undefined
  return { shape: 'pair', defense: o.defense, stairs, hMax, next: next ?? null }
}

const statsOfOptions =(o: LockOptions): StatId[] => (o.shape === 'single' ? [o.stat] : ['hp', o.defense])

/** 능력치를 공유하는 요구끼리 묶는다(입력 순서를 지키는 결정적 union-find) */
function groupNeeds(needs: readonly Need[]): Need[][] {
  const parent = needs.map((_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  const owner = new Map<StatId, number>()
  needs.forEach((n, i) => {
    const stats: StatId[] = n.shape === 'single' ? [n.stat] : ['hp', n.defense]
    for (const s of stats) {
      const o = owner.get(s)
      if (o === undefined) owner.set(s, i)
      else parent[find(i)] = find(o)
    }
  })
  const groups = new Map<number, Need[]>()
  needs.forEach((n, i) => {
    const r = find(i)
    const g = groups.get(r)
    if (g === undefined) groups.set(r, [n])
    else g.push(n)
  })
  return [...groups.values()]
}

type PairNeed = Extract<Need, { shape: 'pair' }>

/** 쌍이 든 묶음의 H 한 값에서 능력치별 SP와 합. 그 H에서 닿지 않거나 능력치당 최대를 넘으면 null */
function groupAt(group: readonly Need[], hp: number, spMax: number): { sum: number; sp: Partial<Record<StatId, number>> } | null {
  const pairs = group.filter((n): n is PairNeed => n.shape === 'pair')
  const singleMax = (s: StatId): number => group.reduce((m, n) => (n.shape === 'single' && n.stat === s ? Math.max(m, n.sp) : m), 0)
  const defenses = STAT_ORDER.filter((s) => s !== 'hp' && group.some((n) => (n.shape === 'pair' ? n.defense === s : n.stat === s)))
  const sp: Partial<Record<StatId, number>> = { hp }
  let sum = hp
  for (const d of defenses) {
    let need = singleMax(d)
    for (const p of pairs) {
      if (p.defense !== d) continue
      const v = p.stairs[hp] ?? null
      if (v === null) return null
      need = Math.max(need, v)
    }
    if (need > spMax) return null
    sp[d] = need
    sum += need
  }
  return { sum, sp }
}

/** 묶음의 능력치별 SP. 쌍이 있으면 H 0~spMax 중 합 최소(동률 H 큰 쪽). 불가면 null */
function mergeGroup(group: readonly Need[], spMax: number): Partial<Record<StatId, number>> | null {
  const singles = group.filter((n): n is Extract<Need, { shape: 'single' }> => n.shape === 'single')
  if (singles.some((n) => n.sp > spMax || n.sp < 0)) return null
  if (!group.some((n) => n.shape === 'pair')) {
    const out: Partial<Record<StatId, number>> = {}
    for (const n of singles) out[n.stat] = Math.max(out[n.stat] ?? 0, n.sp)
    return out
  }
  const hpFloor = singles.reduce((m, n) => (n.stat === 'hp' ? Math.max(m, n.sp) : m), 0)
  let best: { sum: number; sp: Partial<Record<StatId, number>> } | null = null
  for (let hp = hpFloor; hp <= spMax; hp++) {
    const at = groupAt(group, hp, spMax)
    if (at !== null && (best === null || at.sum <= best.sum)) best = at
  }
  return best === null ? null : best.sp
}

/**
 * H 최대 쌍이 든 묶음: H를 spMax부터 내려가며 묶음 합 ≤ budget이고, H 최대 쌍마다 그 H의 B/D가 한 단계 위(next)에 닿지 않는(단계 정확)
 * 가장 큰 H. 그 H에서 각 요구는 최소다. 없으면 합 최소(mergeGroup)로 둔다(변동 defenseHMax와 같은 뜻, 사용자 결정 2026-11-21)
 */
function mergeGroupHMax(group: readonly Need[], spMax: number, budget: number): Partial<Record<StatId, number>> | null {
  const singles = group.filter((n): n is Extract<Need, { shape: 'single' }> => n.shape === 'single')
  if (singles.some((n) => n.sp > spMax || n.sp < 0)) return null
  const hpFloor = singles.reduce((m, n) => (n.stat === 'hp' ? Math.max(m, n.sp) : m), 0)
  const hMaxPairs = group.filter((n): n is PairNeed => n.shape === 'pair' && n.hMax)
  for (let hp = spMax; hp >= hpFloor; hp--) {
    const at = groupAt(group, hp, spMax)
    if (at === null || at.sum > budget) continue
    const exact = hMaxPairs.every((p) => {
      const up = p.next?.[hp] ?? null
      return up === null || up > (at.sp[p.defense] ?? 0)
    })
    if (exact) return at.sp
  }
  return mergeGroup(group, spMax)
}

function branchesOf(game: Snapshot, mySet: PokemonSet, usable: readonly Usable[], ignoreTotal: boolean): Branch[] {
  const { spMaxPerStat, spTotal } = game.manifest.rules
  const plusStats: Exclude<StatId, 'hp'>[] = []
  for (const u of usable) {
    const s = plusStatOf(u.options)
    if (s !== null && !plusStats.includes(s)) plusStats.push(s)
  }
  const avoid = STAT_ORDER.filter((s) => usable.some((u) => statsOfOptions(u.options).includes(s)))
  const out: Branch[] = []
  for (const plus of [...plusStats, 'out' as const]) {
    const choice = new Map<number, 'neutral' | 'plus'>()
    const needs: Need[] = []
    let ok = true
    for (const { lock, options } of usable) {
      const usePlus = plus !== 'out' && plusStatOf(options) === plus
      const need = needOf(options, usePlus, lock)
      if (need === null) {
        ok = false
        break
      }
      choice.set(lock.seq, usePlus ? 'plus' : 'neutral')
      needs.push(need)
    }
    if (!ok) continue
    const nature = branchNature(game, mySet.nature, plus, avoid)
    if (nature === null) continue
    const lockedSp: Partial<Record<StatId, number>> = {}
    // H 최대 쌍이 든 묶음(쌍은 모두 H를 공유하므로 많아야 하나)은 다른 묶음 합을 뺀 예산으로 나중에 정한다. 완화 모드(SP 부족량)는 합 최소로 센다
    const groups = groupNeeds(needs)
    const hMaxGroups = ignoreTotal ? [] : groups.filter((g) => g.some((n) => n.shape === 'pair' && n.hMax))
    for (const g of groups) {
      if (hMaxGroups.includes(g)) continue
      const merged = mergeGroup(g, spMaxPerStat)
      if (merged === null) {
        ok = false
        break
      }
      Object.assign(lockedSp, merged)
    }
    if (!ok) continue
    for (const g of hMaxGroups) {
      const used = STAT_ORDER.reduce((a, s) => a + (lockedSp[s] ?? 0), 0)
      const merged = mergeGroupHMax(g, spMaxPerStat, spTotal - used)
      if (merged === null) {
        ok = false
        break
      }
      Object.assign(lockedSp, merged)
    }
    if (!ok) continue
    const lockedSum = STAT_ORDER.reduce((a, s) => a + (lockedSp[s] ?? 0), 0)
    if (!ignoreTotal && lockedSum > spTotal) continue
    out.push({ id: plus === 'out' ? 'out' : `plus:${plus}`, plus, nature, lockedSp, lockedSum, choice })
  }
  return out
}

function pickBase(branches: readonly Branch[], baseChoice: string | null): Branch | null {
  const chosen = branches.find((b) => b.id === baseChoice)
  if (chosen !== undefined) return chosen
  const out = branches.find((b) => b.id === 'out')
  if (out !== undefined) return out
  let best: Branch | null = null
  for (const b of branches) if (best === null || b.lockedSum < best.lockedSum) best = b
  return best
}

/**
 * 고정 목록 → 상태·갈래·기준 갈래. 고정은 seq 순으로 하나씩 더하고, 유효 갈래를 0으로 만드는 고정은
 * sp-short(66 조건만 빼면 갈래가 있음) 또는 nature-conflict를 받고 이후 계산에서 빠진다.
 */
export function deriveLocks({ game, mySet, locks, resolutions, baseChoice }: DeriveLocksInput): LockDerivation {
  const { spTotal } = game.manifest.rules
  const sorted = [...locks].sort((a, b) => a.seq - b.seq)
  const statuses = new Map<number, LockStatus>()
  const active: Usable[] = []
  for (const lock of sorted) {
    const res = resolutions.get(lock.seq)
    if (res === undefined || res.kind === 'missing') {
      statuses.set(lock.seq, { kind: 'missing' })
      continue
    }
    if (res.kind === 'set-error') {
      statuses.set(lock.seq, { kind: 'set-error' })
      continue
    }
    if (res.kind === 'unreachable') {
      statuses.set(lock.seq, res.reason === undefined ? { kind: 'unreachable' } : { kind: 'unreachable', reason: res.reason })
      continue
    }
    if (res.options.neutral === null && res.options.plus === null) {
      statuses.set(lock.seq, { kind: 'unreachable' })
      continue
    }
    const trial = [...active, { lock, options: res.options }]
    if (branchesOf(game, mySet, trial, false).length > 0) {
      active.push({ lock, options: res.options })
      statuses.set(lock.seq, { kind: 'active' })
      continue
    }
    const relaxed = branchesOf(game, mySet, trial, true)
    if (relaxed.length === 0) statuses.set(lock.seq, { kind: 'nature-conflict' })
    else statuses.set(lock.seq, { kind: 'sp-short', over: Math.min(...relaxed.map((b) => b.lockedSum - spTotal)) })
  }
  const branches = active.length === 0 ? [] : branchesOf(game, mySet, active, false)
  const base = pickBase(branches, baseChoice)
  const lockedStats = STAT_ORDER.filter((s) => active.some((u) => statsOfOptions(u.options).includes(s)))
  const others = STAT_ORDER.reduce((a, s) => (lockedStats.includes(s) ? a : a + (mySet.sp[s] ?? 0)), 0)
  const overTotal = base === null ? 0 : Math.max(0, base.lockedSum + others - spTotal)
  return { locks: sorted, statuses, branches, baseId: base?.id ?? null, lockedStats, overTotal }
}

export type LockCheck = { kind: 'ok' } | { kind: 'sp-short'; over: number } | { kind: 'nature-conflict' } | { kind: 'unreachable' }

/** 후보를 seq = 최대 + 1로 더해 deriveLocks로 판정한 후보의 상태. 후보가 교체할 고정(conflictingLocks)은 빼고 판정한다 */
export function checkLockCandidate(
  input: Omit<DeriveLocksInput, 'baseChoice'> & { baseChoice?: string | null; candidate: { lock: Omit<CutLock, 'seq'>; resolution: LockResolution } },
): LockCheck {
  const seq = input.locks.reduce((m, l) => Math.max(m, l.seq), 0) + 1
  const resolutions = new Map(input.resolutions)
  resolutions.set(seq, input.candidate.resolution)
  const replaced = conflictingLocks(input.locks, input.candidate.lock.stats)
  const d = deriveLocks({
    game: input.game,
    mySet: input.mySet,
    locks: [...input.locks.filter((l) => !replaced.includes(l)), { ...input.candidate.lock, seq }],
    resolutions,
    baseChoice: input.baseChoice ?? null,
  })
  const s = d.statuses.get(seq)
  if (s?.kind === 'active') return { kind: 'ok' }
  if (s?.kind === 'sp-short') return { kind: 'sp-short', over: s.over }
  if (s?.kind === 'nature-conflict') return { kind: 'nature-conflict' }
  return { kind: 'unreachable' }
}

/**
 * 갈래에서 보는 능력치의 예산. othersSp = 고정도 보지도 않는 능력치의 내 SP 합,
 * remaining = max(0, spTotal − 갈래 고정 합 − othersSp + 보는 능력치 중 고정된 것의 고정 SP).
 */
export function branchBudget(
  derivation: LockDerivation,
  branch: Branch,
  mySp: Readonly<Partial<Record<StatId, number>>>,
  viewStats: readonly StatId[],
  spTotal: number,
): { remaining: number; othersSp: number } {
  let othersSp = 0
  let back = 0
  for (const s of STAT_ORDER) {
    const locked = derivation.lockedStats.includes(s)
    if (viewStats.includes(s)) {
      if (locked) back += branch.lockedSp[s] ?? 0
    } else if (!locked) othersSp += mySp[s] ?? 0
  }
  return { remaining: Math.max(0, spTotal - branch.lockedSum - othersSp + back), othersSp }
}

export type BudgetMark = { kind: 'fits' } | { kind: 'need'; n: number } | { kind: 'short'; m: number }

/** n = needSum − remaining(다른 능력치에서 줄일 양), m = n − othersSp(초과량) */
export function budgetMark(needSum: number, remaining: number, othersSp: number): BudgetMark {
  if (needSum <= remaining) return { kind: 'fits' }
  const n = needSum - remaining
  return n > othersSp ? { kind: 'short', m: n - othersSp } : { kind: 'need', n }
}
