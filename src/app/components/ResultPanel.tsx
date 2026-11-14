import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type Dispatch, type FocusEvent, type ReactNode, type Ref } from 'react'
import type { PokemonSet } from '../../core'
import { chosenOption, groupCards, groupItems, sortByResult, type CardGroup, type CardView, type CustomTarget, type GroupItem, type PinnedBundle, type ResultBucket, type SortMode, type Tab } from '../../cards'
import type { Snapshot } from '../../data/schema'
import { namesOf } from '../../ui/names'
import { categoryBadge, orderBadge, progressText } from '../../ui/format'
import { josa, koReason } from '../../ui/koErrors'
import type { TabViewState } from '../executor'
import type { AppAction, MoveChoice } from '../state'
import { CardItem } from './CardItem'
import { moveNoticeText } from './text'

interface Props {
  game: Snapshot
  tab: Tab
  tabId: string
  panelId: string
  state: TabViewState
  /** 화면 상태의 세대(실행기가 아직 받지 않았으면 뷰 세대보다 크다) */
  generation: number
  mySet: PokemonSet
  customTargets: readonly CustomTarget[]
  /** 고정한 래더 배분(고정한 순): 행의 배분 선택지 맨 위 */
  pinnedBundles: readonly PinnedBundle[]
  sortMode: SortMode
  /** 직접 고른 기술 항목(모든 탭) */
  moveChoices: readonly MoveChoice[]
  /** 마지막으로 내 포켓몬 종을 바꾼 세대(AppState speciesGeneration): 이 세대 이상 뷰가 보이면 그 전에 펼친 카드를 접는다 */
  speciesGeneration: number
  dispatch: Dispatch<AppAction>
  /** 진행 줄 오른쪽 "포켓몬 추가"(목록 밖 타겟 추가 패널 열기·닫기) */
  customOpen: boolean
  onToggleCustom: () => void
  customButtonRef: Ref<HTMLButtonElement>
  /** 추가 패널 id(열렸을 때 aria-controls) */
  customPanelId: string
  /**
   * 열린 추가 패널. 진행 줄 바로 아래, 목록 위에 그린다: 목록 박스 위(바깥)에 두면 후보 목록이 아래로 펼쳐지며 이 버튼을 가린다.
   * 열 때 목록 스크롤을 맨 위로 돌려 패널이 고정된 진행 줄 바로 아래에 보이게 한다.
   */
  customPanel?: ReactNode
  /** 기술 선택 목록을 연 줄의 항목 카드 id(닫으면 빈 목록). 계산 입력이 아니라 실행기 수요다 */
  onMenuCards: (tab: Tab, cardIds: readonly string[]) => void
}

/** 계산결과순 그룹 이름(글자): 판정 그룹은 "<배지 문구>까지 가능" */
function bucketText(tab: Tab, bucket: ResultBucket): string {
  if (bucket.kind === 'tier') {
    const badge = tab === 'speed' ? orderBadge({ category: bucket.tier }) : categoryBadge(bucket.tier)
    return `${badge?.label ?? bucket.tier}까지 가능`
  }
  return bucket.kind === 'no-change' ? '변동 없음' : bucket.kind === 'error' ? '계산 불가' : '계산 중'
}

/** 계산결과순 그룹 라벨: 판정 그룹은 결과 배지와 같은 배지에 "까지 가능"을 붙여 쓰고, 그 밖은 글자. 행 수는 "n마리" */
function SectionLabel({ id, tab, bucket, count }: { id: string; tab: Tab; bucket: ResultBucket; count: number }) {
  let body: ReactNode
  const badge = bucket.kind !== 'tier' ? undefined : tab === 'speed' ? orderBadge({ category: bucket.tier }) : categoryBadge(bucket.tier)
  if (bucket.kind === 'tier' && badge !== undefined) {
    body = (
      <span className="sort-group-name">
        <span className={`ko-badge ko-${badge.tone}`}>{badge.label}</span>
        <span className="sort-group-text">까지 가능</span>
      </span>
    )
  } else {
    body = <span className="sort-group-text">{bucketText(tab, bucket)}</span>
  }
  return (
    <h2 className="sort-group-label" id={id}>
      {body}{' '}
      <span className="sort-group-count num">{count}마리</span>
    </h2>
  )
}

const NO_ITEMS: readonly GroupItem[] = []
const NONE: ReadonlySet<string> = new Set()

/** 펼친 카드(at = 펼침을 마지막으로 바꿀 때 보이던 뷰 세대) */
interface Expanded {
  at: number
  ids: ReadonlySet<string>
}

/** 종 교체 세대 이상 뷰가 보이는데 펼침이 그 전 것이면 모두 접힌 것으로 본다(재계산 뒤 접기). */
const expandedNow = (e: Expanded, shownGeneration: number, speciesGeneration: number): ReadonlySet<string> =>
  shownGeneration >= speciesGeneration && e.at < speciesGeneration ? NONE : e.ids

export function ResultPanel({ game, tab, tabId, panelId, state, generation, mySet, customTargets, pinnedBundles, sortMode, moveChoices, speciesGeneration, dispatch, customOpen, onToggleCustom, customButtonRef, customPanelId, customPanel, onMenuCards }: Props) {
  const names = namesOf(game)
  // 펼침·배분 선택은 탭마다 따로(같은 포켓몬이라도 탭이 다르면 다른 행), 배분을 바꿔도 펼침이 유지되게 그룹 키로 둔다.
  const scoped = (groupKey: string) => JSON.stringify([tab, groupKey])
  const shownGeneration = state.kind === 'idle' ? generation : state.generation
  const [expandedState, setExpanded] = useState<Expanded>(() => ({ at: shownGeneration, ids: NONE }))
  const expanded = expandedNow(expandedState, shownGeneration, speciesGeneration)
  // 토글 콜백은 세대마다 바뀌지 않게(행 다시 그리기 방지) 세대를 ref로 읽는다.
  const gens = useRef({ shown: shownGeneration, species: speciesGeneration })
  useLayoutEffect(() => {
    gens.current = { shown: shownGeneration, species: speciesGeneration }
  }, [shownGeneration, speciesGeneration])
  const onToggle = useCallback(
    (groupKey: string) => {
      const id = JSON.stringify([tab, groupKey])
      const { shown, species } = gens.current
      setExpanded((cur) => {
        const next = new Set(expandedNow(cur, shown, species))
        if (next.has(id)) next.delete(id)
        else next.add(id)
        // 종을 바꾼 뒤(새 뷰가 오기 전) 펼친 카드는 새 뷰가 와도 접지 않는다
        return { at: Math.max(shown, species), ids: next }
      })
    },
    [tab],
  )
  // (탭, 줄) → 고른 배분 카드 id. 도구 변형 줄(화력 도구·반감열매)은 도구를 가정해 배분을 따로 고르므로 기본 줄과 공유하지 않는다. 없거나 사라졌으면 그 줄 기본 배분.
  const [chosen, setChosen] = useState<ReadonlyMap<string, string>>(() => new Map())
  const onSelect = useCallback(
    (groupKey: string, cardId: string) => {
      const id = JSON.stringify([tab, groupKey])
      setChosen((cur) => (cur.get(id) === cardId ? cur : new Map(cur).set(id, cardId)))
    },
    [tab],
  )

  const view = state.kind === 'view' ? state.view : undefined
  const groups = useMemo(() => (view === undefined ? [] : groupCards(view.cards, tab, pinnedBundles)), [view, tab, pinnedBundles])
  // 포켓몬 한 줄의 기술 선택 항목(분류마다 분류 기본 배분의 항목). 행은 항목을 원소 단위로 비교해 바뀐 줄만 다시 그린다(CardItem sameProps).
  const itemsOf = useMemo(() => new Map(tab === 'speed' ? [] : groups.map((g) => [g.key, groupItems(g)] as const)), [groups, tab])
  const onChooseItem = useCallback(
    (group: CardGroup, card: CardView, item: GroupItem) => {
      dispatch({ type: 'choose-move', choice: { tab, source: group.opponent.source, opponentId: group.opponent.id, key: item.item.key } })
      // 다른 분류 항목이면 그 분류 기본 배분으로 바꾼다(그 항목은 그 배분에서 판정한다).
      if (item.card.category !== card.category) {
        const id = JSON.stringify([tab, group.key])
        setChosen((cur) => new Map(cur).set(id, item.card.id))
      }
    },
    [tab, dispatch],
  )
  const onMenu = useCallback((cardIds: readonly string[]) => onMenuCards(tab, cardIds), [tab, onMenuCards])
  const onResetItem = useCallback(
    (group: CardGroup) => dispatch({ type: 'reset-move', tab, source: group.opponent.source, opponentId: group.opponent.id }),
    [tab, dispatch],
  )
  // 행마다 보이는 배분 카드. 계산결과순은 그 카드로 그룹을 정한다(사용률 순은 그룹 하나·라벨 없음).
  const sections = useMemo(() => {
    const rows = groups.map((g) => ({ group: g, card: chosenOption(g, tab, chosen.get(JSON.stringify([tab, g.key]))) }))
    if (sortMode === 'usage') return [{ key: 'all', bucket: undefined, items: rows }]
    return sortByResult(rows, tab, (r) => r.card)
  }, [groups, tab, chosen, sortMode])
  const uid = useId()
  const labelId = (sectionKey: string) => `${uid}-sort-${sectionKey}`

  // 계산결과순에서 배분을 바꾸거나 SP를 커밋해 행이 다른 그룹으로 옮겨지면, React가 DOM 노드를 옮기며 그 행 안 포커스가
  // 풀릴 수 있다. 패널 안 마지막 포커스를 기억했다가(커밋 중에는 React가 이벤트를 보내지 않아 지워지지 않는다) 커밋 직후
  // 포커스가 body로 빠졌으면 되돌리고, 행이 옮겨졌으면 화면을 그 행으로 옮기고 스크린 리더에 알린다.
  const panelRef = useRef<HTMLDivElement>(null)
  const liveRef = useRef<HTMLParagraphElement>(null)
  const lastFocus = useRef<HTMLElement | null>(null)
  const placed = useRef<ReadonlyMap<string, string>>(new Map())
  useLayoutEffect(() => {
    const prev = placed.current
    const next = new Map<string, string>()
    for (const sec of sections) for (const it of sec.items) next.set(it.group.key, sec.key)
    placed.current = next
    const el = lastFocus.current
    if (el === null || !el.isConnected || !panelRef.current?.contains(el)) return
    const active = document.activeElement
    if (active === null || active === document.body) el.focus()
    if (sortMode !== 'result' || prev.size === 0) return
    const li = el.closest<HTMLElement>('[data-testid="card"]')
    const key = li?.dataset.groupKey
    if (li === null || key === undefined) return
    const from = prev.get(key)
    const to = sections.find((sec) => sec.key === next.get(key))
    if (from === undefined || to === undefined || to.bucket === undefined || from === to.key) return
    // 방금 조작한 행이 다른 그룹으로 옮겨졌다: 화면도 그 행을 따라간다
    li.scrollIntoView({ block: 'nearest' })
    const live = liveRef.current
    const g = to.items.find((it) => it.group.key === key)
    if (live !== null && g !== undefined) {
      const berry = g.group.berry === undefined ? '' : ` ${game.data.items[g.group.berry.item]?.name.ko ?? g.group.berry.item} 지닌 경우`
      live.textContent = `${names.species.label(g.group.opponent.id)}${berry}: ${bucketText(tab, to.bucket)} 그룹으로 옮겼습니다.`
    }
  }, [sections, sortMode, tab, names, game])
  // 추가 패널을 열면(패널의 포커스 이동보다 먼저) 목록 스크롤을 맨 위로: 패널이 고정된 진행 줄 밑에 숨지 않는다.
  const hasCustomPanel = Boolean(customPanel)
  useLayoutEffect(() => {
    if (hasCustomPanel) panelRef.current?.closest('.result-scroll')?.scrollTo({ top: 0 })
  }, [hasCustomPanel])
  const onFocus = (e: FocusEvent<HTMLDivElement>) => {
    lastFocus.current = e.target
  }
  const onBlur = (e: FocusEvent<HTMLDivElement>) => {
    const to = e.relatedTarget
    if (to !== null) {
      if (!e.currentTarget.contains(to)) lastFocus.current = null
      return
    }
    // 바깥 빈 곳을 눌러 포커스가 body로 간 경우만 잊는다(행 이동으로 풀린 포커스는 커밋 안에서 되돌린다).
    const from = e.target
    setTimeout(() => {
      const active = document.activeElement
      if (lastFocus.current === from && (active === null || active === document.body)) lastFocus.current = null
    }, 0)
  }

  const superseded = state.kind === 'view' && (state.superseded || state.generation !== generation)
  // 직접 고른 항목이 새 계획의 목록에서 사라지면(내 기술 교체·상대 상위 기술 변동·랭크 수단 자격 상실 등) 선택을 푼다.
  // 1·2단계가 끝난 현재 세대 뷰에서, 그 상대 줄이 있고 어느 배분에도 그 항목이 없을 때만(계산 중 일시 상태로는 풀지 않는다).
  const stage12Done = view !== undefined && !superseded && view.stage12Done
  useEffect(() => {
    if (!stage12Done || tab === 'speed') return
    for (const c of moveChoices) {
      if (c.tab !== tab) continue
      const mine = groups.filter((g) => g.opponent.source === c.source && g.opponent.id === c.opponentId)
      if (mine.length === 0) continue
      if (mine.some((g) => g.options.some((o) => o.items.some((i) => i.key === c.key)))) continue
      dispatch({ type: 'reset-move', tab, source: c.source, opponentId: c.opponentId })
    }
  }, [stage12Done, groups, moveChoices, tab, dispatch])
  const firstCard = view !== undefined && !superseded && (view.cards.length > 0 || view.stage12Done)
  const complete = view !== undefined && !superseded && view.complete
  // 더 계산하지 않는 종결 상태(치명 오류·내 세트 오류)는 busy가 아니다.
  const settled = state.kind === 'fatal' ? state.generation === generation : complete || (view !== undefined && !superseded && view.status.kind !== 'ok')
  const targetOf = (rosterId: string) => customTargets.find((t) => t.rosterId === rosterId)

  return (
    <div
      ref={panelRef}
      role="tabpanel"
      id={panelId}
      onFocus={onFocus}
      onBlur={onBlur}
      aria-labelledby={tabId}
      tabIndex={0}
      className={superseded ? 'tab-panel superseded' : 'tab-panel'}
      data-testid="tab-panel"
      data-tab={tab}
      data-generation={state.kind === 'idle' ? generation : state.generation}
      data-first-card={firstCard ? 'true' : 'false'}
      data-complete={complete ? 'true' : 'false'}
      data-superseded={superseded ? 'true' : undefined}
      aria-busy={!settled}
    >
      <p className="sr-only" aria-live="polite" data-testid="sort-moved" ref={liveRef} />
      {state.kind === 'idle' && <p className="hint">계산을 준비하는 중…</p>}
      {state.kind === 'fatal' && (
        <div className="tab-error" data-testid="tab-error" role="alert">
          <strong>이 탭을 계산하지 못했습니다</strong>
          <p>{state.message}</p>
        </div>
      )}
      {/* 진행 줄: 왼쪽 진행·갱신 중, 오른쪽 끝 "포켓몬 추가"(목록 뷰 오른쪽 위) */}
      <div className="panel-status" data-testid="panel-status">
        {view && superseded && <span className="updating-badge">갱신 중</span>}
        {view && (
          <span className="progress num" data-testid="progress">
            {progressText(view.progress.done, view.progress.total, view.complete)}
            {view.stage12Done && !view.complete && ' · 확인 중'}
          </span>
        )}
        <button
          type="button"
          className="custom-add-btn"
          ref={customButtonRef}
          aria-expanded={customOpen}
          aria-controls={customOpen ? customPanelId : undefined}
          onClick={onToggleCustom}
          data-testid="custom-add"
        >
          포켓몬 추가
        </button>
      </div>
      {customPanel}
      {view && (
        <>
          {view.status.kind === 'my-set-error' && (
            <div className="tab-error" data-testid="tab-error" role="alert">
              <strong>내 세트 계산 불가</strong>
              <ul>
                {view.status.reasons.map((r, i) => (
                  <li key={i}>{koReason(game, r, mySet)}</li>
                ))}
              </ul>
            </div>
          )}
          {view.notices.map((n) => (
            <p key={JSON.stringify([n.kind, n.owner, n.moveId])} className="tab-notice" data-testid="tab-notice">
              {moveNoticeText(game, n)}
            </p>
          ))}
          {view.customTargetConflicts.length > 0 && (
            <p className="tab-notice" data-testid="custom-conflict">
              {view.customTargetConflicts.map((id) => josa(names.species.label(id), '은', '는')).join(', ')} 메타 목록에 있어 목록 밖 타겟으로 쓰지 않습니다.
            </p>
          )}
          {view.status.kind === 'ok' && (
            <>
              {/* 래더 상대는 판정 변화와 무관하게 다 보인다: 빈 목록 = 판정할 상대·기술이 없음(내 세트에 공격기가 없는 등) */}
              {view.cards.length === 0 && view.stage12Done && !view.complete && (
                <p className="empty" data-testid="empty-provisional">
                  지금까지 판정할 상대가 없습니다(확인 중).
                </p>
              )}
              {view.cards.length === 0 && view.complete && (
                <p className="empty" data-testid="empty">
                  판정할 상대가 없습니다. 이 탭에서 계산할 기술이 있는지 확인하세요.
                </p>
              )}
              {view.cards.length === 0 && !view.stage12Done && <p className="hint">카드를 계산하는 중…</p>}
              {/* 계산결과순 그룹 라벨은 같은 목록 안 제목 항목(li > h2)이라 행이 그룹을 옮겨도 다시 마운트되지 않는다.
                  목록은 listitem만 갖는다(role=presentation li는 ARIA list 규칙 위반). 라벨에는 포커스가 없어 키보드 순서는 행만,
                  행 소속은 행 토글 버튼의 aria-describedby(그룹 제목 id)로 전한다. */}
              <ol className="cards" data-sort={sortMode}>
                {sections.flatMap((sec) => {
                  const items = sec.items.map(({ group: g, card: c }) => (
                    <CardItem
                      key={scoped(g.key)}
                      game={game}
                      tab={tab}
                      group={g}
                      card={c}
                      rollSteps={view.rollSteps}
                      expanded={expanded.has(scoped(g.key))}
                      onToggle={onToggle}
                      onSelect={onSelect}
                      target={c.opponent.source === 'custom' ? targetOf(c.opponent.id) : undefined}
                      dispatch={dispatch}
                      groupLabelId={sec.bucket === undefined ? undefined : labelId(sec.key)}
                      items={itemsOf.get(g.key) ?? NO_ITEMS}
                      onChooseItem={onChooseItem}
                      onResetItem={onResetItem}
                      onMenuCards={onMenu}
                    />
                  ))
                  if (sec.bucket === undefined) return items
                  return [
                    <li
                      key={`sort-group:${sec.key}`}
                      className="sort-group"
                      data-testid="sort-group"
                      data-group={sec.bucket.kind}
                      data-tier={sec.bucket.kind === 'tier' ? sec.bucket.tier : undefined}
                      data-count={sec.items.length}
                    >
                      <SectionLabel id={labelId(sec.key)} tab={tab} bucket={sec.bucket} count={sec.items.length} />
                    </li>,
                    ...items,
                  ]
                })}
              </ol>
            </>
          )}
        </>
      )}
    </div>
  )
}
