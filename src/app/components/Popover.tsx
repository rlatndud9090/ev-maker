import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
import { isOutOfView, placePopover, visibleArea, type Rect } from '../popoverPlacement'
import './popover.css'

/** popover.css의 하단 시트 구간과 같은 값 */
const SHEET_QUERY = '(max-width: 30rem)'
const GAP = 6
const MARGIN = 16
/** 바깥을 눌러 닫을 때 이 요소들을 눌렀으면 포커스를 앵커로 되돌리지 않는다(누른 곳이 포커스를 받는다) */
const INTERACTIVE = 'button, a[href], input, select, textarea, [role="combobox"], [role="option"], [role="tab"], [contenteditable="true"]'

/** 열린 팝오버(나중에 연 것이 끝). Esc는 맨 위 하나만 닫는다 */
const openStack: HTMLElement[] = []

interface Props {
  id: string
  /** 접근 이름: 보이는 제목 id(labelledBy) 또는 글자(label) */
  labelledBy?: string
  label?: string
  /** 팝오버를 붙일 요소(다시 그려져 바뀔 수 있어 매번 묻는다) */
  getAnchor: () => HTMLElement | null
  /** Esc·바깥 누름·앵커가 보이는 영역 밖으로 나감. 포커스 복귀는 팝오버가 한다 */
  onDismiss: () => void
  /** 앵커가 스크롤로 완전히 가려지면 닫는다 */
  closeWhenAnchorHidden?: boolean
  /** 이 선택자 안을 누르면 바깥 누름으로 보지 않는다(같은 종류 트리거끼리 전환) */
  ignoreOutside?: string
  className?: string
  children: ReactNode
}

/** 팝오버 안에서 높이를 줄여 맞출 수 있는 목록(자체 max-height로 스크롤하는 것) */
const FIT = '[data-popover-fit]'
/** 목록을 이보다 낮게 줄여야 하면 줄이지 않고 팝오버 하나만 스크롤한다(약 세 줄) */
const MIN_FIT = 72

/**
 * 스크롤 영역은 팝오버 안에 하나만: 넘치면 가장 높은 목록을 넘친 만큼 줄여(목록만 스크롤)
 * 버튼까지 보이게 하고, 그래도 안 되면 목록 스크롤을 풀어 팝오버만 스크롤한다.
 */
function fitInner(el: HTMLElement, fits: readonly HTMLElement[]) {
  const excess = el.scrollHeight - el.clientHeight
  if (excess <= 1) return
  const shown = fits.filter((f) => f.getClientRects().length > 0)
  if (shown.length === 0) return
  const target = shown.reduce((a, b) => (b.offsetHeight > a.offsetHeight ? b : a))
  const next = Math.floor(parseFloat(getComputedStyle(target).height) - excess)
  if (next >= MIN_FIT) {
    target.style.maxHeight = `${next}px`
    return
  }
  for (const f of shown) {
    f.style.maxHeight = 'none'
    f.style.overflowY = 'visible'
  }
}

function rectOf(el: Element): Rect {
  const r = el.getBoundingClientRect()
  return { top: r.top, left: r.left, bottom: r.bottom, right: r.right }
}

/** 앵커를 품은 스크롤 영역과 뷰포트가 함께 보이는 영역 */
function anchorClip(anchor: HTMLElement): Rect | null {
  const clips: Rect[] = [{ top: 0, left: 0, bottom: window.innerHeight, right: window.innerWidth }]
  for (let el = anchor.parentElement; el !== null && el !== document.body; el = el.parentElement) {
    const s = getComputedStyle(el)
    if (s.overflowY !== 'visible' || s.overflowX !== 'visible') clips.push(rectOf(el))
  }
  return visibleArea(clips)
}

/**
 * 앵커에 붙어 뜨는 비모달 팝오버(뒤 화면을 밀지 않고 겹친다). 좁은 화면에서는 하단 시트.
 * 자리 표시와 같은 DOM 위치에 고정 배치로 그려 Tab 순서는 트리거 바로 뒤로 이어진다.
 */
export function Popover({ id, labelledBy, label, getAnchor, onDismiss, closeWhenAnchorHidden = false, ignoreOutside, className, children }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const latest = useRef({ getAnchor, onDismiss, closeWhenAnchorHidden, ignoreOutside })
  useLayoutEffect(() => {
    latest.current = { getAnchor, onDismiss, closeWhenAnchorHidden, ignoreOutside }
  })

  // 자리 맞춤: 열 때·스크롤(차트 프레임 포함)·화면 크기·내용 크기가 바뀔 때
  useLayoutEffect(() => {
    const el = ref.current
    if (el === null) return
    const sheet = window.matchMedia(SHEET_QUERY)
    const update = () => {
      const anchor = latest.current.getAnchor()
      if (anchor === null) return
      // 자리와 목록 높이는 매번 CSS 기본 높이에서 다시 잰다(내용이 줄면 목록도 되돌린다)
      const fits = [...el.querySelectorAll<HTMLElement>(FIT)]
      for (const f of fits) {
        f.style.removeProperty('max-height')
        f.style.removeProperty('overflow-y')
      }
      if (sheet.matches) {
        el.dataset.placement = 'sheet'
        el.style.removeProperty('top')
        el.style.removeProperty('left')
        el.style.removeProperty('max-height')
      } else {
        const border = el.offsetHeight - el.clientHeight
        const p = placePopover(rectOf(anchor), { width: el.offsetWidth, height: el.scrollHeight + border }, { width: window.innerWidth, height: window.innerHeight }, { gap: GAP, margin: MARGIN })
        el.dataset.placement = p.side
        el.style.top = `${p.top}px`
        el.style.left = `${p.left}px`
        el.style.maxHeight = `${p.maxHeight}px`
      }
      fitInner(el, fits)
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    // 팝오버가 최대 높이에 묶여 있어도 내용(목록 열림·닫힘)이 바뀌면 다시 맞춘다
    for (const child of el.children) ro.observe(child)
    const anchor = latest.current.getAnchor()
    if (anchor !== null) ro.observe(anchor)
    // 가려짐은 스크롤로만 판정한다(연 직후 포커스 이동이 앵커를 스크롤해 들여오는 중일 수 있다)
    const onScroll = () => {
      const anchor = latest.current.getAnchor()
      if (anchor !== null && latest.current.closeWhenAnchorHidden && isOutOfView(rectOf(anchor), anchorClip(anchor))) latest.current.onDismiss()
      else update()
    }
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', update)
    sheet.addEventListener('change', update)
    return () => {
      ro.disconnect()
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', update)
      sheet.removeEventListener('change', update)
    }
  }, [])

  // Esc·바깥 누름으로 닫는다. 먼저 처리된 Esc(콤보 목록 닫기 등)는 건드리지 않는다
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const el = ref.current
      const t = e.target
      if (el === null || !(t instanceof Element)) return
      const anchor = latest.current.getAnchor()
      const sel = latest.current.ignoreOutside
      if (el.contains(t) || anchor?.contains(t) || (sel !== undefined && t.closest(sel) !== null)) return
      latest.current.onDismiss()
      // 누른 곳이 컨트롤이 아니면(빈 곳) 포커스는 트리거로. 브라우저의 누름 포커스 이동 뒤에 옮긴다
      if (anchor !== null && t.closest(INTERACTIVE) === null) setTimeout(() => anchor.focus({ preventScroll: true }), 0)
    }
    const self = ref.current
    if (self !== null) openStack.push(self)
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || openStack.at(-1) !== ref.current) return
      e.preventDefault()
      const el = ref.current
      const active = document.activeElement
      const anchor = latest.current.getAnchor()
      if (anchor !== null && (active === null || active === document.body || (el !== null && el.contains(active)))) anchor.focus({ preventScroll: true })
      latest.current.onDismiss()
    }
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('keydown', onKey)
    return () => {
      const i = self === null ? -1 : openStack.indexOf(self)
      if (i >= 0) openStack.splice(i, 1)
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  return (
    <div ref={ref} id={id} role="dialog" aria-labelledby={labelledBy} aria-label={label} className={className === undefined ? 'popover' : `popover ${className}`} data-testid="popover">
      {children}
    </div>
  )
}
