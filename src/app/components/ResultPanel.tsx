import { useCallback, useState, type Dispatch } from 'react'
import type { PokemonSet } from '../../core'
import type { CustomTarget, Tab } from '../../cards'
import type { Snapshot } from '../../data/schema'
import { namesOf } from '../../ui/names'
import { progressText } from '../../ui/format'
import { josa, koReason } from '../../ui/koErrors'
import type { TabViewState } from '../executor'
import type { AppAction } from '../state'
import { CardItem } from './CardItem'
import { NoChangeSummary } from './NoChangeSummary'
import { categoryVariesText } from './text'

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
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const onToggle = useCallback((id: string) => {
    setExpanded((cur) => {
      const next = new Set(cur)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const view = state.kind === 'view' ? state.view : undefined
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
            <p key={`${n.owner}:${n.moveId}`} className="tab-notice" data-testid="tab-notice">
              {categoryVariesText(game, n.moveId)}
            </p>
          ))}
          {view.customTargetConflicts.length > 0 && (
            <p className="tab-notice" data-testid="custom-conflict">
              {view.customTargetConflicts.map((id) => josa(names.species.label(id), '은', '는')).join(', ')} 메타 목록에 있어 목록 밖 타겟으로 쓰지 않습니다.
            </p>
          )}
          {view.status.kind === 'ok' && (
            <>
              <NoChangeSummary game={game} summary={view.noChange} confirming={!view.complete} />
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
                {view.cards.map((c) => (
                  <CardItem
                    key={c.id}
                    game={game}
                    tab={tab}
                    card={c}
                    expanded={expanded.has(c.id)}
                    onToggle={onToggle}
                    target={c.opponent.source === 'custom' ? targetOf(c.opponent.id) : undefined}
                    dispatch={dispatch}
                  />
                ))}
              </ol>
            </>
          )}
        </>
      )}
    </div>
  )
}
