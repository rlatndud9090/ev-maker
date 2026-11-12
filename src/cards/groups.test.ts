import { describe, expect, it } from 'vitest'
import { addedBundleCardId } from './ids'
import { chosenOption, defaultOption, groupCards } from './groups'
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
