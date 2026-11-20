import { Fragment, useEffect, useId, useLayoutEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type Ref } from 'react'
import type { AdjustAllocation, AdjustStat, AdjustView, Tab } from '../../cards'
import type { RollTier } from '../../core'
import { categoryBadge } from '../../ui/format'
import { useLockUi } from '../lockContext'
import {
  ADJUST_ALLOCATION_TEXT,
  ADJUST_BACK_TEXT,
  ADJUST_COMPUTING_TEXT,
  ADJUST_EMPTY_TEXT,
  ADJUST_LOCKED_STAT_TEXT,
  ADJUST_LOCKED_TEXT,
  ADJUST_NAME,
  ADJUST_NATURE_TITLE,
  ADJUST_RESULTS_TITLE,
  adjustLabel,
  adjustNatureName,
  adjustNaturesLabel,
  adjustOffText,
  adjustResultsLabel,
  adjustStatText,
  leadStats,
} from './lockText'
import { Caret } from './Caret'
import './adjust.css'

/** 자물쇠(고정 능력치 표지) */
function LockIcon() {
  return (
    <svg className="adjust-lock-icon" viewBox="0 0 12 12" width="10" height="10" aria-hidden="true" focusable="false">
      <rect x="2" y="5.2" width="8" height="5.6" rx="1.2" fill="currentColor" />
      <path d="M3.8 5.2V3.8a2.2 2.2 0 0 1 4.4 0v1.4" fill="none" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  )
}

/** 선택지 SP "H20 B12 [자물쇠]D16": 고정 능력치는 자물쇠 + 고정 색, 상승은 "+" */
function AdjustSps({ stats }: { stats: readonly AdjustStat[] }) {
  return (
    <span className="adjust-sps num" data-testid="adjust-sps">
      {stats.map((s) =>
        s.locked ? (
          <span key={s.stat} className="adjust-sp adjust-sp-locked" data-locked="true" title={ADJUST_LOCKED_STAT_TEXT}>
            <LockIcon />
            {adjustStatText(s)}
            <span className="sr-only"> {ADJUST_LOCKED_STAT_TEXT}</span>
          </span>
        ) : (
          <span key={s.stat} className="adjust-sp">
            {adjustStatText(s)}
          </span>
        ),
      )}
    </span>
  )
}

function ResultBadge({ label }: { label: RollTier }) {
  const badge = categoryBadge(label)
  return <span className={`ko-badge ko-small ko-${badge?.tone ?? 'gray'}`}>{badge?.label ?? label}</span>
}

export interface AdjustMenuProps {
  subject: string
  view: AdjustView
  /** 2단에서 고른 결과의 view.results index. null = 1단 */
  stage: number | null
  menuRef?: Ref<HTMLDivElement>
  onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void
  onBlur?: (e: FocusEvent<HTMLDivElement>) => void
  onChooseResult: (index: number) => void
  /** allocation = 그 선택지 안의 배분(H 최대가 없는 선택지는 늘 합 최소) */
  onChooseNature: (option: number, allocation: AdjustAllocation) => void
  onBack: () => void
}

/**
 * 팝오버 내용: 1단 결과 목록(role=menu) 또는 같은 자리의 2단 성격 선택(머리줄 "‹ 뒤로" + 고른 결과 배지·SP).
 * 방어 쌍 선택지에 H 최대 배분이 있으면 그 선택지 항목은 "합 최소"로, 바로 아래 들여쓴 "H 최대" 항목을 하나 더 둔다(PRD R23).
 */
export function AdjustMenu({ subject, view, stage, menuRef, onKeyDown, onBlur, onChooseResult, onChooseNature, onBack }: AdjustMenuProps) {
  const result = stage === null ? undefined : view.results[stage]
  const common = { className: 'adjust-menu', role: 'menu', ref: menuRef, tabIndex: -1, onKeyDown, onBlur, 'data-testid': 'adjust-menu' } as const
  if (result === undefined) {
    return (
      <div {...common} aria-label={adjustResultsLabel(subject)} data-stage="result">
        <div className="adjust-title" role="none" aria-hidden="true">
          {ADJUST_RESULTS_TITLE}
        </div>
        {view.state !== 'ready' || view.results.length === 0 ? (
          <button type="button" role="menuitem" className="adjust-item" aria-disabled="true" data-testid="adjust-result" data-enabled="false">
            {view.state === 'ready' ? ADJUST_EMPTY_TEXT : ADJUST_COMPUTING_TEXT}
          </button>
        ) : (
          view.results.map((r, i) => (
            <button
              key={r.label}
              type="button"
              role="menuitem"
              className="adjust-item"
              data-testid="adjust-result"
              data-label={r.label}
              data-current={r.current ? 'true' : undefined}
              aria-current={r.current ? 'true' : undefined}
              data-enabled="true"
              onClick={() => onChooseResult(i)}
            >
              <ResultBadge label={r.label} />
              <AdjustSps stats={leadStats(r)} />
              <span className="adjust-go" aria-hidden="true">
                ›
              </span>
            </button>
          ))
        )}
      </div>
    )
  }
  const lead = leadStats(result)
  const badgeLabel = categoryBadge(result.label)?.label ?? result.label
  return (
    <div {...common} aria-label={adjustNaturesLabel(badgeLabel, lead)} data-stage="nature" data-label={result.label}>
      <div className="adjust-head" role="none">
        <button type="button" role="menuitem" className="adjust-back" data-testid="adjust-back" onClick={onBack}>
          <span aria-hidden="true">‹</span> {ADJUST_BACK_TEXT}
        </button>
        <span className="adjust-head-result" aria-hidden="true">
          <ResultBadge label={result.label} />
          <AdjustSps stats={lead} />
        </span>
        <span className="adjust-head-title" aria-hidden="true">
          {ADJUST_NATURE_TITLE}
        </span>
      </div>
      {view.natures.map((n, i) => {
        const o = result.options[i]
        const ok = o?.kind === 'ok'
        const name = adjustNatureName(view.natures, n)
        const hMax = o?.kind === 'ok' ? o.hMax : undefined
        return (
          <Fragment key={n.id}>
            <button
              type="button"
              role="menuitem"
              className="adjust-item adjust-nature"
              aria-disabled={ok ? undefined : 'true'}
              data-testid="adjust-nature"
              data-nature={n.id}
              data-alloc={hMax === undefined ? undefined : 'min-sum'}
              data-enabled={ok ? 'true' : 'false'}
              onClick={() => {
                if (ok) onChooseNature(i, 'min-sum')
              }}
            >
              <span className="adjust-nature-name">{name}</span>
              {hMax !== undefined && <span className="adjust-alloc">{ADJUST_ALLOCATION_TEXT['min-sum']}</span>}
              {o?.kind === 'ok' ? <AdjustSps stats={o.stats} /> : o !== undefined && <span className="adjust-why">{adjustOffText(o)}</span>}
            </button>
            {hMax !== undefined && (
              <button
                type="button"
                role="menuitem"
                className="adjust-item adjust-nature adjust-hmax"
                data-testid="adjust-hmax"
                data-nature={n.id}
                data-alloc="h-max"
                data-enabled="true"
                onClick={() => onChooseNature(i, 'h-max')}
              >
                <span className="adjust-nature-pad" aria-hidden="true" />
                <span className="sr-only">{name} </span>
                <span className="adjust-alloc">{ADJUST_ALLOCATION_TEXT['h-max']}</span>
                <AdjustSps stats={hMax} />
              </button>
            )}
          </Fragment>
        )
      })}
    </div>
  )
}

/**
 * 적용 뒤 재계산 중 카드가 잠깐 목록에서 빠졌다 다시 붙으면(새 요소) 그 카드 변동 버튼으로 포커스를 돌려주려고 (탭, 카드 id)를 기억한다.
 * 그동안 포커스는 탭 패널에 맡긴다. 다른 곳에 포커스·누름이 가면 잊는다.
 */
let focusReturn: string | null = null
function rememberFocusReturn(key: string) {
  focusReturn = key
  const forget = (e: Event) => {
    if (e.type === 'focusin' && e.target instanceof Element && e.target.matches('[role="tabpanel"]')) return
    if (focusReturn === key) focusReturn = null
    document.removeEventListener('focusin', forget, true)
    document.removeEventListener('pointerdown', forget, true)
  }
  document.addEventListener('focusin', forget, true)
  document.addEventListener('pointerdown', forget, true)
}

interface Props {
  tab: Tab
  cardId: string
  /** 읽기 이름의 대상(상대 이름) */
  subject: string
  view: AdjustView
  /** 버튼 읽기 설명에 함께 붙일 요소 id(결과 배지·계산결과순 그룹 제목) */
  describedBy?: string
}

/** 팝오버가 왼쪽으로 넘지 않는 화면 여백(px, 본문 좌우 여백과 같다) */
const MENU_GUTTER = 16

/**
 * 카드 줄 "변동" 버튼(펼침 화살표)과 2단 교체 팝오버. 결과를 고르면 같은 자리가 성격 선택으로 바뀌고, 고를 수 있는 선택지를 누르면 내 세트에 적용한다.
 * 키보드: ↑↓·Home/End 이동, Enter·Space 선택, 1단 → = 결과 고르기, 2단 ← = 뒤로, Esc = 닫고 버튼으로, Tab·바깥 누름 = 닫기.
 */
export function AdjustPopover({ tab, cardId, subject, view, describedBy }: Props) {
  const ui = useLockUi()
  const [open, setOpen] = useState(false)
  const [chosen, setChosen] = useState<RollTier | null>(null)
  const wrapRef = useRef<HTMLSpanElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const uid = useId()
  const uiRef = useRef(ui)
  useLayoutEffect(() => {
    uiRef.current = ui
  })
  const locked = view.state === 'locked'
  const shown = open && !locked
  const found = chosen === null ? -1 : view.results.findIndex((r) => r.label === chosen)
  // 고른 결과가 다시 계산된 목록에서 사라지면 1단으로 돌아간다
  if (chosen !== null && found < 0) setChosen(null)
  const stage = found < 0 ? null : found
  const stageKey = stage === null ? null : chosen
  /** 1단으로 돌아갈 때 포커스할 결과 */
  const backTo = useRef<RollTier | null>(null)

  useEffect(() => {
    if (!shown) return
    uiRef.current.onAdjustCard(tab, cardId)
    return () => uiRef.current.onAdjustCard(tab, null)
  }, [shown, tab, cardId])

  // 단계가 바뀔 때마다: 아래 공간이 모자라고 위가 넓으면 위로 열고, 첫 고를 수 있는 항목(뒤로 왔으면 고른 결과)에 포커스
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

  // 그릴 때마다: 버튼 오른쪽 끝에서 왼쪽으로 펼치므로 폭을 버튼 왼쪽 공간(결과 칸 왼쪽 끝·화면 여백 16px까지)으로 줄이고,
  // 높이가 바뀌어도(계산 끝·단계 교체) 열 방향을 다시 정하고, 포커스한 항목이 사라졌으면(계산 중 항목) 첫 고를 수 있는 항목으로
  useLayoutEffect(() => {
    if (!shown) return
    const menu = menuRef.current
    const btn = btnRef.current
    if (menu === null || btn === null) return
    const b = btn.getBoundingClientRect()
    const box = btn.closest('.result-scroll')?.getBoundingClientRect()
    const room = b.right - Math.max(MENU_GUTTER, box?.left ?? 0)
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

  const returnKey = JSON.stringify([tab, cardId])
  // 적용한 카드가 다시 붙었고 포커스가 갈 곳을 잃었으면(본문·탭 패널) 이 버튼으로 돌려준다
  useEffect(() => {
    const active = document.activeElement
    if (focusReturn !== returnKey || (active !== null && active !== document.body && !active.matches('[role="tabpanel"]'))) return
    focusReturn = null
    btnRef.current?.focus()
  }, [returnKey])

  // 이 버튼에 포커스가 있는 채로 없어지면(카드가 잠깐 빠짐·더는 변동 대상이 아님) 포커스를 탭 패널로 돌린다
  useLayoutEffect(() => {
    const btn = btnRef.current
    return () => {
      if (btn === null || document.activeElement !== btn) return
      const panel = btn.closest<HTMLElement>('[role="tabpanel"]')
      requestAnimationFrame(() => {
        const active = document.activeElement
        if (active === null || active === document.body) panel?.focus()
      })
    }
  }, [])

  const close = () => {
    setOpen(false)
    setChosen(null)
    btnRef.current?.focus()
  }

  const goBack = () => {
    backTo.current = chosen
    setChosen(null)
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
      setOpen(false)
      setChosen(null)
    }
  }

  const noteId = `${uid}-locked`
  const described = [...(describedBy === undefined ? [] : [describedBy]), ...(locked ? [noteId] : [])].join(' ')
  return (
    <span className="adjust-wrap" ref={wrapRef}>
      <button
        type="button"
        ref={btnRef}
        className="adjust-btn"
        aria-label={adjustLabel(subject)}
        aria-haspopup={locked ? undefined : 'menu'}
        aria-expanded={locked ? undefined : shown}
        aria-disabled={locked ? 'true' : undefined}
        aria-describedby={described === '' ? undefined : described}
        title={locked ? ADJUST_LOCKED_TEXT : undefined}
        data-testid="adjust-button"
        data-state={view.state}
        onClick={() => {
          if (locked) return
          if (open) {
            setOpen(false)
            setChosen(null)
          } else setOpen(true)
        }}
      >
        {ADJUST_NAME}
        <Caret />
      </button>
      {locked && (
        <span id={noteId} className="sr-only">
          {ADJUST_LOCKED_TEXT}
        </span>
      )}
      {shown && (
        <AdjustMenu
          subject={subject}
          view={view}
          stage={stage}
          menuRef={menuRef}
          onKeyDown={onMenuKey}
          onBlur={(e) => {
            if (e.relatedTarget !== null && !wrapRef.current?.contains(e.relatedTarget as Node)) {
              setOpen(false)
              setChosen(null)
            }
          }}
          onChooseResult={(i) => setChosen(view.results[i]?.label ?? null)}
          onChooseNature={(o, allocation) => {
            if (stage === null) return
            close()
            rememberFocusReturn(returnKey)
            ui.applyAdjust(view, stage, o, allocation)
          }}
          onBack={goBack}
        />
      )}
    </span>
  )
}
