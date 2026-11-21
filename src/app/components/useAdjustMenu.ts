// 2단 결과 → 성격 메뉴(AdjustMenu)의 열림·단계·포커스·위치·키보드. 변동 팝오버와 공·방 카드 핀이 같이 쓴다.
import { useEffect, useLayoutEffect, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react'
import type { RollTier } from '../../core'

/** 메뉴가 넘지 않는 화면 여백(px, 본문 좌우 여백과 같다) */
const MENU_GUTTER = 16

export interface AdjustMenuOptions {
  /** 1단 결과(라벨로 고른 결과를 기억한다). 함수면 메뉴가 열린 동안만 부른다 */
  results: readonly { label: RollTier }[] | (() => readonly { label: RollTier }[])
  /** false면 열리지 않는다(변동 locked·핀 비활성) */
  enabled: boolean
  /** end = 버튼 오른쪽 끝에 맞춰 왼쪽으로 펼침(변동), start = 버튼 왼쪽 끝에서 오른쪽으로 펼침(카드 왼쪽 끝 핀) */
  anchor: 'end' | 'start'
}

/**
 * 키보드: ↑↓·Home/End 이동, Enter·Space 선택, 1단 → = 결과 고르기, 2단 ← = 뒤로, Esc = 닫고 버튼으로, Tab·바깥 누름 = 닫기.
 * 고른 결과가 다시 계산된 목록에서 사라지면 1단으로 돌아간다. 단계가 바뀌면 첫 고를 수 있는 항목(뒤로 왔으면 고른 결과)에 포커스한다.
 */
export function useAdjustMenu({ results, enabled, anchor }: AdjustMenuOptions) {
  const [open, setOpen] = useState(false)
  const [chosen, setChosen] = useState<RollTier | null>(null)
  const wrapRef = useRef<HTMLSpanElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const shown = open && enabled
  const list = typeof results === 'function' ? (shown ? results() : []) : results
  const found = chosen === null ? -1 : list.findIndex((r) => r.label === chosen)
  // 고른 결과가 다시 계산된 목록에서 사라지면 1단으로 돌아간다
  if (chosen !== null && found < 0) setChosen(null)
  const stage = found < 0 ? null : found
  const stageKey = stage === null ? null : chosen
  /** 1단으로 돌아갈 때 포커스할 결과 */
  const backTo = useRef<RollTier | null>(null)

  // 단계가 바뀔 때마다: 첫 고를 수 있는 항목(뒤로 왔으면 고른 결과)에 포커스
  useLayoutEffect(() => {
    if (!shown) return
    const menu = menuRef.current
    if (menu === null) return
    const items = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')]
    const back = backTo.current
    backTo.current = null
    const target =
      (back === null ? undefined : items.find((el) => el.dataset.label === back)) ??
      items.find((el) => el.getAttribute('aria-disabled') !== 'true' && el.dataset.testid !== 'adjust-back') ??
      items[0] ??
      menu
    target.focus()
  }, [shown, stageKey])

  // 그릴 때마다: 펼치는 쪽 공간(결과 칸 끝·화면 여백 16px까지)으로 폭을 줄이고, 높이가 바뀌어도(계산 끝·단계 교체) 열 방향을 다시 정하고,
  // 포커스한 항목이 사라졌으면(계산 중 항목) 첫 고를 수 있는 항목으로
  useLayoutEffect(() => {
    if (!shown) return
    const menu = menuRef.current
    const btn = btnRef.current
    if (menu === null || btn === null) return
    const b = btn.getBoundingClientRect()
    const box = btn.closest('.result-scroll')?.getBoundingClientRect()
    const room = anchor === 'end' ? b.right - Math.max(MENU_GUTTER, box?.left ?? 0) : Math.min(window.innerWidth - MENU_GUTTER, box?.right ?? Infinity) - b.left
    menu.style.maxWidth = `min(20rem, calc(100vw - 2rem), ${Math.floor(room)}px)`
    const below = Math.min(window.innerHeight, box?.bottom ?? Infinity) - b.bottom
    const above = b.top - Math.max(0, box?.top ?? 0)
    menu.classList.toggle('up', below < menu.offsetHeight + 6 && above > below)
    const active = document.activeElement
    if (active !== null && active !== document.body) return
    const items = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')]
    ;(items.find((el) => el.getAttribute('aria-disabled') !== 'true' && el.dataset.testid !== 'adjust-back') ?? items[0] ?? menu).focus()
  })

  useEffect(() => {
    if (!shown) return
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) {
        setOpen(false)
        setChosen(null)
      }
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [shown])

  /** 닫기만(포커스 그대로) */
  const dismiss = () => {
    setOpen(false)
    setChosen(null)
  }

  /** 닫고 버튼으로 포커스 */
  const close = () => {
    dismiss()
    btnRef.current?.focus()
  }

  const goBack = () => {
    backTo.current = chosen
    setChosen(null)
  }

  const toggle = () => {
    if (!enabled) return
    if (open) dismiss()
    else setOpen(true)
  }

  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const els = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]
    const active = document.activeElement as HTMLElement | null
    const at = active === null ? -1 : els.indexOf(active)
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close()
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      e.stopPropagation()
      const step = e.key === 'ArrowDown' ? 1 : -1
      const from = at < 0 && step < 0 ? 0 : at
      els[(from + step + els.length) % els.length]?.focus()
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault()
      e.stopPropagation()
      els[e.key === 'Home' ? 0 : els.length - 1]?.focus()
    } else if (e.key === 'ArrowLeft' && stage !== null) {
      e.preventDefault()
      goBack()
    } else if (e.key === 'ArrowRight' && stage === null && active?.dataset.label !== undefined) {
      e.preventDefault()
      active.click()
    } else if (e.key === 'Tab') {
      dismiss()
    }
  }

  const onBlur = (e: FocusEvent<HTMLDivElement>) => {
    if (e.relatedTarget !== null && !wrapRef.current?.contains(e.relatedTarget as Node)) dismiss()
  }

  const chooseResult = (i: number) => setChosen(list[i]?.label ?? null)

  return { open, shown, stage, wrapRef, btnRef, menuRef, close, dismiss, goBack, toggle, onMenuKey, onBlur, chooseResult }
}
