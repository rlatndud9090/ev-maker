import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { useLockUi } from '../lockContext'
import { LOCK_NAME, lockStatusText, pinLabel, type PinStageView } from './lockText'
import { LOCKED_MARK_TEXT } from './speedText'
import { judgementText } from '../../ui/format'
import './cutPin.css'

interface Props {
  /** 읽기 이름의 대상(상대 이름) */
  subject: string
  /** 이 대상에 걸린 고정 seq. 하나라도 있으면 찬 핀이고 누르면 모두 해제한다 */
  lockedBy: readonly number[]
  /** 빈 핀 전체를 막는 이유(aria-disabled + 툴팁·읽기 설명) */
  disabledReason?: string
  /** 메뉴 항목(고를 수 있는 항목은 고르면 그 고정을 더한다). 메뉴가 열린 동안만 부른다 */
  items: () => readonly PinStageView[]
  /** 단계가 하나뿐이라 고를 수 있으면 메뉴 없이 바로 고정한다(스피드) */
  direct?: boolean
  onOpenChange?: (open: boolean) => void
  tabIndex?: number
  onKeyDown?: (e: KeyboardEvent<HTMLButtonElement>) => void
}

/** 핀 모양(고정이면 채움, 아니면 윤곽선) */
function CutPinIcon({ filled }: { filled: boolean }) {
  return (
    <svg className="cut-pin-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
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

const stop = (e: MouseEvent) => e.stopPropagation()

/**
 * 컷 고정 핀: 빈 핀 → 단계 메뉴(role=menu, ↑↓·Home/End, Esc·Tab으로 닫고 핀으로 포커스), 찬 핀 → 그 대상 고정 모두 해제.
 * 누름은 감싼 줄(카드 펼침·배지 상세)로 올리지 않는다.
 */
export function CutPin({ subject, lockedBy, disabledReason, items, direct = false, onOpenChange, tabIndex, onKeyDown }: Props) {
  const ui = useLockUi()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLSpanElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const uid = useId()
  const openChange = useRef(onOpenChange)
  useLayoutEffect(() => {
    openChange.current = onOpenChange
  })
  const locked = lockedBy.length > 0
  const disabled = !locked && disabledReason !== undefined
  const shown = open && !locked && !disabled
  const list = shown ? items() : []
  const selectable = list.findIndex((it) => it.lock !== undefined)
  // 바로 고정하는 핀은 메뉴가 열린 동안만 메뉴 버튼이다(닫힌 동안 누르면 대개 바로 고정)
  const menuButton = !locked && !disabled && (!direct || shown)
  const focusLater = useRef(false)

  useEffect(() => {
    if (!shown) return
    openChange.current?.(true)
    return () => openChange.current?.(false)
  }, [shown])

  // 처음 열 때만 첫 고를 수 있는 항목(없으면 첫 항목)에 포커스. 아래 공간이 모자라고 위가 넓으면 위로 연다
  useLayoutEffect(() => {
    if (!shown) return
    const menu = menuRef.current
    const btn = btnRef.current
    if (menu === null || btn === null) return
    const b = btn.getBoundingClientRect()
    const box = btn.closest('.result-scroll, .speed-frame')?.getBoundingClientRect()
    const below = Math.min(window.innerHeight, box?.bottom ?? Infinity) - b.bottom
    const above = b.top - Math.max(0, box?.top ?? 0)
    menu.classList.toggle('up', below < menu.offsetHeight + 6 && above > below)
    const all = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')]
    const target = all.find((el) => el.getAttribute('aria-disabled') !== 'true')
    focusLater.current = target === undefined
    ;(target ?? all[0] ?? menu).focus()
  }, [shown])

  // 열 때 고를 항목이 없어(계산 중) 첫 항목에 둔 포커스는, 처음 고를 수 있는 항목이 생길 때 한 번 그리로 옮긴다(사용자가 옮겼으면 두지 않음)
  useLayoutEffect(() => {
    if (!shown || !focusLater.current || selectable < 0) return
    focusLater.current = false
    const all = menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]')
    if (all !== undefined && document.activeElement === all[0]) all[selectable]?.focus()
  }, [shown, selectable])

  useEffect(() => {
    if (!shown) return
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [shown])

  const close = () => {
    setOpen(false)
    btnRef.current?.focus()
  }

  const onClick = () => {
    if (locked) {
      setOpen(false)
      for (const seq of lockedBy) ui.removeLock(seq)
      return
    }
    if (disabled) return
    if (open) {
      setOpen(false)
      return
    }
    if (direct) {
      const only = items()
      if (only.length === 1 && only[0].lock !== undefined) {
        ui.addLock(only[0].lock)
        return
      }
    }
    setOpen(true)
  }

  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const els = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]
    const at = els.indexOf(document.activeElement as HTMLElement)
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close()
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      e.stopPropagation()
      const step = e.key === 'ArrowDown' ? 1 : -1
      els[(at + step + els.length) % els.length]?.focus()
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault()
      e.stopPropagation()
      els[e.key === 'Home' ? 0 : els.length - 1]?.focus()
    } else if (e.key === 'Tab') {
      setOpen(false)
    }
  }

  if (!ui.enabled) return null
  const lockedTitle = () => {
    const parts = lockedBy.flatMap((seq) => {
      const lock = ui.locks.find((l) => l.seq === seq)
      if (lock === undefined) return []
      const st = ui.derivation?.statuses.get(seq)
      const t = st === undefined ? undefined : lockStatusText(st)
      return [t === undefined ? judgementText(lock.stage) : `${judgementText(lock.stage)}(${t.text})`]
    })
    return `${LOCK_NAME} ${LOCKED_MARK_TEXT}${parts.length > 0 ? `: ${parts.join(', ')}` : ''}`
  }
  const title = locked ? lockedTitle() : (disabledReason ?? LOCK_NAME)
  const noteId = `${uid}-note`
  return (
    <span className="cut-pin-wrap" ref={wrapRef} onClick={stop}>
      <button
        type="button"
        ref={btnRef}
        className="cut-pin"
        aria-label={pinLabel(subject, locked)}
        aria-pressed={locked}
        aria-haspopup={menuButton ? 'menu' : undefined}
        aria-expanded={menuButton ? shown : undefined}
        aria-disabled={disabled ? 'true' : undefined}
        aria-describedby={locked || disabled ? noteId : undefined}
        title={title}
        tabIndex={tabIndex}
        data-testid="cut-pin"
        data-locked={locked ? 'true' : undefined}
        onClick={onClick}
        onKeyDown={onKeyDown}
      >
        <CutPinIcon filled={locked} />
      </button>
      {(locked || disabled) && (
        <span id={noteId} className="sr-only">
          {title}
        </span>
      )}
      {shown && (
        <div
          className="cut-pin-menu"
          role="menu"
          aria-label={`${LOCK_NAME} 단계: ${subject}`}
          ref={menuRef}
          tabIndex={-1}
          onKeyDown={onMenuKey}
          onBlur={(e) => {
            if (e.relatedTarget !== null && !wrapRef.current?.contains(e.relatedTarget as Node)) setOpen(false)
          }}
          data-testid="cut-pin-menu"
        >
          {list.map((it) => (
            <button
              key={it.stage}
              type="button"
              role="menuitem"
              className="cut-pin-item"
              aria-disabled={it.lock === undefined ? 'true' : undefined}
              data-testid="cut-pin-item"
              data-stage={it.stage}
              data-enabled={it.lock === undefined ? 'false' : 'true'}
              onClick={() => {
                if (it.lock === undefined) return
                ui.addLock(it.lock)
                close()
              }}
            >
              <span className="cut-pin-stage">{it.label}</span>
              <span className="cut-pin-detail">{it.detail}</span>
            </button>
          ))}
        </div>
      )}
    </span>
  )
}
