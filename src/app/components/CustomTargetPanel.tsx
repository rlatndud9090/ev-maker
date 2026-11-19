import { useEffect, useId, useMemo, useRef, useState, type Dispatch, type ReactNode } from 'react'
import {
  MAX_CUSTOM_MOVES,
  addedBundleCardId,
  additionTargetOf,
  bundleLabel,
  damageAdditionQuery,
  groupKey,
  isDamageTab,
  judgeDamageAddition,
  judgeSpeedAddition,
  setKeySign,
  signOf,
  speedAdditionQuery,
  targetStatus,
  type AdditionTarget,
  type CardFilters,
  type CardInput,
  type CustomTarget,
  type DamageAdditionQuery,
  type DamageCategoryQuery,
  type DamageTab,
  type KeySigns,
  type NatureSign,
  type SpeedAdditionQuery,
  type SpeedChartInput,
  type Tab,
  type TargetStatus,
} from '../../cards'
import type { Snapshot, StatId } from '../../data/schema'
import type { MetaView } from '../../meta'
import { STAT_SHORT, bundleText, shareText } from '../../ui/format'
import { MOVE_CATEGORY_LABEL, STAT_LABEL } from '../../ui/labels'
import { namesOf } from '../../ui/names'
import { learnableMoves, searchIndexOf, searchNames } from '../../ui/search'
import { OBSERVED_STATE_TEXT, additionMessage } from '../additionText'
import type { RevealRequest } from '../reveal'
import type { AppAction } from '../state'
import { useAnnounce } from '../useAnnounce'
import { BundleText } from './BundleText'
import { Combobox } from './Combobox'
import { NatureToggle } from './NatureToggle'
import { NumberField } from './NumberField'

interface Props {
  /** 제목 id(팝오버 접근 이름) */
  headingId: string
  game: Snapshot
  /** 화면에 보이는 메타(질의 입력과 같은 view) */
  view: MetaView
  tab: Tab
  filters: CardFilters
  customTargets: readonly CustomTarget[]
  /** 스피드 탭 질의 입력(스피드 차트와 같은 입력) */
  speedInput: SpeedChartInput
  /** 공·방 탭 질의 입력(view와 같은 메타로 만든 카드 입력) */
  damageInput: CardInput
  bundleShareMin: number
  /** 고른 포켓몬(탭을 바꿔도 유지되게 앱이 들고 있다) */
  rosterId: string | null
  onPick: (rosterId: string | null) => void
  /** 처음 열 때만 검색창에 포커스한다(탭 전환으로 다시 그려질 때는 포커스를 옮기지 않는다) */
  autoFocus: boolean
  onAutoFocused: () => void
  dispatch: Dispatch<AppAction>
  /** 새 목록 밖 포켓몬을 더한 뒤 */
  onAddedTarget: () => void
  /** 배분을 더한 뒤: 그 배분으로 포커스·스크롤 */
  onAdded: (reveal: RevealRequest) => void
  onCancel: () => void
}

/** 표시할 기술 칩 수(선택한 기술은 항상 보인다) */
const MOVE_CHIP_LIMIT = 40

const STATUS_TAG: Readonly<Record<TargetStatus, string | undefined>> = {
  meta: '메타 목록',
  'out-of-range': '표시 범위 밖',
  added: '추가됨',
  new: undefined,
}

type Query = { kind: 'speed'; q: SpeedAdditionQuery } | { kind: 'damage'; tab: DamageTab; q: DamageAdditionQuery }

const FOCUSABLE = 'input:not([disabled]), button:not([disabled])'

/**
 * '포켓몬 추가': 검색 → 고른 포켓몬 칩 → 모드 본문(새 목록 밖 포켓몬은 기술 1~4개, 이미 있는 포켓몬은 이 탭의 새 배분).
 * 배분 판정·문구는 스피드 배지 상세·카드 메뉴 '직접 추가'와 같은 질의·판정을 쓴다.
 */
export function CustomTargetPanel(p: Props) {
  const { headingId, game, view, tab, filters, customTargets, speedInput, damageInput, bundleShareMin, rosterId, onPick, autoFocus, onAutoFocused, onCancel } = p
  const names = namesOf(game)
  const sectionRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  /** 칩·검색창이 바뀐 뒤 옮길 포커스(검색창이 언마운트되는 선택, 칩이 언마운트되는 다시 검색) */
  const focusNext = useRef<'body' | 'search' | null>(null)

  useEffect(() => {
    if (!autoFocus) return
    sectionRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus()
    onAutoFocused()
  }, [autoFocus, onAutoFocused])

  useEffect(() => {
    const next = focusNext.current
    focusNext.current = null
    if (next === 'body') (bodyRef.current?.querySelector<HTMLElement>(FOCUSABLE) ?? sectionRef.current?.querySelector<HTMLElement>(FOCUSABLE))?.focus()
    else if (next === 'search') sectionRef.current?.querySelector<HTMLElement>('input[role="combobox"]')?.focus()
  }, [rosterId])

  const rosterIndex = useMemo(() => searchIndexOf(game.data.species, Object.keys(game.data.species)), [game])
  const tagOf = (rid: string) => STATUS_TAG[targetStatus(view, filters, customTargets, rid)]
  const status = rosterId === null ? null : targetStatus(view, filters, customTargets, rosterId)
  const target: AdditionTarget | null = rosterId === null ? null : additionTargetOf(view, rosterId)

  const query = useMemo((): Query | null => {
    if (rosterId === null || status === null || status === 'new') return null
    const t = additionTargetOf(view, rosterId)
    if (isDamageTab(tab)) return { kind: 'damage', tab, q: damageAdditionQuery(damageInput, tab, t) }
    return { kind: 'speed', q: speedAdditionQuery(speedInput, bundleShareMin, t) }
  }, [rosterId, status, view, tab, damageInput, speedInput, bundleShareMin])

  const spMax = game.manifest.rules.spMaxPerStat
  const actions = (submittable: boolean, onSubmit?: () => void, describedBy?: string) => (
    <div className="panel-actions">
      <button type="button" onClick={onCancel}>
        취소
      </button>
      <button type={onSubmit === undefined ? 'submit' : 'button'} className="primary" data-testid="add-submit" disabled={!submittable} aria-describedby={describedBy} onClick={onSubmit}>
        추가
      </button>
    </div>
  )

  let body: ReactNode = null
  if (rosterId !== null && target !== null) {
    if (status === 'new') {
      body = (
        <NewTargetBody
          key={rosterId}
          game={game}
          rosterId={rosterId}
          actions={actions}
          onAdd={(moves) => {
            p.dispatch({ type: 'add-custom-target', rosterId, moves })
            p.onAddedTarget()
          }}
        />
      )
    } else if (query !== null && query.q.kind === 'unavailable') {
      body = <UnavailableBody text={additionMessage(query.q, '', spMax)} actions={actions} />
    } else if (query !== null && query.kind === 'speed' && query.q.kind === 'ok') {
      body = <SpeedBody key={`speed:${rosterId}`} q={query.q} target={target} spMax={spMax} dispatch={p.dispatch} onAdded={p.onAdded} actions={actions} />
    } else if (query !== null && query.kind === 'damage' && query.q.kind === 'ok') {
      body = <DamageBody key={`${query.tab}:${rosterId}`} tab={query.tab} categories={query.q.categories} target={target} spMax={spMax} dispatch={p.dispatch} onAdded={p.onAdded} actions={actions} />
    }
  }

  const tag = status === null ? undefined : STATUS_TAG[status]
  return (
    <div ref={sectionRef} className="custom-panel">
      <h2 id={headingId}>포켓몬 추가</h2>
      <p className="hint">
        메타 목록에 있거나 이미 추가한 포켓몬은 이 탭의 새 배분을, 목록에 없는 포켓몬은 사용자 지정 가정으로 추가합니다. 새 포켓몬은 기술을 직접 1~{MAX_CUSTOM_MOVES}개 고릅니다.
      </p>
      {rosterId === null ? (
        <Combobox
          label="추가할 포켓몬"
          index={rosterIndex}
          value=""
          optionsOnly
          placeholder="이름 검색"
          labelOf={names.species.label}
          tagOf={tagOf}
          onCommit={(_text, picked) => {
            if (picked === undefined) return
            focusNext.current = 'body'
            onPick(picked)
          }}
        />
      ) : (
        <div className="add-chip" role="group" aria-label="추가할 포켓몬" data-testid="add-chip">
          <b>{names.species.label(rosterId)}</b>
          {tag !== undefined && <span className="combo-tag">{tag}</span>}
          <button
            type="button"
            className="add-reset"
            data-testid="add-reset"
            onClick={() => {
              focusNext.current = 'search'
              onPick(null)
            }}
          >
            다시 검색
          </button>
        </div>
      )}
      {rosterId === null ? actions(false, () => undefined) : <div ref={bodyRef} className="add-body">{body}</div>}
    </div>
  )
}

type Actions = (submittable: boolean, onSubmit?: () => void, describedBy?: string) => ReactNode

/** 더할 배분이 없을 때: 빈 알림 영역을 먼저 그린 뒤 사유를 채워 스크린리더가 읽게 한다(사유가 바뀌면 다시 낸다) */
function UnavailableBody({ text, actions }: { text: string; actions: Actions }) {
  const msgId = useId()
  const [message, announce] = useAnnounce()
  useEffect(() => announce(text), [text, announce])
  return (
    <>
      <p id={msgId} className="add-msg" role="status" aria-live="polite" data-testid="add-msg">
        {message}
      </p>
      {actions(false, () => undefined, msgId)}
    </>
  )
}

/** 새 목록 밖 포켓몬: 기술 1~4개 → [추가]. 기술은 자동으로 채우지 않는다. */
function NewTargetBody({ game, rosterId, actions, onAdd }: { game: Snapshot; rosterId: string; actions: Actions; onAdd: (moves: readonly string[]) => void }) {
  const uid = useId()
  const names = namesOf(game)
  const [moves, setMoves] = useState<string[]>([])
  const [moveQuery, setMoveQuery] = useState('')
  const learnable = useMemo(() => learnableMoves(game, rosterId), [game, rosterId])
  const moveIndex = useMemo(() => searchIndexOf(game.data.moves, learnable), [game, learnable])
  const matched = searchNames(moveIndex, moveQuery, MOVE_CHIP_LIMIT)
  const shown = [...moves, ...matched.filter((m) => !moves.includes(m))]
  const full = moves.length >= MAX_CUSTOM_MOVES
  return (
    <>
      <div role="group" aria-labelledby={`${uid}-moves`} className="move-picker">
        <p id={`${uid}-moves`} className="group-title">
          기술 <span className="hint">({moves.length}/{MAX_CUSTOM_MOVES})</span>
        </p>
        <label className="move-search">
          기술 검색
          <input role="combobox" aria-expanded={shown.length > 0} aria-controls={`${uid}-chips`} autoComplete="off" value={moveQuery} onChange={(e) => setMoveQuery(e.target.value)} placeholder="이름 검색" />
        </label>
        <ul id={`${uid}-chips`} className="move-chips" data-popover-fit>
          {shown.map((m) => {
            const checked = moves.includes(m)
            return (
              <li key={m}>
                <label className={checked ? 'chip-check on' : 'chip-check'}>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={!checked && full}
                    onChange={(e) => setMoves((cur) => (e.target.checked ? [...cur, m] : cur.filter((x) => x !== m)))}
                  />
                  {names.moves.label(m)}
                </label>
              </li>
            )
          })}
        </ul>
        {shown.length === 0 && <p className="hint">일치하는 기술이 없습니다.</p>}
      </div>
      {actions(moves.length > 0, () => onAdd(moves))}
    </>
  )
}

interface BodyProps {
  target: AdditionTarget
  spMax: number
  dispatch: Dispatch<AppAction>
  onAdded: (reveal: RevealRequest) => void
  actions: Actions
}

/** 스피드 탭: 관측 S 묶음(점유율 기준 이상) 목록과 직접 입력(S SP·▲▼). 기본값은 질의의 대표 배분 */
function SpeedBody({ q, target, spMax, dispatch, onAdded, actions }: BodyProps & { q: Extract<SpeedAdditionQuery, { kind: 'ok' }> }) {
  const msgId = useId()
  const [sp, setSp] = useState(q.defaultValue.sp)
  const [nature, setNature] = useState<NatureSign>(q.defaultValue.nature)
  const [message, announce, clearMessage] = useAnnounce()
  const add = (bSp: number, bNature: NatureSign) => {
    const verdict = judgeSpeedAddition(q, bSp, bNature, spMax)
    if (verdict.kind !== 'ok') {
      announce(additionMessage(verdict, bundleLabel(bSp, bNature), spMax))
      return
    }
    clearMessage()
    dispatch({ type: 'add-speed-bundle', bundle: { source: target.source, opponentId: target.id, sp: bSp, nature: bNature }, spMax })
    onAdded({ tab: 'speed', source: target.source, opponentId: target.id, sp: bSp, nature: bNature })
  }
  return (
    <form
      className="add-form"
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        add(sp, nature)
      }}
    >
      {q.observed.length > 0 && (
        <ul className="add-observed" aria-label="관측 배분" data-popover-fit>
          {q.observed.map((o) => (
            <li key={JSON.stringify([o.sp, o.nature])}>
              <button type="button" className="add-observed-op speed" disabled={o.state === 'shown'} data-testid="add-observed-option" data-state={o.state} onClick={() => add(o.sp, o.nature)}>
                <b className="num">
                  <BundleText sp={o.sp} nature={o.nature} />
                </b>
                <span className="num bundle-share">{shareText(o.share)}</span>
                <span className="num">{o.speed}</span>
                <em>{o.state === 'shown' ? OBSERVED_STATE_TEXT.shown : '+ 추가'}</em>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="add-direct">
        <span className="group-title">직접 입력</span>
        <NumberField
          label="S SP"
          value={sp}
          min={0}
          max={spMax}
          step={1}
          describedBy={msgId}
          testId="add-sp-spe"
          className="sp-field"
          onValue={(v) => {
            setSp(v)
            clearMessage()
          }}
        />
        <NatureToggle
          value={nature}
          onChange={(v) => {
            setNature(v)
            clearMessage()
          }}
          testIdPrefix="add-nat"
        />
      </div>
      <p id={msgId} className="add-msg" role="status" aria-live="polite" data-testid="add-msg">
        {message}
      </p>
      {actions(true)}
    </form>
  )
}

/** values의 키 집합이 keyStats와 같은지 */
const sameKeys = (values: Readonly<Partial<Record<StatId, number>>>, keyStats: readonly StatId[]): boolean => {
  const given = Object.keys(values)
  return given.length === keyStats.length && keyStats.every((k) => given.includes(k))
}

/** 공·방 탭: 분류 선택(둘 이상일 때) → 관측 묶음 목록(보정 부호 그대로 추가) → 키 능력치 SP·▲▼ 직접 입력(H는 ▲▼ 없음). 기본값은 그 분류의 대표 배분 SP·무보정 */
function DamageBody({ tab, categories, target, spMax, dispatch, onAdded, actions }: BodyProps & { tab: DamageTab; categories: readonly DamageCategoryQuery[] }) {
  const uid = useId()
  const msgId = `${uid}-msg`
  const [selected, setSelected] = useState(categories[0].category)
  const [values, setValues] = useState<Partial<Record<StatId, number>>>(() => ({ ...categories[0].defaultSp }))
  const [signs, setSigns] = useState<KeySigns>({})
  const [message, announce, clearMessage] = useAnnounce()
  const found = categories.find((x) => x.category === selected)
  const c = found ?? categories[0]
  // 내 세트가 바뀌어 분류가 사라지거나 키 능력치가 달라지면 첫 분류와 그 대표 배분으로 되돌린다(빈 칸·엉뚱한 판정 방지)
  if (found === undefined || !sameKeys(values, c.keyStats)) {
    setSelected(c.category)
    setValues({ ...c.defaultSp })
    setSigns({})
    if (message !== '') clearMessage()
  }
  const statsOf = (sp: Readonly<Partial<Record<StatId, number>>>, nature: KeySigns) => c.keyStats.map((stat) => ({ stat, sp: sp[stat] ?? NaN, nature: signOf(nature, stat) }))
  const add = (sp: Readonly<Partial<Record<StatId, number>>>, nature: KeySigns) => {
    const stats = statsOf(sp, nature)
    const verdict = judgeDamageAddition(c, sp, spMax, nature)
    if (verdict.kind !== 'ok') {
      announce(additionMessage(verdict, bundleText(stats), spMax))
      return
    }
    clearMessage()
    const added = { tab, source: target.source, opponentId: target.id, category: c.category }
    dispatch({ type: 'add-bundle', bundle: { ...added, sp: { ...sp }, nature: { ...nature } }, keyStats: c.keyStats, spMax })
    onAdded({ tab, groupKey: groupKey({ source: target.source, id: target.id }), cardId: addedBundleCardId(added, stats) })
  }
  const pick = (x: DamageCategoryQuery) => {
    setSelected(x.category)
    setValues({ ...x.defaultSp })
    setSigns({})
    clearMessage()
  }
  return (
    <form
      className="add-form"
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        add(values, signs)
      }}
    >
      {categories.length > 1 && (
        <div className="add-categories" role="radiogroup" aria-label="분류">
          {categories.map((x) => (
            <label key={x.category} className={x === c ? 'chip-check on' : 'chip-check'}>
              <input type="radio" name={`${uid}-category`} value={x.category} checked={x === c} onChange={() => pick(x)} data-testid="add-category" />
              {MOVE_CATEGORY_LABEL[x.category]} {x.keyStats.map((s) => STAT_SHORT[s]).join('+')}
            </label>
          ))}
        </div>
      )}
      {c.observed.length > 0 && (
        <ul className="add-observed" aria-label="관측 배분" data-popover-fit>
          {c.observed.map((o) => (
            <li key={JSON.stringify(o.stats)}>
              <button
                type="button"
                className="add-observed-op"
                disabled={o.state !== 'addable'}
                data-testid="add-observed-option"
                data-state={o.state}
                onClick={() =>
                  add(
                    Object.fromEntries(o.stats.map((s) => [s.stat, s.sp])),
                    Object.fromEntries(o.stats.map((s) => [s.stat, s.nature])),
                  )
                }
              >
                <b className="num">{bundleText(o.stats)}</b>
                {o.share !== undefined && <span className="num bundle-share">{shareText(o.share)}</span>}
                <em>{o.state === 'addable' ? '+ 추가' : OBSERVED_STATE_TEXT[o.state]}</em>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="add-direct">
        <span className="group-title">직접 입력</span>
        {c.keyStats.map((stat) => (
          <span key={stat} className="add-stat">
            <NumberField
              label={STAT_SHORT[stat]}
              ariaLabel={`SP ${STAT_LABEL[stat]}`}
              value={values[stat] ?? NaN}
              min={0}
              max={spMax}
              step={1}
              describedBy={msgId}
              testId={`add-sp-${stat}`}
              className="sp-field"
              onValue={(v) => {
                setValues((cur) => ({ ...cur, [stat]: v }))
                clearMessage()
              }}
            />
            {stat !== 'hp' && (
              <NatureToggle
                value={signOf(signs, stat)}
                onChange={(v) => {
                  setSigns((cur) => setKeySign(cur, stat, v))
                  clearMessage()
                }}
                testIdPrefix={`add-nat-${stat}`}
                statLabel={STAT_LABEL[stat]}
              />
            )}
          </span>
        ))}
      </div>
      <p id={msgId} className="add-msg" role="status" aria-live="polite" data-testid="add-msg">
        {message}
      </p>
      {actions(true)}
    </form>
  )
}
