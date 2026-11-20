// 계획 + 행 작업 결과 → 탭 뷰. 판정을 다시 하지 않고 표시용 SP로 산술·조회만 한다. 비용 O(행 × 33 × 갈래).
import { adjustView } from './adjust'
import { conditionMovePower, type SpTable } from '../core'
import type { Snapshot, StatId } from '../data/schema'
import { cardItems, compareItems, itemStates, type CardItemRef, type ItemState } from './items'
import { branchBudget, type Branch, type LockDerivation, type LockResolution, type LockStage, type Stairs } from './lock'
import { strictVariants } from './lockNature'
import { findLockTarget, lockTargetKeyOf } from './lockTarget'
import { judgedMoveType } from './moveType'
import {
  cardDefault,
  cardExplore,
  cardPending,
  filterState,
  lockedHp,
  neededVariants,
  opponentKey,
  pairReady,
  primaryCardIds,
  probeKey,
  rowChanges,
  rowJudgements,
  shownItemKey,
  taskKey,
  type RowJudgements,
} from './schedule'
import { minSumWithFloors } from './stairs'
import { tierRank, type JudgementSide, type RollTier } from '../core'
import { cellLabel, firstCellAt, floorPairTarget, pairTarget, singleTarget } from './target'
import { pairCurrentCategory, sumBandOf, type SumBandInput } from './sumBand'
import { variantNature } from './natures'
import { NATURE_VARIANTS } from './types'
import type {
  BoundaryView,
  CardSpec,
  CardView,
  CellView,
  CompactCell,
  DefaultItemView,
  ErrorReason,
  ExtremeSpec,
  Headline,
  ItemView,
  CardLockPin,
  LockCandidate,
  LockControl,
  LockStageCandidate,
  NatureVariant,
  NatureVariants,
  PairPoint,
  PendingTasks,
  ResultMap,
  RowKind,
  RowLockSpec,
  RowLockView,
  RowSpec,
  RowTask,
  RowTaskResult,
  RowView,
  TabPlan,
  TabStatus,
  TabView,
  TargetView,
} from './types'

const KIND_RANK: Readonly<Record<RowKind, number>> = { base: 0, rank: 1 }
const STAT_KEYS: readonly StatId[] = ['hp', 'atk', 'def', 'spa', 'spd', 'spe']
const STAGE_KEYS = ['stage1', 'stage2', 'stage3', 'stage4', 'stage5'] as const

interface Ctx {
  plan: TabPlan
  results: ResultMap
  displaySp: SpTable
  spSum: number
  /** 고정 계획(main)만 */
  lock?: LockCtx
  /** 고정 조작(RowLockView.control·CardView.lockPin)을 낸다. 고정 계획이면 항상 참 */
  controls: boolean
  /** CardView.adjust를 낸다 */
  adjust: boolean
}

interface LockCtx {
  derivation: LockDerivation
  base: Branch
  /** refKey(행·필터) → 그 컷을 대상으로 하는 고정 seq(seq 순) */
  targets: ReadonlyMap<string, readonly number[]>
}

export interface AssembleOptions {
  /** 고정 없는 계획에서도 고정 조작(control)을 낸다. 고정 계획(main)은 이 값과 무관하게 낸다 */
  lockControls?: boolean
  /** 변동 가능 카드에 조정 모델(CardView.adjust)을 낸다 */
  adjust?: boolean
}

interface CardBuild {
  view: CardView
  /** 표시 자격(판정 준비와 무관한 노출 조건: 행·안내가 있고 반감열매가 관여함) */
  visible: boolean
  /** 기본 항목이 정해졌고(래더는 그 항목의 1·2단계까지) 화면에 낼 수 있음. 사용자가 고른 항목이면 판정 전이어도 참 */
  ready: boolean
  mySetReasons: ErrorReason[]
}

/** 보는 능력치 viewStats에 쓸 수 있는 예산. 고정 계획은 기준 갈래 예산(branchBudget, 0 아래는 0) */
function availableOf(ctx: Ctx, viewStats: readonly StatId[]): number {
  if (ctx.lock !== undefined) return branchBudget(ctx.lock.derivation, ctx.lock.base, ctx.displaySp, viewStats, ctx.plan.spTotal).remaining
  return ctx.plan.spTotal - (ctx.spSum - viewStats.reduce((a, s) => a + ctx.displaySp[s], 0))
}

/** 갈래 b에서 고정된 능력치의 고정 SP(고정 아니면 undefined) */
const lockedSpOf = (lock: LockCtx, b: Branch, stat: StatId): number | undefined =>
  lock.derivation.lockedStats.includes(stat) ? (b.lockedSp[stat] ?? 0) : undefined

function cellViews(ctx: Ctx, cells: readonly CompactCell[], stat: StatId): CellView[] {
  const available = availableOf(ctx, [stat])
  return cells.map((c) => {
    const need = Math.max(0, c.sp - available)
    return { ...c, overBudget: need > 0, need }
  })
}

/**
 * 갈래 b에서 보는 능력치 v의 성격 선택지 사용 가능 여부(R5·결정 12와 같은 규칙: lockNatures의 allowPlus).
 * neutral = v가 고정이고 상승이 v인 갈래만 쓸 수 없다. plus = 상승이 v이거나, 고정 밖이고 v가 고정이 아닐 때만.
 */
function usable(lock: LockCtx, b: Branch, v: StatId): Record<NatureVariant, boolean> {
  const vLocked = lock.derivation.lockedStats.includes(v)
  return { neutral: !(vLocked && b.plus === v), plus: b.plus === v || (b.plus === 'out' && !vLocked) }
}

/** 기준 목표에 쓰는 변형: 고정 계획이면 기준 갈래에서 쓸 수 있고 엄격 성격이 있는 것만 */
function baseVariants(ctx: Ctx, lock: RowLockSpec | undefined, v: StatId): readonly NatureVariant[] {
  if (ctx.lock === undefined || lock === undefined) return NATURE_VARIANTS
  const ok = usable(ctx.lock, ctx.lock.base, v)
  return NATURE_VARIANTS.filter((w) => ok[w] && lock.strict[w] !== null)
}

function boundariesOf(cells: readonly CellView[], current: number): BoundaryView[] {
  const out: BoundaryView[] = []
  for (let i = 1; i < cells.length; i++) {
    const prev = cells[i - 1]
    const cur = cells[i]
    if (prev.category !== cur.category) {
      out.push({ sp: cur.sp, from: prev.category, to: cur.category, delta: cur.sp - current, need: cur.need })
    }
  }
  return out
}

function nearestOf(boundaries: readonly BoundaryView[]): RowView['nearest'] {
  const nearest: { up?: BoundaryView; down?: BoundaryView } = {}
  for (const b of boundaries) {
    if (b.delta > 0 && (nearest.up === undefined || b.delta < nearest.up.delta)) nearest.up = b
    if (b.delta <= 0 && (nearest.down === undefined || b.delta > nearest.down.delta)) nearest.down = b
  }
  return nearest
}

type RowHead = Pick<RowView, 'id' | 'kind' | 'order' | 'moveId' | 'moveType' | 'power' | 'sweepStat' | 'refs' | 'basis'>

function headOf(game: Snapshot, spec: RowSpec): RowHead {
  const head: RowHead = { id: spec.id, kind: spec.kind, order: spec.order }
  if (spec.moveId !== undefined) head.moveId = spec.moveId
  const moveType = spec.moveId === undefined ? undefined : judgedMoveType(game, spec.moveId, spec)
  if (moveType !== undefined) head.moveType = moveType
  const power = spec.moveId === undefined ? undefined : conditionMovePower(spec.moveId, spec.conditions)
  if (power !== undefined) head.power = power
  if (spec.sweep !== undefined) head.sweepStat = spec.sweep.stat
  if (spec.refs !== undefined) head.refs = spec.refs
  if (spec.basis !== undefined) head.basis = spec.basis
  return head
}

/** 칸이 없는 행(판정 전·오류·고정 범주). */
function bareRow(ctx: Ctx, head: RowHead, status: RowView['status'], extra: { error?: ErrorReason; category?: string; noChange?: boolean; fixedCell?: CompactCell } = {}): RowView {
  const current: RowView['current'] = { sp: head.sweepStat === undefined ? 0 : ctx.displaySp[head.sweepStat] }
  if (extra.category !== undefined) current.category = extra.category
  const row: RowView = { ...head, status, noChange: extra.noChange ?? false, cells: [], current, boundaries: [], nearest: {} }
  if (extra.error !== undefined) row.error = extra.error
  if (extra.fixedCell !== undefined) row.fixedCell = extra.fixedCell
  return row
}

const sideOf = (ctx: Ctx): JudgementSide => (ctx.plan.mySide === 'attacker' ? 'attack' : 'defense')

/**
 * 방어 탭(필터가 있는 행)은 성격 변형별 쌍 결과, 그 밖은 그 행의 성격 변형별 33칸에서 목표를 낸다.
 * 필요한 변형 결과(방어 탭은 두 쌍 결과)가 다 나오기 전이나 그중 오류가 있으면 목표 없음(오류를 "불가"로 보이지 않는다).
 */
function targetOf(ctx: Ctx, spec: RowSpec, stat: StatId, j: RowJudgements, at: CellView | undefined): TargetView | undefined {
  const side = sideOf(ctx)
  const label = at === undefined ? undefined : cellLabel(side, at)
  if (label === undefined || spec.natures === undefined || !j.variantsDone || j.variantError) return undefined
  const plusStat = spec.natures.stat
  const allowed = baseVariants(ctx, spec.lock, plusStat)
  if (spec.gate === undefined) {
    const views = (which: NatureVariant) => {
      const cells = allowed.includes(which) ? j[which] : undefined
      return cells === undefined ? undefined : cellViews(ctx, cells, stat)
    }
    return singleTarget(side, stat, plusStat, label, { neutral: views('neutral'), plus: views('plus') })
  }
  if (spec.lock?.viewLocked === true) {
    const filterId = spec.gate
    return floorPairTarget(label, plusStat, (which, rank) => (allowed.includes(which) ? baseStairsPoint(ctx, filterId, which, rank) : null), availableOf(ctx, ['hp', plusStat]))
  }
  const points: { neutral?: PairPoint[]; plus?: PairPoint[] } = {}
  for (const nature of allowed) {
    const r = ctx.results.get(taskKey({ kind: 'pair', filterId: spec.gate, nature }))
    if (r === undefined || r.kind !== 'pair') return undefined
    points[nature] = [...r.points]
  }
  const current = { hp: ctx.displaySp.hp, defense: ctx.displaySp[plusStat] }
  return pairTarget(points, label, plusStat, current, availableOf(ctx, ['hp', plusStat]) - (current.hp + current.defense))
}

/** 고정 이상 범위(floors) 계단 점. 결과 대기 = undefined, 비단조 계단 = null, 오류 = onError */
function stairsPoint(r: RowTaskResult | undefined, floors: { hp: number; defense: number }, onError: null | undefined): { hp: number; defense: number } | null | undefined {
  if (r === undefined) return undefined
  if (r.kind === 'error') return onError
  if (r.kind !== 'stairs' || r.stairs === 'non-monotonic') return null
  return minSumWithFloors(r.stairs, floors)
}

/** 갈래 b의 쌍 하한: 고정된 H·B/D는 그 고정 SP, 아니면 0 */
const floorsOf = (lock: LockCtx, b: Branch, defense: StatId) => ({ hp: lockedSpOf(lock, b, 'hp') ?? 0, defense: lockedSpOf(lock, b, defense) ?? 0 })

/** 계단 모드 필터의 기준 갈래 점(schedule baseStairsTasks의 키: 엄격 성격, H 하한 = 기준 갈래 고정 H). 오류는 대기로 본다(불가로 보이지 않는다) */
function baseStairsPoint(ctx: Ctx, filterId: string, which: NatureVariant, rank: number): { hp: number; defense: number } | null | undefined {
  const lock = ctx.lock
  const spec = ctx.plan.filters[filterId]
  const nature = spec.lock?.strict[which] ?? null
  if (lock === undefined || nature === null) return null
  const r = ctx.results.get(taskKey({ kind: 'stairs', filterId, nature, rank, hpMin: lockedHp(ctx.plan, lock.base) }))
  return stairsPoint(r, floorsOf(lock, lock.base, spec.stats[1]), undefined)
}

/**
 * 쌍 결과가 아직 없는데 쌍 작업이 끝내 생기지 않는 이유(행·변형 스윕 오류). 기다리는 결과가 있거나 쌍 작업이 생길 수 있으면 undefined.
 */
function pairBlocked(ctx: Ctx, card: CardSpec, filterId: string): ErrorReason | undefined {
  const { plan, results } = ctx
  if (pairReady(plan, card, filterId, results)) return undefined
  let reason: ErrorReason | undefined
  for (const rowId of card.rowIds) {
    const spec = plan.rows[rowId]
    if (spec.gate !== filterId) continue
    if (spec.error !== undefined) {
      reason ??= spec.error
      continue
    }
    const ends = results.get(taskKey({ kind: 'ends', rowId }))
    if (ends === undefined) return undefined
    if (ends.kind === 'error') {
      reason ??= ends.reason
      continue
    }
    const swept = results.get(taskKey({ kind: 'sweep', rowId, stage: 2 }))
    if (swept === undefined) return undefined
    if (swept.kind === 'error') {
      reason ??= swept.reason
      continue
    }
    for (const nature of neededVariants(plan, spec)) {
      const v = results.get(taskKey({ kind: 'variant', rowId, nature }))
      if (v === undefined) return undefined
      if (v.kind === 'error') reason ??= v.reason
    }
  }
  return reason
}

/**
 * 통과한 극단 필터의 내구 합계 띠. 두 변형 쌍 결과가 다 나와야 띠가 있다(alt 범례에 다른 변형이 필요).
 * 쌍 결과 오류·쌍 작업이 끝내 생기지 않는 오류면 error. 현재 판정 = pairCurrentCategory(드래그로 두 행이 다 갱신 대기면 생략).
 * 띠 기준 변형 = 현재 성격과 같은 변형, 어느 쪽도 아니면 무보정 + fallback(이유: B/D 하락 성격 또는 그 밖).
 */
function pairBand(ctx: Ctx, card: CardSpec, filterId: string, rows: readonly RowView[]): NonNullable<CardView['pair']> {
  const spec = card.rowIds.map((id) => ctx.plan.rows[id]).find((r) => r.gate === filterId && r.natures !== undefined)
  const points: Record<NatureVariant, readonly PairPoint[]> = { neutral: [], plus: [] }
  let missing = false
  // 고정 계획에서 엄격 상승이 없으면 상승 쌍 작업이 없다(띠의 다른 변형 범례는 비운다).
  for (const nature of spec?.lock?.strict.plus === null ? (['neutral'] as const) : NATURE_VARIANTS) {
    const r = ctx.results.get(taskKey({ kind: 'pair', filterId, nature }))
    if (r?.kind === 'error') return { error: r.reason }
    if (r?.kind === 'pair') points[nature] = r.points
    else missing = true
  }
  if (missing || spec?.natures === undefined) {
    const error = pairBlocked(ctx, card, filterId)
    return error === undefined ? {} : { error }
  }
  const natures = spec.natures
  const mine = NATURE_VARIANTS.find((v) => variantNature(natures, v) === spec.defender.nature)
  const defenseStat = ctx.plan.filters[filterId].stats[1]
  const category = pairCurrentCategory(rows, defenseStat)
  const label = category === undefined ? undefined : cellLabel('defense', { category })
  const current: SumBandInput['current'] = { hp: ctx.displaySp.hp, defense: ctx.displaySp[defenseStat] }
  if (label !== undefined) current.label = label as RollTier
  const band = sumBandOf({ points, nature: mine ?? 'neutral', fallback: mine === undefined, defenseStat, current, max: ctx.plan.spMaxPerStat })
  if (mine === undefined) {
    const id = spec.defender.nature
    const all = ctx.plan.game.data.natures
    const entry = Object.prototype.hasOwnProperty.call(all, id) ? all[id] : undefined
    band.fallbackReason = entry !== undefined && entry.minus === defenseStat && entry.plus !== entry.minus ? 'minus' : 'other'
  }
  return { band }
}

// ---------- 컷 고정 표시 ----------

const refKey = (kind: 'row' | 'filter', id: string): string => JSON.stringify([kind, id])

/** 고정 계획(main)의 표시 문맥: 고정마다 findLockTarget으로 이 계획의 행·필터를 다시 찾는다 */
function lockCtxOf(plan: TabPlan): LockCtx | undefined {
  if (plan.lock?.mode !== 'main') return undefined
  const { derivation, base } = plan.lock
  const targets = new Map<string, number[]>()
  for (const lock of derivation.locks) {
    const ref = findLockTarget(plan, lock)
    if (ref === null) continue
    const k = 'rowId' in ref ? refKey('row', ref.rowId) : refKey('filter', ref.filterId)
    targets.set(k, [...(targets.get(k) ?? []), lock.seq])
  }
  return { derivation, base, targets }
}

/** 공격·방어 탭의 고정 가능 단계(낮은 단계부터) */
export const LOCK_STAGES: Readonly<Record<'attack' | 'defense', readonly LockStage[]>> = {
  attack: ['high-roll-ohko', 'guaranteed-ohko'],
  defense: ['low-roll-ohko', 'guaranteed-survive'],
}

/**
 * 후보 고정의 두 성격(고정 없으면 성격 변형, 있으면 엄격 변형). 후보 판정은 보는 능력치 v에만 의존하므로(R1),
 * 기준 갈래가 v 상승을 막아 엄격 상승이 없으면 행 성격에서 v 보정만 바꾼 상승 성격을 따로 고른다.
 */
function candidateNatures(ctx: Ctx, lock: RowLockSpec | undefined, natures: NatureVariants): { neutral: string; plus: string | null } {
  if (lock === undefined) return { neutral: natures.neutral, plus: natures.plus }
  if (lock.strict.plus !== null) return lock.strict
  return { neutral: lock.strict.neutral, plus: strictVariants(ctx.plan.game, lock.nature, natures.stat, true, [natures.stat]).plus }
}

/** 공격 고정 후보: 단계 이상 최소 SP. 엄격 상승 칸이 계획에 없으면 갈래 재스윕(branch) 작업으로 computing */
function attackCandidate(ctx: Ctx, card: CardSpec, spec: RowSpec, j: RowJudgements, itemKey: string, stage: LockStage): LockCandidate {
  const stat = (spec.sweep as NonNullable<RowSpec['sweep']>).stat
  const rank = tierRank('attack', stage)
  const natures = candidateNatures(ctx, spec.lock, spec.natures as NatureVariants)
  let plusCells: readonly CompactCell[] | null | undefined = j.plus
  if (spec.lock !== undefined && spec.lock.strict.plus === null) {
    if (natures.plus === null) plusCells = null
    else {
      const task: RowTask = { kind: 'branch', rowId: spec.id, nature: natures.plus }
      const r = ctx.results.get(taskKey(task))
      if (r === undefined) return { kind: 'computing', tasks: [task] }
      plusCells = r.kind === 'branch' ? r.cells : null
    }
  }
  const minOf = (cells: readonly CompactCell[] | null | undefined): number | null => (cells == null ? null : (firstCellAt('attack', cells, rank)?.sp ?? null))
  const neutral = minOf(j.neutral)
  const plus = minOf(plusCells)
  const resolution: LockResolution = neutral === null && plus === null ? { kind: 'unreachable' } : { kind: 'ok', options: { shape: 'single', stat, neutral, plus } }
  return { kind: 'ready', lock: { kind: 'attack', target: lockTargetKeyOf('attack', card, itemKey), stage, stats: [stat] }, resolution }
}

/** 방어 고정 후보: 고정 단계 계단(H 0부터, candidateNatures). 계단이 아직 없으면 computing(그 작업) */
function defenseCandidate(ctx: Ctx, card: CardSpec, filter: ExtremeSpec, itemKey: string, stage: LockStage): LockCandidate {
  const rank = tierRank('defense', stage)
  const natures = candidateNatures(ctx, filter.lock, filter.natures)
  const missing: RowTask[] = []
  const pick = (nature: string | null): { value: Stairs | null } | { error: string } | undefined => {
    if (nature === null) return { value: null }
    const task: RowTask = { kind: 'stairs', filterId: filter.id, nature, rank, hpMin: 0 }
    const r = ctx.results.get(taskKey(task))
    if (r === undefined) {
      if (!missing.some((t) => taskKey(t) === taskKey(task))) missing.push(task)
      return undefined
    }
    if (r.kind === 'error') return { error: r.reason.message }
    if (r.kind !== 'stairs') throw new Error(`계단 결과 종류가 ${r.kind}다`)
    if (r.stairs === 'non-monotonic') return { error: 'non-monotonic' }
    return { value: r.stairs.some((x) => x !== null) ? r.stairs : null }
  }
  const neutral = pick(natures.neutral)
  const plus = pick(natures.plus)
  if (neutral === undefined || plus === undefined) return { kind: 'computing', tasks: missing }
  let resolution: LockResolution
  if ('error' in neutral) resolution = { kind: 'unreachable', reason: neutral.error }
  else if ('error' in plus) resolution = { kind: 'unreachable', reason: plus.error }
  else if (neutral.value === null && plus.value === null) resolution = { kind: 'unreachable' }
  else resolution = { kind: 'ok', options: { shape: 'pair', defense: filter.stats[1], neutral: neutral.value, plus: plus.value } }
  return { kind: 'ready', lock: { kind: 'defense', target: lockTargetKeyOf('defense', card, itemKey), stage, stats: ['hp', filter.stats[1]] }, resolution }
}

const lockViewOrUndefined = (v: RowLockView): RowLockView | undefined => (Object.keys(v).length === 0 ? undefined : v)

/** 공격 행의 고정 표시(조작·고정한 seq·하락 경고) */
function rowLockView(ctx: Ctx, card: CardSpec, spec: RowSpec, j: RowJudgements, itemKey: string | undefined): RowLockView | undefined {
  const lock = ctx.lock
  const key = refKey('row', spec.id)
  const out: RowLockView = {}
  if (ctx.controls) {
    const control = lockControl(ctx, spec.dependsOn, itemKey, (stage) => attackCandidate(ctx, card, spec, j, itemKey as string, stage))
    if (control !== undefined) out.control = control
  }
  const lockedBy = lock?.targets.get(key)
  if (lockedBy !== undefined) out.lockedBy = lockedBy
  if (spec.lock?.dropWarning === true) out.dropWarning = true
  return lockViewOrUndefined(out)
}

/** 고정 조작: 그 탭의 고정 가능 단계마다 후보(현재 판정·목표 단계와 무관). 컷이 다른 능력치에도 의존하면(R1) 전체 고정 불가 */
function lockControl(ctx: Ctx, dependsOn: readonly StatId[], itemKey: string | undefined, candidate: (stage: LockStage) => LockCandidate): LockControl | undefined {
  const side = sideOf(ctx)
  if (itemKey === undefined || side === 'speed') return undefined
  if (dependsOn.length > 0) return { kind: 'blocked', reason: 'depends-other-stat' }
  const stages = LOCK_STAGES[side].map((stage) => ({ stage, candidate: candidate(stage) }))
  const reason = lockBlockedReason(stages)
  return reason === undefined ? { kind: 'lockable', stages } : { kind: 'blocked', reason }
}

/**
 * 모든 단계가 계산됐고 SP를 투자해야 닿는 선택지가 없을 때의 고정 불가 이유(LOCK_STAGES 순).
 * 가장 낮은 단계가 SP 0에서 이미 충족되면 판정이 SP와 무관(fixed-value), 어느 단계에도 닿지 않으면 unreachable-stage다.
 */
export function lockBlockedReason(stages: readonly LockStageCandidate[]): 'fixed-value' | 'unreachable-stage' | undefined {
  const resolutions: LockResolution[] = []
  for (const s of stages) {
    if (s.candidate.kind !== 'ready' || spOf(s.candidate.resolution).some((sp) => sp > 0)) return undefined
    resolutions.push(s.candidate.resolution)
  }
  return resolutions.some((r) => spOf(r).includes(0)) ? 'fixed-value' : 'unreachable-stage'
}

/** 해석의 닿는 선택지마다 H 0에서의 최소 SP(쌍은 계단 첫 값, null = 그 H에서 닿지 않음 → 투자 필요로 본다) */
function spOf(resolution: LockResolution): number[] {
  if (resolution.kind !== 'ok') return []
  const o = resolution.options
  if (o.shape === 'single') return [o.neutral, o.plus].filter((sp) => sp !== null)
  return [o.neutral, o.plus].filter((stairs) => stairs !== null).map((stairs) => stairs[0] ?? Infinity)
}

/** 방어 쌍의 고정 표시(필터 단위, 조작·고정한 seq·하락 경고) */
function pairLockView(ctx: Ctx, card: CardSpec, filterId: string, itemKey: string | undefined): RowLockView | undefined {
  const lock = ctx.lock
  const filter = ctx.plan.filters[filterId]
  const key = refKey('filter', filterId)
  const out: RowLockView = {}
  if (ctx.controls) {
    const control = lockControl(ctx, filter.dependsOn, itemKey, (stage) => defenseCandidate(ctx, card, filter, itemKey as string, stage))
    if (control !== undefined) out.control = control
  }
  const lockedBy = lock?.targets.get(key)
  if (lockedBy !== undefined) out.lockedBy = lockedBy
  if (filter.lock?.dropWarning === true) out.dropWarning = true
  return lockViewOrUndefined(out)
}

/** 칸들 중 그 관점 가장 유리한 판정(관점 순서 밖 범주는 건너뛴다). 없으면 undefined */
function bestOf(side: JudgementSide, cells: readonly Pick<CompactCell, 'category'>[]): string | undefined {
  let best: string | undefined
  for (const c of cells) {
    const label = cellLabel(side, c)
    if (label !== undefined && (best === undefined || tierRank(side, label) > tierRank(side, best))) best = label
  }
  return best
}

/**
 * 변화 있는 행의 도달 가능한 최선 판정(RowView.best). 방어 쌍 행 = 극단 필터 높은 극단(쌍 최소 조합의 상한과 같다),
 * 그 밖 = 변형 범위 끝·현재 성격 양 끝·현재·변형 스윕 칸 중 최선(변형 스윕이 남았으면 아직 없음, 변형 오류면 나온 칸으로).
 */
function bestReachable(ctx: Ctx, spec: RowSpec, ends: Extract<RowTaskResult, { kind: 'ends' }>, j: RowJudgements): string | undefined {
  const side = sideOf(ctx)
  if (spec.gate !== undefined) {
    const f = filterState(ctx.results, spec.gate)
    return f.kind === 'passed' ? bestOf(side, [f.result.high, f.result.low]) : undefined
  }
  if (!j.variantsDone && !j.variantError) return undefined
  return bestOf(side, [ends.range.high, ends.range.low, ends.high, ends.low, ...(j.current ?? []), ...(j.neutral ?? []), ...(j.plus ?? [])])
}

function sweptRow(ctx: Ctx, spec: RowSpec, stat: StatId, j: RowJudgements, noChange: boolean): RowView {
  const cells = j.current
  if (cells === undefined) throw new Error(`행 ${spec.id}의 현재 성격 스윕이 없다`)
  const views = cellViews(ctx, cells, stat)
  const sp = ctx.displaySp[stat]
  const boundaries = boundariesOf(views, sp)
  const stale = spec.dependsOn.some((s) => ctx.displaySp[s] !== ctx.plan.mySp[s])
  const current: RowView['current'] = { sp }
  const at = views.find((c) => c.sp === sp)
  if (at !== undefined) current.category = at.category
  const row: RowView = { ...headOf(ctx.plan.game, spec), status: stale ? 'stale' : 'ok', noChange, cells: views, current, boundaries, nearest: nearestOf(boundaries) }
  const target = noChange ? undefined : targetOf(ctx, spec, stat, j, at)
  if (target !== undefined) row.target = target
  return row
}

const SWEEP_STAT_RANK: Readonly<Partial<Record<StatId, number>>> = { hp: 0 }

/** 동률 순서: kind → 기술 슬롯(카드 행에서 그 기술이 처음 나온 순서) → H 행 먼저 → 카드 안 순번. */
function tieKey(row: RowView, slotOf: ReadonlyMap<string, number>): readonly number[] {
  const slot = row.moveId === undefined ? 0 : (slotOf.get(row.moveId) ?? 0)
  const stat = row.sweepStat === undefined ? 0 : (SWEEP_STAT_RANK[row.sweepStat] ?? 1)
  return [KIND_RANK[row.kind], slot, stat, row.order]
}

function lexLess(a: readonly number[], b: readonly number[]): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i]
  return false
}

/**
 * 대표 행: 변화 있는 행 중 경계까지 SP 차이가 가장 작은 행 → (판정 전·갱신 대기·잠정 변화 없음 행이 있으면 updating) →
 * 첫 ok 행(동률 순서 tieKey) → 계산 불가 → 행 없음(no-change). 공격·방어 탭의 행은 보이는 항목 하나의 행이다.
 */
function headlineOf(card: CardSpec, rows: readonly RowView[], slotOf: ReadonlyMap<string, number> = new Map()): Headline {
  if (card.state === 'error') return { kind: 'error', reason: cardError(card) }
  let best: { row: RowView; score: number; tie: readonly number[] } | undefined
  for (const row of rows) {
    if (row.status !== 'ok' || row.noChange || row.cells.length === 0) continue
    // 현재 성격 칸에 경계가 없는 행(성격 변형으로만 판정이 바뀜)은 경계 있는 행 뒤에 둔다.
    const score = row.boundaries.length === 0 ? Infinity : Math.min(...row.boundaries.map((b) => Math.abs(b.delta)))
    const tie = tieKey(row, slotOf)
    if (best === undefined || score < best.score || (score === best.score && lexLess(tie, best.tie))) best = { row, score, tie }
  }
  if (best !== undefined) return { kind: 'row', rowId: best.row.id }
  // 잠정 변화 없음 행(변형 스윕 대기)은 나중에 변동 가능으로 바뀔 수 있어 대표로 세우지 않는다.
  if (rows.some((r) => r.status === 'stale' || r.status === 'pending' || r.provisional)) return { kind: 'updating' }
  let fallback: { row: RowView; tie: readonly number[] } | undefined
  for (const row of rows) {
    if (row.status !== 'ok') continue
    const tie = tieKey(row, slotOf)
    if (fallback === undefined || lexLess(tie, fallback.tie)) fallback = { row, tie }
  }
  if (fallback !== undefined) return { kind: 'row', rowId: fallback.row.id }
  const errored = rows.find((r) => r.status === 'error')
  if (errored?.error !== undefined) return { kind: 'error', reason: errored.error }
  const fixed: string[] = []
  for (const r of rows) {
    if (r.current.category !== undefined && !fixed.includes(r.current.category)) fixed.push(r.current.category)
  }
  return { kind: 'no-change', fixed }
}

/**
 * "변동 가능" 카드: 칸이 있는 ok·stale 행 중 변화 있는 행이 있음. 대표 행과 따로 센다 — noChange는 SP 0~최대 전체 기준이라
 * 표시 SP와 무관하므로 드래그 중(stale, 대표가 updating)에도 태그가 사라졌다 돌아오지 않는다.
 */
function isVariable(rows: readonly RowView[]): boolean {
  return rows.some((r) => (r.status === 'ok' || r.status === 'stale') && !r.noChange && r.cells.length > 0)
}

function cardError(card: CardSpec): ErrorReason {
  if (card.error === undefined) throw new Error(`error 카드 ${card.id}에 이유가 없다`)
  return card.error
}

/** 항목 상태 → 목록 항목(채용률 순, compareItems) */
function itemViews(plan: TabPlan, refs: readonly CardItemRef[], states: readonly ItemState[]): ItemView[] {
  const byKey = new Map(refs.map((r) => [r.key, r]))
  return [...states].sort(compareItems).map((st) => {
    const ref = byKey.get(st.key) as CardItemRef
    const v: ItemView = { key: st.key, moveId: st.moveId, share: st.share, order: st.moveOrder, priority: st.priority, status: st.probe.kind }
    const c = ref.candidate
    const spec = c.target === 'row' ? plan.rows[c.id] : c.target === 'filter' ? plan.filters[c.id] : plan.fixed[c.id]
    const moveType = spec === undefined ? undefined : judgedMoveType(plan.game, st.moveId, spec)
    if (moveType !== undefined) v.moveType = moveType
    const power = spec === undefined ? undefined : conditionMovePower(st.moveId, spec.conditions)
    if (power !== undefined) v.power = power
    if (ref.basis !== undefined) v.basis = ref.basis
    if (ref.candidate.added === true) v.added = true
    if (st.probe.kind === 'ok' || st.probe.kind === 'immune') v.cell = st.probe.cell
    if (st.probe.kind === 'error') v.error = st.probe.reason
    if (st.variability.kind === 'variable') v.variable = true
    else if (st.variability.kind === 'fixed') v.variable = false
    return v
  })
}

/**
 * 카드 하나를 조립한다. 공격·방어 탭은 보이는 항목(사용자가 고른 항목, 없으면 기본 항목) 하나의 행만 낸다.
 * 래더 카드는 기본 항목이 정해지고 그 1·2단계(양 끝·변화 스윕)가 끝난 뒤에만 낼 수 있다(기본 항목·분류 깜박임 방지).
 * 사용자가 고른 항목은 판정 전이어도 바로 낸다(행은 갱신 중).
 */
/** 카드 줄 핀: 보이는 컷(방어 쌍·공격 행)의 조작, 없으면 그 이유. lockedBy는 카드의 모든 행·필터 컷에 걸린 고정이다 */
function cardLockPin(ctx: Ctx, card: CardSpec, rows: readonly RowView[], pair: CardView['pair'], shownPending: boolean): CardLockPin {
  const lock = ctx.lock
  const keys = [...card.rowIds.map((id) => refKey('row', id)), ...card.filterIds.map((id) => refKey('filter', id))]
  const lockedBy = lock === undefined ? [] : [...new Set(keys.flatMap((k) => lock.targets.get(k) ?? []))].sort((a, b) => a - b)
  const control = pair?.lock?.control ?? rows.find((r) => r.lock?.control !== undefined)?.lock?.control
  const pin: CardLockPin = { control: control ?? fallbackPin(rows, shownPending) }
  if (lockedBy.length > 0) pin.lockedBy = lockedBy
  return pin
}

function fallbackPin(rows: readonly RowView[], shownPending: boolean): CardLockPin['control'] {
  if (shownPending || rows.some((r) => r.status === 'pending')) return { kind: 'pending' }
  if (rows.length > 0 && rows.every((r) => (r.status === 'ok' || r.status === 'stale') && r.noChange)) return { kind: 'blocked', reason: 'fixed-value' }
  return { kind: 'blocked', reason: 'no-target' }
}

function buildCard(ctx: Ctx, card: CardSpec, pending: PendingTasks, selected: string | undefined): CardBuild {
  const { plan, results } = ctx
  const ladder = card.opponent.source === 'ladder'
  const base: Pick<CardView, 'id' | 'order' | 'state' | 'notices' | 'opponent' | 'category' | 'bundle' | 'berry'> = {
    id: card.id,
    order: card.order,
    state: card.state,
    notices: card.notices,
    opponent: card.opponent,
    category: card.category,
    bundle: card.bundle,
  }
  if (card.berry !== undefined) base.berry = { item: card.berry.item, share: card.berry.share }
  if (card.state === 'error') {
    const headline = headlineOf(card, [])
    const view: CardView = { ...base, error: cardError(card), rows: [], headline, variable: false, items: [], selected: false }
    if (ctx.controls) view.lockPin = cardLockPin(ctx, card, [], undefined, false)
    // 반감열매 변형의 해석 실패는 기본 카드가 같은 이유로 보이므로 따로 보이지 않는다.
    return { view, visible: card.berry === undefined, ready: true, mySetReasons: [] }
  }

  const rows: RowView[] = []
  const reasons: ErrorReason[] = []
  const fail = (reason: ErrorReason): ErrorReason => {
    if (reason.field?.startsWith(`${plan.mySide}.`)) reasons.push(reason)
    return reason
  }
  const filterHead = (gate: string, spec: RowSpec): RowHead => {
    const filter = plan.filters[gate]
    const head: RowHead = { id: JSON.stringify(['filter', gate]), kind: filter.basis ? 'rank' : 'base', order: spec.order, moveId: filter.moveId }
    if (filter.basis !== undefined) head.basis = filter.basis
    if (spec.refs !== undefined) head.refs = spec.refs
    const moveType = judgedMoveType(plan.game, filter.moveId, filter)
    if (moveType !== undefined) head.moveType = moveType
    const power = conditionMovePower(filter.moveId, filter.conditions)
    if (power !== undefined) head.power = power
    return head
  }
  const filterDone = new Set<string>()
  /** 스윕 행 하나(방어 탭 필터 행이면 필터 상태까지) */
  const pushRow = (rowId: string, itemKey?: string) => {
    const spec = plan.rows[rowId]
    if (spec.error !== undefined) {
      rows.push(bareRow(ctx, headOf(ctx.plan.game, spec), 'error', { error: spec.error }))
      return
    }
    if (spec.gate !== undefined) {
      const f = filterState(results, spec.gate)
      if (f.kind === 'pending') {
        rows.push(bareRow(ctx, headOf(ctx.plan.game, spec), 'pending'))
        return
      }
      if (f.kind !== 'passed') {
        if (filterDone.has(spec.gate)) return
        filterDone.add(spec.gate)
        const head = filterHead(spec.gate, spec)
        if (f.kind === 'error') rows.push(bareRow(ctx, head, 'error', { error: fail(f.result.reason) }))
        else rows.push(bareRow(ctx, head, 'ok', { category: f.result.low.category, noChange: true }))
        return
      }
    }
    const stat = spec.sweep?.stat
    if (stat === undefined) throw new Error(`행 ${rowId}에 스윕 대상이 없다`)
    const ends = results.get(taskKey({ kind: 'ends', rowId }))
    if (ends === undefined) {
      rows.push(bareRow(ctx, headOf(ctx.plan.game, spec), 'pending'))
      return
    }
    if (ends.kind === 'error') {
      rows.push(bareRow(ctx, headOf(ctx.plan.game, spec), 'error', { error: fail(ends.reason) }))
      return
    }
    if (ends.kind !== 'ends') throw new Error(`행 ${rowId}의 양 끝 결과 종류가 ${ends.kind}다`)
    const swept = results.get(taskKey({ kind: 'sweep', rowId, stage: 2 }))
    if (swept === undefined) {
      rows.push(bareRow(ctx, headOf(ctx.plan.game, spec), 'pending'))
      return
    }
    if (swept.kind === 'error') {
      rows.push(bareRow(ctx, headOf(ctx.plan.game, spec), 'error', { error: fail(swept.reason) }))
      return
    }
    if (swept.kind !== 'sweep') throw new Error(`행 ${rowId}의 스윕 결과 종류가 ${swept.kind}다`)
    if (swept.cells.length === 0) throw new Error(`행 ${rowId}의 스윕 칸이 비어 있다`)
    const j = rowJudgements(plan, results, rowId)
    // 변형 스윕이 남았으면 지금까지의 칸으로 잠정 판정하고 provisional 표지를 단다(나중에 "변동 가능"으로 바뀔 수 있다).
    const same = !rowChanges(ends, j)
    const row = sweptRow(ctx, spec, stat, j, same)
    if (same && !j.variantsDone) row.provisional = true
    if (!same) {
      const best = bestReachable(ctx, spec, ends, j)
      if (best !== undefined) row.best = best
    }
    if (spec.gate === undefined && (ctx.controls || ctx.lock !== undefined)) {
      const lock = rowLockView(ctx, card, spec, j, itemKey)
      if (lock !== undefined) row.lock = lock
    }
    rows.push(row)
  }
  const pushFixed = (fixedId: string, order: number) => {
    const spec = plan.fixed[fixedId]
    const head: RowHead = { id: JSON.stringify(['fixed', fixedId]), kind: 'base', order, moveId: spec.moveId }
    const moveType = judgedMoveType(plan.game, spec.moveId, spec)
    if (moveType !== undefined) head.moveType = moveType
    const r = results.get(taskKey({ kind: 'fixed', fixedId }))
    if (r === undefined) rows.push(bareRow(ctx, head, 'pending'))
    else if (r.kind === 'error') rows.push(bareRow(ctx, head, 'error', { error: fail(r.reason) }))
    else if (r.kind !== 'fixed') throw new Error(`고정 판정 ${fixedId}의 결과 종류가 ${r.kind}다`)
    else rows.push(bareRow(ctx, head, 'ok', { category: r.cell.category, noChange: true, fixedCell: r.cell }))
  }
  const fixedOrder = card.rowIds.reduce((m, id) => Math.max(m, plan.rows[id].order + 1), 0)
  const settled = pending.stage1.length === 0 && pending.stage2.length === 0

  // 후보가 없는 카드: 모든 행.
  if (card.conditions.length === 0) {
    for (const rowId of card.rowIds) pushRow(rowId)
    card.fixedIds.forEach((id, i) => pushFixed(id, fixedOrder + i))
    rows.sort((a, b) => a.order - b.order)
    const headline = headlineOf(card, rows, slotOrder(plan, card))
    const view: CardView = { ...base, rows, headline, variable: isVariable(rows), items: [], selected: false }
    if (ctx.controls) view.lockPin = cardLockPin(ctx, card, rows, undefined, false)
    return { view, visible: rows.length > 0 || card.notices.length > 0, ready: ladder ? settled : true, mySetReasons: reasons }
  }

  const refs = cardItems(plan, card)
  const states = itemStates(plan, card, refs, results)
  const def = cardDefault(plan, card, results, refs)
  const shown = shownItemKey(refs, def, selected)
  const isSelected = shown !== undefined && shown === selected
  const ref = refs.find((r) => r.key === shown)
  let pair: CardView['pair']
  if (ref !== undefined) {
    const c = ref.candidate
    const probeError = c.target !== 'fixed' ? results.get(probeKey(c)) : undefined
    if (probeError?.kind === 'error') {
      const spec = c.target === 'row' ? plan.rows[c.id] : plan.rows[card.rowIds.find((id) => plan.rows[id].gate === c.id) as string]
      const head = c.target === 'row' ? headOf(ctx.plan.game, spec) : filterHead(c.id, spec)
      rows.push(bareRow(ctx, head, 'error', { error: fail(probeError.reason) }))
    } else if (c.target === 'row') {
      pushRow(c.id, ref.key)
    } else if (c.target === 'filter') {
      for (const rowId of card.rowIds) if (plan.rows[rowId].gate === c.id) pushRow(rowId)
      if (filterState(results, c.id).kind === 'passed') {
        pair = pairBand(ctx, card, c.id, rows)
        const lock = ctx.controls || ctx.lock !== undefined ? pairLockView(ctx, card, c.id, ref.key) : undefined
        if (lock !== undefined) pair = { ...pair, lock }
      }
    } else {
      pushFixed(c.id, fixedOrder)
    }
  }
  rows.sort((a, b) => a.order - b.order)
  const headline: Headline = shown === undefined ? { kind: 'updating' } : headlineOf(card, rows, slotOrder(plan, card))
  const view: CardView = { ...base, rows, headline, variable: isVariable(rows), items: itemViews(plan, refs, states), selected: isSelected }
  if (shown !== undefined) view.shownItem = shown
  if (pair !== undefined) view.pair = pair
  if (ctx.controls) view.lockPin = cardLockPin(ctx, card, rows, pair, shown === undefined)
  const current = headlineLabel(ctx, rows, headline)
  if (ctx.adjust && view.variable && ref !== undefined && ref.candidate.target !== 'fixed') {
    const adjust = adjustView({ plan, results, shown: { target: ref.candidate.target, id: ref.candidate.id }, displaySp: ctx.displaySp, current })
    if (adjust !== undefined) view.adjust = adjust
  }
  if (def.kind === 'ready') {
    const d: DefaultItemView = { key: def.key, viaPriority: def.viaPriority }
    if (def.fallback) d.fallback = true
    const basis = states.find((st) => st.key === def.basis)
    if (basis?.probe.kind === 'ok') d.basisCell = basis.probe.cell
    view.defaultItem = d
  }
  // 반감열매 변형 카드는 보이는 항목의 기술이 그 열매를 발동시킬 때만 보인다.
  const engaged = card.berry === undefined || (ref !== undefined && card.berry.triggers.includes(ref.candidate.moveId))
  const visible = (rows.length > 0 || card.notices.length > 0) && engaged
  const ready = isSelected || (def.kind === 'ready' && (!ladder || settled))
  return { view, visible, ready, mySetReasons: reasons }
}

/** 대표 행 현재 칸의 결과(대표 행이 없거나 그 관점 순서 밖이면 undefined) */
function headlineLabel(ctx: Ctx, rows: readonly RowView[], headline: Headline): RollTier | undefined {
  if (headline.kind !== 'row') return undefined
  const category = rows.find((r) => r.id === headline.rowId)?.current.category
  return category === undefined ? undefined : (cellLabel(sideOf(ctx), { category }) as RollTier | undefined)
}

/** 계획은 기본 행을 슬롯 순(공격 탭 내 기술 슬롯, 방어 탭 상대 기술 사용률 순)으로 먼저 쌓는다. */
function slotOrder(plan: TabPlan, card: CardSpec): Map<string, number> {
  const out = new Map<string, number>()
  for (const id of card.rowIds) {
    const moveId = plan.rows[id].moveId
    if (moveId !== undefined && !out.has(moveId)) out.set(moveId, out.size)
  }
  return out
}

/** 한 카드의 끝난 작업 수(진행률 분자). */
function cardDone(plan: TabPlan, card: CardSpec, results: ResultMap): number {
  if (card.state === 'error') return 0
  let done = 0
  const has = (key: string) => (results.has(key) ? 1 : 0)
  for (const group of card.conditions) {
    for (const c of group.candidates) if (c.target !== 'fixed' && !(c.target === 'row' && plan.rows[c.id].error !== undefined)) done += has(probeKey(c))
  }
  for (const filterId of card.filterIds) {
    done += has(taskKey({ kind: 'extreme', filterId }))
    for (const nature of NATURE_VARIANTS) done += has(taskKey({ kind: 'pair', filterId, nature }))
  }
  for (const rowId of card.rowIds) {
    done += has(taskKey({ kind: 'ends', rowId })) + has(taskKey({ kind: 'sweep', rowId, stage: 2 }))
    for (const nature of neededVariants(plan, plan.rows[rowId])) done += has(taskKey({ kind: 'variant', rowId, nature }))
  }
  for (const fixedId of card.fixedIds) done += has(taskKey({ kind: 'fixed', fixedId }))
  return done
}

/** 카드별 조립 캐시 항목. 카드 결과가 바뀌면(invalidate) 통째로 버린다. */
interface CardMemo {
  pending: PendingTasks
  /** 기술 선택 메뉴를 열었을 때의 항목 변동 판정 작업(cardExplore, 처음 요청할 때 만든다) */
  explore?: PendingTasks
  done: number
  /** 그 표시용 SP로 조립한 카드(SP가 바뀌면 다시) */
  build?: CardBuild
}

/**
 * 한 탭 계획의 증분 조립기. 카드 판정은 그 카드 작업 결과에만 기대므로, 결과가 바뀐 카드(invalidate)만 다시 계산하고
 * 나머지 카드의 남은 작업·진행 수·조립 결과는 재사용한다. 결과 맵을 바꾸는 쪽이 그 작업의 카드를 invalidate해야 한다.
 */
export interface TabAssembler {
  invalidate(cardId: string): void
  /** 사용자 기술 선택(상대 키 opponentKey → 항목 키). 선택이 바뀐 상대의 카드만 다시 계산한다. 바뀐 카드가 있으면 true */
  setSelections(selections: ReadonlyMap<string, string>): boolean
  /** pendingTasks(plan, results)와 같은 값(카드 순 → 행 순). only가 있으면 그 카드들만 */
  pending(results: ResultMap, only?: (cardId: string) => boolean): PendingTasks
  /** 그 카드들의 모든 항목 변동 판정 작업(cardExplore, 카드 순 → 행 순) */
  explore(results: ResultMap, cardIds: ReadonlySet<string>): PendingTasks
  /**
   * 그 카드들의 보이는 고정 조작의 단계 중 계산 중 후보와 조정 모델(computing)이 기다리는 작업(갈래 재스윕·변형 stage4, 계단·쌍 stage5).
   * 조작도 조정도 내지 않는 조립기면 비어 있다
   */
  candidates(results: ResultMap, cardIds: ReadonlySet<string>): PendingTasks
  assemble(results: ResultMap, displaySp?: SpTable): TabView
}

const sameSp = (a: SpTable, b: SpTable): boolean => STAT_KEYS.every((k) => a[k] === b[k])

export function createTabAssembler(plan: TabPlan, initialSelections: ReadonlyMap<string, string> = new Map(), options: AssembleOptions = {}): TabAssembler {
  const memo = new Map<string, CardMemo>()
  const lock = lockCtxOf(plan)
  const controls = lock !== undefined || options.lockControls === true
  const adjust = options.adjust === true
  let builtSp: SpTable | null = null
  let selections = initialSelections
  const primary = primaryCardIds(plan)
  const selectedOf = (card: CardSpec) => selections.get(opponentKey(card.opponent))
  const entry = (card: CardSpec, results: ResultMap): CardMemo => {
    let m = memo.get(card.id)
    if (m === undefined) {
      m = { pending: cardPending(plan, card, results, selectedOf(card)), done: cardDone(plan, card, results) }
      memo.set(card.id, m)
    }
    return m
  }
  return {
    invalidate(cardId) {
      memo.delete(cardId)
    },
    setSelections(next) {
      let changed = false
      for (const card of plan.cards) {
        const k = opponentKey(card.opponent)
        if (selections.get(k) === next.get(k)) continue
        memo.delete(card.id)
        changed = true
      }
      selections = next
      return changed
    },
    pending(results, only) {
      const out = { stage1: [] as RowTask[], stage2: [] as RowTask[], stage3: [] as RowTask[], stage4: [] as RowTask[], stage5: [] as RowTask[] }
      for (const card of plan.cards) {
        if (only !== undefined && !only(card.id)) continue
        const p = entry(card, results).pending
        for (const k of STAGE_KEYS) for (const t of p[k]) out[k].push(t)
      }
      return out
    },
    explore(results, cardIds) {
      const out = { stage1: [] as RowTask[], stage2: [] as RowTask[], stage3: [] as RowTask[], stage4: [] as RowTask[], stage5: [] as RowTask[] }
      for (const card of plan.cards) {
        if (!cardIds.has(card.id)) continue
        const m = entry(card, results)
        m.explore ??= cardExplore(plan, card, results)
        for (const k of STAGE_KEYS) for (const t of m.explore[k]) out[k].push(t)
      }
      return out
    },
    candidates(results, cardIds) {
      const out = { stage1: [] as RowTask[], stage2: [] as RowTask[], stage3: [] as RowTask[], stage4: [] as RowTask[], stage5: [] as RowTask[] }
      if ((!controls && !adjust) || plan.status.kind !== 'ok' || cardIds.size === 0) return out
      const sp = builtSp ?? plan.mySp
      const ctx: Ctx = { plan, results, displaySp: sp, spSum: STAT_KEYS.reduce((sum, k) => sum + sp[k], 0), controls, adjust }
      if (lock !== undefined) ctx.lock = lock
      const seen = new Set<string>()
      const pushTasks = (tasks: readonly RowTask[]) => {
        for (const t of tasks) {
          const k = taskKey(t)
          if (results.has(k) || seen.has(k)) continue
          seen.add(k)
          out[t.kind === 'stairs' || t.kind === 'pair' ? 'stage5' : 'stage4'].push(t)
        }
      }
      const push = (control: RowLockView['control']) => {
        if (control?.kind !== 'lockable') return
        for (const { candidate } of control.stages) if (candidate.kind === 'computing') pushTasks(candidate.tasks ?? [])
      }
      for (const card of plan.cards) {
        if (!cardIds.has(card.id)) continue
        const m = entry(card, results)
        if (builtSp === null) builtSp = { ...sp }
        m.build ??= buildCard(ctx, card, m.pending, selectedOf(card))
        for (const row of m.build.view.rows) push(row.lock?.control)
        push(m.build.view.pair?.lock?.control)
        pushTasks(m.build.view.adjust?.tasks ?? [])
      }
      return out
    },
    assemble(results, displaySp = plan.mySp) {
      if (builtSp === null || !sameSp(builtSp, displaySp)) {
        for (const m of memo.values()) delete m.build
        builtSp = { ...displaySp }
      }
      const entries = plan.cards.map((card) => entry(card, results))
      let done = 0
      const left = { stage1: 0, stage2: 0, stage3: 0, stage4: 0, stage5: 0 }
      for (const m of entries) {
        done += m.done
        for (const k of STAGE_KEYS) left[k] += m.pending[k].length
      }
      const total = done + left.stage1 + left.stage2 + left.stage3 + left.stage4 + left.stage5
      const stage12Done = left.stage1 === 0 && left.stage2 === 0
      const shell = {
        tab: plan.tab,
        rollSteps: plan.rollSteps,
        source: plan.source,
        progress: { done, total },
        stage12Done,
        complete: stage12Done && left.stage3 === 0 && left.stage4 === 0 && left.stage5 === 0,
        customTargetConflicts: plan.customTargetConflicts,
        notices: plan.notices,
      }
      if (plan.status.kind !== 'ok') return { ...shell, status: plan.status, cards: [] }

      const ctx: Ctx = { plan, results, displaySp, spSum: STAT_KEYS.reduce((sum, k) => sum + displaySp[k], 0), controls, adjust }
      if (lock !== undefined) ctx.lock = lock
      const builds = plan.cards.map((card, i) => {
        const m = entries[i]
        m.build ??= buildCard(ctx, card, m.pending, selectedOf(card))
        return m.build
      })
      // 같은 상대의 먼저 계산할 카드(분류마다 기본 배분·사용자 추가·커스텀, 반감열매 변형 제외)가 모두 준비되기 전에는 그 상대를 보이지 않는다:
      // 처음 보이는 분류(물리·특수)가 두 분류의 기본 항목을 견줘 정해지므로, 한쪽만 준비됐을 때 보이면 분류가 바뀌며 깜박인다.
      const waiting = new Set<string>()
      plan.cards.forEach((card, i) => {
        if (card.berry === undefined && primary.has(card.id) && builds[i].visible && !builds[i].ready) waiting.add(opponentKey(card.opponent))
      })
      const reasons: ErrorReason[] = []
      const seen = new Set<string>()
      for (const r of builds.flatMap((b) => b.mySetReasons)) {
        const k = JSON.stringify([r.code, r.field ?? null, r.message])
        if (!seen.has(k)) {
          seen.add(k)
          reasons.push(r)
        }
      }
      if (reasons.length > 0) {
        const status: TabStatus = { kind: 'my-set-error', reasons }
        return { ...shell, status, cards: [] }
      }
      const shown = builds.filter((b, i) => b.visible && b.ready && (plan.cards[i].berry !== undefined || !waiting.has(opponentKey(plan.cards[i].opponent))))
      return { ...shell, status: plan.status, cards: shown.map((b) => b.view) }
    },
  }
}

/** displaySp 기본값은 계획 시점 SP. 카드 순서는 계획 순서 그대로다(한 번 조립: 캐시 없음). */
export function assembleTab(
  plan: TabPlan,
  results: ResultMap,
  displaySp: SpTable = plan.mySp,
  selections: ReadonlyMap<string, string> = new Map(),
  options: AssembleOptions = {},
): TabView {
  return createTabAssembler(plan, selections, options).assemble(results, displaySp)
}
