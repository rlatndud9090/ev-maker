/** 외부 자산 없는 공통 도구 표지(인라인 SVG, 이미지 요청 없음). 장식이라 접근 이름은 감싼 요소가 담는다. */
export type ItemGlyphKind = 'mega' | 'bag'

interface Props {
  kind: ItemGlyphKind
  className?: string
}

/** 공통 메가스톤 표지: 둥근 보석(게임 고유 문양은 쓰지 않는다) */
function MegaStone() {
  return (
    <>
      <circle cx="12" cy="12" r="10" fill="#8f6ad8" stroke="#3f2a73" strokeWidth="1.5" />
      <path d="M12 4.5 17.5 9.5 12 19.5 6.5 9.5Z" fill="#c9b6f2" stroke="#3f2a73" strokeWidth="1" strokeLinejoin="round" />
      <path d="M6.5 9.5h11M12 4.5 9.6 9.5 12 19.5 14.4 9.5Z" fill="none" stroke="#3f2a73" strokeWidth="0.8" strokeLinejoin="round" />
      <circle cx="8.2" cy="7.6" r="1.3" fill="#ffffff" opacity="0.85" />
    </>
  )
}

/** 공통 도구 표지: 가방 */
function Bag() {
  return (
    <>
      <path d="M8.5 8V6.5a3.5 3.5 0 0 1 7 0V8" fill="none" stroke="#5a3b1c" strokeWidth="1.8" strokeLinecap="round" />
      <rect x="4" y="8" width="16" height="12.5" rx="3" fill="#d9944a" stroke="#5a3b1c" strokeWidth="1.5" />
      <path d="M4.8 12.5h14.4" stroke="#5a3b1c" strokeWidth="1.2" />
      <rect x="10" y="11.2" width="4" height="3" rx="0.8" fill="#f6dfb8" stroke="#5a3b1c" strokeWidth="1" />
    </>
  )
}

export function ItemGlyph({ kind, className = '' }: Props) {
  return (
    <svg className={`item-glyph ${className}`.trim()} viewBox="0 0 24 24" aria-hidden="true" focusable="false" data-item-glyph={kind}>
      {kind === 'mega' ? <MegaStone /> : <Bag />}
    </svg>
  )
}
