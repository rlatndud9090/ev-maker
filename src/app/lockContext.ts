// 컷 고정 화면 문맥: 실행기 고정 스냅샷 + 리듀서 상태 → 화면이 읽는 값과 조작. Provider 없이 쓰면 "고정 없음"이다.
import { createContext, useContext, type Dispatch } from 'react'
import {
  checkLockCandidate,
  pinDisabledReason,
  pinMenuView,
  type AdjustAllocation,
  type AdjustView,
  type CardLockPin,
  type CutLock,
  type LockCandidate,
  type LockCheck,
  type LockDerivation,
  type LockResolution,
  type PinEmptyReason,
  type PinMenuView,
  type Tab,
} from '../cards'
import type { PokemonSet } from '../core'
import type { Snapshot, StatId } from '../data/schema'
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
  /** 공·방 카드 핀 메뉴 모델(cards pinMenuView). 고정 파생·후보가 계산 중이면 computing */
  pinMenu(tab: Tab, pin: CardLockPin): PinMenuView
  /**
   * 빈 핀이 고를 수 있는 선택지가 없다고 판정됐으면 그 이유(핀 비활성). 고정이 없거나 고정 파생·단계 후보가 하나라도 계산 중이거나
   * 찬 핀·고정 불가 핀이면 undefined(활성). 같은 Provider 값 안에서 단계 후보 목록(조립 결과 객체)마다 메모한다.
   * viewCurrent = 그 핀이 든 탭 뷰가 지금 실행 세대의 뷰인가(밀려난 뷰의 이전 세대 후보를 새 세대 고정·초안으로 판정하지 않는다, R6). false면 활성
   */
  pinDisabled(tab: Tab, pin: CardLockPin, viewCurrent: boolean): PinEmptyReason | undefined
  /** 핀 메뉴에서 고른 결과·성격 선택지·배분의 고정을 더한다(교체·기준 갈래·자동 조정 대기까지 add-lock 한 번). 고를 수 없는 선택지·없는 H 최대·계산 중에는 무시 */
  pinLock(view: PinMenuView, result: number, option: number, allocation: AdjustAllocation): void
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

const PIN_COMPUTING: PinMenuView = { state: 'computing', natures: [], results: [], picks: [] }

export const NO_LOCK_UI: LockUi = {
  enabled: false,
  derivation: null,
  pending: false,
  locks: [],
  planSet: null,
  check: () => ({ kind: 'computing' }),
  addLock: noop,
  pinMenu: () => PIN_COMPUTING,
  pinDisabled: () => undefined,
  pinLock: noop,
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
/** 카드 목록의 탭 뷰가 지금 실행 세대의 뷰인가(ResultPanel이 준다, 밀려난 뷰 = false). 핀 비활성 판정(pinDisabled)의 viewCurrent */
export const ViewCurrentContext = createContext(false)

export const useLockUi = (): LockUi => useContext(LockUiContext)

export interface LockUiDeps {
  game: Snapshot
  state: Pick<AppState, 'draft' | 'locks' | 'lockBase' | 'lockReveal' | 'lockTrim'>
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
  const pinMenu = (tab: Tab, pin: CardLockPin): PinMenuView => {
    if (pending || tab === 'speed' || pin.control.kind !== 'lockable') return PIN_COMPUTING
    return pinMenuView({
      game,
      mySet: toPokemonSet(game, state.draft).set,
      locks: state.locks,
      resolutions: hasLocks ? (current?.resolutions ?? NO_RESOLUTIONS) : NO_RESOLUTIONS,
      lockBase: state.lockBase,
      side: tab,
      stages: pin.control.stages,
      ...(pin.current === undefined ? {} : { current: pin.current }),
    })
  }
  // 판정 메모: 단계 후보 목록 객체 키(후보가 계산 중 → 준비로 바뀌면 새 객체라 처음 본 "계산 중 = 활성"이 굳지 않는다). null = 활성
  const disabledMemo = new WeakMap<object, PinEmptyReason | null>()
  /** 지금 실행 세대의 기준 갈래(해제 자르기에서 남은 고정 능력치를 이 값으로 센다) */
  const baseBranch = () => {
    const d = hasLocks ? current?.derivation : undefined
    return d?.branches.find((b) => b.id === d.baseId)
  }
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
    addLock: (lock) => {
      const base = baseBranch()
      dispatch(base === undefined ? { type: 'add-lock', lock, spTotal } : { type: 'add-lock', lock, spTotal, lockedSp: base.lockedSp })
    },
    pinMenu,
    pinDisabled(tab, pin, viewCurrent) {
      // 밀려난(이전 세대) 뷰의 후보는 판정하지 않는다: 새 세대 뷰가 나오면 그 후보(계산 중 → 준비)로 판정한다.
      // 고정이 없으면 다른 고정과의 충돌·SP 부족이 없고 도달 불가는 고정 불가 핀(blocked)이 다룬다(판정하는 경로와 같은 결과, 단위 테스트로 고정)
      if (!viewCurrent || !hasLocks || pending || tab === 'speed' || (pin.lockedBy?.length ?? 0) > 0) return undefined
      const control = pin.control
      if (control.kind !== 'lockable' || control.stages.some((s) => s.candidate.kind !== 'ready')) return undefined
      let r = disabledMemo.get(control)
      if (r === undefined) {
        r = pinDisabledReason(pinMenu(tab, pin)) ?? null
        disabledMemo.set(control, r)
      }
      return r ?? undefined
    },
    pinLock: (view, result, option, allocation) => {
      if (pending) return
      const pick = view.picks[result]?.[option]
      const o = view.results[result]?.options[option]
      // H 최대는 그 배분의 고정·기준 갈래를 따로 쓴다(자동 규칙 갈래가 합 최소와 다를 수 있다)
      const chosen = allocation === 'h-max' ? pick?.hMax : (pick ?? undefined)
      if (chosen === undefined || o?.kind !== 'ok' || (allocation === 'h-max' && o.hMax === undefined)) return
      const base = baseBranch()
      // 메뉴에 보인 값 = 고정 뒤 기준 갈래 값. 해제 자르기가 새 고정 능력치를 교체 전 값으로 세지 않게 함께 보낸다
      const addingSp: Partial<Record<StatId, number>> = {}
      for (const st of allocation === 'h-max' ? (o.hMax ?? []) : o.stats) addingSp[st.stat] = st.sp
      dispatch({
        type: 'add-lock',
        lock: chosen.lock,
        spTotal,
        addingSp,
        ...(chosen.base === undefined ? {} : { base: chosen.base }),
        ...(base === undefined ? {} : { lockedSp: base.lockedSp }),
      })
    },
    removeLock: (seq) => {
      const base = baseBranch()
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
