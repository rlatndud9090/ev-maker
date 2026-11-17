import { ItemGlyph } from '../../ui/ItemGlyph'
import { itemGlyphOf } from '../../ui/images'
import './itemMark.css'

export type ItemMarkRole = 'variant' | 'held'

export interface ItemMarkItem {
  id: string
  name: string
  role: ItemMarkRole
}

export interface ItemMarkProps {
  item: ItemMarkItem
  /** 한 변(px, 정사각). 기본 22 = 공격·방어 탭 이름 옆 도구 아이콘 크기 */
  size?: number
  lazy?: boolean
  className?: string
}

/** 이름 옆 도구 아이콘 기본 크기(px) */
export const ITEM_MARK_SIZE = 22

/**
 * 도구 아이콘 한 개(포켓몬 이미지와 겹치지 않고 이름·배분 글자 옆에 나란히 놓는다, 사용자 피드백 2026-11-16). 받침·상호작용 없음.
 * 판정 계산에 효과를 준 도구에만 쓴다(사용자 피드백 2026-11-17). variant는 변형 줄 표지(testid berry-badge, 읽기 이름 "OO 지닌 경우")이고, held는 장식(title만)이다.
 */
export function ItemMark({ item, size = ITEM_MARK_SIZE, lazy = false, className = '' }: ItemMarkProps) {
  const glyph = itemGlyphOf(item.id)
  const variant = item.role === 'variant'
  return (
    <span
      className={`item-mark ${className}`.trim()}
      style={{ width: size, height: size }}
      title={item.name}
      aria-hidden={variant ? undefined : 'true'}
      data-testid={variant ? 'berry-badge' : 'item-mark'}
      data-item-id={item.id}
      data-item-role={item.role}
    >
      {glyph.kind === 'img' ? (
        <img
          className="item-mark-face item-icon"
          src={glyph.url}
          alt=""
          aria-hidden="true"
          width={size}
          height={size}
          loading={lazy ? 'lazy' : undefined}
          decoding="async"
          draggable={false}
          data-item-icon={item.id}
        />
      ) : (
        <ItemGlyph kind={glyph.kind} className="item-mark-face" />
      )}
      {variant && <span className="sr-only">{item.name} 지닌 경우</span>}
    </span>
  )
}
