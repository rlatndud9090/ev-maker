// 스피드 컷 고정: 배지 → 고정 대상 키·후보, 고정 해석(배지 재구성), 해석 서명, 스피드 배지 갈래 줄. 화면 없는 순수 함수다.
import { CoreError, CoreInputError, validateSet, type EvalOptions, type PokemonSet } from '../core'
import type { Snapshot, StatId } from '../data/schema'
import type { MetaView } from '../meta'
import { branchBudget, budgetMark, lockTargetId, type BudgetMark, type CutLock, type LockDerivation, type LockResolution, type LockTargetKey } from './lock'
import { laneNature, rowNature, strictVariants, type BranchPlus } from './lockNature'
import { buildSpeedChart, conditionKey, type SpeedBadge, type SpeedChartModel } from './speedChart'
import { checkedMySet, minSpToPass, type MinSp } from './speedLadder'
import type { CustomTarget, DisplayCriteria, SpeedAddedBundle, TargetStat } from './types'

export type SpeedLockKey = Extract<LockTargetKey, { kind: 'speed' }>

/** types.ts BranchOption과 같은 모양. label은 스피드 단계('first') */
export interface SpeedBranchOption {
  label: string
  stats: readonly TargetStat[]
  budget: BudgetMark
  /** 고정 S만으로 닿는다(stats의 SP = 고정 SP) */
  byLock?: true
}

/** types.ts BranchLine과 같은 모양. 'omitted' = 그 갈래에서 쓸 수 없는 선택지, null = 32 안에 닿지 않음 */
export interface SpeedBranchLine {
  branchId: string
  branchPlus: BranchPlus
  isBase: boolean
  condition: readonly { stat: StatId; sp: number; plus: boolean }[]
  status: 'ok' | 'no-drop-slot' | 'pending'
  label?: string
  neutral: SpeedBranchOption | null | 'omitted'
  plus: SpeedBranchOption | null | 'omitted'
  /** plus가 'omitted'이고 상승이 다른 고정 능력치에 간 갈래면 그 능력치 */
  omittedPlusStat?: StatId
}

export type SpeedLockCandidate =
  | { kind: 'ready'; lock: Omit<CutLock, 'seq'>; resolution: LockResolution }
  /** set-error = 내 세트 오류, speed-unsupported = 내 세트의 스피드 보정 미지원·순서 변경 */
  | { kind: 'blocked'; reason: 'set-error' | 'speed-unsupported' }

const IGNORE_TOTAL: EvalOptions = { ignoreSpTotal: true }
const SPE: readonly StatId[] = ['spe']
const STAGE_FIRST = 'first'

export function speedBadgeLockKey(badge: SpeedBadge): SpeedLockKey {
  return {
    kind: 'speed',
    origin: badge.origin,
    opponentId: badge.opponentId,
    bundle: badge.origin === 'preset' && badge.presetIndex !== undefined ? { preset: badge.presetIndex } : { sp: badge.bundle.sp, nature: badge.bundle.nature },
    condition: conditionKey(badge.condition),
    filterKind: badge.filterKind,
  }
}

const spOf = (r: MinSp | null): number | null => (r === null || r.kind === 'impossible' ? null : r.sp)

/** 세트 검증을 통과한 내 세트로 배지 실수치를 엄격히 앞지르는 S 무보정·상승 최소 SP(합계 예산 무관) */
function speedResolution(game: Snapshot, set: PokemonSet, target: number, myTailwind: boolean, options: EvalOptions | undefined): LockResolution {
  const v = strictVariants(game, laneNature(game, set.nature, 'spe', SPE), 'spe', true, SPE)
  const r = minSpToPass(game, set, target, myTailwind, { ...options, natures: { neutral: v.neutral, plus: v.plus } })
  if (r === null) return { kind: 'set-error' }
  const neutral = spOf(r.neutral)
  const plus = spOf(r.plus)
  if (neutral === null && plus === null) return { kind: 'unreachable' }
  return { kind: 'ok', options: { shape: 'single', stat: 'spe', neutral, plus } }
}

/** 배지 하나의 고정 후보(선공, 동속 제외). 내 랭크는 보지 않는다 */
export function speedLockCandidate(game: Snapshot, mySet: PokemonSet, badge: SpeedBadge, myTailwind: boolean, opts?: EvalOptions): SpeedLockCandidate {
  const checked = checkedMySet(game, mySet, opts)
  if (checked === null) return { kind: 'blocked', reason: 'set-error' }
  if ('rejection' in checked) return { kind: 'blocked', reason: 'speed-unsupported' }
  return {
    kind: 'ready',
    lock: { kind: 'speed', target: speedBadgeLockKey(badge), stage: STAGE_FIRST, stats: SPE },
    resolution: speedResolution(game, checked.set, badge.speed, myTailwind, opts),
  }
}

export interface ResolveSpeedLocksInput {
  game: Snapshot
  view: MetaView
  mySet: PokemonSet
  locks: readonly CutLock[]
  criteria: Pick<DisplayCriteria, 'rankShareMin' | 'scarfShareMin' | 'weatherShareMin'>
  customTargets: readonly CustomTarget[]
  added: readonly SpeedAddedBundle[]
  myTailwind: boolean
}

function abilityOf(game: Snapshot, set: PokemonSet): string | null {
  try {
    return validateSet(game, set, IGNORE_TOTAL).ability
  } catch (e) {
    if (e instanceof CoreError || e instanceof CoreInputError) return null
    throw e
  }
}

const sameBundle = (a: SpeedLockKey['bundle'], b: SpeedLockKey['bundle']): boolean => JSON.stringify(a) === JSON.stringify(b)

/** 정확한 키, 없으면 래더·추가 배지끼리 출처만 다른 같은 배분·조건 */
function findBadge(model: SpeedChartModel, key: SpeedLockKey): SpeedBadge | undefined {
  const id = lockTargetId(key)
  const keyed = model.badges.map((b) => ({ b, k: speedBadgeLockKey(b) }))
  const exact = keyed.find(({ k }) => lockTargetId(k) === id)
  if (exact !== undefined || key.origin === 'preset') return exact?.b
  return keyed.find(({ k }) => k.origin !== 'preset' && k.opponentId === key.opponentId && sameBundle(k.bundle, key.bundle) && k.condition === key.condition)?.b
}

/**
 * 스피드 고정마다 대상 상대 배지를 필터와 무관하게 다시 만들어 해석한다(합계 검사 끔, 내 랭크 무시).
 * 우선순위: 내 세트 오류 → set-error, 스피드 미지원 → unreachable('speed-unsupported'), 대상 배지 없음 → missing.
 */
export function resolveSpeedLocks(input: ResolveSpeedLocksInput): ReadonlyMap<number, LockResolution> {
  const { game, view, mySet, myTailwind } = input
  const out = new Map<number, LockResolution>()
  const speedLocks = input.locks.filter((l) => l.kind === 'speed' && l.target.kind === 'speed')
  if (speedLocks.length === 0) return out
  const checked = checkedMySet(game, mySet, IGNORE_TOTAL)
  const myAbility = abilityOf(game, mySet)
  const models = new Map<string, SpeedChartModel>()
  for (const lock of speedLocks) {
    const key = lock.target as SpeedLockKey
    if (checked === null) {
      out.set(lock.seq, { kind: 'set-error' })
      continue
    }
    if ('rejection' in checked) {
      out.set(lock.seq, { kind: 'unreachable', reason: 'speed-unsupported' })
      continue
    }
    const source = key.origin === 'preset' ? 'custom' : 'ladder'
    const modelKey = JSON.stringify([source, key.opponentId])
    let model = models.get(modelKey)
    if (model === undefined) {
      model = buildSpeedChart({
        game,
        view,
        myAbility,
        criteria: input.criteria,
        filters: { topN: 0, selected: [] },
        customTargets: input.customTargets,
        added: input.added,
        force: { opponentId: key.opponentId, source },
      })
      models.set(modelKey, model)
    }
    const badge = findBadge(model, key)
    out.set(lock.seq, badge === undefined ? { kind: 'missing' } : speedResolution(game, checked.set, badge.speed, myTailwind, IGNORE_TOTAL))
  }
  return out
}

/** 고정별 상태·무보정 SP·상승 SP만의 결정적 직렬화(seq 순) */
export function speedLockSignature(map: ReadonlyMap<number, LockResolution>): string {
  return JSON.stringify(
    [...map.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([seq, r]) => (r.kind === 'ok' && r.options.shape === 'single' ? [seq, r.kind, r.options.neutral, r.options.plus] : [seq, r.kind])),
  )
}

export interface SpeedBranchLinesInput {
  game: Snapshot
  /** 계획 세트(합계 검사 끔). 랭크는 무시한다 */
  mySet: PokemonSet
  derivation: LockDerivation
  badge: SpeedBadge
  myTailwind: boolean
  /** 고정 전 값이 든 내 세트 SP(예산의 고정 밖 능력치 몫) */
  mySp: Readonly<Partial<Record<StatId, number>>>
  spTotal: number
}

const avoidOf = (d: LockDerivation): StatId[] => (d.lockedStats.includes('spe') ? [...d.lockedStats] : [...d.lockedStats, 'spe'])

/** 기준 갈래에서 스피드 배지의 하락 자리가 없어 기준 갈래 성격 그대로 판정하는가 */
export function speedDropWarning(game: Snapshot, derivation: LockDerivation): boolean {
  const base = derivation.branches.find((b) => b.id === derivation.baseId)
  return base !== undefined && rowNature(game, base.nature, base.plus, avoidOf(derivation)).dropWarning
}

/**
 * 스피드 배지의 갈래 줄(갈래 순). 그 배지 자신이 고정 대상이거나 활성 갈래가 없거나 내 세트가 계산 불가면 빈 배열.
 * S가 고정이면 그 갈래의 고정 선택지만 내고 SP는 max(고정 SP, 최소 SP)다.
 */
export function speedBranchLines(input: SpeedBranchLinesInput): SpeedBranchLine[] {
  const { game, derivation, badge, myTailwind, mySp, spTotal } = input
  if (derivation.branches.length === 0) return []
  const selfId = lockTargetId(speedBadgeLockKey(badge))
  if (derivation.locks.some((l) => lockTargetId(l.target) === selfId)) return []
  const checked = checkedMySet(game, input.mySet, IGNORE_TOTAL)
  if (checked === null || 'rejection' in checked) return []
  const sLocked = derivation.lockedStats.includes('spe')
  const avoid = avoidOf(derivation)
  return derivation.branches.map((branch): SpeedBranchLine => {
    const isBase = branch.id === derivation.baseId
    const condition = derivation.lockedStats.map((stat) => ({ stat, sp: branch.lockedSp[stat] ?? 0, plus: branch.plus === stat }))
    const head = { branchId: branch.id, branchPlus: branch.plus, isBase, condition }
    const row = rowNature(game, branch.nature, branch.plus, avoid)
    if (row.dropWarning && !isBase) return { ...head, status: 'no-drop-slot', neutral: null, plus: null }
    const plusHere = sLocked ? branch.plus === 'spe' : branch.plus === 'out'
    const v = strictVariants(game, row.nature, 'spe', plusHere, avoid)
    const r = minSpToPass(game, checked.set, badge.speed, myTailwind, { ...IGNORE_TOTAL, natures: { neutral: v.neutral, plus: v.plus } })
    const budget = branchBudget(derivation, branch, mySp, SPE, spTotal)
    const lockedS = sLocked ? (branch.lockedSp.spe ?? 0) : null
    const option = (res: MinSp | null): SpeedBranchOption | null => {
      const min = spOf(res)
      if (min === null) return null
      const sp = lockedS === null ? min : Math.max(lockedS, min)
      const o: SpeedBranchOption = { label: STAGE_FIRST, stats: [{ stat: 'spe', sp }], budget: budgetMark(sp, budget.remaining, budget.othersSp) }
      if (lockedS !== null && lockedS >= min) o.byLock = true
      return o
    }
    const line: SpeedBranchLine = {
      ...head,
      status: 'ok',
      neutral: sLocked && plusHere ? 'omitted' : option(r?.neutral ?? null),
      plus: plusHere ? option(r?.plus ?? null) : 'omitted',
    }
    if (!plusHere && branch.plus !== 'out') line.omittedPlusStat = branch.plus
    return line
  })
}
