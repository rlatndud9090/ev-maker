// 컷 고정 화면 문맥: 실행기 고정 스냅샷 + 리듀서 상태 → 화면이 읽는 값과 조작. Provider 없이 쓰면 "고정 없음"이다.
import { createContext, useContext, type Dispatch } from 'react'
import { checkLockCandidate, type AdjustAllocation, type AdjustView, type CutLock, type LockCandidate, type LockCheck, type LockDerivation, type LockResolution, type Tab } from '../cards'
import type { PokemonSet } from '../core'
import type { Snapshot } from '../data/schema'
import { toPokemonSet } from '../ui/setDraft'
import { adjustAction } from './adjustAction'
import type { LockSnapshot } from './executor'
import type { AppAction, AppState } from './state'

export type LockCheckView = LockCheck | { kind: 'computing' }

export interface LockUi {
  /** false = Provider 없음(고정 조작을 그리지 않는다) */
  enabled: boolean
  /** 지금 실행 세대의 파생. 고정이 없거나 계산 중이면 null */
  derivation: LockDerivation | null
  /** 고정이 있는데 지금 실행 세대의 파생이 아직 없음 */
  pending: boolean
  locks: readonly CutLock[]
  /** 기준 갈래 값이 적힌 계획 세트(활성 고정이 없으면 null) */
  planSet: PokemonSet | null
  /** 후보를 지금 고정에 더한 상태(cards checkLockCandidate). 후보·고정 해석이 계산 중이면 computing(비활성 아님) */
  check(candidate: LockCandidate): LockCheckView
  addLock(lock: Omit<CutLock, 'seq'>): void
  removeLock(seq: number): void
  /** null = 자동 규칙 */
  setBase(id: string | null): void
  reveal: AppState['lockReveal']
  clearReveal(): void
  /** 조정 팝오버에서 고른 결과(view.results index)·성격 선택지(view.natures index)·배분(없으면 합 최소)을 내 세트에 적용한다. ok가 아닌 선택지·없는 배분·고정 파생 계산 중에는 무시 */
  applyAdjust(view: AdjustView, result: number, option: number, allocation?: AdjustAllocation): void
  /** 조정 팝오버를 연 카드 id(닫으면 null). 핀 단계 메뉴와 같은 후보 수요(실행기 setDetailCards)로 합친다 */
  onAdjustCard(tab: Tab, cardId: string | null): void
  /** 핀 단계 메뉴를 연 카드 id(닫으면 null) */
  onPinMenu(tab: Tab, cardId: string | null): void
  trim: AppState['lockTrim']
  dismissTrim(): void
}

const noop = (): void => {}

export const NO_LOCK_UI: LockUi = {
  enabled: false,
  derivation: null,
  pending: false,
  locks: [],
  planSet: null,
  check: () => ({ kind: 'computing' }),
  addLock: noop,
  removeLock: noop,
  setBase: noop,
  reveal: null,
  clearReveal: noop,
  applyAdjust: noop,
  onAdjustCard: noop,
  onPinMenu: noop,
  trim: null,
  dismissTrim: noop,
}

export const LockUiContext = createContext<LockUi>(NO_LOCK_UI)

export const useLockUi = (): LockUi => useContext(LockUiContext)

export interface LockUiDeps {
  game: Snapshot
  state: Pick<AppState, 'draft' | 'locks' | 'lockReveal' | 'lockTrim'>
  /** 실행기 스냅샷의 locks */
  snapshot: LockSnapshot | null
  /** lockRuntime의 실행 세대(리듀서 세대가 아니다) */
  runGeneration: number
  dispatch: Dispatch<AppAction>
  onAdjustCard(tab: Tab, cardId: string | null): void
  onPinMenu(tab: Tab, cardId: string | null): void
}

const NO_RESOLUTIONS: ReadonlyMap<number, LockResolution> = new Map()

/** Provider 값. 다른 실행 세대의 스냅샷은 쓰지 않는다 */
export function lockUiValue({ game, state, snapshot, runGeneration, dispatch, onAdjustCard, onPinMenu }: LockUiDeps): LockUi {
  const current = snapshot !== null && snapshot.generation === runGeneration && !snapshot.pending ? snapshot : null
  const hasLocks = state.locks.length > 0
  const pending = hasLocks && current === null
  const spTotal = game.manifest.rules.spTotal
  const derivation = hasLocks ? (current?.derivation ?? null) : null
  return {
    enabled: true,
    derivation,
    pending,
    locks: state.locks,
    planSet: hasLocks ? (current?.planSet ?? null) : null,
    check(candidate) {
      if (candidate.kind === 'computing' || pending) return { kind: 'computing' }
      return checkLockCandidate({
        game,
        mySet: toPokemonSet(game, state.draft).set,
        locks: state.locks,
        resolutions: hasLocks ? (current?.resolutions ?? NO_RESOLUTIONS) : NO_RESOLUTIONS,
        candidate,
      })
    },
    addLock: (lock) => dispatch({ type: 'add-lock', lock, spTotal }),
    removeLock: (seq) => {
      const d = hasLocks ? current?.derivation : undefined
      const base = d?.branches.find((b) => b.id === d.baseId)
      dispatch(base === undefined ? { type: 'remove-lock', seq } : { type: 'remove-lock', seq, lockedSp: base.lockedSp })
    },
    setBase: (id) => dispatch({ type: 'set-lock-base', id }),
    reveal: state.lockReveal,
    clearReveal: () => dispatch({ type: 'clear-reveal' }),
    applyAdjust: (view, result, option, allocation) => {
      if (pending) return
      const action = adjustAction({ game, draft: state.draft, derivation, view, result, option, allocation })
      if (action !== null) dispatch(action)
    },
    onAdjustCard,
    onPinMenu,
    trim: state.lockTrim,
    dismissTrim: () => dispatch({ type: 'dismiss-lock-trim' }),
  }
}
