import { useLayoutEffect, useMemo, type Dispatch, type ReactNode, type Ref } from 'react'
import {
  buildSpeedChart,
  compareInRow,
  ladderRows,
  speedBaseline,
  summarize,
  visibleBadges,
  type CustomTarget,
  type SpeedBaseline,
} from '../../cards'
import { CoreError, CoreInputError, validateSet, type PokemonSet } from '../../core'
import type { Snapshot } from '../../data/schema'
import type { MetaView } from '../../meta'
import { namesOf } from '../../ui/names'
import { useDisplaySp, type DisplaySpStore } from '../displaySp'
import { SPEED_CHART_COMPLETE_MARK, SPEED_CHART_FIRST_MARK, markSpeedChart } from '../perf'
import type { AppAction, AppState } from '../state'
import { SpeedChart } from './SpeedChart'
import { SpeedChartHead } from './SpeedChartHead'
import { rejectionText } from './speedText'

interface Props {
  game: Snapshot
  view: MetaView
  state: AppState
  mySet: PokemonSet
  displaySp: DisplaySpStore
  dispatch: Dispatch<AppAction>
  tabId: string
  panelId: string
  generation: number
  customOpen: boolean
  onToggleCustom(): void
  customButtonRef: Ref<HTMLButtonElement>
  customPanelId: string
  customPanel: ReactNode
}

/** 내 계산 특성(메가면 메가 폼). 해석할 수 없으면 null */
function abilityOf(game: Snapshot, set: PokemonSet): string | null {
  try {
    return validateSet(game, set).ability
  } catch (e) {
    if (e instanceof CoreError || e instanceof CoreInputError) return null
    throw e
  }
}

/** 스피드 탭: 내 세트의 특성만 입력으로 받는 배지 모델을 한 번 만들고, 기준선(표시 SP)만 드래그를 따라간다 */
export function SpeedTab({ game, view, state, mySet, displaySp, dispatch, tabId, panelId, generation, customOpen, onToggleCustom, customButtonRef, customPanelId, customPanel }: Props) {
  const { filters, myTailwind, added } = state.speedChart
  const shownSp = useDisplaySp(displaySp)
  const myAbility = useMemo(() => abilityOf(game, mySet), [game, mySet])
  const model = useMemo(
    () => buildSpeedChart({ game, view, myAbility, criteria: state.criteria, filters: state.filters, customTargets: state.customTargets, added }),
    [game, view, myAbility, state.criteria, state.filters, state.customTargets, added],
  )
  const badges = useMemo(() => visibleBadges(model, filters), [model, filters])
  const nameOf = useMemo(() => {
    const names = namesOf(game)
    return (id: string) => names.species.label(id)
  }, [game])
  const cmp = useMemo(() => compareInRow(nameOf), [nameOf])

  // 확정 SP 기준(알림 영역)과 드래그 중 표시 SP 기준(화면)을 나눈다
  const confirmedBaseline = useMemo(() => speedBaseline(game, mySet, myTailwind), [game, mySet, myTailwind])
  const shownSet = useMemo(() => (shownSp === null ? mySet : { ...mySet, sp: shownSp }), [mySet, shownSp])
  const baseline: SpeedBaseline = useMemo(() => (shownSp === null ? confirmedBaseline : speedBaseline(game, shownSet, myTailwind)), [shownSp, confirmedBaseline, game, shownSet, myTailwind])
  const rows = useMemo(() => ladderRows(badges, baseline.kind === 'ok' ? baseline.speed : null, cmp), [badges, baseline, cmp])
  const summary = useMemo(() => {
    const s = summarize(badges, confirmedBaseline)
    return s === null ? '' : `추월 ${s.outspeeds} · 동속 ${s.tie} · 추월당함 ${s.outsped}`
  }, [badges, confirmedBaseline])

  useLayoutEffect(() => {
    markSpeedChart(SPEED_CHART_FIRST_MARK, generation)
    const frame = requestAnimationFrame(() => markSpeedChart(SPEED_CHART_COMPLETE_MARK, generation))
    return () => cancelAnimationFrame(frame)
  }, [model, generation])

  const rejected = baseline.kind === 'rejected' ? rejectionText(game, baseline.rejection, 'mine') : null
  const targets: readonly CustomTarget[] = state.customTargets
  const empty = badges.length === 0 && model.unsupported.length === 0

  return (
    <div
      role="tabpanel"
      id={panelId}
      aria-labelledby={tabId}
      className="tab-panel speed-tab result-box"
      data-testid="tab-panel"
      data-tab="speed"
      data-generation={generation}
      data-first-card="true"
      data-complete="true"
    >
      <div className="speed-top">
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
        <SpeedChartHead filters={filters} myTailwind={myTailwind} dispatch={dispatch} />
      </div>
      {customPanel}
      {rejected !== null && (
        <p className="tab-notice speed-reject" data-testid="speed-reject">
          {rejected.reason} · {rejected.cause}
        </p>
      )}
      {baseline.kind === 'invalid' && <p className="tab-notice speed-reject">내 세트를 확인해 주세요. 기준선을 그릴 수 없습니다.</p>}
      <p className="sr-only" role="status" data-testid="speed-summary">
        {summary}
      </p>
      {empty ? (
        <p className="empty speed-empty" data-testid="speed-empty">
          표시할 상대가 없습니다. 사용률 상위 수나 선택 필터를 바꿔 보세요.
        </p>
      ) : (
        <SpeedChart game={game} model={model} badges={badges} rows={rows} baseline={baseline} shownSet={shownSet} myTailwind={myTailwind} customTargets={targets} dispatch={dispatch} />
      )}
    </div>
  )
}
