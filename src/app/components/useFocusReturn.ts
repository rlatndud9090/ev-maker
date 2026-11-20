import { useEffect, useLayoutEffect, type RefObject } from 'react'

/**
 * 고른 뒤 재계산 중 카드가 잠깐 목록에서 빠졌다 다시 붙으면(새 요소) 그 버튼으로 포커스를 돌려주려고 기억한 키.
 * 그동안 포커스는 탭 패널에 맡긴다. 다른 곳에 포커스·누름이 가면 잊는다. 변동 버튼·카드 핀이 함께 쓴다(키로 구분).
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

/**
 * 메뉴에서 고른 뒤 버튼 포커스 지키기. 반환 함수를 고른 직후(닫고 버튼에 포커스한 뒤) 부른다.
 * - 버튼에 포커스가 있는 채로 버튼이 없어지면 포커스를 탭 패널로 돌린다.
 * - 같은 returnKey 버튼이 다시 붙었고 포커스가 갈 곳을 잃었으면(본문·탭 패널) 그 버튼으로 돌려준다.
 */
export function useFocusReturn(returnKey: string, btnRef: RefObject<HTMLButtonElement | null>): () => void {
  useEffect(() => {
    const active = document.activeElement
    if (focusReturn !== returnKey || (active !== null && active !== document.body && !active.matches('[role="tabpanel"]'))) return
    focusReturn = null
    btnRef.current?.focus()
  }, [returnKey, btnRef])

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
  }, [btnRef])

  return () => rememberFocusReturn(returnKey)
}
