import type { Snapshot } from '../../data/schema'
import { ItemGlyph } from '../../ui/ItemGlyph'
import { MEGA_MARK_URL, itemGlyphOf, itemIconUrl, type ItemGlyphSpec } from '../../ui/images'
import './itemMark.css'

export type ItemMarkRole = 'variant' | 'mega' | 'held'

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
  /** 있으면 메가스톤 판정에 쓴다(held 역할의 메가스톤도 메가진화 문양이 된다) */
  game?: Snapshot
  className?: string
}

/** 이름 옆 도구 아이콘 기본 크기(px) */
export const ITEM_MARK_SIZE = 22

function glyphFor(item: ItemMarkItem, game: Snapshot | undefined): ItemGlyphSpec {
  if (item.role === 'mega') return { kind: 'mega' }
  if (game !== undefined) return itemGlyphOf(game, item.id)
  const url = itemIconUrl(item.id)
  return url === undefined ? { kind: 'bag' } : { kind: 'img', url }
}

/**
 * 도구 아이콘 한 개(포켓몬 이미지와 겹치지 않고 이름·배분 글자 옆에 나란히 놓는다, 사용자 피드백 2026-11-16). 받침·상호작용 없음.
 * variant는 변형 줄 표지(testid berry-badge, 읽기 이름 "OO 지닌 경우")이고, mega·held는 장식(title만)이다.
 */
export function ItemMark({ item, size = ITEM_MARK_SIZE, lazy = false, game, className = '' }: ItemMarkProps) {
  const glyph = glyphFor(item, game)
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
      ) : glyph.kind === 'mega' ? (
        <img className="item-mark-face" src={MEGA_MARK_URL} alt="" aria-hidden="true" width={size} height={size} decoding="async" draggable={false} data-item-glyph="mega" />
      ) : (
        <ItemGlyph kind={glyph.kind} className="item-mark-face" />
      )}
      {variant && <span className="sr-only">{item.name} 지닌 경우</span>}
    </span>
  )
}
