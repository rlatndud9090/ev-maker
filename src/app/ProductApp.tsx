import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { TABS, type ErrorReason, type MetaSourceView, type Tab } from '../cards'
import type { PokemonSet, SpTable } from '../core'
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
import { initialState, moveSelections, reducer } from './state'
import { useExecutor } from './useExecutor'
import { LockUiContext, lockUiValue } from './lockContext'
import { useLockRuntime } from './lockRuntime'
import { baseLockedSp } from './spLimit'
import { CustomTargetPanel } from './components/CustomTargetPanel'
import { MySetPanel } from './components/MySetPanel'
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
      <header className="product-header">
        <h1>SP 구간 판정</h1>
        {game && (
          <p className="hint">
            {game.manifest.regulation.name} · 레벨 {game.manifest.rules.level} · SP 능력치당 {game.manifest.rules.spMaxPerStat}, 합계 {game.manifest.rules.spTotal}
          </p>
        )}
      </header>
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

function Workspace({ boot }: { boot: Boot }) {
  const { game } = boot
  const regulation = game.manifest.regulation.id
  const [state, dispatch] = useReducer(reducer, regulation, initialState)
  const { executor, snapshot } = useExecutor()
  const [customOpen, setCustomOpen] = useState(false)
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
  // 기술 선택 목록을 연 줄의 항목 변동 판정도 계산 입력이 아니라 수요다.
  const onMenuCards = useCallback((t: Tab, cardIds: readonly string[]) => executor.setMenuCards(t, cardIds), [executor])
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

  const { locks, lockReveal, lockTrim } = state
  const lockSnapshot = snapshot.locks
  const lockUi = useMemo(
    () => lockUiValue({ game, state: { draft, locks, lockReveal, lockTrim }, snapshot: lockSnapshot, runGeneration, dispatch, onAdjustCard, onPinMenu }),
    [game, draft, locks, lockReveal, lockTrim, lockSnapshot, runGeneration, onAdjustCard, onPinMenu],
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
  const active = snapshot.tabs[tab]
  // 재계산으로 카드가 잠시 숨는 동안(이전 세대 뷰 표시·새 세대 기본 항목 미확정)만 목록 박스가 높이를 붙잡아 스크롤 위치를 지킨다.
  // 이후 단계(스윕·변형)까지 붙잡으면 그 사이 카드를 접어도 빈 공간이 남는다.
  const recomputing = active.kind === 'view' && (active.superseded || active.generation !== runGeneration || !active.view.stage12Done)
  const source = active.kind === 'view' ? active.view.source : sourceOf(meta.view.meta)
  const tabIdOf = (t: string) => `result-tab-${t}`
  const panelId = 'result-panel'
  const customPanelId = 'custom-target-panel'

  const closeCustom = () => {
    setCustomOpen(false)
    customButton.current?.focus()
  }

  return (
    <LockUiContext.Provider value={lockUi}>
    <div className="product-layout">
      <aside className="sidebar">
        <MySetPanel game={game} view={meta.view} draft={draft} dispatch={dispatch} reasons={reasons} onDisplaySp={onDisplaySp} lockResolutions={lockResolutions} />
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
        {tab === 'speed' ? (
          <SpeedTab
            game={game}
            view={meta.view}
            state={state}
            mySet={mySet}
            displaySp={displaySp}
            dispatch={dispatch}
            tabId={tabIdOf(tab)}
            panelId={panelId}
            generation={runGeneration}
            customOpen={customOpen}
            onToggleCustom={() => (customOpen ? closeCustom() : setCustomOpen(true))}
            customButtonRef={customButton}
            customPanelId={customPanelId}
            customPanel={
              customOpen && (
                <CustomTargetPanel
                  id={customPanelId}
                  game={game}
                  view={meta.view}
                  customTargets={customTargets}
                  onCancel={closeCustom}
                  onAdd={(rosterId, moves) => {
                    dispatch({ type: 'add-custom-target', rosterId, moves })
                    closeCustom()
                  }}
                />
              )
            }
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
            dispatch={dispatch}
            customOpen={customOpen}
            onToggleCustom={() => (customOpen ? closeCustom() : setCustomOpen(true))}
            customButtonRef={customButton}
            customPanelId={customPanelId}
            customPanel={
              customOpen && (
                <CustomTargetPanel
                  id={customPanelId}
                  game={game}
                  view={meta.view}
                  customTargets={customTargets}
                  onCancel={closeCustom}
                  onAdd={(rosterId, moves) => {
                    dispatch({ type: 'add-custom-target', rosterId, moves })
                    closeCustom()
                  }}
                />
              )
            }
          />
        </ResultBox>
        )}
      </div>
    </div>
    </LockUiContext.Provider>
  )
}
