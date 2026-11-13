import { describe, expect, it } from 'vitest'
import { addedBundleCardId } from './ids'
import { chosenOption, defaultOption, groupCards, isPinned, pinOf } from './groups'
import type { CardView, PinnedBundle, PresetIndex } from './types'

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
    headline: { kind: 'updating' },
    variable: false,
    items: [],
    selected: false,
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

describe('groupCards: 사용자 추가 배분', () => {
  const user = (o: Parameters<typeof view>[0] & { added: number }): CardView => {
    const c = view(o)
    return { ...c, bundle: { ...c.bundle, share: undefined, userAdded: o.added } }
  }

  it('사용자 추가 배분이 맨 앞(추가 순), 그다음 점유율 내림차순, 소수 배분 맨 뒤', () => {
    const cards = [
      view({ id: 'lo', opp: 'x', share: 0.1 }),
      user({ id: 'u1', opp: 'x', added: 1 }),
      view({ id: 'm', opp: 'x', share: 0.004, minority: true }),
      view({ id: 'hi', opp: 'x', share: 0.5 }),
      user({ id: 'u0', opp: 'x', added: 0 }),
    ]
    const [grp] = groupCards(cards)
    expect(ids(grp.options)).toEqual(['u0', 'u1', 'hi', 'lo', 'm'])
  })

  it('기본 선택은 사용자 추가 배분이 아닌 첫 선택지(최고 점유율)', () => {
    const [grp] = groupCards([user({ id: 'u0', opp: 'x', added: 0 }), view({ id: 'lo', opp: 'x', share: 0.1 }), view({ id: 'hi', opp: 'x', share: 0.5 })])
    expect(grp.options[0].id).toBe('u0')
    expect(defaultOption(grp).id).toBe('hi')
    const [plain] = groupCards([view({ id: 'a', opp: 'y', share: 0.2 }), view({ id: 'b', opp: 'y', share: 0.3 })])
    expect(defaultOption(plain).id).toBe('b')
    const [onlyUser] = groupCards([user({ id: 'u', opp: 'z', added: 0 })])
    expect(defaultOption(onlyUser).id).toBe('u')
  })

  it('chosenOption: 있는 id는 그대로, 사라진 사용자 카드 id는 같은 SP의 무보정 관측 묶음으로, 그것도 없으면 기본', () => {
    const neutral = view({ id: 'obs', opp: 'x', share: 0.1 })
    const statsN = [
      { stat: 'hp' as const, sp: 31, nature: 'neutral' as const },
      { stat: 'def' as const, sp: 3, nature: 'neutral' as const },
    ]
    const obs: CardView = { ...neutral, bundle: { ...neutral.bundle, stats: statsN } }
    const plus: CardView = { ...obs, id: 'obs+', bundle: { ...obs.bundle, stats: [statsN[0], { ...statsN[1], nature: 'plus' }] } }
    const top = view({ id: 'top', opp: 'x', share: 0.6 })
    const [grp] = groupCards([top, plus, obs])
    const userId = addedBundleCardId({ tab: 'attack', opponentId: 'x', category: 'physical' }, statsN)
    expect(chosenOption(grp, 'attack', 'obs+').id).toBe('obs+')
    expect(chosenOption(grp, 'attack', undefined).id).toBe('top')
    expect(chosenOption(grp, 'attack', userId).id).toBe('obs')
    // 다른 탭의 id는 매칭되지 않는다 → 기본
    expect(chosenOption(grp, 'defense', userId).id).toBe('top')
    const [noMatch] = groupCards([top, plus])
    expect(chosenOption(noMatch, 'attack', userId).id).toBe('top')
  })
})

describe('groupCards: 고정 배분', () => {
  // view()의 묶음 키는 k{order}, 카드 분류는 physical
  const pin = (c: CardView, tab: 'attack' | 'defense' = 'attack'): PinnedBundle => pinOf(tab, c)
  const user = (o: Parameters<typeof view>[0] & { added: number }): CardView => {
    const c = view(o)
    return { ...c, bundle: { ...c.bundle, share: undefined, userAdded: o.added } }
  }

  it('고정 없으면 pinned 빈 목록, 순서는 그대로', () => {
    const [g] = groupCards([view({ id: 'lo', opp: 'x', share: 0.1 }), view({ id: 'hi', opp: 'x', share: 0.5 })], 'attack', [])
    expect(ids(g.options)).toEqual(['hi', 'lo'])
    expect(g.pinned).toEqual([])
  })

  it('고정(고정한 순) → 관측 점유율 내림차순 → 소수 배분. 직접 추가도 고정 목록 순서를 따른다', () => {
    const hi = view({ id: 'hi', opp: 'x', share: 0.5 })
    const mid = view({ id: 'mid', opp: 'x', share: 0.3 })
    const lo = view({ id: 'lo', opp: 'x', share: 0.1 })
    const minor = view({ id: 'minor', opp: 'x', share: 0.01, minority: true })
    const u0 = user({ id: 'u0', opp: 'x', added: 0 })
    // 고정 순: lo → u0 → minor
    const [g] = groupCards([hi, minor, u0, mid, lo], 'attack', [pin(lo), pin(u0), pin(minor)])
    expect(ids(g.options)).toEqual(['lo', 'u0', 'minor', 'hi', 'mid'])
    expect(g.pinned).toEqual(['lo', 'u0', 'minor'])
    expect(isPinned(g, lo)).toBe(true)
    expect(isPinned(g, hi)).toBe(false)
    // 기본 선택은 고정과 무관하게 관측 최고 점유율
    expect(defaultOption(g).id).toBe('hi')
    expect(chosenOption(g, 'attack', undefined).id).toBe('hi')
  })

  it('고정을 풀면 원래(점유율) 자리로 돌아간다', () => {
    const hi = view({ id: 'hi', opp: 'x', share: 0.5 })
    const lo = view({ id: 'lo', opp: 'x', share: 0.1 })
    const mid = view({ id: 'mid', opp: 'x', share: 0.3 })
    const cards = [hi, lo, mid]
    expect(ids(groupCards(cards, 'attack', [pin(lo)])[0].options)).toEqual(['lo', 'hi', 'mid'])
    expect(ids(groupCards(cards, 'attack', [])[0].options)).toEqual(['hi', 'mid', 'lo'])
  })

  it('다른 탭·분류·상대의 고정은 맞지 않고, 커스텀 카드는 고정되지 않는다', () => {
    const a = view({ id: 'a', opp: 'x', share: 0.5 })
    const b = view({ id: 'b', opp: 'x', share: 0.1 })
    const [g] = groupCards([a, b], 'attack', [pin(b, 'defense'), { ...pin(b), category: 'special' }, { ...pin(b), opponentId: 'y' }])
    expect(ids(g.options)).toEqual(['a', 'b'])
    expect(g.pinned).toEqual([])
    const c0 = view({ id: 'c0', opp: 'z', source: 'custom', preset: 0 })
    const c1 = view({ id: 'c1', opp: 'z', source: 'custom', preset: 1 })
    const [cg] = groupCards([c0, c1], 'attack', [pin(c1)])
    expect(ids(cg.options)).toEqual(['c0', 'c1'])
    expect(cg.pinned).toEqual([])
  })

  it('맞는 카드가 없는 고정(기준 변경으로 빠진 관측 배분)은 무시되고, 카드가 돌아오면 다시 고정한 순 맨 위', () => {
    const hi = view({ id: 'hi', opp: 'x', share: 0.5 })
    const mid = view({ id: 'mid', opp: 'x', share: 0.3 })
    const lo = view({ id: 'lo', opp: 'x', share: 0.1 })
    const pins = [pin(lo), pin(mid)]
    // lo가 최소 비중 아래로 빠진 기준
    const [away] = groupCards([hi, mid], 'attack', pins)
    expect(ids(away.options)).toEqual(['mid', 'hi'])
    expect(away.pinned).toEqual(['mid'])
    const [back] = groupCards([hi, mid, lo], 'attack', pins)
    expect(ids(back.options)).toEqual(['lo', 'mid', 'hi'])
    expect(back.pinned).toEqual(['lo', 'mid'])
  })

  it('고정 목록에 없는 직접 추가 배분도 고정으로 친다(고정 뒤, 추가 순)', () => {
    const hi = view({ id: 'hi', opp: 'x', share: 0.5 })
    const lo = view({ id: 'lo', opp: 'x', share: 0.1 })
    const u1 = user({ id: 'u1', opp: 'x', added: 1 })
    const u0 = user({ id: 'u0', opp: 'x', added: 0 })
    const [g] = groupCards([hi, u1, lo, u0], 'attack', [pin(lo)])
    expect(ids(g.options)).toEqual(['lo', 'u0', 'u1', 'hi'])
    expect(g.pinned).toEqual(['lo', 'u0', 'u1'])
    // 탭을 안 주면 고정 목록은 쓰지 않는다(직접 추가만 앞)
    expect(ids(groupCards([hi, u1, lo, u0])[0].options)).toEqual(['u0', 'u1', 'hi', 'lo'])
  })
})
