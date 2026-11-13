import { describe, expect, it } from 'vitest'
import type { PokemonSet } from '../core'
import { loadSnapshotSync } from '../data/testing'
import { buildTabView } from './batch'
import { groupCards } from './groups'
import { BASE_CONDITION_ID, itemKey } from './items'
import { planTab } from './plan'
import { POWER_ITEMS, TYPE_BOOST_ITEMS, powerItemBoosts, powerItemsOf } from './powerItems'
import { opponentKey } from './schedule'
import { cardInput, realData } from './testing'
import { DEFAULT_CRITERIA, type CardView } from './types'

const { game, bo1 } = realData()
const ZERO = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }
/** 맞는 쪽(나): 한카리아스 무보정 무도구 */
const GARCHOMP: PokemonSet = {
  regulation: 'm-c',
  species: 'garchomp',
  ability: 'roughskin',
  nature: 'serious',
  sp: { ...ZERO, hp: 2, atk: 32, spe: 32 },
  moves: ['earthquake', 'dragonclaw'],
}
const me = { types: ['Dragon', 'Ground'], ability: 'roughskin' }
const plain = { types: ['Normal'], ability: 'pressure' }
const KINGAMBIT_KEY = JSON.stringify(['ladder', 'kingambit'])
const input = (powerItemShareMin = DEFAULT_CRITERIA.powerItemShareMin) =>
  cardInput({ mySet: GARCHOMP, filters: { topN: 30, selected: ['kingambit'] }, criteria: { ...DEFAULT_CRITERIA, powerItemShareMin } })
const shownMove = (c: CardView): string | undefined => c.items.find((i) => i.key === c.shownItem)?.moveId
/** 보이는 항목의 현재 SP 판정 최대 대미지 비율 */
const maxOf = (c: CardView | undefined): number => c?.items.find((i) => i.key === c.shownItem)?.cell?.maxPercent ?? Number.NaN

describe('화력 도구 표(POWER_ITEMS)', () => {
  it('PRD R14 22종이 모두 레귤레이션 스냅샷 도구이고, 타입 강화 도구 타입은 겹치지 않는다', () => {
    expect(POWER_ITEMS).toHaveLength(22)
    expect(Object.keys(TYPE_BOOST_ITEMS)).toHaveLength(18)
    expect(new Set(Object.values(TYPE_BOOST_ITEMS)).size).toBe(18)
    for (const regulation of ['m-b', 'm-c']) {
      const snap = loadSnapshotSync(regulation)
      for (const id of POWER_ITEMS) expect(snap.data.items[id], `${regulation} ${id}`).toBeDefined()
    }
    // 구애머리띠·구애안경은 규정 데이터에 없다
    expect(game.data.items.choiceband).toBeUndefined()
    expect(game.data.items.choicespecs).toBeUndefined()
  })

  it('powerItemsOf: 점유율 기준 "이상"인 화력 도구만, 점유율 내림차순', () => {
    expect(powerItemsOf({ lifeorb: 0.3443, blackglasses: 0.0855, chopleberry: 0.4489, focussash: 0.0844 }, 0.05)).toEqual([
      { item: 'lifeorb', share: 0.3443 },
      { item: 'blackglasses', share: 0.0855 },
    ])
    expect(powerItemsOf({ lifeorb: 0.05 }, 0.05)).toEqual([{ item: 'lifeorb', share: 0.05 }])
    expect(powerItemsOf({ lifeorb: 0.3443 }, 0.4)).toEqual([])
  })
})

describe('powerItemBoosts: 그 기술에 보정을 주는가', () => {
  it('생명의구슬: 위력 기술이면 항상, 변화기·고정 대미지·나에게 무효면 아니다', () => {
    expect(powerItemBoosts(game, 'hypervoice', 'lifeorb', plain, me)).toBe(true)
    expect(powerItemBoosts(game, 'swordsdance', 'lifeorb', plain, me)).toBe(false)
    expect(powerItemBoosts(game, 'seismictoss', 'lifeorb', plain, me)).toBe(false)
    // 한카리아스는 전기 무효
    expect(powerItemBoosts(game, 'thunderbolt', 'lifeorb', plain, me)).toBe(false)
    // 서투름이면 도구 무효
    expect(powerItemBoosts(game, 'hypervoice', 'lifeorb', { types: ['Normal'], ability: 'klutz' }, me)).toBe(false)
  })

  it('힘의머리띠 = 물리, 박식안경 = 특수(사이코쇼크는 특수 분류)', () => {
    expect(powerItemBoosts(game, 'icepunch', 'muscleband', plain, me)).toBe(true)
    expect(powerItemBoosts(game, 'icebeam', 'muscleband', plain, me)).toBe(false)
    expect(powerItemBoosts(game, 'icebeam', 'wiseglasses', plain, me)).toBe(true)
    expect(powerItemBoosts(game, 'icepunch', 'wiseglasses', plain, me)).toBe(false)
    expect(powerItemBoosts(game, 'psyshock', 'wiseglasses', plain, me)).toBe(true)
  })

  it('달인의띠: 나에게 효과가 굉장할 때만(바뀐 타입·특성 날씨 포함)', () => {
    expect(powerItemBoosts(game, 'icebeam', 'expertbelt', plain, me)).toBe(true)
    expect(powerItemBoosts(game, 'flamethrower', 'expertbelt', plain, me)).toBe(false)
    // 프리즈스킨: 노말 기술 → 얼음(한카리아스에 4배)
    expect(powerItemBoosts(game, 'hypervoice', 'expertbelt', { types: ['Ice'], ability: 'refrigerate' }, me)).toBe(true)
    expect(powerItemBoosts(game, 'hypervoice', 'expertbelt', plain, me)).toBe(false)
    // 눈퍼뜨리기: 웨더볼 → 얼음
    expect(powerItemBoosts(game, 'weatherball', 'expertbelt', { types: ['Ice'], ability: 'snowwarning' }, me)).toBe(true)
    expect(powerItemBoosts(game, 'weatherball', 'expertbelt', plain, me)).toBe(false)
  })

  it('타입 강화 도구: 바뀐 기술 타입이 맞을 때만(R13 규칙)', () => {
    expect(powerItemBoosts(game, 'icebeam', 'nevermeltice', plain, me)).toBe(true)
    expect(powerItemBoosts(game, 'icebeam', 'charcoal', plain, me)).toBe(false)
    expect(powerItemBoosts(game, 'hypervoice', 'silkscarf', plain, me)).toBe(true)
    // 프리즈스킨이면 노말 기술은 얼음: 실크스카프가 아니라 녹지않는얼음
    expect(powerItemBoosts(game, 'hypervoice', 'silkscarf', { types: ['Ice'], ability: 'refrigerate' }, me)).toBe(false)
    expect(powerItemBoosts(game, 'hypervoice', 'nevermeltice', { types: ['Ice'], ability: 'refrigerate' }, me)).toBe(true)
    // 가뭄: 웨더볼 불꽃(목탄). 구름보기(나)면 날씨 없음 → 노말
    expect(powerItemBoosts(game, 'weatherball', 'charcoal', { types: ['Fire'], ability: 'drought' }, plain)).toBe(true)
    expect(powerItemBoosts(game, 'weatherball', 'charcoal', { types: ['Fire'], ability: 'drought' }, { types: ['Normal'], ability: 'cloudnine' })).toBe(false)
    // 화력 도구가 아닌 도구
    expect(powerItemBoosts(game, 'icebeam', 'focussash', plain, me)).toBe(false)
  })

  it('애크러뱃은 도구를 지니면 위력이 줄어 어느 화력 도구도 보정이 아니다: 파이어로 예리한부리·생명의구슬 변형 triggers에 없다', () => {
    const flyer = { types: ['Fire', 'Flying'], ability: 'galewings' }
    for (const item of ['sharpbeak', 'lifeorb', 'expertbelt', 'muscleband']) expect(powerItemBoosts(game, 'acrobatics', item, flyer, me), item).toBe(false)
    expect(powerItemBoosts(game, 'bravebird', 'sharpbeak', flyer, me)).toBe(true)
    const plan = planTab(cardInput({ mySet: GARCHOMP, filters: { topN: 30, selected: ['talonflame'] } }), 'defense')
    const cards = plan.cards.filter((c) => c.opponent.id === 'talonflame')
    // 기본 카드 후보에는 애크러뱃이 있다(사용률 5% 이상)
    expect(cards.find((c) => c.berry === undefined)?.conditions.some((g) => g.candidates.some((m) => m.moveId === 'acrobatics'))).toBe(true)
    for (const item of ['sharpbeak', 'lifeorb']) {
      const v = cards.filter((c) => c.berry?.item === item)
      expect(v.length, item).toBeGreaterThan(0)
      for (const c of v) {
        expect(c.berry?.triggers, item).not.toContain('acrobatics')
        expect(c.berry?.triggers, item).toContain('bravebird')
      }
    }
  })
})

describe('방어 탭: 대도각참(생명의구슬 34%) 기본 줄 + 화력 도구 줄(AC35)', () => {
  const shares = bo1.entry('kingambit')?.items.shares ?? {}

  it('계획: 기본 카드는 도구 없음, 생명의구슬·검은안경 변형 카드가 기본 카드 뒤에 있고 기합의띠·열매 변형은 없다', () => {
    expect(shares.lifeorb).toBeGreaterThan(0.34)
    expect(shares.lifeorb).toBeLessThan(0.35)
    const plan = planTab(input(), 'defense')
    const cards = plan.cards.filter((c) => c.opponent.id === 'kingambit')
    const kinds = cards.map((c) => c.berry?.item ?? 'base')
    expect([...new Set(kinds)]).toEqual(['base', 'lifeorb', 'blackglasses'])
    for (const c of cards) expect(c.opponentSet.item, c.id).toBe(c.berry?.item)
    const lo = cards.filter((c) => c.berry?.item === 'lifeorb')
    expect(lo[0].berry?.share).toBe(shares.lifeorb)
    // 검은안경은 악 기술에만
    const bg = cards.find((c) => c.berry?.item === 'blackglasses')
    for (const m of bg?.berry?.triggers ?? []) expect(game.data.moves[m].type, m).toBe('Dark')
    expect(bg?.berry?.triggers.length).toBeGreaterThan(0)
    expect(lo[0].berry?.triggers.length).toBeGreaterThan(bg?.berry?.triggers.length ?? 0)
    // 카드 id·그룹 키가 겹치지 않는다
    expect(new Set(plan.cards.map((c) => c.id)).size).toBe(plan.cards.length)
  })

  it('조립: 생명의구슬 줄은 기본 줄과 다른 그룹이고, 같은 기술(도각참 직접 고름)·배분에서 판정 대미지가 더 크다', () => {
    const sel = new Map([[opponentKey({ source: 'ladder', id: 'kingambit' }), itemKey('kowtowcleave', BASE_CONDITION_ID)]])
    const view = buildTabView(input(), 'defense', undefined, sel)
    const groups = groupCards(view.cards, 'defense')
    const keys = groups.map((g) => g.key)
    expect(keys).toContain(KINGAMBIT_KEY)
    expect(keys).toContain(JSON.stringify(['ladder', 'kingambit', 'lifeorb']))
    const lo = groups.find((g) => g.berry?.item === 'lifeorb')
    expect(lo?.berry).toEqual({ item: 'lifeorb', share: shares.lifeorb })
    const loCard = view.cards.find((c) => c.berry?.item === 'lifeorb') as CardView
    const base = view.cards.find((c) => c.berry === undefined && c.opponent.id === 'kingambit' && c.category === loCard.category && c.bundle.key === loCard.bundle.key)
    expect(shownMove(loCard)).toBe('kowtowcleave')
    expect(shownMove(base as CardView)).toBe('kowtowcleave')
    expect(maxOf(loCard)).toBeGreaterThan(maxOf(base))
  })

  it('화력 도구 최소 40%면 생명의구슬 줄이 없다(기준 "이상")', () => {
    expect(planTab(input(0.4), 'defense').cards.some((c) => c.berry?.item === 'lifeorb')).toBe(false)
    expect(planTab(input(shares.lifeorb), 'defense').cards.some((c) => c.berry?.item === 'lifeorb')).toBe(true)
    expect(buildTabView(input(0.4), 'defense').cards.some((c) => c.berry !== undefined && c.berry.item === 'lifeorb')).toBe(false)
  })

  it('타입 강화 도구 줄은 보이는 기술 타입이 맞을 때만: 악 기술이면 검은안경 줄, 아이언헤드를 고르면 사라지고 생명의구슬 줄은 남는다(선택 공유)', () => {
    const view = buildTabView(input(), 'defense')
    const bg = view.cards.filter((c) => c.berry?.item === 'blackglasses')
    for (const c of bg) expect(game.data.moves[shownMove(c) as string].type).toBe('Dark')
    const sel = new Map([[opponentKey({ source: 'ladder', id: 'kingambit' }), itemKey('ironhead', BASE_CONDITION_ID)]])
    const chosen = buildTabView(input(), 'defense', undefined, sel)
    expect(chosen.cards.some((c) => c.berry?.item === 'blackglasses')).toBe(false)
    const lo = chosen.cards.filter((c) => c.berry?.item === 'lifeorb')
    expect(lo.length).toBeGreaterThan(0)
    for (const c of lo) {
      expect(c.selected).toBe(true)
      expect(shownMove(c)).toBe('ironhead')
    }
  })

  it('목록 밖 타겟은 프리셋 도구 그대로이고 변형 카드가 없다', () => {
    const target = { rosterId: 'heatran', moves: ['flamethrower', 'earthpower'], edits: {} }
    const plan = planTab(cardInput({ mySet: GARCHOMP, filters: { topN: 1, selected: [] }, customTargets: [target] }), 'defense')
    const custom = plan.cards.filter((c) => c.opponent.source === 'custom')
    expect(custom.length).toBeGreaterThan(0)
    expect(custom.some((c) => c.berry !== undefined)).toBe(false)
  })
})
