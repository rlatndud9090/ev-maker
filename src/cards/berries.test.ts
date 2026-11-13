import { describe, expect, it } from 'vitest'
import { judgeDamage, validateSet, type PokemonSet } from '../core'
import type { MetaEntry } from '../data/meta-schema'
import { loadSnapshotSync } from '../data/testing'
import { RESIST_BERRIES, berryActivates, resistBerriesOf, resistBerryType } from './berries'
import { buildTabView } from './batch'
import { BASE_CONDITION_ID, itemKey } from './items'
import { opponentKey } from './schedule'
import { chosenOption, groupCards, pinOf } from './groups'
import { addedBundleCardId, samePin } from './ids'
import { planTab } from './plan'
import { cardInput, realData } from './testing'
import type { CardSpec } from './types'

const { game, bo1 } = realData()
const ZERO = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }
const entryOf = (id: string): MetaEntry => bo1.entry(id) as MetaEntry
/** 대도각참: 생명의구슬 A32 도각참·기습·아이언헤드·로킥 */
const KINGAMBIT: PokemonSet = {
  regulation: 'm-c',
  species: 'kingambit',
  ability: 'defiant',
  item: 'lifeorb',
  nature: 'adamant',
  sp: { ...ZERO, hp: 32, atk: 32, spd: 2 },
  moves: ['kowtowcleave', 'suckerpunch', 'ironhead', 'lowkick'],
}
const user = (set: PokemonSet) => {
  const r = validateSet(game, set)
  return { types: r.species.types, ability: r.ability }
}
const only = (ids: string[]) => cardInput({ mySet: KINGAMBIT, filters: { topN: 30, selected: ids } })

describe('반감열매 표(RESIST_BERRIES)', () => {
  it('열매 18종(카리열매 노말 + 17타입)은 모두 레귤레이션 스냅샷 도구이고 타입이 겹치지 않는다', () => {
    expect(Object.keys(RESIST_BERRIES)).toHaveLength(18)
    expect(new Set(Object.values(RESIST_BERRIES)).size).toBe(18)
    for (const regulation of ['m-b', 'm-c']) {
      const snap = loadSnapshotSync(regulation)
      for (const id of Object.keys(RESIST_BERRIES)) expect(snap.data.items[id], `${regulation} ${id}`).toBeDefined()
    }
    const moveTypes = new Set(Object.values(game.data.moves).map((m) => m.type))
    for (const t of Object.values(RESIST_BERRIES)) expect(moveTypes.has(t), t).toBe(true)
  })

  it('반감열매가 아닌 도구(자뭉열매·기합의띠·없음)는 타입이 없다', () => {
    expect(resistBerryType('colburberry')).toBe('Dark')
    expect(resistBerryType('chilanberry')).toBe('Normal')
    for (const id of ['sitrusberry', 'lumberry', 'focussash', 'nothing', 'toString']) expect(resistBerryType(id), id).toBeUndefined()
  })

  it('resistBerriesOf: 점유율 기준 이상 반감열매만, 점유율 내림차순', () => {
    expect(resistBerriesOf({ colburberry: 0.06, occaberry: 0.1, sitrusberry: 0.5, focussash: 0.3, kasibberry: 0.01 }, 0.05)).toEqual([
      { item: 'occaberry', share: 0.1 },
      { item: 'colburberry', share: 0.06 },
    ])
    expect(resistBerriesOf({ colburberry: 0.05 }, 0.05)).toEqual([{ item: 'colburberry', share: 0.05 }])
    expect(resistBerriesOf({ colburberry: 0.0594 }, 1)).toEqual([])
  })
})

describe('berryActivates: 그 열매가 발동하는 기술', () => {
  const resolvedBasculegion = validateSet(game, entryOf('basculegion').representative.set)
  const basculegion = { types: resolvedBasculegion.species.types, ability: resolvedBasculegion.ability }
  const me = user(KINGAMBIT)

  it('효과가 굉장한 그 타입 기술에만(마코열매 + 도각참 → 대쓰여너 물/고스트)', () => {
    expect(basculegion.types).toEqual(['Water', 'Ghost'])
    expect(berryActivates(game, 'kowtowcleave', 'colburberry', me, basculegion)).toBe(true)
    expect(berryActivates(game, 'suckerpunch', 'colburberry', me, basculegion)).toBe(true)
    // 타입이 다른 기술·효과가 보통 이하인 대상·반감열매가 아닌 도구
    expect(berryActivates(game, 'ironhead', 'colburberry', me, basculegion)).toBe(false)
    expect(berryActivates(game, 'kowtowcleave', 'colburberry', me, { types: ['Dark', 'Steel'], ability: 'pressure' })).toBe(false)
    expect(berryActivates(game, 'kowtowcleave', 'colburberry', me, { types: ['Water'], ability: 'pressure' })).toBe(false)
    expect(berryActivates(game, 'kowtowcleave', 'sitrusberry', me, basculegion)).toBe(false)
    expect(berryActivates(game, 'kowtowcleave', 'kasibberry', me, basculegion)).toBe(false)
  })

  it('카리열매는 상성과 무관하게 노말 기술에, 스킨 특성으로 타입이 바뀌면 아니다', () => {
    expect(berryActivates(game, 'hypervoice', 'chilanberry', { types: ['Normal'], ability: 'scrappy' }, { types: ['Water'], ability: 'pressure' })).toBe(true)
    expect(berryActivates(game, 'hypervoice', 'chilanberry', { types: ['Fairy'], ability: 'pixilate' }, { types: ['Water'], ability: 'pressure' })).toBe(false)
    expect(berryActivates(game, 'hypervoice', 'roseliberry', { types: ['Fairy'], ability: 'pixilate' }, { types: ['Dragon'], ability: 'pressure' })).toBe(true)
  })

  it('긴장감·변화기·스냅샷에 없는 기술은 발동하지 않는다', () => {
    expect(berryActivates(game, 'kowtowcleave', 'colburberry', { types: ['Dark'], ability: 'unnerve' }, basculegion)).toBe(false)
    expect(berryActivates(game, 'swordsdance', 'chilanberry', me, { types: ['Water'], ability: 'pressure' })).toBe(false)
    expect(berryActivates(game, 'nosuchmove', 'colburberry', me, basculegion)).toBe(false)
  })

  it('인마일체도 막고, 맞는 쪽이 서투름(도구 무효)이면 발동하지 않는다', () => {
    expect(berryActivates(game, 'kowtowcleave', 'colburberry', { types: ['Psychic', 'Ghost'], ability: 'asonespectrier' }, basculegion)).toBe(false)
    expect(berryActivates(game, 'kowtowcleave', 'colburberry', me, { types: basculegion.types, ability: 'klutz' })).toBe(false)
    expect(berryActivates(game, 'kowtowcleave', 'colburberry', me, { types: basculegion.types, ability: 'swiftswim' })).toBe(true)
  })

  it('기술별 상성 특례는 엔진과 같다(프리즈드라이: 물에 2배, 플라잉프레스: 격투 × 비행)', () => {
    // 물/고스트 대쓰여너: 얼음 기본 상성은 0.5배지만 프리즈드라이는 2배 → 하양열매 발동
    expect(berryActivates(game, 'freezedry', 'yacheberry', { types: ['Ice', 'Flying'], ability: 'pressure' }, basculegion)).toBe(true)
    expect(berryActivates(game, 'icebeam', 'yacheberry', { types: ['Ice', 'Flying'], ability: 'pressure' }, basculegion)).toBe(false)
    // 플라잉프레스(격투): 풀 = 격투 1 × 비행 2 → 로플열매 발동, 바위 = 격투 2 × 비행 0.5 → 미발동
    const hawlucha = { types: ['Fighting', 'Flying'], ability: 'unburden' }
    expect(berryActivates(game, 'flyingpress', 'chopleberry', hawlucha, { types: ['Grass'], ability: 'pressure' })).toBe(true)
    expect(berryActivates(game, 'flyingpress', 'chopleberry', hawlucha, { types: ['Rock'], ability: 'pressure' })).toBe(false)
  })
})

describe('공격 탭 상대 도구: 기본 카드는 도구 없음, 반감열매는 별도 변형 카드', () => {
  const plan = planTab(only(['basculegion', 'kingambit', 'charizardmegay', 'garchomp']), 'attack')
  const cards = (id: string, berry?: string): CardSpec[] => plan.cards.filter((c) => c.opponent.id === id && c.berry?.item === berry)

  it('래더 기본 카드(관측 묶음)의 상대 가정 세트는 도구 없음(대표 도구가 기합의띠여도), 메가 항목은 메가스톤 유지', () => {
    expect(entryOf('basculegion').representative.set.item).toBe('focussash')
    for (const id of ['basculegion', 'kingambit', 'garchomp']) {
      expect(cards(id).length, id).toBeGreaterThan(0)
      for (const c of cards(id)) expect(c.opponentSet.item, c.id).toBeUndefined()
    }
    const mega = cards('charizardmegay')
    expect(mega.length).toBeGreaterThan(0)
    for (const c of mega) expect([c.opponentSet.item, c.opponentSet.mega]).toEqual(['charizarditey', true])
    expect(plan.cards.filter((c) => c.opponent.id === 'charizardmegay' && c.berry !== undefined)).toEqual([])
    // 행 판정 세트도 같은 가정이다
    for (const c of cards('basculegion')) for (const id of c.rowIds) expect(plan.rows[id].defender.item).toBeUndefined()
  })

  it('방어·스피드 탭은 대표 도구를 그대로 쓰고 열매 변형이 없다', () => {
    for (const tab of ['defense', 'speed'] as const) {
      const p = planTab(only(['basculegion']), tab)
      expect(p.cards.length).toBeGreaterThan(0)
      expect(p.cards.filter((c) => c.bundle.userAdded === undefined).every((c) => c.opponentSet.item === 'focussash'), tab).toBe(true)
      expect(p.cards.some((c) => c.berry !== undefined), tab).toBe(false)
    }
  })

  it('기합의띠 1타 방지가 꺼진다: 대쓰여너 대표 세트에 생명의구슬 도각참은 띠면 확정견딤, 도구 없음이면 1타 확률 > 0(코어)', () => {
    const rep = entryOf('basculegion').representative.set
    const sash = judgeDamage(game, 'attacker', KINGAMBIT, rep, 'kowtowcleave', undefined, undefined, { rollSteps: 14 })
    const bare = { ...rep }
    delete bare.item
    const none = judgeDamage(game, 'attacker', KINGAMBIT, bare, 'kowtowcleave', undefined, undefined, { rollSteps: 14 })
    expect(sash.value.kind === 'damage' && sash.value.ohkoChance).toBe(0)
    expect(none.value.kind === 'damage' ? none.value.ohkoChance : 0).toBeGreaterThan(0)
    expect(none.category).not.toBe(sash.category)
    expect(sash.category).toBe('guaranteed-survive')
  })

  it('반감열매 변형: 점유율 기준 이상이고 내 기술 중 발동하는 기술이 있을 때만, 같은 묶음 + 그 열매(원래 카드 바로 뒤)', () => {
    // 대쓰여너 마코열매 5.94%(기본 5% 이상), 도각참·기습 발동. 리자몽(메가)·한카리아스는 기준 이상 반감열매가 없다.
    const base = cards('basculegion')
    const colbur = cards('basculegion', 'colburberry')
    expect(colbur.length).toBe(base.length)
    expect(colbur.map((c) => c.bundle.key)).toEqual(base.map((c) => c.bundle.key))
    for (const c of colbur) {
      expect(c.opponentSet.item).toBe('colburberry')
      expect(c.berry).toEqual({ item: 'colburberry', share: entryOf('basculegion').items.shares.colburberry, triggers: ['kowtowcleave', 'suckerpunch'] })
      expect(c.id).not.toBe(base.find((b) => b.bundle.key === c.bundle.key)?.id)
    }
    const order = plan.cards.filter((c) => c.opponent.id === 'basculegion').map((c) => (c.berry === undefined ? 'base' : c.berry.item))
    expect(order).toEqual([...base.map(() => 'base'), ...colbur.map(() => 'colburberry')])
    expect(plan.cards.some((c) => c.opponent.id === 'garchomp' && c.berry !== undefined)).toBe(false)
    // 내 기술 중 발동하는 기술이 없으면 없다(대도각참 로플열매 44.9%, 격투 기술 없는 세트)
    const noFighting = planTab(cardInput({ mySet: { ...KINGAMBIT, moves: ['kowtowcleave', 'suckerpunch', 'ironhead'] }, filters: { topN: 30, selected: ['kingambit'] } }), 'attack')
    expect(noFighting.cards.length).toBeGreaterThan(0)
    expect(noFighting.cards.some((c) => c.berry !== undefined)).toBe(false)
    // 기준을 올리면 없다
    const high = planTab(cardInput({ mySet: KINGAMBIT, filters: { topN: 30, selected: ['basculegion'] }, criteria: { ...only([]).criteria, berryShareMin: 1 } }), 'attack')
    expect(high.cards.some((c) => c.berry !== undefined)).toBe(false)
  })

  it('격투 기술이 있으면 대도각참 로플열매 변형이 생기고, 직접 추가 배분은 기본·열매 카드 모두에 생긴다', () => {
    const added = { tab: 'attack' as const, opponentId: 'kingambit', category: 'physical' as const, sp: { hp: 10, def: 20 } }
    const p = planTab(cardInput({ mySet: KINGAMBIT, filters: { topN: 30, selected: ['kingambit'] }, addedBundles: [added] }), 'attack')
    const chople = p.cards.filter((c) => c.berry?.item === 'chopleberry')
    expect(chople.length).toBeGreaterThan(0)
    expect(chople[0].berry?.triggers).toEqual(['lowkick'])
    const users = p.cards.filter((c) => c.bundle.userAdded !== undefined)
    expect(users.map((c) => c.berry?.item ?? null)).toEqual([null, 'chopleberry'])
    expect(new Set(users.map((c) => c.id)).size).toBe(2)
  })

  it('직접 추가 배분 카드도 기본은 도구 없음, 열매 카드는 열매(대표 도구가 기합의띠인 대쓰여너)', () => {
    const added = { tab: 'attack' as const, opponentId: 'basculegion', category: 'physical' as const, sp: { hp: 32, def: 20 } }
    const p = planTab(cardInput({ mySet: KINGAMBIT, filters: { topN: 30, selected: ['basculegion'] }, addedBundles: [added] }), 'attack')
    const users = p.cards.filter((c) => c.bundle.userAdded !== undefined)
    expect(users.map((c) => c.berry?.item ?? null)).toEqual([null, 'colburberry'])
    const [plain, berry] = users
    expect(plain.opponentSet.item).toBeUndefined()
    expect(berry.opponentSet.item).toBe('colburberry')
    expect(plain.rowIds.length).toBeGreaterThan(0)
    expect(berry.rowIds.length).toBeGreaterThan(0)
    for (const id of plain.rowIds) expect(p.rows[id].defender.item, id).toBeUndefined()
    for (const id of berry.rowIds) expect(p.rows[id].defender.item, id).toBe('colburberry')
    for (const id of plain.fixedIds) expect(p.fixed[id].defender.item, id).toBeUndefined()
  })
})

describe('조립: 열매 행은 가장 센 기술에 열매가 발동할 때만', () => {
  it('대쓰여너 (마코): 기본 조건 가장 센 기술이 도각참이면 보이고, 그룹 키·고정은 기본 행과 따로다', () => {
    const view = buildTabView(only(['basculegion']), 'attack')
    const colbur = view.cards.filter((c) => c.berry?.item === 'colburberry')
    expect(colbur.length).toBeGreaterThan(0)
    const groups = groupCards(view.cards, 'attack')
    expect(groups.map((g) => g.key)).toEqual([JSON.stringify(['ladder', 'basculegion']), JSON.stringify(['ladder', 'basculegion', 'colburberry'])])
    expect(groups[1].berry).toEqual({ item: 'colburberry', share: entryOf('basculegion').items.shares.colburberry })
    expect(pinOf('attack', colbur[0])).toEqual({ tab: 'attack', opponentId: 'basculegion', category: colbur[0].category, key: colbur[0].bundle.key, item: 'colburberry' })
    // 열매 행 고정은 기본 행 고정이 아니다
    const pinned = groupCards(view.cards, 'attack', [pinOf('attack', colbur[0])])
    expect(pinned[0].pinned).toEqual([])
    expect(pinned[1].pinned).toEqual([colbur[0].id])
    expect(samePin(pinOf('attack', colbur[0]), { ...pinOf('attack', colbur[0]), item: undefined })).toBe(false)
    // 직접 추가 카드 id는 열매 행이면 열매를 붙여 기본 행 것과 다르고, 같은 키 관측 묶음으로 합쳐졌으면 그 열매 행 관측 묶음으로 풀린다
    const neutral = colbur.find((c) => c.bundle.stats.every((x) => x.nature === 'neutral'))
    expect(neutral).toBeDefined()
    const n = neutral as (typeof colbur)[number]
    const added = { tab: 'attack' as const, opponentId: 'basculegion', category: n.category }
    const id = addedBundleCardId(added, n.bundle.stats, 'colburberry')
    expect(id).not.toBe(addedBundleCardId(added, n.bundle.stats))
    expect(chosenOption(groups[1], 'attack', id).id).toBe(n.id)
    // 열매가 반감하면 같은 SP에서 1타 확률이 늘지 않는다
    const base = view.cards.find((c) => c.berry === undefined && c.bundle.key === colbur[0].bundle.key && c.category === colbur[0].category)
    const rowOf = (c: typeof base) => c?.rows.find((r) => r.moveId === 'kowtowcleave' && r.kind === 'base')
    const b = rowOf(base)
    const r = rowOf(colbur[0])
    expect(b?.cells.length).toBe(33)
    expect(r?.cells.length).toBe(33)
    expect(r?.cells.every((c, i) => (c.ohkoChance ?? 0) <= (b?.cells[i].ohkoChance ?? 0))).toBe(true)
    expect(r?.cells.some((c, i) => (c.maxPercent ?? 0) < (b?.cells[i].maxPercent ?? 0))).toBe(true)
  })

  it('열매 카드는 보이는 항목의 기술이 그 열매를 발동시킬 때만 보인다: 직접 고른 항목도 같은 규칙(PRD R7, 같은 상대 선택 공유)', () => {
    const garchomp: PokemonSet = { regulation: 'm-c', species: 'garchomp', ability: 'roughskin', item: 'lifeorb', nature: 'adamant', sp: { ...ZERO, hp: 2, atk: 32, spe: 32 }, moves: ['earthquake', 'bite'] }
    const input = cardInput({ mySet: garchomp, filters: { topN: 30, selected: ['basculegion'] } })
    // 기본: 열매 카드의 기본 항목은 지진(열매가 깨물기를 반감) → 열매가 관여하지 않아 숨는다
    expect(buildTabView(input, 'attack').cards.some((c) => c.berry !== undefined)).toBe(false)
    // 깨물기를 직접 고르면 열매 카드(같은 상대 선택 공유)도 깨물기를 보이며 나타난다
    const sel = new Map([[opponentKey({ source: 'ladder', id: 'basculegion' }), itemKey('bite', BASE_CONDITION_ID)]])
    const chosen = buildTabView(input, 'attack', undefined, sel)
    const berry = chosen.cards.filter((c) => c.berry !== undefined)
    expect(berry.length).toBeGreaterThan(0)
    for (const c of berry) {
      expect(c.selected).toBe(true)
      expect(c.rows.map((r) => r.moveId)).toEqual(['bite'])
    }
    // 지진을 직접 고르면 다시 숨는다
    const eq = new Map([[opponentKey({ source: 'ladder', id: 'basculegion' }), itemKey('earthquake', BASE_CONDITION_ID)]])
    expect(buildTabView(input, 'attack', undefined, eq).cards.some((c) => c.berry !== undefined)).toBe(false)
  })

  it('실데이터: 한카리아스 지진·깨물기 → 대쓰여너 마코열매 변형은 계획되지만 열매 조건에서 지진이 가장 세서 보이지 않는다', () => {
    const garchomp: PokemonSet = { regulation: 'm-c', species: 'garchomp', ability: 'roughskin', item: 'lifeorb', nature: 'adamant', sp: { ...ZERO, hp: 2, atk: 32, spe: 32 }, moves: ['earthquake', 'bite'] }
    const input = cardInput({ mySet: garchomp, filters: { topN: 30, selected: ['basculegion'] } })
    const plan = planTab(input, 'attack')
    expect(plan.cards.filter((c) => c.berry !== undefined).map((c) => c.berry?.triggers)).toEqual(plan.cards.filter((c) => c.berry !== undefined).map(() => ['bite']))
    expect(plan.cards.some((c) => c.berry !== undefined)).toBe(true)
    const view = buildTabView(input, 'attack')
    expect(view.cards.length).toBeGreaterThan(0)
    expect(view.cards.some((c) => c.berry !== undefined)).toBe(false)
    // 기본 카드(도구 없음)는 깨물기가 가장 세지만(지진은 더블 범위 보정 0.75), 열매 변형에서는 깨물기가 반감돼 지진이 가장 세다.
    expect(new Set(view.cards.map((c) => c.items.find((i) => i.key === c.shownItem)?.moveId))).toEqual(new Set(['bite']))
  })

  it('실데이터: 대도각참 로플열매 변형은 로킥이 가장 셀 때 보인다', () => {
    const view = buildTabView(cardInput({ mySet: KINGAMBIT, filters: { topN: 30, selected: ['kingambit'] } }), 'attack')
    const chople = view.cards.filter((c) => c.berry?.item === 'chopleberry')
    expect(chople.length).toBeGreaterThan(0)
    for (const c of chople) expect(c.rows.map((r) => r.moveId)).toContain('lowkick')
  })
})
