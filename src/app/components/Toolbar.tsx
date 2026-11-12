import { useId, useRef, useState, type Dispatch, type KeyboardEvent, type ReactNode } from 'react'
import { ROLL_STEPS, TABS, type MetaSourceView, type SortMode, type Tab } from '../../cards'
import type { Snapshot } from '../../data/schema'
import type { MatchType, MetaIndexItem } from '../../data/meta-schema'
import type { MetaView } from '../../meta'
import { namesOf } from '../../ui/names'
import { searchIndexOf } from '../../ui/search'
import { fromPercentInput, parseRollSteps, shareText, toPercentInput } from '../../ui/format'
import type { AppAction, AppState } from '../state'
import { Combobox } from './Combobox'
import { NumberField } from './NumberField'
import { MATCH_LABEL, TAB_LABEL, sourceText } from './text'

const rankingIds = new WeakMap<MetaView, readonly string[]>()
function rankingIdsOf(view: MetaView): readonly string[] {
  let ids = rankingIds.get(view)
  if (!ids) rankingIds.set(view, (ids = view.ranking.map((e) => e.id)))
  return ids
}

interface Props {
  game: Snapshot
  view: MetaView
  /** 이 레귤레이션의 메타 인덱스 항목 */
  metaItems: readonly MetaIndexItem[]
  state: AppState
  dispatch: Dispatch<AppAction>
  /** 현재 화면이 쓰는 통계 출처 */
  source: MetaSourceView
  /** 고른(또는 기본으로 풀린) 매치 방식·월 */
  selection: { match: MatchType; month: string }
  tabIdOf: (tab: Tab) => string
  panelId: string
}

const ROLL_FIELD_LABEL: Record<'attack' | 'defense', string> = { attack: '고난수 1타 기준', defense: '고난수 견딤 기준' }

/** "고난수 1타 기준 [n]/16 (87.5%)". 1~ROLL_STEPS−1 정수만 반영하고, 그 밖 입력은 반영하지 않은 채 옆에 안내한다. */
function RollThresholdField({ tab, rollSteps, dispatch }: { tab: 'attack' | 'defense'; rollSteps: number; dispatch: Dispatch<AppAction> }) {
  const label = ROLL_FIELD_LABEL[tab]
  const id = useId()
  const hintId = `${id}-hint`
  const unitId = `${id}-unit`
  const [editing, setEditing] = useState<string | null>(null)
  const committed = rollSteps
  const parsed = editing === null ? committed : parseRollSteps(editing, ROLL_STEPS)
  const invalid = parsed === undefined
  return (
    <div className="roll-field" data-testid="roll-threshold" data-tab={tab}>
      <label className="roll-input">
        {label}
        <input
          type="number"
          inputMode="numeric"
          min={1}
          max={ROLL_STEPS - 1}
          step={1}
          value={editing ?? String(committed)}
          aria-invalid={invalid}
          aria-describedby={invalid ? `${unitId} ${hintId}` : unitId}
          onChange={(e) => {
            setEditing(e.target.value)
            const n = parseRollSteps(e.target.value, ROLL_STEPS)
            if (n !== undefined) dispatch({ type: 'set-roll-steps', steps: n })
          }}
          onBlur={() => setEditing(null)}
        />
      </label>
      {/* 단위(/16)와 반영 중인 백분율을 입력의 설명으로 묶어 스크린 리더가 "14, /16 (87.5%)"로 읽게 한다. */}
      <span id={unitId} className="roll-unit">
        <span className="roll-denom">/{ROLL_STEPS}</span>{' '}
        <span className="roll-percent num" data-testid="roll-percent">
          ({shareText(committed / ROLL_STEPS)})
        </span>
      </span>
      {invalid && (
        <span id={hintId} className="field-hint" data-testid="roll-hint" role="status">
          1~{ROLL_STEPS - 1} 정수만 반영됩니다
        </span>
      )}
    </div>
  )
}

const SORT_OPTIONS: readonly { mode: SortMode; label: string }[] = [
  { mode: 'usage', label: '사용률' },
  { mode: 'result', label: '계산결과순' },
]

/** 작은 굵은 라벨 + 컨트롤 줄. 줄 이름 = 라벨(스크린 리더가 묶음으로 읽는다) */
function ToolRow({ id, label, testId, children }: { id: string; label: string; testId: string; children: ReactNode }) {
  return (
    <div className="tool-row" role="group" aria-labelledby={id} data-testid={testId}>
      <span id={id} className="tool-row-label">
        {label}
      </span>
      <div className="tool-group">{children}</div>
    </div>
  )
}

/**
 * 최소 사용률 입력(%). 화면 라벨("… 최소(%)")이 그대로 접근 이름이고(보이는 라벨 = 이름, WCAG 2.5.3),
 * "사용률" 뜻은 설명(aria-describedby)으로 붙인다.
 */
function ShareField({ label, value, onValue }: { label: string; value: number; onValue: (v: number) => void }) {
  const hintId = useId()
  return (
    <>
      <NumberField
        label={`${label} 최소(%)`}
        describedBy={hintId}
        value={value}
        toText={toPercentInput}
        fromText={fromPercentInput}
        min={0}
        max={100}
        step={0.5}
        onValue={onValue}
      />
      <span id={hintId} className="sr-only">
        {label} 최소 사용률(%), 이보다 적게 쓰이면 표에 넣지 않습니다
      </span>
    </>
  )
}

/**
 * 결과 목록 위 설정: 탭 줄 → 통계 설정(형식·기준 월·최소 사용률 3종) → 표시 설정(상위 N·정렬·판정 기준·순풍) → 포켓몬 찾기(단독 줄).
 */
export function Toolbar(p: Props) {
  const { game, view, state, dispatch } = p
  const uid = useId()
  const names = namesOf(game)
  const tabRefs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({})

  const pickIndex = searchIndexOf(game.data.species, rankingIdsOf(view))
  const selected = state.filters.selected

  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const i = TABS.indexOf(state.tab)
    let next: Tab | undefined
    if (e.key === 'ArrowRight') next = TABS[(i + 1) % TABS.length]
    else if (e.key === 'ArrowLeft') next = TABS[(i - 1 + TABS.length) % TABS.length]
    else if (e.key === 'Home') next = TABS[0]
    else if (e.key === 'End') next = TABS[TABS.length - 1]
    if (next === undefined) return
    e.preventDefault()
    dispatch({ type: 'set-tab', tab: next })
    tabRefs.current[next]?.focus()
  }

  const matches = [...new Set(p.metaItems.map((m) => m.match))]
  const months = p.metaItems.filter((m) => m.match === p.selection.match).map((m) => m.month)
  const setMeta = (match: MatchType, month: string) => {
    const candidates = p.metaItems.filter((m) => m.match === match).map((m) => m.month)
    const chosen = candidates.includes(month) ? month : candidates[candidates.length - 1]
    if (chosen !== undefined) dispatch({ type: 'set-meta', meta: { match, month: chosen } })
  }

  return (
    <div className="toolbar">
      <div className="tabs-row">
        <div role="tablist" aria-label="결과 탭" className="tabs">
          {TABS.map((t) => (
            <button
              key={t}
              ref={(el) => {
                tabRefs.current[t] = el
              }}
              id={p.tabIdOf(t)}
              type="button"
              role="tab"
              aria-selected={state.tab === t}
              aria-controls={p.panelId}
              tabIndex={state.tab === t ? 0 : -1}
              onClick={() => dispatch({ type: 'set-tab', tab: t })}
              onKeyDown={onTabKey}
            >
              {TAB_LABEL[t]}
            </button>
          ))}
        </div>
        <p className="meta-source" data-testid="meta-source">
          통계 {sourceText(p.source)}
        </p>
      </div>

      <div className="toolbar-controls">
        <ToolRow id={`${uid}-stats`} label="통계 설정" testId="tool-row-stats">
          <label className="inline-select">
            형식
            <select value={p.selection.match} onChange={(e) => setMeta(e.target.value as MatchType, p.selection.month)}>
              {matches.map((m) => (
                <option key={m} value={m}>
                  {MATCH_LABEL[m]}
                </option>
              ))}
            </select>
          </label>
          <label className="inline-select">
            기준 월
            <select value={p.selection.month} onChange={(e) => setMeta(p.selection.match, e.target.value)}>
              {months.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <ShareField label="SP 배분" value={state.criteria.bundleShareMin} onValue={(v) => dispatch({ type: 'set-criteria', criteria: { bundleShareMin: v } })} />
          <ShareField label="랭크업 기술" value={state.criteria.rankShareMin} onValue={(v) => dispatch({ type: 'set-criteria', criteria: { rankShareMin: v } })} />
          <ShareField label="구애스카프" value={state.criteria.scarfShareMin} onValue={(v) => dispatch({ type: 'set-criteria', criteria: { scarfShareMin: v } })} />
        </ToolRow>

        <ToolRow id={`${uid}-display`} label="표시 설정" testId="tool-row-display">
          <NumberField label="상위 N" value={state.filters.topN} min={1} step={1} onValue={(v) => dispatch({ type: 'set-top-n', topN: v })} />
          <div className="sort-field">
            <span id={`${uid}-sort`} className="sort-label">
              정렬
            </span>
            <div className="segmented" role="group" aria-labelledby={`${uid}-sort`} data-testid="sort-toggle">
              {SORT_OPTIONS.map((o) => (
                <button
                  key={o.mode}
                  type="button"
                  aria-pressed={state.sortMode === o.mode}
                  data-mode={o.mode}
                  onClick={() => dispatch({ type: 'set-sort', mode: o.mode })}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
          {state.tab !== 'speed' && <RollThresholdField key={state.tab} tab={state.tab} rollSteps={state.rollSteps} dispatch={dispatch} />}
          <label className="check">
            <input
              type="checkbox"
              checked={state.conditions.myTailwind}
              onChange={(e) => dispatch({ type: 'set-tailwind', side: 'me', on: e.target.checked })}
            />
            내 순풍
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={state.conditions.opponentTailwind}
              onChange={(e) => dispatch({ type: 'set-tailwind', side: 'opponent', on: e.target.checked })}
            />
            상대 순풍
          </label>
        </ToolRow>

        <div className="tool-row tool-row-search" data-testid="tool-row-search">
          <div className="pick">
            <Combobox
              label="포켓몬 찾기"
              index={pickIndex}
              value=""
              clearOnCommit
              optionsOnly
              placeholder="이름 검색"
              labelOf={names.species.label}
              onCommit={(_text, id) => {
                if (id !== undefined) dispatch({ type: 'set-selected', ids: [...selected, id] })
              }}
            />
            {selected.length > 0 && (
              <ul className="pick-chips" aria-label="선택한 포켓몬">
                {selected.map((id) => (
                  <li key={id}>
                    {names.species.label(id)}
                    <button
                      type="button"
                      aria-label={`${names.species.label(id)} 선택 해제`}
                      onClick={() => dispatch({ type: 'set-selected', ids: selected.filter((s) => s !== id) })}
                    >
                      ×
                    </button>
                  </li>
                ))}
                <li>
                  <button type="button" onClick={() => dispatch({ type: 'set-selected', ids: [] })}>
                    선택 비우기
                  </button>
                </li>
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
