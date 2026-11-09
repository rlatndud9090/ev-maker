// 카드 모델 공유 계약. React·브라우저 API를 import하지 않는다.
import type { BattleConditions, BoostTable, CoreErrorCode, MoveStatRefs, PokemonSet, SpTable } from '../core'
import type { MatchType } from '../data/meta-schema'
import type { Snapshot, StatId } from '../data/schema'
import type { MetaView } from '../meta'

export type Tab = 'attack' | 'defense' | 'speed'
export const TABS: readonly Tab[] = ['attack', 'defense', 'speed']
/** 참조 방어 능력치 기준: def → physical, spd → special. 스피드 탭 카드는 null */
export type Category = 'physical' | 'special'
export const CATEGORY_ORDER: readonly Category[] = ['physical', 'special']

export interface DisplayCriteria {
  /** 묶음 점유율 기준(0~1, 이상이면 카드) */
  bundleShareMin: number
  /** 포켓몬·분류당 카드 상한(정수 ≥ 1) */
  cardsPerCategory: number
  /** 상대 랭크 수단 점유율 기준(0~1, 이상) */
  rankShareMin: number
  /** 구애스카프 점유율 기준(0~1, 이상) */
  scarfShareMin: number
}
export const DEFAULT_CRITERIA: Readonly<DisplayCriteria> = Object.freeze({
  bundleShareMin: 0.05,
  cardsPerCategory: 3,
  rankShareMin: 0.1,
  scarfShareMin: 0.1,
})

export interface CardFilters {
  /** 사용률 상위 N마리(정수 ≥ 1) */
  topN: number
  /** 메타 항목 id. 비어 있으면 상위 N 보기 */
  selected: readonly string[]
}
export const DEFAULT_TOP_N = 30

export interface CardConditions {
  myTailwind: boolean
  opponentTailwind: boolean
}

export type PresetIndex = 0 | 1 | 2
/** 프리셋별 편집값. 기술은 타겟 단위(CustomTarget.moves)라 여기 없다 */
export interface PresetEdit {
  sp?: Partial<SpTable>
  nature?: string
  /** null = 도구 없음 */
  item?: string | null
  ability?: string
}
export const MAX_CUSTOM_MOVES = 4
export interface CustomTarget {
  /** 로스터 종·폼 id(메가 폼이면 메가 폼 id). 메타 목록 밖이어야 한다 */
  rosterId: string
  /** 사용자가 지정한 그 타겟의 기술(필수, 1~MAX_CUSTOM_MOVES개, 자동 채움 없음).
   *  모든 탭·프리셋 세트의 moves이고, 방어 탭 상대 기술·랭크 수단 출처로도 쓴다 */
  moves: readonly string[]
  /** 키는 presetKey(tab, category, preset) */
  edits: Readonly<Record<string, PresetEdit>>
}

export interface CardInput {
  game: Snapshot
  view: MetaView
  /** 검증 전 그대로. 무효면 탭 상태가 my-set-error */
  mySet: PokemonSet
  conditions: CardConditions
  criteria: DisplayCriteria
  filters: CardFilters
  /** 추가한 순서 */
  customTargets: readonly CustomTarget[]
}

export interface ErrorReason {
  code: CoreErrorCode | 'INPUT' | 'WHITE_HERB_MULTIHIT' | 'TARGET_MISMATCH'
  /** 코어 오류의 field(예: 'sp.atk', 'defender.ability', 'move') */
  field?: string
  message: string
}

export type TabStatus = { kind: 'ok' } | { kind: 'my-set-error'; reasons: readonly ErrorReason[] }

/** 행·카드가 되지 않는 기술의 안내(분류가 능력치에 따라 바뀌는 기술 — 셸암즈). 요약·외 k행에 세지 않는다 */
export interface MoveNotice {
  kind: 'category-varies'
  moveId: string
  owner: 'me' | 'opponent'
}

export interface MetaSourceView {
  match: MatchType
  month: string
  cutoff: number
  format: string
}

// ---------- 계획(planTab 출력) ----------

export type RowKind = 'base' | 'rank' | 'scarf' | 'non-scarf'

export interface RankBasis {
  kind: 'rank'
  means: { kind: 'ability' | 'move'; id: string }
  owner: 'me' | 'opponent'
  /** 래더 상대 수단의 분포 점유율(0~1). 내 세트 수단·목록 밖 타겟(사용자 지정) 수단이면 없음 */
  share?: number
  /** 반응까지 적용한 최종 랭크(0인 능력치는 생략) */
  myBoosts: BoostTable
  opponentBoosts: BoostTable
  /** 발동한 반응 특성·도구 id(적용 순서) */
  reactions: readonly string[]
}
export interface ScarfBasis {
  kind: 'scarf' | 'non-scarf'
  /** 메타 도구 키(NO_ITEM = 'nothing' 포함) */
  item: string
  /** 그 도구의 분포 점유율 */
  share: number
}

export interface RowSpec {
  /** 탭 계획 안에서 유일 */
  id: string
  cardId: string
  kind: RowKind
  /** 카드 안 정렬 순번(0부터) */
  order: number
  judge: 'damage' | 'speed'
  /** 스피드 탭은 없음 */
  moveId?: string
  /** 내 쪽 스윕 대상. error 행이면 없음 */
  sweep?: { side: 'attacker' | 'defender'; stat: StatId }
  /** 랭크·도구 변형까지 적용한 확정 세트. 내 세트는 계획 시점 SP */
  attacker: PokemonSet
  defender: PokemonSet
  conditions: BattleConditions
  refs?: MoveStatRefs
  /** 내 능력치 중 이 행 판정이 의존하는 것(스윕 능력치 제외). 드래그 갱신 대기 판정 기준 */
  dependsOn: readonly StatId[]
  basis?: RankBasis | ScarfBasis
  /** 방어 탭: 이 극단 필터를 통과해야 행 작업이 생긴다 */
  gate?: string
  /** 계획 단계에서 확정된 계산 불가(하양허브 연속기 등) */
  error?: ErrorReason
}

export interface ExtremeSpec {
  id: string
  cardId: string
  moveId: string
  /** 카드 안 순번(상대 기술 사용률 순 → 랭크 행) */
  order: number
  /** 상대(공격측, 랭크 적용) */
  attacker: PokemonSet
  /** 내 세트(방어측, 랭크 적용) */
  defender: PokemonSet
  conditions: BattleConditions
  /** 함께 0 / 함께 최대로 덮어쓸 내 능력치 */
  stats: readonly ['hp', 'def' | 'spd']
  dependsOn: readonly StatId[]
  basis?: RankBasis
}

/** 내 SP와 무관한 기술(공격 탭 내 속임수). 고정 판정 1회 */
export interface FixedSpec {
  id: string
  cardId: string
  moveId: string
  attacker: PokemonSet
  defender: PokemonSet
  conditions: BattleConditions
}

export interface BundleStat {
  stat: StatId
  sp: number
  nature: 'plus' | 'neutral' | 'minus'
}
export interface BundleSpec {
  /** 정규화 키(JSON.stringify(stats)) */
  key: string
  /** 묶음 키 능력치만(카드에 보이는 관련 SP) */
  stats: readonly BundleStat[]
  /** 래더만: 묶음 점유율(보존 배분 점유율 합) */
  share?: number
  /** 래더만: 그 종 spreads.keptShare */
  retention?: number
  minority: boolean
  /** 래더만: 대표 보존 배분 키 */
  representativeSpread?: string
  /** 커스텀만 */
  presetIndex?: PresetIndex
}

/** 이름은 화면이 src/ui 이름 색인으로 id에서 만든다 */
export interface OpponentHeader {
  /** 로스터 종·폼 id(메가는 메가 폼 id) */
  id: string
  source: 'ladder' | 'custom'
  /** 래더만 */
  rank?: number
  usage?: number
}

export interface CardSpec {
  id: string
  /** 탭 안 정렬 순번 */
  order: number
  opponent: OpponentHeader
  category: Category | null
  bundle: BundleSpec
  /** 대표 세트(관측 배분 가정 또는 커스텀 프리셋). error 카드면 해석에 실패한 원 세트 */
  opponentSet: PokemonSet
  state: 'ok' | 'error'
  error?: ErrorReason
  /** 상대 기술의 분류 가변 안내(방어 탭). 카드 머리에 문구로만 보인다 */
  notices: readonly MoveNotice[]
  rowIds: readonly string[]
  filterIds: readonly string[]
  fixedIds: readonly string[]
}

export interface TabPlan {
  tab: Tab
  game: Snapshot
  status: TabStatus
  source: MetaSourceView
  /** 계획 시점 내 SP(조립의 갱신 대기 기준) */
  mySp: SpTable
  /** 이 탭에서 내 세트가 서는 쪽(공격·스피드 탭 attacker, 방어 탭 defender) */
  mySide: 'attacker' | 'defender'
  spTotal: number
  spMaxPerStat: number
  /** 정렬 완료 */
  cards: readonly CardSpec[]
  rows: Readonly<Record<string, RowSpec>>
  filters: Readonly<Record<string, ExtremeSpec>>
  fixed: Readonly<Record<string, FixedSpec>>
  /** 메타 목록 안에 있어 목록 밖 타겟으로 받지 않은 rosterId */
  customTargetConflicts: readonly string[]
  /** 내 기술의 분류 가변 안내(탭 안내) */
  notices: readonly MoveNotice[]
}

// ---------- 행 작업과 결과 ----------

export type RowTask =
  | { kind: 'ends'; rowId: string }
  | { kind: 'sweep'; rowId: string; stage: 2 | 3 }
  | { kind: 'extreme'; filterId: string }
  | { kind: 'fixed'; fixedId: string }

/** 예산 무시 판정만 담은 축약 칸. 예산 밖 표시는 담지 않는다(조립이 계산). 난수 배열 없음 */
export interface CompactCell {
  sp: number
  category: string
  immune?: true
  /** 대미지 칸만 */
  ohkoChance?: number
  minPercent?: number
  maxPercent?: number
  /** 스피드 칸만(앱 최종 스피드) */
  mySpeed?: number
  opponentSpeed?: number
}

export type RowTaskResult =
  | { kind: 'ends'; rowId: string; low: CompactCell; high: CompactCell }
  | { kind: 'sweep'; rowId: string; cells: readonly CompactCell[] }
  | { kind: 'extreme'; filterId: string; low: CompactCell; high: CompactCell }
  | { kind: 'fixed'; fixedId: string; cell: CompactCell }
  | { kind: 'error'; task: RowTask; reason: ErrorReason }

/** 키 = taskKey(task). sweep은 stage와 무관하게 같은 키 */
export type ResultMap = ReadonlyMap<string, RowTaskResult>

export interface PendingTasks {
  /** 극단 필터·양 끝·고정 판정(카드 순 → 행 순) */
  stage1: readonly RowTask[]
  /** 양 끝 판정이 다른 행의 스윕 */
  stage2: readonly RowTask[]
  /** 양 끝 판정이 같은 행의 확인 스윕 */
  stage3: readonly RowTask[]
}

export interface JudgementCache {
  get(key: string): readonly CompactCell[] | undefined
  set(key: string, cells: readonly CompactCell[]): void
  clear(): void
  readonly size: number
}

// ---------- 탭 뷰(assembleTab 출력) ----------

export interface CellView extends CompactCell {
  overBudget: boolean
  /** 다른 능력치에서 빼야 할 SP n(0이면 붙이지 않음) */
  need: number
}
export interface BoundaryView {
  sp: number
  from: string
  to: string
  /** sp − 표시용 현재 SP(0 이하면 아래쪽) */
  delta: number
  need: number
}
export interface RowView {
  id: string
  kind: RowKind
  order: number
  moveId?: string
  sweepStat?: StatId
  /** 기술 분류와 참조가 다를 때 표기용(예: 사이코쇼크 → 상대 def) */
  refs?: MoveStatRefs
  basis?: RankBasis | ScarfBasis
  /** pending = 판정 전, stale = 드래그로 낡음(칸·경계는 계획 시점 값 그대로) */
  status: 'ok' | 'stale' | 'error' | 'pending'
  error?: ErrorReason
  /** 커스텀 카드에서만 true(전 칸 같음, 또는 극단 필터에 걸린 기술) */
  noChange: boolean
  /** 33칸(스윕이 끝난 ok/stale 행만, 아니면 빈 배열) */
  cells: readonly CellView[]
  /** 표시용 현재 SP와 그 칸 범주(칸이 없으면 category 없음) */
  current: { sp: number; category?: string }
  boundaries: readonly BoundaryView[]
  nearest: { up?: BoundaryView; down?: BoundaryView }
}
export type Headline =
  | { kind: 'row'; rowId: string }
  | { kind: 'error'; reason: ErrorReason }
  | { kind: 'updating' }
  /** 커스텀 카드: 모든 행이 변화 없음. fixed는 고정 범주 목록 */
  | { kind: 'no-change'; fixed: readonly string[] }
export interface CardView {
  id: string
  order: number
  state: 'ok' | 'error'
  error?: ErrorReason
  notices: readonly MoveNotice[]
  opponent: OpponentHeader
  category: Category | null
  bundle: BundleSpec
  /** 표시 행(기본·랭크·스카프·계산 불가 + 커스텀이면 변화 없음 행), 카드 안 순서 */
  rows: readonly RowView[]
  /** 래더 카드 안에서 뺀 변화 없음 행 수 */
  hiddenNoChangeRows: number
  headline: Headline
  /** 외 k행(0이면 생략) */
  moreRows: number
}
export type NoChangeKind = 'row' | 'extreme-filter' | 'sp-independent'
export interface NoChangeItem {
  cardId: string
  opponent: OpponentHeader
  category: Category | null
  kind: NoChangeKind
  rowKind?: RowKind
  moveId?: string
  sweepStat?: StatId
  basis?: RankBasis | ScarfBasis
  /** 고정 범주(극단 필터는 두 극단의 같은 범주) */
  fixed: string
}
export interface NoChangeSummary {
  /** 행 N개(극단 필터·내 SP 무관 항목은 1건 = 1행) */
  rows: number
  /** 카드 M장(표시 행이 하나도 남지 않은 래더 카드 수) */
  cards: number
  items: readonly NoChangeItem[]
}
export interface TabView {
  tab: Tab
  status: TabStatus
  source: MetaSourceView
  /** 정렬 완료, 표시 대상만 */
  cards: readonly CardView[]
  noChange: NoChangeSummary
  progress: { done: number; total: number }
  /** 1·2단계 완료(잠정 빈 상태 판정 기준) */
  stage12Done: boolean
  /** 3단계까지 완료(false면 요약에 "확인 중") */
  complete: boolean
  customTargetConflicts: readonly string[]
  /** 내 기술의 분류 가변 안내(탭 안내) */
  notices: readonly MoveNotice[]
}
