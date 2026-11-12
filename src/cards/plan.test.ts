import { describe, expect, it } from 'vitest'
import { validateSet, type PokemonSet } from '../core'
import type { MetaEntry } from '../data/meta-schema'
import { addedBundleCardId, cardId, presetKey } from './ids'
import { DEFENSE_MOVES, defenseMoveIds, planTab } from './plan'
import { buildTabView } from './batch'
import { defaultOption, groupCards } from './groups'
import { cardInput, realData, syntheticEntry, syntheticView } from './testing'
import { DEFAULT_CRITERIA, type AddedBundle, type CardInput, type CardSpec, type RowSpec, type TabPlan } from './types'

const { game, bo1 } = realData()
const ZERO = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }
const mk = (species: string, ability: string, moves: string[], extra: Partial<PokemonSet> = {}): PokemonSet => ({
  regulation: 'm-c',
  species,
  ability,
  nature: 'jolly',
  sp: { ...ZERO, hp: 2, atk: 32, spe: 32 },
  moves,
  ...extra,
})

/** 혼합 세트: 물리 2(지진·드래곤크루), 특수 1(화염방사), 변화기 1(칼춤) */
const GARCHOMP = mk('garchomp', 'roughskin', ['earthquake', 'dragonclaw', 'swordsdance', 'flamethrower'])
const PLAIN = mk('garchomp', 'roughskin', ['earthquake', 'flamethrower'])

const rowsOf = (plan: TabPlan, card: CardSpec): RowSpec[] => card.rowIds.map((id) => plan.rows[id])
const cardsOf = (plan: TabPlan, id: string): CardSpec[] => plan.cards.filter((c) => c.opponent.id === id)
const input = (partial: Partial<CardInput> & { mySet: PokemonSet }) => cardInput({ filters: { topN: 10, selected: [] }, ...partial })
const entryOf = (id: string): MetaEntry => bo1.entry(id) as MetaEntry

describe('planTab: 내 세트', () => {
  it('내 세트가 무효면 그 탭 my-set-error, 카드 없음(이유는 CoreError detail 그대로)', () => {
    const bad = { ...PLAIN, sp: { ...PLAIN.sp, def: 40 } }
    for (const tab of ['attack', 'defense', 'speed'] as const) {
      const plan = planTab(input({ mySet: bad }), tab)
      expect(plan.status).toEqual({
        kind: 'my-set-error',
        reasons: [expect.objectContaining({ code: 'INVALID_SP', field: 'sp.def' })],
      })
      expect(plan.cards).toEqual([])
    }
  })

  it('스피드 비교 불가 도구(선제공격손톱)는 스피드 탭만 my-set-error(INPUT·field item)', () => {
    const set = { ...PLAIN, item: 'quickclaw' }
    expect(planTab(input({ mySet: set }), 'attack').status.kind).toBe('ok')
    expect(planTab(input({ mySet: set }), 'speed').status).toEqual({
      kind: 'my-set-error',
      reasons: [expect.objectContaining({ code: 'INPUT', field: 'item' })],
    })
  })

  it('내 세트 boosts는 0으로 계획한다', () => {
    const plan = planTab(input({ mySet: { ...PLAIN, boosts: { atk: 6 } } }), 'attack')
    for (const r of Object.values(plan.rows)) if (r.kind === 'base') expect(r.attacker.boosts).toBeUndefined()
  })

  it('계획 머리: 출처·예산·mySide·mySp', () => {
    const plan = planTab(input({ mySet: PLAIN }), 'defense')
    expect(plan).toMatchObject({
      tab: 'defense',
      mySide: 'defender',
      mySp: PLAIN.sp,
      spTotal: game.manifest.rules.spTotal,
      spMaxPerStat: game.manifest.rules.spMaxPerStat,
      source: { match: 'bo1', month: bo1.meta.manifest.month, cutoff: bo1.meta.manifest.source.cutoff, format: bo1.meta.manifest.source.format },
    })
    expect(planTab(input({ mySet: PLAIN }), 'speed').mySide).toBe('attacker')
  })
})

describe('planTab: 공격 탭', () => {
  const plan = planTab(input({ mySet: GARCHOMP }), 'attack')

  it('카드 = 상대 묶음 × 기술 분류(기준 5% 이상 전부, 상한 없음), 묶음 키는 H + 상대 방어 능력치', () => {
    const top = bo1.ranking.slice(0, 10).map((e) => e.id)
    expect([...new Set(plan.cards.map((c) => c.opponent.id))]).toEqual(top)
    let over3 = 0
    for (const id of top) {
      const cards = cardsOf(plan, id)
      for (const cat of ['physical', 'special'] as const) {
        const inCat = cards.filter((c) => c.category === cat)
        expect(inCat.length).toBeGreaterThanOrEqual(1)
        if (inCat.length > 3) over3++
        for (const c of inCat) {
          expect(c.bundle.stats.map((s) => s.stat)).toEqual(['hp', cat === 'physical' ? 'def' : 'spd'])
          expect(c.bundle.minority || (c.bundle.share as number) >= DEFAULT_CRITERIA.bundleShareMin).toBe(true)
        }
      }
    }
    expect(over3).toBeGreaterThan(0)
  })

  it('행 = 그 분류의 내 공격기(슬롯 순), 변화기 없음, 스윕 = 내 공격 능력치', () => {
    const phys = plan.cards.find((c) => c.category === 'physical' && c.state === 'ok') as CardSpec
    expect(rowsOf(plan, phys).map((r) => [r.kind, r.moveId, r.sweep])).toEqual([
      ['base', 'earthquake', { side: 'attacker', stat: 'atk' }],
      ['base', 'dragonclaw', { side: 'attacker', stat: 'atk' }],
      ['rank', 'earthquake', { side: 'attacker', stat: 'atk' }],
      ['rank', 'dragonclaw', { side: 'attacker', stat: 'atk' }],
    ])
    const spec = plan.cards.find((c) => c.category === 'special' && c.state === 'ok') as CardSpec
    expect(rowsOf(plan, spec).map((r) => [r.kind, r.moveId, r.sweep?.stat])).toEqual([['base', 'flamethrower', 'spa']])
  })

  it('내 칼춤 → 물리 카드 전부 랭크 행(A+2, 내 세트 = share 없음), 특수 카드엔 없음', () => {
    for (const c of plan.cards.filter((x) => x.state === 'ok')) {
      const sd = rowsOf(plan, c).filter((r) => r.basis?.kind === 'rank' && r.basis.means.id === 'swordsdance')
      if (c.category === 'physical') {
        expect(sd.length).toBe(2)
        for (const r of sd) {
          expect(r.basis).toMatchObject({ owner: 'me', myBoosts: { atk: 2 }, opponentBoosts: {} })
          expect(r.basis && 'share' in r.basis).toBe(false)
          expect(r.attacker.boosts).toEqual({ atk: 2 })
        }
      } else expect(sd).toEqual([])
    }
  })

  it('상대 위협(점유율 ≥ 기준) → 물리 카드 랭크 행, 상대 수단이 내 수단보다 앞', () => {
    const inc = cardsOf(plan, 'incineroar').filter((c) => c.category === 'physical' && c.state === 'ok')
    expect(inc.length).toBeGreaterThan(0)
    for (const c of inc) {
      const means = rowsOf(plan, c)
        .filter((r) => r.kind === 'rank' && r.moveId === 'earthquake')
        .map((r) => (r.basis?.kind === 'rank' ? [r.basis.owner, r.basis.means.id, r.basis.share] : null))
      expect(means).toEqual([
        ['opponent', 'intimidate', entryOf('incineroar').abilities.intimidate],
        ['opponent', 'partingshot', entryOf('incineroar').moves.shares.partingshot],
        ['me', 'swordsdance', undefined],
      ])
    }
  })

  it('랭크 기준 경계: 점유율과 같으면 포함, 기준을 올리면 빠진다', () => {
    const share = entryOf('incineroar').abilities.intimidate
    const has = (rankShareMin: number) => {
      const p = planTab(input({ mySet: PLAIN, criteria: { ...input({ mySet: PLAIN }).criteria, rankShareMin } }), 'attack')
      return Object.values(p.rows).some((r) => r.basis?.kind === 'rank' && r.basis.means.id === 'intimidate')
    }
    expect(has(share)).toBe(true)
    expect(has(share + 0.0001)).toBe(false)
  })

  it('내 오기 × 상대 위협 = A+1(반응 기록)', () => {
    const mine = mk('kingambit', 'defiant', ['kowtowcleave', 'suckerpunch'], { nature: 'adamant' })
    const p = planTab(input({ mySet: mine }), 'attack')
    const r = Object.values(p.rows).find((x) => x.basis?.kind === 'rank' && x.basis.means.id === 'intimidate') as RowSpec
    expect(r.basis).toMatchObject({ myBoosts: { atk: 1 }, reactions: ['defiant'] })
    const plain = planTab(input({ mySet: mk('kingambit', 'pressure', ['kowtowcleave'], { nature: 'adamant' }) }), 'attack')
    const q = Object.values(plain.rows).find((x) => x.basis?.kind === 'rank' && x.basis.means.id === 'intimidate') as RowSpec
    expect(q.basis).toMatchObject({ myBoosts: { atk: -1 }, reactions: [] })
  })

  it('사이코쇼크는 물리 카드(상대 H·B)에 들고 스윕은 내 C', () => {
    const p = planTab(input({ mySet: mk('clefable', 'magicguard', ['psyshock', 'moonblast'], { nature: 'modest' }) }), 'attack')
    const phys = p.cards.filter((c) => c.category === 'physical' && c.state === 'ok')
    expect(phys.length).toBeGreaterThan(0)
    const base = (c: CardSpec) => rowsOf(p, c).filter((r) => r.kind === 'base')
    for (const c of phys) expect(base(c).map((r) => [r.moveId, r.sweep?.stat, r.refs?.defense])).toEqual([['psyshock', 'spa', 'def']])
    for (const c of p.cards.filter((x) => x.category === 'special' && x.state === 'ok')) {
      expect(base(c).map((r) => r.moveId)).toEqual(['moonblast'])
    }
  })

  it('내 속임수는 행 없이 그 분류 카드의 고정 판정', () => {
    const p = planTab(input({ mySet: mk('kingambit', 'pressure', ['foulplay', 'kowtowcleave'], { nature: 'adamant' }) }), 'attack')
    const c = p.cards.find((x) => x.state === 'ok') as CardSpec
    expect(c.category).toBe('physical')
    expect(rowsOf(p, c).every((r) => r.moveId === 'kowtowcleave')).toBe(true)
    expect(c.fixedIds.map((id) => p.fixed[id].moveId)).toEqual(['foulplay'])
    expect(p.fixed[c.fixedIds[0]]).toMatchObject({ cardId: c.id, defender: c.opponentSet })
  })

  it('내 셸암즈 → 행·카드 없이 탭 안내', () => {
    const p = planTab(input({ mySet: mk('slowbrogalar', 'quickdraw', ['shellsidearm', 'psyshock'], { nature: 'modest' }) }), 'attack')
    expect(p.notices).toEqual([{ kind: 'category-varies', moveId: 'shellsidearm', owner: 'me' }])
    expect(Object.values(p.rows).some((r) => r.moveId === 'shellsidearm')).toBe(false)
    expect(p.cards.every((c) => c.category === 'physical')).toBe(true)
  })

  it('내 목숨걸기(대미지 = 내 HP) → 행·카드 없이 탭 안내', () => {
    const p = planTab(input({ mySet: mk('lucario', 'justified', ['finalgambit', 'closecombat'], { nature: 'adamant' }) }), 'attack')
    expect(p.notices).toEqual([{ kind: 'attacker-hp-dependent', moveId: 'finalgambit', owner: 'me' }])
    expect(Object.values(p.rows).some((r) => r.moveId === 'finalgambit')).toBe(false)
    expect(Object.values(p.fixed).some((f) => f.moveId === 'finalgambit')).toBe(false)
    expect(p.cards.length).toBeGreaterThan(0)
    expect(p.cards.every((c) => c.category === 'physical')).toBe(true)
  })

  it('하양허브를 소비한 랭크 행의 연속기는 계산 불가 행, 다른 기술은 그대로', () => {
    const mine = mk('barbaracle', 'toughclaws', ['shellsmash', 'rockblast', 'stoneedge'], { item: 'whiteherb', nature: 'adamant' })
    const p = planTab(input({ mySet: mine }), 'attack')
    const rank = Object.values(p.rows).filter((r) => r.basis?.kind === 'rank' && r.basis.means.id === 'shellsmash')
    expect(rank.length).toBeGreaterThan(0)
    for (const r of rank) {
      expect(r.basis).toMatchObject({ myBoosts: { atk: 2, spa: 2, spe: 2 }, reactions: ['whiteherb'] })
      if (r.moveId === 'rockblast') {
        expect(r.error?.code).toBe('WHITE_HERB_MULTIHIT')
        expect(r.sweep).toBeUndefined()
      } else expect(r.error).toBeUndefined()
    }
    expect(Object.values(p.rows).filter((r) => r.kind === 'base').every((r) => r.error === undefined)).toBe(true)
  })

  it('관여 능력치 S는 스피드 의존 기술 행에만 든다', () => {
    const mine = mk('archaludon', 'stamina', ['gyroball', 'flashcannon'], { nature: 'brave', sp: { ...ZERO, hp: 32, atk: 32 } })
    const p = planTab(input({ mySet: mine }), 'attack')
    expect(p.status.kind).toBe('ok')
    const base = Object.values(p.rows).filter((r) => r.kind === 'base')
    expect(base.length).toBeGreaterThan(0)
    for (const r of base) {
      if (r.moveId === 'gyroball') expect([r.sweep?.stat, r.dependsOn]).toEqual(['atk', ['spe']])
      else expect([r.sweep?.stat, r.dependsOn]).toEqual(['spa', []])
    }
  })

  it('조건: 순풍 토글은 스피드 탭 전용이라 공격 탭은 순풍 없음으로 계산한다', () => {
    const p = planTab(input({ mySet: PLAIN, conditions: { myTailwind: true, opponentTailwind: true } }), 'attack')
    expect(Object.values(p.rows).length).toBeGreaterThan(0)
    for (const r of Object.values(p.rows)) expect(r.conditions).toEqual({ attacker: { tailwind: false }, defender: { tailwind: false } })
  })

  it('조건: 스피드 탭은 attacker(나) 순풍 = 내 순풍, defender 순풍 = 상대 순풍', () => {
    const p = planTab(input({ mySet: PLAIN, conditions: { myTailwind: true, opponentTailwind: false } }), 'speed')
    expect(Object.values(p.rows).length).toBeGreaterThan(0)
    for (const r of Object.values(p.rows)) expect(r.conditions).toEqual({ attacker: { tailwind: true }, defender: { tailwind: false } })
  })

  it('정렬: 사용률 내림 → 종 id → 기본 카드 → 반감열매 변형(열매 점유율 내림) → 분류(물리 → 특수) → 묶음 점유율 내림, order = 인덱스', () => {
    plan.cards.forEach((c, i) => expect(c.order).toBe(i))
    const cat = (c: CardSpec) => (c.category === 'physical' ? 0 : 1)
    const berry = (a: CardSpec, b: CardSpec) =>
      a.berry === undefined || b.berry === undefined
        ? (a.berry === undefined ? 0 : 1) - (b.berry === undefined ? 0 : 1)
        : b.berry.share - a.berry.share || (a.berry.item < b.berry.item ? -1 : a.berry.item > b.berry.item ? 1 : 0)
    for (let i = 1; i < plan.cards.length; i++) {
      const a = plan.cards[i - 1]
      const b = plan.cards[i]
      const ua = a.opponent.usage as number
      const ub = b.opponent.usage as number
      const cmp =
        ub - ua ||
        (a.opponent.id < b.opponent.id ? -1 : a.opponent.id > b.opponent.id ? 1 : 0) ||
        berry(a, b) ||
        cat(a) - cat(b) ||
        (b.bundle.share ?? 0) - (a.bundle.share ?? 0)
      expect(cmp).toBeLessThanOrEqual(0)
    }
  })

  it('카드 id = 튜플(탭·출처·상대·분류·묶음 키), 행 id·카드 id는 계획 안에서 유일', () => {
    const c = plan.cards[0]
    expect(c.id).toBe(cardId(['attack', 'ladder', c.opponent.id, c.category, c.bundle.key]))
    expect(new Set(plan.cards.map((x) => x.id)).size).toBe(plan.cards.length)
    const rowIds = plan.cards.flatMap((x) => x.rowIds)
    expect(new Set(rowIds).size).toBe(rowIds.length)
    expect(Object.keys(plan.rows).length).toBe(rowIds.length)
    for (const x of plan.cards) rowsOf(plan, x).forEach((r, i) => expect([r.cardId, r.order]).toEqual([x.id, i]))
  })

  it('래더 카드 머리·대표 = 묶음 대표 보존 배분의 관측 배분 가정', () => {
    const c = plan.cards[0]
    const e = entryOf(c.opponent.id)
    expect(c.opponent).toEqual({ id: e.id, source: 'ladder', rank: e.rank, usage: e.usage })
    expect(c.bundle.retention).toBe(e.spreads.keptShare)
    const [nature, sp] = (c.bundle.representativeSpread as string).split(':')
    const [hp, atk, def, spa, spd, spe] = sp.split('/').map(Number)
    expect(c.opponentSet).toMatchObject({ nature, sp: { hp, atk, def, spa, spd, spe } })
  })
})

describe('planTab: 방어 탭', () => {
  const plan = planTab(input({ mySet: PLAIN }), 'defense')

  it('상대 기술 = 변화기 뺀 점유율 상위 5, 기술 × 묶음마다 극단 필터 + 그 필터를 gate로 둔 H·B/D 행', () => {
    const e = entryOf('kingambit')
    const moves = defenseMoveIds(game, e)
    expect(moves).toEqual(['kowtowcleave', 'suckerpunch', 'ironhead', 'lowkick'])
    for (const c of cardsOf(plan, 'kingambit').filter((x) => x.state === 'ok')) {
      expect(c.category).toBe('physical')
      expect(c.bundle.stats.map((s) => s.stat)).toEqual(['atk'])
      const base = rowsOf(plan, c).filter((r) => r.kind === 'base')
      expect(base.map((r) => [r.moveId, r.sweep])).toEqual(
        moves.flatMap((m) => [
          [m, { side: 'defender', stat: 'hp' }],
          [m, { side: 'defender', stat: 'def' }],
        ]),
      )
      for (const r of base) {
        const f = plan.filters[r.gate as string]
        expect(f).toMatchObject({ moveId: r.moveId, cardId: c.id, stats: ['hp', 'def'], dependsOn: [] })
        expect(r.attacker).toBe(c.opponentSet)
        expect(r.dependsOn).toEqual(r.sweep?.stat === 'hp' ? ['def'] : ['hp'])
      }
    }
  })

  it('특수 기술만 쓰는 상대는 특수 카드, 묶음 키 = 상대 C', () => {
    const cards = cardsOf(plan, 'charizardmegay').filter((c) => c.state === 'ok')
    expect(cards.length).toBeGreaterThan(0)
    for (const c of cards) {
      expect(c.category).toBe('special')
      expect(c.bundle.stats.map((s) => s.stat)).toEqual(['spa'])
      expect(rowsOf(plan, c).filter((r) => r.kind === 'base').map((r) => r.sweep?.stat)).toContain('spd')
    }
  })

  it('상위 5 경계: 변화기 제외 후 5개까지만(부족하면 있는 만큼)', () => {
    for (const e of bo1.ranking.slice(0, 10)) {
      const ids = defenseMoveIds(game, e)
      expect(ids.length).toBeLessThanOrEqual(DEFENSE_MOVES)
      for (const id of ids) expect(game.data.moves[id].category).not.toBe('Status')
    }
  })

  it('상대 칼춤(≥10%) → 방어 탭 물리 카드 랭크 행 + 랭크 행 전용 극단 필터', () => {
    const c = cardsOf(plan, 'kingambit').find((x) => x.state === 'ok') as CardSpec
    const rank = rowsOf(plan, c).filter((r) => r.kind === 'rank')
    expect(rank.length).toBe(8)
    for (const r of rank) {
      expect(r.basis).toMatchObject({ owner: 'opponent', means: { id: 'swordsdance' }, opponentBoosts: { atk: 2 } })
      expect(r.attacker.boosts).toEqual({ atk: 2 })
      const f = plan.filters[r.gate as string]
      expect(f.basis).toBe(r.basis)
    }
    expect(c.filterIds.length).toBe(8)
    expect(c.filterIds.map((id) => plan.filters[id].order)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
  })

  it('조건: 방어 탭도 순풍 없음으로 계산한다(순풍 토글은 스피드 탭 전용)', () => {
    const p = planTab(input({ mySet: PLAIN, conditions: { myTailwind: true, opponentTailwind: true } }), 'defense')
    expect(Object.values(p.rows).length).toBeGreaterThan(0)
    for (const r of Object.values(p.rows)) expect(r.conditions).toEqual({ attacker: { tailwind: false }, defender: { tailwind: false } })
  })

  it('상대 속임수 행은 내 A에 의존하고 묶음 키에 보태지 않는다', () => {
    const base = entryOf('kingambit')
    const e = syntheticEntry(base, { id: 'kingambit', moves: { shares: { foulplay: 0.9, kowtowcleave: 0.8 }, keptShare: 1.7, excludedShare: 0 } })
    const view = syntheticView(game, bo1.meta, [e])
    const p = planTab(input({ mySet: PLAIN, view }), 'defense')
    const c = p.cards.find((x) => x.state === 'ok') as CardSpec
    expect(c.bundle.stats.map((s) => s.stat)).toEqual(['atk'])
    const foul = rowsOf(p, c).filter((r) => r.moveId === 'foulplay' && r.kind === 'base')
    expect(foul.map((r) => r.dependsOn)).toEqual([
      ['atk', 'def'],
      ['hp', 'atk'],
    ])
  })

  it('상대 목숨걸기(대미지 = 상대 HP)는 묶음 키에 상대 H를 보탠다', () => {
    const base = entryOf('lucariomegaz')
    const e = syntheticEntry(base, { moves: { shares: { finalgambit: 0.9 }, keptShare: 0.9, excludedShare: 0 } })
    const p = planTab(input({ mySet: PLAIN, view: syntheticView(game, bo1.meta, [e]) }), 'defense')
    const cs = p.cards.filter((x) => x.state === 'ok')
    expect(cs.length).toBeGreaterThan(0)
    for (const c of cs) expect(c.bundle.stats.map((s) => s.stat)).toEqual(['hp', 'spa'])
  })

  it('상대 셸암즈 → 그 상대 모든 카드 머리 안내, 자리는 다음 순위로 채우지 않음', () => {
    const base = entryOf('kingambit')
    const shares = { shellsidearm: 0.99, kowtowcleave: 0.9, suckerpunch: 0.8, ironhead: 0.7, lowkick: 0.6, rockslide: 0.5 }
    const e = syntheticEntry(base, { moves: { shares, keptShare: 4.5, excludedShare: 0 } })
    const view = syntheticView(game, bo1.meta, [e])
    const p = planTab(input({ mySet: PLAIN, view }), 'defense')
    expect(p.cards.length).toBeGreaterThan(0)
    for (const c of p.cards) expect(c.notices).toEqual([{ kind: 'category-varies', moveId: 'shellsidearm', owner: 'opponent' }])
    const moves = new Set(Object.values(p.rows).map((r) => r.moveId))
    expect(moves).toEqual(new Set(['kowtowcleave', 'suckerpunch', 'ironhead', 'lowkick']))
    expect(p.notices).toEqual([])
  })

  it('스냅샷에 없는 상대 기술은 그 자리 계산 불가 행(다음 순위로 채우지 않음)', () => {
    const base = entryOf('kingambit')
    const shares = { notamove: 0.99, kowtowcleave: 0.9, suckerpunch: 0.8, ironhead: 0.7, lowkick: 0.6, rockslide: 0.5 }
    const view = syntheticView(game, bo1.meta, [syntheticEntry(base, { moves: { shares, keptShare: 4.5, excludedShare: 0 } })])
    const p = planTab(input({ mySet: PLAIN, view }), 'defense')
    for (const c of p.cards.filter((x) => x.state === 'ok')) {
      const err = rowsOf(p, c).filter((r) => r.error)
      expect(err.map((r) => [r.moveId, r.error?.code, r.gate, r.sweep])).toEqual([['notamove', 'UNKNOWN_MOVE', undefined, undefined]])
    }
    expect(Object.values(p.rows).some((r) => r.moveId === 'rockslide')).toBe(false)
  })

  it('내 위협 × 상대 오기(키라플로르 대신 대도각참) → 상대 A+1 랭크 행', () => {
    const mine = mk('incineroar', 'intimidate', ['flareblitz'], { nature: 'careful', sp: { ...ZERO, hp: 32, spd: 32 } })
    const p = planTab(input({ mySet: mine }), 'defense')
    const c = cardsOf(p, 'kingambit').find((x) => x.state === 'ok') as CardSpec
    const r = rowsOf(p, c).find((x) => x.basis?.kind === 'rank' && x.basis.means.id === 'intimidate') as RowSpec
    expect(r.basis).toMatchObject({ owner: 'me', opponentBoosts: { atk: 1 }, reactions: ['defiant'] })
  })
})

describe('planTab: 스피드 탭', () => {
  const plan = planTab(input({ mySet: PLAIN }), 'speed')
  const scarfRows = (p: TabPlan, id: string) =>
    cardsOf(p, id).flatMap((c) => rowsOf(p, c).filter((r) => r.kind === 'scarf' || r.kind === 'non-scarf'))

  it('카드마다 기본 행 1개(판정 speed, 스윕 내 S), 분류 null, 묶음 키 S', () => {
    for (const c of plan.cards.filter((x) => x.state === 'ok')) {
      expect(c.category).toBeNull()
      expect(c.bundle.stats.map((s) => s.stat)).toEqual(['spe'])
      const base = rowsOf(plan, c).filter((r) => r.kind === 'base')
      expect(base.map((r) => [r.judge, r.sweep, r.moveId, r.dependsOn])).toEqual([['speed', { side: 'attacker', stat: 'spe' }, undefined, []]])
      expect(base[0].defender).toBe(c.opponentSet)
    }
  })

  it('대표 도구가 스카프면 스카프 아닌 최다 도구 행(그 종 첫 카드만)', () => {
    const rows = scarfRows(plan, 'garchomp')
    const first = cardsOf(plan, 'garchomp')[0]
    expect(first.opponentSet.item).toBe('choicescarf')
    expect(rows.map((r) => [r.kind, r.cardId, r.basis, r.defender.item])).toEqual([
      ['non-scarf', first.id, { kind: 'non-scarf', item: 'lifeorb', share: entryOf('garchomp').items.shares.lifeorb }, 'lifeorb'],
    ])
  })

  it('스카프 점유율 ≥ 기준이면 스카프 행, 미만이면 없음, 메가 항목 제외', () => {
    const share = entryOf('basculegion').items.shares.choicescarf
    expect(scarfRows(plan, 'basculegion').map((r) => [r.kind, r.defender.item, r.basis])).toEqual([
      ['scarf', 'choicescarf', { kind: 'scarf', item: 'choicescarf', share }],
    ])
    expect(scarfRows(plan, 'archaludon')).toEqual([])
    expect(scarfRows(plan, 'charizardmegay')).toEqual([])
    const strict = planTab(input({ mySet: PLAIN, criteria: { ...input({ mySet: PLAIN }).criteria, scarfShareMin: share + 0.0001 } }), 'speed')
    expect(scarfRows(strict, 'basculegion')).toEqual([])
  })

  it('스카프 아닌 최다 도구가 도구 없음이면 도구를 지운다', () => {
    const base = entryOf('garchomp')
    const e = syntheticEntry(base, { items: { shares: { choicescarf: 0.6, nothing: 0.3, lifeorb: 0.1 }, keptShare: 1, excludedShare: 0 } })
    const p = planTab(input({ mySet: PLAIN, view: syntheticView(game, bo1.meta, [e]) }), 'speed')
    const r = scarfRows(p, 'garchomp')
    expect(r.map((x) => [x.kind, x.basis])).toEqual([['non-scarf', { kind: 'non-scarf', item: 'nothing', share: 0.3 }]])
    expect('item' in r[0].defender).toBe(false)
  })

  it('스카프 행에는 랭크 행을 붙이지 않는다, 내 얼어붙은바람 → 차단·하양허브 없는 상대 모든 카드 랭크 행', () => {
    const ability = game.data.species.abomasnow.abilities[0]
    const mine = mk('abomasnow', ability, ['icywind', 'blizzard'], { nature: 'modest', sp: { ...ZERO, spa: 32, spe: 32 } })
    const p = planTab(input({ mySet: mine }), 'speed')
    const blockers = ['clearbody', 'whitesmoke', 'mirrorarmor']
    for (const c of p.cards.filter((x) => x.state === 'ok')) {
      const rows = rowsOf(p, c)
      const icy = rows.filter((r) => r.basis?.kind === 'rank' && r.basis.means.id === 'icywind')
      const r = validateSet(game, c.opponentSet)
      const blocked = blockers.includes(r.ability) || r.item === 'whiteherb'
      expect(icy.length).toBe(blocked ? 0 : 1)
      const kinds = rows.map((r) => r.kind)
      expect(kinds).toEqual([...kinds].sort((a, b) => ['base', 'rank', 'scarf', 'non-scarf'].indexOf(a) - ['base', 'rank', 'scarf', 'non-scarf'].indexOf(b)))
    }
  })

  it('상대 세트가 스피드 비교 불가(행동 순서 도구)면 그 카드만 error', () => {
    const base = entryOf('kingambit')
    const e = syntheticEntry(base, { representative: { ...base.representative, set: { ...base.representative.set, item: 'quickclaw' } } })
    const other = entryOf('sneasler')
    const p = planTab(input({ mySet: PLAIN, view: syntheticView(game, bo1.meta, [e, other]) }), 'speed')
    for (const c of cardsOf(p, 'kingambit')) expect([c.state, c.error?.code, c.error?.field, c.rowIds]).toEqual(['error', 'INPUT', 'item', []])
    expect(cardsOf(p, 'sneasler').every((c) => c.state === 'ok')).toBe(true)
  })
})

describe('planTab: 상대 세트 해석 실패', () => {
  it('그 상대 카드만 error(원 세트 보존), 다른 상대는 정상', () => {
    const base = entryOf('kingambit')
    const e = syntheticEntry(base, { representative: { ...base.representative, set: { ...base.representative.set, moves: ['moonblast'] } } })
    const p = planTab(input({ mySet: PLAIN, view: syntheticView(game, bo1.meta, [e, entryOf('sneasler')]) }), 'attack')
    for (const c of cardsOf(p, 'kingambit')) {
      expect(c).toMatchObject({ state: 'error', error: { code: 'ILLEGAL_MOVE' }, rowIds: [] })
      expect(c.opponentSet.moves).toEqual(['moonblast'])
    }
    expect(cardsOf(p, 'sneasler').every((c) => c.state === 'ok')).toBe(true)
  })
})

describe('planTab: 상대 목록·목록 밖 타겟', () => {
  const ROTOM = { rosterId: 'rotomwash', moves: ['hydropump', 'thief', 'electroweb'], edits: {} }

  it('상위 N, 선택 필터(사용률 순), 커스텀은 필터와 무관하게 맨 앞', () => {
    const p5 = planTab(input({ mySet: PLAIN, filters: { topN: 5, selected: [] } }), 'speed')
    expect([...new Set(p5.cards.map((c) => c.opponent.id))]).toEqual(bo1.ranking.slice(0, 5).map((e) => e.id))
    const sel = planTab(input({ mySet: PLAIN, filters: { topN: 5, selected: ['incineroar', 'sneasler', 'notinmeta'] }, customTargets: [ROTOM] }), 'speed')
    expect([...new Set(sel.cards.map((c) => c.opponent.id))]).toEqual(['rotomwash', 'sneasler', 'incineroar'])
  })

  it('메타 목록 안 종은 목록 밖 타겟으로 받지 않고 충돌로 보낸다, 기술 0개 타겟은 건너뛴다', () => {
    const p = planTab(
      input({ mySet: PLAIN, customTargets: [{ rosterId: 'garchomp', moves: ['earthquake'], edits: {} }, { ...ROTOM, moves: [] }] }),
      'attack',
    )
    expect(p.customTargetConflicts).toEqual(['garchomp'])
    expect(p.cards.every((c) => c.opponent.source === 'ladder')).toBe(true)
  })

  it('공격 탭 커스텀: 내 기술 분류마다 프리셋 3장, 사용자 지정 머리·묶음, 프리셋 값', () => {
    const p = planTab(input({ mySet: PLAIN, customTargets: [ROTOM] }), 'attack')
    const custom = p.cards.filter((c) => c.opponent.source === 'custom')
    expect(p.cards.slice(0, 6)).toEqual(custom)
    expect(custom.map((c) => [c.category, c.bundle.presetIndex, c.opponentSet.nature])).toEqual([
      ['physical', 0, 'hardy'],
      ['physical', 1, 'impish'],
      ['physical', 2, 'hardy'],
      ['special', 0, 'hardy'],
      ['special', 1, 'careful'],
      ['special', 2, 'hardy'],
    ])
    for (const c of custom) {
      expect(c.opponent).toEqual({ id: 'rotomwash', source: 'custom' })
      expect(c.bundle).not.toHaveProperty('share')
      expect(c.bundle).not.toHaveProperty('retention')
      expect(c.bundle).not.toHaveProperty('representativeSpread')
      expect(c.bundle.minority).toBe(false)
      expect(c.opponentSet.moves).toEqual(ROTOM.moves)
      expect(c.id).toBe(cardId(['attack', 'custom', 'rotomwash', c.category, c.bundle.presetIndex as number]))
    }
    expect(custom[0].bundle.stats).toEqual([
      { stat: 'hp', sp: 32, nature: 'neutral' },
      { stat: 'def', sp: 32, nature: 'neutral' },
    ])
    expect(custom[1].bundle.stats[1]).toEqual({ stat: 'def', sp: 32, nature: 'plus' })
  })

  it('편집값은 presetKey로 찾아 그 프리셋에만 적용', () => {
    const edits = { [presetKey('speed', null, 2)]: { sp: { spe: 20 }, nature: 'timid' } }
    const p = planTab(input({ mySet: PLAIN, customTargets: [{ ...ROTOM, edits }] }), 'speed')
    const custom = p.cards.filter((c) => c.opponent.source === 'custom')
    expect(custom.map((c) => [c.opponentSet.sp.spe, c.opponentSet.nature])).toEqual([
      [32, 'hardy'],
      [32, 'jolly'],
      [20, 'timid'],
    ])
  })

  it('방어 탭 커스텀: 타겟 기술(지정 순)이 상대 기술, 그 분류마다 프리셋 3장', () => {
    const p = planTab(input({ mySet: PLAIN, customTargets: [ROTOM] }), 'defense')
    const custom = p.cards.filter((c) => c.opponent.source === 'custom')
    expect(custom.map((c) => [c.category, c.bundle.presetIndex])).toEqual([
      ['physical', 0],
      ['physical', 1],
      ['physical', 2],
      ['special', 0],
      ['special', 1],
      ['special', 2],
    ])
    expect(custom[0].opponentSet.sp.atk).toBe(32)
    expect(custom[3].opponentSet.sp.spa).toBe(32)
    const moves = (c: CardSpec) => [...new Set(rowsOf(p, c).filter((r) => r.kind === 'base').map((r) => r.moveId))]
    expect(moves(custom[0])).toEqual(['thief'])
    expect(moves(custom[3])).toEqual(['hydropump', 'electroweb'])
  })

  it('방어 탭 커스텀: 공격기가 없으면 카드 없음', () => {
    const p = planTab(input({ mySet: PLAIN, customTargets: [{ ...ROTOM, moves: ['willowisp'] }] }), 'defense')
    expect(p.cards.some((c) => c.opponent.source === 'custom')).toBe(false)
  })

  it('스피드 탭 커스텀: 타겟 기술의 수단(얼어붙은바람류)이 사용자 지정 랭크 행, 스카프 행 없음', () => {
    const p = planTab(input({ mySet: PLAIN, customTargets: [ROTOM] }), 'speed')
    for (const c of p.cards.filter((x) => x.opponent.source === 'custom')) {
      const rows = rowsOf(p, c)
      expect(rows.map((r) => r.kind)).toEqual(['base', 'rank'])
      expect(rows[1].basis).toEqual({
        kind: 'rank',
        means: { kind: 'move', id: 'electroweb' },
        owner: 'opponent',
        myBoosts: { spe: -1 },
        opponentBoosts: {},
        reactions: [],
      })
    }
  })

  it('해석 불가 타겟(배울 수 없는 기술)은 그 커스텀 카드만 error', () => {
    const p = planTab(input({ mySet: PLAIN, customTargets: [{ ...ROTOM, moves: ['earthquake'] }] }), 'speed')
    const custom = p.cards.filter((c) => c.opponent.source === 'custom')
    expect(custom.map((c) => [c.state, c.error?.code])).toEqual([
      ['error', 'ILLEGAL_MOVE'],
      ['error', 'ILLEGAL_MOVE'],
      ['error', 'ILLEGAL_MOVE'],
    ])
    expect(p.cards.filter((c) => c.opponent.source === 'ladder').every((c) => c.state === 'ok')).toBe(true)
  })

  it('목록 밖 메가 폼 타겟: 메가 폼 id 머리, 원종 + 메가스톤 세트', () => {
    const mega = game.data.megas.find((m) => !bo1.entry(m.forme) && m.base === 'alakazam') ?? game.data.megas.find((m) => !bo1.entry(m.forme))
    if (!mega) throw new Error('목록 밖 메가 폼이 없다')
    const move = game.data.species[mega.base].learnset.find((id) => game.data.moves[id].category === 'Special') as string
    const p = planTab(input({ mySet: PLAIN, customTargets: [{ rosterId: mega.forme, moves: [move], edits: {} }] }), 'speed')
    const custom = p.cards.filter((c) => c.opponent.source === 'custom')
    expect(custom).toHaveLength(3)
    for (const c of custom) {
      expect(c.opponent.id).toBe(mega.forme)
      expect(c.opponentSet).toMatchObject({ species: mega.base, item: mega.stone, mega: true })
      expect(c.state).toBe('ok')
    }
  })
})

describe('planTab: 사용자 추가 배분', () => {
  const opp = 'garchomp'
  const ladderCards = (plan: TabPlan, category: CardSpec['category']) =>
    plan.cards.filter((c) => c.opponent.id === opp && c.opponent.source === 'ladder' && c.category === category)
  const added = (sp: Record<string, number>, extra: Partial<AddedBundle> = {}): AddedBundle => ({ tab: 'attack', opponentId: opp, category: 'physical', sp, ...extra })
  const planWith = (addedBundles: AddedBundle[], tab: 'attack' | 'defense' | 'speed' = 'attack') =>
    planTab(input({ mySet: GARCHOMP, filters: { topN: 30, selected: [opp] }, addedBundles }), tab)

  it('그 (탭, 상대, 분류)에만 관측 카드 뒤에 사용자 카드가 생긴다: 키 능력치 neutral, 점유율 없음, id에 user 표지', () => {
    const base = planWith([])
    const plan = planWith([added({ hp: 32, def: 31 }), added({ hp: 0, def: 1 })])
    const phys = ladderCards(plan, 'physical')
    const observed = ladderCards(base, 'physical')
    expect(phys.slice(0, observed.length).map((c) => c.id)).toEqual(observed.map((c) => c.id))
    const user = phys.slice(observed.length)
    expect(user.map((c) => c.bundle)).toEqual([
      { key: JSON.stringify([{ stat: 'hp', sp: 32, nature: 'neutral' }, { stat: 'def', sp: 31, nature: 'neutral' }]), stats: [{ stat: 'hp', sp: 32, nature: 'neutral' }, { stat: 'def', sp: 31, nature: 'neutral' }], minority: false, userAdded: 0 },
      { key: JSON.stringify([{ stat: 'hp', sp: 0, nature: 'neutral' }, { stat: 'def', sp: 1, nature: 'neutral' }]), stats: [{ stat: 'hp', sp: 0, nature: 'neutral' }, { stat: 'def', sp: 1, nature: 'neutral' }], minority: false, userAdded: 1 },
    ])
    expect(user[0].id).toBe(addedBundleCardId(added({ hp: 32, def: 31 }), user[0].bundle.stats))
    expect(user[0].id).toBe(cardId(['attack', 'ladder', opp, 'physical', user[0].bundle.key, 'user']))
    expect(user.every((c) => c.state === 'ok' && c.rowIds.length > 0)).toBe(true)
    // 다른 분류·다른 탭에는 영향이 없다.
    expect(ladderCards(plan, 'special').map((c) => c.id)).toEqual(ladderCards(base, 'special').map((c) => c.id))
    expect(planWith([added({ hp: 32, def: 31 })], 'defense').cards.some((c) => c.bundle.userAdded !== undefined)).toBe(false)
  })

  it('가정 세트 = 대표(최고 점유율) 묶음 가정에서 키 능력치 SP만 바꾸고, 대표 성격이 키 능력치에 보정을 주면 무보정 성격', () => {
    const plan = planWith([added({ hp: 10, def: 20 })])
    const phys = ladderCards(plan, 'physical')
    const top = phys[0]
    const user = phys.find((c) => c.bundle.userAdded !== undefined) as CardSpec
    expect(user.opponentSet.sp.hp).toBe(10)
    expect(user.opponentSet.sp.def).toBe(20)
    for (const s of ['atk', 'spa', 'spd', 'spe'] as const) expect(user.opponentSet.sp[s]).toBeLessThanOrEqual(top.opponentSet.sp[s])
    const total = Object.values(user.opponentSet.sp).reduce((a, b) => a + b, 0)
    expect(total).toBeLessThanOrEqual(game.manifest.rules.spTotal)
    expect({ ...user.opponentSet, sp: undefined, nature: undefined }).toEqual({ ...top.opponentSet, sp: undefined, nature: undefined })
    const nature = game.data.natures[user.opponentSet.nature]
    expect(nature.plus !== 'def' && nature.minus !== 'def').toBe(true)
  })

  it('대표 성격이 키 능력치(H·B)에 보정이 없으면 성격을 그대로 두고, 있으면 무보정으로 바꾼다(합성 상대)', () => {
    const e = entryOf(opp)
    const make = (spread: string) => {
      const view = syntheticView(game, bo1.meta, [syntheticEntry(e, { spreads: { kept: [[spread, 0.9]], keptShare: 0.9, excludedShare: 0 } })])
      const plan = planTab({ ...input({ mySet: GARCHOMP, filters: { topN: 30, selected: [opp] }, addedBundles: [added({ hp: 4, def: 4 })] }), view }, 'attack')
      return ladderCards(plan, 'physical').find((c) => c.bundle.userAdded !== undefined) as CardSpec
    }
    expect(make('jolly:2/32/0/0/0/32').opponentSet.nature).toBe('jolly')
    const neutralized = make('impish:32/0/32/0/2/0').opponentSet
    const n = game.data.natures[neutralized.nature]
    expect(n.plus === undefined || n.plus === n.minus).toBe(true)
    // 키 밖 SP는 대표 그대로, 합이 상한을 넘지 않으면 덜어 내지 않는다.
    expect(neutralized.sp).toEqual({ hp: 4, atk: 0, def: 4, spa: 0, spd: 2, spe: 0 })
    // 합이 넘으면 키 밖 능력치(큰 것부터)에서 덜어 낸다: 2+32+0+0+0+32 → H32 B32면 A·S에서 34 덜기.
    const trimmed = (() => {
      const view = syntheticView(game, bo1.meta, [syntheticEntry(e, { spreads: { kept: [['jolly:2/32/0/0/0/32', 0.9]], keptShare: 0.9, excludedShare: 0 } })])
      const plan = planTab({ ...input({ mySet: GARCHOMP, filters: { topN: 30, selected: [opp] }, addedBundles: [added({ hp: 32, def: 32 })] }), view }, 'attack')
      return (ladderCards(plan, 'physical').find((c) => c.bundle.userAdded !== undefined) as CardSpec).opponentSet.sp
    })()
    expect(trimmed.hp + trimmed.def).toBe(64)
    expect(Object.values(trimmed).reduce((a, b) => a + b, 0)).toBe(game.manifest.rules.spTotal)
    expect(trimmed).toEqual({ hp: 32, atk: 0, def: 32, spa: 0, spd: 0, spe: 2 })
  })

  it('관측 묶음과 키가 같거나 앞선 추가와 같으면 새 카드를 만들지 않고, 키 능력치 집합·SP 범위가 틀리면 받지 않는다', () => {
    const base = planWith([])
    const observed = ladderCards(base, 'physical')
    const neutralObserved = observed.find((c) => c.bundle.stats.every((s) => s.nature === 'neutral')) as CardSpec
    const sp = Object.fromEntries(neutralObserved.bundle.stats.map((s) => [s.stat, s.sp]))
    const count = (bs: AddedBundle[]) => ladderCards(planWith(bs), 'physical').length
    expect(count([added(sp)])).toBe(observed.length)
    expect(count([added({ hp: 7, def: 7 }), added({ hp: 7, def: 7 })])).toBe(observed.length + 1)
    for (const bad of [{ hp: 7 }, { hp: 7, def: 7, spe: 0 }, { hp: 7, spd: 7 }, { hp: 33, def: 0 }, { hp: -1, def: 0 }, { hp: 1.5, def: 0 }] as Record<string, number>[]) {
      expect(count([added(bad)]), JSON.stringify(bad)).toBe(observed.length)
    }
  })

  it('목록 밖 타겟(커스텀)에는 사용자 카드가 생기지 않는다', () => {
    const plan = planTab(
      input({ mySet: GARCHOMP, customTargets: [{ rosterId: 'rotomwash', moves: ['hydropump'], edits: {} }], addedBundles: [added({ hp: 1, def: 1 }, { opponentId: 'rotomwash' })] }),
      'attack',
    )
    expect(plan.cards.filter((c) => c.opponent.source === 'custom').every((c) => c.bundle.userAdded === undefined)).toBe(true)
    expect(plan.cards.some((c) => c.bundle.userAdded !== undefined)).toBe(false)
  })

  it('끝까지 계산하면 사용자 카드는 그 상대가 보이는 한 선택지로 남고(변화 없음이어도), 그룹 맨 앞·기본 선택은 관측 최대 묶음', () => {
    // H32 B32(무보정)과 H0 B0: 둘 중 적어도 하나는 지진 판정이 바뀌지 않을 수 있어도 선택지로 남아야 한다.
    const bs = [added({ hp: 32, def: 32 }), added({ hp: 0, def: 0 })]
    const view = buildTabView(input({ mySet: GARCHOMP, filters: { topN: 30, selected: [opp] }, addedBundles: bs }), 'attack')
    expect(view.complete).toBe(true)
    const [g] = groupCards(view.cards.filter((c) => c.category === 'physical'))
    expect(g).toBeDefined()
    expect(g.options.slice(0, 2).map((o) => o.bundle.userAdded)).toEqual([0, 1])
    expect(g.options.slice(0, 2).map((o) => o.id)).toEqual(bs.map((b) => addedBundleCardId(b, Object.entries(b.sp).map(([stat, sp]) => ({ stat, sp: sp as number })))))
    for (const o of g.options.slice(0, 2)) expect(o.rows.length).toBeGreaterThan(0)
    const d = defaultOption(g)
    expect(d.bundle.userAdded).toBeUndefined()
    expect(d.bundle.share).toBe(Math.max(...g.options.filter((o) => o.bundle.userAdded === undefined && !o.bundle.minority).map((o) => o.bundle.share as number)))
  })
})
