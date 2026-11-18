import { useCallback, useEffect, useRef, useState } from 'react'

/** 같은 글자를 다시 낼 때 비웠다가 채우는 간격(ms). 내용이 그대로인 live region은 스크린리더가 다시 읽지 않는다. */
const REANNOUNCE_MS = 50

/** 알림 영역 글자와 내기·지우기 */
export function useAnnounce(): [text: string, announce: (text: string) => void, clear: () => void] {
  const [text, setText] = useState('')
  const timer = useRef<number | undefined>(undefined)
  const current = useRef('')
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const announce = useCallback((next: string) => {
    window.clearTimeout(timer.current)
    if (next !== '' && next === current.current) {
      setText('')
      timer.current = window.setTimeout(() => setText(next), REANNOUNCE_MS)
    } else setText(next)
    current.current = next
  }, [])
  const clear = useCallback(() => {
    window.clearTimeout(timer.current)
    current.current = ''
    setText('')
  }, [])
  return [text, announce, clear]
}
