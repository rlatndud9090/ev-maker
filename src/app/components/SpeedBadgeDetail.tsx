import { useEffect, useMemo, useRef, useState, type Dispatch, type Ref } from 'react'
import {
  bundleLabel,
  checkSpeedAddition,
  presetAssumption,
  presetKey,
  type CustomTarget,
  type MinSp,
  type NatureSign,
  type PresetEdit,
  type PresetIndex,
  type SpeedBadge as Badge,
  type SpeedBaseline,
  type SpeedChartModel,
  type SpeedStatus,
} from '../../cards'
import type { Snapshot } from '../../data/schema'
import { shareText, STAT_SHORT } from '../../ui/format'
import { heldItemIds, namesOf } from '../../ui/names'
import { searchIndexOf } from '../../ui/search'
import type { AppAction } from '../state'
import { Combobox } from './Combobox'
import { BundleText } from './BundleText'
import { ItemMark } from './ItemMark'
import { PokemonIcon } from './PokemonIcon'
import { NumberField } from './NumberField'
import { STATUS_CLASS, STATUS_LABEL, conditionDetail, conditionTag, itemDetail, minSpText, rejectionText, shareDetail } from './speedText'

const NATURE_OPTIONS: readonly { sign: NatureSign; label: string }[] = [
  { sign: 'plus', label: '상승' },
  { sign: 'neutral', label: '무보정' },
  { sign: 'minus', label: '하락' },
]

interface Props {
  id: string
  game: Snapshot
  model: SpeedChartModel
  badge: Badge
  status: SpeedStatus | null
  baseline: SpeedBaseline
  minSp: { neutral: MinSp; plus: MinSp } | null
  myTailwind: boolean
  target: CustomTarget | undefined
  dispatch: Dispatch<AppAction>
  onClose(): void
  /** 추가 뒤 포커스할 배분 */
  onAdded(bundle: { opponentId: string; sp: number; nature: NatureSign }): void
  onRemove(badge: Badge): void
  closeRef?: Ref<HTMLButtonElement>
}

/** 배지 줄 바로 아래 인라인 상세. 열 때마다 "다른 배분 추가"는 접힌 채 시작한다(배지 id로 key) */
export function SpeedBadgeDetail({ id, game, model, badge: b, status, baseline, minSp, myTailwind, target, dispatch, onClose, onAdded, onRemove, closeRef }: Props) {
  const names = namesOf(game)
  const tag = conditionTag(b.condition)
  const condition = conditionDetail(game, b)
  const ladder = b.origin !== 'preset'
  const name = names.species.label(b.speciesId)
  return (
    <div id={id} className="speed-detail" role="region" aria-label={`${name} 상세`} data-testid="speed-detail" data-badge-id={b.id}>
      <div className="speed-detail-head">
        <PokemonIcon speciesId={b.speciesId} size={44} />
        <div className="speed-detail-title">
          <b data-testid="speed-detail-name">
            {name}
            {b.mega && ' (메가진화 폼)'}
          </b>
          <span className="speed-detail-bundle">
            <BundleText sp={b.bundle.sp} nature={b.bundle.nature} className="num" />
            {b.item !== null && <ItemMark item={{ id: b.item.id, name: names.items.label(b.item.id), role: 'held' }} game={game} className={b.item.negated ? 'item-negated' : undefined} />}
            {tag !== undefined && ` · ${tag}`} · 실수치 <b className="num">{b.speed}</b>
          </span>
          {status !== null && <span className={`speed-pill ${STATUS_CLASS[status]}`}>{STATUS_LABEL[status]}</span>}
        </div>
        <button type="button" ref={closeRef} className="speed-detail-close" aria-label="상세 닫기" onClick={onClose}>
          ×
        </button>
      </div>
      <dl className="speed-detail-kv">
        <dt>배분 점유율</dt>
        <dd data-testid="speed-detail-share">{shareDetail(b)}</dd>
        {condition !== undefined && (
          <>
            <dt>조건</dt>
            <dd data-testid="speed-detail-condition">{condition}</dd>
          </>
        )}
        <dt>도구</dt>
        <dd data-testid="speed-detail-item">{itemDetail(game, b)}</dd>
      </dl>
      <div className="speed-detail-goal" data-testid="speed-detail-min-sp">
        {baseline.kind === 'rejected' ? (
          (() => {
            const r = rejectionText(game, baseline.rejection, 'mine')
            return `${r.reason} · ${r.cause}`
          })()
        ) : minSp === null ? (
          '내 세트를 확인해 주세요'
        ) : (
          <>
            {minSpText(minSp)}
            <small>성격 무보정 / 상승 · 내 도구·특성{myTailwind ? '·순풍' : ''} 기준</small>
          </>
        )}
      </div>
      {b.origin === 'added' && (
        <button type="button" className="speed-detail-btn danger" onClick={() => onRemove(b)} data-testid="speed-remove">
          이 배지 지우기
        </button>
      )}
      {ladder && <AddBundle game={game} model={model} opponentId={b.opponentId} dispatch={dispatch} onAdded={onAdded} />}
      {b.origin === 'preset' && target !== undefined && b.presetIndex !== undefined && (
        <PresetEditor game={game} target={target} presetIndex={b.presetIndex} dispatch={dispatch} />
      )}
    </div>
  )
}

function AddBundle({ game, model, opponentId, dispatch, onAdded }: { game: Snapshot; model: SpeedChartModel; opponentId: string; dispatch: Dispatch<AppAction>; onAdded: Props['onAdded'] }) {
  const [expanded, setExpanded] = useState(false)
  const [sp, setSp] = useState(0)
  const [nature, setNature] = useState<NatureSign>('neutral')
  const [message, setMessage] = useState('')
  const spMax = game.manifest.rules.spMaxPerStat
  const options = model.options.get(opponentId) ?? []
  const add = (bundle: { sp: number; nature: NatureSign }) => {
    const check = checkSpeedAddition(model, opponentId, bundle.sp, bundle.nature, spMax)
    if (check.kind === 'duplicate') {
      setMessage(`이미 있음 — ${bundleLabel(bundle.sp, bundle.nature)} 배지가 차트에 있습니다.`)
      return
    }
    if (check.kind === 'invalid') {
      setMessage(`SP는 0~${spMax} 정수로 입력해 주세요.`)
      return
    }
    setMessage('')
    const b = { opponentId, sp: bundle.sp, nature: bundle.nature }
    dispatch({ type: 'add-speed-bundle', bundle: b, spMax })
    onAdded(b)
  }
  const listId = `${opponentId}-add-list`
  const body = useRef<HTMLDivElement>(null)
  // 펼친 목록이 프레임 끝에 붙은 기준선 띠 뒤로 숨지 않게 보이는 곳까지 스크롤(프레임 scroll-padding = 띠 높이)
  useEffect(() => {
    if (expanded) body.current?.scrollIntoView({ block: 'nearest' })
  }, [expanded])
  return (
    <div className="speed-add">
      <button type="button" className="speed-detail-btn" aria-expanded={expanded} aria-controls={listId} onClick={() => setExpanded((v) => !v)} data-testid="speed-add-toggle">
        다른 배분 추가 {expanded ? '▴' : '▾'}
      </button>
      <div id={listId} ref={body} className="speed-add-body" hidden={!expanded}>
        <ul className="speed-add-list" aria-label="S 배분 묶음">
          {options.map((o) => (
            <li key={JSON.stringify([o.sp, o.nature])}>
              <button type="button" className="speed-add-op" disabled={o.onChart} onClick={() => add(o)} data-testid="speed-add-option">
                <b className="num">
                  <BundleText sp={o.sp} nature={o.nature} />
                </b>
                <span className="num">{shareText(o.share)}</span>
                <span className="num">{o.speed}</span>
                <em>{o.onChart ? '차트에 있음' : '+ 추가'}</em>
              </button>
            </li>
          ))}
        </ul>
        <form
          className="speed-add-custom"
          onSubmit={(e) => {
            e.preventDefault()
            add({ sp, nature })
          }}
        >
          <span>직접 입력</span>
          <NumberField label="S SP" value={sp} min={0} max={spMax} step={1} onValue={setSp} />
          <label>
            성격
            <select value={nature} onChange={(e) => setNature(e.target.value as NatureSign)}>
              {NATURE_OPTIONS.map((o) => (
                <option key={o.sign} value={o.sign}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" data-testid="speed-add-custom">
            추가
          </button>
        </form>
        <p className="speed-add-msg" aria-live="polite" data-testid="speed-add-msg">
          {message}
        </p>
      </div>
    </div>
  )
}

const NO_EDIT: PresetEdit = {}

/** 목록 밖 타겟 프리셋의 스피드 탭 가정 편집·타겟 삭제 */
function PresetEditor({ game, target, presetIndex, dispatch }: { game: Snapshot; target: CustomTarget; presetIndex: PresetIndex; dispatch: Dispatch<AppAction> }) {
  const names = namesOf(game)
  const key = presetKey('speed', null, presetIndex)
  const edit = target.edits[key] ?? NO_EDIT
  const set = useMemo(() => presetAssumption(game, target.rosterId, target.moves, 'speed', null, presetIndex, edit).set, [game, target, presetIndex, edit])
  const species = Object.hasOwn(game.data.species, set.species) ? game.data.species[set.species] : undefined
  const abilities = species ? [...species.abilities] : []
  if (!abilities.includes(set.ability)) abilities.push(set.ability)
  const itemIndex = useMemo(() => searchIndexOf(game.data.items, heldItemIds(game)), [game])
  const put = (patch: PresetEdit) => dispatch({ type: 'edit-preset', rosterId: target.rosterId, key, edit: { ...edit, ...patch } })
  return (
    <fieldset className="speed-preset">
      <legend>프리셋 {presetIndex + 1} 가정 (사용자 지정)</legend>
      <NumberField label="프리셋 S SP" value={set.sp.spe} min={0} max={game.manifest.rules.spMaxPerStat} step={1} onValue={(v) => put({ sp: { ...edit.sp, spe: v } })} />
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
      {set.mega === true ? (
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
      <button type="button" className="danger" onClick={() => dispatch({ type: 'remove-custom-target', rosterId: target.rosterId })}>
        {names.species.label(target.rosterId)} 타겟 삭제
      </button>
    </fieldset>
  )
}
