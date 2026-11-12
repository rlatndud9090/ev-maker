import { memo, useEffect, useId, useLayoutEffect, useRef, useState, type Dispatch, type KeyboardEvent, type MouseEvent } from 'react'
import type { CardGroup, CardView, CellView, CustomTarget, RowView, Tab } from '../../cards'
import type { Snapshot } from '../../data/schema'
import { namesOf } from '../../ui/names'
import { bundleText, fixedText, koBadge, orderBadge, shareText, type KoBadge } from '../../ui/format'
import { koReason } from '../../ui/koErrors'
import type { AppAction } from '../state'
import { CustomEditor } from './CustomEditor'
import { RowDetail } from './RowDetail'
import { MoveLabel, PriorityTag } from './MoveLabel'
import { itemKeyLabel, moveNoticeText } from './text'

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
}

const currentCell = (row: RowView): CellView | undefined => row.cells.find((c) => c.sp === row.current.sp)

/** 카드 줄 배지의 기준 칸: 대표 행의 현재 칸. 전 행 변화 없음 커스텀 카드는 칸이 있는 첫 행. */
function badgeCell(card: CardView): CellView | undefined {
  const h = card.headline
  if (h.kind === 'row') {
    const row = card.rows.find((r) => r.id === h.rowId)
    return row === undefined ? undefined : currentCell(row)
  }
  if (h.kind !== 'no-change') return undefined
  for (const row of card.rows) {
    const cell = currentCell(row)
    if (cell !== undefined) return cell
  }
  return undefined
}

/** 공격·방어는 1타 확률 결과 배지, 스피드는 행동 순서 배지. */
function resultBadge(tab: Tab, card: CardView, rollSteps: number): { kind: 'ko' | 'order'; badge: KoBadge } | undefined {
  const badge = tab === 'speed' ? orderBadge(badgeCell(card)) : koBadge(tab, badgeCell(card), rollSteps)
  return badge === undefined ? undefined : { kind: tab === 'speed' ? 'order' : 'ko', badge }
}

/** 배분 라벨 "A32↑ 56.3%": 묶음(본문색)과 비중(래더)·소수 배분·프리셋(커스텀)은 작은 회색 글씨. */
function BundleLabel({ card }: { card: CardView }) {
  const { bundle } = card
  const ladder = card.opponent.source === 'ladder'
  return (
    <>
      <span className="bundle-stats">{bundle.stats.length > 0 ? bundleText(bundle.stats) : '관련 SP 없음'}</span>
      {ladder && bundle.share !== undefined && !bundle.minority && <> <span className="bundle-share">{shareText(bundle.share)}</span></>}
      {ladder && bundle.minority && <> <span className="bundle-share">소수 배분</span></>}
      {!ladder && bundle.presetIndex !== undefined && <> <span className="bundle-share">프리셋 {bundle.presetIndex + 1}</span></>}
    </>
  )
}

function Headline({ game, tab, card, badge }: { game: Snapshot; tab: Tab; card: CardView; badge: boolean }) {
  const h = card.headline
  if (h.kind === 'updating') return <span className="headline updating">갱신 중</span>
  if (h.kind === 'error') return <span className="headline error">계산 불가: {koReason(game, h.reason)}</span>
  if (h.kind === 'no-change') {
    // 배지가 고정 판정을 대신한다. 칸 없는 고정 판정 행(극단 필터·내 SP 무관)만 문구로 보인다.
    if (badge || h.fixed.length === 0) return null
    return <span className="headline fixed">{h.fixed.map(fixedText).join(', ')}</span>
  }
  const row = card.rows.find((r) => r.id === h.rowId)
  if (row === undefined || row.sweepStat === undefined) return null
  // 판정은 결과 배지가 보이고 여기는 기술 라벨만. 목표 문구("최소 … 필요")는 상세 행에만 있다.
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
        {row.keptAsPriority && (
          <>
            {' '}
            <PriorityTag />
          </>
        )}
      </span>
    </span>
  )
}

const stop = (e: MouseEvent) => e.stopPropagation()

/** 행의 배분 배지: 선택지가 둘 이상이면 아래로 여는 배분 선택 메뉴. */
function BundlePicker({ tab, group, card, rollSteps, onSelect }: Pick<Props, 'tab' | 'group' | 'card' | 'rollSteps' | 'onSelect'>) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLSpanElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

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
    menu?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus()
    menu?.scrollIntoView({ block: 'nearest' })
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])

  const onMenuKey = (e: KeyboardEvent) => {
    const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [])]
    const at = items.indexOf(document.activeElement as HTMLButtonElement)
    if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
      btnRef.current?.focus()
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const step = e.key === 'ArrowDown' ? 1 : -1
      items[(at + step + items.length) % items.length]?.focus()
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault()
      items[e.key === 'Home' ? 0 : items.length - 1]?.focus()
    } else if (e.key === 'Tab') {
      setOpen(false)
    }
  }

  return (
    <span className="bundle-cell bundle-pick" ref={wrapRef} onClick={stop}>
      <button
        type="button"
        ref={btnRef}
        className="bundle-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`노력치 배분 ${bundleAria(card)} (${group.options.length}개 중 선택)`}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="card-bundle num" data-testid="card-bundle">
          <BundleLabel card={card} />
        </span>
        <span className="bundle-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <div className="bundle-menu" role="menu" aria-label="노력치 배분" ref={menuRef} onKeyDown={onMenuKey} data-testid="bundle-menu">
          {group.options.map((o) => {
            const r = resultBadge(tab, o, rollSteps)
            return (
              <button
                key={o.id}
                type="button"
                role="menuitemradio"
                aria-checked={o.id === card.id}
                className="bundle-opt"
                data-card-id={o.id}
                data-category={o.category ?? 'none'}
                onClick={() => {
                  onSelect(group.key, o.id)
                  setOpen(false)
                  btnRef.current?.focus()
                }}
              >
                <span className="bundle-opt-label num">
                  <BundleLabel card={o} />
                </span>
                {o.state === 'error' && <span className="badge-error">계산 불가</span>}
                {r !== undefined && <span className={`ko-badge ko-${r.badge.tone} ko-small`}>{r.badge.label}</span>}
              </button>
            )
          })}
        </div>
      )}
    </span>
  )
}

/** 스크린 리더용 배분 문구(비중 포함) */
function bundleAria(card: CardView): string {
  const { bundle } = card
  const stats = bundle.stats.length > 0 ? bundleText(bundle.stats) : '관련 SP 없음'
  if (card.opponent.source === 'custom') return bundle.presetIndex !== undefined ? `${stats} 프리셋 ${bundle.presetIndex + 1}` : stats
  if (bundle.minority) return `${stats} 소수 배분`
  return bundle.share !== undefined ? `${stats} ${shareText(bundle.share)}` : stats
}

/** 상세 최상단: 배분을 사용률 순 가로 탭으로(넘치면 가로 스크롤). */
function BundleTabs({ group, card, onSelect, tabId, panelId }: Pick<Props, 'group' | 'card' | 'onSelect'> & { tabId: (i: number) => string; panelId: string }) {
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // 선택 탭이 가로 스크롤 밖이면 보이게 옮긴다(세로 스크롤은 건드리지 않는다).
    const list = listRef.current
    const tab = list?.querySelector<HTMLElement>('[aria-selected="true"]')
    if (!list || !tab) return
    const left = tab.offsetLeft - list.offsetLeft
    if (left < list.scrollLeft) list.scrollLeft = left
    else if (left + tab.offsetWidth > list.scrollLeft + list.clientWidth) list.scrollLeft = left + tab.offsetWidth - list.clientWidth
  }, [card.id])

  const onKey = (e: KeyboardEvent) => {
    const n = group.options.length
    const at = group.options.findIndex((o) => o.id === card.id)
    let to: number
    if (e.key === 'ArrowRight') to = (at + 1) % n
    else if (e.key === 'ArrowLeft') to = (at - 1 + n) % n
    else if (e.key === 'Home') to = 0
    else if (e.key === 'End') to = n - 1
    else return
    e.preventDefault()
    const next = group.options[to]
    onSelect(group.key, next.id)
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(next.id)}"]`)?.focus())
  }

  return (
    <div className="bundle-tabs" role="tablist" aria-label="노력치 배분" data-testid="bundle-tabs" ref={listRef} onKeyDown={onKey}>
      {group.options.map((o, i) => {
        const selected = o.id === card.id
        return (
          <button
            key={o.id}
            type="button"
            role="tab"
            id={tabId(i)}
            aria-controls={panelId}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            className="bundle-tab num"
            data-card-id={o.id}
            onClick={() => onSelect(group.key, o.id)}
          >
            <BundleLabel card={o} />
          </button>
        )
      })}
    </div>
  )
}

export const CardItem = memo(function CardItem({ game, tab, group, card, rollSteps, expanded, onToggle, onSelect, target, dispatch }: Props) {
  const names = namesOf(game)
  const ladder = card.opponent.source === 'ladder'
  const detailId = `card-detail-${encodeURIComponent(group.key)}`
  const multi = group.options.length > 1
  const result = resultBadge(tab, card, rollSteps)
  // 토글 버튼 이름은 포켓몬, 설명은 줄의 기술·결과(스크린 리더가 접힌 줄 판정을 함께 읽는다)
  const uid = useId()
  const headlineId = `${uid}-headline`
  const resultId = `${uid}-result`
  const tabId = (i: number) => `${uid}-tab-${i}`
  const panelId = `${uid}-panel`
  const selectedIndex = Math.max(0, group.options.findIndex((o) => o.id === card.id))
  const body = (
    <>
      {card.state === 'error' && card.error && <p className="row-error">계산 불가: {koReason(game, card.error)}</p>}
      {card.rows.length > 0 && (
        <ol className="rows">
          {card.rows.map((r) => (
            <RowDetail key={r.id} game={game} tab={tab} row={r} />
          ))}
        </ol>
      )}
      {target !== undefined && <CustomEditor key={card.id} game={game} tab={tab} card={card} target={target} dispatch={dispatch} />}
    </>
  )
  return (
    <li
      className={`card card-${card.state}${expanded ? ' open' : ''}`}
      data-testid="card"
      data-card-id={card.id}
      data-group-key={group.key}
      data-opponent={card.opponent.id}
      data-category={card.category ?? 'none'}
      data-origin={ladder ? 'ladder' : 'custom'}
      data-rank={ladder ? card.opponent.rank : undefined}
      data-state={card.state}
    >
      {/* 행 어디를 눌러도 펼친다. 키보드·스크린 리더는 이름 칸 버튼(클릭이 이 줄로 버블돼 한 번만 토글). */}
      <div className="card-line" onClick={() => onToggle(group.key)}>
        <button type="button" className="card-toggle card-who" aria-expanded={expanded} aria-controls={detailId} aria-describedby={result === undefined ? headlineId : `${headlineId} ${resultId}`}>
          <span className="card-name">{names.species.label(card.opponent.id)}</span>
          {!ladder && (
            <span className="card-meta">
              <span className="custom-tag">출처: 사용자 지정</span>
            </span>
          )}
        </button>
        {multi ? (
          <BundlePicker tab={tab} group={group} card={card} rollSteps={rollSteps} onSelect={onSelect} />
        ) : (
          <span className="bundle-cell">
            <span className="card-bundle num" data-testid="card-bundle">
              <BundleLabel card={card} />
            </span>
          </span>
        )}
        {card.state === 'error' && <span className="badge-error">계산 불가</span>}
        <span className="card-headline" data-testid="card-headline" id={headlineId}>
          <Headline game={game} tab={tab} card={card} badge={result !== undefined} />
        </span>
        {/* 왼쪽부터 포켓몬 → SP 배분 → 기술 → 결과, 오른쪽 끝에는 "외 n행"만 */}
        {result?.kind === 'ko' && (
          <span className={`ko-badge ko-${result.badge.tone}`} data-testid="ko-badge" data-tone={result.badge.tone} id={resultId}>
            {result.badge.label}
            {result.badge.chance !== undefined && <small className="ko-chance num"> {result.badge.chance}</small>}
          </span>
        )}
        {result?.kind === 'order' && (
          <span className={`ko-badge ko-${result.badge.tone}`} data-testid="order-badge" data-tone={result.badge.tone} id={resultId}>
            {result.badge.label}
          </span>
        )}
        {card.moreRows > 0 && (
          <span className="card-more" data-testid="card-more">
            외 {card.moreRows}행
          </span>
        )}
      </div>
      {card.notices.map((n) => (
        <p key={JSON.stringify([n.kind, n.owner, n.moveId])} className="card-notice" data-testid="card-notice">
          {moveNoticeText(game, n)}
        </p>
      ))}
      <div id={detailId} className="card-detail" hidden={!expanded}>
        {expanded &&
          (multi ? (
            <>
              <BundleTabs group={group} card={card} onSelect={onSelect} tabId={tabId} panelId={panelId} />
              <div role="tabpanel" id={panelId} className="bundle-panel" aria-labelledby={tabId(selectedIndex)} data-testid="bundle-panel">
                {body}
              </div>
            </>
          ) : (
            body
          ))}
      </div>
    </li>
  )
})
