import { describe, expect, it } from 'vitest'
import { MC, goldenCase, goldenSet } from './testing'
import {
  CoreInputError,
  ROLL_DENOMINATOR,
  TIER_ORDER,
  judgeDamage,
  nextBetterTier,
  normalizeRollSteps,
  rollTier,
  sweepDamage,
  tierRank,
} from './index'

const k = (count: number) => count / ROLL_DENOMINATOR

describe('rollTier 5단 판정 경계', () => {
  it('n=14: 14/16 이상 고난수, 2/16 이하 저난수, 그 사이 중난수, 0·1은 확정', () => {
    expect(rollTier(1, 14)).toBe('guaranteed-ohko')
    expect(rollTier(k(15), 14)).toBe('high-roll-ohko')
    expect(rollTier(k(14), 14)).toBe('high-roll-ohko')
    expect(rollTier(k(13), 14)).toBe('mid-roll-ohko')
    expect(rollTier(k(3), 14)).toBe('mid-roll-ohko')
    expect(rollTier(k(2), 14)).toBe('low-roll-ohko')
    expect(rollTier(k(1), 14)).toBe('low-roll-ohko')
    expect(rollTier(1 / 256, 14)).toBe('low-roll-ohko')
    expect(rollTier(0, 14)).toBe('guaranteed-survive')
  })

  it('n=8: 경계가 겹치면(8/16) 고난수가 우선하고 중난수는 없다', () => {
    expect(rollTier(k(8), 8)).toBe('high-roll-ohko')
    expect(rollTier(k(7), 8)).toBe('low-roll-ohko')
    for (let c = 1; c < 16; c++) expect(rollTier(k(c), 8)).not.toBe('mid-roll-ohko')
  })

  it('n=1: 0 초과면 모두 고난수(겹침 구간 전체에서 고난수 우선)', () => {
    expect(rollTier(1 / 256, 1)).toBe('low-roll-ohko')
    expect(rollTier(k(1), 1)).toBe('high-roll-ohko')
    expect(rollTier(k(15), 1)).toBe('high-roll-ohko')
  })

  it('n=15: 15/16만 고난수, 1/16 이하만 저난수', () => {
    expect(rollTier(k(15), 15)).toBe('high-roll-ohko')
    expect(rollTier(k(14), 15)).toBe('mid-roll-ohko')
    expect(rollTier(k(2), 15)).toBe('mid-roll-ohko')
    expect(rollTier(k(1), 15)).toBe('low-roll-ohko')
  })

  it('n은 1~15 정수만, 확률은 0~1만', () => {
    for (const bad of [0, 16, 1.5, Number.NaN, '14']) expect(() => normalizeRollSteps(bad)).toThrow(CoreInputError)
    expect(() => rollTier(0.5, 0)).toThrow(CoreInputError)
    expect(() => rollTier(-0.1, 14)).toThrow(CoreInputError)
  })
})

describe('5단 순위·한 단계 위', () => {
  it('공격은 확정견딤 → 확정1타, 방어는 그 반대', () => {
    expect(TIER_ORDER.attack).toEqual(['guaranteed-survive', 'low-roll-ohko', 'mid-roll-ohko', 'high-roll-ohko', 'guaranteed-ohko'])
    expect(TIER_ORDER.defense).toEqual([...TIER_ORDER.attack].reverse())
    expect(nextBetterTier('attack', 'mid-roll-ohko')).toBe('high-roll-ohko')
    expect(nextBetterTier('defense', 'mid-roll-ohko')).toBe('low-roll-ohko')
    expect(nextBetterTier('attack', 'guaranteed-ohko')).toBeNull()
    expect(nextBetterTier('defense', 'guaranteed-survive')).toBeNull()
    expect(nextBetterTier('speed', 'tie')).toBe('first')
    expect(() => tierRank('attack', 'mid-or-lower')).toThrow(CoreInputError)
  })

  it('순위는 확률 단조와 맞는다(공격 증가, 방어 감소)', () => {
    for (const n of [1, 8, 14, 15]) {
      const ps = [0, 1 / 256, k(1), k(2), k(7), k(8), k(13), k(14), k(15), 1]
      for (let i = 1; i < ps.length; i++) {
        expect(tierRank('attack', rollTier(ps[i], n))).toBeGreaterThanOrEqual(tierRank('attack', rollTier(ps[i - 1], n)))
        expect(tierRank('defense', rollTier(ps[i], n))).toBeLessThanOrEqual(tierRank('defense', rollTier(ps[i - 1], n)))
      }
    }
  })
})

describe('judgeDamage·sweepDamage의 rollSteps 옵션', () => {
  const g = goldenCase<{ boundaries: number[] }>('a-kingambit-sucker-punch-atk-sweep')
  const atk = goldenSet(g.attacker)
  const def = goldenSet(g.defender)

  it('옵션이 없으면 기존 3단 구간 그대로, 있으면 같은 칸의 rollTier', () => {
    const base = sweepDamage(MC, { side: 'attacker', stat: 'atk' }, atk, def, 'suckerpunch')
    expect(base.boundaries).toEqual(g.boundaries)
    const tiered = sweepDamage(MC, { side: 'attacker', stat: 'atk' }, atk, def, 'suckerpunch', undefined, undefined, { rollSteps: 14 })
    tiered.cells.forEach((c, i) => {
      const b = base.cells[i]
      if (c.kind !== 'ok' || b.kind !== 'ok') return
      expect(c.category).toBe(rollTier(c.value.kind === 'damage' ? c.value.ohkoChance : 0, 14))
      expect(c.value).toEqual(b.value)
    })
  })

  it('방어측도 같은 5단 척도이고, 무효 rollSteps는 CoreInputError', () => {
    const one = judgeDamage(MC, 'defender', atk, def, 'suckerpunch', undefined, undefined, { rollSteps: 14 })
    const p = one.value.kind === 'damage' ? one.value.ohkoChance : 0
    expect(one.category).toBe(rollTier(p, 14))
    expect(() => judgeDamage(MC, 'attacker', atk, def, 'suckerpunch', undefined, undefined, { rollSteps: 16 })).toThrow(CoreInputError)
    expect(() => sweepDamage(MC, { side: 'attacker', stat: 'atk' }, atk, def, 'suckerpunch', undefined, undefined, { rollSteps: 0 })).toThrow(CoreInputError)
  })
})
