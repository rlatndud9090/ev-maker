import { Fragment, useEffect, useId, useLayoutEffect, useRef, type FocusEvent, type KeyboardEvent, type Ref } from 'react'
import type { AdjustAllocation, AdjustStat, AdjustView, PinEmptyReason, Tab } from '../../cards'
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
  PIN_RESULTS_TITLE,
  pinEmptyMenuText,
  pinEmptyText,
  pinResultsLabel,
} from './lockText'
import { Caret } from './Caret'
import { useFocusReturn } from './useFocusReturn'
import { useAdjustMenu } from './useAdjustMenu'
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
  view: Pick<AdjustView, 'state' | 'natures' | 'results'>
  /** adjust = 변동 팝오버, pin = 공·방 카드 핀(제목·빈 목록 문구·testid가 다르고 오른쪽으로 펼친다) */
  variant?: 'adjust' | 'pin'
  /** pin: 결과가 없을 때 끈 이유 중 SP 부족 최소 초과량(empty가 없을 때만 쓴다) */
  emptyOver?: number
  /** pin: 결과가 없을 때 핀 전체 이유(SP 부족 > 성격 충돌 > 일반) */
  empty?: PinEmptyReason
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
export function AdjustMenu({ subject, view, variant = 'adjust', emptyOver, empty: emptyReason, stage, menuRef, onKeyDown, onBlur, onChooseResult, onChooseNature, onBack }: AdjustMenuProps) {
  const pin = variant === 'pin'
  const result = stage === null ? undefined : view.results[stage]
  const common = {
    className: pin ? 'adjust-menu pin' : 'adjust-menu',
    role: 'menu',
    ref: menuRef,
    tabIndex: -1,
    onKeyDown,
    onBlur,
    'data-testid': pin ? 'cut-pin-menu' : 'adjust-menu',
  } as const
  if (result === undefined) {
    const empty = pin ? (emptyReason === undefined ? pinEmptyText(emptyOver) : pinEmptyMenuText(emptyReason)) : ADJUST_EMPTY_TEXT
    return (
      <div {...common} aria-label={pin ? pinResultsLabel(subject) : adjustResultsLabel(subject)} data-stage="result">
        <div className="adjust-title" role="none" aria-hidden="true">
          {pin ? PIN_RESULTS_TITLE : ADJUST_RESULTS_TITLE}
        </div>
        {view.state !== 'ready' || view.results.length === 0 ? (
          <button type="button" role="menuitem" className="adjust-item" aria-disabled="true" data-testid="adjust-result" data-enabled="false">
            {view.state === 'ready' ? empty : ADJUST_COMPUTING_TEXT}
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

interface Props {
  tab: Tab
  cardId: string
  /** 읽기 이름의 대상(상대 이름) */
  subject: string
  view: AdjustView
  /** 버튼 읽기 설명에 함께 붙일 요소 id(결과 배지·계산결과순 그룹 제목) */
  describedBy?: string
}

/**
 * 카드 줄 "변동" 버튼(펼침 화살표)과 2단 교체 팝오버. 결과를 고르면 같은 자리가 성격 선택으로 바뀌고, 고를 수 있는 선택지를 누르면 내 세트에 적용한다.
 * 키보드: ↑↓·Home/End 이동, Enter·Space 선택, 1단 → = 결과 고르기, 2단 ← = 뒤로, Esc = 닫고 버튼으로, Tab·바깥 누름 = 닫기.
 */
export function AdjustPopover({ tab, cardId, subject, view, describedBy }: Props) {
  const ui = useLockUi()
  const uid = useId()
  const uiRef = useRef(ui)
  useLayoutEffect(() => {
    uiRef.current = ui
  })
  const locked = view.state === 'locked'
  const { shown, stage, wrapRef, btnRef, menuRef, close, goBack, toggle, onMenuKey, onBlur, chooseResult } = useAdjustMenu({ results: view.results, enabled: !locked, anchor: 'end' })

  useEffect(() => {
    if (!shown) return
    uiRef.current.onAdjustCard(tab, cardId)
    return () => uiRef.current.onAdjustCard(tab, null)
  }, [shown, tab, cardId])

  // 적용 뒤 카드가 잠깐 빠졌다 다시 붙어도 이 버튼으로 포커스를 돌려준다
  const rememberFocusReturn = useFocusReturn(JSON.stringify([tab, cardId]), btnRef)

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
        onClick={toggle}
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
          onBlur={onBlur}
          onChooseResult={chooseResult}
          onChooseNature={(o, allocation) => {
            if (stage === null) return
            close()
            rememberFocusReturn()
            ui.applyAdjust(view, stage, o, allocation)
          }}
          onBack={goBack}
        />
      )}
    </span>
  )
}
