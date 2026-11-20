import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { AdjustNature, AdjustOption, AdjustStat, AdjustView } from '../../cards'
import { AdjustMenu, AdjustPopover } from './AdjustPopover'

const noop = () => {}
const stat = (s: AdjustStat['stat'], sp: number, plus = false, locked = false): AdjustStat => ({ stat: s, sp, plus, locked })
const ok = (...stats: AdjustStat[]): AdjustOption => ({ kind: 'ok', stats })
const nature = (id: AdjustNature['id'], plus: AdjustNature['plus'], off?: 'no-branch'): AdjustNature => ({
  id,
  plus,
  nature: 'hardy',
  branchId: null,
  lockedSp: {},
  ...(off === undefined ? {} : { off }),
})

/** 공격: C 무보정/상승, 확정1타는 무보정만 닿고(상승은 예산 밖) 현재는 고난수1타 */
const attack: AdjustView = {
  state: 'ready',
  natures: [nature('neutral', null), nature('plus', 'spa')],
  results: [
    { label: 'guaranteed-ohko', current: false, lead: 0, options: [ok(stat('spa', 28)), { kind: 'off', reason: 'budget' }] },
    { label: 'high-roll-ohko', current: true, lead: 1, options: [{ kind: 'off', reason: 'unreachable' }, ok(stat('spa', 20, true), stat('spe', 29, false, true))] },
  ],
  keep: ['spa'],
  relevant: ['spa'],
}

/** 방어 3방향(D 고정 중 B 조정): H·D는 고정, 반대쪽 상승 갈래는 다른 고정과 겹침 */
const defense: AdjustView = {
  state: 'ready',
  natures: [nature('neutral', null), nature('plus', 'def'), nature('other-plus', 'spd', 'no-branch')],
  results: [
    {
      label: 'guaranteed-survive',
      current: false,
      lead: 0,
      options: [ok(stat('hp', 20, false, true), stat('def', 12), stat('spd', 16, false, true)), ok(stat('hp', 20, false, true), stat('def', 8, true), stat('spd', 16, false, true)), { kind: 'off', reason: 'no-branch' }],
    },
  ],
  keep: ['def'],
  relevant: ['hp', 'def', 'spd'],
}

const menu = (view: AdjustView, stage: number | null) =>
  renderToStaticMarkup(<AdjustMenu subject="한카리아스" view={view} stage={stage} onChooseResult={noop} onChooseNature={noop} onBack={noop} />)
const attr = (html: string, name: string) => new RegExp(` ${name}="([^"]*)"`).exec(html)?.[1]
/** 그 testid 버튼 하나하나(여는 태그부터 닫는 태그까지, 항목 안에 버튼은 없다) */
const items = (html: string, testId: string) => [...html.matchAll(new RegExp(`<button[^>]*data-testid="${testId}"[^>]*>.*?</button>`, 'g'))].map((m) => m[0])
const text = (html: string) => html.replace(/<[^>]+>/g, '')

describe('AdjustMenu 1단(결과 목록)', () => {
  it('결과 배지(카드 배지 색) + lead 선택지 SP + 현재 표지 + ›, 메뉴 이름은 대상', () => {
    const html = menu(attack, null)
    expect(attr(html, 'role')).toBe('menu')
    expect(attr(html, 'aria-label')).toBe('변동할 결과: 한카리아스')
    expect(attr(html, 'data-stage')).toBe('result')
    const [first, second] = items(html, 'adjust-result')
    expect(first).toContain('class="ko-badge ko-small ko-red"')
    expect(text(first)).toBe('확정1타C28›')
    expect(first).not.toContain('data-current')
    // lead = 상승 선택지: "+" 표기, 다른 고정의 바뀐 값은 자물쇠와 읽기 "고정"
    expect(second).toContain('data-current="true"')
    expect(text(second)).toBe('고난수1타C20+S29 고정›')
    expect(second).toContain('aria-current="true"')
    expect(second).toContain('class="adjust-sp adjust-sp-locked" data-locked="true"')
  })

  it('계산 중이면 고를 수 없는 "계산 중…" 항목 하나, 결과가 없으면 안내 항목 하나', () => {
    const computing = menu({ state: 'computing', natures: [], results: [], keep: [], relevant: [] }, null)
    expect(items(computing, 'adjust-result')).toHaveLength(1)
    expect(computing).toContain('aria-disabled="true"')
    expect(text(computing)).toContain('계산 중…')
    const empty = menu({ state: 'ready', natures: [], results: [], keep: [], relevant: [] }, null)
    expect(text(empty)).toContain('예산 안에서 닿는 결과 없음')
    expect(empty).toContain('aria-disabled="true"')
  })
})

describe('AdjustMenu 2단(성격 선택)', () => {
  it('머리줄 ‹ 뒤로 + 고른 결과 배지·SP, 선택지마다 이름·SP, 고를 수 없으면 비활성 + 짧은 이유', () => {
    const html = menu(attack, 0)
    expect(attr(html, 'data-stage')).toBe('nature')
    expect(attr(html, 'aria-label')).toBe('성격 선택: 확정1타 C 28')
    expect(text(items(html, 'adjust-back')[0]).startsWith('‹ 뒤로')).toBe(true)
    const [neutral, plus] = items(html, 'adjust-nature')
    expect(text(neutral)).toBe('무보정C28')
    expect(neutral).toContain('data-enabled="true"')
    expect(text(plus)).toBe('C 상승SP 부족')
    expect(plus).toContain('data-enabled="false"')
    expect(html.match(/role="menuitem" class="adjust-item adjust-nature" aria-disabled="true"/g)).toHaveLength(1)
  })

  it('닿지 않음 사유, 상승 선택지의 고정 값은 자물쇠', () => {
    const [neutral, plus] = items(menu(attack, 1), 'adjust-nature')
    expect(text(neutral)).toBe('무보정닿지 않음')
    expect(text(plus)).toBe('C 상승C20+S29 고정')
  })

  it('방어 3방향: 무보정/B 보정/D 보정, H·B·D를 모두 보이고 고정된 H·D는 자물쇠, 갈래 없음은 "고정과 겹침"', () => {
    const [neutral, plus, other] = items(menu(defense, 0), 'adjust-nature')
    expect(text(neutral)).toBe('무보정H20 고정B12D16 고정')
    expect(text(plus)).toBe('B 보정H20 고정B8+D16 고정')
    expect(plus.match(/data-locked="true"/g)).toHaveLength(2)
    expect(text(other)).toBe('D 보정고정과 겹침')
    expect(other).toContain('data-nature="other-plus"')
  })
})

/** 고정 없는 방어 쌍: 무보정은 합 최소 H4 B12 / H 최대 H20 B6, B 상승은 두 배분이 같아 하나 */
const pairView: AdjustView = {
  state: 'ready',
  natures: [nature('neutral', null), nature('plus', 'def')],
  results: [
    {
      label: 'low-roll-ohko',
      current: false,
      lead: 0,
      options: [{ kind: 'ok', stats: [stat('hp', 4), stat('def', 12)], hMax: [stat('hp', 20), stat('def', 6)] }, ok(stat('hp', 2), stat('def', 8, true))],
    },
  ],
  keep: ['hp', 'def'],
  relevant: ['hp', 'def'],
}

describe('AdjustMenu 2단 방어 쌍 배분', () => {
  it('H 최대가 있으면 그 선택지는 "합 최소", 바로 아래 "H 최대" 항목(읽기 이름에 성격 이름), 같으면 이름 없이 하나', () => {
    const html = menu(pairView, 0)
    const [neutral, plus] = items(html, 'adjust-nature')
    expect(text(neutral)).toBe('무보정합 최소H4B12')
    expect(neutral).toContain('data-alloc="min-sum"')
    const hMax = items(html, 'adjust-hmax')
    expect(hMax).toHaveLength(1)
    expect(text(hMax[0])).toBe('무보정 H 최대H20B6')
    expect(hMax[0]).toContain('role="menuitem"')
    expect(hMax[0]).toContain('data-nature="neutral"')
    expect(hMax[0]).toContain('data-alloc="h-max"')
    expect(text(plus)).toBe('B 상승H2B8+')
    expect(plus).not.toContain('data-alloc')
    // 순서: 무보정(합 최소) → 무보정 H 최대 → B 상승
    expect(html.indexOf(neutral)).toBeLessThan(html.indexOf(hMax[0]))
    expect(html.indexOf(hMax[0])).toBeLessThan(html.indexOf(plus))
  })

  it('누르면 그 선택지 index와 배분을 넘긴다', () => {
    const picked: [number, string][] = []
    const el = (
      <AdjustMenu subject="한카리아스" view={pairView} stage={0} onChooseResult={noop} onChooseNature={(o, a) => picked.push([o, a])} onBack={noop} />
    )
    const nodes = el.type(el.props) as { props: { children: unknown } }
    const buttons: { props: { onClick?: () => void; 'data-testid'?: string } }[] = []
    const walk = (n: unknown) => {
      if (Array.isArray(n)) n.forEach(walk)
      else if (n !== null && typeof n === 'object' && 'props' in n) {
        const node = n as { type: unknown; props: { children?: unknown; onClick?: () => void; 'data-testid'?: string } }
        if (node.type === 'button') buttons.push(node)
        walk(node.props.children)
      }
    }
    walk(nodes)
    for (const b of buttons.filter((x) => x.props['data-testid'] !== 'adjust-back')) b.props.onClick?.()
    expect(picked).toEqual([
      [0, 'min-sum'],
      [0, 'h-max'],
      [1, 'min-sum'],
    ])
  })
})

describe('AdjustPopover 버튼', () => {
  it('닫힌 버튼: 읽기 이름 "변동: 대상", 메뉴를 알린다', () => {
    const html = renderToStaticMarkup(<AdjustPopover tab="attack" cardId="c1" subject="한카리아스" view={attack} describedBy="r1" />)
    expect(attr(html, 'aria-label')).toBe('변동: 한카리아스')
    expect(attr(html, 'aria-haspopup')).toBe('menu')
    expect(attr(html, 'aria-expanded')).toBe('false')
    expect(attr(html, 'aria-describedby')).toBe('r1')
    expect(attr(html, 'aria-disabled')).toBeUndefined()
    expect(text(html)).toBe('변동')
  })

  it('변동할 능력치가 모두 고정이면 비활성 + 사유(툴팁·읽기 설명), 메뉴를 알리지 않는다', () => {
    const html = renderToStaticMarkup(<AdjustPopover tab="defense" cardId="c1" subject="한카리아스" view={{ state: 'locked', natures: [], results: [], keep: [], relevant: [] }} />)
    expect(attr(html, 'aria-disabled')).toBe('true')
    expect(attr(html, 'title')).toBe('고정된 능력치라 변동할 수 없음')
    expect(attr(html, 'aria-haspopup')).toBeUndefined()
    expect(attr(html, 'aria-expanded')).toBeUndefined()
    const note = attr(html, 'aria-describedby')
    expect(html).toContain(`<span id="${note}" class="sr-only">고정된 능력치라 변동할 수 없음</span>`)
  })
})
