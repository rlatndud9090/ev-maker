import { useEffect, useRef, type ReactNode } from 'react'

/**
 * 상대 목록 스크롤 박스. 위·아래로 더 스크롤할 내용이 있으면 data-shade-top/bottom을 켜
 * 가장자리 그림자를 보인다(React 상태 없이 DOM 속성만 갱신해 계산 중 리렌더를 늘리지 않는다).
 */
export function ResultBox({ children }: { children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null)
  const scroller = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const b = box.current
    const el = scroller.current
    if (!b || !el) return
    let frame = 0
    const update = () => {
      frame = 0
      const top = el.scrollTop > 1
      const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 1
      b.dataset.shadeTop = String(top)
      b.dataset.shadeBottom = String(bottom)
    }
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(update)
    }
    update()
    el.addEventListener('scroll', schedule, { passive: true })
    const ro = new ResizeObserver(schedule)
    ro.observe(el)
    for (const child of el.children) ro.observe(child)
    const mo = new MutationObserver(schedule)
    mo.observe(el, { childList: true, subtree: true })
    return () => {
      el.removeEventListener('scroll', schedule)
      ro.disconnect()
      mo.disconnect()
      if (frame !== 0) cancelAnimationFrame(frame)
    }
  }, [])

  return (
    <div ref={box} className="result-box" data-testid="result-box">
      <div ref={scroller} className="result-scroll" data-testid="result-scroll">
        {children}
      </div>
    </div>
  )
}
