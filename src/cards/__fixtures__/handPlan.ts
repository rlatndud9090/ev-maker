// 테스트 전용: 손으로 만든 소형 TabPlan과 행 작업 결과. 앱 코드에서 import하지 않는다.
import type { PokemonSet, SpTable } from '../../core'
import type { Snapshot, StatId } from '../../data/schema'
import { realData } from '../testing'
import { taskKey } from '../schedule'
import { DEFAULT_ROLL_STEPS } from '../types'
import type {
  CardSpec,
  CompactCell,
  ConditionGroup,
  ErrorReason,
  ExtremeSpec,
  FixedSpec,
  ProbeSpec,
  MoveNotice,
  NatureVariant,
  NatureVariants,
  PairPoint,
  RowKind,
  RowSpec,
  RowTask,
  RowTaskResult,
  TabPlan,
} from '../types'

export const game: Snapshot = realData().game
const regulation = game.manifest.regulation.id

export const sp = (patch: Partial<SpTable> = {}): SpTable => ({ hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...patch })

const dummySet = (species: string): PokemonSet => ({ regulation, species, ability: 'pressure', nature: 'hardy', sp: sp(), moves: [] })

/** [[끝 sp, 범주], …] → 0~32 칸. 예: [[12,'a'],[32,'b']]는 0~12 'a', 13~32 'b'. */
export function bands(spans: ReadonlyArray<readonly [number, string]>): CompactCell[] {
  const cells: CompactCell[] = []
  let i = 0
  for (const [end, category] of spans) for (; i <= end; i++) cells.push({ sp: i, category })
  if (cells.length !== 33) throw new Error(`칸 수 ${cells.length}`)
  return cells
}

export interface RowOpts {
  id: string
  cardId: string
  kind?: RowKind
  order?: number
  stat?: StatId
  side?: 'attacker' | 'defender'
  dependsOn?: readonly StatId[]
  gate?: string
  error?: ErrorReason
  /** 기본 'tackle' */
  moveId?: string
  /** 기본: 두 변형 모두 현재 성격(hardy)과 같아 변형 작업 없음. null이면 natures 없음 */
  natures?: NatureVariants | null
  /** 내 쪽 세트 성격(기본 hardy) */
  nature?: string
}

export function row(o: RowOpts): RowSpec {
  const spec: RowSpec = {
    id: o.id,
    cardId: o.cardId,
    kind: o.kind ?? 'base',
    order: o.order ?? 0,
    judge: 'damage',
    moveId: o.moveId ?? 'tackle',
    sweep: { side: o.side ?? 'attacker', stat: o.stat ?? 'atk' },
    attacker: dummySet('me'),
    defender: dummySet('opp'),
    conditions: {},
    dependsOn: o.dependsOn ?? [],
  }
  if (o.nature !== undefined) {
    if (o.side === 'defender') spec.defender = { ...spec.defender, nature: o.nature }
    else spec.attacker = { ...spec.attacker, nature: o.nature }
  }
  const boost = (o.side === 'defender' ? 'def' : (o.stat ?? 'atk')) as NatureVariants['stat']
  if (o.natures !== null) spec.natures = o.natures ?? { stat: o.stat === 'hp' || o.stat === undefined ? boost : (o.stat as NatureVariants['stat']), neutral: 'hardy', plus: 'hardy' }
  if (o.kind === 'rank') spec.basis = { kind: 'rank', means: { kind: 'move', id: 'swordsdance' }, owner: 'me', myBoosts: { atk: 2 }, opponentBoosts: {}, reactions: [] }
  if (o.gate !== undefined) spec.gate = o.gate
  if (o.error !== undefined) {
    spec.error = o.error
    delete spec.sweep
    delete spec.natures
  }
  return spec
}

export function filter(id: string, cardId: string, order = 0, natures: NatureVariants = { stat: 'def', neutral: 'hardy', plus: 'hardy' }): ExtremeSpec {
  return { id, cardId, moveId: 'tackle', order, attacker: dummySet('opp'), defender: dummySet('me'), conditions: {}, stats: ['hp', 'def'], natures, dependsOn: [] }
}

export function fixed(id: string, cardId: string): FixedSpec {
  return { id, cardId, moveId: 'foulplay', attacker: dummySet('me'), defender: dummySet('opp'), conditions: {} }
}

export interface CardOpts {
  id: string
  order?: number
  source?: 'ladder' | 'custom'
  rowIds?: readonly string[]
  filterIds?: readonly string[]
  fixedIds?: readonly string[]
  error?: ErrorReason
  notices?: readonly MoveNotice[]
  conditions?: readonly ConditionGroup[]
}

export function card(o: CardOpts): CardSpec {
  const spec: CardSpec = {
    id: o.id,
    order: o.order ?? 0,
    opponent: o.source === 'custom' ? { id: o.id, source: 'custom' } : { id: o.id, source: 'ladder', rank: 1, usage: 0.3 },
    category: 'physical',
    bundle: { key: '[]', stats: [], minority: false },
    opponentSet: dummySet('opp'),
    state: o.error ? 'error' : 'ok',
    notices: o.notices ?? [],
    rowIds: o.rowIds ?? [],
    filterIds: o.filterIds ?? [],
    fixedIds: o.fixedIds ?? [],
    conditions: o.conditions ?? [],
  }
  if (o.error) spec.error = o.error
  return spec
}

export interface PlanOpts {
  cards: CardSpec[]
  rows?: RowSpec[]
  filters?: ExtremeSpec[]
  fixed?: FixedSpec[]
  probes?: ProbeSpec[]
  mySp?: SpTable
  mySide?: 'attacker' | 'defender'
  notices?: readonly MoveNotice[]
  rollSteps?: number
}

const byId = <T extends { id: string }>(xs: readonly T[] = []): Record<string, T> => Object.fromEntries(xs.map((x) => [x.id, x]))

export function plan(o: PlanOpts): TabPlan {
  return {
    tab: 'attack',
    game,
    status: { kind: 'ok' },
    source: { match: 'bo1', month: '2026-10', cutoff: 1500, format: 'test' },
    mySp: o.mySp ?? sp(),
    mySide: o.mySide ?? 'attacker',
    rollSteps: o.rollSteps ?? DEFAULT_ROLL_STEPS,
    spTotal: game.manifest.rules.spTotal,
    spMaxPerStat: game.manifest.rules.spMaxPerStat,
    cards: o.cards,
    rows: byId(o.rows),
    filters: byId(o.filters),
    fixed: byId(o.fixed),
    probes: byId(o.probes),
    customTargetConflicts: [],
    notices: o.notices ?? [],
  }
}

const cell = (spv: number, category: string): CompactCell => ({ sp: spv, category })

/** range 기본값 = 현재 성격 양 끝(변형이 현재와 같을 때) */
export const ends = (rowId: string, low: string, high: string, range: readonly [string, string] = [low, high]): RowTaskResult => ({
  kind: 'ends',
  rowId,
  low: cell(0, low),
  high: cell(32, high),
  range: { low: cell(0, range[0]), high: cell(32, range[1]) },
})
export const swept = (rowId: string, cells: CompactCell[]): RowTaskResult => ({ kind: 'sweep', rowId, cells })
export const variantSwept = (rowId: string, nature: NatureVariant, cells: CompactCell[]): RowTaskResult => ({ kind: 'variant', rowId, nature, cells })
export const pairResult = (filterId: string, nature: NatureVariant, points: PairPoint[]): RowTaskResult => ({ kind: 'pair', filterId, nature, points })
export const extreme = (filterId: string, low: string, high: string): RowTaskResult => ({
  kind: 'extreme',
  filterId,
  low: cell(0, low),
  high: cell(32, high),
})
export const fixedResult = (fixedId: string, category: string): RowTaskResult => ({ kind: 'fixed', fixedId, cell: cell(0, category) })
export const failed = (task: RowTask, field?: string): RowTaskResult => ({
  kind: 'error',
  task,
  reason: field === undefined ? { code: 'ILLEGAL_MOVE', message: '배울 수 없다' } : { code: 'ENGINE_UNSUPPORTED', field, message: '지원하지 않는다' },
})

const keyOf = (r: RowTaskResult): string => {
  switch (r.kind) {
    case 'probe':
      return taskKey({ kind: 'probe', target: 'row', id: r.id })
    case 'ends':
      return taskKey({ kind: 'ends', rowId: r.rowId })
    case 'sweep':
      return taskKey({ kind: 'sweep', rowId: r.rowId, stage: 2 })
    case 'extreme':
      return taskKey({ kind: 'extreme', filterId: r.filterId })
    case 'fixed':
      return taskKey({ kind: 'fixed', fixedId: r.fixedId })
    case 'variant':
      return taskKey({ kind: 'variant', rowId: r.rowId, nature: r.nature })
    case 'pair':
      return taskKey({ kind: 'pair', filterId: r.filterId, nature: r.nature })
    case 'error':
      return taskKey(r.task)
  }
}

export const resultMap = (...rs: RowTaskResult[]): Map<string, RowTaskResult> => new Map(rs.map((r) => [keyOf(r), r]))
