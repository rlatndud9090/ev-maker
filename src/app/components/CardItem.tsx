import { memo, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type Dispatch, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { addedBundleCardId, defaultOption, isPinned, pinOf, type AddedBundle, type CardGroup, type CardView, type CustomTarget, type GroupItem, type RowView, type Tab } from '../../cards'
import type { Snapshot, StatId } from '../../data/schema'
import { namesOf } from '../../ui/names'
import { itemIconUrl } from '../../ui/images'
import { STAT_SHORT, bundleText, categoryBadge, fixedText, koBadge, orderBadge, shareText, type KoBadge } from '../../ui/format'
import { STAT_LABEL } from '../../ui/labels'
import { koReason } from '../../ui/koErrors'
import type { AppAction } from '../state'
import { CustomEditor } from './CustomEditor'
import { PairDetail, RowDetail } from './RowDetail'
import { PokemonIcon } from './PokemonIcon'
import { MoveLabel, VariableTag } from './MoveLabel'
import { MoveMenu, type MoveAdding } from './MoveMenu'
import { Caret } from './Caret'
import { itemKeyLabel, moveNoticeText, rowTitle } from './text'

interface Props {
  game: Snapshot
  tab: Tab
  /** 같은 포켓몬의 배분 선택지(사용률 순) */
  group: CardGroup
  /** 지금 보이는 배분의 카드 */
  card: CardView
  /** 그 탭 뷰를 계산한 판정 기준(배지 색 단계·상세 현재 판정) */
  rollSteps: number
  expanded: boolean
  onToggle: (groupKey: string) => void
  onSelect: (groupKey: string, cardId: string) => void
  /** 커스텀 카드면 그 타겟 */
  target?: CustomTarget
  dispatch: Dispatch<AppAction>
  /** 계산결과순일 때 이 행이 든 그룹 제목 id(행 토글 버튼 설명에 붙여 소속을 전한다) */
  groupLabelId?: string
  /** 포켓몬 한 줄의 기술 선택 항목(공격·방어 탭, groupItems). 스피드 탭은 빈 배열 */
  items: readonly GroupItem[]
  /** 항목을 직접 고름(다른 분류 항목이면 그 분류 기본 배분으로 전환까지) */
  onChooseItem: (group: CardGroup, card: CardView, item: GroupItem) => void
  /** 직접 고름 해제(기본 항목으로) */
  onResetItem: (group: CardGroup) => void
  /** 기술 선택 목록을 연 줄의 항목 카드 id(분류 기본 배분들), 닫으면 빈 목록 */
  onMenuCards: (cardIds: readonly string[]) => void
}

/** 카드 줄 배지의 기준 행: 대표 행. 대표로 세울 행이 없는 카드(no-change)는 범주가 있는 첫 행. */
function badgeRow(card: CardView): RowView | undefined {
  const h = card.headline
  if (h.kind === 'row') return card.rows.find((r) => r.id === h.rowId)
  if (h.kind !== 'no-change') return undefined
  return card.rows.find((r) => r.current.category !== undefined)
}

/**
 * 공격·방어는 1타 확률 결과 배지, 스피드는 행동 순서 배지. 기준 칸 = 그 행의 현재 칸(스윕 행), 내 SP 무관 판정 칸(고정 판정 행),
 * 칸이 없는 극단 필터 행은 범주만(확률 없음).
 */
function resultBadge(tab: Tab, card: CardView, rollSteps: number): { kind: 'ko' | 'order'; badge: KoBadge } | undefined {
  const row = badgeRow(card)
  if (row === undefined) return undefined
  const cell = row.cells.find((c) => c.sp === row.current.sp) ?? row.fixedCell
  const category = row.current.category
  const badge =
    tab === 'speed'
      ? orderBadge(cell ?? (category === undefined ? undefined : { category }))
      : cell !== undefined
        ? koBadge(tab, cell, rollSteps)
        : categoryBadge(category)
  return badge === undefined ? undefined : { kind: tab === 'speed' ? 'order' : 'ko', badge }
}

const isUser = (card: CardView): boolean => card.bundle.userAdded !== undefined
/** 고정 배분(직접 추가 포함)은 배지·메뉴 항목·상세 목록 모두 다른 면 색 */
const pinClass = (pinned: boolean): string => (pinned ? ' pinned-bundle' : '')

/** 화면 배분 카드 → 상태의 사용자 추가 배분 */
function addedOf(tab: Tab, card: CardView): AddedBundle {
  return { tab, opponentId: card.opponent.id, category: card.category, sp: Object.fromEntries(card.bundle.stats.map((s) => [s.stat, s.sp])) }
}

/** 배분 라벨 "A32↑ 56.3%": 묶음(본문색)과 비중(래더)·소수 배분·고정됨·프리셋(커스텀)은 작은 회색 글씨. 고정 배분은 비중 대신 "고정됨". */
function BundleLabel({ card, pinned }: { card: CardView; pinned: boolean }) {
  const { bundle } = card
  const ladder = card.opponent.source === 'ladder'
  return (
    <>
      <span className="bundle-stats">{bundle.stats.length > 0 ? bundleText(bundle.stats) : '관련 SP 없음'}</span>
      {ladder && pinned && <> <span className="bundle-share">고정됨</span></>}
      {ladder && !pinned && bundle.share !== undefined && !bundle.minority && <> <span className="bundle-share">{shareText(bundle.share)}</span></>}
      {ladder && !pinned && bundle.minority && <> <span className="bundle-share">소수 배분</span></>}
      {!ladder && bundle.presetIndex !== undefined && <> <span className="bundle-share">프리셋 {bundle.presetIndex + 1}</span></>}
    </>
  )
}

/**
 * 배분 선택지 한 항목의 내용: 배분·비중 라벨 + 결과 배지 + 변동 가능 표시(드롭다운·상세 왼쪽 목록 공용).
 * 같은 목록에 변동 가능 항목이 하나라도 있으면 변동 표시가 없는 항목에도 같은 폭 빈 칸을 둬 결과 배지 오른쪽 끝이 세로로 맞는다.
 */
function BundleOptionContent({ tab, option, rollSteps, pinned, reserveVariable }: { tab: Tab; option: CardView; rollSteps: number; pinned: boolean; reserveVariable: boolean }) {
  const r = resultBadge(tab, option, rollSteps)
  return (
    <>
      <span className="bundle-opt-label num">
        <BundleLabel card={option} pinned={pinned} />
      </span>
      <span className="bundle-opt-result">
        {option.state === 'error' && <span className="badge-error">계산 불가</span>}
        {r !== undefined && <span className={`ko-badge ko-${r.badge.tone} ko-small`}>{r.badge.label}</span>}
        {option.variable ? (
          <VariableTag compact testId="variable-mark" />
        ) : (
          reserveVariable && (
            <span className="variable-tag compact variable-slot" aria-hidden="true">
              변동
            </span>
          )
        )}
      </span>
    </>
  )
}

/** 핀 아이콘(고정이면 채움, 아니면 윤곽선) */
function PinIcon({ filled }: { filled: boolean }) {
  return (
    <svg className="pin-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
      <path
        d="M10.2 1.6 14.4 5.8 13.1 6.4 10.9 8.6 11.3 11.6 10.2 12.7 7.4 9.9 3 14.3 1.7 14.3 1.7 13 6.1 8.6 3.3 5.8 4.4 4.7 7.4 5.1 9.6 2.9Z"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** 핀 버튼 이름은 늘 "배분 고정"(상태는 눌림/체크로), 마우스 툴팁만 동작을 말한다 */
const PIN_LABEL = '배분 고정'
const pinTitle = (pinned: boolean, user: boolean) => (pinned ? (user ? '고정 해제(직접 추가 배분 삭제)' : '고정 해제') : '배분 고정')

/** 핀이 없는 항목(목록 밖 타겟 프리셋)의 같은 폭 빈 칸: 결과 배지 정렬을 지킨다 */
const PinSlot = () => <span className="bundle-pin pin-slot" aria-hidden="true" />

/** 배분 선택지 항목의 공용 data 속성(e2e 계약) */
const optionData = (group: CardGroup, o: CardView) => ({
  'data-card-id': o.id,
  'data-category': o.category ?? 'none',
  'data-user-added': isUser(o) ? 'true' : undefined,
  'data-pinned': group.pinned.includes(o.id) ? 'true' : undefined,
  'data-headline': o.headline.kind,
  'data-variable': o.variable ? 'true' : 'false',
})

function Headline({ game, tab, card, badge }: { game: Snapshot; tab: Tab; card: CardView; badge: boolean }) {
  const h = card.headline
  if (h.kind === 'updating') return <span className="headline updating">갱신 중</span>
  if (h.kind === 'error') return <span className="headline error">계산 불가: {koReason(game, h.reason)}</span>
  if (h.kind === 'no-change') {
    // 배지가 고정 판정을 대신한다. 배지가 없는 고정 판정만 문구로 보인다.
    if (badge || h.fixed.length === 0) return null
    return <span className="headline fixed">{h.fixed.map(fixedText).join(', ')}</span>
  }
  const row = card.rows.find((r) => r.id === h.rowId)
  if (row === undefined) return null
  // 판정은 결과 배지가 보이고 여기는 기술 라벨만(변화 없음 행도 라벨은 보인다). 목표 문구("최소 … 필요")는 상세 행에만 있다.
  return (
    <span className="headline row-headline">
      <span className="hl-move">
        {row.basis !== undefined && row.basis.kind !== 'rank' && (
          <>
            <span className="basis-tag" data-testid="headline-basis" data-row-kind={row.kind}>
              {itemKeyLabel(game, row.basis.item)}
            </span>{' '}
          </>
        )}
        <MoveLabel game={game} tab={tab} row={row} />
      </span>
    </span>
  )
}

/** "나인테일(알로라의 모습)" → 이름 + 작은 폼 꼬리(서식만, 이름 문자열은 그대로) */
function SpeciesName({ label }: { label: string }) {
  const m = /^(.+?)(\(.+\))$/.exec(label)
  if (m === null) return <>{label}</>
  return (
    <>
      {m[1]}
      <span className="form-suffix">{m[2]}</span>
    </>
  )
}

const stop = (e: MouseEvent) => e.stopPropagation()

/** 도구 한국어 이름(스냅샷에 없으면 id) */
const itemName = (game: Snapshot, item: string): string => game.data.items[item]?.name.ko ?? item

/**
 * 도구 변형 행 이름 옆 배지: 도구 이미지(Champions 가방 스프라이트, 툴팁 = 도구 이름). 이미지가 없으면 열매 이름에서 "열매"를 뗀 "(마코)".
 * 보이는 그림·글자는 스크린 리더에서 숨기고 "마코열매 지닌 경우"로 읽힌다(점유율은 적지 않는다, 사용자 결정 2026-11-14). data-item-id는 도구 id.
 */
function ItemVariantBadge({ game, item }: { game: Snapshot; item: string }) {
  const name = itemName(game, item)
  const url = itemIconUrl(item)
  return (
    <span className={`berry-badge${url === undefined ? '' : ' berry-badge-img'}`} data-testid="berry-badge" data-item-id={item} title={url === undefined ? `${name} 지닌 경우` : name}>
      {url === undefined ? (
        <span aria-hidden="true">({name.replace(/열매$/, '')})</span>
      ) : (
        <img className="item-icon" src={url} alt="" width={22} height={22} loading="lazy" decoding="async" draggable={false} data-item-icon={item} />
      )}
      <span className="sr-only">{name} 지닌 경우</span>
    </span>
  )
}

const SP_TEXT = /^\d+$/

/**
 * 직접 추가 폼 "H [ ] B [ ] [추가]"(한 줄): 현재 배분의 키 능력치 순, 기본값은 현재 SP.
 * 0~spMax 정수가 아니거나 빈칸이면 [추가]를 막고 안내한다. Enter로 추가. 키 입력은 바깥 키보드 처리(메뉴·목록)로 올리지 않는다.
 */
function BundleAddForm({ card, spMax, onAdd }: { card: CardView; spMax: number; onAdd: (sp: Record<StatId, number>) => void }) {
  const stats = card.bundle.stats
  const [values, setValues] = useState<readonly string[]>(() => stats.map((s) => String(s.sp)))
  const uid = useId()
  const valid = values.map((v) => SP_TEXT.test(v.trim()) && Number(v) <= spMax)
  const ok = valid.every(Boolean)
  const hintId = `${uid}-hint`
  return (
    <form
      className="bundle-add"
      data-testid="bundle-add"
      aria-label="배분 직접 추가"
      noValidate
      onKeyDown={(e) => {
        if (e.key !== 'Escape') e.stopPropagation()
      }}
      onSubmit={(e) => {
        e.preventDefault()
        if (!ok) return
        onAdd(Object.fromEntries(stats.map((s, i) => [s.stat, Number(values[i])])) as Record<StatId, number>)
      }}
    >
      <span className="bundle-add-fields">
        {stats.map((s, i) => (
          <label key={s.stat} title={`SP ${STAT_LABEL[s.stat]}`}>
            {STAT_SHORT[s.stat]}
            <input
              type="number"
              inputMode="numeric"
              className="num"
              min={0}
              max={spMax}
              step={1}
              aria-label={`직접 추가 SP ${STAT_LABEL[s.stat]}`}
              aria-invalid={!valid[i]}
              aria-describedby={ok ? undefined : hintId}
              value={values[i]}
              onChange={(e) => {
                const next = [...values]
                next[i] = e.target.value
                setValues(next)
              }}
            />
          </label>
        ))}
        <button type="submit" disabled={!ok}>
          추가
        </button>
      </span>
      {!ok && (
        <span className="bundle-add-hint" id={hintId} role="status">
          SP는 0~{spMax} 정수만 넣을 수 있습니다
        </span>
      )}
    </form>
  )
}

/**
 * 배분 추가·삭제로 재계산되는 동안 그 행이 잠깐 목록에서 빠졌다 다시 붙으면(새 요소) 포커스가 body로 떨어진다.
 * 그때 다시 붙은 행의 배분 버튼으로 포커스를 돌려주려고 (탭, 그룹 키)를 기억한다. 다른 곳에 포커스·클릭이 가면 잊는다.
 */
let focusReturn: string | null = null
function rememberFocusReturn(key: string) {
  focusReturn = key
  const forget = () => {
    if (focusReturn === key) focusReturn = null
    document.removeEventListener('focusin', forget, true)
    document.removeEventListener('pointerdown', forget, true)
  }
  document.addEventListener('focusin', forget, true)
  document.addEventListener('pointerdown', forget, true)
}

type ActionProps = Pick<Props, 'tab' | 'group' | 'card' | 'onSelect' | 'dispatch'>

/**
 * 배분 직접 추가·고정 토글(드롭다운·스피드 탭 상세 목록 공용). 추가: 같은 키 배분이 이미 선택지면 그걸 고르고(관측 배분이면 고정한다), 아니면 상태에
 * 추가(추가와 함께 고정)하고 그 카드를 미리 고른다(계산이 끝나면 맨 위에 보인다). 고정 토글: 관측 배분은 고정만 바꾸고(재계산 없음),
 * 직접 추가 배분의 고정 해제는 삭제다. 추가·삭제 뒤 재계산 중 포커스를 잃으면 그 행의 배분 버튼으로 돌려준다.
 */
function bundleActions({ tab, group, card, onSelect, dispatch }: ActionProps, spMax: number | undefined) {
  const returnKey = JSON.stringify([tab, group.key])
  /** done: 선택을 반영한 뒤(포커스 복귀 기억 전) 부를 마무리(메뉴 닫기 등) */
  const add = (sp: Record<StatId, number>, done?: () => void) => {
    const stats = card.bundle.stats.map((s) => ({ stat: s.stat, sp: sp[s.stat] }))
    const same = (o: CardView) =>
      o.bundle.stats.length === stats.length && o.bundle.stats.every((s, i) => s.stat === stats[i].stat && s.sp === stats[i].sp && s.nature === 'neutral')
    const existing = group.options.find((o) => !isUser(o) && same(o)) ?? group.options.find((o) => isUser(o) && same(o))
    if (existing !== undefined) {
      if (!isPinned(group, existing)) dispatch({ type: 'pin-bundle', pin: pinOf(tab, existing) })
      onSelect(group.key, existing.id)
    } else if (spMax !== undefined) {
      const added: AddedBundle = { tab, opponentId: card.opponent.id, category: card.category, sp }
      dispatch({ type: 'add-bundle', bundle: added, keyStats: stats.map((s) => s.stat), spMax })
      onSelect(group.key, addedBundleCardId(added, stats, card.berry?.item))
    }
    done?.()
    if (existing === undefined) rememberFocusReturn(returnKey)
  }
  /** 고정 토글. 직접 추가 배분의 해제(삭제)면 true, removed 뒤 done을 부른다 */
  const togglePin = (o: CardView, done?: () => void): boolean => {
    if (!isPinned(group, o)) {
      dispatch({ type: 'pin-bundle', pin: pinOf(tab, o) })
      return false
    }
    if (!isUser(o)) {
      dispatch({ type: 'unpin-bundle', pin: pinOf(tab, o) })
      return false
    }
    dispatch({ type: 'remove-bundle', bundle: addedOf(tab, o) })
    if (o.id === card.id) onSelect(group.key, defaultOption({ ...group, options: group.options.filter((x) => x.id !== o.id) }).id)
    done?.()
    rememberFocusReturn(returnKey)
    return true
  }
  return { add, togglePin, returnKey }
}

interface PickerProps extends Pick<Props, 'tab' | 'group' | 'card' | 'rollSteps' | 'onSelect' | 'dispatch'> {
  /** 래더 행: 직접 추가 폼 */
  spMax?: number
}

/** 고정 토글 뒤 그 항목의 핀으로 포커스를 돌린다(항목이 맨 위·원래 자리로 옮겨지며 포커스를 잃을 수 있다). */
function refocusPin(root: HTMLElement | null, cardId: string) {
  requestAnimationFrame(() => root?.querySelector<HTMLElement>(`[data-pin-for="${CSS.escape(cardId)}"]`)?.focus())
}

/** 행의 배분 배지: 아래로 여는 배분 선택 메뉴(래더 행은 직접 추가 폼 + 항목마다 오른쪽 끝 핀). */
function BundlePicker({ tab, group, card, rollSteps, onSelect, dispatch, spMax }: PickerProps) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLSpanElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const close = () => {
    setOpen(false)
    btnRef.current?.focus()
  }
  const { add, togglePin, returnKey } = bundleActions({ tab, group, card, onSelect, dispatch }, spMax)
  const ladder = card.opponent.source === 'ladder'
  const reserveVariable = group.options.some((o) => o.variable)

  // 추가·삭제 뒤 재계산 중 이 행이 다시 붙었고 포커스가 갈 곳을 잃었으면 배분 버튼으로 돌려준다.
  useEffect(() => {
    const active = document.activeElement
    if (focusReturn === returnKey && (active === null || active === document.body)) btnRef.current?.focus()
  }, [returnKey])

  // 아래 공간(목록 스크롤 박스·화면 중 좁은 쪽)이 모자라고 위가 더 넓으면 위로 연다(그리기 전에 클래스만 붙인다).
  useLayoutEffect(() => {
    if (!open) return
    const btn = btnRef.current
    const menu = menuRef.current
    if (!btn || !menu) return
    const b = btn.getBoundingClientRect()
    const box = btn.closest('.result-scroll')?.getBoundingClientRect()
    const bottom = Math.min(window.innerHeight, box?.bottom ?? Infinity)
    const top = Math.max(0, box?.top ?? 0)
    const below = bottom - b.bottom
    const above = b.top - top
    menu.classList.toggle('up', below < menu.offsetHeight + 6 && above > below)
  }, [open])

  useEffect(() => {
    if (!open) return
    const menu = menuRef.current
    menu?.querySelector<HTMLButtonElement>('[aria-checked="true"][role="menuitemradio"]')?.focus()
    menu?.scrollIntoView({ block: 'nearest' })
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])

  const onMenuKey = (e: KeyboardEvent) => {
    // 직접 추가 폼의 키 입력(숫자 칸 ↑↓ 등)은 폼이 여기까지 올리지 않는다(Escape만 올린다).
    // ↑↓·Home/End는 배분 항목만 오간다(핀에 포커스가 있으면 그 항목 기준). → 항목에서 그 핀으로, ← 핀에서 그 항목으로.
    const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [])]
    const active = document.activeElement as HTMLElement | null
    const rowItem = active?.closest('.bundle-opt-row')?.querySelector<HTMLButtonElement>('[role="menuitemradio"]') ?? null
    const at = rowItem === null ? -1 : items.indexOf(rowItem)
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const step = e.key === 'ArrowDown' ? 1 : -1
      const from = at < 0 && step < 0 ? 0 : at
      items[(from + step + items.length) % items.length]?.focus()
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault()
      items[e.key === 'Home' ? 0 : items.length - 1]?.focus()
    } else if (e.key === 'ArrowRight' && active?.getAttribute('role') === 'menuitemradio') {
      const pin = active.closest('.bundle-opt-row')?.querySelector<HTMLElement>('[data-pin-for]')
      if (pin) {
        e.preventDefault()
        pin.focus()
      }
    } else if (e.key === 'ArrowLeft' && active?.hasAttribute('data-pin-for') && rowItem !== null) {
      e.preventDefault()
      rowItem.focus()
    }
  }

  return (
    <span className="bundle-cell bundle-pick" ref={wrapRef} onClick={stop}>
      <button
        type="button"
        ref={btnRef}
        className={`bundle-btn${pinClass(isPinned(group, card))}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`노력치 배분 ${bundleAria(card, isPinned(group, card))} (${group.options.length}개 중 선택)`}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="card-bundle num" data-testid="card-bundle">
          <BundleLabel card={card} pinned={isPinned(group, card)} />
        </span>
        <Caret />
      </button>
      {open && (
        <div
          className="bundle-menu"
          role="menu"
          aria-label="노력치 배분"
          ref={menuRef}
          // 메뉴 안 빈 곳을 눌러도 포커스가 바깥(탭 패널)으로 가지 않게 메뉴 자체가 포커스를 받는다.
          tabIndex={-1}
          onKeyDown={onMenuKey}
          onBlur={(e) => {
            // 키보드(Tab)로 메뉴 밖에 포커스가 가면 닫는다. 바깥 클릭은 pointerdown이 닫는다.
            if (e.relatedTarget !== null && !wrapRef.current?.contains(e.relatedTarget as Node)) setOpen(false)
          }}
          data-testid="bundle-menu"
        >
          {spMax !== undefined && card.bundle.stats.length > 0 && <BundleAddForm key={card.id} card={card} spMax={spMax} onAdd={(sp) => add(sp, close)} />}
          {group.options.map((o) => {
            const pinned = isPinned(group, o)
            return (
              <div key={o.id} className="bundle-opt-row" role="none">
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={o.id === card.id}
                  className={`bundle-opt${pinClass(pinned)}`}
                  {...optionData(group, o)}
                  onClick={() => {
                    onSelect(group.key, o.id)
                    close()
                  }}
                >
                  <BundleOptionContent tab={tab} option={o} rollSteps={rollSteps} pinned={pinned} reserveVariable={reserveVariable} />
                </button>
                {ladder ? (
                  <button
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={pinned}
                    aria-label={PIN_LABEL}
                    title={pinTitle(pinned, isUser(o))}
                    className="bundle-pin"
                    data-pin-for={o.id}
                    data-testid="bundle-pin"
                    onClick={(e) => {
                      e.stopPropagation()
                      // 직접 추가 배분의 해제는 삭제라 재계산이 돌아 메뉴를 닫고 배분 버튼으로 돌아간다. 관측 배분은 메뉴를 연 채 그 핀에 머문다.
                      if (!togglePin(o, close)) refocusPin(menuRef.current, o.id)
                    }}
                  >
                    <PinIcon filled={pinned} />
                  </button>
                ) : (
                  <PinSlot />
                )}
              </div>
            )
          })}
        </div>
      )}
    </span>
  )
}

/** 스크린 리더용 배분 문구(비중 포함, 고정이면 "고정됨") */
function bundleAria(card: CardView, pinned: boolean): string {
  const { bundle } = card
  const stats = bundle.stats.length > 0 ? bundleText(bundle.stats) : '관련 SP 없음'
  if (card.opponent.source === 'custom') return bundle.presetIndex !== undefined ? `${stats} 프리셋 ${bundle.presetIndex + 1}` : stats
  if (pinned) return `${stats} 고정됨`
  if (bundle.minority) return `${stats} 소수 배분`
  return bundle.share !== undefined ? `${stats} ${shareText(bundle.share)}` : stats
}

interface ListProps extends PickerProps {
  /** 항목 id(오른쪽 판정 영역이 선택 항목을 이름으로 가리킨다) */
  optionId: (i: number) => string
}

/**
 * 스피드 탭 상세 왼쪽 열: 드롭다운과 같은 배분 목록을 세로로 고정(래더는 맨 위 직접 추가 폼, 항목마다 오른쪽 끝 핀).
 * 선택은 radiogroup(↑↓·←→ 이동 즉시 선택, Home/End). 핀은 선택 항목 것만 Tab 순서(radio 다음)에 들어오고, 고정 항목 radio에서
 * Delete·Backspace 키도 고정 해제다(직접 추가 배분은 삭제). 고정 항목은 다른 면 색.
 */
function BundleList({ tab, group, card, rollSteps, onSelect, dispatch, spMax, optionId, unpinHintId }: ListProps & { unpinHintId: string }) {
  const listRef = useRef<HTMLDivElement>(null)
  const { add, togglePin } = bundleActions({ tab, group, card, onSelect, dispatch }, spMax)
  const anySelected = group.options.some((o) => o.id === card.id)
  const ladder = card.opponent.source === 'ladder'
  const reserveVariable = group.options.some((o) => o.variable)

  useEffect(() => {
    // 선택 항목이 목록 스크롤 밖이면 보이게 옮긴다(목록 박스 안에서만, 페이지는 건드리지 않는다).
    const list = listRef.current
    const item = list?.querySelector<HTMLElement>('[aria-checked="true"]')
    if (!list || !item) return
    const top = item.offsetTop - list.offsetTop
    if (top < list.scrollTop) list.scrollTop = top
    else if (top + item.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = top + item.offsetHeight - list.clientHeight
  }, [card.id])

  const focusOption = (id: string) =>
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`[role="radio"][data-card-id="${CSS.escape(id)}"]`)?.focus())

  const onKey = (e: KeyboardEvent) => {
    const focused = e.target as HTMLElement
    if (focused.getAttribute('role') !== 'radio') return
    const n = group.options.length
    const at = group.options.findIndex((o) => o.id === focused.dataset.cardId)
    if (e.key === 'Delete' || e.key === 'Backspace') {
      const o = group.options[at]
      if (o === undefined || !isPinned(group, o)) return
      e.preventDefault()
      if (!togglePin(o)) focusOption(o.id)
      return
    }
    let to: number
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') to = (at + 1) % n
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') to = (at - 1 + n) % n
    else if (e.key === 'Home') to = 0
    else if (e.key === 'End') to = n - 1
    else return
    e.preventDefault()
    const next = group.options[to]
    onSelect(group.key, next.id)
    focusOption(next.id)
  }

  return (
    <div className="bundle-side" data-testid="bundle-list" ref={listRef}>
      {spMax !== undefined && card.bundle.stats.length > 0 && <BundleAddForm key={card.id} card={card} spMax={spMax} onAdd={(sp) => add(sp)} />}
      {/* 선택(radiogroup)과 핀(group)을 형제 열로 둔다 — radiogroup 안에는 radio만(스크린 리더가 radio 수·위치를 바르게 읽는다).
          두 열은 같은 줄(subgrid)을 공유해 항목과 그 핀이 같은 높이로 맞는다. */}
      <div className="bundle-rows" style={{ '--bundle-rows': group.options.length } as CSSProperties}>
        <div className="bundle-radios" role="radiogroup" aria-label="노력치 배분" onKeyDown={onKey}>
          {group.options.map((o, i) => {
            const selected = o.id === card.id
            const pinned = isPinned(group, o)
            // 선택 항목(없으면 첫 항목)만 Tab으로 들어온다(roving tabindex). 그 항목의 핀이 다음 Tab.
            const tabbable = selected || (!anySelected && i === 0)
            return (
              <button
                key={o.id}
                type="button"
                role="radio"
                id={optionId(i)}
                aria-checked={selected}
                tabIndex={tabbable ? 0 : -1}
                aria-keyshortcuts={pinned ? 'Delete' : undefined}
                aria-describedby={pinned ? unpinHintId : undefined}
                className={`bundle-opt${pinClass(pinned)}`}
                {...optionData(group, o)}
                onClick={() => onSelect(group.key, o.id)}
              >
                <BundleOptionContent tab={tab} option={o} rollSteps={rollSteps} pinned={pinned} reserveVariable={reserveVariable} />
              </button>
            )
          })}
        </div>
        <div className="bundle-pins" role={ladder ? 'group' : undefined} aria-label={ladder ? PIN_LABEL : undefined} aria-hidden={ladder ? undefined : true}>
          {group.options.map((o, i) => {
            if (!ladder) return <PinSlot key={o.id} />
            const pinned = isPinned(group, o)
            const tabbable = o.id === card.id || (!anySelected && i === 0)
            return (
              <button
                key={o.id}
                type="button"
                className="bundle-pin"
                aria-label={PIN_LABEL}
                aria-pressed={pinned}
                title={pinTitle(pinned, isUser(o))}
                tabIndex={tabbable ? 0 : -1}
                data-pin-for={o.id}
                data-testid="bundle-pin"
                onClick={(e) => {
                  e.stopPropagation()
                  if (!togglePin(o)) refocusPin(listRef.current, o.id)
                }}
              >
                <PinIcon filled={pinned} />
              </button>
            )
          })}
        </div>
      </div>
      {group.pinned.length > 0 && (
        <span id={unpinHintId} className="sr-only">
          Delete 키로 고정 해제(직접 추가 배분은 삭제)
        </span>
      )}
    </div>
  )
}

/** 간단행의 보이는 항목 기술 선택 버튼. 보이는 항목이 목록에 없으면 null */
function ShownMove({
  game,
  tab,
  group,
  card,
  rollSteps,
  items,
  onChooseItem,
  onResetItem,
  onMenuCards,
  dispatch,
  testId,
}: Pick<Props, 'game' | 'tab' | 'group' | 'card' | 'rollSteps' | 'items' | 'onChooseItem' | 'onResetItem' | 'onMenuCards' | 'dispatch'> & { testId: string }) {
  const menuSig = JSON.stringify([...new Set(items.map((g) => g.card.id))])
  const onOpenChange = useCallback((open: boolean) => onMenuCards(open ? (JSON.parse(menuSig) as string[]) : []), [menuSig, onMenuCards])
  const shown = items.find((g) => g.item.key === card.shownItem)
  if (shown === undefined) return null
  const row = { moveId: shown.item.moveId, moveType: shown.item.moveType, power: shown.item.power, basis: shown.item.basis, ...(card.rows[0]?.refs === undefined ? {} : { refs: card.rows[0].refs }) }
  const opponentId = card.opponent.id
  const adding: MoveAdding | undefined =
    tab === 'defense' && card.opponent.source === 'ladder'
      ? {
          opponentId,
          onAdd: (moveId) => dispatch({ type: 'add-move', opponentId, moveId }),
          onRemove: (moveId) => dispatch({ type: 'remove-move', opponentId, moveId }),
        }
      : undefined
  return (
    <MoveMenu
      game={game}
      tab={tab}
      rollSteps={rollSteps}
      items={items}
      shown={card.shownItem}
      selected={card.selected}
      onChoose={(item) => onChooseItem(group, card, item)}
      onReset={() => onResetItem(group)}
      label={`${rowTitle(game, { moveId: shown.item.moveId, power: shown.item.power }, false)} 기술 선택${card.selected ? ' (직접 고름)' : ''}`}
      testId={testId}
      adding={adding}
      focusKey={JSON.stringify([tab, group.key, testId])}
      onOpenChange={onOpenChange}
    >
      <MoveLabel game={game} tab={tab} row={row} trailing={<Caret />} />
    </MoveMenu>
  )
}

export const CardItem = memo(function CardItem({ game, tab, group, card, rollSteps, expanded, onToggle, onSelect, target, dispatch, groupLabelId, items, onChooseItem, onResetItem, onMenuCards }: Props) {
  const names = namesOf(game)
  const ladder = card.opponent.source === 'ladder'
  const speed = tab === 'speed'
  const detailId = `card-detail-${encodeURIComponent(group.key)}`
  const multi = group.options.length > 1
  // 래더 행은 직접 추가 폼 때문에 배분이 하나여도 늘 고를 수 있는 배지다(관련 SP가 없으면 추가할 것이 없다).
  const addable = ladder && card.bundle.stats.length > 0
  const spMax = addable ? game.manifest.rules.spMaxPerStat : undefined
  const result = resultBadge(tab, card, rollSteps)
  // 토글 버튼 이름은 포켓몬, 설명은 줄의 기술·결과·변동 가능(스크린 리더가 접힌 줄 판정을 함께 읽는다)
  const uid = useId()
  const headlineId = `${uid}-headline`
  const resultId = `${uid}-result`
  const variableId = `${uid}-variable`
  const optionId = (i: number) => `${uid}-option-${i}`
  const selectedIndex = group.options.findIndex((o) => o.id === card.id)
  const describedBy = [headlineId, ...(result === undefined ? [] : [resultId]), ...(card.variable ? [variableId] : []), ...(groupLabelId === undefined ? [] : [groupLabelId])].join(' ')
  let resultBody: ReactNode = null
  if (result !== undefined) {
    resultBody = (
      <span className={`ko-badge ko-${result.badge.tone}`} data-testid={result.kind === 'ko' ? 'ko-badge' : 'order-badge'} data-tone={result.badge.tone} id={resultId}>
        {result.badge.label}
        {result.badge.chance !== undefined && <small className="ko-chance num"> {result.badge.chance}</small>}
      </span>
    )
  }
  return (
    <li
      className={`card card-${card.state}${expanded ? ' open' : ''}`}
      data-testid="card"
      data-card-id={card.id}
      data-group-key={group.key}
      data-opponent={card.opponent.id}
      data-berry={group.berry?.item}
      data-power-item={tab === 'defense' ? group.berry?.item : undefined}
      data-category={card.category ?? 'none'}
      data-origin={ladder ? 'ladder' : 'custom'}
      data-rank={ladder ? card.opponent.rank : undefined}
      data-state={card.state}
      data-headline={card.headline.kind}
      data-variable={card.variable ? 'true' : 'false'}
      data-items={items.length}
      data-user-added={isUser(card) ? 'true' : undefined}
      data-pinned={isPinned(group, card) ? 'true' : undefined}
    >
      {/* 행 어디를 눌러도 펼친다. 키보드·스크린 리더는 이름 칸 버튼(클릭이 이 줄로 버블돼 한 번만 토글). */}
      <div className="card-line" onClick={() => onToggle(group.key)}>
        <button type="button" className="card-toggle card-who" aria-expanded={expanded} aria-controls={detailId} aria-describedby={describedBy}>
          <PokemonIcon speciesId={card.opponent.id} size={32} lazy />
          <span className="card-name">
            <SpeciesName label={names.species.label(card.opponent.id)} />
            {group.berry !== undefined && (
              <>
                {' '}
                <ItemVariantBadge game={game} item={group.berry.item} />
              </>
            )}
          </span>
          {!ladder && (
            <span className="card-meta">
              <span className="custom-tag">출처: 사용자 지정</span>
            </span>
          )}
        </button>
        {multi || addable ? (
          <BundlePicker tab={tab} group={group} card={card} rollSteps={rollSteps} onSelect={onSelect} dispatch={dispatch} spMax={spMax} />
        ) : (
          <span className="bundle-cell">
            <span className="card-bundle num" data-testid="card-bundle">
              <BundleLabel card={card} pinned={isPinned(group, card)} />
            </span>
          </span>
        )}
        <span className="card-headline" data-testid="card-headline" id={headlineId}>
          {card.shownItem !== undefined && items.some((g) => g.item.key === card.shownItem) ? (
            <ShownMove game={game} tab={tab} group={group} card={card} rollSteps={rollSteps} items={items} onChooseItem={onChooseItem} onResetItem={onResetItem} onMenuCards={onMenuCards} dispatch={dispatch} testId="move-pick" />
          ) : (
            <Headline game={game} tab={tab} card={card} badge={result !== undefined} />
          )}
        </span>
        {/* 왼쪽부터 포켓몬 → SP 배분 → 기술 → 결과(+변동 가능) */}
        {(card.state === 'error' || resultBody !== null || card.variable) && (
          <span className="card-result">
            {card.state === 'error' && <span className="badge-error">계산 불가</span>}
            {resultBody}
            {card.variable && <VariableTag id={variableId} />}
          </span>
        )}
        <span className="card-chev" data-testid="card-chev" data-open={expanded ? 'true' : 'false'} aria-hidden="true">
          <Caret />
        </span>
      </div>
      {card.notices.map((n) => (
        <p key={JSON.stringify([n.kind, n.owner, n.moveId])} className="card-notice" data-testid="card-notice">
          {moveNoticeText(game, n)}
        </p>
      ))}
      <div id={detailId} className="card-detail" hidden={!expanded}>
        {expanded && (
          // 공격·방어 탭 상세는 판정만(배분·기술 선택은 간단행 배지에서, R9). 스피드 탭은 왼쪽 배분 목록을 그대로 둔다.
          <div className={`detail-grid${speed ? '' : ' single'}`}>
            {speed && (
              <BundleList
                tab={tab}
                group={group}
                card={card}
                rollSteps={rollSteps}
                onSelect={onSelect}
                dispatch={dispatch}
                spMax={spMax}
                optionId={optionId}
                unpinHintId={`${uid}-unpin-hint`}
              />
            )}
            {/* 판정 영역 이름 = 선택 배분 항목(스피드 탭 목록), 그 밖은 배분 문구 */}
            <div
              role="region"
              className="bundle-panel"
              aria-labelledby={speed && selectedIndex >= 0 ? optionId(selectedIndex) : undefined}
              aria-label={speed && selectedIndex >= 0 ? undefined : `${bundleAria(card, isPinned(group, card))} 판정`}
              data-testid="bundle-panel"
            >
              {card.state === 'error' && card.error && <p className="row-error">계산 불가: {koReason(game, card.error)}</p>}
              {card.rows.length > 0 && (
                <ol className="rows">
                  {card.pair !== undefined ? <PairDetail game={game} card={card} /> : card.rows.map((r) => <RowDetail key={r.id} game={game} tab={tab} row={r} />)}
                </ol>
              )}
              {target !== undefined && <CustomEditor key={card.id} game={game} tab={tab} card={card} target={target} dispatch={dispatch} />}
            </div>
          </div>
        )}
      </div>
    </li>
  )
}, sameProps)

/**
 * 조립기가 바뀌지 않은 카드의 CardView를 재사용하므로, 그룹은 새 객체여도 선택지 카드가 모두 같으면 다시 그리지 않는다
 * (조각마다 오는 탭 뷰에서 바뀐 행만 다시 그린다).
 */
function sameProps(a: Props, b: Props): boolean {
  if (a.game !== b.game || a.tab !== b.tab || a.card !== b.card || a.rollSteps !== b.rollSteps || a.expanded !== b.expanded) return false
  if (a.onToggle !== b.onToggle || a.onSelect !== b.onSelect || a.target !== b.target || a.dispatch !== b.dispatch || a.groupLabelId !== b.groupLabelId) return false
  if (a.onChooseItem !== b.onChooseItem || a.onResetItem !== b.onResetItem || a.onMenuCards !== b.onMenuCards) return false
  if (a.items.length !== b.items.length || !a.items.every((g, i) => g.item === b.items[i].item && g.card === b.items[i].card)) return false
  if (a.group === b.group) return true
  if (a.group.key !== b.group.key || a.group.opponent !== b.group.opponent || a.group.berry?.item !== b.group.berry?.item || a.group.options.length !== b.group.options.length)
    return false
  if (a.group.pinned.length !== b.group.pinned.length || !a.group.pinned.every((id, i) => id === b.group.pinned[i])) return false
  return a.group.options.every((o, i) => o === b.group.options[i])
}
