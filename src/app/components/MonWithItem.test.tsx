import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MC, cloneSnapshot } from '../../core/testing'
import { itemGlyphOf, itemIconUrl } from '../../ui/images'
import { ITEM_OVERLAY_RATIO, MonWithItem } from './MonWithItem'

const itemOverlaySize = (size: number) => Math.round(size * ITEM_OVERLAY_RATIO)
const html = (el: React.ReactElement) => renderToStaticMarkup(el)
const mega = MC.data.megas[0]
const stoneName = MC.data.items[mega.stone]?.name.ko ?? mega.stone

describe('itemGlyphOf', () => {
  it('메가스톤은 PNG 조회보다 먼저 공통 메가스톤 표지', () => {
    expect(itemGlyphOf(MC, mega.stone)).toEqual({ kind: 'mega' })
  })

  it('메가스톤 판정은 스냅숏 megas의 stone이다(PNG가 있는 id라도 stone이면 mega)', () => {
    const g = cloneSnapshot(MC)
    g.data.megas = [...g.data.megas, { base: 'x', stone: 'colburberry', forme: 'xmega' }]
    expect(itemGlyphOf(g, 'colburberry')).toEqual({ kind: 'mega' })
    expect(itemGlyphOf(MC, 'colburberry')).toEqual({ kind: 'img', url: itemIconUrl('colburberry') })
  })

  it('받은 PNG가 없는 도구는 공통 가방 표지', () => {
    expect(itemGlyphOf(MC, 'notanitem')).toEqual({ kind: 'bag' })
  })
})

describe('MonWithItem', () => {
  it('도구가 없으면 겹침 없이 상자 안에 기존 PokemonIcon(testid·data-species-icon·클래스 유지)', () => {
    const out = html(<MonWithItem speciesId="garchomp" size={32} />)
    expect(out).toContain('style="width:32px;height:32px"')
    expect(out).toMatch(/<img class="mon-icon"[^>]*data-testid="mon-icon"[^>]*data-species-icon="garchomp"/)
    expect(out).not.toContain('mon-item"')
  })

  it('겹침 너비는 이미지의 0.35~0.45배, 상자 크기는 이미지 크기와 같다', () => {
    expect(ITEM_OVERLAY_RATIO).toBeGreaterThanOrEqual(0.35)
    expect(ITEM_OVERLAY_RATIO).toBeLessThanOrEqual(0.45)
    for (const size of [28, 32, 48, 64]) {
      const r = itemOverlaySize(size) / size
      expect(r, String(size)).toBeGreaterThanOrEqual(0.35)
      expect(r, String(size)).toBeLessThanOrEqual(0.45)
    }
    const out = html(<MonWithItem speciesId="garchomp" size={48} item={{ id: 'colburberry', name: '바코열매', role: 'variant' }} />)
    expect(out).toContain('class="mon-with-item" style="width:48px;height:48px"')
    expect(out).toContain(`class="mon-item" style="width:${itemOverlaySize(48)}px;height:${itemOverlaySize(48)}px"`)
    expect(out).toMatch(/<img[^>]*width="48"[^>]*height="48"[^>]*data-testid="mon-icon"/)
  })

  it('variant: 변형 표지 성질(testid·data-item-id·data-item-icon, title=도구 이름, 읽기 "OO 지닌 경우", 점유율 없음)', () => {
    const out = html(<MonWithItem speciesId="garchomp" size={32} game={MC} item={{ id: 'colburberry', name: '바코열매', role: 'variant' }} />)
    expect(out).toMatch(/<span class="mon-item"[^>]*title="바코열매"[^>]*data-testid="berry-badge"[^>]*data-item-id="colburberry"[^>]*data-item-role="variant"/)
    expect(out).toContain('data-item-icon="colburberry"')
    expect(out).toContain('<span class="sr-only">바코열매 지닌 경우</span>')
    expect(out).not.toMatch(/%/)
    expect(out).not.toMatch(/class="mon-item"[^>]*aria-hidden/)
  })

  it('mega: data-item-role=mega, 장식, title=종별 메가스톤 이름, 공통 메가스톤 표지(외부 요청 없음)', () => {
    const out = html(<MonWithItem speciesId={mega.forme} size={32} item={{ id: mega.stone, name: stoneName, role: 'mega' }} />)
    expect(out).toMatch(new RegExp(`class="mon-item"[^>]*title="${stoneName}"[^>]*aria-hidden="true"[^>]*data-item-role="mega"`))
    expect(out).toContain('data-item-glyph="mega"')
    expect(out).not.toContain('berry-badge')
    expect(out).not.toContain('sr-only')
    expect(out).not.toContain('data-item-icon')
  })

  it('held: 장식 + title, 메가스톤이면 game으로 판정해 공통 메가스톤 표지, PNG 없으면 가방 표지', () => {
    const stone = html(<MonWithItem speciesId="x" size={32} game={MC} item={{ id: mega.stone, name: stoneName, role: 'held' }} />)
    expect(stone).toMatch(/aria-hidden="true"[^>]*data-item-role="held"/)
    expect(stone).toContain('data-item-glyph="mega"')
    const bag = html(<MonWithItem speciesId="x" size={32} game={MC} item={{ id: 'notanitem', name: '무언가', role: 'held' }} />)
    expect(bag).toContain('title="무언가"')
    expect(bag).toContain('data-item-glyph="bag"')
    expect(bag).not.toContain('<img class="mon-item-face')
    const img = html(<MonWithItem speciesId="x" size={32} item={{ id: 'colburberry', name: '바코열매', role: 'held' }} />)
    expect(img).toContain('data-item-icon="colburberry"')
    expect(img).not.toContain('berry-badge')
  })

  it('상자와 겹침에는 상호작용 요소가 없다', () => {
    const out = html(<MonWithItem speciesId="garchomp" size={32} item={{ id: 'colburberry', name: '바코열매', role: 'variant' }} />)
    expect(out).not.toMatch(/<(button|a|input)\b|tabindex|onclick/i)
  })
})
