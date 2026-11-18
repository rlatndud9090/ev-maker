/** 외부 자산 없는 공통 도구 표지(인라인 SVG, 이미지 요청 없음). 장식이라 접근 이름은 감싼 요소가 담는다. */
export type ItemGlyphKind = 'bag'

interface Props {
  kind: ItemGlyphKind
  className?: string
}

/** 공통 도구 표지: 가방(받은 아이콘이 없는 도구) */
export function ItemGlyph({ kind, className = '' }: Props) {
  return (
    <svg className={`item-glyph ${className}`.trim()} viewBox="0 0 24 24" aria-hidden="true" focusable="false" data-item-glyph={kind}>
      <path d="M8.5 8V6.5a3.5 3.5 0 0 1 7 0V8" fill="none" stroke="#5a3b1c" strokeWidth="1.8" strokeLinecap="round" />
      <rect x="4" y="8" width="16" height="12.5" rx="3" fill="#d9944a" stroke="#5a3b1c" strokeWidth="1.5" />
      <path d="M4.8 12.5h14.4" stroke="#5a3b1c" strokeWidth="1.2" />
      <rect x="10" y="11.2" width="4" height="3" rx="0.8" fill="#f6dfb8" stroke="#5a3b1c" strokeWidth="1" />
    </svg>
  )
}
