import { useLayoutEffect, useMemo, type Dispatch, type ReactNode, type Ref } from 'react'
import {
  buildSpeedChart,
  compareInRow,
  ladderRows,
  speedBaseline,
  visibleBadges,
  type CustomTarget,
  type SpeedBaseline,
  type SpeedChartInput,
} from '../../cards'
import type { EvalOptions, PokemonSet } from '../../core'
import type { Snapshot } from '../../data/schema'
import { toPokemonSet } from '../../ui/setDraft'
import { useDisplaySp, type DisplaySpStore } from '../displaySp'
import { useLockUi } from '../lockContext'
import { SPEED_CHART_COMPLETE_MARK, SPEED_CHART_FIRST_MARK, markSpeedChart } from '../perf'
import type { SpeedReveal } from '../reveal'
import type { AppAction, AppState } from '../state'
import { SpeedChart } from './SpeedChart'
import { SpeedChartHead } from './SpeedChartHead'
import { rejectionText } from './speedText'

interface Props {
  game: Snapshot
  /** 차트 모델 입력(앱이 '포켓몬 추가' 패널의 스피드 판정과 함께 쓴다) */
  input: SpeedChartInput
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
  reveal: SpeedReveal | null
  onRevealed: () => void
}

const IGNORE_TOTAL: EvalOptions = { ignoreSpTotal: true }

/** 알림 영역 글자: 확정 기준선의 내 실수치만(총수 없는 추월·동속 개수는 알리지 않는다, 사용자 피드백 2026-11-16) */
const summaryText = (b: SpeedBaseline): string => (b.kind === 'ok' ? `내 스피드 ${b.speed}` : '')

/** 스피드 탭: 내 세트의 특성만 입력으로 받는 배지 모델을 한 번 만들고, 기준선(표시 SP)만 드래그를 따라간다 */
export function SpeedTab({ game, input, state, mySet, displaySp, dispatch, tabId, panelId, generation, customOpen, onToggleCustom, customButtonRef, customPanelId, customPanel, reveal, onRevealed }: Props) {
  const { filters, myTailwind } = state.speedChart
  const shownSp = useDisplaySp(displaySp)
  // 고정 중 mySet은 계획 세트(합계 66 초과 가능)라 합계 검사를 끄고, 고정 능력치는 드래그를 따르지 않는다
  const lockUi = useLockUi()
  const locked = lockUi.locks.length > 0
  const evalOptions = locked ? IGNORE_TOTAL : undefined
  const lockedStats = locked ? (lockUi.derivation?.lockedStats ?? null) : undefined
  const model = useMemo(() => buildSpeedChart(input), [input])
  const badges = useMemo(() => visibleBadges(model, filters), [model, filters])
  const cmp = useMemo(() => compareInRow(), [])

  // 확정 SP 기준(알림 영역)과 드래그 중 표시 SP 기준(화면)을 나눈다
  const confirmedBaseline = useMemo(() => speedBaseline(game, mySet, myTailwind, evalOptions), [game, mySet, myTailwind, evalOptions])
  const shownSet = useMemo(() => {
    if (shownSp === null || lockedStats === null) return mySet
    if (lockedStats === undefined) return { ...mySet, sp: shownSp }
    const sp = { ...shownSp }
    for (const s of lockedStats) sp[s] = mySet.sp[s]
    return { ...mySet, sp }
  }, [mySet, shownSp, lockedStats])
  const baseline: SpeedBaseline = useMemo(
    () => (shownSet === mySet ? confirmedBaseline : speedBaseline(game, shownSet, myTailwind, evalOptions)),
    [shownSet, mySet, confirmedBaseline, game, myTailwind, evalOptions],
  )
  // 고정 후보·갈래 예산의 내 세트(고정 전 값, 드래그 중이면 표시 SP)
  const draft = state.draft
  const confirmedLockSet = useMemo(() => (lockUi.enabled ? toPokemonSet(game, draft).set : undefined), [lockUi.enabled, game, draft])
  const lockSet = useMemo(() => (confirmedLockSet === undefined || shownSp === null ? confirmedLockSet : { ...confirmedLockSet, sp: shownSp }), [confirmedLockSet, shownSp])
  const rows = useMemo(() => ladderRows(badges, baseline.kind === 'ok' ? baseline.speed : null, cmp), [badges, baseline, cmp])
  // 알림 영역은 확정 SP 기준(드래그 중에는 알리지 않는다)
  const summary = summaryText(confirmedBaseline)

  useLayoutEffect(() => {
    markSpeedChart(SPEED_CHART_FIRST_MARK, generation)
    const frame = requestAnimationFrame(() => markSpeedChart(SPEED_CHART_COMPLETE_MARK, generation))
    return () => cancelAnimationFrame(frame)
  }, [model, generation])

  const rejected = baseline.kind === 'rejected' ? rejectionText(game, baseline.rejection, 'mine') : null
  const targets: readonly CustomTarget[] = state.customTargets
  // 축 위 배지가 하나도 없으면 빈 상태(순서 비교 불가 영역은 그 아래에 그대로, ADR 결정 1)
  const empty = badges.length === 0

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
          aria-haspopup="dialog"
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
      {/* 빈 상태에서도 기준선 띠는 프레임 안에 보인다 */}
      <SpeedChart
        game={game}
        model={model}
        input={input}
        bundleShareMin={state.criteria.bundleShareMin}
        badges={badges}
        rows={rows}
        baseline={baseline}
        shownSet={shownSet}
        lockSet={lockSet}
        confirmedLockSet={confirmedLockSet}
        myTailwind={myTailwind}
        customTargets={targets}
        dispatch={dispatch}
        empty={empty}
        reveal={reveal}
        onRevealed={onRevealed}
      />
    </div>
  )
}
