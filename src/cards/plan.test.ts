import { describe, expect, it } from 'vitest'
import { STAT_IDS, calcDamage, type BattleConditions, type PokemonSet } from '../core'
import type { MetaEntry } from '../data/meta-schema'
import { addedBundleCardId, cardId, presetKey } from './ids'
import { representativeAssumption, resolveAssumption } from '../meta'
import { DEFENSE_MOVE_SHARE_MIN, defenseMoveIds, opponentSeeds, planTab } from './plan'
import { coAdoptionFloor } from './rank'
import { buildTabView } from './batch'
import { judgementKey } from './key'
import { computeRowTask } from './rowTask'
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
/** PLAIN(한카리아스 까칠한피부) 계산 폼 */
const PLAIN_ME = { types: ['Dragon', 'Ground'], ability: 'roughskin' }
/** 대표 세트 계산 특성(테스트 독립 해석) */
const repAbility = (e: MetaEntry): string => {
  const r = resolveAssumption(game, representativeAssumption(bo1, e.id))
  if (!r.usable) throw new Error(e.id)
  return r.resolved.ability
}
const plainDefense = (e: MetaEntry): string[] => defenseMoveIds(game, e, PLAIN_ME, repAbility(e))

describe('planTab: 내 세트', () => {
  it('내 세트가 무효면 그 탭 my-set-error, 카드 없음(이유는 CoreError detail 그대로)', () => {
    const bad = { ...PLAIN, sp: { ...PLAIN.sp, def: 40 } }
    for (const tab of ['attack', 'defense'] as const) {
      const plan = planTab(input({ mySet: bad }), tab)
      expect(plan.status).toEqual({
        kind: 'my-set-error',
        reasons: [expect.objectContaining({ code: 'INVALID_SP', field: 'sp.def' })],
      })
      expect(plan.cards).toEqual([])
    }
  })

  it('스피드 비교 불가 도구(선제공격손톱)여도 공격·방어 탭은 ok', () => {
    const set = { ...PLAIN, item: 'quickclaw' }
    expect(planTab(input({ mySet: set }), 'attack').status.kind).toBe('ok')
    expect(planTab(input({ mySet: set }), 'defense').status.kind).toBe('ok')
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
    expect(planTab(input({ mySet: PLAIN }), 'attack').mySide).toBe('attacker')
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

  it('공격 탭은 내 능동 수단만: 상대 위협·막말내뱉기(하락)·상대 철벽(방어 랭크업)은 랭크 행이 아니다', () => {
    const inc = cardsOf(plan, 'incineroar').filter((c) => c.category === 'physical' && c.state === 'ok')
    expect(inc.length).toBeGreaterThan(0)
    for (const c of inc) {
      const means = rowsOf(plan, c)
        .filter((r) => r.kind === 'rank' && r.moveId === 'earthquake')
        .map((r) => (r.basis?.kind === 'rank' ? [r.basis.owner, r.basis.means.id, r.basis.share] : null))
      expect(means).toEqual([['me', 'swordsdance', undefined]])
    }
    const wide = planTab(input({ mySet: GARCHOMP, filters: { topN: 40, selected: [] } }), 'attack')
    // 메타그로스메가는 철벽을 기준 이상 쓰지만 공격 탭에 상대 방어 랭크업 행은 없다.
    expect(entryOf('metagrossmega').moves.shares.irondefense).toBeGreaterThanOrEqual(DEFAULT_CRITERIA.rankShareMin)
    expect(cardsOf(wide, 'metagrossmega').length).toBeGreaterThan(0)
    expect(Object.values(wide.rows).some((r) => r.basis?.kind === 'rank' && r.basis.owner === 'opponent')).toBe(false)
  })

  it('내 오기 × 상대 위협·막말내뱉기: 반응 랭크 행 없음(내 칼춤 행은 그대로)', () => {
    const mine = mk('kingambit', 'defiant', ['kowtowcleave', 'suckerpunch', 'swordsdance'], { nature: 'adamant' })
    const p = planTab(input({ mySet: mine }), 'attack')
    const rank = Object.values(p.rows).filter((x) => x.basis?.kind === 'rank')
    expect(rank.length).toBeGreaterThan(0)
    for (const r of rank) expect(r.basis).toMatchObject({ owner: 'me', means: { id: 'swordsdance' }, myBoosts: { atk: 2 }, reactions: [] })
  })

  it('내 칼춤 × 내 첫 턴 전용 기술(만나자마자): 그 랭크 조건의 행·후보 없음, 기본 조건엔 있음', () => {
    const mine = mk('golisopod', 'emergencyexit', ['firstimpression', 'leechlife', 'swordsdance'], { nature: 'adamant' })
    const p = planTab(input({ mySet: mine }), 'attack')
    expect(p.status.kind).toBe('ok')
    const rank = Object.values(p.rows).filter((r) => r.kind === 'rank')
    expect(rank.length).toBeGreaterThan(0)
    expect(rank.every((r) => r.moveId === 'leechlife')).toBe(true)
    expect(Object.values(p.rows).some((r) => r.kind === 'base' && r.moveId === 'firstimpression')).toBe(true)
    for (const c of p.cards) {
      for (const g of c.conditions) if (g.id !== JSON.stringify(['base'])) expect(g.candidates.map((x) => x.moveId)).not.toContain('firstimpression')
    }
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

  it('조건: 공격 탭은 순풍 없음으로 계산한다', () => {
    const p = planTab(input({ mySet: PLAIN }), 'attack')
    expect(Object.values(p.rows).length).toBeGreaterThan(0)
    for (const r of Object.values(p.rows)) {
      expect(r.conditions.attacker).toEqual({ tailwind: false })
      expect(r.conditions.defender).toEqual({ tailwind: false })
    }
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

  it('상대 기술 = 기본 후보(사용률 5%·나에게 1배 이상), 기술 × 묶음마다 극단 필터 + 그 필터를 gate로 둔 H·B/D 행', () => {
    const e = entryOf('kingambit')
    const moves = plainDefense(e)
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

  it('실데이터 기본 후보: 변화기 없음, 사용률 5% 이상, 나에게 1배 이상(없으면 1위 하나)', () => {
    for (const e of bo1.ranking.slice(0, 10)) {
      const ids = plainDefense(e)
      expect(ids.length).toBeGreaterThan(0)
      for (const id of ids) expect(game.data.moves[id].category).not.toBe('Status')
      if (ids.length > 1) for (const id of ids) expect(e.moves.shares[id]).toBeGreaterThanOrEqual(DEFENSE_MOVE_SHARE_MIN)
    }
    // 실데이터 리자몽메가Y(가뭄): 열풍(불꽃)·원시의힘(바위)은 드래곤/땅에 반감이라 빠지고, 솔라빔(풀 2배) 등은 남는다.
    // 웨더볼은 자기 가뭄(쾌청)으로 불꽃이 되어 반감이라 빠진다(R12. 이전: 노말 등배로 남았다)
    const zard = plainDefense(entryOf('charizardmegay'))
    expect(zard).not.toContain('heatwave')
    expect(zard).not.toContain('ancientpower')
    expect(zard).toEqual(['solarbeam', 'dragonpulse', 'hurricane'])
  })

  it('실데이터 포푸니크: 1배 이상인 내 세트면 지옥찌르기(14.8%)·암석봉인(6.6%)이 후보, 5% 미만(더스트슈트 3.8%)은 아니다', () => {
    const e = entryOf('sneasler')
    const ids = defenseMoveIds(game, e, { types: ['Normal'], ability: 'innerfocus' }, repAbility(e))
    expect(ids).toEqual(expect.arrayContaining(['throatchop', 'rocktomb']))
    expect(ids).not.toContain('gunkshot')
    // 드래곤/땅에 바위는 반감이라 암석봉인이 빠진다(내 세트에 따라 달라진다)
    expect(plainDefense(e)).not.toContain('rocktomb')
  })

  it('내던지기는 도구 없는 기본 줄에서 실패하므로 후보가 아니다(실데이터 포푸니크 9.8%, 합성 사용률 1위여도)', () => {
    const e = entryOf('sneasler')
    expect(e.moves.shares.fling).toBeGreaterThan(DEFENSE_MOVE_SHARE_MIN)
    expect(defenseMoveIds(game, e, { types: ['Normal'], ability: 'innerfocus' }, repAbility(e))).not.toContain('fling')
    expect(plainDefense(e)).not.toContain('fling')
    const only = syntheticEntry(e, { moves: { ...e.moves, shares: { fling: 0.9, closecombat: 0.01 } } })
    expect(plainDefense(only)).toEqual(['closecombat'])
    // 사용자가 추가한 내던지기도 후보가 되지 않는다
    const p = planTab(input({ mySet: PLAIN, filters: { topN: 30, selected: ['sneasler'] }, addedMoves: [{ opponentId: 'sneasler', moveId: 'fling' }] }), 'defense')
    const sneasler = cardsOf(p, 'sneasler')
    expect(sneasler.length).toBeGreaterThan(0)
    for (const c of sneasler) expect(c.conditions.some((g) => g.candidates.some((m) => m.moveId === 'fling')), c.id).toBe(false)
  })

  describe('기본 후보 규칙(합성 통계)', () => {
    const base = entryOf('kingambit')
    const withShares = (shares: Record<string, number>): MetaEntry => syntheticEntry(base, { moves: { ...base.moves, shares } })
    const ids = (shares: Record<string, number>, me: { types: string[]; ability: string }, opponentAbility = 'defiant') =>
      defenseMoveIds(game, withShares(shares), me, opponentAbility)

    it('사용률 5% 미만은 빠지고 5% 이상은 개수 제한 없이 들어간다(사용률 순)', () => {
      const shares = { kowtowcleave: 0.9, suckerpunch: 0.8, ironhead: 0.7, lowkick: 0.6, crunch: 0.3, throatchop: 0.2, brickbreak: 0.05, knockoff: 0.049, swordsdance: 0.5 }
      expect(ids(shares, PLAIN_ME)).toEqual(['kowtowcleave', 'suckerpunch', 'ironhead', 'lowkick', 'crunch', 'throatchop', 'brickbreak'])
    })

    it('타입 상성으로 반감·무효인 기술은 빠진다(4배는 남는다)', () => {
      const shares = { thunderbolt: 0.9, flareblitz: 0.8, icebeam: 0.7, kowtowcleave: 0.6 }
      expect(ids(shares, PLAIN_ME)).toEqual(['icebeam', 'kowtowcleave'])
    })

    it('내 특성 무효(부유+땅)·반감(두꺼운지방+불꽃)은 빠지고, 상대 틀깨기면 특성 보정을 넣지 않는다', () => {
      const shares = { earthquake: 0.9, flamethrower: 0.8, kowtowcleave: 0.6 }
      expect(ids(shares, { types: ['Normal'], ability: 'levitate' })).toEqual(['flamethrower', 'kowtowcleave'])
      expect(ids(shares, { types: ['Normal'], ability: 'thickfat' })).toEqual(['earthquake', 'kowtowcleave'])
      expect(ids(shares, { types: ['Normal'], ability: 'levitate' }, 'moldbreaker')).toEqual(['earthquake', 'flamethrower', 'kowtowcleave'])
      expect(ids(shares, { types: ['Normal'], ability: 'thickfat' }, 'moldbreaker')).toEqual(['earthquake', 'flamethrower', 'kowtowcleave'])
    })

    it('상대 스킨 계열 특성은 바뀐 타입으로 본다(프리즈스킨 하이퍼보이스 → 얼음)', () => {
      const shares = { hypervoice: 0.9, kowtowcleave: 0.6 }
      expect(ids(shares, { types: ['Ghost'], ability: 'cursedbody' })).toEqual(['kowtowcleave'])
      expect(ids(shares, { types: ['Ghost'], ability: 'cursedbody' }, 'refrigerate')).toEqual(['hypervoice', 'kowtowcleave'])
      expect(ids(shares, { types: ['Normal'], ability: 'thickfat' }, 'refrigerate')).toEqual(['kowtowcleave'])
    })

    it('후보가 하나도 없으면 변화기를 뺀 사용률 1위 하나', () => {
      expect(ids({ protect: 0.95, thunderbolt: 0.8, discharge: 0.3, kowtowcleave: 0.04 }, PLAIN_ME)).toEqual(['thunderbolt'])
      expect(ids({ protect: 0.95, kowtowcleave: 0.04, suckerpunch: 0.03 }, PLAIN_ME)).toEqual(['kowtowcleave'])
    })

    it('스냅샷에 없는 기술은 배율 조건 없이 사용률로만 남는다(계산 불가 항목)', () => {
      expect(ids({ nosuchmove: 0.9, thunderbolt: 0.8 }, PLAIN_ME)).toEqual(['nosuchmove'])
    })
  })

  it('사용자 추가 기술: 기준과 무관하게 후보(added 표시), 변화기·스냅샷에 없는 기술·다른 상대·중복은 무시, 랭크 후 항목은 수단 자격 규칙대로', () => {
    const addedMoves = [
      { opponentId: 'kingambit', moveId: 'stoneedge' },
      { opponentId: 'kingambit', moveId: 'stoneedge' },
      { opponentId: 'kingambit', moveId: 'swordsdance' },
      { opponentId: 'kingambit', moveId: 'nosuchmove' },
      { opponentId: 'garchomp', moveId: 'crunch' },
      { opponentId: 'kingambit', moveId: 'suckerpunch' },
      // 이미 기본 후보인 기술을 추가해도 추가 표시(×)는 없다(지워도 후보에서 빠지지 않으므로)
      { opponentId: 'kingambit', moveId: 'kowtowcleave' },
    ]
    const p = planTab(input({ mySet: PLAIN, filters: { topN: 30, selected: ['kingambit', 'garchomp'] }, addedMoves }), 'defense')
    const c = cardsOf(p, 'kingambit').find((x) => x.state === 'ok') as CardSpec
    const baseGroup = c.conditions.find((g) => g.id === JSON.stringify(['base']))
    // 사용률 순(추가 기술 중 통계에 없는 스톤에지는 맨 뒤), 드래곤/땅에 반감인 스톤에지도 후보다
    expect(baseGroup?.candidates.map((x) => [x.moveId, x.added === true])).toEqual([
      ['kowtowcleave', false],
      // 기습은 이미 기본 후보(사용률 5% 이상·나에게 1배)라 추가해도 추가 표시가 없다
      ['suckerpunch', false],
      ['ironhead', false],
      ['lowkick', false],
      ['stoneedge', true],
    ])
    // 통계에 없는 추가 기술은 칼춤 동시채용 하한이 0이라 랭크 후 항목이 없다
    const sd = c.conditions.find((g) => g.id !== JSON.stringify(['base']))
    expect(sd?.candidates.map((x) => x.moveId)).toEqual(['kowtowcleave', 'suckerpunch'])
    expect(sd?.candidates.every((x) => x.added !== true)).toBe(true)
    // 다른 상대에 추가한 기술은 그 상대만
    for (const g of cardsOf(p, 'garchomp').flatMap((x) => x.conditions)) for (const x of g.candidates) expect(x.added === true).toBe(x.moveId === 'crunch')
    expect(cardsOf(p, 'garchomp').some((x) => x.conditions.some((g) => g.candidates.some((y) => y.moveId === 'crunch')))).toBe(true)
    // 목록 항목(ItemView)에도 added가 실린다
    const view = buildTabView(input({ mySet: PLAIN, filters: { topN: 30, selected: ['kingambit'] }, addedMoves }), 'defense')
    const items = view.cards.filter((x) => x.opponent.id === 'kingambit').flatMap((x) => x.items)
    expect(items.length).toBeGreaterThan(0)
    for (const it of items) expect(it.added === true, it.key).toBe(it.moveId === 'stoneedge')
    expect(items.find((x) => x.moveId === 'stoneedge')?.status).toBe('ok')
  })

  it('상대 칼춤(≥10%) → 방어 탭 물리 카드 랭크 행(동시채용 하한 통과 기술만) + 랭크 행 전용 극단 필터', () => {
    const e = entryOf('kingambit')
    const a = e.moves.shares.swordsdance
    // 실제 통계: 칼춤 12.93% × 악식 99.64%·기습 99.46%는 하한 ≥ 10%, 아이언헤드 75.94%·로킥 67.04%는 미달(대표 세트에 칼춤 없음).
    const passing = plainDefense(e).filter((m) => coAdoptionFloor(a, e.moves.shares[m]) >= DEFAULT_CRITERIA.rankShareMin)
    expect(passing).toEqual(['kowtowcleave', 'suckerpunch'])
    const c = cardsOf(plan, 'kingambit').find((x) => x.state === 'ok') as CardSpec
    const rank = rowsOf(plan, c).filter((r) => r.kind === 'rank')
    expect(rank.map((r) => [r.moveId, r.sweep?.stat])).toEqual(passing.flatMap((m) => [[m, 'hp'], [m, 'def']]))
    for (const r of rank) {
      expect(r.basis).toMatchObject({ owner: 'opponent', means: { id: 'swordsdance' }, opponentBoosts: { atk: 2 }, share: a })
      expect(r.attacker.boosts).toEqual({ atk: 2 })
      const f = plan.filters[r.gate as string]
      expect(f.basis).toBe(r.basis)
    }
    expect(c.filterIds.length).toBe(4 + passing.length)
    expect(c.filterIds.map((id) => plan.filters[id].order)).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('실데이터 갑주무사메가: 칼춤 조건에 만나자마자(첫 턴 전용) 없음, 하한 통과 기술(흡혈·아이언헤드)만', () => {
    const e = entryOf('golisopodmega')
    const a = e.moves.shares.swordsdance
    const moves = plainDefense(e)
    expect(moves).toContain('firstimpression')
    // 칼춤 19.45% × 흡혈 98.3% → 17.75%, × 아이언헤드 92.26% → 11.71%, × 기습 66.38%·드릴런·만나자마자 → 0
    expect(moves.filter((m) => coAdoptionFloor(a, e.moves.shares[m]) >= DEFAULT_CRITERIA.rankShareMin).sort()).toEqual(['ironhead', 'leechlife'])
    const p = planTab(input({ mySet: PLAIN, filters: { topN: 30, selected: ['golisopodmega'] } }), 'defense')
    const cs = cardsOf(p, 'golisopodmega').filter((x) => x.state === 'ok')
    expect(cs.length).toBeGreaterThan(0)
    for (const c of cs) {
      const rank = rowsOf(p, c).filter((r) => r.kind === 'rank')
      expect(rank.length).toBeGreaterThan(0)
      expect(new Set(rank.map((r) => r.moveId))).toEqual(new Set(['ironhead', 'leechlife']))
      const sd = c.conditions.find((g) => g.id !== JSON.stringify(['base']))
      expect(sd?.candidates.map((x) => x.moveId).sort()).toEqual(['ironhead', 'leechlife'])
    }
  })

  it('상대(목록 밖 타겟) 칼춤 × 상대 만나자마자(첫 턴 전용): 랭크 조건 행 없음, 하한 필터는 보지 않는다', () => {
    const target = { rosterId: 'golisopod', moves: ['firstimpression', 'leechlife', 'swordsdance'], edits: {} }
    const p = planTab(input({ mySet: PLAIN, customTargets: [target] }), 'defense')
    const cs = p.cards.filter((c) => c.opponent.source === 'custom' && c.state === 'ok')
    expect(cs.length).toBeGreaterThan(0)
    for (const c of cs) {
      const rank = rowsOf(p, c).filter((r) => r.kind === 'rank')
      expect(rank.length).toBeGreaterThan(0)
      expect(rank.every((r) => r.moveId === 'leechlife' && r.basis?.kind === 'rank' && r.basis.means.id === 'swordsdance')).toBe(true)
      expect(rowsOf(p, c).some((r) => r.kind === 'base' && r.moveId === 'firstimpression')).toBe(true)
    }
  })

  it('조건: 방어 탭도 순풍 없음으로 계산한다', () => {
    const p = planTab(input({ mySet: PLAIN }), 'defense')
    expect(Object.values(p.rows).length).toBeGreaterThan(0)
    for (const r of Object.values(p.rows)) {
      expect(r.conditions.attacker).toEqual({ tailwind: false })
      expect(r.conditions.defender).toEqual({ tailwind: false })
    }
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

  it('방어 탭은 내 랭크업 수단을 보지 않는다: 상대 속임수가 있어도 내 칼춤·철벽은 랭크 조건이 아니다(내 방어 랭크업은 후속 별도 UI)', () => {
    const base = entryOf('kingambit')
    const e = syntheticEntry(base, { id: 'kingambit', moves: { shares: { foulplay: 0.9, kowtowcleave: 0.8 }, keptShare: 1.7, excludedShare: 0 } })
    const view = syntheticView(game, bo1.meta, [e])
    const mine = mk('kingambit', 'defiant', ['kowtowcleave', 'swordsdance', 'irondefense'])
    const p = planTab(input({ mySet: mine, view }), 'defense')
    const rows = Object.values(p.rows)
    expect(rows.some((r) => r.moveId === 'foulplay' && r.kind === 'base')).toBe(true)
    expect(rows.some((r) => r.basis?.kind === 'rank' && r.basis.owner === 'me')).toBe(false)
    expect(Object.values(p.filters).some((f) => f.basis?.owner === 'me')).toBe(false)
  })

  it('상대 목숨걸기(대미지 = 상대 HP)는 묶음 키에 상대 H를 보탠다', () => {
    const base = entryOf('lucariomegaz')
    const e = syntheticEntry(base, { moves: { shares: { finalgambit: 0.9 }, keptShare: 0.9, excludedShare: 0 } })
    const p = planTab(input({ mySet: PLAIN, view: syntheticView(game, bo1.meta, [e]) }), 'defense')
    const cs = p.cards.filter((x) => x.state === 'ok')
    expect(cs.length).toBeGreaterThan(0)
    for (const c of cs) expect(c.bundle.stats.map((s) => s.stat)).toEqual(['hp', 'spa'])
  })

  it('상대 셸암즈 → 그 상대 모든 카드 머리 안내, 항목은 되지 않는다', () => {
    const base = entryOf('kingambit')
    const shares = { shellsidearm: 0.99, kowtowcleave: 0.9, suckerpunch: 0.8, ironhead: 0.7, lowkick: 0.6, rockslide: 0.5 }
    const e = syntheticEntry(base, { moves: { shares, keptShare: 4.5, excludedShare: 0 } })
    const view = syntheticView(game, bo1.meta, [e])
    // 풀 타입 내 세트: 독(셸암즈)·악·강철·격투·바위가 모두 1배 이상이라 기본 후보다
    const p = planTab(input({ mySet: mk('rillaboom', 'grassysurge', ['grassyglide', 'fakeout']), view }), 'defense')
    expect(p.cards.length).toBeGreaterThan(0)
    for (const c of p.cards) expect(c.notices).toEqual([{ kind: 'category-varies', moveId: 'shellsidearm', owner: 'opponent' }])
    const moves = new Set(Object.values(p.rows).map((r) => r.moveId))
    expect(moves).toEqual(new Set(['kowtowcleave', 'suckerpunch', 'ironhead', 'lowkick', 'rockslide']))
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

  it('내 위협(상대에게 거는 하락)·내 철벽(내 방어 랭크업) 모두 방어 탭 랭크 조건이 아니다, 상대 랭크업은 그대로', () => {
    const intim = planTab(input({ mySet: mk('incineroar', 'intimidate', ['flareblitz'], { nature: 'careful', sp: { ...ZERO, hp: 32, spd: 32 } }) }), 'defense')
    expect(Object.values(intim.rows).some((r) => r.basis?.kind === 'rank' && r.basis.owner === 'me')).toBe(false)
    const mine = mk('metagross', 'clearbody', ['irondefense', 'meteormash'], { nature: 'impish', sp: { ...ZERO, hp: 32, def: 32 } })
    const p = planTab(input({ mySet: mine }), 'defense')
    const c = cardsOf(p, 'kingambit').find((x) => x.state === 'ok') as CardSpec
    expect(rowsOf(p, c).some((x) => x.basis?.kind === 'rank' && x.basis.owner === 'me')).toBe(false)
    // 대도각참의 칼춤(상대 A 랭크업)은 랭크 조건으로 남는다(빈 검사 방지)
    expect(rowsOf(p, c).some((x) => x.basis?.kind === 'rank' && x.basis.owner === 'opponent' && x.basis.means.id === 'swordsdance')).toBe(true)
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
    const p5 = planTab(input({ mySet: PLAIN, filters: { topN: 5, selected: [] } }), 'attack')
    expect([...new Set(p5.cards.map((c) => c.opponent.id))]).toEqual(bo1.ranking.slice(0, 5).map((e) => e.id))
    const sel = planTab(input({ mySet: PLAIN, filters: { topN: 5, selected: ['incineroar', 'sneasler', 'notinmeta'] }, customTargets: [ROTOM] }), 'attack')
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
    const edits = { [presetKey('defense', 'physical', 2)]: { sp: { atk: 20 }, nature: 'lonely' } }
    const p = planTab(input({ mySet: PLAIN, customTargets: [{ ...ROTOM, edits }] }), 'defense')
    const custom = p.cards.filter((c) => c.opponent.source === 'custom')
    expect(custom.map((c) => [c.category, c.opponentSet.sp.atk, c.opponentSet.nature])).toEqual([
      ['physical', 32, 'hardy'],
      ['physical', 32, 'adamant'],
      ['physical', 20, 'lonely'],
      ['special', 0, 'hardy'],
      ['special', 0, 'modest'],
      ['special', 0, 'hardy'],
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

  it('해석 불가 타겟(배울 수 없는 기술)은 그 커스텀 카드만 error', () => {
    const p = planTab(input({ mySet: PLAIN, customTargets: [{ ...ROTOM, moves: ['earthquake'] }] }), 'attack')
    const custom = p.cards.filter((c) => c.opponent.source === 'custom')
    expect(custom).toHaveLength(6)
    expect(custom.every((c) => c.state === 'error' && c.error?.code === 'ILLEGAL_MOVE')).toBe(true)
    expect(p.cards.filter((c) => c.opponent.source === 'ladder').every((c) => c.state === 'ok')).toBe(true)
  })

  it('목록 밖 메가 폼 타겟: 메가 폼 id 머리, 원종 + 메가스톤 세트', () => {
    const mega = game.data.megas.find((m) => !bo1.entry(m.forme) && m.base === 'alakazam') ?? game.data.megas.find((m) => !bo1.entry(m.forme))
    if (!mega) throw new Error('목록 밖 메가 폼이 없다')
    const move = game.data.species[mega.base].learnset.find((id) => game.data.moves[id].category === 'Special') as string
    const p = planTab(input({ mySet: PLAIN, customTargets: [{ rosterId: mega.forme, moves: [move], edits: {} }] }), 'defense')
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
  const added = (sp: Record<string, number>, extra: Partial<AddedBundle> = {}): AddedBundle => ({ tab: 'attack', source: 'ladder', opponentId: opp, category: 'physical', sp, ...extra })
  const planWith = (addedBundles: AddedBundle[], tab: 'attack' | 'defense' = 'attack') =>
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

  it('래더 출처 추가 배분은 같은 id의 목록 밖 타겟 카드를 만들지 않는다', () => {
    const plan = planTab(
      input({ mySet: GARCHOMP, customTargets: [{ rosterId: 'rotomwash', moves: ['hydropump'], edits: {} }], addedBundles: [added({ hp: 1, def: 1 }, { opponentId: 'rotomwash' })] }),
      'attack',
    )
    expect(plan.cards.filter((c) => c.opponent.source === 'custom').every((c) => c.bundle.userAdded === undefined)).toBe(true)
    expect(plan.cards.some((c) => c.bundle.userAdded !== undefined)).toBe(false)
  })

  it('메타 항목 id와 같은 id의 custom 출처 추가 배분은 래더 카드를 만들지 않는다', () => {
    const base = ladderCards(planWith([]), 'physical')
    const plan = planWith([added({ hp: 7, def: 7 }, { source: 'custom' })])
    expect(ladderCards(plan, 'physical').map((c) => c.id)).toEqual(base.map((c) => c.id))
    expect(plan.cards.some((c) => c.bundle.userAdded !== undefined)).toBe(false)
  })

  it('끝까지 계산하면 사용자 카드는 그 상대가 보이는 한 선택지로 남고(변화 없음이어도), 그룹 맨 앞·기본 선택은 첫 직접 추가 배분(고정 배분 우선)', () => {
    // H32 B32(무보정)과 H0 B0: 둘 중 적어도 하나는 지진 판정이 바뀌지 않을 수 있어도 선택지로 남아야 한다.
    const bs = [added({ hp: 32, def: 32 }), added({ hp: 0, def: 0 })]
    const view = buildTabView(input({ mySet: GARCHOMP, filters: { topN: 30, selected: [opp] }, addedBundles: bs }), 'attack')
    expect(view.complete).toBe(true)
    const [g] = groupCards(view.cards.filter((c) => c.category === 'physical'))
    expect(g).toBeDefined()
    expect(g.options.slice(0, 2).map((o) => o.bundle.userAdded)).toEqual([0, 1])
    expect(g.options.slice(0, 2).map((o) => o.id)).toEqual(bs.map((b) => addedBundleCardId(b, STAT_IDS.flatMap((stat) => { const sp = b.sp[stat]; return sp === undefined ? [] : [{ stat, sp }] }))))
    for (const o of g.options.slice(0, 2)) expect(o.rows.length).toBeGreaterThan(0)
    expect(defaultOption(g).bundle.userAdded).toBe(0)
  })
})

describe('planTab: 범위 밖 추가분만 상대', () => {
  const physicalOf = (id: string, sp: Record<string, number>): AddedBundle => ({ tab: 'attack', source: 'ladder', opponentId: id, category: 'physical', sp })
  const topN = (addedBundles: AddedBundle[], n = 1) => input({ mySet: GARCHOMP, filters: { topN: n, selected: [] }, addedBundles })
  /** 범위 안(선택)이면 공격 탭 반감열매 변형 카드가 생기는 상위 2~30위 상대 */
  const berryOpp = (() => {
    for (const e of bo1.ranking.slice(1, 30)) {
      const plan = planTab(input({ mySet: GARCHOMP, filters: { topN: 30, selected: [e.id] } }), 'attack')
      if (cardsOf(plan, e.id).some((c) => c.berry !== undefined)) return e
    }
    throw new Error('반감열매 변형이 있는 상대가 없다')
  })()

  it('topN 밖 상대에 공격 탭 추가 배분을 넣으면 사용자 카드만 생기고, 도구 변형에도 관측 키가 새지 않는다', () => {
    const id = berryOpp.id
    const plan = planTab(topN([physicalOf(id, { hp: 7, def: 7 })]), 'attack')
    const cards = cardsOf(plan, id)
    expect(cards.length).toBeGreaterThan(1)
    expect(cards.every((c) => c.bundle.userAdded === 0 && c.opponent.addedOnly === true && c.category === 'physical')).toBe(true)
    expect(cards.some((c) => c.berry !== undefined)).toBe(true)
    expect(cards.every((c) => c.opponentSet.item === undefined || c.berry?.item === c.opponentSet.item)).toBe(true)
    // 범위 안일 때의 사용자 카드와 id·행·조건·가정 세트가 같다(관측 묶음 카드만 없다)
    const inRange = planTab(input({ mySet: GARCHOMP, filters: { topN: 30, selected: [id] }, addedBundles: [physicalOf(id, { hp: 7, def: 7 })] }), 'attack')
    const same = cardsOf(inRange, id).filter((c) => c.bundle.userAdded !== undefined)
    expect(cards.map((c) => c.id)).toEqual(same.map((c) => c.id))
    expect(cards.map((c) => c.rowIds)).toEqual(same.map((c) => c.rowIds))
    expect(cards.map((c) => c.conditions)).toEqual(same.map((c) => c.conditions))
    expect(cards.map((c) => c.opponentSet)).toEqual(same.map((c) => c.opponentSet))
  })

  it('추가분만 상대는 사용률 순 자리에 끼고, 범위 안 상대·다른 탭·filters는 그대로이며, 배분을 지우면 사라진다', () => {
    const id = berryOpp.id
    const base = planTab(topN([]), 'attack')
    const inp = topN([physicalOf(id, { hp: 7, def: 7 })])
    const plan = planTab(inp, 'attack')
    expect(inp.filters).toEqual({ topN: 1, selected: [] })
    const ladderIds = (p: TabPlan) => [...new Set(p.cards.filter((c) => c.opponent.source === 'ladder').map((c) => c.opponent.id))]
    expect(ladderIds(plan)).toEqual([bo1.ranking[0].id, id])
    expect(plan.cards.filter((c) => c.opponent.id !== id)).toEqual(base.cards)
    expect(planTab(inp, 'defense').cards).toEqual(planTab(topN([]), 'defense').cards)
    expect(cardsOf(planTab(topN([]), 'attack'), id)).toEqual([])
    const other = bo1.ranking.find((e, i) => i > 0 && e.id !== id)
    if (other === undefined) throw new Error('no other')
    expect(ladderIds(planTab(topN([physicalOf(other.id, { hp: 7, def: 7 })]), 'attack'))).toEqual([bo1.ranking[0].id, other.id])
  })

  it('범위 안에서 추가했다가 topN을 줄이거나 선택 종을 바꿔 범위에서 빠져도 사용자 카드만 남는다', () => {
    const id = bo1.ranking[1].id
    const added = [physicalOf(id, { hp: 7, def: 7 })]
    const wide = cardsOf(planTab(topN(added, 2), 'attack'), id)
    expect(wide.some((c) => c.bundle.userAdded === undefined)).toBe(true)
    expect(wide.every((c) => c.opponent.addedOnly === undefined)).toBe(true)
    const user = wide.filter((c) => c.bundle.userAdded !== undefined).map((c) => c.id)
    for (const filters of [
      { topN: 1, selected: [] },
      { topN: 30, selected: [bo1.ranking[0].id] },
    ]) {
      const narrow = cardsOf(planTab(input({ mySet: GARCHOMP, filters, addedBundles: added }), 'attack'), id)
      expect(narrow.map((c) => c.id)).toEqual(user)
      expect(narrow.every((c) => c.opponent.addedOnly === true)).toBe(true)
    }
  })

  it('1위·관측 묶음과 같은 SP를 넣어도 추가분만 상대에는 카드가 실제로 생긴다', () => {
    const id = bo1.ranking[1].id
    const observed = cardsOf(planTab(input({ mySet: GARCHOMP, filters: { topN: 30, selected: [id] } }), 'attack'), id).filter(
      (c) => c.category === 'physical' && c.berry === undefined && c.bundle.stats.every((s) => s.nature === 'neutral'),
    )
    expect(observed.length).toBeGreaterThan(0)
    const sp = Object.fromEntries(observed[0].bundle.stats.map((s) => [s.stat, s.sp]))
    const cards = cardsOf(planTab(topN([physicalOf(id, sp)]), 'attack'), id).filter((c) => c.berry === undefined)
    expect(cards.map((c) => [c.bundle.key, c.bundle.userAdded])).toEqual([[observed[0].bundle.key, 0]])
  })

  it('방어 탭 추가분만 상대도 사용자 카드만 만들고 화력 도구 변형에도 관측 키가 없다', () => {
    const id = bo1.ranking[1].id
    const seeds = opponentSeeds(topN([]), 'defense', { source: 'ladder', id })
    if (seeds.kind !== 'ok') throw new Error(seeds.kind)
    const c = seeds.categories.find((x) => x.keyStats.length > 0)
    if (c === undefined) throw new Error('no key stats')
    const added: AddedBundle = { tab: 'defense', source: 'ladder', opponentId: id, category: c.category, sp: Object.fromEntries(c.keyStats.map((st) => [st, 9])) }
    const cards = cardsOf(planTab(topN([added]), 'defense'), id)
    expect(cards.length).toBeGreaterThan(0)
    expect(cards.every((x) => x.bundle.userAdded === 0 && x.category === c.category)).toBe(true)
    expect(cardsOf(planTab(topN([added]), 'attack'), id)).toEqual([])
  })

  it('메타 월 전환: 목록 밖 종이 메타에 들어와도(충돌) 목록 밖 출처 추가 배분은 래더 카드를 만들지 않는다', () => {
    const id = bo1.ranking[5].id
    const plan = planTab(
      input({
        mySet: GARCHOMP,
        filters: { topN: 1, selected: [] },
        customTargets: [{ rosterId: id, moves: ['earthquake'], edits: {} }],
        addedBundles: [{ ...physicalOf(id, { hp: 7, def: 7 }), source: 'custom' }],
      }),
      'attack',
    )
    expect(plan.customTargetConflicts).toEqual([id])
    expect(cardsOf(plan, id)).toEqual([])
  })
})

describe('planTab: 목록 밖 추가 배분', () => {
  const ROTOM = { rosterId: 'rotomwash', moves: ['hydropump', 'thief'], edits: {} }
  const custom = (sp: Record<string, number>): AddedBundle => ({ tab: 'attack', source: 'custom', opponentId: 'rotomwash', category: 'physical', sp })
  const plan = (addedBundles: AddedBundle[], edits: CardInput['customTargets'][number]['edits'] = {}) =>
    planTab(input({ mySet: GARCHOMP, customTargets: [{ ...ROTOM, edits }], addedBundles }), 'attack')
  const physical = (p: TabPlan) => p.cards.filter((c) => c.opponent.source === 'custom' && c.category === 'physical')

  it('프리셋 3장 뒤에 사용자 카드가 생기고 id는 custom 출처 user 표지, 가정은 프리셋 1의 도구·성격 편집을 따른다', () => {
    const edits = { [presetKey('attack', 'physical', 0)]: { item: 'leftovers', nature: 'modest', sp: { atk: 4 } } }
    const cards = physical(plan([custom({ hp: 7, def: 9 })], edits))
    expect(cards.map((c) => c.bundle.presetIndex ?? `u${c.bundle.userAdded}`)).toEqual([0, 1, 2, 'u0'])
    const user = cards[3]
    expect(user.id).toBe(addedBundleCardId(custom({ hp: 7, def: 9 }), user.bundle.stats))
    expect(user.id).toBe(cardId(['attack', 'custom', 'rotomwash', 'physical', user.bundle.key, 'user']))
    expect(user.opponentSet).toEqual({ ...cards[0].opponentSet, sp: { ...cards[0].opponentSet.sp, hp: 7, def: 9 } })
    expect(user.opponentSet.item).toBe('leftovers')
    expect(user.opponentSet.nature).toBe('modest')
    expect(user.state).toBe('ok')
    expect(user.rowIds.length).toBeGreaterThan(0)
  })

  it('프리셋 1 성격이 키 능력치에 보정을 주면 무보정 성격으로 맞춘다', () => {
    const edits = { [presetKey('attack', 'physical', 0)]: { nature: 'bold' } }
    const user = physical(plan([custom({ hp: 7, def: 9 })], edits)).find((c) => c.bundle.userAdded !== undefined)
    if (user === undefined) throw new Error('no user card')
    const n = game.data.natures[user.opponentSet.nature]
    expect(n.plus === undefined || n.plus === n.minus).toBe(true)
  })

  it('프리셋과 같은 키·앞선 추가와 같은 키면 카드를 만들지 않는다', () => {
    expect(physical(plan([custom({ hp: 32, def: 32 }), custom({ hp: 0, def: 0 })]))).toHaveLength(3)
    expect(physical(plan([custom({ hp: 5, def: 5 }), custom({ hp: 5, def: 5 })]))).toHaveLength(4)
    const edits = { [presetKey('attack', 'physical', 1)]: { nature: 'hardy', sp: { hp: 5, def: 6 } } }
    expect(physical(plan([custom({ hp: 5, def: 6 })], edits))).toHaveLength(3)
  })

  it('다른 탭·분류·출처의 추가 배분은 목록 밖 카드를 바꾸지 않는다', () => {
    const base = plan([])
    const other = plan([
      { ...custom({ hp: 7, spd: 7 }), category: 'special', tab: 'defense' },
      { ...custom({ hp: 7, def: 7 }), source: 'ladder' },
    ])
    expect(other.cards).toEqual(base.cards)
  })
})

describe('planTab: 공격측 특성 날씨·필드(R12·AC33)', () => {
  // 메가리자몽Y = 원종 + mega + 메가스톤(해결 특성 가뭄)
  const ZARD_Y = mk('charizard', 'blaze', ['heatwave', 'weatherball'], { item: 'charizarditey', mega: true, nature: 'modest', sp: { ...ZERO, hp: 2, spa: 32, spe: 32 } })
  const INCIN = mk('incineroar', 'intimidate', ['flareblitz'], { nature: 'adamant' })
  const only = (...ids: string[]) => ({ filters: { topN: 10, selected: ids } })
  const NO_WIND: BattleConditions = { attacker: { tailwind: false }, defender: { tailwind: false } }
  const specsOf = (p: TabPlan) => [...Object.values(p.rows), ...Object.values(p.filters), ...Object.values(p.fixed)]
  const probe = (p: TabPlan, target: 'row' | 'filter', id: string) => {
    const r = computeRowTask(p, { kind: 'probe', target, id })
    if (r.kind !== 'probe') throw new Error(r.kind)
    return r.cell
  }

  it('공격 탭: 내가 어흥염이고 상대가 메가리자몽Y여도 내 플레어드라이브 판정은 날씨 없음', () => {
    const p = planTab(input({ mySet: INCIN, ...only('charizardmegay') }), 'attack')
    const rows = Object.values(p.rows).filter((r) => r.moveId === 'flareblitz' && r.kind === 'base')
    expect(rows.length).toBeGreaterThan(0)
    for (const spec of specsOf(p)) expect(spec.conditions).toEqual(NO_WIND)
    const r = rows[0]
    const core = calcDamage(game, r.attacker, r.defender, 'flareblitz', NO_WIND)
    expect(core.kind).toBe('damage')
    if (core.kind === 'damage') expect(probe(p, 'row', r.id).maxPercent).toBe(core.maxPercent)
  })

  it('방어 탭: 메가리자몽Y가 나(어흥염)를 칠 때는 쾌청 기준, 웨더볼은 불꽃이 되어 후보에서 빠진다(불꽃/악에 반감)', () => {
    const p = planTab(input({ mySet: INCIN, ...only('charizardmegay') }), 'defense')
    const specs = specsOf(p)
    expect(specs.length).toBeGreaterThan(0)
    for (const spec of specs) expect(spec.conditions).toEqual({ ...NO_WIND, weather: 'Sun' })
    const moves = new Set(p.cards.flatMap((c) => c.conditions.flatMap((g) => g.candidates.map((x) => x.moveId))))
    expect(moves.has('weatherball')).toBe(false)
    // 강철인 내 세트(대도각참)에는 열풍이 후보이고, 판정은 쾌청 기준이다(날씨 없음보다 크다)
    const steel = planTab(input({ mySet: mk('kingambit', 'defiant', ['kowtowcleave']), ...only('charizardmegay') }), 'defense')
    const [fid, f] = Object.entries(steel.filters).find(([, x]) => x.moveId === 'heatwave' && x.basis === undefined) ?? []
    if (fid === undefined || f === undefined) throw new Error('열풍 필터 없음')
    const sun = calcDamage(game, f.attacker, f.defender, 'heatwave', { ...NO_WIND, weather: 'Sun' })
    const none = calcDamage(game, f.attacker, f.defender, 'heatwave', NO_WIND)
    if (sun.kind !== 'damage' || none.kind !== 'damage') throw new Error('대미지 아님')
    expect(sun.maxPercent).toBeGreaterThan(none.maxPercent)
    expect(probe(steel, 'filter', fid).maxPercent).toBe(sun.maxPercent)
    expect(judgementKey(steel, { kind: 'probe', target: 'filter', id: fid })).toContain('["weather","Sun"]')
  })

  it('공격 탭: 내가 메가리자몽Y면 내 판정이 쾌청 기준', () => {
    const atk = planTab(input({ mySet: ZARD_Y, ...only('incineroar', 'garchomp') }), 'attack')
    const specs = specsOf(atk)
    expect(specs.length).toBeGreaterThan(0)
    for (const spec of specs) expect(spec.conditions).toEqual({ ...NO_WIND, weather: 'Sun' })
  })

  it('방어 탭: 공격측 상대 계산 특성이 그래스메이커일 때만 그래스필드, 아니면 조건이 그대로다', () => {
    const p = planTab(input({ mySet: PLAIN, ...only('rillaboom', 'garchomp') }), 'defense')
    const rilla = repAbility(entryOf('rillaboom'))
    for (const c of p.cards) {
      const ids = [...c.rowIds, ...c.filterIds]
      const expected = c.opponent.id === 'rillaboom' && rilla === 'grassysurge' ? { ...NO_WIND, terrain: 'Grassy' } : NO_WIND
      for (const id of ids) expect((p.rows[id] ?? p.filters[id]).conditions, c.id).toEqual(expected)
    }
    expect(rilla).toBe('grassysurge')
  })
})

describe('planTab: 공격측 필드의 우선도·스피드(R12·AC34)', () => {
  const candidatesOf = (p: TabPlan, opponent: string) =>
    p.cards.filter((c) => c.opponent.id === opponent).flatMap((c) => c.conditions.flatMap((g) => g.candidates))
  /** 대표 세트·특성 분포를 ability 하나로 바꾼 래더 항목 */
  const withAbility = (e: MetaEntry, ability: string): MetaEntry =>
    syntheticEntry(e, { abilities: { [ability]: 1 }, representative: { ...e.representative, set: { ...e.representative.set, ability } } })

  it('그래스메이커 상대의 그래스슬라이더 후보는 선공기, 같은 상대 우드해머·특성이 다른 상대의 그래스슬라이더는 아니다', () => {
    const p = planTab(input({ mySet: PLAIN, filters: { topN: 10, selected: ['rillaboom'] } }), 'defense')
    const cs = candidatesOf(p, 'rillaboom')
    const glide = cs.filter((c) => c.moveId === 'grassyglide')
    expect(glide.length).toBeGreaterThan(0)
    for (const c of glide) expect(c.priority).toBe(true)
    for (const c of cs.filter((x) => x.moveId === 'woodhammer')) expect(c.priority).toBe(false)
    const overgrow = withAbility(entryOf('rillaboom'), 'overgrow')
    const q = planTab(input({ mySet: PLAIN, view: syntheticView(game, bo1.meta, [overgrow]) }), 'defense')
    const glide2 = candidatesOf(q, 'rillaboom').filter((c) => c.moveId === 'grassyglide')
    expect(glide2.length).toBeGreaterThan(0)
    for (const c of glide2) expect(c.priority).toBe(false)
  })

  it('공격 탭: 내가 그래스메이커면 내 그래스슬라이더 후보가 선공기', () => {
    const me = mk('rillaboom', 'grassysurge', ['grassyglide', 'woodhammer'], { nature: 'adamant' })
    const p = planTab(input({ mySet: me, filters: { topN: 3, selected: [] } }), 'attack')
    const cs = p.cards.flatMap((c) => c.conditions.flatMap((g) => g.candidates))
    expect(cs.some((c) => c.moveId === 'grassyglide')).toBe(true)
    for (const c of cs) expect(c.priority, c.moveId).toBe(c.moveId === 'grassyglide')
  })

  it('사이코메이커 상대의 선공기는 땅에 붙은 나에게 0배라 기본 후보에서 빠지고, 비행 타입·풍선인 나에게는 남는다', () => {
    const base = withAbility(entryOf('indeedeef'), 'psychicsurge')
    const e = syntheticEntry(base, { moves: { shares: { fakeout: 0.9, psychic: 0.8, dazzlinggleam: 0.7 }, keptShare: 2.4, excludedShare: 0 } })
    expect(defenseMoveIds(game, e, PLAIN_ME, 'psychicsurge')).toEqual(['psychic', 'dazzlinggleam'])
    expect(defenseMoveIds(game, e, PLAIN_ME, 'owntempo')).toEqual(['fakeout', 'psychic', 'dazzlinggleam'])
    expect(defenseMoveIds(game, e, { ...PLAIN_ME, item: 'airballoon' }, 'psychicsurge')).toEqual(['fakeout', 'psychic', 'dazzlinggleam'])
    expect(defenseMoveIds(game, e, { types: ['Fire', 'Flying'], ability: 'blaze' }, 'psychicsurge')).toContain('fakeout')
    // 계획: 풍선을 든 나에게는 속이다 후보가 있다(내 도구가 접지 판정에 들어간다)
    const view = syntheticView(game, bo1.meta, [e])
    const moves = (set: PokemonSet) => new Set(candidatesOf(planTab(input({ mySet: set, view }), 'defense'), 'indeedeef').map((c) => c.moveId))
    expect(moves(PLAIN).has('fakeout')).toBe(false)
    expect(moves({ ...PLAIN, item: 'airballoon' }).has('fakeout')).toBe(true)
  })

  it('방어 탭 speedEdge는 공격측(상대) 특성 날씨로 비교한다: 가뭄 상대면 엽록소인 내가 빠르다', () => {
    const venu = mk('venusaur', 'chlorophyll', ['gigadrain'], { nature: 'timid', sp: { ...ZERO, hp: 2, spa: 32, spe: 32 } })
    const p = planTab(input({ mySet: venu, filters: { topN: 10, selected: ['ninetales'] } }), 'defense')
    const cards = p.cards.filter((c) => c.opponent.id === 'ninetales' && c.state === 'ok')
    expect(cards.length).toBeGreaterThan(0)
    expect(repAbility(entryOf('ninetales'))).toBe('drought')
    for (const c of cards) expect(c.speedEdge, c.id).toBe(true)
    // 같은 상대가 가뭄이 아니면 날씨 없음 기준이라 내가 확실히 빠르지 않다
    const ff = withAbility(entryOf('ninetales'), 'flashfire')
    const q = planTab(input({ mySet: venu, view: syntheticView(game, bo1.meta, [ff]) }), 'defense')
    const qc = q.cards.filter((c) => c.state === 'ok')
    expect(qc.length).toBeGreaterThan(0)
    for (const c of qc) expect(c.speedEdge, c.id).toBe(false)
  })
})

describe('opponentSeeds: planTab 기본 카드와 동등', () => {
  const ROTOM = { rosterId: 'rotomwash', moves: ['hydropump', 'thief', 'electroweb'], edits: { [presetKey('attack', 'special', 0)]: { sp: { hp: 10, spd: 20 } } } }
  const ladderIds = bo1.ranking.slice(0, 3).map((e) => e.id)
  const keysOf = (plan: TabPlan, source: 'ladder' | 'custom', id: string, category: CardSpec['category']) =>
    new Set(plan.cards.filter((c) => c.opponent.source === source && c.opponent.id === id && c.category === category && c.berry === undefined).map((c) => c.bundle.key))

  for (const tab of ['attack', 'defense'] as const) {
    it(`${tab}: 범위 안 래더 상대와 목록 밖 타겟의 분류별 cards 키 = planTab 기본 카드 키(사용자 추가 포함)`, () => {
      const inp0 = input({ mySet: GARCHOMP, filters: { topN: 3, selected: [] }, customTargets: [ROTOM] })
      // 사용자 추가 배분은 그 상대·분류의 키 능력치로 만든다(방어 탭 키는 상대 기술에 따라 다르다).
      const addedBundles: AddedBundle[] = []
      for (const id of ladderIds.slice(0, 2)) {
        const r = opponentSeeds(inp0, tab, { source: 'ladder', id })
        if (r.kind !== 'ok') throw new Error(`${id}: ${r.kind}`)
        const c = r.categories.find((x) => x.keyStats.length > 0)
        if (c !== undefined) addedBundles.push({ tab, source: 'ladder', opponentId: id, category: c.category, sp: Object.fromEntries(c.keyStats.map((s) => [s, 7])) })
      }
      expect(addedBundles.length).toBeGreaterThan(0)
      const inp = { ...inp0, addedBundles }
      const plan = planTab(inp, tab)
      let userSeen = 0
      const targets = [...ladderIds.map((id) => ({ source: 'ladder' as const, id })), { source: 'custom' as const, id: ROTOM.rosterId }]
      for (const target of targets) {
        const r = opponentSeeds(inp, tab, target)
        if (r.kind !== 'ok') throw new Error(`${target.id}: ${r.kind}`)
        const shown = new Set(plan.cards.filter((c) => c.opponent.source === target.source && c.opponent.id === target.id).map((c) => c.category))
        expect(r.categories.map((c) => c.category), target.id).toEqual([...shown])
        for (const c of r.categories) {
          expect(new Set(c.cards.map((b) => b.key)), `${target.id} ${c.category}`).toEqual(keysOf(plan, target.source, target.id, c.category))
          userSeen += c.cards.filter((b) => b.userAdded !== undefined).length
          expect(c.observed.every((b) => b.userAdded === undefined)).toBe(true)
        }
      }
      expect(userSeen).toBe(addedBundles.length)
    })
  }

  for (const tab of ['attack', 'defense'] as const) {
    it(`${tab}: 범위 밖 추가분만 상대와 목록 밖 추가 배분도 cards 키 = planTab 기본 카드 키, observed·baseSp는 그대로`, () => {
      const inp0 = input({ mySet: GARCHOMP, filters: { topN: 1, selected: [] }, customTargets: [ROTOM] })
      const targets = [
        { source: 'ladder' as const, id: bo1.ranking[4].id },
        { source: 'custom' as const, id: ROTOM.rosterId },
      ]
      const addedBundles: AddedBundle[] = []
      for (const target of targets) {
        const r = opponentSeeds(inp0, tab, target)
        if (r.kind !== 'ok') throw new Error(`${target.id}: ${r.kind}`)
        const c = r.categories.find((x) => x.keyStats.length > 0)
        if (c !== undefined) addedBundles.push({ tab, source: target.source, opponentId: target.id, category: c.category, sp: Object.fromEntries(c.keyStats.map((st) => [st, 7])) })
      }
      expect(addedBundles).toHaveLength(2)
      const inp = { ...inp0, addedBundles }
      const plan = planTab(inp, tab)
      for (const target of targets) {
        const r = opponentSeeds(inp, tab, target)
        const before = opponentSeeds(inp0, tab, target)
        if (r.kind !== 'ok' || before.kind !== 'ok') throw new Error(target.id)
        for (const c of r.categories) {
          expect(new Set(c.cards.map((b) => b.key)), `${target.id} ${c.category}`).toEqual(keysOf(plan, target.source, target.id, c.category))
          const prev = before.categories.find((x) => x.category === c.category)
          expect(c.observed).toEqual(prev?.observed)
          expect(c.baseSp).toEqual(prev?.baseSp)
        }
        expect(r.categories.reduce((n, c) => n + c.cards.filter((b) => b.userAdded !== undefined).length, 0)).toBe(1)
      }
      const out = opponentSeeds(inp0, tab, targets[0])
      if (out.kind !== 'ok') throw new Error(out.kind)
      expect(out.categories.length).toBeGreaterThan(0)
      expect(out.categories.every((c) => c.cards.length === 0)).toBe(true)
    })
  }

  it('목록 밖 타겟: observed = 프리셋 3개, baseSp = 프리셋 1(편집 반영) SP', () => {
    const inp = input({ mySet: GARCHOMP, customTargets: [ROTOM] })
    const r = opponentSeeds(inp, 'attack', { source: 'custom', id: ROTOM.rosterId })
    if (r.kind !== 'ok') throw new Error(r.kind)
    const special = r.categories.find((c) => c.category === 'special')
    if (special === undefined) throw new Error('no special')
    expect(special.observed.map((b) => b.presetIndex)).toEqual([0, 1, 2])
    expect(special.baseSp.hp).toBe(10)
    expect(special.baseSp.spd).toBe(20)
    const card = planTab(inp, 'attack').cards.find((c) => c.opponent.source === 'custom' && c.category === 'special' && c.bundle.presetIndex === 0)
    expect(special.baseSp).toEqual(card?.opponentSet.sp)
  })

  it('래더: observed는 점유율 기준 이상만. 기준 이상이 없으면 observed는 비고 cards에 minority 키가 있다', () => {
    const e = entryOf('garchomp')
    const view = syntheticView(game, bo1.meta, [syntheticEntry(e, { spreads: { kept: [['jolly:2/32/0/0/0/32', 0.03], ['impish:32/0/32/0/2/0', 0.02]], keptShare: 0.05, excludedShare: 0 } })])
    const inp = { ...input({ mySet: GARCHOMP, filters: { topN: 30, selected: ['garchomp'] } }), view }
    const r = opponentSeeds(inp, 'attack', { source: 'ladder', id: 'garchomp' })
    if (r.kind !== 'ok') throw new Error(r.kind)
    expect(r.categories.length).toBeGreaterThan(0)
    for (const c of r.categories) {
      expect(c.observed).toEqual([])
      expect(c.cards.some((b) => b.minority)).toBe(true)
      expect(new Set(c.cards.map((b) => b.key))).toEqual(keysOf(planTab(inp, 'attack'), 'ladder', 'garchomp', c.category))
    }
    const full = opponentSeeds(input({ mySet: GARCHOMP }), 'attack', { source: 'ladder', id: 'garchomp' })
    if (full.kind !== 'ok') throw new Error(full.kind)
    expect(full.categories.some((c) => c.observed.length > 0)).toBe(true)
    for (const c of full.categories) {
      for (const b of c.observed) expect(b.minority === false && (b.share ?? 0) >= DEFAULT_CRITERIA.bundleShareMin).toBe(true)
    }
  })

  it('래더 baseSp = 첫 관측 씨앗 가정 SP(도구 제거와 무관)', () => {
    const inp = input({ mySet: GARCHOMP, filters: { topN: 3, selected: [] } })
    const id = ladderIds[0]
    const r = opponentSeeds(inp, 'attack', { source: 'ladder', id })
    if (r.kind !== 'ok') throw new Error(r.kind)
    const plan = planTab(inp, 'attack')
    for (const c of r.categories) {
      const first = plan.cards.find((x) => x.opponent.id === id && x.opponent.source === 'ladder' && x.category === c.category)
      expect(c.baseSp).toEqual(first?.opponentSet.sp)
    }
  })

  it('없는 상대는 not-found, 내 세트가 무효면 my-set-error, 범위 밖 래더 상대도 계산한다', () => {
    const inp = input({ mySet: GARCHOMP, filters: { topN: 1, selected: [] }, customTargets: [{ rosterId: 'garchomp', moves: ['earthquake'], edits: {} }, { ...ROTOM, moves: [] }] })
    expect(opponentSeeds(inp, 'attack', { source: 'ladder', id: 'notinmeta' }).kind).toBe('not-found')
    expect(opponentSeeds(inp, 'attack', { source: 'custom', id: 'garchomp' }).kind).toBe('not-found')
    expect(opponentSeeds(inp, 'attack', { source: 'custom', id: 'rotomwash' }).kind).toBe('not-found')
    expect(opponentSeeds({ ...inp, mySet: { ...GARCHOMP, sp: { ...GARCHOMP.sp, def: 40 } } }, 'attack', { source: 'ladder', id: ladderIds[0] }).kind).toBe('my-set-error')
    expect(opponentSeeds(inp, 'defense', { source: 'ladder', id: bo1.ranking[10].id }).kind).toBe('ok')
  })
})
