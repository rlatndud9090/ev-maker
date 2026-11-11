// 제품 화면 상태와 리듀서(React 없음). 계산 입력이 바뀔 때만 세대를 올린다.
import type { StatId } from '../data/schema'
import type { MatchType } from '../data/meta-schema'
import {
  DEFAULT_CRITERIA,
  DEFAULT_ROLL_STEPS,
  ROLL_STEPS,
  DEFAULT_TOP_N,
  MAX_CUSTOM_MOVES,
  type CardConditions,
  type CardFilters,
  type CustomTarget,
  type DisplayCriteria,
  type PresetEdit,
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
  /** 계산 입력이 바뀔 때만 +1(탭 전환·같은 값 확정은 그대로) */
  generation: number
}

export type AppAction =
  | { type: 'set-draft'; draft: SetDraft }
  | { type: 'commit-sp'; stat: StatId; value: number }
  | { type: 'set-meta'; meta: { match: MatchType; month: string } }
  | { type: 'set-tab'; tab: Tab }
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
    generation: 0,
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
  if (c.cardsPerCategory !== undefined && !isPositiveInt(c.cardsPerCategory)) return false
  return true
}

const validMoves = (moves: readonly string[]): boolean =>
  moves.length >= 1 && moves.length <= MAX_CUSTOM_MOVES && new Set(moves).size === moves.length && moves.every((m) => typeof m === 'string' && m !== '')

function updateTarget(state: AppState, rosterId: string, f: (t: CustomTarget) => CustomTarget): AppState {
  const i = state.customTargets.findIndex((t) => t.rosterId === rosterId)
  if (i < 0) return state
  const next = [...state.customTargets]
  next[i] = f(next[i])
  return bump(state, { customTargets: next })
}

export function reducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'set-draft':
      return bump(state, { draft: action.draft })
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
  }
}
