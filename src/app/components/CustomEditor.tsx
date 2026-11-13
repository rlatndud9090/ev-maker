import { useMemo, type Dispatch } from 'react'
import { STAT_IDS } from '../../core'
import { MAX_CUSTOM_MOVES, presetAssumption, presetKey, type CardView, type CustomTarget, type PresetEdit, type PresetIndex, type Tab } from '../../cards'
import type { Snapshot } from '../../data/schema'
import { STAT_LABEL } from '../../ui/labels'
import { heldItemIds, namesOf } from '../../ui/names'
import { learnableMoves, searchIndexOf } from '../../ui/search'
import { STAT_SHORT } from '../../ui/format'
import type { AppAction } from '../state'
import { Combobox } from './Combobox'
import { NumberField } from './NumberField'

const NO_EDIT: PresetEdit = {}

interface Props {
  game: Snapshot
  tab: Tab
  card: CardView
  target: CustomTarget
  dispatch: Dispatch<AppAction>
}

/** 커스텀 카드 상세: 이 프리셋의 SP·성격·도구·특성과 타겟 기술 목록 편집. */
export function CustomEditor({ game, tab, card, target, dispatch }: Props) {
  const names = namesOf(game)
  const preset = (card.bundle.presetIndex ?? 0) as PresetIndex
  const key = presetKey(tab, card.category, preset)
  const edit = target.edits[key] ?? NO_EDIT
  const set = useMemo(
    () => presetAssumption(game, target.rosterId, target.moves, tab, card.category, preset, edit).set,
    [game, target.rosterId, target.moves, tab, card.category, preset, edit],
  )
  const species = Object.prototype.hasOwnProperty.call(game.data.species, set.species) ? game.data.species[set.species] : undefined
  const abilities = species ? [...species.abilities] : []
  if (!abilities.includes(set.ability)) abilities.push(set.ability)
  const itemIndex = searchIndexOf(game.data.items, heldItemIds(game))
  const learnable = useMemo(() => learnableMoves(game, target.rosterId), [game, target.rosterId])
  const moveIndex = useMemo(() => searchIndexOf(game.data.moves, learnable.filter((m) => !target.moves.includes(m))), [game, learnable, target.moves])
  const lastOne = target.moves.length <= 1
  const megaLocked = set.mega === true

  const put = (patch: PresetEdit) => dispatch({ type: 'edit-preset', rosterId: target.rosterId, key, edit: { ...edit, ...patch } })

  return (
    <div className="custom-editor">
      <fieldset>
        <legend>프리셋 {preset + 1} 가정 (사용자 지정)</legend>
        <div className="preset-sp">
          {STAT_IDS.map((s) => (
            <NumberField
              key={s}
              label={`프리셋 SP ${STAT_LABEL[s]}`}
              value={set.sp[s]}
              min={0}
              max={game.manifest.rules.spMaxPerStat}
              step={1}
              onValue={(v) => put({ sp: { ...edit.sp, [s]: v } })}
            />
          ))}
        </div>
        <div className="preset-fields">
          <label>
            프리셋 성격
            <select value={set.nature} onChange={(e) => put({ nature: e.target.value })}>
              {Object.values(game.data.natures).map((n) => (
                <option key={n.id} value={n.id}>
                  {names.natures.label(n.id)}
                  {n.plus && n.minus && n.plus !== n.minus ? ` (${STAT_SHORT[n.plus]}↑ ${STAT_SHORT[n.minus]}↓)` : ''}
                </option>
              ))}
            </select>
          </label>
          <label>
            프리셋 특성
            <select value={set.ability} onChange={(e) => put({ ability: e.target.value })}>
              {abilities.map((a) => (
                <option key={a} value={a}>
                  {names.abilities.label(a)}
                </option>
              ))}
            </select>
          </label>
          {megaLocked ? (
            <p className="hint">도구: {set.item !== undefined ? names.items.label(set.item) : '없음'} (메가 폼 고정)</p>
          ) : (
            <Combobox
              label="프리셋 도구"
              index={itemIndex}
              value={set.item !== undefined ? names.items.label(set.item) : ''}
              placeholder="없음"
              labelOf={names.items.label}
              onCommit={(text, id) => put({ item: text.trim() === '' ? null : (id ?? names.items.resolve(text) ?? text) })}
            />
          )}
        </div>
      </fieldset>

      <div role="group" aria-label="타겟 기술" className="target-moves">
        <p className="group-title">
          타겟 기술 <span className="hint">(모든 탭 공통, {target.moves.length}/{MAX_CUSTOM_MOVES})</span>
        </p>
        <ul className="move-chips">
          {target.moves.map((m) => (
            <li key={m}>
              <span className="chip-check on">
                {names.moves.label(m)}
                <button
                  type="button"
                  aria-label={`${names.moves.label(m)} 해제`}
                  disabled={lastOne}
                  title={lastOne ? '기술은 최소 1개 남아야 합니다' : undefined}
                  onClick={() => dispatch({ type: 'set-custom-moves', rosterId: target.rosterId, moves: target.moves.filter((x) => x !== m) })}
                >
                  ×
                </button>
              </span>
            </li>
          ))}
        </ul>
        {target.moves.length < MAX_CUSTOM_MOVES && (
          <Combobox
            label="타겟 기술 추가"
            index={moveIndex}
            value=""
            clearOnCommit
            optionsOnly
            placeholder="기술 검색"
            labelOf={names.moves.label}
            onCommit={(_text, id) => {
              if (id !== undefined) dispatch({ type: 'set-custom-moves', rosterId: target.rosterId, moves: [...target.moves, id] })
            }}
          />
        )}
      </div>
      <button type="button" className="danger" onClick={() => dispatch({ type: 'remove-custom-target', rosterId: target.rosterId })}>
        {names.species.label(target.rosterId)} 타겟 삭제
      </button>
    </div>
  )
}
