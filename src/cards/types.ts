// 카드 모델 공유 계약. React·브라우저 API를 import하지 않는다.
import { ROLL_DENOMINATOR } from '../core'
import type { BattleConditions, BoostTable, CoreErrorCode, MoveStatRefs, PokemonSet, RollTier, SpTable } from '../core'
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

/** 1타 확률 기준의 분모(16단계 난수, 코어 ROLL_DENOMINATOR). 화면 기준 입력은 1~ROLL_STEPS−1의 정수 n이다 */
export const ROLL_STEPS = ROLL_DENOMINATOR
/** 제품 기본 "고난수 기준" n: 고난수1타 = 14/16 이상, 저난수1타 = 2/16 이하(코어 rollTier) */
export const DEFAULT_ROLL_STEPS = 14

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
  /** 고난수 기준 n(1~ROLL_STEPS−1 정수). 모든 대미지 칸 범주가 코어 rollTier(p, n) 5단 판정이다(코어 normalizeRollSteps로 검증) */
  rollSteps: number
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

/**
 * 행·카드가 되지 않는 기술의 안내. 요약·외 k행에 세지 않는다.
 * category-varies: 분류가 능력치에 따라 바뀌는 기술(셸암즈, 내 것·상대 것).
 * attacker-hp-dependent: 대미지가 내 HP로 정해지는 기술(목숨걸기, 공격 탭 내 기술만 — 상대 것은 묶음 키에 상대 H를 넣어 계산한다).
 */
export interface MoveNotice {
  kind: 'category-varies' | 'attacker-hp-dependent'
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
  /** 노출·목표에 쓰는 내 성격 변형(스윕 행만, 방어 탭은 그 필터와 같은 값) */
  natures?: NatureVariants
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
  /** 낮은 극단 = H0·B/D0·neutral, 높은 극단 = H최대·B/D최대·plus */
  natures: NatureVariants
  dependsOn: readonly StatId[]
  basis?: RankBasis
}

/**
 * 내 성격 변형 2종(실제 성격 id). stat = 상승 대상(공격·스피드 탭 스윕 능력치, 방어 탭 B/D).
 * neutral: stat 보정 없음, plus: stat 상승·하락은 판정에 관여하지 않는 능력치. 현재 성격이 그 조건이면 현재 성격 id 그대로.
 */
export interface NatureVariants {
  stat: Exclude<StatId, 'hp'>
  neutral: string
  plus: string
}
export type NatureVariant = 'neutral' | 'plus'
export const NATURE_VARIANTS: readonly NatureVariant[] = ['neutral', 'plus']

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
  /** 검증한 고난수 기준 n. 모든 대미지 행 작업 판정(rollTier)과 캐시 키에 쓴다 */
  rollSteps: number
  spTotal: number
  spMaxPerStat: number
  /** 정렬 완료 */
  cards: readonly CardSpec[]
  rows: Readonly<Record<string, RowSpec>>
  filters: Readonly<Record<string, ExtremeSpec>>
  fixed: Readonly<Record<string, FixedSpec>>
  /** 메타 목록 안에 있어 목록 밖 타겟으로 받지 않은 rosterId */
  customTargetConflicts: readonly string[]
  /** 내 기술의 계산하지 않음 안내(분류 가변·내 HP 의존, 탭 안내) */
  notices: readonly MoveNotice[]
}

// ---------- 행 작업과 결과 ----------

export type RowTask =
  /** 현재 성격 0·최대 + 변형 범위 끝(neutral 0·plus 최대) */
  | { kind: 'ends'; rowId: string }
  | { kind: 'sweep'; rowId: string; stage: 2 | 3 }
  | { kind: 'extreme'; filterId: string }
  | { kind: 'fixed'; fixedId: string }
  /** 성격 변형 스윕(그 변형이 현재 성격과 같으면 만들지 않는다) */
  | { kind: 'variant'; rowId: string; nature: NatureVariant }
  /** 방어 탭: 극단 필터(= 같은 기술·랭크 조건의 H행·B/D행 쌍)의 성격 변형별 H·B/D 최소 조합 */
  | { kind: 'pair'; filterId: string; nature: NatureVariant }

/**
 * 방어 2축 최소 조합 한 점. atLeast 이상 판정을 내는 (H, B/D) 중 SP 합이 최소, 동률이면 H가 큰 것.
 * label은 그 점의 실제 판정(atLeast보다 좋을 수 있다). 예산 무시 평가.
 */
export interface PairPoint {
  atLeast: RollTier
  label: RollTier
  hp: number
  /** 극단 필터 stats[1](def 또는 spd)의 SP */
  defense: number
}

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
  /** low·high = 현재 성격 0·최대, range = neutral 0·plus 최대(변형까지 합친 판정 범위의 양 끝) */
  | { kind: 'ends'; rowId: string; low: CompactCell; high: CompactCell; range: { low: CompactCell; high: CompactCell } }
  | { kind: 'sweep'; rowId: string; cells: readonly CompactCell[] }
  | { kind: 'variant'; rowId: string; nature: NatureVariant; cells: readonly CompactCell[] }
  | { kind: 'extreme'; filterId: string; low: CompactCell; high: CompactCell }
  | { kind: 'fixed'; fixedId: string; cell: CompactCell }
  /** points: 5단 방어 순위(나쁨 → 좋음) 중 SP 0~최대 안에서 가능한 것만, 순위 순 */
  | { kind: 'pair'; filterId: string; nature: NatureVariant; points: readonly PairPoint[] }
  | { kind: 'error'; task: RowTask; reason: ErrorReason }

/** 키 = taskKey(task). sweep은 stage와 무관하게 같은 키, variant·pair는 성격 변형마다 다른 키 */
export type ResultMap = ReadonlyMap<string, RowTaskResult>

export interface PendingTasks {
  /** 극단 필터·양 끝·고정 판정(카드 순 → 행 순) */
  stage1: readonly RowTask[]
  /** 양 끝 판정이 다른 행의 스윕 */
  stage2: readonly RowTask[]
  /** 양 끝 판정이 같은 행의 확인 스윕 */
  stage3: readonly RowTask[]
  /** 성격 변형 스윕(양 끝이 나온 행, 현재 성격과 같은 변형 제외) */
  stage4: readonly RowTask[]
  /** 방어 쌍 최소 조합 × 성격 변형(필터 통과·두 행의 현재·변형 스윕 완료·둘 중 하나라도 변화 있는 쌍) */
  stage5: readonly RowTask[]
}

/** 캐시 값. 키에 작업 종류가 들어가 pair 키에는 PairPoint[], 그 밖에는 CompactCell[]만 담긴다(variant는 sweep과 같은 키 공간) */
export type CachedJudgement = readonly CompactCell[] | readonly PairPoint[]

export interface JudgementCache {
  get(key: string): CachedJudgement | undefined
  set(key: string, value: CachedJudgement): void
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
  /** 커스텀 카드에서만 true(현재·무보정·상승 성격 칸이 모두 같음, 또는 극단 필터에 걸린 기술) */
  noChange: boolean
  /** 33칸(스윕이 끝난 ok/stale 행만, 아니면 빈 배열) */
  cells: readonly CellView[]
  /** 표시용 현재 SP와 그 칸 범주(칸이 없으면 category 없음) */
  current: { sp: number; category?: string }
  boundaries: readonly BoundaryView[]
  nearest: { up?: BoundaryView; down?: BoundaryView }
  /** "<label>: 최소 A32 / A15+". 변화 있는 ok/stale 행만, 성격 변형 결과(방어 탭은 쌍 결과)가 나온 뒤에만 */
  target?: TargetView
}
export interface TargetStat {
  stat: StatId
  sp: number
}
export interface TargetOption {
  /** 그 최소 SP의 실제 판정(목표 순위보다 좋을 수 있다). 공격·방어 탭 RollTier, 스피드 탭 SpeedOrder */
  label: string
  /** 공격·스피드 탭은 스윕 능력치 하나, 방어 탭은 [hp, def|spd] */
  stats: readonly TargetStat[]
  /** 다른 능력치에서 빼야 할 SP n = (stats SP 합 − 현재 그 능력치 SP 합) − 잔여 예산. 0이면 붙이지 않음 */
  need: number
}
export interface TargetView {
  /** 두 선택지의 실제 판정 중 낮은 쪽(둘 다 이 판정 이상을 보장) */
  label: string
  /** better: 현재보다 한 단계 이상 위. keep: 이미 최상위이거나 두 변형 모두 위가 SP 0~최대에서 불가능해 현재 판정 유지 최소값 */
  goal: 'better' | 'keep'
  /** 상승(+) 대상 능력치(공격·스피드 탭 스윕 능력치, 방어 탭 def|spd) */
  plusStat: Exclude<StatId, 'hp'>
  /** 무보정 성격 최소. SP 0~최대에서 목표 순위에 닿지 않으면 null("불가") */
  neutral: TargetOption | null
  /** 상승 성격 최소. 닿지 않으면 null. 둘 중 하나 이상은 null이 아니다 */
  plus: TargetOption | null
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
  /** 이 뷰를 계산한 고난수 기준 n(칸 범주·배지·목표가 같은 기준이다) */
  rollSteps: number
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
  /** 내 기술의 계산하지 않음 안내(분류 가변·내 HP 의존, 탭 안내) */
  notices: readonly MoveNotice[]
}
