import { useEffect, useId, useMemo, useRef, useState, type Dispatch } from 'react'
import { CoreError, CoreInputError, STAT_IDS, computeStats, type SpTable } from '../../core'
import { myMeansNotes, type ErrorReason } from '../../cards'
import type { Snapshot, StatId, StatTable } from '../../data/schema'
import { STAT_LABEL, typeNameOf, typeSlug } from '../../ui/labels'
import { TypeIcon } from '../../ui/TypeIcon'
import { heldItemIds, namesOf, pickSpecies } from '../../ui/names'
import { choiceOf, natureIdFor, refreshAuto, toggleMinus, togglePlus, type NatureChoice, type NatureStat } from '../../ui/natureToggle'
import { MOVE_SLOTS, parseNumber, toPokemonSet, type SetDraft } from '../../ui/setDraft'
import { searchIndexOf } from '../../ui/search'
import { STAT_SHORT } from '../../ui/format'
import { draftFieldOf, koReason, type DraftField } from '../../ui/koErrors'
import type { AppAction } from '../state'
import { Combobox } from './Combobox'
import { TAB_LABEL, meansLabel } from './text'

interface Props {
  game: Snapshot
  draft: SetDraft
  dispatch: Dispatch<AppAction>
  /** 세 탭의 내 세트 오류 이유(중복 제거) */
  reasons: readonly ErrorReason[]
  /** 드래그 중 표시용 SP(null = 확정 SP) */
  onDisplaySp: (sp: SpTable | null) => void
}

function statsOf(game: Snapshot, draft: SetDraft): StatTable | undefined {
  try {
    return computeStats(game, toPokemonSet(game, draft).set)
  } catch (e) {
    if (e instanceof CoreError || e instanceof CoreInputError) return undefined
    throw e
  }
}

function FieldAlerts({ game, reasons, field, set }: { game: Snapshot; reasons: readonly ErrorReason[]; field: DraftField; set: Parameters<typeof koReason>[2] }) {
  const mine = reasons.filter((r) => draftFieldOf(r) === field)
  if (mine.length === 0) return null
  return (
    <>
      {mine.map((r, i) => (
        <p key={i} role="alert" className="field-alert">
          {koReason(game, r, set)}
        </p>
      ))}
    </>
  )
}

export function MySetPanel({ game, draft, dispatch, reasons, onDisplaySp }: Props) {
  const uid = useId()
  const bodyId = `${uid}-body`
  const names = namesOf(game)
  const [collapsed, setCollapsed] = useState(false)
  const [drag, setDrag] = useState<{ stat: StatId; value: number } | null>(null)
  const dragRef = useRef<{ stat: StatId; value: number } | null>(null)
  const raf = useRef(0)
  const pointerDown = useRef(false)

  const { spTotal, spMaxPerStat } = game.manifest.rules
  const pick = pickSpecies(game, draft.species)
  const base = pick?.base
  const { set, megaByName } = useMemo(() => toPokemonSet(game, draft), [game, draft])
  const committed = Object.fromEntries(STAT_IDS.map((s) => [s, parseNumber(draft.sp[s])])) as SpTable
  const spOf = (s: StatId) => (drag?.stat === s ? drag.value : committed[s])
  const total = STAT_IDS.reduce((a, s) => a + spOf(s), 0)
  const remaining = spTotal - total

  const shownDraft = useMemo(() => (drag === null ? draft : { ...draft, sp: { ...draft.sp, [drag.stat]: String(drag.value) } }), [draft, drag])
  const stats = useMemo(() => statsOf(game, shownDraft), [game, shownDraft])
  const nature = Object.prototype.hasOwnProperty.call(game.data.natures, draft.nature) ? game.data.natures[draft.nature] : undefined

  const speciesIndex = searchIndexOf(game.data.species)
  const itemIndex = searchIndexOf(game.data.items, heldItemIds(game))
  const moveIndex = searchIndexOf(game.data.moves, base?.learnset)
  const notes = useMemo(() => myMeansNotes(game, set), [game, set])

  const moveTypeAt = (i: number) => {
    const id = names.moves.resolve(draft.moves[i] ?? '')
    return typeNameOf(id === undefined ? undefined : game.data.moves[id]?.type)
  }
  const moveIdsOf = (moves: readonly string[]) => moves.filter((m) => m.trim() !== '').map((m) => names.moves.resolve(m) ?? m)
  const choice = choiceOf(game, draft.nature, draft.natureMinusAuto === true)
  const withChoice = (c: NatureChoice): Partial<SetDraft> => ({ nature: natureIdFor(game, c.plus, c.minus), natureMinusAuto: c.minusAuto })

  const update = (patch: Partial<SetDraft>) => {
    const next = { ...draft, ...patch }
    // 기술이 바뀌면 자동 하락(−)을 다시 정한다.
    if (patch.moves !== undefined && patch.nature === undefined) Object.assign(next, withChoice(refreshAuto(game, choice, moveIdsOf(next.moves))))
    dispatch({ type: 'set-draft', draft: next })
  }
  const onPlus = (s: NatureStat) => update(withChoice(togglePlus(game, choice, s, moveIdsOf(draft.moves))))
  const onMinus = (s: NatureStat) => update(withChoice(toggleMinus(game, choice, s, moveIdsOf(draft.moves))))

  const onSpecies = (text: string) => {
    const next = pickSpecies(game, text)
    // 메가는 메가 폼 종 이름으로만 고른다(스톤 자동 고정). 메가 폼에서 벗어나면 스톤을 비운다.
    const patch: Partial<SetDraft> = { species: text, mega: false }
    if (next) {
      if (!next.base.abilities.includes(draft.ability)) patch.ability = next.base.abilities[0]
      if (next.megaStone !== undefined) patch.item = names.items.label(next.megaStone)
      else if (pick?.megaStone !== undefined) patch.item = ''
    }
    update(patch)
  }

  /** 잔여 예산까지(다른 능력치는 확정 값). 이미 초과면 현재 값에서 멈춘다. */
  const limitOf = (s: StatId): number => {
    const others = STAT_IDS.reduce((a, k) => (k === s ? a : a + committed[k]), 0)
    if (!Number.isFinite(others) || !Number.isFinite(committed[s])) return spMaxPerStat
    return Math.min(spMaxPerStat, Math.max(committed[s], spTotal - others))
  }

  const commit = (stat: StatId, value: number) => {
    cancelAnimationFrame(raf.current)
    raf.current = 0
    dragRef.current = null
    setDrag(null)
    dispatch({ type: 'commit-sp', stat, value })
    // 값이 바뀌면 새 세대 setInput이 표시용 SP를 비운다(먼저 비우면 드래그 전 값으로 튄다).
    if (value === committed[stat]) onDisplaySp(null)
  }

  const onSlide = (stat: StatId, raw: number) => {
    const value = Math.min(raw, limitOf(stat))
    if (!pointerDown.current) {
      commit(stat, value)
      return
    }
    dragRef.current = { stat, value }
    setDrag({ stat, value })
    if (STAT_IDS.some((s) => !Number.isFinite(committed[s]))) return
    if (raf.current === 0) {
      raf.current = requestAnimationFrame(() => {
        raf.current = 0
        const d = dragRef.current
        if (d !== null) onDisplaySp({ ...committed, [d.stat]: d.value })
      })
    }
  }

  // 슬라이더 밖에서 놓아도 확정한다.
  const commitRef = useRef(commit)
  useEffect(() => {
    commitRef.current = commit
  })
  useEffect(() => {
    const up = () => {
      if (!pointerDown.current) return
      pointerDown.current = false
      const d = dragRef.current
      if (d !== null) commitRef.current(d.stat, d.value)
    }
    window.addEventListener('pointerup', up, true)
    window.addEventListener('pointercancel', up, true)
    return () => {
      window.removeEventListener('pointerup', up, true)
      window.removeEventListener('pointercancel', up, true)
      cancelAnimationFrame(raf.current)
    }
  }, [])

  const abilityOptions = base ? [...base.abilities] : []
  if (!abilityOptions.includes(draft.ability)) abilityOptions.push(draft.ability)

  const summary = [
    draft.species,
    draft.item.trim() === '' ? '도구 없음' : draft.item,
    STAT_IDS.filter((s) => committed[s] !== 0).map((s) => `${STAT_SHORT[s]}${draft.sp[s]}`).join(' '),
  ].join(' · ')

  return (
    <section className="my-set" aria-labelledby={`${uid}-h`} role="region">
      <div className="my-set-head">
        <h2 id={`${uid}-h`}>내 포켓몬</h2>
        <button type="button" className="collapse-btn" aria-expanded={!collapsed} aria-controls={bodyId} onClick={() => setCollapsed((c) => !c)}>
          {collapsed ? '설정 펼치기' : '설정 접기'}
        </button>
      </div>
      {collapsed && (
        <p className="my-set-summary" data-testid="my-set-summary">
          {summary}
        </p>
      )}
      <div id={bodyId} className="my-set-body" hidden={collapsed}>
        <FieldAlerts game={game} reasons={reasons} field="other" set={set} />
        <div className="chips">
          <div className="chip-field wide-chip">
            <Combobox label="종" hideLabel index={speciesIndex} value={draft.species} placeholder="포켓몬 검색(메가 폼 포함)" labelOf={names.species.label} onCommit={onSpecies} />
            <FieldAlerts game={game} reasons={reasons} field="species" set={set} />
            <FieldAlerts game={game} reasons={reasons} field="mega" set={set} />
          </div>
          <div className="chip-field">
            <label className="chip">
              특성
              <select value={draft.ability} onChange={(e) => update({ ability: e.target.value })}>
                {abilityOptions.map((a) => (
                  <option key={a} value={a}>
                    {base?.abilities.includes(a) ? names.abilities.label(a) : `(가질 수 없음) ${names.abilities.label(a)}`}
                  </option>
                ))}
              </select>
            </label>
            <FieldAlerts game={game} reasons={reasons} field="ability" set={set} />
          </div>
          <div className="chip-field">
            {megaByName ? (
              <label className="chip">
                도구
                <input value={draft.item} disabled title="메가 폼은 메가스톤으로 고정됩니다" aria-describedby={`${uid}-mega-item`} />
                <span id={`${uid}-mega-item`} className="hint">
                  메가 폼 고정
                </span>
              </label>
            ) : (
              <Combobox label="도구" index={itemIndex} value={draft.item} placeholder="없음" labelOf={names.items.label} onCommit={(text) => update({ item: text })} />
            )}
            <FieldAlerts game={game} reasons={reasons} field="item" set={set} />
          </div>
          <div className="chip-field wide-chip move-fields" role="group" aria-labelledby={`${uid}-moves`}>
            <span id={`${uid}-moves`} className="field-label">
              기술
            </span>
            {Array.from({ length: MOVE_SLOTS }, (_, i) => {
              const type = moveTypeAt(i)
              const typeId = `${uid}-move-type-${i}`
              return (
                <div key={i}>
                  <div className="move-slot" data-type={type ? typeSlug(type) : undefined}>
                    {type && <TypeIcon type={type} labelId={typeId} />}
                    <Combobox
                      label={`기술 ${i + 1}`}
                      hideLabel
                      describedBy={type ? typeId : undefined}
                      index={moveIndex}
                      value={draft.moves[i] ?? ''}
                      labelOf={names.moves.label}
                      onCommit={(text) => {
                        const moves = Array.from({ length: MOVE_SLOTS }, (_, k) => draft.moves[k] ?? '')
                        moves[i] = text
                        update({ moves })
                      }}
                    />
                  </div>
                  <FieldAlerts game={game} reasons={reasons} field={`moves[${i}]`} set={set} />
                </div>
              )
            })}
          </div>
        </div>
        <FieldAlerts game={game} reasons={reasons} field="moves" set={set} />
        {notes.length > 0 && (
          <ul className="means-notes" aria-label="내 랭크 수단">
            {notes.map((n) => (
              <li key={`${n.means.kind}:${n.means.id}`}>
                {meansLabel(game, n.means)}: {n.tabs.map((t) => TAB_LABEL[t]).join('·')} 탭 랭크 행 추가
              </li>
            ))}
          </ul>
        )}

        <div className="sp-block">
          <p className="sp-remaining">
            SP 합계 <span className="num">{Number.isFinite(total) ? total : '?'}</span> / {spTotal} · 잔여{' '}
            <strong data-testid="sp-remaining" className="num">
              {Number.isFinite(remaining) ? remaining : '?'}
            </strong>
          </p>
          <FieldAlerts game={game} reasons={reasons} field="sp" set={set} />
          <FieldAlerts game={game} reasons={reasons} field="nature" set={set} />
          {STAT_IDS.map((s) => {
            const value = spOf(s)
            const sliderValue = Number.isFinite(value) ? Math.max(0, Math.min(spMaxPerStat, value)) : 0
            const limit = limitOf(s)
            const mark = nature?.plus === s && nature.minus !== s ? '↑' : nature?.minus === s && nature.plus !== s ? '↓' : ''
            return (
              <div className="sp-row" key={s}>
                <span className="sp-stat">
                  {STAT_SHORT[s]}
                  {mark && <span className={mark === '↑' ? 'nat-plus' : 'nat-minus'}>{mark}</span>}
                </span>
                <button
                  type="button"
                  className="step"
                  aria-label={`SP ${STAT_LABEL[s]} 1 내리기`}
                  disabled={!Number.isFinite(value) || value <= 0}
                  onClick={() => commit(s, Math.min(spMaxPerStat, value - 1))}
                >
                  −
                </button>
                <input
                  type="range"
                  aria-label={`SP ${STAT_LABEL[s]}`}
                  min={0}
                  max={spMaxPerStat}
                  step={1}
                  value={sliderValue}
                  onPointerDown={() => {
                    pointerDown.current = true
                  }}
                  onChange={(e) => onSlide(s, Number(e.target.value))}
                />
                <button
                  type="button"
                  className="step"
                  aria-label={`SP ${STAT_LABEL[s]} 1 올리기`}
                  disabled={!Number.isFinite(value) || value >= limit}
                  onClick={() => commit(s, Math.min(limit, value + 1))}
                >
                  +
                </button>
                <input
                  type="number"
                  className="sp-num"
                  inputMode="numeric"
                  aria-label={`SP ${STAT_LABEL[s]} 숫자`}
                  min={0}
                  max={spMaxPerStat}
                  value={drag?.stat === s ? String(drag.value) : draft.sp[s]}
                  onChange={(e) => update({ sp: { ...draft.sp, [s]: e.target.value } })}
                />
                {s === 'hp' ? (
                  <span className="nat-btns" aria-hidden="true" />
                ) : (
                  <span className="nat-btns" role="group" aria-label={`${STAT_LABEL[s]} 성격 보정`}>
                    <button
                      type="button"
                      className="nat-btn plus"
                      aria-pressed={choice.plus === s}
                      aria-label={`${STAT_LABEL[s]} 성격 상승`}
                      onClick={() => onPlus(s)}
                    >
                      +
                    </button>
                    <button
                      type="button"
                      className="nat-btn minus"
                      aria-pressed={choice.minus === s}
                      data-auto={choice.minus === s && choice.minusAuto ? 'true' : undefined}
                      aria-label={`${STAT_LABEL[s]} 성격 하락${choice.minus === s && choice.minusAuto ? ' (자동)' : ''}`}
                      title={choice.plus === undefined ? '상승(+)을 먼저 고르세요' : choice.minus === s && choice.minusAuto ? '자동 지정(덜 쓰이는 능력치) — 눌러서 직접 지정' : undefined}
                      disabled={choice.plus === undefined || choice.plus === s}
                      onClick={() => onMinus(s)}
                    >
                      −
                    </button>
                  </span>
                )}
                <span className="stat-value num" aria-label={`${STAT_LABEL[s]} 실능치`}>
                  {stats ? stats[s] : '—'}
                </span>
                <div className="sp-alert">
                  <FieldAlerts game={game} reasons={reasons} field={`sp.${s}`} set={set} />
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
