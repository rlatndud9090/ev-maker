import { useCallback, useMemo, useState, type Dispatch } from 'react'
import type { PokemonSet } from '../../core'
import { chosenOption, groupCards, type CustomTarget, type Tab } from '../../cards'
import type { Snapshot } from '../../data/schema'
import { namesOf } from '../../ui/names'
import { progressText } from '../../ui/format'
import { josa, koReason } from '../../ui/koErrors'
import type { TabViewState } from '../executor'
import type { AppAction } from '../state'
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
  dispatch: Dispatch<AppAction>
}

export function ResultPanel({ game, tab, tabId, panelId, state, generation, mySet, customTargets, dispatch }: Props) {
  const names = namesOf(game)
  // 펼침·배분 선택은 탭마다 따로(같은 포켓몬이라도 탭이 다르면 다른 행), 배분을 바꿔도 펼침이 유지되게 그룹 키로 둔다.
  const scoped = (groupKey: string) => JSON.stringify([tab, groupKey])
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const onToggle = useCallback(
    (groupKey: string) => {
      const id = JSON.stringify([tab, groupKey])
      setExpanded((cur) => {
        const next = new Set(cur)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      })
    },
    [tab],
  )
  // 포켓몬마다 한 행: (탭, 그룹 키) → 고른 배분 카드 id. 없거나 사라졌으면 가장 사용률 높은 배분.
  const [chosen, setChosen] = useState<ReadonlyMap<string, string>>(() => new Map())
  const onSelect = useCallback(
    (groupKey: string, cardId: string) => {
      const id = JSON.stringify([tab, groupKey])
      setChosen((cur) => (cur.get(id) === cardId ? cur : new Map(cur).set(id, cardId)))
    },
    [tab],
  )

  const view = state.kind === 'view' ? state.view : undefined
  const groups = useMemo(() => (view === undefined ? [] : groupCards(view.cards)), [view])
  const superseded = state.kind === 'view' && (state.superseded || state.generation !== generation)
  const firstCard = view !== undefined && !superseded && (view.cards.length > 0 || view.stage12Done)
  const complete = view !== undefined && !superseded && view.complete
  // 더 계산하지 않는 종결 상태(치명 오류·내 세트 오류)는 busy가 아니다.
  const settled = state.kind === 'fatal' ? state.generation === generation : complete || (view !== undefined && !superseded && view.status.kind !== 'ok')
  const targetOf = (rosterId: string) => customTargets.find((t) => t.rosterId === rosterId)

  return (
    <div
      role="tabpanel"
      id={panelId}
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
      {state.kind === 'idle' && <p className="hint">계산을 준비하는 중…</p>}
      {state.kind === 'fatal' && (
        <div className="tab-error" data-testid="tab-error" role="alert">
          <strong>이 탭을 계산하지 못했습니다</strong>
          <p>{state.message}</p>
        </div>
      )}
      {view && (
        <>
          <div className="panel-status">
            {superseded && <span className="updating-badge">갱신 중</span>}
            <span className="progress num" data-testid="progress">
              {progressText(view.progress.done, view.progress.total, view.complete)}
              {view.stage12Done && !view.complete && ' · 확인 중'}
            </span>
          </div>
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
              {view.cards.length === 0 && view.stage12Done && !view.complete && (
                <p className="empty" data-testid="empty-provisional">
                  지금까지 SP로 판정이 바뀌는 카드가 없습니다(확인 중).
                </p>
              )}
              {view.cards.length === 0 && view.complete && (
                <p className="empty" data-testid="empty">
                  SP로 판정이 바뀌는 카드가 없습니다.
                </p>
              )}
              {view.cards.length === 0 && !view.stage12Done && <p className="hint">카드를 계산하는 중…</p>}
              <ol className="cards">
                {groups.map((g) => {
                  const c = chosenOption(g, tab, chosen.get(scoped(g.key)))
                  return (
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
                    />
                  )
                })}
              </ol>
            </>
          )}
        </>
      )}
    </div>
  )
}
