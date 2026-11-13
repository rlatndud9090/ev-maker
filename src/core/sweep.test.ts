import { describe, expect, it } from 'vitest'
import { MC, goldenCase, goldenSet, mkSet } from './testing'
import {
  CoreInputError,
  calcDamage,
  compareSpeed,
  sweep,
  sweepDamage,
  sweepSpeed,
  type DamageResult,
  type PokemonSet,
  type SweepResult,
} from './index'

/** 경계 불변식: sp가 경계 ⇔ sp와 sp−1이 모두 판정 칸이고 범주가 다르다. */
function expectBoundaryInvariant<T>(r: SweepResult<T>) {
  expect(r.cells).toHaveLength(33)
  r.cells.forEach((c, i) => expect(c.sp).toBe(i))
  for (let sp = 1; sp <= 32; sp++) {
    const prev = r.cells[sp - 1]
    const cur = r.cells[sp]
    const changed = prev.kind === 'ok' && cur.kind === 'ok' && prev.category !== cur.category
    expect(r.boundaries.includes(sp), `sp ${sp}`).toBe(changed)
  }
}

const okCell = <T,>(r: SweepResult<T>, sp: number) => {
  const c = r.cells[sp]
  if (c.kind !== 'ok') throw new Error(`sp ${sp}는 예산 초과 칸이다`)
  return c
}

const withSp = (set: PokemonSet, stat: keyof PokemonSet['sp'], sp: number): PokemonSet => ({ ...set, sp: { ...set.sp, [stat]: sp } })

describe('스윕 독립 기준값(출처: 독립 산술 scripts/golden/compute-independent.mjs)', () => {
  it('a) 공격측 공격 SP 스윕: 경계 13·19, 칸마다 단건 계산과 같다', () => {
    const g = goldenCase<{ cells: { sp: number; rolls: number[]; attackBand: string }[]; boundaries: number[] }>('a-kingambit-sucker-punch-atk-sweep')
    const atk = goldenSet(g.attacker)
    const def = goldenSet(g.defender)
    const r = sweepDamage(MC, { side: 'attacker', stat: 'atk' }, atk, def, 'suckerpunch')
    expect(r.boundaries).toEqual(g.boundaries)
    expect(r.boundaries).toEqual([13, 19])
    expectBoundaryInvariant(r)
    for (const gc of g.cells) {
      const c = okCell(r, gc.sp)
      expect(c.category).toBe(gc.attackBand)
      expect(c.value).toEqual(calcDamage(MC, withSp(atk, 'atk', gc.sp), def, 'suckerpunch'))
    }
    // 같은 구간 안에서 확률만 바뀐 칸은 경계가 아니다
    for (const sp of [1, 4, 7, 10, 16]) expect(r.boundaries).not.toContain(sp)
  })

  it('b) 방어측 HP SP 스윕: 경계 17·23', () => {
    const g = goldenCase<{ cells: { sp: number; defenderHp: number; rolls: number[]; ohkoChance: number; defenseBand: string }[]; boundaries: number[] }>(
      'b-garchomp-dragon-claw-vs-dragonite-hp-sweep',
    )
    const atk = goldenSet(g.attacker)
    const def = goldenSet(g.defender)
    const r = sweepDamage(MC, { side: 'defender', stat: 'hp' }, atk, def, 'dragonclaw')
    expect(r.boundaries).toEqual(g.boundaries)
    expectBoundaryInvariant(r)
    for (const gc of g.cells) {
      const c = okCell(r, gc.sp)
      const v = c.value as Extract<DamageResult, { kind: 'damage' }>
      expect([v.defenderHp, v.rolls, v.ohkoChance, c.category]).toEqual([gc.defenderHp, [gc.rolls], gc.ohkoChance, gc.defenseBand])
      expect(c.value).toEqual(calcDamage(MC, atk, withSp(def, 'hp', gc.sp), 'dragonclaw'))
    }
  })

  it('c) 스피드 SP 스윕: 동속이 별도 범주로 경계 10·11에 잡힌다', () => {
    const g = goldenCase<{ cells: { sp: number; attackerSpeed: number; defenderSpeed: number; order: string }[]; boundaries: number[] }>(
      'c-floette-eternal-timid-vs-garchomp-jolly-speed-sweep',
    )
    const a = goldenSet(g.attacker)
    const b = goldenSet(g.defender)
    const r = sweepSpeed(MC, a, b)
    expect(r.boundaries).toEqual([10, 11])
    expect(r.boundaries).toEqual(g.boundaries)
    expectBoundaryInvariant(r)
    for (const gc of g.cells) {
      const c = okCell(r, gc.sp)
      expect(c.value).toEqual({ attackerSpeed: gc.attackerSpeed, defenderSpeed: gc.defenderSpeed, order: gc.order })
      expect(c.value).toEqual(compareSpeed(MC, withSp(a, 'spe', gc.sp), b))
      expect(c.category).toBe(gc.order)
    }
    expect(okCell(r, 10).category).toBe('tie')
  })
})

describe('스윕 예산·임계값·입력', () => {
  const kingambit = mkSet({ species: 'kingambit', ability: 'defiant' })
  const delphox = mkSet({ species: 'delphox', ability: 'blaze', item: 'delphoxite', mega: true, sp: { hp: 2 } })

  it('다른 능력치 합계 40(HP 32, 스피드 8)이면 공격 27~32는 예산 초과이고 경계에서 빠진다', () => {
    const set = { ...kingambit, sp: { ...kingambit.sp, hp: 32, spe: 8 } }
    const r = sweepDamage(MC, { side: 'attacker', stat: 'atk' }, set, delphox, 'suckerpunch')
    expect(r.cells.filter((c) => c.kind === 'over-budget').map((c) => c.sp)).toEqual([27, 28, 29, 30, 31, 32])
    expect(r.boundaries.every((b) => b < 27)).toBe(true)
    expect(r.boundaries).toEqual([13, 19])
    expectBoundaryInvariant(r)
  })

  it('경계가 예산 초과 구간에 걸리면 빠진다(합성 판정)', () => {
    const set = { ...kingambit, sp: { ...kingambit.sp, hp: 32, spe: 16 } }
    const r = sweep(MC, set, 'atk', (_, sp) => ({ value: sp, category: sp >= 20 ? 'hi' : 'lo' }))
    expect(r.cells.filter((c) => c.kind === 'over-budget')).toHaveLength(14)
    expect(r.boundaries).toEqual([])
  })

  it('임계값을 바꾸면(고난수 62.5%) 단건과 스윕이 함께 바뀐다', () => {
    const t = { highRoll: 0.625 }
    const r = sweepDamage(MC, { side: 'attacker', stat: 'atk' }, kingambit, delphox, 'suckerpunch', undefined, t)
    expect(r.boundaries).toEqual([10, 19])
    const single = calcDamage(MC, withSp(kingambit, 'atk', 10), delphox, 'suckerpunch', undefined, t)
    expect(single.kind === 'damage' && single.attackBand).toBe('high-roll-ohko')
    expect(okCell(r, 10).category).toBe('high-roll-ohko')
    for (const c of r.cells) {
      if (c.kind !== 'ok') continue
      const s = calcDamage(MC, withSp(kingambit, 'atk', c.sp), delphox, 'suckerpunch', undefined, t)
      expect(s.kind === 'damage' && s.attackBand).toBe(c.category)
    }
  })

  it('면역 대면은 1타 확률 0의 구간으로 스윕되고, 변화기·허용 밖 능력치·잘못된 임계값은 거부', () => {
    const mamo = mkSet({ species: 'mamoswine', ability: 'oblivious' })
    const imm = sweepDamage(MC, { side: 'defender', stat: 'hp' }, mamo, delphox, 'earthquake')
    expect(imm.cells.every((c) => c.kind === 'ok' && c.category === 'guaranteed-survive')).toBe(true)
    expect(imm.boundaries).toEqual([])
    expect(() => sweepDamage(MC, { side: 'attacker', stat: 'atk' }, kingambit, delphox, 'swordsdance')).toThrow(CoreInputError)
    expect(() => sweepDamage(MC, { side: 'attacker', stat: 'spe' }, kingambit, delphox, 'suckerpunch')).toThrow(CoreInputError)
    expect(() => sweepDamage(MC, { side: 'defender', stat: 'spa' }, kingambit, delphox, 'suckerpunch')).toThrow(CoreInputError)
    expect(() => sweepDamage(MC, { side: 'both' as never, stat: 'atk' }, kingambit, delphox, 'suckerpunch')).toThrow(CoreInputError)
    expect(() => sweepDamage(MC, { side: 'attacker', stat: 'atk' }, kingambit, delphox, 'suckerpunch', undefined, { highRoll: 0 })).toThrow(
      CoreInputError,
    )
    expect(() => sweepDamage(MC, { side: 'attacker', stat: 'atk' }, kingambit, delphox, 'suckerpunch', undefined, { lowRoll: Number.NaN })).toThrow(
      CoreInputError,
    )
  })
})

describe('구간 매핑 사례표(PRD 수용 기준)', async () => {
  const { attackBand, defenseBand, DEFAULT_THRESHOLDS } = await import('./index')
  it.each([
    [0, 'mid-or-lower', 'guaranteed-survive'],
    [2 / 16, 'mid-or-lower', 'low-roll-ohko'],
    [3 / 16, 'mid-or-lower', 'low-roll-ohko'],
    [4 / 16, 'mid-or-lower', 'mid-or-higher'],
    [11 / 16, 'mid-or-lower', 'mid-or-higher'],
    [12 / 16, 'high-roll-ohko', 'mid-or-higher'],
    [15 / 16, 'high-roll-ohko', 'mid-or-higher'],
    [1, 'guaranteed-ohko', 'mid-or-higher'],
  ])('%s → %s / %s', (p, a, d) => {
    expect(attackBand(p)).toBe(a)
    expect(defenseBand(p)).toBe(d)
  })
  it('경계값 변경(고난수 62.5%)과 기본값', () => {
    expect(DEFAULT_THRESHOLDS).toEqual({ highRoll: 0.75, lowRoll: 0.1875 })
    expect(attackBand(10 / 16, { highRoll: 0.625 })).toBe('high-roll-ohko')
    expect(attackBand(9 / 16, { highRoll: 0.625 })).toBe('mid-or-lower')
    expect(defenseBand(4 / 16, { lowRoll: 0.25 })).toBe('low-roll-ohko')
    expect(() => attackBand(1.1)).toThrow(CoreInputError)
  })
})

describe('성능(Node, notes "성능 측정"에 기록)', () => {
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]

  it('33칸 스윕 중앙값 ≤ 50ms, 1 × 300 × 1 일괄 측정', () => {
    const atk = mkSet({ species: 'kingambit', ability: 'defiant', sp: { atk: 32 } })
    const def = mkSet({ species: 'delphox', ability: 'blaze', item: 'delphoxite', mega: true, sp: { hp: 2 } })
    for (let i = 0; i < 5; i++) sweepDamage(MC, { side: 'attacker', stat: 'atk' }, atk, def, 'suckerpunch')
    const sweeps: number[] = []
    for (let i = 0; i < 50; i++) {
      const t0 = performance.now()
      sweepDamage(MC, { side: 'attacker', stat: 'atk' }, atk, def, 'suckerpunch')
      sweeps.push(performance.now() - t0)
    }
    const mamo = mkSet({ species: 'mamoswine', ability: 'oblivious', nature: 'adamant', sp: { atk: 32 } })
    // 비메가 합법 종(탈 전용 따라큐 제외 268)을 돌려 가며 HP SP를 달리한 300세트
    // 탈(Disguise)만 가진 종은 코어가 대미지 계산을 거부하므로 뺀다.
    const pool = Object.values(MC.data.species).filter((s) => !s.isMega && !s.abilities.every((a) => a === 'disguise'))
    const opponents = Array.from({ length: 300 }, (_, i) => {
      const s = pool[i % pool.length]
      const ability = s.abilities.find((a) => !MC.manifest.engineUnsupported.abilities.includes(a))!
      return mkSet({ species: s.id, ability, sp: { hp: i < pool.length ? 32 : 0 } })
    })
    expect(opponents).toHaveLength(300)
    const batches: number[] = []
    for (let i = 0; i < 10; i++) {
      const t0 = performance.now()
      for (const o of opponents) calcDamage(MC, mamo, o, 'earthquake')
      batches.push(performance.now() - t0)
    }
    console.log(`[perf] sweep33 median=${median(sweeps).toFixed(3)}ms batch300 median=${median(batches).toFixed(3)}ms`)
    expect(median(sweeps)).toBeLessThanOrEqual(50)
  })
})
