import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import type { GroupItem, ItemView, Tab } from '../../cards'
import { moveStatRefs, type MoveStatRefs } from '../../core'
import type { Snapshot } from '../../data/schema'
import { koBadge } from '../../ui/format'
import { namesOf } from '../../ui/names'
import { addableMoves, searchIndexOf } from '../../ui/search'
import { Combobox } from './Combobox'
import { MoveLabel, VariableTag } from './MoveLabel'
import { meansLabel, moveRankParts } from './text'


function refsOf(game: Snapshot, moveId: string): MoveStatRefs | undefined {
  try {
    return moveStatRefs(game, moveId)
  } catch {
    return undefined
  }
}

/** 항목의 라벨 행(MoveLabel 입력) */
function labelRow(game: Snapshot, item: ItemView) {
  const refs = refsOf(game, item.moveId)
  return { moveId: item.moveId, moveType: item.moveType, power: item.power, basis: item.basis, ...(refs === undefined ? {} : { refs }) }
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

/**
 * 항목 내용: [기술 라벨][수단(같은 기술 라벨이 겹칠 때만)] … [현재 판정 배지][변동(변동 판정이 나온 변동 항목만)].
 * 목록에 변동 항목이 하나라도 있으면 나머지 항목에 같은 폭 빈 칸을 둬 결과 배지 오른쪽 끝이 세로로 맞는다(배분 목록과 같다).
 */
function ItemContent({ game, tab, item, rollSteps, showMeans, reserveVariable }: { game: Snapshot; tab: Tab; item: ItemView; rollSteps: number; showMeans: boolean; reserveVariable: boolean }) {
  const badge = item.status === 'ok' || item.status === 'immune' ? koBadge(tab === 'defense' ? 'defense' : 'attack', item.cell, rollSteps) : undefined
  return (
    <>
      <span className="move-opt-label">
        <MoveLabel game={game} tab={tab} row={labelRow(game, item)} />
        {showMeans && item.basis !== undefined && <span className="means-tag">{meansLabel(game, item.basis.means)}</span>}
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
        {item.variable === true ? (
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

/** 방어 탭 래더 상대의 기술 추가·삭제(R8). 없으면 검색 칸·× 버튼이 없다 */
export interface MoveAdding {
  opponentId: string
  onAdd: (moveId: string) => void
  onRemove: (moveId: string) => void
}

/**
 * 추가·삭제로 재계산되는 동안 기술 버튼이 잠깐 빠졌다 다시 붙으면 포커스가 body로 떨어진다.
 * 그때 다시 붙은 버튼으로 포커스를 돌려주려고 그 버튼의 키를 기억한다. 다른 곳에 포커스·클릭이 가면 잊는다.
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

/** 메뉴 아래 "기술 추가" 검색 칸. 키 입력은 메뉴 조작으로 올리지 않는다(목록이 닫힌 Escape만 메뉴를 닫는다) */
function MoveAddSearch({ game, adding, exclude, onPicked }: { game: Snapshot; adding: MoveAdding; exclude: readonly string[]; onPicked: () => void }) {
  const names = namesOf(game)
  const excludeSig = exclude.join(',')
  const ids = useMemo(() => addableMoves(game, adding.opponentId, excludeSig.split(',')), [game, adding.opponentId, excludeSig])
  const index = useMemo(() => searchIndexOf(game.data.moves, ids), [game, ids])
  return (
    <div
      className="move-add"
      role="group"
      aria-label="기술 추가"
      data-testid="move-add"
      onKeyDown={(e) => {
        if (e.key !== 'Escape' || e.defaultPrevented) e.stopPropagation()
      }}
    >
      <Combobox
        label="기술 추가"
        hideLabel
        index={index}
        value=""
        clearOnCommit
        optionsOnly
        limit={8}
        placeholder="+ 기술 추가"
        labelOf={names.moves.label}
        onCommit={(_text, id) => {
          if (id === undefined) return
          adding.onAdd(id)
          onPicked()
        }}
      />
    </div>
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
  /** 보이는 항목이 직접 고른 것 */
  selected: boolean
  onChoose: (item: GroupItem) => void
  onReset: () => void
  /** 버튼 안(현재 기술 라벨) */
  children: ReactNode
  /** 버튼 접근 가능한 이름(현재 항목 라벨 + "기술 선택") */
  label: string
  testId: string
  /** 방어 탭 래더 상대만 */
  adding?: MoveAdding
  /** 재계산 뒤 포커스를 돌려줄 버튼 키(탭·포켓몬 줄·위치마다 고유) */
  focusKey: string
  /** 목록이 열리고 닫힐 때(열린 동안 그 줄 항목의 변동 판정을 먼저 계산하게 알린다) */
  onOpenChange?: (open: boolean) => void
}

const stop = (e: MouseEvent) => e.stopPropagation()

/** 기술 배지: 누르면 기술 선택 드롭다운(배분 메뉴와 같은 조작). 배지를 눌러도 카드는 펼쳐지거나 접히지 않는다 */
export function MoveMenu({ game, tab, rollSteps, items, shown, selected, onChoose, onReset, children, label, testId, adding, focusKey, onOpenChange }: Props) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLSpanElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const close = () => {
    setOpen(false)
    btnRef.current?.focus()
  }
  // 추가·삭제는 재계산을 부른다: 메뉴를 닫고 기술 버튼으로 돌아간다(다시 붙으면 거기로)
  const closeAfterEdit = () => {
    // 닫기(버튼 포커스)가 먼저: 그 focusin이 방금 등록한 되돌림을 지우지 않게(배분 메뉴와 같은 순서)
    close()
    rememberFocusReturn(focusKey)
  }
  const dup = duplicateLabels(game, tab, items)
  const ranked = (i: GroupItem) => i.item.status === 'error' || i.item.status === 'immune'
  const removable = adding !== undefined && items.some((g) => g.item.added === true)
  const names = namesOf(game)

  useEffect(() => {
    const active = document.activeElement
    if (focusReturn === focusKey && (active === null || active === document.body)) btnRef.current?.focus()
  }, [focusKey])

  useEffect(() => {
    if (!open || onOpenChange === undefined) return
    onOpenChange(true)
    return () => onOpenChange(false)
  }, [open, onOpenChange])

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
    // ↑↓·Home/End는 되돌리기·항목만 오간다(× 에 포커스가 있으면 그 항목 기준). → 항목에서 그 ×로, ← ×에서 그 항목으로.
    const all = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('.move-reset, .move-opt') ?? [])]
    const active = document.activeElement as HTMLElement | null
    const rowItem = active?.closest('.move-opt-row')?.querySelector<HTMLButtonElement>('.move-opt') ?? (active as HTMLButtonElement | null)
    const at = rowItem === null ? -1 : all.indexOf(rowItem)
    if (e.key === 'ArrowRight' && active?.classList.contains('move-opt')) {
      const x = active.closest('.move-opt-row')?.querySelector<HTMLElement>('[data-remove-for]')
      if (x) {
        e.preventDefault()
        x.focus()
      }
    } else if (e.key === 'ArrowLeft' && active?.hasAttribute('data-remove-for') && rowItem !== null) {
      e.preventDefault()
      rowItem.focus()
    } else if (e.key === 'Escape') {
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
  const reserveVariable = items.some((g) => g.item.variable === true)
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
                  data-variable={g.item.variable === undefined ? undefined : String(g.item.variable)}
                  onClick={() => {
                    onChoose(g)
                    close()
                  }}
                >
                  <ItemContent game={game} tab={tab} item={g.item} rollSteps={rollSteps} showMeans={dup.has(g.item.key)} reserveVariable={reserveVariable} />
                </button>
                {removable &&
                  (g.item.added === true ? (
                    <button
                      type="button"
                      role="menuitem"
                      className="move-remove"
                      aria-label={`추가한 기술 삭제: ${names.moves.label(g.item.moveId)}`}
                      title="추가한 기술 삭제"
                      data-remove-for={g.item.key}
                      data-testid="move-remove"
                      onClick={(e) => {
                        e.stopPropagation()
                        adding?.onRemove(g.item.moveId)
                        closeAfterEdit()
                      }}
                    >
                      ×
                    </button>
                  ) : (
                    <span className="move-remove-slot" aria-hidden="true" />
                  ))}
              </div>
            )
          })}
          {adding !== undefined && <MoveAddSearch game={game} adding={adding} exclude={items.map((g) => g.item.moveId)} onPicked={closeAfterEdit} />}
        </div>
      )}
    </span>
  )
}
