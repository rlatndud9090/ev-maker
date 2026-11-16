import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MC, cloneSnapshot } from '../../core/testing'
import { MEGA_MARK_URL, itemGlyphOf, itemIconUrl } from '../../ui/images'
import { MonWithItem } from './MonWithItem'

// vitest는 CSS 모듈 내용을 비우므로 원문을 직접 읽는다
const css = readFileSync(new URL('./monWithItem.css', import.meta.url), 'utf8')

const html = (el: React.ReactElement) => renderToStaticMarkup(el)
const mega = MC.data.megas[0]
const stoneName = MC.data.items[mega.stone]?.name.ko ?? mega.stone

describe('itemGlyphOf', () => {
  it('메가스톤은 PNG 조회보다 먼저 메가진화 문양', () => {
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

  it('겹침은 이미지 면적의 약 1/4(너비 0.45~0.55배), 상자 크기는 이미지 크기와 같다', () => {
    // 기대 겹침 한 변(px): 이미지 한 변의 절반 — 28→14, 32→16, 48→24, 64→32
    for (const [size, side] of [[28, 14], [32, 16], [48, 24], [64, 32]] as const) {
      const out = html(<MonWithItem speciesId="garchomp" size={size} item={{ id: 'colburberry', name: '바코열매', role: 'variant' }} />)
      expect(out, String(size)).toContain(`class="mon-with-item" style="width:${size}px;height:${size}px"`)
      expect(out, String(size)).toContain(`class="mon-item" style="width:${side}px;height:${side}px"`)
      const area = (side * side) / (size * size)
      expect(area, String(size)).toBeGreaterThanOrEqual(0.2)
      expect(area, String(size)).toBeLessThanOrEqual(0.3)
    }
    const out = html(<MonWithItem speciesId="garchomp" size={48} item={{ id: 'colburberry', name: '바코열매', role: 'variant' }} />)
    expect(out).toMatch(/<img[^>]*width="48"[^>]*height="48"[^>]*data-testid="mon-icon"/)
  })

  it('겹침에는 받침·테두리가 없다(도구 그림만 오른쪽 아래에 덮는다)', () => {
    const rule = /\.mon-item\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(rule).toMatch(/right:\s*0/)
    expect(rule).toMatch(/bottom:\s*0/)
    expect(rule).not.toMatch(/border|background|border-radius|padding/)
    expect(css).not.toMatch(/--mon-item-(plate|ring)/)
  })

  it('variant: 변형 표지 성질(testid·data-item-id·data-item-icon, title=도구 이름, 읽기 "OO 지닌 경우", 점유율 없음)', () => {
    const out = html(<MonWithItem speciesId="garchomp" size={32} game={MC} item={{ id: 'colburberry', name: '바코열매', role: 'variant' }} />)
    expect(out).toMatch(/<span class="mon-item"[^>]*title="바코열매"[^>]*data-testid="berry-badge"[^>]*data-item-id="colburberry"[^>]*data-item-role="variant"/)
    expect(out).toContain('data-item-icon="colburberry"')
    expect(out).toContain('<span class="sr-only">바코열매 지닌 경우</span>')
    expect(out).not.toMatch(/%/)
    expect(out).not.toMatch(/class="mon-item"[^>]*aria-hidden/)
  })

  it('mega: data-item-role=mega, 장식, title=종별 메가스톤 이름, 번들한 메가진화 문양(같은 출처 WebP, alt="")', () => {
    const out = html(<MonWithItem speciesId={mega.forme} size={32} item={{ id: mega.stone, name: stoneName, role: 'mega' }} />)
    expect(out).toMatch(new RegExp(`class="mon-item"[^>]*title="${stoneName}"[^>]*aria-hidden="true"[^>]*data-item-role="mega"`))
    expect(MEGA_MARK_URL).toMatch(/mega[^/]*\.webp$/)
    expect(MEGA_MARK_URL).not.toMatch(/^https?:/)
    expect(out).toMatch(/<img class="mon-item-face" src="[^"]*mega[^"]*\.webp" alt="" aria-hidden="true"[^>]*data-item-glyph="mega"/)
    expect(out).not.toContain('<svg')
    expect(out).not.toContain('berry-badge')
    expect(out).not.toContain('sr-only')
    expect(out).not.toContain('data-item-icon')
  })

  it('held: 장식 + title, 메가스톤이면 game으로 판정해 메가진화 문양, PNG 없으면 가방 표지', () => {
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
