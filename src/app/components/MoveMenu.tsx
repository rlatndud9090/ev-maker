import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import type { GroupItem, ItemView, Tab } from '../../cards'
import { moveStatRefs, type MoveStatRefs } from '../../core'
import type { Snapshot } from '../../data/schema'
import { koBadge } from '../../ui/format'
import { MoveLabel } from './MoveLabel'
import { meansLabel, moveRankParts } from './text'

const SPREAD_TARGETS = ['allAdjacentFoes', 'allAdjacent']

function refsOf(game: Snapshot, moveId: string): MoveStatRefs | undefined {
  try {
    return moveStatRefs(game, moveId)
  } catch {
    return undefined
  }
}

const isSpread = (game: Snapshot, moveId: string): boolean =>
  Object.prototype.hasOwnProperty.call(game.data.moves, moveId) && SPREAD_TARGETS.includes(game.data.moves[moveId].target)

/** 항목의 라벨 행(MoveLabel 입력) */
function labelRow(game: Snapshot, item: ItemView) {
  const refs = refsOf(game, item.moveId)
  return { moveId: item.moveId, basis: item.basis, ...(refs === undefined ? {} : { refs }) }
}

/** 같은 기술·같은 랭크 표기의 랭크 후 항목이 둘 이상이면 수단 이름으로 가른다 */
function duplicateLabels(game: Snapshot, tab: Tab, items: readonly GroupItem[]): Set<string> {
  const seen = new Map<string, number>()
  const sig = (i: ItemView) => {
    const { own, rest } = moveRankParts(tab, labelRow(game, i))
    return JSON.stringify([i.moveId, own ?? '', rest])
  }
  for (const { item } of items) if (item.basis !== undefined) seen.set(sig(item), (seen.get(sig(item)) ?? 0) + 1)
  return new Set(items.filter(({ item }) => item.basis !== undefined && (seen.get(sig(item)) ?? 0) > 1).map(({ item }) => item.key))
}

/** 항목 내용: [기술 라벨][선공][분산][수단] … [현재 판정 배지] */
export function ItemContent({ game, tab, item, rollSteps, showMeans, isDefault }: { game: Snapshot; tab: Tab; item: ItemView; rollSteps: number; showMeans: boolean; isDefault: boolean }) {
  const badge = item.status === 'ok' || item.status === 'immune' ? koBadge(tab === 'defense' ? 'defense' : 'attack', item.cell, rollSteps) : undefined
  return (
    <>
      <span className="move-opt-label">
        <MoveLabel game={game} tab={tab} row={labelRow(game, item)} />
        {item.priority && <span className="priority-tag" data-testid="priority-tag">선공</span>}
        {isSpread(game, item.moveId) && <span className="spread-tag" data-testid="spread-tag">(분산)</span>}
        {showMeans && item.basis !== undefined && <span className="means-tag">{meansLabel(game, item.basis.means)}</span>}
        {isDefault && <span className="default-tag" data-testid="default-tag">기본</span>}
      </span>
      <span className="move-opt-result">
        {badge !== undefined && (
          <span className={`ko-badge ko-${badge.tone} ko-small`} data-testid="item-badge">
            {badge.label}
            {badge.chance !== undefined && <small className="ko-chance num"> {badge.chance}</small>}
          </span>
        )}
        {item.status === 'error' && <span className="badge-error">계산 불가</span>}
        {item.status === 'pending' && <span className="hint">판정 중</span>}
      </span>
    </>
  )
}

interface Props {
  game: Snapshot
  tab: Tab
  rollSteps: number
  /** 포켓몬 한 줄의 항목(가장 세게 치는 순, groupItems) */
  items: readonly GroupItem[]
  /** 지금 보이는 항목 키 */
  shown?: string
  /** 기본 항목 키(보이는 카드의 것) */
  defaultKey?: string
  /** 보이는 항목이 직접 고른 것 */
  selected: boolean
  onChoose: (item: GroupItem) => void
  onReset: () => void
  /** 버튼 안(현재 기술 라벨) */
  children: ReactNode
  /** 버튼 접근 가능한 이름(현재 항목 라벨 + "기술 선택") */
  label: string
  testId: string
}

const stop = (e: MouseEvent) => e.stopPropagation()

/** 기술 배지: 누르면 기술 선택 드롭다운(배분 메뉴와 같은 조작). 배지를 눌러도 카드는 펼쳐지거나 접히지 않는다 */
export function MoveMenu({ game, tab, rollSteps, items, shown, defaultKey, selected, onChoose, onReset, children, label, testId }: Props) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLSpanElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const close = () => {
    setOpen(false)
    btnRef.current?.focus()
  }
  const dup = duplicateLabels(game, tab, items)
  const ranked = (i: GroupItem) => i.item.status === 'error' || i.item.status === 'immune'

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
    // 좁은 화면에서 오른쪽이 화면(여백 16px)을 넘으면 그만큼 왼쪽으로 당긴다(가로 스크롤 없음).
    menu.style.left = ''
    const over = menu.getBoundingClientRect().right - (document.documentElement.clientWidth - 16)
    if (over > 0) menu.style.left = `${-over}px`
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
    const all = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"], [role="menuitem"]') ?? [])]
    const at = all.indexOf(document.activeElement as HTMLButtonElement)
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const step = e.key === 'ArrowDown' ? 1 : -1
      const from = at < 0 && step < 0 ? 0 : at
      all[(from + step + all.length) % all.length]?.focus()
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault()
      all[e.key === 'Home' ? 0 : all.length - 1]?.focus()
    }
  }

  // 계산 불가·무효 항목 앞에 구분선(정렬상 맨 뒤 묶음의 첫 항목)
  const firstRanked = items.findIndex(ranked)
  return (
    <span className="move-pick" ref={wrapRef} onClick={stop}>
      <button
        type="button"
        ref={btnRef}
        className={`move-btn${selected ? ' chosen' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        data-testid={testId}
        data-selected={selected ? 'true' : undefined}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => e.stopPropagation()}
      >
        {children}
        {selected && (
          <span className="chosen-tag" data-testid="chosen-tag">
            직접
          </span>
        )}
        <span className="bundle-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <div className="move-menu" role="menu" aria-label="판정 기술" ref={menuRef} tabIndex={-1} onKeyDown={onMenuKey} data-testid="move-menu"
          onBlur={(e) => {
            if (e.relatedTarget !== null && !wrapRef.current?.contains(e.relatedTarget as Node)) setOpen(false)
          }}
        >
          {selected && (
            <button
              type="button"
              role="menuitem"
              className="move-reset"
              data-testid="move-reset"
              onClick={() => {
                onReset()
                close()
              }}
            >
              ↺ 기본값으로 되돌리기
            </button>
          )}
          {items.map((g, i) => {
            const sep = i === firstRanked && i > 0
            return (
              <div key={g.item.key} role="none" className={sep ? 'move-opt-row sep' : 'move-opt-row'}>
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={g.item.key === shown}
                  className="move-opt"
                  data-item-key={g.item.key}
                  data-move={g.item.moveId}
                  data-status={g.item.status}
                  data-category={g.card.category ?? 'none'}
                  onClick={() => {
                    onChoose(g)
                    close()
                  }}
                >
                  <ItemContent game={game} tab={tab} item={g.item} rollSteps={rollSteps} showMeans={dup.has(g.item.key)} isDefault={selected && g.item.key === defaultKey} />
                </button>
              </div>
            )
          })}
        </div>
      )}
    </span>
  )
}
