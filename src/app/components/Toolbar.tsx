import { useId, useRef, useState, type Dispatch, type KeyboardEvent, type Ref } from 'react'
import { ROLL_STEPS, TABS, type MetaSourceView, type Tab } from '../../cards'
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
  customOpen: boolean
  onToggleCustom: () => void
  customButtonRef: Ref<HTMLButtonElement>
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

export function Toolbar({ customButtonRef, ...p }: Props) {
  const { game, view, state, dispatch } = p
  const uid = useId()
  const names = namesOf(game)
  const [criteriaOpen, setCriteriaOpen] = useState(false)
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
        <div className="tool-group">
          <NumberField label="상위 N" value={state.filters.topN} min={1} step={1} onValue={(v) => dispatch({ type: 'set-top-n', topN: v })} />
          <div className="pick">
            <Combobox
              label="포켓몬 선택"
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
          <button type="button" ref={customButtonRef} aria-expanded={p.customOpen} onClick={p.onToggleCustom}>
            포켓몬 추가
          </button>
        </div>

        <div className="tool-group">
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
          <label className="inline-select">
            통계 기준
            <select value={p.selection.match} onChange={(e) => setMeta(e.target.value as MatchType, p.selection.month)}>
              {matches.map((m) => (
                <option key={m} value={m}>
                  {MATCH_LABEL[m]}
                </option>
              ))}
            </select>
          </label>
          <label className="inline-select">
            월
            <select value={p.selection.month} onChange={(e) => setMeta(p.selection.match, e.target.value)}>
              {months.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <button type="button" aria-expanded={criteriaOpen} aria-controls={`${uid}-criteria`} onClick={() => setCriteriaOpen((o) => !o)}>
            표시 기준
          </button>
        </div>

        <div id={`${uid}-criteria`} className="criteria" hidden={!criteriaOpen}>
          <NumberField
            label="배분 최소비중(%)"
            value={state.criteria.bundleShareMin}
            toText={toPercentInput}
            fromText={fromPercentInput}
            min={0}
            max={100}
            step={0.5}
            onValue={(v) => dispatch({ type: 'set-criteria', criteria: { bundleShareMin: v } })}
          />
          <NumberField
            label="랭업 최소사용률(%)"
            value={state.criteria.rankShareMin}
            toText={toPercentInput}
            fromText={fromPercentInput}
            min={0}
            max={100}
            step={0.5}
            onValue={(v) => dispatch({ type: 'set-criteria', criteria: { rankShareMin: v } })}
          />
          <NumberField
            label="스카프 최소사용률(%)"
            value={state.criteria.scarfShareMin}
            toText={toPercentInput}
            fromText={fromPercentInput}
            min={0}
            max={100}
            step={0.5}
            onValue={(v) => dispatch({ type: 'set-criteria', criteria: { scarfShareMin: v } })}
          />
        </div>
      </div>
    </div>
  )
}
