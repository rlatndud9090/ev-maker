// 판정 행 기술 선택 항목(PRD R2·R3·R4·R5, damage-tabs-row-revamp). 기본 항목 규칙은 항목 상태를 직접 넣어, 목록·선택은 실데이터로 확인한다.
import { describe, expect, it } from 'vitest'
import { compareSpeed, type PokemonSet, type SpTable } from '../core'
import { EXAMPLE_SET } from './__fixtures__/acceptance'
import { assembleTab } from './assemble'
import { buildTabView } from './batch'
import { computeRowTask } from './rowTask'
import { BASE_CONDITION_ID, compareItems, itemKey, resolveDefault, type ItemState, type ItemVariability } from './items'
import { outspeedsAtMax, planTab } from './plan'
import { cardExplore, nextStage, opponentKey, pendingTasks, taskCardId, taskKey } from './schedule'
import { cardInput, realData } from './testing'
import type { CardInput, CardSpec, CardView, CompactCell, RowTaskResult, Tab, TabPlan } from './types'

const RANK = JSON.stringify(['rank', 'opponent', 'move', 'swordsdance'])
const RANK2 = JSON.stringify(['rank', 'opponent', 'move', 'dragondance'])
const cell = (ohkoChance: number, maxPercent: number): CompactCell => ({ sp: 0, category: 'x', ohkoChance, maxPercent })
const VAR: ItemVariability = { kind: 'variable' }
const fixed = (category: string): ItemVariability => ({ kind: 'fixed', category })
const OHKO = fixed('guaranteed-ohko')
const SURVIVE = fixed('guaranteed-survive')
const MID = fixed('mid-roll-ohko')

let order = 0
function item(moveId: string, rankBefore: boolean, probe: ItemState['probe'], variability: ItemVariability, patch: Partial<ItemState> = {}): ItemState {
  const conditionId = rankBefore ? BASE_CONDITION_ID : RANK
  return { key: itemKey(moveId, conditionId), moveId, rankBefore, priority: false, probe, variability, moveOrder: order++, conditionOrder: rankBefore ? 0 : 1, ...patch }
}
const ok = (p: number, m: number) => ({ kind: 'ok' as const, cell: cell(p, m) })
const immune = { kind: 'immune' as const, cell: { sp: 0, category: 'guaranteed-survive', immune: true as const } }
const error = { kind: 'error' as const, reason: { code: 'WHITE_HERB_MULTIHIT' as const, message: 'x' } }
/** 기준 기술 m의 랭크 전 P(약함) · 랭크 후 Q(셈) + 더 약한 다른 기술 */
function pq(p: ItemVariability, q: ItemVariability, pProbe: ItemState['probe'] = ok(0.2, 80), qProbe: ItemState['probe'] = ok(0.9, 120)) {
  const P = item('m', true, pProbe, p)
  const Q = item('m', false, qProbe, q)
  const other = item('o', true, ok(0, 20), VAR)
  return { P, Q, items: [Q, other, P] }
}
const pick = (items: readonly ItemState[], priorityRule = false) => resolveDefault(items, { priorityRule })

describe('resolveDefault: 랭크 전 P·후 Q 표(R4-3, 위에서부터 첫 일치)', () => {
  it('1. P 정상·Q 무효/계산 불가 → P', () => {
    for (const qProbe of [immune, error]) {
      const { P, items } = pq(MID, VAR, ok(0.2, 80), qProbe)
      expect(pick(items)).toMatchObject({ kind: 'ready', key: P.key })
    }
  })
  it('2. P 무효/계산 불가·Q 정상 → Q', () => {
    // 정상 랭크 전 항목이 없으면 정렬 첫 항목(정상인 Q)이 기본이다.
    const P = item('m', true, error, { kind: 'error', reason: error.reason })
    const Q = item('m', false, ok(0.9, 120), SURVIVE)
    expect(pick([P, Q])).toMatchObject({ kind: 'ready', key: Q.key })
    // 반대로 Q가 무효면(1번 줄) 판정 전이어도 기다리지 않고 P.
    const P2 = item('n', true, ok(0.1, 50), MID)
    const Q2 = item('n', false, immune, { kind: 'pending' })
    expect(pick([P2, Q2])).toMatchObject({ kind: 'ready', key: P2.key })
  })
  it('3. P 변동·Q 고정 → P', () => {
    const { P, items } = pq(VAR, OHKO)
    expect(pick(items)).toMatchObject({ kind: 'ready', key: P.key })
  })
  it('4. P 고정·Q 변동 → Q', () => {
    const { Q, items } = pq(SURVIVE, VAR)
    expect(pick(items)).toMatchObject({ kind: 'ready', key: Q.key })
  })
  it('5. 둘 다 변동 → P(사용자 결정 2026-11-13)', () => {
    const { P, items } = pq(VAR, VAR)
    expect(pick(items)).toMatchObject({ kind: 'ready', key: P.key })
  })
  it('6. P 확정1타 고정 → P(랭크업 없이도 1타)', () => {
    const { P, items } = pq(OHKO, OHKO)
    expect(pick(items)).toMatchObject({ kind: 'ready', key: P.key })
  })
  it('7. P 고정(확정1타 아님)·Q 확정견딤 고정 → Q(랭크업해도 버팀)', () => {
    const { Q, items } = pq(SURVIVE, SURVIVE)
    expect(pick(items)).toMatchObject({ kind: 'ready', key: Q.key })
  })
  it('8. 그 밖(P 확정견딤·Q 확정1타 등) → P', () => {
    const { P, items } = pq(SURVIVE, OHKO)
    expect(pick(items)).toMatchObject({ kind: 'ready', key: P.key })
    const mid = pq(MID, MID)
    expect(pick(mid.items)).toMatchObject({ kind: 'ready', key: mid.P.key })
  })
  it('랭크 후 항목이 둘이면 Q = 변동인 것 중 가장 센 것(더 약해도 변동이면 그쪽)', () => {
    const P = item('m', true, ok(0, 60), SURVIVE)
    const strong = item('m', false, ok(0.5, 110), OHKO)
    const weakVar = item('m', false, ok(0.1, 90), VAR, { key: itemKey('m', RANK2), conditionOrder: 2 })
    expect(pick([strong, weakVar, P])).toMatchObject({ kind: 'ready', key: weakVar.key })
    const weakFixed = { ...weakVar, variability: SURVIVE }
    // 변동인 Q가 없으면 가장 센 Q(확정1타) → 8번 줄 → P
    expect(pick([strong, weakFixed, P])).toMatchObject({ kind: 'ready', key: P.key })
  })
  it('랭크 후 항목이 없으면 기준 기술의 랭크 전 항목', () => {
    const P = item('m', true, ok(0, 60), SURVIVE)
    expect(pick([P, item('o', true, ok(0, 10), VAR)])).toMatchObject({ kind: 'ready', key: P.key, viaPriority: false, basis: P.key })
  })
})

describe('resolveDefault: 사용자 요구 사례(방어 탭 도각참, PRD AC7)', () => {
  const cleave = (p: ItemVariability, q: ItemVariability) => pq(p, q, ok(0, 56), ok(0.56, 101))
  it('+2는 늘 확정1타, 칼춤 전은 변동 → 칼춤 전 도각참', () => {
    const { P, items } = cleave(VAR, OHKO)
    expect(pick(items)).toMatchObject({ key: P.key })
  })
  it('칼춤 전은 늘 확정견딤, +2가 변동 → +2 도각참', () => {
    const { Q, items } = cleave(SURVIVE, VAR)
    expect(pick(items)).toMatchObject({ key: Q.key })
  })
  it('칼춤 전도 확정1타 → 칼춤 전, +2도 확정견딤 → +2', () => {
    expect(pick(cleave(OHKO, OHKO).items)).toMatchObject({ key: cleave(OHKO, OHKO).P.key })
    expect(pick(cleave(SURVIVE, SURVIVE).items)).toMatchObject({ key: cleave(SURVIVE, SURVIVE).Q.key })
  })
})

describe('resolveDefault: 결정에 필요한 판정(need)', () => {
  it('단건 판정이 남았으면 pending(need 없음, 단건 판정은 늘 1단계)', () => {
    const { items } = pq(VAR, VAR, { kind: 'pending' })
    expect(pick(items)).toEqual({ kind: 'pending', need: [] })
  })
  it('P 변동 판정 전 → need [P]. P가 변동이면 Q 판정 없이 정해진다', () => {
    const { P, items } = pq({ kind: 'pending' }, { kind: 'pending' })
    expect(pick(items)).toEqual({ kind: 'pending', need: [P.key] })
    const v = pq(VAR, { kind: 'pending' })
    expect(pick(v.items)).toMatchObject({ kind: 'ready', key: v.P.key })
  })
  it('P 고정(확정1타 아님)이면 Q들의 판정이 필요하다', () => {
    const { Q, items } = pq(SURVIVE, { kind: 'pending' })
    expect(pick(items)).toEqual({ kind: 'pending', need: [Q.key] })
  })
})

describe('resolveDefault: 방어 탭 선공기 우선(R4-2, PRD AC8)', () => {
  const build = (priorityVar: ItemVariability, priorityQ?: ItemVariability) => {
    const cleave = item('kowtowcleave', true, ok(0.5, 101), VAR)
    const sucker = item('suckerpunch', true, ok(0, 60), priorityVar, { priority: true })
    const out = [cleave, sucker]
    if (priorityQ !== undefined) out.push(item('suckerpunch', false, ok(0.1, 90), priorityQ, { priority: true }))
    return { cleave, sucker, items: out }
  }
  it('(a) 내가 확실히 빠르고(priorityRule) 선공기가 변동 → 선공기가 기준 기술', () => {
    const { sucker, items } = build(VAR)
    expect(pick(items, true)).toMatchObject({ kind: 'ready', key: sucker.key, viaPriority: true, basis: sucker.key })
  })
  it('(a) 선공기 랭크 후 항목만 변동이어도 우선 → 그 기술의 P·Q 표(P 확정견딤·Q 변동 → Q)', () => {
    const { items } = build(SURVIVE, VAR)
    expect(pick(items, true)).toMatchObject({ kind: 'ready', key: itemKey('suckerpunch', RANK), viaPriority: true })
  })
  it('(b)(c) 내가 확실히 빠르지 않으면(priorityRule 거짓: 동속·상대가 빠름) 우선하지 않는다', () => {
    const { cleave, items } = build(VAR)
    expect(pick(items, false)).toMatchObject({ key: cleave.key, viaPriority: false })
  })
  it('(d) 선공기가 고정이면 우선하지 않는다', () => {
    const { cleave, items } = build(SURVIVE)
    expect(pick(items, true)).toMatchObject({ key: cleave.key, viaPriority: false })
  })
  it('선공기 변동 판정 전이면 결정을 미룬다(need)', () => {
    const { sucker, items } = build({ kind: 'pending' })
    expect(pick(items, true)).toEqual({ kind: 'pending', need: [sucker.key] })
  })
})

describe('compareItems: 가장 세게 치는 순(R3, PRD AC2)', () => {
  it('1타 확률 → 최대 대미지 비율 → 같은 기술 랭크 전 먼저 → 기술 순 / 계산 불가는 정상 뒤·무효 앞, 무효는 맨 뒤', () => {
    const a = item('a', true, ok(0.5, 100), VAR, { moveOrder: 0 })
    const b = item('b', true, ok(0.75, 90), VAR, { moveOrder: 1 })
    const c = item('c', true, ok(0.5, 120), VAR, { moveOrder: 2 })
    const cRank = item('c', false, ok(0.5, 120), VAR, { moveOrder: 2 })
    const err = item('e', true, error, { kind: 'error', reason: error.reason }, { moveOrder: 3 })
    const imm = item('i', true, immune, SURVIVE, { moveOrder: 4 })
    const sorted = [imm, err, a, cRank, b, c].sort(compareItems).map((i) => i.key)
    expect(sorted).toEqual([b.key, c.key, cRank.key, a.key, err.key, imm.key])
  })
  it('정상 항목이 하나도 없으면 정렬 첫 항목(계산 불가)이 기본', () => {
    const err = item('e', true, error, { kind: 'error', reason: error.reason })
    const imm = item('i', true, immune, SURVIVE)
    expect(pick([imm, err])).toMatchObject({ kind: 'ready', key: err.key })
  })
})

const sp = (patch: Partial<SpTable>): SpTable => ({ hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...patch })
const mon = (s: Omit<PokemonSet, 'regulation' | 'sp'> & { sp: Partial<SpTable> }): PokemonSet => ({ regulation: 'm-c', ...s, sp: sp(s.sp) })

describe('outspeedsAtMax: 선공기 우선의 스피드 조건(R4-2, PRD AC8)', () => {
  const { game } = realData()
  const jollyChomp = mon({ species: 'garchomp', ability: 'roughskin', nature: 'jolly', sp: { spe: 32 }, moves: ['earthquake'] })
  it('(a) 상대가 S 최대·상승 성격이어도 내가 더 빠르면 참', () => {
    const slow = mon({ species: 'kingambit', ability: 'defiant', nature: 'adamant', sp: { atk: 32 }, moves: ['kowtowcleave'] })
    expect(outspeedsAtMax(game, EXAMPLE_SET, slow)).toBe(true)
  })
  it('(b) 동속(같은 종 S 최대·상승)이면 거짓', () => {
    const other = mon({ species: 'garchomp', ability: 'roughskin', nature: 'adamant', sp: { atk: 32 }, moves: ['earthquake'] })
    expect(outspeedsAtMax(game, jollyChomp, other)).toBe(false)
  })
  it('(c) 상대가 더 빠를 수 있으면 거짓', () => {
    const slowMe = mon({ species: 'kingambit', ability: 'defiant', nature: 'adamant', sp: { atk: 32 }, moves: ['kowtowcleave'] })
    expect(outspeedsAtMax(game, slowMe, jollyChomp)).toBe(false)
  })
  it('(e) 상대 구애스카프는 빼고 비교한다', () => {
    const scarfed = mon({ species: 'incineroar', ability: 'intimidate', item: 'choicescarf', nature: 'adamant', sp: { atk: 32 }, moves: ['fakeout'] })
    const fastest = { ...scarfed, nature: 'jolly', sp: sp({ atk: 32, spe: 32 }) }
    // 스카프를 지닌 채 비교하면 상대가 더 빠르다(이 사례의 전제)
    expect(compareSpeed(game, EXAMPLE_SET, fastest, undefined, { ignoreSpTotal: true }).order).toBe('second')
    expect(outspeedsAtMax(game, EXAMPLE_SET, scarfed)).toBe(true)
  })
  it('(f) 판정 조건(공격측 상대 특성 날씨)의 날씨로 양쪽 스피드를 비교하고, 어느 쪽이든 구름보기면 날씨 없음(R12, PRD AC34)', () => {
    const venu = mon({ species: 'venusaur', ability: 'chlorophyll', nature: 'timid', sp: { spa: 32, spe: 32 }, moves: ['gigadrain'] })
    const nine = mon({ species: 'ninetales', ability: 'drought', nature: 'modest', sp: { spa: 32 }, moves: ['heatwave'] })
    const sun = { attacker: { tailwind: false }, defender: { tailwind: false }, weather: 'Sun' as const }
    expect(outspeedsAtMax(game, venu, nine)).toBe(false)
    expect(outspeedsAtMax(game, venu, nine, sun)).toBe(true)
    const altaria = mon({ species: 'altaria', ability: 'cloudnine', nature: 'modest', sp: { spa: 32 }, moves: ['dracometeor'] })
    expect(outspeedsAtMax(game, venu, altaria, sun)).toBe(false)
    expect(outspeedsAtMax(game, venu, { ...altaria, ability: 'naturalcure' }, sun)).toBe(true)
  })
})

describe('실데이터: 목록·기본 항목·직접 선택', () => {
  const floette = mon({ species: 'floetteeternal', ability: 'flowerveil', nature: 'modest', sp: { hp: 2, spa: 32, spe: 32 }, moves: ['moonblast', 'dazzlinggleam', 'calmmind', 'protect'] })
  const only = (id: string) => ({ topN: 30, selected: [id] })

  it('공격 탭 명상 플라엣테: 목록 = 문포스·매지컬샤인·+1 문포스·+1 매지컬샤인(변화기 없음, PRD AC1)', () => {
    const v = buildTabView(cardInput({ mySet: floette, filters: only('kingambit') }), 'attack')
    const card = v.cards.find((c) => c.opponent.id === 'kingambit')
    expect(card).toBeDefined()
    const rank = JSON.stringify(['rank', 'me', 'move', 'calmmind'])
    expect(new Set(card?.items.map((i) => i.key))).toEqual(
      new Set([itemKey('moonblast', BASE_CONDITION_ID), itemKey('dazzlinggleam', BASE_CONDITION_ID), itemKey('moonblast', rank), itemKey('dazzlinggleam', rank)]),
    )
    expect(card?.items.find((i) => i.key === itemKey('moonblast', rank))?.basis?.myBoosts.spa).toBe(1)
  })

  it('방어 탭 대도각참: 상대 칼춤 랭크 후 항목이 있고 내 방어 랭크업 항목은 없다, 도각참 확정견딤·+2 변동 → 기본 +2 도각참(PRD AC3·AC5)', () => {
    const v = buildTabView(cardInput({ mySet: EXAMPLE_SET, filters: only('kingambit') }), 'defense')
    const card = v.cards.find((c) => c.opponent.id === 'kingambit' && c.category === 'physical')
    expect(card).toBeDefined()
    const sd = JSON.stringify(['rank', 'opponent', 'move', 'swordsdance'])
    expect(card?.items.some((i) => i.key === itemKey('kowtowcleave', sd))).toBe(true)
    expect(card?.items.every((i) => i.basis === undefined || i.basis.owner === 'opponent')).toBe(true)
    expect(card?.defaultItem?.key).toBe(itemKey('kowtowcleave', sd))
    expect(card?.shownItem).toBe(itemKey('kowtowcleave', sd))
    expect(card?.selected).toBe(false)
    expect(card?.variable).toBe(true)
    // 보이는 항목 하나의 H 행·B 행(랭크 행·선공기 행은 따로 없다, PRD AC15)
    expect(card?.rows.map((r) => [r.moveId, r.kind, r.sweepStat])).toEqual([
      ['kowtowcleave', 'rank', 'hp'],
      ['kowtowcleave', 'rank', 'def'],
    ])
  })

  it('직접 고른 항목이 보이는 항목이 되고(selected), 기본 항목은 그대로 남는다(PRD R5)', () => {
    const chosen = itemKey('kowtowcleave', BASE_CONDITION_ID)
    const sel = new Map([[opponentKey({ source: 'ladder', id: 'kingambit' }), chosen]])
    const v = buildTabView(cardInput({ mySet: EXAMPLE_SET, filters: only('kingambit') }), 'defense', undefined, sel)
    const card = v.cards.find((c) => c.opponent.id === 'kingambit' && c.category === 'physical')
    expect(card?.shownItem).toBe(chosen)
    expect(card?.selected).toBe(true)
    expect(card?.defaultItem?.key).toBe(itemKey('kowtowcleave', JSON.stringify(['rank', 'opponent', 'move', 'swordsdance'])))
    expect(card?.rows.every((r) => r.moveId === 'kowtowcleave' && r.kind !== 'rank')).toBe(true)
  })

  it('그 카드에 없는 항목 키는 무시하고 기본 항목을 보인다(다른 분류 항목 선택은 그 분류 배분에서만)', () => {
    const sel = new Map([[opponentKey({ source: 'ladder', id: 'kingambit' }), itemKey('nonexistent', BASE_CONDITION_ID)]])
    const v = buildTabView(cardInput({ mySet: EXAMPLE_SET, filters: only('kingambit') }), 'defense', undefined, sel)
    const card = v.cards.find((c) => c.opponent.id === 'kingambit' && c.category === 'physical')
    expect(card?.selected).toBe(false)
    expect(card?.shownItem).toBe(card?.defaultItem?.key)
  })
})

describe('기술 선택 메뉴 항목의 변동 판정(PRD R3 변동 배지, AC36)', () => {
  const only = (id: string) => ({ topN: 30, selected: [id] })
  /** 실행기 수요 없이(기본 항목 결정 집합만) 끝까지 계산한 계획·결과 */
  function settled(input: CardInput, tab: Tab) {
    const plan = planTab(input, tab)
    const results = new Map<string, RowTaskResult>()
    for (;;) {
      const stage = nextStage(pendingTasks(plan, results))
      if (stage.length === 0) return { plan, results }
      for (const t of stage) results.set(taskKey(t), computeRowTask(plan, t))
    }
  }
  /** 연 카드의 메뉴 작업을 끝까지 계산한다(그 카드 작업만, 반환 = 계산한 작업 수) */
  function explore(plan: TabPlan, results: Map<string, RowTaskResult>, cardId: string): number {
    const card = plan.cards.find((c) => c.id === cardId) as CardSpec
    let n = 0
    for (;;) {
      const stage = nextStage(cardExplore(plan, card, results))
      if (stage.length === 0) return n
      for (const t of stage) {
        expect(taskCardId(plan, t)).toBe(cardId)
        results.set(taskKey(t), computeRowTask(plan, t))
        n++
      }
    }
  }
  const withoutVariable = (c: CardView) =>
    ({
      ...c,
      items: c.items.map((i) => {
        const rest = { ...i }
        delete rest.variable
        return rest
      }),
    })

  it('방어 탭 대도각참: 기본 결정만으로는 변동 판정이 없는 항목이 있고, 메뉴 작업을 돌리면 그 카드 모든 정상 항목이 변동/고정으로 정해진다(보이는 항목·기본 항목·행은 그대로)', () => {
    const { plan, results } = settled(cardInput({ mySet: EXAMPLE_SET, filters: only('kingambit') }), 'defense')
    const before = assembleTab(plan, results)
    const card = before.cards.find((c) => c.opponent.id === 'kingambit' && c.category === 'physical' && c.berry === undefined) as CardView
    expect(card).toBeDefined()
    expect(card.items.some((i) => i.status === 'ok' && i.variable === undefined)).toBe(true)
    // 이미 정해진 보이는 항목은 카드 "변동 가능"과 같다
    expect(card.items.find((i) => i.key === card.shownItem)?.variable).toBe(card.variable)
    const others = before.cards.filter((c) => c.id !== card.id)

    expect(explore(plan, results, card.id)).toBeGreaterThan(0)
    const after = assembleTab(plan, results)
    const opened = after.cards.find((c) => c.id === card.id) as CardView
    for (const i of opened.items) {
      if (i.status === 'ok' || i.status === 'immune') expect(typeof i.variable, i.key).toBe('boolean')
      else expect(i.variable, i.key).toBeUndefined()
    }
    expect(opened.items.filter((i) => i.variable === true).length).toBeGreaterThan(0)
    expect(opened.items.filter((i) => i.variable === false).length).toBeGreaterThan(0)
    expect(withoutVariable(opened)).toEqual(withoutVariable(card))
    // 메뉴를 열지 않은 카드는 그대로다
    expect(after.cards.filter((c) => c.id !== card.id)).toEqual(others)
    // 다 계산한 뒤에는 남은 메뉴 작업이 없고, 기본 남은 작업(pendingTasks)도 새로 생기지 않는다
    expect(nextStage(cardExplore(plan, plan.cards.find((c) => c.id === card.id) as CardSpec, results))).toEqual([])
    expect(nextStage(pendingTasks(plan, results))).toEqual([])
  })

  it('후보 없는 카드(스피드 탭)는 메뉴 작업이 없다', () => {
    const plan = planTab(cardInput({ mySet: EXAMPLE_SET, filters: only('kingambit') }), 'speed')
    expect(plan.cards.length).toBeGreaterThan(0)
    for (const c of plan.cards) expect(cardExplore(plan, c, new Map())).toEqual({ stage1: [], stage2: [], stage3: [], stage4: [], stage5: [] })
  })
})
