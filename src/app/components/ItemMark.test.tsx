import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MC, cloneSnapshot } from '../../core/testing'
import { MEGA_MARK_URL, itemGlyphOf, itemIconUrl } from '../../ui/images'
import { ItemMark } from './ItemMark'

// vitest는 CSS 모듈 내용을 비우므로 원문을 직접 읽는다
const css = readFileSync(new URL('./itemMark.css', import.meta.url), 'utf8')

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

describe('ItemMark', () => {
  it('포켓몬 이미지를 담지 않는 도구 아이콘 한 개이고, 기본 크기는 이름 옆 아이콘 크기(22px)다', () => {
    const out = html(<ItemMark item={{ id: 'colburberry', name: '바코열매', role: 'held' }} />)
    expect(out).toContain('<span class="item-mark" style="width:22px;height:22px"')
    expect(out).not.toContain('mon-icon')
    expect(out).toMatch(/<img class="item-mark-face item-icon"[^>]*width="22"[^>]*height="22"[^>]*data-item-icon="colburberry"/)
    const big = html(<ItemMark item={{ id: 'colburberry', name: '바코열매', role: 'held' }} size={28} />)
    expect(big).toContain('style="width:28px;height:28px"')
  })

  it('겹침 배치가 아니다(절대 위치·받침·테두리 없이 글자 흐름 안에 놓인다)', () => {
    const rule = /\.item-mark\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(rule).toMatch(/display:\s*inline-block/)
    expect(css).not.toMatch(/position:\s*absolute/)
    expect(rule).not.toMatch(/border|background|padding/)
  })

  it('variant: 변형 표지 성질(testid·data-item-id·data-item-icon, title=도구 이름, 읽기 "OO 지닌 경우", 점유율 없음)', () => {
    const out = html(<ItemMark game={MC} item={{ id: 'colburberry', name: '바코열매', role: 'variant' }} />)
    expect(out).toMatch(/<span class="item-mark"[^>]*title="바코열매"[^>]*data-testid="berry-badge"[^>]*data-item-id="colburberry"[^>]*data-item-role="variant"/)
    expect(out).toContain('data-item-icon="colburberry"')
    expect(out).toContain('<span class="sr-only">바코열매 지닌 경우</span>')
    expect(out).not.toMatch(/%/)
    expect(out).not.toMatch(/class="item-mark"[^>]*aria-hidden/)
  })

  it('mega: 장식, title=메가스톤 이름, 번들한 메가진화 문양(같은 출처 WebP, alt="")', () => {
    const out = html(<ItemMark item={{ id: mega.stone, name: stoneName, role: 'mega' }} />)
    expect(out).toMatch(new RegExp(`class="item-mark"[^>]*title="${stoneName}"[^>]*aria-hidden="true"[^>]*data-item-role="mega"`))
    expect(MEGA_MARK_URL).toMatch(/mega[^/]*\.webp$/)
    expect(MEGA_MARK_URL).not.toMatch(/^https?:/)
    expect(out).toMatch(/<img class="item-mark-face" src="[^"]*mega[^"]*\.webp" alt="" aria-hidden="true"[^>]*data-item-glyph="mega"/)
    expect(out).not.toContain('berry-badge')
    expect(out).not.toContain('sr-only')
    expect(out).not.toContain('data-item-icon')
  })

  it('held: 장식 + title, 메가스톤이면 game으로 판정해 메가진화 문양, PNG 없으면 가방 표지', () => {
    const stone = html(<ItemMark game={MC} item={{ id: mega.stone, name: stoneName, role: 'held' }} />)
    expect(stone).toMatch(/aria-hidden="true"[^>]*data-item-role="held"/)
    expect(stone).toContain('data-item-glyph="mega"')
    const bag = html(<ItemMark game={MC} item={{ id: 'notanitem', name: '무언가', role: 'held' }} />)
    expect(bag).toContain('title="무언가"')
    expect(bag).toContain('data-item-glyph="bag"')
    expect(bag).not.toContain('<img')
    const img = html(<ItemMark item={{ id: 'colburberry', name: '바코열매', role: 'held' }} />)
    expect(img).toContain('data-item-icon="colburberry"')
    expect(img).not.toContain('berry-badge')
  })

  it('상호작용 요소가 없다', () => {
    const out = html(<ItemMark item={{ id: 'colburberry', name: '바코열매', role: 'variant' }} />)
    expect(out).not.toMatch(/<(button|a|input)\b|tabindex|onclick/i)
  })
})
