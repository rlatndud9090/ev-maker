import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type Dispatch } from 'react'
import { CoreError, CoreInputError, STAT_IDS, validateSet, type SpTable } from '../../core'
import { myMeansNotes, type CutLock, type ErrorReason, type LockDerivation, type LockResolution } from '../../cards'
import type { Snapshot, StatId, StatTable } from '../../data/schema'
import type { MetaView } from '../../meta'
import { STAT_LABEL, typeNameOf, typeSlug } from '../../ui/labels'
import { TypeIcon } from '../../ui/TypeIcon'
import { calcAbilityOf, myMoveType } from '../../ui/moveType'
import { heldItemIds, namesOf, pickSpecies } from '../../ui/names'
import { choiceOf, natureIdFor, refreshAuto, toggleMinus, togglePlus, type NatureChoice, type NatureStat } from '../../ui/natureToggle'
import { MOVE_SLOTS, parseNumber, toPokemonSet, type SetDraft } from '../../ui/setDraft'
import { searchIndexOf } from '../../ui/search'
import { STAT_SHORT } from '../../ui/format'
import { draftFieldOf, koReason, type DraftField } from '../../ui/koErrors'
import type { AppAction } from '../state'
import { useLockUi } from '../lockContext'
import { representativeDraft, speciesOnlyDraft } from '../speciesDraft'
import { Combobox } from './Combobox'
import { PokemonIcon } from './PokemonIcon'
import { TAB_LABEL, meansLabel } from './text'
import { LockList } from './LockList'
import { EMPTY_SLOT_TEXT } from './partyText'
import { clampSp, spLimit, type LockedSp } from '../spLimit'
import { LOCKED_MINUS_TEXT, LOCKED_SP_TEXT, NO_OUT_PLUS_TEXT, NO_PLUS_BRANCH_TEXT, NO_NEUTRAL_BRANCH_TEXT, lockStatusText, lockedStatText, overTotalText, statusSpoken, trimsText } from './lockText'
import './lockPanel.css'

interface Props {
  game: Snapshot
  /** 지금 선택한 통계 기준·월의 메타(처음 고른 종이면 그 종 대표 세트로 채운다) */
  view: MetaView
  draft: SetDraft
  dispatch: Dispatch<AppAction>
  /** 세 탭의 내 세트 오류 이유(중복 제거) */
  reasons: readonly ErrorReason[]
  /** 드래그 중 표시용 SP(null = 확정 SP) */
  onDisplaySp: (sp: SpTable | null) => void
  /** 지금 실행 세대의 컷 고정 해석(고정이 없거나 계산 중이면 undefined) */
  lockResolutions?: ReadonlyMap<number, LockResolution>
  /** 활성 파티 칸이 비었음(종 입력 아래 안내) */
  emptySlot?: boolean
}

const IGNORE_TOTAL = { ignoreSpTotal: true } as const
/** "상승이 고정 밖" 갈래 id(cards Branch.id) */
const OUT_BRANCH = 'out'

/** 고정 중에는 계획 세트 합이 상한을 넘어도 실능치를 보인다 */
function statsOf(game: Snapshot, draft: SetDraft, ignoreSpTotal: boolean): StatTable | undefined {
  try {
    return validateSet(game, toPokemonSet(game, draft).set, ignoreSpTotal ? IGNORE_TOTAL : undefined).stats
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

export function MySetPanel({ game, view, draft, dispatch, reasons, onDisplaySp, lockResolutions, emptySlot = false }: Props) {
  const uid = useId()
  const headRef = useRef<HTMLHeadingElement>(null)
  const lockUi = useLockUi()
  const bodyId = `${uid}-body`
  const names = namesOf(game)
  const [collapsed, setCollapsed] = useState(false)
  const [drag, setDrag] = useState<{ stat: StatId; value: number } | null>(null)
  const dragRef = useRef<{ stat: StatId; value: number } | null>(null)
  const raf = useRef(0)
  const pointerDown = useRef(false)

  const { spTotal, spMaxPerStat } = game.manifest.rules
  const pick = pickSpecies(game, draft.species)
  const speciesId = names.species.resolve(draft.species)
  // 마지막으로 풀린 종 id(종 칸이 오타 등으로 풀리지 않는 동안 "같은 종으로 돌아옴"을 가린다)
  const lastSpeciesId = useRef(speciesId)
  useEffect(() => {
    if (speciesId !== undefined) lastSpeciesId.current = speciesId
  }, [speciesId])
  const base = pick?.base
  const { set, megaByName } = useMemo(() => toPokemonSet(game, draft), [game, draft])

  const { locks } = lockUi
  const hasLocks = locks.length > 0
  const lockedStats = useMemo(() => new Set(locks.flatMap((l) => l.stats)), [locks])
  // 다시 계산하는 동안은 직전 파생을 보인다(고정 여부 자체는 지금 고정 목록을 따른다).
  const [lastDerivation, setLastDerivation] = useState<LockDerivation | null>(null)
  if (lockUi.derivation !== null && lockUi.derivation !== lastDerivation) setLastDerivation(lockUi.derivation)
  if (!hasLocks && lastDerivation !== null) setLastDerivation(null)
  const shown = lockUi.derivation ?? (hasLocks && lockUi.pending ? lastDerivation : null)
  // 고정 줄 ▲로 고른 기준 갈래를 계산 중에도 바로 보인다(파생이 오면 비운다)
  const [pickedBase, setPickedBase] = useState<string | null>(null)
  if (!lockUi.pending && pickedBase !== null) setPickedBase(null)
  const baseId = shown?.branches.some((b) => b.id === pickedBase) === true ? pickedBase : (shown?.baseId ?? null)
  const baseBranch = useMemo(() => shown?.branches.find((b) => b.id === baseId), [shown, baseId])
  // 기준 갈래가 있을 때만 계획이 합계 상한을 무시한다(모든 고정이 비활성·계산 중이면 고정 없는 규칙)
  const planLock = hasLocks && shown !== null && baseBranch !== undefined ? { derivation: shown, base: baseBranch } : null
  const ignoreTotal = planLock !== null
  /** 기준 갈래 값이 정해진 고정 능력치의 SP(그 밖은 undefined: 초안 값으로 계산된다) */
  const plannedSp = (s: StatId): number | undefined =>
    baseBranch !== undefined && lockedStats.has(s) && shown?.lockedStats.includes(s) === true ? (baseBranch.lockedSp[s] ?? 0) : undefined
  // 고정 중 계산·표시용 초안 = 초안 위에 기준 갈래 값(고정 능력치 SP·성격)을 덮는다
  const planDraft = useMemo((): SetDraft => {
    const b = baseBranch
    if (b === undefined || shown === null) return draft
    const sp = { ...draft.sp }
    for (const s of shown.lockedStats) if (lockedStats.has(s)) sp[s] = String(b.lockedSp[s] ?? 0)
    return { ...draft, nature: b.nature, sp }
  }, [draft, shown, baseBranch, lockedStats])
  const planSet = useMemo(() => (planDraft === draft ? set : toPokemonSet(game, planDraft).set), [game, planDraft, draft, set])

  const committed = Object.fromEntries(STAT_IDS.map((s) => [s, parseNumber(draft.sp[s])])) as SpTable
  const committedPlan = Object.fromEntries(STAT_IDS.map((s) => [s, plannedSp(s) ?? committed[s]])) as SpTable
  const spOf = (s: StatId) => (drag?.stat === s ? drag.value : committedPlan[s])
  const total = STAT_IDS.reduce((a, s) => a + spOf(s), 0)
  const remaining = spTotal - total

  const shownDraft = useMemo(() => (drag === null ? planDraft : { ...planDraft, sp: { ...planDraft.sp, [drag.stat]: String(drag.value) } }), [planDraft, drag])
  const stats = useMemo(() => statsOf(game, shownDraft, ignoreTotal), [game, shownDraft, ignoreTotal])
  const nature = Object.prototype.hasOwnProperty.call(game.data.natures, planDraft.nature) ? game.data.natures[planDraft.nature] : undefined

  const speciesIndex = searchIndexOf(game.data.species)
  const itemIndex = searchIndexOf(game.data.items, heldItemIds(game))
  const moveIndex = searchIndexOf(game.data.moves, base?.learnset)
  const notes = useMemo(() => myMeansNotes(game, planSet, ignoreTotal ? IGNORE_TOTAL : undefined), [game, planSet, ignoreTotal])

  const calcAbility = useMemo(() => calcAbilityOf(game, set), [game, set])
  const moveTypeAt = (i: number) => {
    const id = names.moves.resolve(draft.moves[i] ?? '')
    return typeNameOf(id === undefined ? undefined : myMoveType(game, id, calcAbility))
  }
  const moveIdsOf = (moves: readonly string[]) => moves.filter((m) => m.trim() !== '').map((m) => names.moves.resolve(m) ?? m)
  const choice = choiceOf(game, draft.nature, draft.natureMinusAuto === true)
  const shownChoice = planDraft === draft ? choice : choiceOf(game, planDraft.nature, false)
  const withChoice = (c: NatureChoice): Partial<SetDraft> => ({ nature: natureIdFor(game, c.plus, c.minus), natureMinusAuto: c.minusAuto })

  const update = (patch: Partial<SetDraft>) => {
    const next = { ...draft, ...patch }
    // 기술이 바뀌면 자동 하락(−)을 다시 정한다.
    if (patch.moves !== undefined && patch.nature === undefined) Object.assign(next, withChoice(refreshAuto(game, choice, moveIdsOf(next.moves))))
    dispatch({ type: 'set-draft', draft: next })
  }
  const pickBase = (id: string) => {
    if (id === baseId) return
    setPickedBase(id)
    lockUi.setBase(id)
  }
  /** 고정 밖 ▲: 평소처럼 초안 성격을 바꾼다. 고정 중에 켜면 기준 갈래도 "상승이 고정 밖"으로 고른다 */
  const onPlus = (s: NatureStat) => {
    if (!hasLocks) {
      update(withChoice(togglePlus(game, choice, s, moveIdsOf(draft.moves))))
      return
    }
    if (shownChoice.plus === s) {
      update(withChoice({ minusAuto: false }))
      return
    }
    if (choice.plus !== s) update(withChoice(togglePlus(game, choice, s, moveIdsOf(draft.moves))))
    if (shown?.branches.some((b) => b.id === OUT_BRANCH) === true) pickBase(OUT_BRANCH)
  }
  /** 고정 밖 ▼: 보이는 성격(고정 중에는 기준 갈래 성격)의 하락을 바꾼다 */
  const onMinus = (s: NatureStat) => {
    const from = hasLocks ? { ...shownChoice, minusAuto: choice.plus !== shownChoice.plus || choice.minus !== shownChoice.minus || choice.minusAuto } : choice
    update(withChoice(toggleMinus(game, from, s, moveIdsOf(draft.moves))))
  }
  const hasBranch = (id: string) => shown?.branches.some((b) => b.id === id) === true
  /**
   * ▲ 버튼 상태. 고정 줄은 기준 갈래 선택이다(켜면 "상승이 그 능력치", 끄면 "상승이 고정 밖"). 고를 갈래가 없으면 비활성.
   * 고정 밖 줄은 평소 성격 토글이고, 고정 중 "상승이 고정 밖" 갈래가 없으면 켤 수 없다.
   */
  const plusButtonOf = (s: NatureStat, locked: boolean): { pressed: boolean; disabled: boolean; title?: string; onClick: () => void } => {
    if (locked) {
      const plusId = `plus:${s}`
      const pressed = baseId === plusId
      const target = pressed ? OUT_BRANCH : plusId
      const reason = baseBranch === undefined ? undefined : hasBranch(target) ? undefined : pressed ? NO_NEUTRAL_BRANCH_TEXT : NO_PLUS_BRANCH_TEXT
      return { pressed, disabled: baseBranch === undefined || reason !== undefined, title: reason, onClick: () => pickBase(target) }
    }
    const pressed = shownChoice.plus === s
    const blocked = hasLocks && shown !== null && !pressed && !hasBranch(OUT_BRANCH)
    return { pressed, disabled: blocked, title: blocked ? NO_OUT_PLUS_TEXT : undefined, onClick: () => onPlus(s) }
  }

  const onSpecies = (text: string) => {
    // 풀린 종이 바뀌면(마지막으로 풀린 종과 비교: 오타를 거쳐 같은 종으로 돌아와도 손으로 고친 세트를 덮지 않는다) 지금 세트를 그
    // 종 기억에 넣고, 새 종 기억이 있으면 복원·없으면 대표 세트(메타 목록 밖이면 종만 바꾼다).
    const from = speciesId ?? lastSpeciesId.current
    const to = names.species.resolve(text)
    if (to === undefined || to === from) {
      update(speciesOnlyDraft(game, draft, text))
      return
    }
    const next = representativeDraft(game, (id) => view.entry(id), draft, text) ?? speciesOnlyDraft(game, draft, text)
    const baseOf = (id: string) => game.data.megas.find((m) => m.forme === id)?.base ?? id
    dispatch({ type: 'switch-species', from, to, draft: next, sameBase: from !== undefined && baseOf(from) === baseOf(to) })
  }

  // 상한 규칙 하나(spLimit)를 슬라이더·숫자 입력·−/+·리듀서가 함께 쓴다. 고정 중에는 고정 능력치를 기준 갈래 고정 SP로 센다.
  const lockedSp: LockedSp | null = planLock === null ? null : Object.fromEntries(STAT_IDS.flatMap((s) => (plannedSp(s) === undefined ? [] : [[s, plannedSp(s)]])))
  const limitOf = (s: StatId): number => spLimit(s, committed, game.manifest.rules, lockedSp)

  const commit = (stat: StatId, value: number) => {
    cancelAnimationFrame(raf.current)
    raf.current = 0
    dragRef.current = null
    setDrag(null)
    dispatch({ type: 'commit-sp', stat, value, rules: game.manifest.rules, lockedSp })
    // 값이 바뀌면 새 세대 setInput이 표시용 SP를 비운다(먼저 비우면 드래그 전 값으로 튄다).
    if (value === committed[stat]) onDisplaySp(null)
  }

  /** 숫자 칸: 정수면 상한으로 잘라 확정하고, 빈 칸·소수 등은 글자 그대로 둔다(세트 오류로 알린다) */
  const onNumber = (stat: StatId, text: string) => {
    const n = parseNumber(text)
    if (Number.isInteger(n)) commit(stat, clampSp(stat, n, committed, game.manifest.rules, lockedSp))
    else update({ sp: { ...draft.sp, [stat]: text } })
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
        if (d !== null) onDisplaySp({ ...committedPlan, [d.stat]: d.value })
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

  const megaForme = megaByName && speciesId !== undefined && Object.prototype.hasOwnProperty.call(game.data.species, speciesId) ? game.data.species[speciesId] : undefined
  const megaAbility = megaForme?.isMega === true ? megaForme.abilities[0] : undefined
  const abilityOptions = base ? [...base.abilities] : []
  if (!abilityOptions.includes(draft.ability)) abilityOptions.push(draft.ability)

  const summary = [
    draft.species,
    draft.item.trim() === '' ? '도구 없음' : draft.item,
    STAT_IDS.filter((s) => committedPlan[s] !== 0).map((s) => `${STAT_SHORT[s]}${plannedSp(s) ?? draft.sp[s]}`).join(' '),
  ].join(' · ')

  return (
    <section className="my-set" aria-labelledby={`${uid}-h`} role="region">
      <div className="my-set-head">
        <h2 id={`${uid}-h`} ref={headRef} tabIndex={-1}>
          내 포켓몬
        </h2>
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
            <div className="species-row">
              <PokemonIcon speciesId={speciesId} size={56} className="my-mon-icon" />
              <Combobox label="종" hideLabel index={speciesIndex} value={draft.species} placeholder="포켓몬 검색(메가 폼 포함)" labelOf={names.species.label} onCommit={onSpecies} />
            </div>
            {emptySlot && (
              <p className="empty-slot-hint" data-testid="empty-slot-hint">
                {EMPTY_SLOT_TEXT}
              </p>
            )}
            <FieldAlerts game={game} reasons={reasons} field="species" set={set} />
            <FieldAlerts game={game} reasons={reasons} field="mega" set={set} />
          </div>
          <div className="chip-field">
            {megaAbility !== undefined ? (
              // 메가 폼은 계산도 메가 폼 특성을 쓴다(core validateSet). 원종 특성 선택은 숨긴다.
              <label className="chip">
                특성
                <input value={names.abilities.label(megaAbility)} disabled title="메가 폼은 메가 폼 특성으로 고정됩니다" aria-describedby={`${uid}-mega-ability`} data-testid="mega-ability" />
                <span id={`${uid}-mega-ability`} className="hint">
                  메가 폼 고정
                </span>
              </label>
            ) : (
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
            )}
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
          {shown !== null && shown.overTotal > 0 && (
            <p className="lock-warn" role="status" data-testid="lock-over-total">
              {overTotalText(shown.overTotal, spTotal)}
            </p>
          )}
          {lockUi.trim !== null && (
            <div className="lock-trim" role="status" data-testid="lock-trim">
              <span>{trimsText(lockUi.trim, spTotal)}</span>
              <button
                type="button"
                aria-label="SP 줄임 알림 닫기"
                onClick={() => {
                  lockUi.dismissTrim()
                  headRef.current?.focus()
                }}
              >
                닫기
              </button>
            </div>
          )}
          <FieldAlerts game={game} reasons={reasons} field="sp" set={set} />
          <FieldAlerts game={game} reasons={reasons} field="nature" set={set} />
          {STAT_IDS.map((s) => {
            const value = spOf(s)
            const sliderValue = Number.isFinite(value) ? Math.max(0, Math.min(spMaxPerStat, value)) : 0
            const limit = limitOf(s)
            const mark = nature?.plus === s && nature.minus !== s ? '↑' : nature?.minus === s && nature.plus !== s ? '↓' : ''
            const locked = lockedStats.has(s)
            const lockState = locked ? lockedRowState(s, shown, plannedSp(s) !== undefined, lockUi.pending, locks) : undefined
            const lockDescId = `${uid}-locked-${s}`
            const plus = s === 'hp' ? undefined : plusButtonOf(s as NatureStat, locked)
            const minusAuto = !hasLocks && choice.minus === s && choice.minusAuto
            return (
              <div className="sp-row" key={s} data-locked={locked ? 'true' : undefined}>
                <span className="sp-stat">
                  {STAT_SHORT[s]}
                  {mark && <span className={mark === '↑' ? 'nat-plus' : 'nat-minus'}>{mark}</span>}
                  {lockState !== undefined && (
                    <span id={lockDescId} className="sr-only" data-testid={`sp-locked-${s}`}>
                      {lockState.spoken}
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  className="step"
                  aria-label={`SP ${STAT_LABEL[s]} 1 내리기`}
                  disabled={locked || !Number.isFinite(value) || value <= 0}
                  onClick={() => commit(s, Math.min(spMaxPerStat, value - 1))}
                >
                  −
                </button>
                <input
                  type="range"
                  aria-label={`SP ${STAT_LABEL[s]}`}
                  aria-describedby={locked ? lockDescId : undefined}
                  min={0}
                  max={spMaxPerStat}
                  step={1}
                  value={sliderValue}
                  disabled={locked}
                  style={locked ? ({ '--fill': `${(sliderValue / spMaxPerStat) * 100}%` } as CSSProperties) : undefined}
                  onPointerDown={() => {
                    pointerDown.current = true
                  }}
                  onChange={(e) => onSlide(s, Number(e.target.value))}
                />
                <button
                  type="button"
                  className="step"
                  aria-label={`SP ${STAT_LABEL[s]} 1 올리기`}
                  disabled={locked || !Number.isFinite(value) || value >= limit}
                  onClick={() => commit(s, Math.min(limit, value + 1))}
                >
                  +
                </button>
                <input
                  type="number"
                  className="sp-num"
                  inputMode="numeric"
                  aria-label={`SP ${STAT_LABEL[s]} 숫자`}
                  aria-describedby={locked ? lockDescId : undefined}
                  title={lockState?.title}
                  min={0}
                  max={spMaxPerStat}
                  value={locked ? (Number.isFinite(value) ? String(value) : draft.sp[s]) : drag?.stat === s ? String(drag.value) : draft.sp[s]}
                  disabled={locked}
                  onChange={(e) => onNumber(s, e.target.value)}
                />
                {plus === undefined ? (
                  <span className="nat-btns" aria-hidden="true" />
                ) : (
                  <span className="nat-btns" role="group" aria-label={`${STAT_LABEL[s]} 성격 보정`}>
                    <button
                      type="button"
                      className="nat-btn plus"
                      aria-pressed={plus.pressed}
                      aria-label={`${STAT_LABEL[s]} 성격 상승`}
                      aria-describedby={locked ? lockDescId : undefined}
                      title={plus.title}
                      disabled={plus.disabled}
                      onClick={plus.onClick}
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      className="nat-btn minus"
                      aria-pressed={!locked && shownChoice.minus === s}
                      data-auto={minusAuto ? 'true' : undefined}
                      aria-label={`${STAT_LABEL[s]} 성격 하락${minusAuto ? ' (자동)' : ''}`}
                      title={
                        locked
                          ? LOCKED_MINUS_TEXT
                          : shownChoice.plus === undefined
                            ? '상승(▲)을 먼저 고르세요'
                            : minusAuto
                              ? '자동 지정(덜 쓰이는 능력치) — 눌러서 직접 지정'
                              : undefined
                      }
                      disabled={locked || shownChoice.plus === undefined || shownChoice.plus === s}
                      onClick={() => onMinus(s as NatureStat)}
                    >
                      ▼
                    </button>
                  </span>
                )}
                <span className="stat-value num" aria-label={`${STAT_LABEL[s]} 실능치`}>
                  {stats ? stats[s] : '—'}
                </span>
                <div className="sp-alert">
                  {lockState?.chip !== undefined && (
                    <span className="lock-chip" title={lockState.chip.detail} aria-hidden="true">
                      {lockState.chip.text}
                    </span>
                  )}
                  <FieldAlerts game={game} reasons={reasons} field={`sp.${s}`} set={set} />
                </div>
              </div>
            )
          })}
        </div>
        <LockList game={game} dispatch={dispatch} derivation={shown} resolutions={lockResolutions} fallbackFocus={headRef} />
      </div>
    </section>
  )
}

interface LockedRowState {
  /** 읽기 설명 "SP 스피드 고정됨: S8+ / S23" */
  spoken: string
  /** 숫자 칸 툴팁 */
  title: string
  /** 기준 갈래 값이 없을 때(계산 중·문제 고정만) 그 상태 */
  chip?: { text: string; detail?: string }
}

/** 고정 능력치 줄 상태: 기준 갈래 값이 있으면 갈래별 값, 문제 고정만 있으면 그 상태 */
function lockedRowState(stat: StatId, derivation: LockDerivation | null, planned: boolean, pending: boolean, locks: readonly CutLock[]): LockedRowState {
  const head = `SP ${STAT_LABEL[stat]} ${LOCKED_SP_TEXT}`
  if (planned && derivation !== null) {
    const values = lockedStatText(derivation, stat)
    return { spoken: `${head}: ${values}`, title: `${LOCKED_SP_TEXT}: ${values}` }
  }
  let chip: LockedRowState['chip']
  if (pending) chip = { text: '계산 중' }
  else if (derivation !== null) {
    for (const l of locks) {
      const status = l.stats.includes(stat) ? derivation.statuses.get(l.seq) : undefined
      chip = status === undefined ? undefined : lockStatusText(status)
      if (chip !== undefined) break
    }
  }
  if (chip === undefined) return { spoken: head, title: LOCKED_SP_TEXT }
  return { spoken: `${head}: ${statusSpoken(chip)}`, title: `${LOCKED_SP_TEXT}: ${statusSpoken(chip)}`, chip }
}
