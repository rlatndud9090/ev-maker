// PRD 수용 기준: 스피드, 스윕. 기대 경계 SP는 notes "독립 기준값" a)·b)·c)의 산술값을 그대로 옮긴다.
import { describe, expect, it } from 'vitest'
import { MC, mkSet } from '../core/testing'
import {
  calcDamage,
  compareSpeed,
  finalSpeed,
  minSpToOutspeed,
  sweepDamage,
  sweepSpeed,
  type BattleConditions,
  type PokemonSet,
  type SweepResult,
} from '../core/index'
import { oracleStat } from './oracle'

const floette = (spe = 32, over: Partial<PokemonSet> = {}) =>
  ({ ...mkSet({ species: 'floetteeternal', ability: 'flowerveil', nature: 'timid', sp: { spe } }), ...over }) as PokemonSet
const garchompJolly = mkSet({ species: 'garchomp', ability: 'roughskin', nature: 'jolly' })

describe('수용 기준: 스피드', () => {
  it('AC-P1 스피드 158: 순풍 316, 스카프 237, 스카프+순풍 474, 랭크 +1 237, −1 105, 마비 79', () => {
    const tw: BattleConditions = { attacker: { tailwind: true } }
    expect(finalSpeed(MC, floette())).toBe(158)
    expect(finalSpeed(MC, floette(), tw)).toBe(316)
    expect(finalSpeed(MC, floette(32, { item: 'choicescarf' }))).toBe(237)
    expect(finalSpeed(MC, floette(32, { item: 'choicescarf' }), tw)).toBe(474)
    expect(finalSpeed(MC, floette(32, { boosts: { spe: 1 } }))).toBe(237)
    expect(finalSpeed(MC, floette(32, { boosts: { spe: -1 } }))).toBe(105)
    expect(finalSpeed(MC, floette(32, { status: 'par' }))).toBe(79)
  })

  it.each([
    ['쓱쓱', 'swiftswim', 'basculegion', 'Rain'],
    ['엽록소', 'chlorophyll', 'venusaur', 'Sun'],
    ['모래헤치기', 'sandrush', 'excadrill', 'Sand'],
    ['눈치우기', 'slushrush', 'beartic', 'Snow'],
  ] as const)('AC-P2 %s(%s, %s): 해당 날씨면 2배, 다른 날씨·날씨 없음이면 그대로', (_, ability, species, weather) => {
    expect(MC.data.species[species].abilities).toContain(ability)
    const set = mkSet({ species, ability, sp: { spe: 32 } })
    const base = finalSpeed(MC, set)
    expect(finalSpeed(MC, set, { weather })).toBe(base * 2)
    for (const w of ['Sun', 'Rain', 'Sand', 'Snow'] as const) {
      if (w !== weather) expect(finalSpeed(MC, set, { weather: w }), w).toBe(base)
    }
  })

  it('AC-P3 같은 스피드는 동속', () => {
    expect(compareSpeed(MC, floette(), floette()).order).toBe('tie')
    // 다른 종이라도 최종 스피드가 같으면 동속(플라엣테 SP10 = 134 = 명랑 한카리아스 SP0)
    const r = compareSpeed(MC, floette(10), garchompJolly)
    expect([r.attackerSpeed, r.defenderSpeed, r.order]).toEqual([134, 134, 'tie'])
  })

  it('AC-P4 우선도 기술(기습)을 지정해도 선공/후공은 바뀌지 않고 우선도는 별도 정보', () => {
    const slow = mkSet({ species: 'kingambit', ability: 'defiant' })
    const slowSucker = { ...slow, moves: ['suckerpunch'] }
    const plain = compareSpeed(MC, slow, floette())
    const withPrio = compareSpeed(MC, slowSucker, floette())
    expect(plain.order).toBe('second')
    expect(withPrio.order).toBe('second')
    expect(withPrio.attackerSpeed).toBe(plain.attackerSpeed)
    expect(withPrio.attackerPriority).toBe(MC.data.moves.suckerpunch.priority)
    expect(withPrio.attackerPriority).toBe(1)
  })

  describe('AC-P5 추월 역산', () => {
    const targets = [garchompJolly, mkSet({ species: 'kingambit', ability: 'defiant', sp: { spe: 32 } }), mkSet({ species: 'incineroar', ability: 'blaze' })]
    it('결과 SP에서는 추월하고 결과 − 1에서는 못 한다', () => {
      for (const t of targets) {
        const r = minSpToOutspeed(MC, floette(0), t)
        if (r.kind !== 'ok') throw new Error(`추월 가능해야 한다: ${r.kind}`)
        const target = compareSpeed(MC, floette(0), t).defenderSpeed
        expect(finalSpeed(MC, floette(r.sp))).toBeGreaterThan(target)
        if (r.sp > 0) expect(finalSpeed(MC, floette(r.sp - 1))).toBeLessThanOrEqual(target)
      }
    })

    it('동속이 되는 SP는 추월로 치지 않는다(명랑 한카리아스 134: SP10 동속, 결과 11)', () => {
      expect(oracleStat('other', MC.data.species.floetteeternal.baseStats.spe, 10, 11)).toBe(134)
      expect(minSpToOutspeed(MC, floette(0), garchompJolly)).toEqual({ kind: 'ok', sp: 11 })
      expect(minSpToOutspeed(MC, floette(0), 134)).toEqual({ kind: 'ok', sp: 11 })
    })

    it('32 SP로도 못 넘으면 불가', () => {
      expect(minSpToOutspeed(MC, floette(0), 158)).toEqual({ kind: 'impossible' })
      expect(minSpToOutspeed(MC, floette(0), 157)).toEqual({ kind: 'ok', sp: 32 })
    })

    it('남은 예산을 넘으면 예산 초과', () => {
      // 다른 능력치 60 → 남은 예산 6, 필요 11
      const set = mkSet({ species: 'floetteeternal', ability: 'flowerveil', nature: 'timid', sp: { hp: 32, spa: 28 } })
      expect(minSpToOutspeed(MC, set, garchompJolly)).toEqual({ kind: 'over-budget', sp: 11, remaining: 6 })
    })
  })
})

/** 경계 SP 불변식: 경계에서는 구간이 sp−1과 다르고, 경계 아닌 칸은 같다. */
function expectBoundaryInvariant<T>(r: SweepResult<T>) {
  expect(r.cells).toHaveLength(33)
  for (let sp = 1; sp <= 32; sp++) {
    const prev = r.cells[sp - 1]
    const cur = r.cells[sp]
    if (prev.kind !== 'ok' || cur.kind !== 'ok') {
      expect(r.boundaries).not.toContain(sp)
      continue
    }
    expect(r.boundaries.includes(sp), `SP ${sp}`).toBe(prev.category !== cur.category)
  }
}

describe('수용 기준: 스윕', () => {
  const kingambit = mkSet({ species: 'kingambit', ability: 'defiant' })
  const delphoxMega = mkSet({ species: 'delphox', ability: 'blaze', item: 'delphoxite', mega: true, sp: { hp: 2 } })
  const garchompAdamant = mkSet({ species: 'garchomp', ability: 'roughskin', nature: 'adamant', sp: { atk: 32 } })
  const dragonite = mkSet({ species: 'dragonite', ability: 'innerfocus' })

  it('AC-W1a 공격측 공격 SP 스윕(대도각참 기습 → 메가마폭시): 33칸, 경계 13·19(notes 산술), 칸 = 단건 계산', () => {
    const r = sweepDamage(MC, { side: 'attacker', stat: 'atk' }, kingambit, delphoxMega, 'suckerpunch')
    expect(r.boundaries).toEqual([13, 19])
    expectBoundaryInvariant(r)
    for (const c of r.cells) {
      if (c.kind !== 'ok') throw new Error('예산 초과 칸이 없어야 한다')
      const single = calcDamage(MC, { ...kingambit, sp: { ...kingambit.sp, atk: c.sp } }, delphoxMega, 'suckerpunch')
      expect(c.value).toEqual(single)
      expect(single.kind === 'damage' && single.attackBand).toBe(c.category)
    }
    // 같은 구간 안에서 확률만 바뀐 칸은 경계가 아니다
    for (const sp of [1, 4, 7, 10, 16]) {
      const [p, q] = [r.cells[sp - 1], r.cells[sp]]
      if (p.kind !== 'ok' || q.kind !== 'ok' || p.value.kind !== 'damage' || q.value.kind !== 'damage') throw new Error('대미지 칸')
      expect(q.value.ohkoChance, `SP ${sp}`).not.toBe(p.value.ohkoChance)
      expect(r.boundaries).not.toContain(sp)
    }
  })

  it('AC-W1b 방어측 HP SP 스윕(한카리아스 드래곤클로 → 망나뇽): 경계 17·23, 칸 = 단건 계산', () => {
    const r = sweepDamage(MC, { side: 'defender', stat: 'hp' }, garchompAdamant, dragonite, 'dragonclaw')
    expect(r.boundaries).toEqual([17, 23])
    expectBoundaryInvariant(r)
    for (const c of r.cells) {
      if (c.kind !== 'ok') throw new Error('예산 초과 칸이 없어야 한다')
      const single = calcDamage(MC, garchompAdamant, { ...dragonite, sp: { ...dragonite.sp, hp: c.sp } }, 'dragonclaw')
      expect(c.value).toEqual(single)
      expect(single.kind === 'damage' && single.defenseBand).toBe(c.category)
    }
  })

  it('AC-W1c 스피드 SP 스윕(겁쟁이 플라엣테 vs 명랑 한카리아스): 동속이 별도 범주로 경계 10·11, 칸 = 단건 비교', () => {
    const r = sweepSpeed(MC, floette(0), garchompJolly)
    expect(r.boundaries).toEqual([10, 11])
    expectBoundaryInvariant(r)
    const cats = r.cells.map((c) => (c.kind === 'ok' ? c.category : 'x'))
    expect(cats[9]).toBe('second')
    expect(cats[10]).toBe('tie')
    expect(cats[11]).toBe('first')
    for (const c of r.cells) {
      if (c.kind !== 'ok') throw new Error('예산 초과 칸이 없어야 한다')
      expect(c.value).toEqual(compareSpeed(MC, floette(c.sp), garchompJolly))
    }
  })

  it('AC-W2 다른 능력치 합계 40(HP 32, 스피드 8)이면 공격 27~32는 "예산 초과"로 표시되고 경계에서 빠진다', () => {
    const set = mkSet({ species: 'kingambit', ability: 'defiant', sp: { hp: 32, spe: 8 } })
    const r = sweepDamage(MC, { side: 'attacker', stat: 'atk' }, set, delphoxMega, 'suckerpunch')
    const over = r.cells.filter((c) => c.kind === 'over-budget').map((c) => c.sp)
    expect(over).toEqual([27, 28, 29, 30, 31, 32])
    expect(r.boundaries.every((b) => b <= 26)).toBe(true)
    expect(r.boundaries).toEqual([13, 19])
  })

  it('AC-W3 SP 스윕 1회 중앙값 50ms 이하(Node 측정, 기록은 notes "성능 측정")', () => {
    const run = () => sweepDamage(MC, { side: 'attacker', stat: 'atk' }, kingambit, delphoxMega, 'suckerpunch')
    for (let i = 0; i < 3; i++) run()
    const times: number[] = []
    for (let i = 0; i < 21; i++) {
      const t = performance.now()
      run()
      times.push(performance.now() - t)
    }
    times.sort((a, b) => a - b)
    expect(times[10]).toBeLessThanOrEqual(50)
  })
})
