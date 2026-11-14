import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  /**
   * 재계산 중(이전 세대 뷰 표시·새 세대 미완료). 그동안 목록 높이를 줄이지 않는다: 기본 항목이 정해지기 전 카드를 숨기는 동안
   * 목록이 잠깐 짧아지면 브라우저가 scrollTop을 줄여(클램프) 끝나도 맨 위 근처로 돌아가 있다.
   */
  hold: boolean
  /** 바뀌면(탭 전환) 붙잡은 높이를 버린다: 다른 목록 높이를 이어받지 않는다 */
  holdKey: string
}

/**
 * 상대 목록 스크롤 박스. 위·아래로 더 스크롤할 내용이 있으면 data-shade-top/bottom을 켜
 * 가장자리 그림자를 보인다(React 상태 없이 DOM 속성만 갱신해 계산 중 리렌더를 늘리지 않는다).
 */
export function ResultBox({ children, hold, holdKey }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const held = useRef({ key: holdKey, height: 0 })

  // 매 커밋 직후(그리기 전): 재계산 중이면 내용 최소 높이를 지금까지 본 최대 높이로 둔다. 재계산이 시작되는 커밋은 아직 이전
  // 뷰(전체 목록)라 그 높이를 잡고, 이후 짧아지는 커밋에서도 최소 높이가 이미 걸려 있어 scrollTop이 줄지 않는다. 끝나면 푼다.
  // 스크롤 앵커링도 끈다: 위쪽 카드가 숨었다 다시 생길 때 브라우저가 앵커 노드를 따라 scrollTop을 옮긴다.
  useLayoutEffect(() => {
    const el = scroller.current
    const content = el?.firstElementChild
    if (!el || !(content instanceof HTMLElement)) return
    if (held.current.key !== holdKey || !hold) {
      held.current = { key: holdKey, height: 0 }
      content.style.minHeight = ''
      el.style.overflowAnchor = ''
    }
    if (!hold) return
    el.style.overflowAnchor = 'none'
    const height = Math.max(held.current.height, content.offsetHeight)
    held.current.height = height
    content.style.minHeight = `${height}px`
  })

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
