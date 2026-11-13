/** 고를 수 있는 배지(배분·기술) 끝의 펼침 화살표. 글자(▾)는 작고 글꼴마다 위치가 흔들려 SVG로 그린다. */
export function Caret() {
  return (
    <svg className="bundle-caret" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false">
      <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
