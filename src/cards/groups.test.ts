import { describe, expect, it } from 'vitest'
import { groupCards } from './groups'
import type { CardView, PresetIndex } from './types'

let seq = 0
function view(opts: {
  id?: string
  opp: string
  source?: 'ladder' | 'custom'
  share?: number
  minority?: boolean
  preset?: PresetIndex
  order?: number
}): CardView {
  const source = opts.source ?? 'ladder'
  const order = opts.order ?? seq++
  return {
    id: opts.id ?? `c${order}`,
    order,
    state: 'ok',
    notices: [],
    opponent: { id: opts.opp, source },
    category: 'physical',
    bundle: {
      key: `k${order}`,
      stats: [],
      share: opts.share,
      minority: opts.minority ?? false,
      presetIndex: opts.preset,
    },
    rows: [],
    hiddenNoChangeRows: 0,
    headline: { kind: 'updating' },
    moreRows: 0,
  }
}
const ids = (cards: readonly CardView[]) => cards.map((c) => c.id)

describe('groupCards', () => {
  it('빈 입력은 빈 목록', () => {
    expect(groupCards([])).toEqual([])
  })

  it('그룹 순서는 입력에서 처음 나온 순서이고 키는 [출처, id]', () => {
    const groups = groupCards([view({ opp: 'b', id: 'b1' }), view({ opp: 'a', id: 'a1' }), view({ opp: 'b', id: 'b2' })])
    expect(groups.map((g) => g.key)).toEqual([JSON.stringify(['ladder', 'b']), JSON.stringify(['ladder', 'a'])])
    expect(groups.map((g) => g.opponent.id)).toEqual(['b', 'a'])
  })

  it('래더는 점유율 내림차순, 소수 배분은 뒤, 동률은 원래 순서', () => {
    const groups = groupCards([
      view({ opp: 'x', id: 'minor', minority: true, share: 0.9, order: 0 }),
      view({ opp: 'x', id: 'low', share: 0.1, order: 1 }),
      view({ opp: 'x', id: 'tieA', share: 0.3, order: 2 }),
      view({ opp: 'x', id: 'high', share: 0.5, order: 3 }),
      view({ opp: 'x', id: 'tieB', share: 0.3, order: 4 }),
    ])
    expect(groups).toHaveLength(1)
    expect(ids(groups[0].options)).toEqual(['high', 'tieA', 'tieB', 'low', 'minor'])
  })

  it('다른 분류 카드도 같은 포켓몬이면 한 그룹', () => {
    const a = view({ opp: 'x', id: 'phys', share: 0.4 })
    const b = { ...view({ opp: 'x', id: 'spec', share: 0.6 }), category: 'special' as const }
    expect(ids(groupCards([a, b])[0].options)).toEqual(['spec', 'phys'])
  })

  it('커스텀은 프리셋 순, 동률은 원래 순서', () => {
    const groups = groupCards([
      view({ opp: 'x', source: 'custom', id: 'p2', preset: 2, order: 0 }),
      view({ opp: 'x', source: 'custom', id: 'p0b', preset: 0, order: 2 }),
      view({ opp: 'x', source: 'custom', id: 'p0a', preset: 0, order: 1 }),
      view({ opp: 'x', source: 'custom', id: 'p1', preset: 1, order: 3 }),
    ])
    expect(ids(groups[0].options)).toEqual(['p0a', 'p0b', 'p1', 'p2'])
  })

  it('래더와 커스텀의 같은 id는 다른 그룹', () => {
    const groups = groupCards([view({ opp: 'x', id: 'l' }), view({ opp: 'x', source: 'custom', id: 'c', preset: 0 })])
    expect(groups.map((g) => ids(g.options))).toEqual([['l'], ['c']])
  })
})
