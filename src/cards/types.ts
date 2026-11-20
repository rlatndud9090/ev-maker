// 카드 모델 공유 계약. React·브라우저 API를 import하지 않는다.
import { ROLL_DENOMINATOR } from '../core'
import type { BattleConditions, BoostTable, CoreErrorCode, MoveStatRefs, PokemonSet, RollTier, SpTable } from '../core'
import type { MatchType } from '../data/meta-schema'
import type { Snapshot, StatId } from '../data/schema'
import type { MetaView } from '../meta'
import type { Branch, CutLock, LockDerivation, LockResolution, LockStage, Stairs } from './lock'

export type Tab = 'attack' | 'defense' | 'speed'
export const TABS: readonly Tab[] = ['attack', 'defense', 'speed']
/** 실행기가 행 작업으로 계산하는 탭(스피드 탭은 스피드 차트 모델이 따로 계산한다) */
export type DamageTab = Exclude<Tab, 'speed'>
export const DAMAGE_TABS: readonly DamageTab[] = ['attack', 'defense']
export const isDamageTab = (tab: Tab): tab is DamageTab => tab !== 'speed'
/** 참조 방어 능력치 기준: def → physical, spd → special */
export type Category = 'physical' | 'special'
export const CATEGORY_ORDER: readonly Category[] = ['physical', 'special']

export interface DisplayCriteria {
  /** 묶음 점유율 기준(0~1, 이상이면 배분 선택지. 상한 없음) */
  bundleShareMin: number
  /** 상대 랭크 수단 점유율 기준(0~1, 이상) */
  rankShareMin: number
  /** 구애스카프 점유율 기준(0~1, 이상). 스피드 차트만 쓴다 */
  scarfShareMin: number
  /** 날씨·필드 ×2 특성 점유율 기준(0~1, 이상). 스피드 차트만 쓴다 */
  weatherShareMin: number
  /** 반감열매 점유율 기준(0~1, 이상이면 공격 탭에 그 열매를 지닌 별도 행) */
  berryShareMin: number
  /** 화력 도구 점유율 기준(0~1, 이상이면 방어 탭에 그 도구를 지닌 별도 행) */
  powerItemShareMin: number
}
export const DEFAULT_CRITERIA: Readonly<DisplayCriteria> = Object.freeze({
  bundleShareMin: 0.05,
  rankShareMin: 0.1,
  scarfShareMin: 0.05,
  weatherShareMin: 0.1,
  berryShareMin: 0.05,
  powerItemShareMin: 0.05,
})

export interface CardFilters {
  /** 사용률 상위 N마리(정수 ≥ 1) */
  topN: number
  /** 메타 항목 id. 비어 있으면 상위 N 보기 */
  selected: readonly string[]
}
export const DEFAULT_TOP_N = 100

/** 1타 확률 기준의 분모(16단계 난수, 코어 ROLL_DENOMINATOR). 화면 기준 입력은 1~ROLL_STEPS−1의 정수 n이다 */
export const ROLL_STEPS = ROLL_DENOMINATOR
/** 제품 기본 "고난수 기준" n: 고난수1타 = 14/16 이상, 저난수1타 = 2/16 이하(코어 rollTier) */
export const DEFAULT_ROLL_STEPS = 14

/** 스피드 차트 조건 필터 종류(조건 배지의 filterKind) */
export type SpeedConditionKind = 'rank' | 'scarf' | 'tailwind' | 'field'
export const SPEED_CONDITION_KINDS: readonly SpeedConditionKind[] = ['rank', 'scarf', 'tailwind', 'field']
export type SpeedConditionFilters = Readonly<Record<SpeedConditionKind, boolean>>
export const DEFAULT_SPEED_FILTERS: SpeedConditionFilters = Object.freeze({ rank: true, scarf: true, tailwind: false, field: true })
/** 상대 출처: ladder = 메타 항목, custom = 목록 밖 타겟 */
export type TargetSource = 'ladder' | 'custom'

/** 스피드 차트에 사용자가 더한 상대 배분(S SP·S 보정 부호만) */
export interface SpeedAddedBundle {
  source: TargetSource
  /** 출처별 id(ladder = 메타 항목 id, custom = rosterId) */
  opponentId: string
  sp: number
  nature: BundleStat['nature']
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

/** 키 능력치별 성격 보정 부호. 없는 능력치는 무보정 */
export type KeySigns = Readonly<Partial<Record<StatId, BundleStat['nature']>>>

/**
 * 사용자가 직접 추가한 상대 배분.
 * sp 키 = 그 (탭, 분류) 카드의 묶음 키 능력치 전부(각 0~spMaxPerStat 정수).
 * nature = 키 능력치별 보정 부호(없으면 전부 무보정). 부호 규칙은 validKeySigns.
 */
export interface AddedBundle {
  tab: Tab
  source: TargetSource
  /** 출처별 id(ladder = 메타 항목 id, custom = rosterId) */
  opponentId: string
  category: Category | null
  sp: Readonly<Partial<Record<StatId, number>>>
  nature?: KeySigns
}

/** 방어 탭 래더 상대 후보에 사용자가 더한 기술. 기본 후보 기준과 무관하게 후보다(스냅샷에 없거나 변화기면 무시) */
export interface AddedMove {
  /** 래더 메타 항목 id */
  opponentId: string
  moveId: string
}

/**
 * 사용자가 고정한 상대 배분(목록 맨 위, 고정한 순서). key = 그 카드 묶음의 정규화 키(BundleSpec.key).
 * 직접 추가 배분도 추가와 함께 고정된다(키 = addedBundleKey). 고정은 계산 입력이 아니다(정렬·표시만 바꾼다).
 */
export interface PinnedBundle {
  tab: Tab
  source: TargetSource
  /** 출처별 id(ladder = 메타 항목 id, custom = rosterId) */
  opponentId: string
  category: Category | null
  key: string
  /** 반감열매 행(공격 탭 열매 변형)의 고정이면 그 열매 id. 기본 행 고정은 없음 */
  item?: string
}

export interface CardInput {
  game: Snapshot
  view: MetaView
  /** 검증 전 그대로. 무효면 탭 상태가 my-set-error */
  mySet: PokemonSet
  /** 고난수 기준 n(1~ROLL_STEPS−1 정수). 모든 대미지 칸 범주가 코어 rollTier(p, n) 5단 판정이다(코어 normalizeRollSteps로 검증) */
  rollSteps: number
  criteria: DisplayCriteria
  filters: CardFilters
  /** 추가한 순서 */
  customTargets: readonly CustomTarget[]
  /** 사용자 추가 배분(추가 순). 없으면 빈 배열 */
  addedBundles?: readonly AddedBundle[]
  /** 사용자가 추가한 상대 기술(방어 탭 래더 상대 전용, 추가 순). 없으면 빈 배열 */
  addedMoves?: readonly AddedMove[]
  /** 컷 고정 계획. 없으면 고정 없는 기존 경로 그대로다 */
  lock?: PlanLock
}

/**
 * 컷 고정 계획 방식. 둘 다 내 세트 합계 검사를 끈다. lane = 고정 대상 해석용 미니 계획(행 성격은 laneNature),
 * main = 기준 갈래 값이 이미 mySet에 적힌 탭 계획(행 성격은 rowNature, lockLane.lockedInput이 만든다).
 */
export type PlanLock = { mode: 'lane' } | { mode: 'main'; derivation: LockDerivation; base: Branch }

export interface ErrorReason {
  code: CoreErrorCode | 'INPUT' | 'WHITE_HERB_MULTIHIT' | 'TARGET_MISMATCH'
  /** 코어 오류의 field(예: 'sp.atk', 'defender.ability', 'move') */
  field?: string
  message: string
}

export type TabStatus = { kind: 'ok' } | { kind: 'my-set-error'; reasons: readonly ErrorReason[] }

/**
 * 행·카드가 되지 않는 기술의 안내. 외 k행에 세지 않는다.
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

export type RowKind = 'base' | 'rank'

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

export interface RowSpec {
  /** 탭 계획 안에서 유일 */
  id: string
  cardId: string
  kind: RowKind
  /** 카드 안 정렬 순번(0부터) */
  order: number
  judge: 'damage'
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
  basis?: RankBasis
  /** 방어 탭: 이 극단 필터를 통과해야 행 작업이 생긴다 */
  gate?: string
  /** 노출·목표에 쓰는 내 성격 변형(스윕 행만, 방어 탭은 그 필터와 같은 값) */
  natures?: NatureVariants
  /** 계획 단계에서 확정된 계산 불가(하양허브 연속기 등) */
  error?: ErrorReason
  /** 고정 계획의 스윕 행만 */
  lock?: RowLockSpec
}

/**
 * 고정 계획의 행·극단 필터 성격. nature = 그 행 세트에 쓴 행 성격, strict = 보는 능력치 v의 엄격 변형(plus null = 이 갈래에서 v 상승 불가,
 * 이때 NatureVariants.plus에는 neutral id가 들어 있고 상승 변형 작업은 만들지 않는다). viewLocked = v(방어는 H 또는 B/D)가 고정 능력치.
 */
export interface RowLockSpec {
  nature: string
  /** 행 관여 능력치 밖에 하락 자리가 없어 갈래 성격 그대로 판정함 */
  dropWarning?: true
  strict: { neutral: string; plus: string | null }
  viewLocked: boolean
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
  /** 고정 계획만. 그 필터의 H·B/D 행과 같은 값 */
  lock?: RowLockSpec
}

/**
 * 내 성격 변형 2종(실제 성격 id). stat = 상승 대상(공격 탭 스윕 능력치, 방어 탭 B/D).
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
  /** 사용자가 직접 추가한 배분(점유율 없음). 값은 addedBundles 안 추가 순번(0부터) */
  userAdded?: number
}

/** 이름은 화면이 src/ui 이름 색인으로 id에서 만든다 */
export interface OpponentHeader {
  /** 로스터 종·폼 id(메가는 메가 폼 id) */
  id: string
  source: TargetSource
  /** 래더만 */
  rank?: number
  usage?: number
  /** 래더만: 표시 범위 밖이지만 그 탭에 사용자 추가 배분이 있어 그 배분 카드만 나온 상대. 카드·그룹 id에는 들지 않는다 */
  addedOnly?: true
}

/**
 * 카드 안 조건 하나(기본 상태·랭크 수단 조건)의 기술 후보 = 기술 선택 목록의 항목 하나(items.ts).
 * 카드는 보이는 항목(사용자가 고른 것, 없으면 기본 항목) 하나의 행만 낸다. 기본 항목 결정에 필요한 항목과 보이는 항목에만 행 작업이 생긴다.
 */
export interface MoveCandidate {
  /** row = 공격 탭 스윕 행(계획 단계 계산 불가 행 포함), filter = 방어 탭 극단 필터(H행·B/D행 쌍), fixed = 공격 탭 내 SP 무관 판정 */
  target: 'row' | 'filter' | 'fixed'
  /** rowId·filterId·fixedId */
  id: string
  moveId: string
  /** 우선도 > 0 기술(방어 탭 선공기 우선 규칙) */
  priority: boolean
  /** 기술 채용률(PRD R16): 방어 탭 래더 상대 = 그 상대 기술 사용률, 공격 탭 = 내 종(메가면 메가 항목, 없으면 원종) 메타 기술 사용률. 통계에 없으면 0 */
  share: number
  /** 기존 기술 순서: 그 상대의 모든 분류 후보 기술 중 순번(공격 탭 내 기술 칸 순, 방어 탭 상대 후보 순·목록 밖 타겟 지정 순, 계산 불가 기술은 뒤) */
  order: number
  /** 주력 기술(PRD R4-1): 공격 탭 내 기술 전부, 방어 탭 items.mainMoves(선공기 제외·채용률 하한, 분류 카드를 가로질러 정함) */
  main: boolean
  /** 사용자가 추가한 상대 기술(방어 탭 래더 상대, CardInput.addedMoves) */
  added?: true
}
export interface ConditionGroup {
  /** 카드 안 유일: JSON.stringify(['base']), ['faint', 1|2|3](성묘 위력 조건, ids.faintConditionId) 또는 ['rank', owner, means.kind, means.id] */
  id: string
  /** 기존 순서(공격 탭 내 기술 슬롯 순, 방어 탭 상대 기술 사용률 순). 동률이면 앞이 이긴다 */
  candidates: readonly MoveCandidate[]
}

/** 상대 도구 변형: 공격 탭 반감열매·방어 탭 화력 도구를 지닌 가정(래더 기본 카드는 상대 도구 없음). 화면에서 별도 행이다 */
export interface BerryVariant {
  /** 도구 id(반감열매 또는 화력 도구) */
  item: string
  /** 그 도구의 분포 점유율 */
  share: number
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
  /** 조건별 기술 후보 = 기술 선택 항목(error 카드는 빈 배열) */
  conditions: readonly ConditionGroup[]
  /**
   * 도구 변형 카드만(이름은 반감열매에서 왔고 방어 탭 화력 도구도 쓴다). triggers = 이 카드 대표 세트에서 그 도구가 관여하는 기술 id
   * (공격 탭: 열매가 발동하는 내 기술, berryActivates. 방어 탭: 화력 도구가 보정을 주는 상대 기술, powerItemBoosts).
   * 조립은 보이는 항목의 기술이 triggers에 없으면 이 카드를 보이지 않는다(도구가 판정에 관여하지 않으면 별도 행일 필요가 없다)
   */
  berry?: BerryVariant & { triggers: readonly string[] }
  /**
   * 방어 탭만: 상대 대표 세트를 스피드 SP 최대·스피드 상승 성격으로 바꾸고 구애스카프를 빼도(랭크·순풍 없이) 내 현재 스피드보다 엄격히 느림.
   * 참이면 기본 항목에 선공기 우선 규칙을 쓴다(items.resolveDefault)
   */
  speedEdge?: boolean
}

export interface TabPlan {
  tab: DamageTab
  game: Snapshot
  status: TabStatus
  source: MetaSourceView
  /** 계획 시점 내 SP(조립의 갱신 대기 기준) */
  mySp: SpTable
  /** 이 탭에서 내 세트가 서는 쪽(공격 탭 attacker, 방어 탭 defender) */
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
  /** 고정 계획만(CardInput.lock이 있을 때) */
  lock?: TabPlanLock
}

/** overTotal = 계획 세트 SP 합 − spTotal(0 이상, main은 derivation.overTotal 그대로) */
export type TabPlanLock = { mode: 'lane'; overTotal: number } | { mode: 'main'; derivation: LockDerivation; base: Branch; overTotal: number }

/** 갈래 재스윕·계단에서 계획 세트 대신 쓰는 내 능력치 SP(그 갈래 고정 SP 중 판정에 관여하는 것만) */
export type SpOverride = Readonly<Partial<Record<StatId, number>>>

// ---------- 행 작업과 결과 ----------

export type RowTask =
  /** 후보 기술의 현재 세트(계획 시점 SP·성격) 단건 판정. 목록 배지·정렬·기본 항목 결정용 */
  | { kind: 'probe'; target: 'row' | 'filter'; id: string }
  /** 현재 성격 0·최대 + 변형 범위 끝(neutral 0·plus 최대) */
  | { kind: 'ends'; rowId: string }
  | { kind: 'sweep'; rowId: string; stage: 2 | 3 }
  | { kind: 'extreme'; filterId: string }
  | { kind: 'fixed'; fixedId: string }
  /** 성격 변형 스윕(그 변형이 현재 성격과 같으면 만들지 않는다) */
  | { kind: 'variant'; rowId: string; nature: NatureVariant }
  /** 방어 탭: 극단 필터(= 같은 기술·랭크 조건의 H행·B/D행 쌍)의 성격 변형별 H·B/D 최소 조합 */
  | { kind: 'pair'; filterId: string; nature: NatureVariant }
  /** 고정 계획: 극단 필터의 성격 id·방어 순위(tierRank 'defense') 계단, H는 hpMin~최대만 */
  | { kind: 'stairs'; filterId: string; nature: string; rank: number; hpMin: number; sp?: SpOverride }
  /** 고정 계획: 행을 성격 id로 33칸 스윕(variant와 같은 계산) */
  | { kind: 'branch'; rowId: string; nature: string; sp?: SpOverride }

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
}

export type RowTaskResult =
  | { kind: 'probe'; id: string; cell: CompactCell }
  /** low·high = 현재 성격 0·최대, range = neutral 0·plus 최대(변형까지 합친 판정 범위의 양 끝) */
  | { kind: 'ends'; rowId: string; low: CompactCell; high: CompactCell; range: { low: CompactCell; high: CompactCell } }
  | { kind: 'sweep'; rowId: string; cells: readonly CompactCell[] }
  | { kind: 'variant'; rowId: string; nature: NatureVariant; cells: readonly CompactCell[] }
  | { kind: 'extreme'; filterId: string; low: CompactCell; high: CompactCell }
  | { kind: 'fixed'; fixedId: string; cell: CompactCell }
  /** points: 5단 방어 순위(나쁨 → 좋음) 중 SP 0~최대 안에서 가능한 것만, 순위 순 */
  | { kind: 'pair'; filterId: string; nature: NatureVariant; points: readonly PairPoint[] }
  | { kind: 'stairs'; filterId: string; nature: string; rank: number; hpMin: number; stairs: Stairs | 'non-monotonic' }
  | { kind: 'branch'; rowId: string; nature: string; cells: readonly CompactCell[] }
  | { kind: 'error'; task: RowTask; reason: ErrorReason }

/** 키 = taskKey(task). sweep은 stage와 무관하게 같은 키, variant·pair는 성격 변형마다 다른 키 */
export type ResultMap = ReadonlyMap<string, RowTaskResult>

export interface PendingTasks {
  /** 후보 단건 판정·고정 판정, 고른 후보의 극단 필터·양 끝(카드 순 → 행 순) */
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

/** 캐시 값. 키에 작업 종류가 들어가 pair 키에는 PairPoint[], stairs 키에는 StairsValue, 그 밖에는 CompactCell[]만 담긴다(variant·branch는 sweep과 같은 키 공간) */
export type CachedJudgement = readonly CompactCell[] | readonly PairPoint[] | StairsValue
export interface StairsValue {
  stairs: Stairs | 'non-monotonic'
}

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
  /** 판정에서 실제 쓰는 기술 타입(공격측 특성·날씨·필드 반영, attackMoveType). 스냅샷에 없는 기술이면 없음 */
  moveType?: string
  /** 판정 조건이 덮어쓴 기술 위력(성묘 쓰러진 아군 수, conditionMovePower). 라벨에 "(위력)"으로 붙는다 */
  power?: number
  sweepStat?: StatId
  /** 기술 분류와 참조가 다를 때 표기용(예: 사이코쇼크 → 상대 def) */
  refs?: MoveStatRefs
  basis?: RankBasis
  /** pending = 판정 전, stale = 드래그로 낡음(칸·경계는 계획 시점 값 그대로) */
  status: 'ok' | 'stale' | 'error' | 'pending'
  error?: ErrorReason
  /**
   * 내 SP(0~최대)·성격(무보정·상승)을 바꿔도 판정이 같음(변형 범위 끝·변형 스윕 칸이 모두 같은 범주, 또는 극단 필터에 걸린 기술·내 SP 무관 판정).
   * false = "변동 가능". 변형 스윕이 끝나기 전에는 현재까지의 결과로 잠정 판정한다(그때 true면 provisional).
   */
  noChange: boolean
  /** 잠정 변화 없음: noChange가 true지만 성격 변형 스윕이 아직 남아 "변동 가능"으로 바뀔 수 있다(고정 판정으로 보이지 않고, 대표로 세우지 않는다) */
  provisional?: true
  /** 33칸(스윕이 끝난 ok/stale 행만, 아니면 빈 배열) */
  cells: readonly CellView[]
  /** 표시용 현재 SP와 그 칸 범주(칸이 없으면 category 없음) */
  current: { sp: number; category?: string }
  boundaries: readonly BoundaryView[]
  nearest: { up?: BoundaryView; down?: BoundaryView }
  /** "<label>: 최소 A32 / A15+". 변화 있는 ok/stale 행만, 성격 변형 결과(방어 탭은 쌍 결과)가 나온 뒤에만 */
  target?: TargetView
  /**
   * 도달 가능한 최선 판정: 내 SP 0~최대 × 성격(무보정·상승, 예산 무시 — 칸 표기와 같은 기준)에서 그 탭 관점 가장 유리한 판정
   * (RollTier). 변화 있는 ok·stale 행만. 방어 쌍 행(극단 필터 통과)은 높은 극단(H·B/D 최대·상승),
   * 그 밖은 변형 범위 끝·현재·변형 스윕 칸 중 최선이며 성격 변형 스윕이 다 나온 뒤에만 붙는다. 판정을 다시 하지 않고 이미 나온 칸에서 고른다.
   */
  best?: string
  /** 칸이 없는 내 SP 무관 판정 행(공격 탭 속임수)의 판정 칸(결과 배지용) */
  fixedCell?: CompactCell
  /** 고정 계획만(방어 쌍은 CardView.pair.lock) */
  lock?: RowLockView
}

/** 판정 행·방어 쌍의 컷 고정 표시 */
export interface RowLockView {
  control?: LockControl
  /** 이 컷을 대상으로 하는 고정의 seq */
  lockedBy?: readonly number[]
  dropWarning?: true
}

/** 고정 조작: 그 탭의 고정 가능 단계 전부(LOCK_STAGES 순, 현재 판정과 무관)의 후보, 또는 컷 전체가 고정 불가인 이유 */
export type LockControl = { kind: 'lockable'; stages: readonly LockStageCandidate[] } | { kind: 'blocked'; reason: 'depends-other-stat' | 'fixed-value' | 'unreachable-stage' }

export interface LockStageCandidate {
  stage: LockStage
  candidate: LockCandidate
}

/**
 * 카드 줄 핀(고정 조작 문맥만). control = 보이는 컷(공격 행·방어 쌍)의 조작. pending = 그 컷의 판정이 아직 없음,
 * fixed-value = 보이는 판정이 SP와 무관(극단 필터 고정·고정 판정 행), unreachable-stage = SP로 결과가 바뀌어도 어느 고정 단계에도 닿지 않음, no-target = 고정할 판정 행이 없음(계산 불가 포함).
 * lockedBy = 이 카드의 모든 행·필터 컷에 걸린 고정 seq(보이는 기술이 아니어도)
 */
export interface CardLockPin {
  control: LockControl | { kind: 'pending' } | { kind: 'blocked'; reason: 'fixed-value' | 'no-target' }
  lockedBy?: readonly number[]
}

/** computing.tasks = 후보 해석에 아직 없는 행 작업(갈래 재스윕·고정 단계 계단, 핀 메뉴·조정 팝오버 수요로 계산한다) */
export type LockCandidate = { kind: 'ready'; lock: Omit<CutLock, 'seq'>; resolution: LockResolution } | { kind: 'computing'; tasks?: readonly RowTask[] }

export interface TargetStat {
  stat: StatId
  sp: number
}
export interface TargetOption {
  /** 그 최소 SP의 실제 판정(목표 순위보다 좋을 수 있다). RollTier */
  label: string
  /** 공격 탭은 스윕 능력치 하나, 방어 탭은 [hp, def|spd] */
  stats: readonly TargetStat[]
  /** 다른 능력치에서 빼야 할 SP n = (stats SP 합 − 현재 그 능력치 SP 합) − 잔여 예산. 0이면 붙이지 않음 */
  need: number
}
export interface TargetView {
  /** 두 선택지의 실제 판정 중 낮은 쪽(둘 다 이 판정 이상을 보장) */
  label: string
  /** better: 현재보다 한 단계 이상 위. keep: 이미 최상위이거나 두 변형 모두 위가 SP 0~최대에서 불가능해 현재 판정 유지 최소값 */
  goal: 'better' | 'keep'
  /** 상승(+) 대상 능력치(공격 탭 스윕 능력치, 방어 탭 def|spd) */
  plusStat: Exclude<StatId, 'hp'>
  /** 무보정 성격 최소. SP 0~최대에서 목표 순위에 닿지 않으면 null("불가") */
  neutral: TargetOption | null
  /** 상승 성격 최소. 닿지 않으면 null. 둘 중 하나 이상은 null이 아니다 */
  plus: TargetOption | null
}
/** 내구 합계 띠의 H·B/D 분배(defense = def 또는 spd SP) */
export interface SumSplit {
  hp: number
  defense: number
}
/** 합계 띠 범례 한 줄: from~to 합계에서 label, 그 단계에 처음 닿는 최소 분배와 다른 성격 변형의 같은 단계 최소 분배(닿지 않으면 null) */
export interface SumBandSpan {
  from: number
  to: number
  label: RollTier
  min: SumSplit
  alt: SumSplit | null
}
/** 방어 탭 내구 합계 띠(sumBandOf). 칸 sum = 0~max, label = 그 합계를 최적 분배했을 때의 최선 판정(nature 변형 기준) */
export interface SumBandView {
  defenseStat: 'def' | 'spd'
  nature: NatureVariant
  /** 현재 성격이 무보정·상승 어느 변형도 아니어서(B/D 하락) 무보정 기준으로 칠함 */
  fallback: boolean
  /** fallback일 때 이유: minus = 현재 성격이 B/D 하락, other = 그 밖(스냅샷에 없는 성격 id 등) */
  fallbackReason?: 'minus' | 'other'
  /** 합계 최대(2 × 능력치당 최대) */
  max: number
  cells: readonly { sum: number; label: RollTier }[]
  spans: readonly SumBandSpan[]
  /** 표시용 현재 분배·합계, 현재 분배 실제 판정, 같은 합계 최적이 더 좋으면 그 분배 */
  current: SumSplit & { sum: number; label?: RollTier; best?: { label: RollTier; split: SumSplit } }
}
export type Headline =
  | { kind: 'row'; rowId: string }
  | { kind: 'error'; reason: ErrorReason }
  | { kind: 'updating' }
  /** 대표로 세울 판정 행이 없음(안내만 있는 카드 등). fixed는 행들의 고정 범주 목록 */
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
  /** 도구 변형 카드(별도 행: 공격 탭 반감열매·방어 탭 화력 도구)면 그 도구 */
  berry?: BerryVariant
  /**
   * 보이는 항목의 판정 행(공격 탭 1행, 방어 탭 H행·B/D행 쌍 또는 극단 필터 고정 1줄, 계산 불가·판정 전 포함)
   */
  rows: readonly RowView[]
  /**
   * 대표 행: 변화 있는 행이 있으면 경계까지 SP 차이가 가장 작은 행, 없으면 첫 ok 행.
   * 판정 전·갱신 대기·잠정 변화 없음(provisional) 행이 있고 변화 있는 ok 행이 없으면 updating.
   */
  headline: Headline
  /** 보이는 항목 행 중 칸이 있는 ok·stale 변화 있는 행이 있음("변동 가능"). 대표 행과 따로 세어 드래그 중(updating)에도 유지된다 */
  variable: boolean
  /** 이 카드의 기술 선택 항목(기술 채용률 순, items.compareItems). error 카드는 빈 배열 */
  items: readonly ItemView[]
  /** 보이는 항목 키(기본 항목이 정해지기 전이고 사용자가 고르지 않았으면 없음) */
  shownItem?: string
  /** 기본 항목(정해진 뒤) */
  defaultItem?: DefaultItemView
  /** 보이는 항목이 사용자가 직접 고른 것 */
  selected: boolean
  /**
   * 방어 탭: 보이는 항목이 극단 필터를 통과한 쌍(rows = H 행·B/D 행)이면 있다. band = 내구 합계 띠(두 변형 쌍 결과가 나온 뒤에만),
   * error = 쌍 결과 오류, 또는 행·변형 스윕 오류로 쌍 작업이 끝내 생기지 않음(band 없음)
   */
  pair?: { band?: SumBandView; error?: ErrorReason; lock?: RowLockView }
  /** 카드 줄 핀(조립 옵션 lockControls 또는 고정 계획일 때만) */
  lockPin?: CardLockPin
  /** 조정 팝오버 모델(조립 옵션 adjust이고 변동 가능한 공격 스윕 행·통과한 방어 쌍 카드만, adjust.adjustView) */
  adjust?: AdjustView
}

/**
 * 카드 하나(보이는 배분·기술·조건·도구 변형)의 조정 모델. ready = 목록 확정, computing = 결과 대기(tasks),
 * locked = 조정할 능력치가 모두 고정(공격 v, 방어 그 쪽 B/D). computing·locked면 natures·results는 비어 있다.
 */
export interface AdjustView {
  state: 'ready' | 'computing' | 'locked'
  /** computing일 때 아직 결과가 없는 행 작업(중복 없음) */
  tasks?: readonly RowTask[]
  /** 2단 성격 선택지(순서 고정): 무보정 → v 상승 → (방어 B/D 한쪽 고정 중) 반대쪽 상승 */
  natures: readonly AdjustNature[]
  /** 1단 결과 목록: 그 탭 관점 좋은 결과부터(TIER_ORDER 역순). 예산 안에서 어느 선택지든 그 결과를 정확히 내는 것만 */
  results: readonly AdjustResult[]
  /** 적용 때 줄이지 않는 능력치(STAT_ORDER) = 조정 능력치 ∪ 판정이 의존하는 고정 밖 능력치 */
  keep: readonly StatId[]
  /** 그 판정에 관여하는 내 능력치(v 포함, STAT_ORDER). 무고정 적용의 성격 확인용 */
  relevant: readonly StatId[]
}

export interface AdjustNature {
  id: 'neutral' | 'plus' | 'other-plus'
  /** 이 선택지의 상승 능력치(무보정 null) */
  plus: Exclude<StatId, 'hp'> | null
  /** 판정에 쓴 성격 id. 갈래가 없거나 그 갈래에 엄격 성격이 없으면 그 갈래(없으면 행) 성격 */
  nature: string
  /** 적용 뒤 기준 갈래 id(고정 없으면 null) */
  branchId: string | null
  /** 적용 뒤 활성 고정 능력치의 고정 SP(그 갈래 lockedSp, 고정 없으면 빈 객체) */
  lockedSp: Readonly<Partial<Record<StatId, number>>>
  /** 그 갈래가 파생에 없음(다른 고정에 무보정안 없음·하락 자리 없음·SP 합 초과). 모든 결과에서 꺼진다 */
  off?: 'no-branch'
}

export interface AdjustResult {
  label: RollTier
  /** 카드 현재 결과와 같음 */
  current: boolean
  /** natures와 같은 순서·길이 */
  options: readonly AdjustOption[]
  /** 1단 SP 표기에 쓰는 선택지 index(ok 중 조정 능력치 SP 합이 가장 작은 것, 같으면 앞 선택지) */
  lead: number
}

/**
 * ok: stats = 합 최소 배분(조정 능력치 SP 합 최소), hMax = 방어 쌍에서 H가 고정 밖일 때 예산·능력치당 최대 안에서 H를 가장 높이고 그 H의 최소 B/D로
 * 같은 결과를 정확히 내는 배분(합 최소보다 H가 높을 때만, 표기 순서·고정 표지는 stats와 같다).
 * off: unreachable = SP 0~최대에서 그 결과를 정확히 내지 못함(건너뛰거나 더 좋은 결과가 먼저 남·성격 없음·결과 오류 포함), budget = 최소 SP가 예산 밖, no-branch = AdjustNature.off
 */
export type AdjustOption = { kind: 'ok'; stats: readonly AdjustStat[]; hMax?: readonly AdjustStat[] } | { kind: 'off'; reason: 'unreachable' | 'budget' | 'no-branch' }

/** 성격 선택지 안의 배분: 합 최소(stats) · H 최대(hMax) */
export type AdjustAllocation = 'min-sum' | 'h-max'

/** 표기 순서 STAT_ORDER. locked = 고정 능력치(값은 그 갈래 고정 SP), plus = 그 선택지 상승 */
export interface AdjustStat {
  stat: StatId
  sp: number
  plus: boolean
  locked: boolean
}

/** 기술 선택 목록의 항목 하나(그 카드 대표 세트 기준 현재 SP·성격 단건 판정) */
export interface ItemView {
  /** items.itemKey(기술, 조건) — 같은 상대의 모든 카드에서 같다 */
  key: string
  moveId: string
  /** 기술 채용률·기존 기술 순서(MoveCandidate.share·order). 분류를 합친 목록(groupItems) 정렬에 쓴다 */
  share: number
  order: number
  /** 그 항목 판정의 기술 타입(RowView.moveType과 같은 규칙) */
  moveType?: string
  /** RowView.power와 같은 규칙 */
  power?: number
  /** 랭크 후 항목이면 그 랭크 근거 */
  basis?: RankBasis
  /** 우선도 > 0 */
  priority: boolean
  /** 사용자가 추가한 상대 기술의 항목(랭크 후 항목 포함, 지우기 대상) */
  added?: true
  status: 'pending' | 'ok' | 'immune' | 'error'
  cell?: CompactCell
  error?: ErrorReason
  /** 내 SP·성격 조정으로 판정이 바뀔 수 있음(변동 판정이 나온 뒤에만, 판정 전·계산 불가면 없다) */
  variable?: boolean
}

/** 카드의 기본 항목과 분류 사이 비교 근거(같은 상대의 물리·특수 기본 카드 중 어느 분류를 먼저 보일지) */
export interface DefaultItemView {
  key: string
  /** 방어 탭 선공기 우선으로 정해짐 */
  viaPriority: boolean
  /** 정상 주력 기술이 없어 목록 첫 정상 항목(없으면 첫 항목)으로 정해짐(PRD R4-1). 분류 사이 비교에서 대표로 정해진 쪽에 진다 */
  fallback?: true
  /** 기준 기술 랭크 전 항목의 단건 판정 칸 */
  basisCell?: CompactCell
}
export interface TabView {
  tab: DamageTab
  status: TabStatus
  /** 이 뷰를 계산한 고난수 기준 n(칸 범주·배지·목표가 같은 기준이다) */
  rollSteps: number
  source: MetaSourceView
  /** 정렬 완료, 표시 대상만(래더 상대는 판정 변화와 무관하게 전부) */
  cards: readonly CardView[]
  progress: { done: number; total: number }
  /** 1·2단계 완료(잠정 빈 상태 판정 기준) */
  stage12Done: boolean
  /** 3단계까지 완료(false면 진행 문구에 "확인 중") */
  complete: boolean
  customTargetConflicts: readonly string[]
  /** 내 기술의 계산하지 않음 안내(분류 가변·내 HP 의존, 탭 안내) */
  notices: readonly MoveNotice[]
}
