import type { Snapshot } from '../../data/schema'
import { ItemGlyph } from '../../ui/ItemGlyph'
import { itemGlyphOf, itemIconUrl, type ItemGlyphSpec } from '../../ui/images'
import { PokemonIcon } from './PokemonIcon'
import './monWithItem.css'

export type MonItemRole = 'variant' | 'mega' | 'held'

export interface MonWithItemProps {
  speciesId: string | undefined
  /** 상자 = 이미지 크기(px, 정사각) */
  size: number
  lazy?: boolean
  /** 그 줄·배지의 계산이 가정한 지닌 도구. 없으면 겹침 없음 */
  item?: { id: string; name: string; role: MonItemRole }
  /** 있으면 메가스톤 판정에 쓴다(held 역할의 메가스톤도 공통 메가스톤 표지가 된다) */
  game?: Snapshot
  className?: string
}

/** 겹침 너비 비율(PRD R13 범위 0.35~0.45) */
export const ITEM_OVERLAY_RATIO = 0.4

const itemOverlaySize = (size: number): number => Math.round(size * ITEM_OVERLAY_RATIO)

function glyphFor(item: NonNullable<MonWithItemProps['item']>, game: Snapshot | undefined): ItemGlyphSpec {
  if (item.role === 'mega') return { kind: 'mega' }
  if (game !== undefined) return itemGlyphOf(game, item.id)
  const url = itemIconUrl(item.id)
  return url === undefined ? { kind: 'bag' } : { kind: 'img', url }
}

/**
 * 포켓몬 이미지 + 오른쪽 아래 도구 겹침. 상자 크기는 이미지와 같아 줄 높이가 바뀌지 않는다. 상자와 겹침에 상호작용은 없다.
 * variant는 변형 줄 표지(testid berry-badge, 읽기 이름 "OO 지닌 경우")이고, mega·held는 장식(title만)이다.
 */
export function MonWithItem({ speciesId, size, lazy = false, item, game, className = '' }: MonWithItemProps) {
  const cls = `mon-with-item ${className}`.trim()
  if (item === undefined) {
    return (
      <span className={cls} style={{ width: size, height: size }} data-testid="mon-with-item">
        <PokemonIcon speciesId={speciesId} size={size} lazy={lazy} />
      </span>
    )
  }
  const glyph = glyphFor(item, game)
  const overlay = itemOverlaySize(size)
  const variant = item.role === 'variant'
  return (
    <span className={cls} style={{ width: size, height: size }} data-testid="mon-with-item">
      <PokemonIcon speciesId={speciesId} size={size} lazy={lazy} />
      <span
        className="mon-item"
        style={{ width: overlay, height: overlay }}
        title={item.name}
        aria-hidden={variant ? undefined : 'true'}
        data-testid={variant ? 'berry-badge' : undefined}
        data-item-id={item.id}
        data-item-role={item.role}
      >
        {glyph.kind === 'img' ? (
          <img
            className="mon-item-face item-icon"
            src={glyph.url}
            alt=""
            aria-hidden="true"
            loading={lazy ? 'lazy' : undefined}
            decoding="async"
            draggable={false}
            data-item-icon={item.id}
          />
        ) : (
          <ItemGlyph kind={glyph.kind} className="mon-item-face" />
        )}
        {variant && <span className="sr-only">{item.name} 지닌 경우</span>}
      </span>
    </span>
  )
}
