// 공격·방어 카드의 간단행·펼친 상세 표기(R13 이름 옆 도구 아이콘, 열린 질문 13 상세 도구 이름)와 판정 행 표기(랭크 근거·SP 구간)를 실데이터 탭 뷰로 확인한다.
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { EXAMPLE_SET } from '../../cards/__fixtures__/acceptance'
import { buildTabView } from '../../cards/batch'
import { defaultOption, groupCards, groupItems } from '../../cards/groups'
import { cardInput, realData } from '../../cards/testing'
import { DEFAULT_CRITERIA } from '../../cards/types'
import type { CardGroup, CardView, DamageTab, RankBasis, RowView } from '../../cards'
import { categoryLabel, spanText, spansOf } from '../../ui/format'
import { namesOf } from '../../ui/names'
import { CardItem } from './CardItem'
import { RowDetail } from './RowDetail'
import { cardItemOf } from './text'

const { game } = realData()
const names = namesOf(game)
const noop = () => {}

const views = new Map<DamageTab, CardGroup[]>()
function groupsOf(tab: DamageTab): CardGroup[] {
  let g = views.get(tab)
  if (g === undefined) {
    const view = buildTabView(cardInput({ mySet: EXAMPLE_SET, criteria: { ...DEFAULT_CRITERIA, berryShareMin: 0.01 } }), tab)
    g = groupCards(view.cards, tab)
    views.set(tab, g)
  }
  return g
}

function cardHtml(tab: DamageTab, group: CardGroup, card: CardView = defaultOption(group), expanded = true): string {
  return renderToStaticMarkup(
    <CardItem
      game={game}
      tab={tab}
      group={group}
      card={card}
      rollSteps={14}
      expanded={expanded}
      onToggle={noop}
      onSelect={noop}
      dispatch={noop}
      items={groupItems(group)}
      onChooseItem={noop}
      onResetItem={noop}
      onMenuCards={noop}
    />,
  )
}

/** from 표지를 처음 만난 곳부터 to 표지 직전까지(정적 마크업 구간) */
function slice(html: string, from: string, to: string): string {
  const a = html.indexOf(from)
  if (a < 0) return ''
  const b = html.indexOf(to, a + from.length)
  return html.slice(a, b < 0 ? undefined : b)
}
/** 간단행 토글 버튼(이미지·이름 칸). 안에 버튼이 없다 */
const whoOf = (html: string) => slice(html, 'class="card-toggle card-who"', '</button>')
const detailOf = (html: string) => slice(html, 'class="card-detail"', '</li>')
const count = (html: string, s: string) => html.split(s).length - 1
const textOf = (html: string) => html.replace(/^[^<]*>/, '').replace(/<[^>]*>/g, '')
const attr = (tag: string, name: string) => new RegExp(`${name}="([^"]*)"`).exec(tag)?.[1]
const openTag = (html: string, marker: string) => {
  const i = html.indexOf(marker)
  return i < 0 ? '' : html.slice(html.lastIndexOf('<', i), html.indexOf('>', i) + 1)
}

const itemName = (id: string) => game.data.items[id]?.name.ko ?? id
const isMega = (g: CardGroup) => game.data.megas.some((m) => m.forme === g.opponent.id)

describe.each(['attack', 'defense'] as const)('%s 탭 카드 도구 아이콘(이름 오른쪽, R13)', (tab) => {
  it('변형 줄: 이름 오른쪽 도구 아이콘이 변형 표지이고 포켓몬 이미지와 겹치지 않는다. 상세에는 이미지·아이콘·도구 이름 글자가 나란히(점유율 없음)', () => {
    const group = groupsOf(tab).find((g) => g.berry !== undefined)
    expect(group, '변형 줄이 있는 실데이터').toBeDefined()
    const item = group!.berry!.item
    const html = cardHtml(tab, group!)
    expect(count(html, 'data-testid="berry-badge"')).toBe(1)
    const who = whoOf(html)
    // 버튼 안 순서: 포켓몬 이미지 → 이름 칸(이름 → 도구 아이콘)
    expect(who.indexOf('data-testid="mon-icon"')).toBeLessThan(who.indexOf('class="card-name"'))
    const name = slice(who, 'class="card-name"', '</button>')
    const badge = openTag(name, 'data-testid="berry-badge"')
    expect(attr(badge, 'class')).toBe('item-mark')
    expect(attr(badge, 'data-item-id')).toBe(item)
    expect(attr(badge, 'title')).toBe(itemName(item))
    expect(attr(badge, 'aria-hidden')).toBeUndefined()
    expect(attr(badge, 'style')).toBe('width:22px;height:22px')
    expect(name).toContain(`data-item-icon="${item}"`)
    expect(name).toContain(`<span class="sr-only">${itemName(item)} 지닌 경우</span>`)
    expect(name.indexOf(names.species.label(group!.opponent.id).replace(/\(.+\)$/, ''))).toBeLessThan(name.indexOf('data-testid="berry-badge"'))
    expect(who).not.toMatch(/mon-with-item|mon-item/)
    expect(textOf(who)).not.toMatch(/\d%/)
    const detail = detailOf(html)
    const head = slice(detail, 'data-testid="detail-item"', '</p>')
    expect(attr(openTag(detail, 'data-testid="detail-item"'), 'data-item-role')).toBe('variant')
    expect(head.indexOf('data-testid="mon-icon"')).toBeLessThan(head.indexOf('class="item-mark"'))
    expect(head).toContain(`<span class="detail-item-name">${itemName(item)} 지닌 경우</span>`)
    expect(textOf(head)).not.toMatch(/\d%/)
    // 상세 아이콘은 장식이라 읽기 이름·변형 testid가 간단행과 겹치지 않는다
    expect(attr(openTag(head, 'class="item-mark"'), 'aria-hidden')).toBe('true')
  })

  it('도구 없는 기본 줄: 도구 아이콘·상세 도구 머리가 없다', () => {
    const group = groupsOf(tab).find((g) => g.berry === undefined && !isMega(g))!
    const html = cardHtml(tab, group)
    expect(whoOf(html)).toContain('data-testid="mon-icon"')
    expect(html).not.toContain('class="item-mark"')
    expect(html).not.toContain('data-testid="detail-item"')
  })

  it('메가 기본 줄: 이름 오른쪽에 메가진화 문양이 장식으로 놓이고 변형 표지가 아니다', () => {
    const group = groupsOf(tab).find((g) => g.berry === undefined && isMega(g))
    expect(group, '메가 상대가 있는 실데이터').toBeDefined()
    const stone = game.data.megas.find((m) => m.forme === group!.opponent.id)!.stone
    const html = cardHtml(tab, group!)
    const name = slice(whoOf(html), 'class="card-name"', '</button>')
    const mark = openTag(name, 'class="item-mark"')
    expect(attr(mark, 'data-item-role')).toBe('mega')
    expect(attr(mark, 'aria-hidden')).toBe('true')
    expect(attr(mark, 'title')).toBe(itemName(stone))
    expect(name).toContain('data-item-glyph="mega"')
    expect(html).not.toContain('data-testid="berry-badge"')
    expect(detailOf(html)).toContain(`<span class="detail-item-name">${itemName(stone)}</span>`)
  })

  it('접힌 줄은 상세를 그리지 않고, 토글 버튼 읽기 순서는 이름 → "OO 지닌 경우"다', () => {
    const group = groupsOf(tab).find((g) => g.berry !== undefined)!
    const html = cardHtml(tab, group, defaultOption(group), false)
    expect(openTag(html, 'class="card-detail"')).toContain('hidden=""')
    expect(html).not.toContain('data-testid="detail-item"')
    const who = whoOf(html)
    const name = names.species.label(group.opponent.id)
    expect(textOf(who).startsWith(name)).toBe(true)
    expect(textOf(who)).toBe(`${name} ${itemName(group.berry!.item)} 지닌 경우`)
  })
})

describe('cardItemOf', () => {
  it('변형 도구가 메가보다 앞서고, 둘 다 아니면 없음', () => {
    const mega = game.data.megas[0]
    expect(cardItemOf(game, mega.forme, 'colburberry')).toEqual({ id: 'colburberry', name: itemName('colburberry'), role: 'variant' })
    expect(cardItemOf(game, mega.forme, undefined)).toEqual({ id: mega.stone, name: itemName(mega.stone), role: 'mega' })
    expect(cardItemOf(game, mega.base, undefined)).toBeUndefined()
  })
})

const rowHtml = (tab: DamageTab, row: RowView): string => renderToStaticMarkup(<RowDetail game={game} tab={tab} row={row} />)

describe('판정 행 표기(스피드 분기 제거 회귀)', () => {
  const rows = (tab: DamageTab) => groupsOf(tab).flatMap((g) => g.options.flatMap((o) => (o.pair === undefined ? o.rows : [])))

  it('랭크 행: 조건 식별은 수단, 기술 라벨에 랭크 부호, 행 종류·근거 글자·빗금 표지가 없다', () => {
    const base = rows('attack').find((r) => r.sweepStat !== undefined && r.cells.length > 0 && !r.noChange && r.refs?.offense?.owner === 'self')
    expect(base, '띠가 있는 공격 행').toBeDefined()
    const basis: RankBasis = { kind: 'rank', means: { kind: 'move', id: 'swordsdance' }, owner: 'me', share: 0.3, myBoosts: { [base!.refs!.offense!.stat]: 2 }, opponentBoosts: {}, reactions: [] }
    const row: RowView = { ...base!, kind: 'rank', basis }
    const html = rowHtml('attack', row)
    const li = openTag(html, 'data-testid="row"')
    expect(attr(li, 'data-row-kind')).toBe('rank')
    expect(attr(li, 'data-condition')?.replaceAll('&quot;', '"')).toBe(JSON.stringify(['me', 'move', 'swordsdance']))
    expect(textOf(slice(html, 'class="row-title"', '</strong>'))).toMatch(/(^| )\+2 \S/)
    expect(html).not.toMatch(/row-kind"|row-basis|cell[^"]* over|over-key|data-over-budget/)
    expect(textOf(html)).not.toMatch(/30\.0%|칼춤/)
  })

  it.each(['attack'] as const)('%s 탭 SP 구간: 칸 title·범례가 칸 범주 그대로이고 "필요" 문구가 없다', (tab) => {
    const row = rows(tab).find((r) => r.sweepStat !== undefined && r.cells.length > 0 && !r.noChange)
    expect(row, '띠가 있는 행').toBeDefined()
    const html = rowHtml(tab, row!)
    const titles = [...html.matchAll(/data-testid="band-cell"[^>]*title="([^"]*)"/g)].map((m) => m[1])
    expect(titles).toEqual(row!.cells.map((c) => `SP ${c.sp}: ${categoryLabel(c.category)}`))
    const legend = slice(html, 'class="band-legend"', '</p>')
    const spans = spansOf(row!.cells.map((c) => ({ ...c, overBudget: false })))
    expect(count(legend, '<span class="span">')).toBe(spans.length)
    for (const s of spans) expect(legend).toContain(spanText(s))
    expect(html).not.toContain('필요')
  })
})
