// 제품 화면 상태와 리듀서(React 없음). 계산 입력이 바뀔 때만 세대를 올린다.
import type { StatId } from '../data/schema'
import type { MatchType } from '../data/meta-schema'
import {
  DEFAULT_CRITERIA,
  DEFAULT_ROLL_STEPS,
  DEFAULT_SPEED_FILTERS,
  SPEED_CONDITION_KINDS,
  ROLL_STEPS,
  DEFAULT_TOP_N,
  MAX_CUSTOM_MOVES,
  baseConditionOf,
  conflictingLocks,
  addedBundleIdentity,
  addedBundlePin,
  isSpValue,
  normalizeKeySigns,
  validKeySigns,
  itemKey,
  opponentKey,
  samePin,
  sameLockTarget,
  speedBundleIdentity,
  type AddedBundle,
  type AddedMove,
  type CardFilters,
  type CustomTarget,
  type CutLock,
  type DisplayCriteria,
  type PinnedBundle,
  type PresetEdit,
  type SortMode,
  type SpeedAddedBundle,
  type SpeedConditionFilters,
  type SpeedConditionKind,
  type Tab,
  type TargetSource,
} from '../cards'
import { parseNumber, type SetDraft } from '../ui/setDraft'
import { EXAMPLE_DRAFT } from './example'
import { clampSp, fitUnlocked, type LockedSp, type SpRules } from './spLimit'
import {
  CLEARED_TRANSIENT,
  PARTY_SIZE,
  blankSlice,
  draftSlice,
  emptyParty,
  isPartyIndex,
  movedOrder,
  sliceOf,
  storedSlice,
  type PartyHydration,
  type PartyState,
  type SlotSlice,
} from './party'

export interface AppState {
  regulation: string
  /** null = 기본(resolveMetaSelection 규칙: 최근 월에서 판수가 더 많은 매치 방식, 동률 Bo1) */
  meta: { match: MatchType; month: string } | null
  /** 확정된 내 세트 초안(status 'none'·boosts 0 고정) */
  draft: SetDraft
  /**
   * 스피드 차트 화면 상태(메모리에만 둔다). 계산 입력이 아니라 세대를 올리지 않는다(차트가 실행기 밖에서 동기로 계산한다).
   * added = 사용자가 더한 래더 상대 배분(추가 순). 기존 addedBundles·pinnedBundles는 공격·방어 탭 전용이다
   */
  speedChart: { filters: SpeedConditionFilters; myTailwind: boolean; added: readonly SpeedAddedBundle[] }
  /** 고난수 기준 n(1~ROLL_STEPS−1 정수). 공격 "고난수 1타"·방어 "고난수 견딤"이 같은 값을 공유한다 */
  rollSteps: number
  tab: Tab
  criteria: DisplayCriteria
  filters: CardFilters
  customTargets: readonly CustomTarget[]
  /** 사용자가 직접 추가한 래더 상대 배분(추가 순, 메모리에만 둔다) */
  addedBundles: readonly AddedBundle[]
  /** 방어 탭 래더 상대에 사용자가 추가한 기술(추가 순, 메모리에만 둔다). 계산 입력이다(후보가 바뀐다) */
  addedMoves: readonly AddedMove[]
  /**
   * 고정한 래더 상대 배분(고정·추가한 순, 메모리에만 둔다). 직접 추가 배분은 추가와 함께 여기에도 들어가고, 고정을 풀면 지워진다
   * (addedBundles의 모든 항목은 고정돼 있다). 계산 입력이 아니라 세대를 올리지 않는다(정렬·표시만).
   * 통계 기준·월·최소 비중이 바뀌어 고정한 관측 배분이 목록에서 빠져도 지우지 않는다(의도): 화면에 맞는 카드가 없는 고정은
   * 정렬에서 무시되고(cards groupCards) 아무것도 바꾸지 않으며, 기준을 되돌리면 사용자가 고른 고정이 다시 맨 위에 선다 —
   * 기준이 바뀌어도 남는 addedBundles와 같은 수명이다.
   */
  pinnedBundles: readonly PinnedBundle[]
  /** 목록 정렬: usage = 사용률 순(계획 순서), result = 계산결과순(cards sortByResult). 계산 입력이 아니라 세대를 올리지 않는다 */
  sortMode: SortMode
  /**
   * 사용자가 판정 행 기술 목록에서 직접 고른 항목((탭, 상대)마다 하나, 메모리에만 둔다). 계산 입력이 아니라 세대를 올리지 않는다
   * (실행기가 그 항목의 행 작업을 수요로 받아 계산한다). 같은 상대의 모든 배분·반감열매 변형에 공유된다.
   */
  moveChoices: readonly MoveChoice[]
  /** 계산 입력이 바뀔 때만 +1(탭 전환·같은 값 확정은 그대로) */
  generation: number
  /**
   * 종별 마지막 내 세트(풀린 종 id → 떠날 때의 초안, 메모리에만 둔다). 그 종으로 돌아오면 대표 세트보다 우선해 복원한다.
   * 계산 입력이 아니라 세대를 올리지 않는다.
   */
  draftCache: Readonly<Record<string, SetDraft>>
  /** 마지막으로 종을 바꾼 세대(0 = 바꾼 적 없음). 결과 목록은 이 세대 뷰가 보이면 그 전에 펼친 카드를 접는다 */
  speciesGeneration: number
  /**
   * 컷 고정(생성 순, 메모리에만 둔다). 계산 입력이다. 고정 SP·상태·갈래는 저장하지 않고 매 세대 파생한다.
   * 고정 중 draft의 고정 능력치 SP는 첫 고정 직전 값을 지킨다(해제 복원값). 성격은 고정 중에도 고칠 수 있고(고정 밖 ▲▼),
   * 첫 고정 직전 성격은 lockNature에 두었다가 고정이 모두 풀릴 때 돌려놓는다
   */
  locks: readonly CutLock[]
  /** 다음 고정 seq. 고정이 0개가 되면 1로 돌아간다 */
  lockSeq: number
  /** 사용자가 고른 기준 갈래 id(내 세트 성격 ▲로 고른다, null = 자동 규칙). 계산 입력이다. 고정이 0개면 null */
  lockBase: string | null
  /** 첫 고정 직전 성격·자동 하락 표지(전부 해제 복원값). 고정이 0개면 null */
  lockNature: Pick<SetDraft, 'nature' | 'natureMinusAuto'> | null
  /** 첫 고정 때 받은 레귤레이션 SP 합계 상한(해제 복원 자르기 기준). 고정이 0개면 null */
  lockSpTotal: number | null
  /** 고정 목록 이동 요청(일회성, nonce = 같은 고정을 다시 눌러도 새 요청). 탭을 떠나면 null. 세대 그대로 */
  lockReveal: { seq: number; nonce: number } | null
  /** 마지막으로 낸 이동 요청 nonce. 요청을 비워도(clear-reveal·탭 이동·해제) 되돌리지 않는다(화면이 처리한 nonce와 겹치지 않게) */
  lockRevealNonce: number
  /**
   * 마지막 해제 복원 또는 고정 초과 자동 조정에서 SP를 자른 능력치(자른 순). 세대 그대로.
   * 마지막 고정 조작(핀·해제·기준 갈래 변경·종 변경 해제)의 알림만 남는다: 그 조작이 자르지 않았으면 비운다
   */
  lockTrim: readonly LockTrim[] | null
  /**
   * 고정 초과 자동 조정 대기 표지(핀 고정·기준 갈래 변경 직후의 세대, null = 대기 없음). 그 뒤 처음 나온 파생으로 fit-locks를 한 번만
   * 적용하고 비운다. 재계산으로 생긴 초과는 표지가 없어 줄이지 않는다
   */
  lockFit: number | null
  /** 파티 6칸. 활성 칸의 조각(party.ts SlotSlice)은 위 최상위 필드가 진실이고 slots[active]는 null로 둔다 */
  party: PartyState
}

export interface LockTrim {
  stat: StatId
  from: number
  to: number
}

/** 직접 고른 기술 항목. key = cards itemKey(기술, 랭크 조건) */
export interface MoveChoice {
  tab: Tab
  source: TargetSource
  opponentId: string
  key: string
}

/** 그 탭의 선택: 상대 키(cards opponentKey) → 항목 키 */
export function moveSelections(choices: readonly MoveChoice[], tab: Tab): Map<string, string> {
  const out = new Map<string, string>()
  for (const c of choices) if (c.tab === tab) out.set(opponentKey({ source: c.source, id: c.opponentId }), c.key)
  return out
}

const sameTarget = (a: Omit<MoveChoice, 'key'>, b: Omit<MoveChoice, 'key'>): boolean => a.tab === b.tab && a.source === b.source && a.opponentId === b.opponentId

export type AppAction =
  | { type: 'set-draft'; draft: SetDraft }
  /**
   * 내 포켓몬 종 교체(풀린 종 id가 from → to로 바뀜). 지금 초안을 from 종 기억에 넣고, to 종 기억이 있으면 그 초안(종 칸 글자만
   * draft.species)을, 없으면 draft(호출자가 만든 대표 세트 또는 종만 바꾼 초안)를 쓴다. from === to면 set-draft와 같다.
   * sameBase = from·to가 같은 원종의 원종·메가 폼 사이 전환(호출자가 게임 메가 표로 판정)이면 컷 고정을 지우지 않는다.
   */
  | { type: 'switch-species'; from: string | undefined; to: string; draft: SetDraft; sameBase?: boolean }
  /**
   * SP 확정. value는 spLimit 범위(0..min(능력치당 상한, 합계 상한 − 다른 능력치))로 자른다. lockedSp = 기준 갈래 고정 SP(고정이 없거나
   * 기준 갈래가 없으면 null). 고정 능력치면 무시
   */
  | { type: 'commit-sp'; stat: StatId; value: number; rules: SpRules; lockedSp: LockedSp | null }
  | { type: 'set-meta'; meta: { match: MatchType; month: string } }
  | { type: 'set-tab'; tab: Tab }
  | { type: 'set-sort'; mode: SortMode }
  /** 공격·방어 계산에 쓰는 기준이 바뀔 때만 세대 +1(스카프·날씨 특성 기준은 스피드 차트만 쓴다). 0~1 밖 값이 있으면 무시 */
  | { type: 'set-criteria'; criteria: Partial<DisplayCriteria> }
  /** 스피드 차트 조건 필터 켜기·끄기. 세대 그대로 */
  | { type: 'set-speed-filter'; kind: SpeedConditionKind; on: boolean }
  /** 스피드 차트 내 순풍. 세대 그대로 */
  | { type: 'set-my-tailwind'; on: boolean }
  /**
   * 스피드 차트 배분 추가(맨 뒤). 형식(출처, 상대 id 비어 있지 않음, sp = 0~spMax 정수, 성격 부호)과 같은 (출처, 상대, SP, 부호) 중복만 거른다.
   * 차트에 이미 있는 배분인지의 최종 판정은 cards judgeSpeedAddition이 한다. 세대 그대로
   */
  | { type: 'add-speed-bundle'; bundle: SpeedAddedBundle; spMax: number }
  /** 같은 (출처, 상대, SP, 부호)를 지운다. 없으면 무시. 세대 그대로 */
  | { type: 'remove-speed-bundle'; bundle: SpeedAddedBundle }
  /** steps가 1~ROLL_STEPS−1 정수가 아니면 무시 */
  | { type: 'set-roll-steps'; steps: number }
  | { type: 'set-top-n'; topN: number }
  | { type: 'set-selected'; ids: readonly string[] }
  /** moves가 1~MAX_CUSTOM_MOVES개가 아니거나 rosterId가 이미 있으면 무시 */
  | { type: 'add-custom-target'; rosterId: string; moves: readonly string[] }
  /** 그 타겟과 출처 custom·같은 id의 추가 배분(공·방·스피드)·고정을 함께 지운다. 래더 항목은 남긴다 */
  | { type: 'remove-custom-target'; rosterId: string }
  | { type: 'edit-preset'; rosterId: string; key: string; edit: PresetEdit }
  /** 0개 또는 초과면 무시(최소 1개 유지) */
  | { type: 'set-custom-moves'; rosterId: string; moves: readonly string[] }
  /**
   * 출처가 ladder·custom이 아니거나 sp 키가 keyStats와 같은 집합이 아니거나 값이 0~spMax 정수가 아니면 무시. 같은 (탭, 출처, 상대, 분류, SP)가 이미 있으면 무시.
   * keyStats = 그 카드 묶음의 키 능력치, spMax = 레귤레이션 능력치당 SP 상한.
   * 상태는 계획을 모르므로(계층: cards ← app) 이 검증은 호출자가 준 값 기준의 1차 거름이다. 최종 권한은 계획(plan.userSeeds)이
   * 갖는다 — 게임의 키 능력치 집합·SP 상한과 맞지 않거나 관측 묶음과 키가 같은 항목은 카드를 만들지 않는다(화면은 같은 키의
   * 관측 묶음을 고른다: cards chosenOption). 그런 항목은 상태에 남아 기준이 바뀌어 관측 묶음이 빠지면 다시 카드가 된다.
   */
  | { type: 'add-bundle'; bundle: AddedBundle; keyStats: readonly StatId[]; spMax: number }
  /** 같은 (탭, 출처, 상대, 분류, SP)를 지운다(고정도 함께). 없으면 무시 */
  | { type: 'remove-bundle'; bundle: AddedBundle }
  /** 배분 고정(맨 뒤에 붙는다). 이미 고정이거나 출처가 ladder·custom이 아니거나 상대 id·키가 빈 문자열이면 무시 */
  | { type: 'pin-bundle'; pin: PinnedBundle }
  /**
   * 고정 해제. 같은 키의 직접 추가 배분이 있으면 그것도 지운다(직접 추가는 고정을 풀면 사라진다). 없으면 무시.
   * 직접 추가 배분이 기준 변경으로 같은 키의 관측 배분에 가려져 있을 때(plan.userSeeds가 카드를 만들지 않는다) 화면의 "고정됨"
   * 관측 카드는 그 추가 배분의 고정을 보여 주는 것이므로, 그 핀을 풀면 추가 배분도 지운다(의도: "모든 추가 배분은 고정"이라는
   * 단일 모델을 지키고, 풀었는데 기준을 되돌리면 다시 고정으로 나타나는 일을 막는다).
   */
  | { type: 'unpin-bundle'; pin: PinnedBundle }
  /** 기술 항목 직접 선택(같은 (탭, 상대)의 이전 선택을 바꾼다). 상대 id·키가 빈 문자열이면 무시 */
  | { type: 'choose-move'; choice: MoveChoice }
  /** 직접 선택 해제(기본 항목으로). 없으면 무시 */
  | { type: 'reset-move'; tab: Tab; source: TargetSource; opponentId: string }
  /** 방어 탭 래더 상대 기술 추가 + 그 기술 랭크 전 항목 직접 선택. 빈 문자열이거나 이미 있으면 무시 */
  | { type: 'add-move'; opponentId: string; moveId: string }
  /** 추가한 기술 삭제. 그 기술이 직접 선택돼 있으면(랭크 후 항목 포함) 선택도 해제. 없으면 무시 */
  | { type: 'remove-move'; opponentId: string; moveId: string }
  /**
   * 컷 고정 추가(seq 부여). 형식(종류·단계·능력치 모양·대상 종류·배분)이 맞지 않으면 무시.
   * H 밖 능력치가 겹치는 기존 고정(cards conflictingLocks)은 같은 액션에서 해제한다(같은 능력치는 고정 하나, 사용자 결정 2026-11-21):
   * 해제는 remove-lock과 같은 경로(복원·자르기)이고, 새 고정이 다시 고정하는 능력치는 복원도 자르기도 하지 않는다.
   * 교체할 고정이 새 고정과 같은 (대상, 단계, 배분) 하나뿐이고 base가 없거나 지금 기준 갈래와 같으면 상태 그대로.
   * spTotal = 레귤레이션 SP 합계 상한(첫 고정 때만 기억). base = 고를 기준 갈래 id(없으면 그대로). lockedSp = 지금 기준 갈래 고정 SP(해제 자르기용, remove-lock과 같다).
   * addingSp = 새 고정을 건 뒤 기준 갈래의 고정 SP(핀 메뉴에 보인 값). 해제 자르기에서 lockedSp보다 먼저 센다(교체 전 값으로 세면 풀리는 능력치를 필요 이상 자른다).
   * 고정 가능·상태 판정은 호출자(cards checkLockCandidate·pinMenuView) 몫이다
   */
  | {
      type: 'add-lock'
      lock: Omit<CutLock, 'seq'>
      spTotal: number
      base?: string
      lockedSp?: Readonly<Partial<Record<StatId, number>>>
      addingSp?: Readonly<Partial<Record<StatId, number>>>
    }
  /**
   * 고정 해제. 없으면 무시. 마지막 고정이 풀린 능력치는 초안 값으로 돌아가고, 초안 SP 합이 lockSpTotal을 넘으면 그 능력치를
   * 나중에 만든 고정의 능력치부터 max(0, lockSpTotal − 나머지)로 자르고 lockTrim에 남긴다. 고정이 0개면 고정 상태를 모두 비운다.
   * lockedSp = 지금 기준 갈래의 고정 능력치 SP(cards Branch.lockedSp). 남은 고정 능력치는 "나머지"에 초안 값 대신 이 값으로 센다(없으면 초안 값)
   */
  | { type: 'remove-lock'; seq: number; lockedSp?: Readonly<Partial<Record<StatId, number>>> }
  /** 고정이 없으면 무시 */
  | { type: 'set-lock-base'; id: string | null }
  /** 그 고정의 탭으로 바꾸고 이동 요청을 낸다. 스피드 고정의 조건 필터가 꺼져 있으면 켠다. 상위 N·선택은 그대로. 세대 그대로 */
  | { type: 'reveal-lock'; seq: number }
  | { type: 'clear-reveal' }
  | { type: 'dismiss-lock-trim' }
  /**
   * 고정 초과 자동 조정. token이 lockFit과 같을 때만 고정 밖 능력치를 H→A→B→C→D→S 순으로 줄여 합계를 lockSpTotal에 맞추고
   * lockTrim에 남긴다(같은 조작의 해제 자르기가 lockTrim에 있으면 합친다). lockedSp = 그 세대 파생의 기준 갈래 고정 SP(null = 기준 갈래 없음: 줄이지 않는다). 어느 쪽이든 lockFit을 비운다
   */
  | { type: 'fit-locks'; token: number; lockedSp: LockedSp | null }
  /**
   * 조정 결과 적용. sp = 조정 능력치의 새 SP(0..spMaxPerStat 정수로 자른다, 고정 능력치 키·유한하지 않은 값은 버린다),
   * nature = 새 성격·자동 하락 표지(없으면 그대로), lockBase = 고를 기준 갈래 id(없거나 고정이 없으면 그대로).
   * 그 뒤 고정·keep·쓴 능력치 밖을 H→A→B→C→D→S 순서로 줄여 합계를 lockSpTotal(고정이 없으면 rules.spTotal)에 맞추고 lockTrim에 남긴다.
   * lockedSp = 적용 뒤 기준 갈래의 활성 고정 SP(빠진 고정 능력치는 초안 값으로 센다). 바뀐 게 없으면 상태 그대로, 있으면 세대 +1 한 번·lockFit 비움
   */
  | {
      type: 'apply-adjust'
      sp: Readonly<Partial<Record<StatId, number>>>
      nature?: Pick<SetDraft, 'nature' | 'natureMinusAuto'>
      lockBase?: string
      lockedSp: LockedSp
      keep: readonly StatId[]
      rules: SpRules
    }
  /** 그 칸을 활성으로(종 변경 경로를 타지 않아 고정이 남는다). 같은 칸이면 무시 */
  | { type: 'party-select'; index: number }
  /** 그 칸의 포켓몬 상태를 지운다. 활성 칸이면 빈 초안이 된다 */
  | { type: 'party-clear-slot'; index: number }
  /** from 칸을 to 자리로 옮긴다(사이 칸은 밀린다). 활성 칸은 같은 포켓몬을 따라간다 */
  | { type: 'party-move'; from: number; to: number }
  /** 6칸을 비우고 1번 칸을 활성으로 */
  | { type: 'party-clear-all' }
  /** 6칸을 주어진 초안으로 통째 교체(고정 없음, 앞 PARTY_SIZE개만, null·모자란 칸은 빈 칸). 1번 칸 활성. 전역 상대 목록은 그대로 */
  | { type: 'party-import'; slots: readonly (SetDraft | null)[] }
  /** 저장 복원: 보관함·활성 칸·최상위 조각과 주어진 전역 상대 목록을 통째로 세팅. 모양 검증은 호출자(persist) 몫 */
  | { type: 'party-hydrate'; saved: PartyHydration }

export function initialState(regulation: string): AppState {
  return {
    regulation,
    meta: null,
    draft: EXAMPLE_DRAFT,
    speedChart: { filters: DEFAULT_SPEED_FILTERS, myTailwind: false, added: [] },
    rollSteps: DEFAULT_ROLL_STEPS,
    tab: 'attack',
    criteria: { ...DEFAULT_CRITERIA },
    filters: { topN: DEFAULT_TOP_N, selected: [] },
    customTargets: [],
    addedBundles: [],
    addedMoves: [],
    pinnedBundles: [],
    sortMode: 'usage',
    moveChoices: [],
    generation: 0,
    draftCache: {},
    speciesGeneration: 0,
    locks: [],
    lockSeq: 1,
    lockBase: null,
    lockNature: null,
    lockSpTotal: null,
    lockReveal: null,
    lockRevealNonce: 0,
    lockTrim: null,
    lockFit: null,
    party: emptyParty(),
  }
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

/** 계산 입력 변경: 값이 같으면 상태 그대로, 다르면 세대 +1. */
function bump(state: AppState, patch: Partial<AppState>): AppState {
  const changed = (Object.keys(patch) as (keyof AppState)[]).some((k) => !same(state[k], patch[k]))
  return changed ? { ...state, ...patch, generation: state.generation + 1 } : state
}

const isRatio = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1
const isPositiveInt = (v: unknown): boolean => typeof v === 'number' && Number.isInteger(v) && v >= 1
const isRollSteps = (v: unknown): boolean => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= ROLL_STEPS - 1

function validCriteria(c: Partial<DisplayCriteria>): boolean {
  if (c.bundleShareMin !== undefined && !isRatio(c.bundleShareMin)) return false
  if (c.rankShareMin !== undefined && !isRatio(c.rankShareMin)) return false
  if (c.scarfShareMin !== undefined && !isRatio(c.scarfShareMin)) return false
  if (c.weatherShareMin !== undefined && !isRatio(c.weatherShareMin)) return false
  if (c.berryShareMin !== undefined && !isRatio(c.berryShareMin)) return false
  if (c.powerItemShareMin !== undefined && !isRatio(c.powerItemShareMin)) return false
  return true
}

/** 공격·방어 계획이 읽는 기준(planTab). 나머지 기준은 스피드 차트만 쓴다 */
const DAMAGE_CRITERIA_KEYS = ['bundleShareMin', 'rankShareMin', 'berryShareMin', 'powerItemShareMin'] as const satisfies readonly (keyof DisplayCriteria)[]

function setCriteria(state: AppState, patch: Partial<DisplayCriteria>): AppState {
  const criteria = { ...state.criteria, ...patch }
  if (same(criteria, state.criteria)) return state
  const damage = DAMAGE_CRITERIA_KEYS.some((k) => criteria[k] !== state.criteria[k])
  return { ...state, criteria, generation: damage ? state.generation + 1 : state.generation }
}

const SPEED_NATURE_SIGNS: readonly SpeedAddedBundle['nature'][] = ['plus', 'neutral', 'minus']
const TARGET_SOURCES: readonly TargetSource[] = ['ladder', 'custom']
const isTargetSource = (v: unknown): v is TargetSource => TARGET_SOURCES.some((s) => s === v)
const sameSpeedBundle = (a: SpeedAddedBundle, b: SpeedAddedBundle): boolean => speedBundleIdentity(a) === speedBundleIdentity(b)
const validSpeedBundle = (b: SpeedAddedBundle, spMax: number): boolean =>
  isTargetSource(b.source) &&
  typeof b.opponentId === 'string' &&
  b.opponentId !== '' &&
  isSpValue(b.sp, spMax) &&
  SPEED_NATURE_SIGNS.includes(b.nature)

function updateSpeedChart(state: AppState, patch: Partial<AppState['speedChart']>): AppState {
  const next = { ...state.speedChart, ...patch }
  return same(next, state.speedChart) ? state : { ...state, speedChart: next }
}

const validMoves = (moves: readonly string[]): boolean =>
  moves.length >= 1 && moves.length <= MAX_CUSTOM_MOVES && new Set(moves).size === moves.length && moves.every((m) => typeof m === 'string' && m !== '')

/** 같은 (탭, 출처, 상대, 분류, SP, 보정 부호) 배분인지 */
export function sameBundle(a: AddedBundle, b: AddedBundle): boolean {
  return addedBundleIdentity(a) === addedBundleIdentity(b)
}

function validBundle(bundle: AddedBundle, keyStats: readonly StatId[], spMax: number): boolean {
  if (!isTargetSource(bundle.source) || typeof bundle.opponentId !== 'string' || bundle.opponentId === '') return false
  const keys = Object.keys(bundle.sp) as StatId[]
  const expected = new Set(keyStats)
  if (expected.size === 0 || keys.length !== expected.size || !keys.every((k) => expected.has(k))) return false
  return keys.every((k) => isSpValue(bundle.sp[k], spMax)) && validKeySigns(keyStats, bundle.nature)
}

/** 목록 밖 타겟 rosterId가 가진 추가·고정 항목인지 */
const ownedByCustom = (rosterId: string) => (x: { source: TargetSource; opponentId: string }): boolean => x.source === 'custom' && x.opponentId === rosterId

/** SP·성격(하락 자동 지정 포함) 밖의 초안 항목이 같은지 */
function sameBeyondSpNature(a: SetDraft, b: SetDraft): boolean {
  const pick = (d: SetDraft) => [d.species, d.ability, d.item, d.moves, d.mega, d.status, d.boosts.atk, d.boosts.def, d.boosts.spa, d.boosts.spd, d.boosts.spe]
  return same(pick(a), pick(b))
}

const sameAddedMove = (a: AddedMove, b: AddedMove): boolean => a.opponentId === b.opponentId && a.moveId === b.moveId
const defenseLadder = (opponentId: string) => ({ tab: 'defense' as const, source: 'ladder' as const, opponentId })
/** 항목 키(cards itemKey)의 기술 id */
const moveOfKey = (key: string): string | undefined => {
  try {
    const parsed: unknown = JSON.parse(key)
    return Array.isArray(parsed) && typeof parsed[0] === 'string' ? parsed[0] : undefined
  } catch {
    return undefined
  }
}

const ATTACK_LOCK_STAGES: readonly CutLock['stage'][] = ['guaranteed-ohko', 'high-roll-ohko']
const DEFENSE_LOCK_STAGES: readonly CutLock['stage'][] = ['guaranteed-survive', 'low-roll-ohko']
const NON_HP_STATS: readonly StatId[] = ['atk', 'def', 'spa', 'spd', 'spe']

function validLock(l: Omit<CutLock, 'seq'>): boolean {
  if (typeof l !== 'object' || l === null || typeof l.target !== 'object' || l.target === null || l.target.kind !== l.kind) return false
  if (!Array.isArray(l.stats)) return false
  if (l.allocation !== undefined && l.kind !== 'defense') return false
  const [a, b] = l.stats
  switch (l.kind) {
    case 'speed':
      return l.stage === 'first' && l.stats.length === 1 && a === 'spe'
    case 'attack':
      return ATTACK_LOCK_STAGES.includes(l.stage) && l.stats.length === 1 && NON_HP_STATS.includes(a)
    case 'defense':
      return (
        DEFENSE_LOCK_STAGES.includes(l.stage) && l.stats.length === 2 && a === 'hp' && (b === 'def' || b === 'spd') && (l.allocation === undefined || l.allocation === 'h-max')
      )
    default:
      return false
  }
}

const lockedStatsOf = (locks: readonly CutLock[]): Set<StatId> => new Set(locks.flatMap((l) => l.stats))

const spTableOf = (draft: SetDraft): Record<StatId, number> => {
  const out = {} as Record<StatId, number>
  for (const s of Object.keys(draft.sp) as StatId[]) out[s] = parseNumber(draft.sp[s])
  return out
}

/** 사용자 조작으로 기준 갈래가 바뀌는 상태 변경이면(next !== prev) 자동 조정 대기 표지를 그 세대로 단다 */
const armFit = (next: AppState, prev: AppState): AppState => (next === prev ? next : { ...next, lockFit: next.generation })

/** 고정 능력치 SP를 지금 초안 값으로 덮어쓴다(고정 중 초안 SP는 고정 전 값 보관소다). 성격은 받는다 */
function normalizeLocked(state: AppState, draft: SetDraft): SetDraft {
  const locked = lockedStatsOf(state.locks)
  if (locked.size === 0) return draft
  const sp = { ...draft.sp }
  for (const s of locked) sp[s] = state.draft.sp[s]
  return { ...draft, sp }
}

/** 첫 고정 직전 성격·자동 하락 표지를 초안에 돌려놓는다(표지가 없던 초안은 표지 없이) */
const natureOf = (draft: SetDraft): Pick<SetDraft, 'nature' | 'natureMinusAuto'> =>
  draft.natureMinusAuto === undefined ? { nature: draft.nature } : { nature: draft.nature, natureMinusAuto: draft.natureMinusAuto }

function restoreNature(draft: SetDraft, saved: AppState['lockNature']): SetDraft {
  if (saved === null) return draft
  const next: SetDraft = { ...draft, nature: saved.nature }
  if (saved.natureMinusAuto === undefined) delete next.natureMinusAuto
  else next.natureMinusAuto = saved.natureMinusAuto
  return next
}

/**
 * remaining만 남기고 나머지 고정을 푼 초안과 자르기. 풀린 능력치(남은 고정에도 adding에도 없음)는 그 능력치를 쓰던 고정의 seq 역순으로,
 * 같은 고정 안에서는 stats 뒤쪽부터 자른다. 초안 SP에 숫자가 아닌 칸이 있으면 합을 알 수 없어 자르지 않는다.
 * adding = 같은 조작에서 새로 고정하는 능력치(교체). 풀지 않고, 고정이 남으므로 성격도 돌려놓지 않는다
 */
function releaseLocks(
  state: Pick<AppState, 'draft' | 'locks' | 'lockNature' | 'lockSpTotal'>,
  remaining: readonly CutLock[],
  lockedSp: Readonly<Partial<Record<StatId, number>>> = {},
  adding: readonly StatId[] = [],
): { draft: SetDraft; trims: LockTrim[] } {
  const keep = lockedStatsOf(remaining)
  for (const s of adding) keep.add(s)
  const order: StatId[] = []
  for (const l of state.locks.filter((x) => !remaining.includes(x)).sort((x, y) => y.seq - x.seq)) {
    for (const s of [...l.stats].reverse()) if (!keep.has(s) && !order.includes(s)) order.push(s)
  }
  const cap = state.lockSpTotal
  const trims: LockTrim[] = []
  let draft = remaining.length === 0 && adding.length === 0 ? restoreNature(state.draft, state.lockNature) : state.draft
  if (cap === null) return { draft, trims }
  for (const stat of order) {
    const total = (Object.keys(draft.sp) as StatId[]).reduce((a, s) => a + (keep.has(s) ? (lockedSp[s] ?? parseNumber(draft.sp[s])) : parseNumber(draft.sp[s])), 0)
    const from = parseNumber(draft.sp[stat])
    if (!Number.isFinite(total) || total <= cap) continue
    const to = Math.max(0, cap - (total - from))
    if (to >= from) continue
    trims.push({ stat, from, to })
    draft = { ...draft, sp: { ...draft.sp, [stat]: String(to) } }
  }
  return { draft, trims }
}

/** 앞선 자르기(같은 조작의 해제 자르기)에 뒤 자르기를 합친다. 같은 능력치는 처음 값 → 마지막 값 하나로 */
function mergeTrims(prev: readonly LockTrim[] | null, next: readonly LockTrim[]): LockTrim[] {
  const out = [...(prev ?? [])]
  for (const t of next) {
    const i = out.findIndex((x) => x.stat === t.stat)
    if (i < 0) out.push(t)
    else out[i] = { stat: t.stat, from: out[i].from, to: t.to }
  }
  return out
}

const CLEARED_LOCKS = { locks: [], lockSeq: 1, lockBase: null, lockNature: null, lockSpTotal: null, lockReveal: null, lockFit: null } as const satisfies Partial<AppState>

const LOCK_TABS: Readonly<Record<CutLock['kind'], Tab>> = { speed: 'speed', attack: 'attack', defense: 'defense' }

function updateTarget(state: AppState, rosterId: string, f: (t: CustomTarget) => CustomTarget): AppState {
  const i = state.customTargets.findIndex((t) => t.rosterId === rosterId)
  if (i < 0) return state
  const next = [...state.customTargets]
  next[i] = f(next[i])
  return bump(state, { customTargets: next })
}

export function reducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'set-draft': {
      const draft = normalizeLocked(state, action.draft)
      const next = bump(state, { draft })
      if (next === state || sameBeyondSpNature(state.draft, draft) || next.moveChoices.length === 0) return next
      return { ...next, moveChoices: [] }
    }
    case 'switch-species': {
      if (action.from === action.to) return reducer(state, { type: 'set-draft', draft: action.draft })
      let base = state
      if (state.locks.length > 0 && action.sameBase !== true) {
        const { draft, trims } = releaseLocks(state, [])
        base = { ...state, ...CLEARED_LOCKS, draft, lockTrim: trims.length > 0 ? trims : null, generation: state.generation + 1 }
      }
      const draftCache = action.from === undefined ? base.draftCache : { ...base.draftCache, [action.from]: base.draft }
      const kept = Object.prototype.hasOwnProperty.call(draftCache, action.to) ? draftCache[action.to] : undefined
      const next = reducer(base, { type: 'set-draft', draft: kept === undefined ? action.draft : { ...kept, species: action.draft.species } })
      return { ...next, draftCache, speciesGeneration: next.generation === state.generation ? state.speciesGeneration : next.generation }
    }
    case 'commit-sp': {
      if (!Number.isInteger(action.value) || lockedStatsOf(state.locks).has(action.stat)) return state
      const value = clampSp(action.stat, action.value, spTableOf(state.draft), action.rules, action.lockedSp)
      return bump(state, { draft: { ...state.draft, sp: { ...state.draft.sp, [action.stat]: String(value) } } })
    }
    case 'set-meta': {
      if (same(state.meta, action.meta)) return state
      return { ...state, meta: { ...action.meta }, filters: { ...state.filters, selected: [] }, generation: state.generation + 1 }
    }
    case 'set-tab':
      return state.tab === action.tab ? state : { ...state, tab: action.tab, lockReveal: null }
    case 'set-sort':
      if (action.mode !== 'usage' && action.mode !== 'result') return state
      return state.sortMode === action.mode ? state : { ...state, sortMode: action.mode }
    case 'set-criteria':
      if (!validCriteria(action.criteria)) return state
      return setCriteria(state, action.criteria)
    case 'set-speed-filter':
      if (!SPEED_CONDITION_KINDS.includes(action.kind) || typeof action.on !== 'boolean') return state
      return updateSpeedChart(state, { filters: { ...state.speedChart.filters, [action.kind]: action.on } })
    case 'set-my-tailwind':
      if (typeof action.on !== 'boolean') return state
      return updateSpeedChart(state, { myTailwind: action.on })
    case 'add-speed-bundle': {
      const b = action.bundle
      if (!validSpeedBundle(b, action.spMax) || state.speedChart.added.some((x) => sameSpeedBundle(x, b))) return state
      return updateSpeedChart(state, { added: [...state.speedChart.added, { source: b.source, opponentId: b.opponentId, sp: b.sp, nature: b.nature }] })
    }
    case 'remove-speed-bundle': {
      const added = state.speedChart.added.filter((x) => !sameSpeedBundle(x, action.bundle))
      return added.length === state.speedChart.added.length ? state : updateSpeedChart(state, { added })
    }
    case 'set-roll-steps':
      if (!isRollSteps(action.steps)) return state
      return bump(state, { rollSteps: action.steps })
    case 'set-top-n':
      if (!isPositiveInt(action.topN)) return state
      return bump(state, { filters: { ...state.filters, topN: action.topN } })
    case 'set-selected':
      return bump(state, { filters: { ...state.filters, selected: [...new Set(action.ids)] } })
    case 'add-custom-target':
      if (!validMoves(action.moves) || state.customTargets.some((t) => t.rosterId === action.rosterId)) return state
      return bump(state, { customTargets: [...state.customTargets, { rosterId: action.rosterId, moves: [...action.moves], edits: {} }] })
    case 'remove-custom-target': {
      const next = state.customTargets.filter((t) => t.rosterId !== action.rosterId)
      if (next.length === state.customTargets.length) return state
      const owned = ownedByCustom(action.rosterId)
      const addedBundles = state.addedBundles.filter((x) => !owned(x))
      const pinnedBundles = state.pinnedBundles.filter((x) => !owned(x))
      const speedAdded = state.speedChart.added.filter((x) => !owned(x))
      const bumped = bump(state, addedBundles.length === state.addedBundles.length ? { customTargets: next } : { customTargets: next, addedBundles })
      return dropCustomLocks(
        {
          ...bumped,
          pinnedBundles: pinnedBundles.length === state.pinnedBundles.length ? state.pinnedBundles : pinnedBundles,
          speedChart: speedAdded.length === state.speedChart.added.length ? state.speedChart : { ...state.speedChart, added: speedAdded },
        },
        action.rosterId,
      )
    }
    case 'edit-preset':
      return updateTarget(state, action.rosterId, (t) => ({ ...t, edits: { ...t.edits, [action.key]: { ...action.edit } } }))
    case 'set-custom-moves':
      if (!validMoves(action.moves)) return state
      return updateTarget(state, action.rosterId, (t) => ({ ...t, moves: [...action.moves] }))
    case 'add-bundle': {
      const b = action.bundle
      if (!validBundle(b, action.keyStats, action.spMax) || state.addedBundles.some((x) => sameBundle(x, b))) return state
      const added: AddedBundle = { tab: b.tab, source: b.source, opponentId: b.opponentId, category: b.category, sp: { ...b.sp } }
      const nature = normalizeKeySigns(b.nature)
      if (nature !== undefined) added.nature = nature
      const pin = addedBundlePin(added)
      const pinnedBundles = state.pinnedBundles.some((p) => samePin(p, pin)) ? state.pinnedBundles : [...state.pinnedBundles, pin]
      return { ...bump(state, { addedBundles: [...state.addedBundles, added] }), pinnedBundles }
    }
    case 'remove-bundle': {
      const next = state.addedBundles.filter((x) => !sameBundle(x, action.bundle))
      if (next.length === state.addedBundles.length) return state
      const pin = addedBundlePin(action.bundle)
      return { ...bump(state, { addedBundles: next }), pinnedBundles: state.pinnedBundles.filter((p) => !samePin(p, pin)) }
    }
    case 'pin-bundle': {
      const p = action.pin
      if (!isTargetSource(p.source) || typeof p.opponentId !== 'string' || p.opponentId === '' || typeof p.key !== 'string' || p.key === '') return state
      if (p.item !== undefined && (typeof p.item !== 'string' || p.item === '')) return state
      if (state.pinnedBundles.some((x) => samePin(x, p))) return state
      const pin: PinnedBundle = { tab: p.tab, source: p.source, opponentId: p.opponentId, category: p.category, key: p.key }
      if (p.item !== undefined) pin.item = p.item
      return { ...state, pinnedBundles: [...state.pinnedBundles, pin] }
    }
    case 'unpin-bundle': {
      const pinnedBundles = state.pinnedBundles.filter((x) => !samePin(x, action.pin))
      const addedBundles = state.addedBundles.filter((x) => !samePin(addedBundlePin(x), action.pin))
      if (addedBundles.length !== state.addedBundles.length) return { ...bump(state, { addedBundles }), pinnedBundles }
      return pinnedBundles.length === state.pinnedBundles.length ? state : { ...state, pinnedBundles }
    }
    case 'choose-move': {
      const c = action.choice
      if (typeof c.opponentId !== 'string' || c.opponentId === '' || typeof c.key !== 'string' || c.key === '') return state
      if (state.moveChoices.some((x) => sameTarget(x, c) && x.key === c.key)) return state
      const choice: MoveChoice = { tab: c.tab, source: c.source, opponentId: c.opponentId, key: c.key }
      return { ...state, moveChoices: [...state.moveChoices.filter((x) => !sameTarget(x, c)), choice] }
    }
    case 'reset-move': {
      const moveChoices = state.moveChoices.filter((x) => !sameTarget(x, action))
      return moveChoices.length === state.moveChoices.length ? state : { ...state, moveChoices }
    }
    case 'add-move': {
      const m: AddedMove = { opponentId: action.opponentId, moveId: action.moveId }
      if (typeof m.opponentId !== 'string' || m.opponentId === '' || typeof m.moveId !== 'string' || m.moveId === '') return state
      if (state.addedMoves.some((x) => sameAddedMove(x, m))) return state
      const target = defenseLadder(m.opponentId)
      const choice: MoveChoice = { ...target, key: itemKey(m.moveId, baseConditionOf(m.moveId)) }
      const moveChoices = [...state.moveChoices.filter((x) => !sameTarget(x, target)), choice]
      return { ...bump(state, { addedMoves: [...state.addedMoves, m] }), moveChoices }
    }
    case 'remove-move': {
      const addedMoves = state.addedMoves.filter((x) => !sameAddedMove(x, action))
      if (addedMoves.length === state.addedMoves.length) return state
      const target = defenseLadder(action.opponentId)
      // 추가 기술은 전역이라 보관함 모든 칸의 선택도 같이 정리한다
      const dropChoice = (choices: readonly MoveChoice[]): readonly MoveChoice[] => {
        const kept = choices.filter((x) => !(sameTarget(x, target) && moveOfKey(x.key) === action.moveId))
        return kept.length === choices.length ? choices : kept
      }
      const slots = state.party.slots.map((s) => {
        if (s === null) return s
        const moveChoices = dropChoice(s.moveChoices)
        return moveChoices === s.moveChoices ? s : { ...s, moveChoices }
      })
      const party = slots.some((s, i) => s !== state.party.slots[i]) ? { ...state.party, slots } : state.party
      return { ...bump(state, { addedMoves }), moveChoices: dropChoice(state.moveChoices), party }
    }
    case 'add-lock': {
      const l = action.lock
      if (!validLock(l) || !isPositiveInt(action.spTotal) || (action.base !== undefined && typeof action.base !== 'string')) return state
      const replaced = conflictingLocks(state.locks, l.stats)
      const same = replaced.length === 1 && replaced[0].stage === l.stage && replaced[0].allocation === l.allocation && sameLockTarget(replaced[0].target, l.target)
      if (same && (action.base === undefined || action.base === state.lockBase)) return state
      const remaining = replaced.length === 0 ? state.locks : state.locks.filter((x) => !replaced.includes(x))
      const { draft, trims } = releaseLocks(state, remaining, { ...action.lockedSp, ...action.addingSp }, l.stats)
      const lock: CutLock = { seq: state.lockSeq, kind: l.kind, target: l.target, stage: l.stage, stats: [...l.stats] }
      if (l.allocation !== undefined) lock.allocation = l.allocation
      const lockReveal = state.lockReveal !== null && replaced.some((x) => x.seq === state.lockReveal?.seq) ? null : state.lockReveal
      return {
        ...state,
        draft,
        locks: [...remaining, lock],
        lockSeq: state.lockSeq + 1,
        lockBase: action.base ?? state.lockBase,
        lockNature: state.lockNature ?? natureOf(state.draft),
        lockSpTotal: state.lockSpTotal ?? action.spTotal,
        lockTrim: trims.length > 0 ? trims : null,
        lockReveal,
        generation: state.generation + 1,
        lockFit: state.generation + 1,
      }
    }
    case 'remove-lock': {
      const locks = state.locks.filter((l) => l.seq !== action.seq)
      if (locks.length === state.locks.length) return state
      const { draft, trims } = releaseLocks(state, locks, action.lockedSp)
      const lockTrim = trims.length > 0 ? trims : null
      if (locks.length === 0) return { ...state, ...CLEARED_LOCKS, draft, lockTrim, generation: state.generation + 1 }
      const lockReveal = state.lockReveal?.seq === action.seq ? null : state.lockReveal
      return { ...state, locks, draft, lockTrim, lockReveal, generation: state.generation + 1 }
    }
    case 'set-lock-base': {
      if (state.locks.length === 0 || (action.id !== null && typeof action.id !== 'string')) return state
      const next = bump(state, { lockBase: action.id })
      return next === state ? state : armFit({ ...next, lockTrim: null }, state)
    }
    case 'reveal-lock': {
      const lock = state.locks.find((l) => l.seq === action.seq)
      if (lock === undefined) return state
      const t = lock.target
      const filters =
        t.kind === 'speed' && t.filterKind !== null && !state.speedChart.filters[t.filterKind]
          ? { ...state.speedChart.filters, [t.filterKind]: true }
          : state.speedChart.filters
      return {
        ...state,
        tab: LOCK_TABS[lock.kind],
        lockReveal: { seq: lock.seq, nonce: state.lockRevealNonce + 1 },
        lockRevealNonce: state.lockRevealNonce + 1,
        speedChart: filters === state.speedChart.filters ? state.speedChart : { ...state.speedChart, filters },
      }
    }
    case 'clear-reveal':
      return state.lockReveal === null ? state : { ...state, lockReveal: null }
    case 'dismiss-lock-trim':
      return state.lockTrim === null ? state : { ...state, lockTrim: null }
    case 'fit-locks': {
      if (state.lockFit === null || action.token !== state.lockFit) return state
      const cleared = { ...state, lockFit: null }
      if (action.lockedSp === null || state.lockSpTotal === null) return cleared
      const sp = spTableOf(state.draft)
      // 기준 갈래 계산에서 빠진(문제) 고정의 능력치도 줄이지 않는다: 초안 값(해제 복원값)으로 센다.
      const lockedSp: Partial<Record<StatId, number>> = { ...action.lockedSp }
      for (const s of lockedStatsOf(state.locks)) lockedSp[s] ??= sp[s]
      const trims = fitUnlocked(sp, state.lockSpTotal, lockedSp)
      if (trims.length === 0) return cleared
      const draft = { ...state.draft, sp: { ...state.draft.sp } }
      for (const t of trims) draft.sp[t.stat] = String(t.to)
      return { ...cleared, draft, lockTrim: mergeTrims(state.lockTrim, trims), generation: state.generation + 1 }
    }
    case 'apply-adjust':
      return applyAdjust(state, action)
    case 'party-select': {
      const { index } = action
      if (!isPartyIndex(index) || index === state.party.active) return state
      const slots = [...state.party.slots]
      slots[state.party.active] = storedSlice(sliceOf(state))
      const target = slots[index] ?? blankSlice()
      slots[index] = null
      return enterSlice(state, target, { slots, active: index })
    }
    case 'party-clear-slot': {
      const { index } = action
      if (!isPartyIndex(index)) return state
      if (index === state.party.active) return storedSlice(sliceOf(state)) === null ? state : enterSlice(state, blankSlice(), state.party)
      if (state.party.slots[index] === null) return state
      const slots = [...state.party.slots]
      slots[index] = null
      return { ...state, party: { ...state.party, slots } }
    }
    case 'party-move': {
      const { from, to } = action
      if (!isPartyIndex(from) || !isPartyIndex(to) || from === to) return state
      const order = movedOrder(from, to)
      const { slots, active } = state.party
      return { ...state, party: { slots: order.map((i) => (i === active ? null : slots[i])), active: order.indexOf(active) } }
    }
    case 'party-clear-all':
      return enterSlice(state, blankSlice(), { slots: Array.from({ length: PARTY_SIZE }, () => null), active: 0 })
    case 'party-import': {
      if (!Array.isArray(action.slots)) return state
      const slices = Array.from({ length: PARTY_SIZE }, (_, i) => {
        const d = action.slots[i]
        return d === null || d === undefined ? null : storedSlice(draftSlice(d))
      })
      const top = slices[0] ?? blankSlice()
      slices[0] = null
      return enterSlice(state, top, { slots: slices, active: 0 })
    }
    case 'party-hydrate':
      return hydrate(state, action.saved)
  }
}

/**
 * 최상위에 slice를 올리고 party로 바꾼다. 일회성 신호는 비우고, 세대를 올리며 종을 바꾼 세대로 친다(펼친 카드 접기).
 * 종 변경 액션을 거치지 않으므로 slice의 고정이 그대로 남는다
 */
function enterSlice(state: AppState, slice: SlotSlice, party: PartyState): AppState {
  const generation = state.generation + 1
  return { ...state, ...sliceOf(slice), ...CLEARED_TRANSIENT, party, generation, speciesGeneration: generation }
}

function hydrate(state: AppState, saved: PartyHydration): AppState {
  if (typeof saved !== 'object' || saved === null || !Array.isArray(saved.slots)) return state
  const active = isPartyIndex(saved.active) ? saved.active : 0
  const slots = Array.from({ length: PARTY_SIZE }, (_, i) => saved.slots[i] ?? null)
  const top = slots[active] ?? blankSlice()
  slots[active] = null
  const g = saved.globals ?? {}
  const next = enterSlice(state, top, { slots, active })
  return {
    ...next,
    customTargets: g.customTargets ?? state.customTargets,
    addedBundles: g.addedBundles ?? state.addedBundles,
    addedMoves: g.addedMoves ?? state.addedMoves,
    pinnedBundles: g.pinnedBundles ?? state.pinnedBundles,
    speedChart: g.speedAdded === undefined ? state.speedChart : { ...state.speedChart, added: g.speedAdded },
  }
}

/**
 * 목록 밖 타겟 rosterId를 대상으로 한 고정인지. 스피드 고정 키는 출처 대신 배지 origin만 가진다: 목록 밖 타겟의 배지는
 * preset·added origin이고 rosterId는 메타 목록 밖 id라 래더 상대 id와 겹치지 않는다
 */
function targetsCustom(lock: CutLock, rosterId: string): boolean {
  const t = lock.target
  if (t.kind === 'speed') return t.origin !== 'ladder' && t.opponentId === rosterId
  return t.source === 'custom' && t.opponentId === rosterId
}

/** 그 조각의 고정 중 keep 밖을 remove-lock과 같은 규칙(해제 복원·자르기, 0개면 고정 상태 비움)으로 푼다. 바뀐 게 없으면 null */
function releaseSlice(slice: SlotSlice, keep: (l: CutLock) => boolean): { slice: SlotSlice; trims: LockTrim[] } | null {
  const locks = slice.locks.filter(keep)
  if (locks.length === slice.locks.length) return null
  const { draft, trims } = releaseLocks(slice, locks)
  if (locks.length > 0) return { slice: { ...slice, locks, draft }, trims }
  return { slice: { ...slice, draft, locks: [], lockSeq: 1, lockBase: null, lockNature: null, lockSpTotal: null }, trims }
}

/** 최상위와 보관함 모든 칸에서 rosterId 대상 고정을 푼다 */
function dropCustomLocks(state: AppState, rosterId: string): AppState {
  const keep = (l: CutLock) => !targetsCustom(l, rosterId)
  let party = state.party
  const slots = party.slots.map((s) => (s === null ? s : (releaseSlice(s, keep)?.slice ?? s)))
  if (slots.some((s, i) => s !== party.slots[i])) party = { ...party, slots }
  const top = releaseSlice(sliceOf(state), keep)
  if (top === null) return party === state.party ? state : { ...state, party }
  const { slice, trims } = top
  const kept = new Set(slice.locks.map((l) => l.seq))
  return {
    ...state,
    ...slice,
    party,
    lockTrim: trims.length > 0 ? trims : null,
    lockReveal: state.lockReveal !== null && kept.has(state.lockReveal.seq) ? state.lockReveal : null,
    lockFit: slice.locks.length === 0 ? null : state.lockFit,
    generation: state.generation + 1,
  }
}

function applyAdjust(state: AppState, action: Extract<AppAction, { type: 'apply-adjust' }>): AppState {
  const locked = lockedStatsOf(state.locks)
  const written = new Map<StatId, number>()
  for (const s of Object.keys(action.sp) as StatId[]) {
    const v = action.sp[s]
    if (locked.has(s) || typeof v !== 'number' || !Number.isFinite(v)) continue
    written.set(s, Math.max(0, Math.min(Math.round(v), action.rules.spMaxPerStat)))
  }
  const sp = { ...state.draft.sp }
  for (const [s, v] of written) sp[s] = String(v)
  let draft: SetDraft = action.nature === undefined ? { ...state.draft, sp } : restoreNature({ ...state.draft, sp }, action.nature)
  const lockBase = state.locks.length > 0 && action.lockBase !== undefined ? action.lockBase : state.lockBase

  const table = spTableOf(draft)
  // 우선순위: 기준 갈래 고정 SP > 빠진 고정 능력치의 초안 값(해제 복원값) > keep·쓴 능력치의 새 값.
  const fixed: Partial<Record<StatId, number>> = { ...action.lockedSp }
  for (const s of locked) fixed[s] ??= table[s]
  for (const s of [...action.keep, ...written.keys()]) fixed[s] ??= table[s]
  const trims = fitUnlocked(table, state.lockSpTotal ?? action.rules.spTotal, fixed)
  if (trims.length > 0) {
    draft = { ...draft, sp: { ...draft.sp } }
    for (const t of trims) draft.sp[t.stat] = String(t.to)
  }

  if (trims.length === 0 && lockBase === state.lockBase && same(draft, state.draft)) return state
  return { ...state, draft, lockBase, lockTrim: trims.length > 0 ? trims : null, lockFit: null, generation: state.generation + 1 }
}
