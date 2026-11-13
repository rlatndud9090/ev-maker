// 제품 화면 상태와 리듀서(React 없음). 계산 입력이 바뀔 때만 세대를 올린다.
import type { StatId } from '../data/schema'
import type { MatchType } from '../data/meta-schema'
import {
  DEFAULT_CRITERIA,
  DEFAULT_ROLL_STEPS,
  ROLL_STEPS,
  DEFAULT_TOP_N,
  MAX_CUSTOM_MOVES,
  BASE_CONDITION_ID,
  addedBundlePin,
  itemKey,
  opponentKey,
  samePin,
  type AddedBundle,
  type AddedMove,
  type CardConditions,
  type CardFilters,
  type CustomTarget,
  type DisplayCriteria,
  type PinnedBundle,
  type PresetEdit,
  type SortMode,
  type Tab,
} from '../cards'
import type { SetDraft } from '../ui/setDraft'
import { EXAMPLE_DRAFT } from './example'

export interface AppState {
  regulation: string
  /** null = 기본(resolveMetaSelection 규칙: 최근 월에서 판수가 더 많은 매치 방식, 동률 Bo1) */
  meta: { match: MatchType; month: string } | null
  /** 확정된 내 세트 초안(status 'none'·boosts 0 고정) */
  draft: SetDraft
  conditions: CardConditions
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
}

/** 직접 고른 기술 항목. key = cards itemKey(기술, 랭크 조건) */
export interface MoveChoice {
  tab: Tab
  source: 'ladder' | 'custom'
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
   */
  | { type: 'switch-species'; from: string | undefined; to: string; draft: SetDraft }
  | { type: 'commit-sp'; stat: StatId; value: number }
  | { type: 'set-meta'; meta: { match: MatchType; month: string } }
  | { type: 'set-tab'; tab: Tab }
  | { type: 'set-sort'; mode: SortMode }
  | { type: 'set-tailwind'; side: 'me' | 'opponent'; on: boolean }
  | { type: 'set-criteria'; criteria: Partial<DisplayCriteria> }
  /** steps가 1~ROLL_STEPS−1 정수가 아니면 무시 */
  | { type: 'set-roll-steps'; steps: number }
  | { type: 'set-top-n'; topN: number }
  | { type: 'set-selected'; ids: readonly string[] }
  /** moves가 1~MAX_CUSTOM_MOVES개가 아니거나 rosterId가 이미 있으면 무시 */
  | { type: 'add-custom-target'; rosterId: string; moves: readonly string[] }
  | { type: 'remove-custom-target'; rosterId: string }
  | { type: 'edit-preset'; rosterId: string; key: string; edit: PresetEdit }
  /** 0개 또는 초과면 무시(최소 1개 유지) */
  | { type: 'set-custom-moves'; rosterId: string; moves: readonly string[] }
  /**
   * sp 키가 keyStats와 같은 집합이 아니거나 값이 0~spMax 정수가 아니면 무시. 같은 (탭, 상대, 분류, SP)가 이미 있으면 무시.
   * keyStats = 그 카드 묶음의 키 능력치, spMax = 레귤레이션 능력치당 SP 상한.
   * 상태는 계획을 모르므로(계층: cards ← app) 이 검증은 호출자가 준 값 기준의 1차 거름이다. 최종 권한은 계획(plan.userSeeds)이
   * 갖는다 — 게임의 키 능력치 집합·SP 상한과 맞지 않거나 관측 묶음과 키가 같은 항목은 카드를 만들지 않는다(화면은 같은 키의
   * 관측 묶음을 고른다: cards chosenOption). 그런 항목은 상태에 남아 기준이 바뀌어 관측 묶음이 빠지면 다시 카드가 된다.
   */
  | { type: 'add-bundle'; bundle: AddedBundle; keyStats: readonly StatId[]; spMax: number }
  /** 같은 (탭, 상대, 분류, SP)를 지운다(고정도 함께). 없으면 무시 */
  | { type: 'remove-bundle'; bundle: AddedBundle }
  /** 래더 배분 고정(맨 뒤에 붙는다). 이미 고정이거나 상대 id·키가 빈 문자열이면 무시 */
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
  | { type: 'reset-move'; tab: Tab; source: 'ladder' | 'custom'; opponentId: string }
  /** 방어 탭 래더 상대 기술 추가 + 그 기술 랭크 전 항목 직접 선택. 빈 문자열이거나 이미 있으면 무시 */
  | { type: 'add-move'; opponentId: string; moveId: string }
  /** 추가한 기술 삭제. 그 기술이 직접 선택돼 있으면(랭크 후 항목 포함) 선택도 해제. 없으면 무시 */
  | { type: 'remove-move'; opponentId: string; moveId: string }

export function initialState(regulation: string): AppState {
  return {
    regulation,
    meta: null,
    draft: EXAMPLE_DRAFT,
    conditions: { myTailwind: false, opponentTailwind: false },
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
  if (c.berryShareMin !== undefined && !isRatio(c.berryShareMin)) return false
  if (c.powerItemShareMin !== undefined && !isRatio(c.powerItemShareMin)) return false
  return true
}

const validMoves = (moves: readonly string[]): boolean =>
  moves.length >= 1 && moves.length <= MAX_CUSTOM_MOVES && new Set(moves).size === moves.length && moves.every((m) => typeof m === 'string' && m !== '')

/** 같은 (탭, 상대, 분류, SP) 배분인지 */
export function sameBundle(a: AddedBundle, b: AddedBundle): boolean {
  if (a.tab !== b.tab || a.opponentId !== b.opponentId || a.category !== b.category) return false
  const ka = Object.keys(a.sp) as StatId[]
  const kb = Object.keys(b.sp) as StatId[]
  return ka.length === kb.length && ka.every((k) => a.sp[k] === b.sp[k])
}

function validBundle(bundle: AddedBundle, keyStats: readonly StatId[], spMax: number): boolean {
  if (typeof bundle.opponentId !== 'string' || bundle.opponentId === '') return false
  const keys = Object.keys(bundle.sp) as StatId[]
  const expected = new Set(keyStats)
  if (expected.size === 0 || keys.length !== expected.size || !keys.every((k) => expected.has(k))) return false
  return keys.every((k) => {
    const v = bundle.sp[k]
    return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= spMax
  })
}

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
      const next = bump(state, { draft: action.draft })
      if (next === state || sameBeyondSpNature(state.draft, action.draft) || next.moveChoices.length === 0) return next
      return { ...next, moveChoices: [] }
    }
    case 'switch-species': {
      if (action.from === action.to) return reducer(state, { type: 'set-draft', draft: action.draft })
      const draftCache = action.from === undefined ? state.draftCache : { ...state.draftCache, [action.from]: state.draft }
      const kept = Object.prototype.hasOwnProperty.call(draftCache, action.to) ? draftCache[action.to] : undefined
      const next = reducer(state, { type: 'set-draft', draft: kept === undefined ? action.draft : { ...kept, species: action.draft.species } })
      return { ...next, draftCache, speciesGeneration: next.generation === state.generation ? state.speciesGeneration : next.generation }
    }
    case 'commit-sp': {
      if (!Number.isInteger(action.value)) return state
      return bump(state, { draft: { ...state.draft, sp: { ...state.draft.sp, [action.stat]: String(action.value) } } })
    }
    case 'set-meta': {
      if (same(state.meta, action.meta)) return state
      return { ...state, meta: { ...action.meta }, filters: { ...state.filters, selected: [] }, generation: state.generation + 1 }
    }
    case 'set-tab':
      return state.tab === action.tab ? state : { ...state, tab: action.tab }
    case 'set-sort':
      if (action.mode !== 'usage' && action.mode !== 'result') return state
      return state.sortMode === action.mode ? state : { ...state, sortMode: action.mode }
    case 'set-tailwind':
      return bump(state, {
        conditions: action.side === 'me' ? { ...state.conditions, myTailwind: action.on } : { ...state.conditions, opponentTailwind: action.on },
      })
    case 'set-criteria':
      if (!validCriteria(action.criteria)) return state
      return bump(state, { criteria: { ...state.criteria, ...action.criteria } })
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
      return next.length === state.customTargets.length ? state : bump(state, { customTargets: next })
    }
    case 'edit-preset':
      return updateTarget(state, action.rosterId, (t) => ({ ...t, edits: { ...t.edits, [action.key]: { ...action.edit } } }))
    case 'set-custom-moves':
      if (!validMoves(action.moves)) return state
      return updateTarget(state, action.rosterId, (t) => ({ ...t, moves: [...action.moves] }))
    case 'add-bundle': {
      const b = action.bundle
      if (!validBundle(b, action.keyStats, action.spMax) || state.addedBundles.some((x) => sameBundle(x, b))) return state
      const added: AddedBundle = { tab: b.tab, opponentId: b.opponentId, category: b.category, sp: { ...b.sp } }
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
      if (typeof p.opponentId !== 'string' || p.opponentId === '' || typeof p.key !== 'string' || p.key === '') return state
      if (p.item !== undefined && (typeof p.item !== 'string' || p.item === '')) return state
      if (state.pinnedBundles.some((x) => samePin(x, p))) return state
      const pin: PinnedBundle = { tab: p.tab, opponentId: p.opponentId, category: p.category, key: p.key }
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
      const choice: MoveChoice = { ...target, key: itemKey(m.moveId, BASE_CONDITION_ID) }
      const moveChoices = [...state.moveChoices.filter((x) => !sameTarget(x, target)), choice]
      return { ...bump(state, { addedMoves: [...state.addedMoves, m] }), moveChoices }
    }
    case 'remove-move': {
      const addedMoves = state.addedMoves.filter((x) => !sameAddedMove(x, action))
      if (addedMoves.length === state.addedMoves.length) return state
      const target = defenseLadder(action.opponentId)
      const moveChoices = state.moveChoices.filter((x) => !(sameTarget(x, target) && moveOfKey(x.key) === action.moveId))
      return { ...bump(state, { addedMoves }), moveChoices: moveChoices.length === state.moveChoices.length ? state.moveChoices : moveChoices }
    }
  }
}
