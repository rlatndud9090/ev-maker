import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react'
import { TABS, type ErrorReason, type MetaSourceView, type SpeedChartInput, type Tab } from '../cards'
import type { EvalOptions, PokemonSet, SpTable } from '../core'
import type { RegulationIndex, Snapshot } from '../data/schema'
import type { MetaIndex, MetaSnapshot } from '../data/meta-schema'
import { loadRegulationIndex, loadSnapshot } from '../data/loader'
import { loadMetaIndex, loadMetaSnapshot } from '../data/meta-loader'
import { resolveMetaSelection } from '../data/meta-guard'
import { createMetaView, type MetaView } from '../meta'
import { errorLines } from '../ui/labels'
import { Errors } from '../ui/Errors'
import { Licenses } from '../ui/Licenses'
import { toPokemonSet } from '../ui/setDraft'
import { toCardInput } from './input'
import { createDisplaySpStore } from './displaySp'
import { abilityOf } from './myAbility'
import type { Reveal, RevealRequest } from './reveal'
import { initialState, moveSelections, reducer } from './state'
import { activeSlotEmpty } from './party'
import { usePartyPersistence } from './persist'
import { useExecutor } from './useExecutor'
import { LockUiContext, lockUiValue } from './lockContext'
import { useLockRuntime } from './lockRuntime'
import { baseLockedSp } from './spLimit'
import { CustomTargetPanel } from './components/CustomTargetPanel'
import { Popover } from './components/Popover'
import { MySetPanel } from './components/MySetPanel'
import { PartyBar } from './components/PartyBar'
import { EMPTY_SLOT_TEXT } from './components/partyText'
import { ResultBox } from './components/ResultBox'
import { ResultPanel } from './components/ResultPanel'
import { SpeedTab } from './components/SpeedTab'
import { Toolbar } from './components/Toolbar'

interface Boot {
  game: Snapshot
  regIndex: RegulationIndex
  metaIndex: MetaIndex
  /** 기본 메타(최근 월 Bo1) */
  view: MetaView
}

type Loaded = { status: 'loading' } | { status: 'ok'; boot: Boot } | { status: 'error'; errors: string[] }

const metaKey = (regulation: string, match: string, month: string) => JSON.stringify([regulation, match, month])

const sourceOf = (meta: MetaSnapshot): MetaSourceView => ({
  match: meta.manifest.match,
  month: meta.manifest.month,
  cutoff: meta.manifest.source.cutoff,
  format: meta.manifest.source.format,
})

export function ProductApp() {
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' })

  useEffect(() => {
    let live = true
    ;(async () => {
      const regIndex = await loadRegulationIndex()
      const [game, metaIndex] = await Promise.all([loadSnapshot(regIndex.default), loadMetaIndex()])
      const meta = await loadMetaSnapshot({ regulation: game.manifest.regulation.id })
      return { game, regIndex, metaIndex, view: createMetaView(meta, game) }
    })().then(
      (boot) => live && setLoaded({ status: 'ok', boot }),
      (e: unknown) => live && setLoaded({ status: 'error', errors: errorLines(e) }),
    )
    return () => {
      live = false
    }
  }, [])

  const game = loaded.status === 'ok' ? loaded.boot.game : undefined
  return (
    <>
    <main data-app="product" className="product">
      {loaded.status === 'loading' && (
        <p className="hint" role="status">
          데이터를 불러오는 중…
        </p>
      )}
      {loaded.status === 'error' && <Errors title="데이터를 불러오지 못했습니다" lines={loaded.errors} />}
      {loaded.status === 'ok' && <Workspace boot={loaded.boot} />}
    </main>
    {/* 뷰포트에 맞춘 작업 영역 아래, 페이지 스크롤로 닿는 구분된 페이지 푸터 */}
    <footer className="product-footer">
      <div data-testid="licenses">
        <Licenses snapshot={game} />
      </div>
    </footer>
    </>
  )
}

/** 탭을 바꿔도 '포켓몬 추가'는 열린 채 고른 포켓몬을 유지한다(탭 누름은 바깥 누름이 아니다) */
const KEEP_OPEN_ON = '[role="tab"]'
const IGNORE_TOTAL: EvalOptions = { ignoreSpTotal: true }
const NO_REASONS: readonly ErrorReason[] = []

function Workspace({ boot }: { boot: Boot }) {
  const { game } = boot
  const regulation = game.manifest.regulation.id
  const [state, dispatch] = useReducer(reducer, regulation, initialState)
  usePartyPersistence(state, dispatch, game)
  const emptySlot = activeSlotEmpty(state)
  const { executor, snapshot } = useExecutor()
  // 패널은 탭마다 다른 트리에 다시 그려지므로 열림·고른 포켓몬을 여기 둔다. autoFocus = 이번 열기에서 아직 검색창에 포커스하지 않음
  const [addPanel, setAddPanel] = useState<{ open: boolean; rosterId: string | null; autoFocus: boolean }>({ open: false, rosterId: null, autoFocus: false })
  const customOpen = addPanel.open
  const [reveal, setReveal] = useState<Reveal | null>(null)
  const revealNonce = useRef(0)
  const customButton = useRef<HTMLButtonElement>(null)
  const results = useRef<HTMLDivElement>(null)

  // 좁은 화면의 목록 박스 높이(100dvh - 탭 줄)를 위해 탭 줄 높이를 CSS 변수로 알린다.
  useEffect(() => {
    const host = results.current
    const row = host?.querySelector<HTMLElement>('.tabs-row')
    if (!host || !row) return
    const ro = new ResizeObserver(() => host.style.setProperty('--tabs-row-h', `${row.offsetHeight}px`))
    ro.observe(row)
    return () => ro.disconnect()
  }, [])

  const selection = useMemo(() => {
    const sel = resolveMetaSelection(boot.metaIndex, boot.regIndex, { regulation, ...(state.meta ?? {}) })
    return { match: sel.match, month: sel.month }
  }, [boot, regulation, state.meta])
  const requestKey = metaKey(regulation, selection.match, selection.month)

  const [meta, setMeta] = useState<{ key: string; view: MetaView }>(() => ({
    key: metaKey(regulation, boot.view.meta.manifest.match, boot.view.meta.manifest.month),
    view: boot.view,
  }))
  const [metaError, setMetaError] = useState<string[] | null>(null)

  // 실패하면 선택을 마지막으로 불러온 메타로 되돌린다(실패한 로드는 캐시에서 빠져 다시 고르면 재시도된다).
  useEffect(() => {
    if (meta.key === requestKey) return
    let live = true
    loadMetaSnapshot({ regulation, match: selection.match, month: selection.month })
      .then((m) => createMetaView(m, game))
      .then(
        (view) => {
          if (!live) return
          setMeta({ key: requestKey, view })
          setMetaError(null)
        },
        (e: unknown) => {
          if (!live) return
          setMetaError(errorLines(e))
          const loaded = meta.view.meta.manifest
          dispatch({ type: 'set-meta', meta: { match: loaded.match, month: loaded.month } })
        },
      )
    return () => {
      live = false
    }
  }, [requestKey, meta, regulation, selection, game])

  const ready = meta.key === requestKey ? meta.view : undefined
  const { draft, customTargets, tab } = state
  // 탭 전환도 새 입력 객체를 만들지만 세대가 같아 실행기가 무시한다.
  const input = useMemo(() => (ready === undefined ? undefined : toCardInput(state, game, ready)), [ready, state, game])
  // 실행기와 화면의 모든 세대 비교는 리듀서 세대가 아니라 실행 세대로 한다.
  const { lockRun, runGeneration } = useLockRuntime(state, game, ready)

  useEffect(() => {
    executor.setActiveTab(tab)
  }, [executor, tab])
  useEffect(() => {
    if (input !== undefined) executor.setInput(input, runGeneration, lockRun)
  }, [executor, input, runGeneration, lockRun])
  // 직접 고른 기술은 계산 입력이 아니라 실행기에 수요로만 알린다(세대를 바꾸지 않는다).
  useEffect(() => {
    for (const t of TABS) executor.setSelections(t, moveSelections(state.moveChoices, t))
  }, [executor, state.moveChoices])

  const [displaySp] = useState(createDisplaySpStore)
  const onDisplaySp = useCallback(
    (sp: SpTable | null) => {
      displaySp.set(sp)
      executor.setDisplaySp(sp)
    },
    [executor, displaySp],
  )
  // 확정으로 초안이 바뀌면 화면용 표시 SP도 비운다(실행기 setInput은 자기 사본만 비운다). 칠하기 전에 비워 드래그 전 값으로 튀지 않는다.
  useLayoutEffect(() => {
    displaySp.set(null)
  }, [displaySp, draft])
  // 기술 선택 목록을 연 줄의 항목 변동 판정도 계산 입력이 아니라 수요다.
  const onMenuCards = useCallback((t: Tab, cardIds: readonly string[]) => executor.setMenuCards(t, cardIds), [executor])
  // 보이는 카드도 수요다(고정이 있을 때 다른 계산 뒤 미리 계산 대상)
  const onVisibleCards = useCallback((t: Tab, cardIds: readonly string[]) => executor.setVisibleCards(t, cardIds), [executor])
  // 조정 팝오버를 연 카드와 핀 단계 메뉴를 연 카드는 같은 고정 후보·조정 수요(setDetailCards)로 합쳐 알린다.
  const [lockDemand] = useState(() => new Map<Tab, { adjust: readonly string[]; pin: readonly string[] }>())
  const pushLockDemand = useCallback(
    (t: Tab, patch: { adjust?: readonly string[]; pin?: readonly string[] }) => {
      const next = { adjust: [], pin: [], ...lockDemand.get(t), ...patch }
      lockDemand.set(t, next)
      executor.setDetailCards(t, [...new Set([...next.adjust, ...next.pin])])
    },
    [executor, lockDemand],
  )
  const onAdjustCard = useCallback((t: Tab, cardId: string | null) => pushLockDemand(t, { adjust: cardId === null ? [] : [cardId] }), [pushLockDemand])
  const onPinMenu = useCallback((t: Tab, cardId: string | null) => pushLockDemand(t, { pin: cardId === null ? [] : [cardId] }), [pushLockDemand])

  const { locks, lockBase, lockReveal, lockTrim } = state
  const lockSnapshot = snapshot.locks
  const lockUi = useMemo(
    () => lockUiValue({ game, state: { draft, locks, lockBase, lockReveal, lockTrim }, snapshot: lockSnapshot, runGeneration, dispatch, onAdjustCard, onPinMenu }),
    [game, draft, locks, lockBase, lockReveal, lockTrim, lockSnapshot, runGeneration, onAdjustCard, onPinMenu],
  )
  // 핀 고정·기준 갈래 변경 뒤 처음 나온 파생으로 초과를 한 번만 자동 조정한다(리듀서가 표지를 비워 다시 돌지 않는다).
  const { lockFit } = state
  const fitDerivation = lockUi.derivation
  useEffect(() => {
    if (lockFit !== null && fitDerivation !== null) dispatch({ type: 'fit-locks', token: lockFit, lockedSp: baseLockedSp(fitDerivation) })
  }, [lockFit, fitDerivation])
  const lockResolutions =
    lockSnapshot !== null && !lockSnapshot.pending && lockSnapshot.generation === runGeneration && locks.length > 0 ? lockSnapshot.resolutions : undefined

  const reasons = useMemo(() => {
    const out: ErrorReason[] = []
    const seen = new Set<string>()
    for (const t of TABS) {
      const s = snapshot.tabs[t]
      if (s.kind !== 'view' || s.superseded || s.generation !== runGeneration || s.view.status.kind !== 'my-set-error') continue
      for (const r of s.view.status.reasons) {
        const k = JSON.stringify([r.code, r.field ?? null, r.message])
        if (!seen.has(k)) {
          seen.add(k)
          out.push(r)
        }
      }
    }
    return out
  }, [snapshot, runGeneration])

  const draftSet = useMemo(() => toPokemonSet(game, draft).set, [game, draft])
  // 고정 중 화면의 내 세트는 기준 갈래 계획 세트다(다시 계산하는 동안은 직전 계획 세트).
  const [lastPlanSet, setLastPlanSet] = useState<PokemonSet | null>(null)
  if (lockUi.planSet !== null && lockUi.planSet !== lastPlanSet) setLastPlanSet(lockUi.planSet)
  if (locks.length === 0 && lastPlanSet !== null) setLastPlanSet(null)
  const mySet = lockUi.planSet ?? (lockUi.pending ? lastPlanSet : null) ?? draftSet
  // 고정 중 mySet은 계획 세트(합계 66 초과 가능)라 합계 검사를 끄고 특성을 본다
  const myAbility = useMemo(() => abilityOf(game, mySet, locks.length > 0 ? IGNORE_TOTAL : undefined), [game, mySet, locks.length])
  const { added: speedAdded } = state.speedChart
  // 스피드 차트와 '포켓몬 추가' 스피드 판정이 같은 입력(화면 메타)을 쓴다
  const speedInput = useMemo(
    (): SpeedChartInput => ({ game, view: meta.view, myAbility, criteria: state.criteria, filters: state.filters, customTargets, added: speedAdded }),
    [game, meta.view, myAbility, state.criteria, state.filters, customTargets, speedAdded],
  )
  // 공·방 추가 판정 입력: 메타를 불러오는 중에도 화면에 보이는 메타 기준(계산 입력 input은 그동안 없다)
  const addInput = useMemo(() => toCardInput(state, game, meta.view), [state, game, meta.view])
  const active = snapshot.tabs[tab]
  // 재계산으로 카드가 잠시 숨는 동안(이전 세대 뷰 표시·새 세대 기본 항목 미확정)만 목록 박스가 높이를 붙잡아 스크롤 위치를 지킨다.
  // 이후 단계(스윕·변형)까지 붙잡으면 그 사이 카드를 접어도 빈 공간이 남는다.
  const recomputing = active.kind === 'view' && (active.superseded || active.generation !== runGeneration || !active.view.stage12Done)
  const source = active.kind === 'view' ? active.view.source : sourceOf(meta.view.meta)
  const tabIdOf = (t: string) => `result-tab-${t}`
  const panelId = 'result-panel'
  const customPanelId = 'custom-target-panel'

  const closeCustom = () => {
    setAddPanel({ open: false, rosterId: null, autoFocus: false })
    customButton.current?.focus()
  }
  const toggleCustom = () => (customOpen ? closeCustom() : setAddPanel({ open: true, rosterId: null, autoFocus: true }))
  const onAutoFocused = useCallback(() => setAddPanel((cur) => (cur.autoFocus ? { ...cur, autoFocus: false } : cur)), [])
  const onPick = useCallback((rosterId: string | null) => setAddPanel((cur) => ({ ...cur, rosterId })), [])
  const onRevealed = useCallback(() => setReveal(null), [])
  // 다른 탭으로 옮기면 이전 탭의 요청은 버린다(돌아왔을 때 포커스를 가로채지 않게)
  if (reveal !== null && reveal.tab !== tab) setReveal(null)
  const onAdded = (request: RevealRequest) => {
    revealNonce.current += 1
    setReveal({ ...request, nonce: revealNonce.current })
    // 포커스는 버튼으로 돌리지 않고 새 배분(reveal)으로 옮긴다
    setAddPanel({ open: false, rosterId: null, autoFocus: false })
  }
  const dismissCustom = useCallback(() => setAddPanel({ open: false, rosterId: null, autoFocus: false }), [])
  const customAnchor = useCallback(() => customButton.current, [])
  const customPanel = customOpen && (
    <Popover id={customPanelId} labelledBy={`${customPanelId}-h`} getAnchor={customAnchor} onDismiss={dismissCustom} ignoreOutside={KEEP_OPEN_ON}>
    <CustomTargetPanel
      headingId={`${customPanelId}-h`}
      game={game}
      view={meta.view}
      tab={tab}
      filters={state.filters}
      customTargets={customTargets}
      speedInput={speedInput}
      damageInput={addInput}
      bundleShareMin={state.criteria.bundleShareMin}
      rosterId={addPanel.rosterId}
      onPick={onPick}
      autoFocus={addPanel.autoFocus}
      onAutoFocused={onAutoFocused}
      dispatch={dispatch}
      onAddedTarget={closeCustom}
      onAdded={onAdded}
      onCancel={closeCustom}
    />
    </Popover>
  )

  return (
    <LockUiContext.Provider value={lockUi}>
    <header className="product-header">
      <PartyBar state={state} game={game} dispatch={dispatch} />
    </header>
    <div className="product-layout">
      <aside className="sidebar">
        <MySetPanel
          game={game}
          view={meta.view}
          draft={draft}
          dispatch={dispatch}
          reasons={emptySlot ? NO_REASONS : reasons}
          onDisplaySp={onDisplaySp}
          lockResolutions={lockResolutions}
          emptySlot={emptySlot}
        />
      </aside>
      <div className="results" ref={results}>
        <Toolbar
          game={game}
          view={meta.view}
          metaItems={boot.metaIndex.regulations[regulation] ?? []}
          state={state}
          dispatch={dispatch}
          source={source}
          selection={selection}
          tabIdOf={tabIdOf}
          panelId={panelId}
        />
        {metaError && <Errors title="메타 통계를 불러오지 못했습니다" lines={metaError} />}
        {emptySlot ? (
          <div role="tabpanel" id={panelId} aria-labelledby={tabIdOf(tab)} tabIndex={0} className="empty-slot-panel" data-testid="empty-slot-panel" data-tab={tab}>
            <p>
              <strong>{EMPTY_SLOT_TEXT}</strong>
            </p>
            <p className="hint">왼쪽 설정의 종 입력에서 포켓몬을 검색하면 이 칸의 계산 결과가 나옵니다.</p>
          </div>
        ) : tab === 'speed' ? (
          <SpeedTab
            game={game}
            input={speedInput}
            state={state}
            mySet={mySet}
            displaySp={displaySp}
            dispatch={dispatch}
            tabId={tabIdOf(tab)}
            panelId={panelId}
            generation={runGeneration}
            customOpen={customOpen}
            onToggleCustom={toggleCustom}
            customButtonRef={customButton}
            customPanelId={customPanelId}
            customPanel={customPanel}
            reveal={reveal?.tab === 'speed' ? reveal : null}
            onRevealed={onRevealed}
          />
        ) : (
        <ResultBox hold={recomputing} holdKey={tab}>
          <ResultPanel
            game={game}
            tab={tab}
            tabId={tabIdOf(tab)}
            panelId={panelId}
            state={active}
            generation={runGeneration}
            mySet={mySet}
            customTargets={customTargets}
            pinnedBundles={state.pinnedBundles}
            sortMode={state.sortMode}
            moveChoices={state.moveChoices}
            onMenuCards={onMenuCards}
            onVisibleCards={onVisibleCards}
            dispatch={dispatch}
            customOpen={customOpen}
            onToggleCustom={toggleCustom}
            customButtonRef={customButton}
            customPanelId={customPanelId}
            customPanel={customPanel}
            addInput={addInput}
            reveal={reveal !== null && reveal.tab !== 'speed' ? reveal : null}
            onRevealed={onRevealed}
          />
        </ResultBox>
        )}
      </div>
    </div>
    </LockUiContext.Provider>
  )
}
