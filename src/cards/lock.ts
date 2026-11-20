// 컷 고정 도메인 코어: 고정 타입, 갈래·합치기·상태 파생, 갈래 예산. 판정은 하지 않고 해석 결과(선택지 SP·계단)를 입력으로 받는다.
import type { PokemonSet } from '../core'
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
}

/** 인덱스 = H SP 0~최대, 값 = 그 H에서 단계에 닿는 최소 B/D SP(null = 불가) */
export type Stairs = readonly (number | null)[]

export type LockOptions =
  | { shape: 'single'; stat: StatId; neutral: number | null; plus: number | null }
  | { shape: 'pair'; defense: 'def' | 'spd'; neutral: Stairs | null; plus: Stairs | null }

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

/** 상승안이 가는 능력치(H 단일 고정은 상승 대상이 아니다) */
function plusStatOf(o: LockOptions): Exclude<StatId, 'hp'> | null {
  if (o.shape === 'pair') return o.plus === null ? null : o.defense
  return o.plus === null || o.stat === 'hp' ? null : o.stat
}

interface Usable {
  lock: CutLock
  options: LockOptions
}

type Need = { shape: 'single'; stat: StatId; sp: number } | { shape: 'pair'; defense: 'def' | 'spd'; stairs: Stairs }

function needOf(o: LockOptions, usePlus: boolean): Need | null {
  if (o.shape === 'single') {
    const sp = usePlus ? o.plus : o.neutral
    return sp === null ? null : { shape: 'single', stat: o.stat, sp }
  }
  const stairs = usePlus ? o.plus : o.neutral
  return stairs === null ? null : { shape: 'pair', defense: o.defense, stairs }
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

/** 묶음의 능력치별 SP. 쌍이 있으면 H 0~spMax 중 합 최소(동률 H 큰 쪽). 불가면 null */
function mergeGroup(group: readonly Need[], spMax: number): Partial<Record<StatId, number>> | null {
  const pairs = group.filter((n): n is Extract<Need, { shape: 'pair' }> => n.shape === 'pair')
  const singles = group.filter((n): n is Extract<Need, { shape: 'single' }> => n.shape === 'single')
  const singleMax = (s: StatId): number => singles.reduce((m, n) => (n.stat === s ? Math.max(m, n.sp) : m), 0)
  if (singles.some((n) => n.sp > spMax || n.sp < 0)) return null
  if (pairs.length === 0) {
    const out: Partial<Record<StatId, number>> = {}
    for (const n of singles) out[n.stat] = Math.max(out[n.stat] ?? 0, n.sp)
    return out
  }
  const defenses = STAT_ORDER.filter((s) => s !== 'hp' && group.some((n) => (n.shape === 'pair' ? n.defense === s : n.stat === s)))
  const hpFloor = singleMax('hp')
  let best: { sum: number; sp: Partial<Record<StatId, number>> } | null = null
  for (let hp = hpFloor; hp <= spMax; hp++) {
    const sp: Partial<Record<StatId, number>> = { hp }
    let sum = hp
    let ok = true
    for (const d of defenses) {
      let need = singleMax(d)
      for (const p of pairs) {
        if (p.defense !== d) continue
        const v = p.stairs[hp] ?? null
        if (v === null) {
          ok = false
          break
        }
        need = Math.max(need, v)
      }
      if (!ok || need > spMax) {
        ok = false
        break
      }
      sp[d] = need
      sum += need
    }
    if (ok && (best === null || sum <= best.sum)) best = { sum, sp }
  }
  return best === null ? null : best.sp
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
      const need = needOf(options, usePlus)
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
    for (const g of groupNeeds(needs)) {
      const merged = mergeGroup(g, spMaxPerStat)
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

/** 후보를 seq = 최대 + 1로 더해 deriveLocks로 판정한 후보의 상태 */
export function checkLockCandidate(
  input: Omit<DeriveLocksInput, 'baseChoice'> & { baseChoice?: string | null; candidate: { lock: Omit<CutLock, 'seq'>; resolution: LockResolution } },
): LockCheck {
  const seq = input.locks.reduce((m, l) => Math.max(m, l.seq), 0) + 1
  const resolutions = new Map(input.resolutions)
  resolutions.set(seq, input.candidate.resolution)
  const d = deriveLocks({
    game: input.game,
    mySet: input.mySet,
    locks: [...input.locks, { ...input.candidate.lock, seq }],
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
