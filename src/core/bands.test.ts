import { describe, expect, it } from 'vitest'
import { CoreInputError, JUDGEMENT_ORDER, judgementRank, koLabel, nextBetter } from '.'

describe('judgementRank·nextBetter', () => {
  it('공격: 확정견딤 → 중저난수 → 고난수 → 확정1타, 최상위 다음은 null', () => {
    expect(nextBetter('attack', 'guaranteed-survive')).toBe('mid-low-roll-ohko')
    expect(nextBetter('attack', 'mid-low-roll-ohko')).toBe('high-roll-ohko')
    expect(nextBetter('attack', 'high-roll-ohko')).toBe('guaranteed-ohko')
    expect(nextBetter('attack', 'guaranteed-ohko')).toBeNull()
  })

  it('방어: 확정1타 → 중고난수 → 저난수 → 확정견딤, 최상위 다음은 null', () => {
    expect(nextBetter('defense', 'guaranteed-ohko')).toBe('mid-high-roll-ohko')
    expect(nextBetter('defense', 'mid-high-roll-ohko')).toBe('low-roll-ohko')
    expect(nextBetter('defense', 'low-roll-ohko')).toBe('guaranteed-survive')
    expect(nextBetter('defense', 'guaranteed-survive')).toBeNull()
  })

  it('스피드: 후공 → 동속 → 선공', () => {
    expect(nextBetter('speed', 'second')).toBe('tie')
    expect(nextBetter('speed', 'tie')).toBe('first')
    expect(nextBetter('speed', 'first')).toBeNull()
    expect(judgementRank('speed', 'second')).toBe(0)
  })

  it('순위는 koLabel 확률 단조와 맞는다(공격 증가, 방어 감소)', () => {
    const ps = [0, 0.01, 0.1875, 0.5, 0.75, 0.99, 1]
    for (let i = 1; i < ps.length; i++) {
      expect(judgementRank('attack', koLabel('attack', ps[i]))).toBeGreaterThanOrEqual(judgementRank('attack', koLabel('attack', ps[i - 1])))
      expect(judgementRank('defense', koLabel('defense', ps[i]))).toBeLessThanOrEqual(judgementRank('defense', koLabel('defense', ps[i - 1])))
    }
    expect(JUDGEMENT_ORDER.attack).toHaveLength(4)
  })

  it('관점에 없는 판정·관점은 CoreInputError', () => {
    expect(() => judgementRank('attack', 'low-roll-ohko')).toThrow(CoreInputError)
    expect(() => nextBetter('defense', 'first')).toThrow(CoreInputError)
    expect(() => nextBetter('x' as 'speed', 'first')).toThrow(CoreInputError)
  })
})

describe('koLabel', () => {
  it('공격: 1 / highRoll 이상 / 0 초과 highRoll 미만 / 0', () => {
    expect(koLabel('attack', 1)).toBe('guaranteed-ohko')
    expect(koLabel('attack', 0.99)).toBe('high-roll-ohko')
    expect(koLabel('attack', 0.75)).toBe('high-roll-ohko')
    expect(koLabel('attack', 0.7499)).toBe('mid-low-roll-ohko')
    expect(koLabel('attack', 0.1875)).toBe('mid-low-roll-ohko')
    expect(koLabel('attack', 0.01)).toBe('mid-low-roll-ohko')
    expect(koLabel('attack', 0)).toBe('guaranteed-survive')
  })

  it('방어: 1 / lowRoll 초과 1 미만 / 0 초과 lowRoll 이하 / 0', () => {
    expect(koLabel('defense', 1)).toBe('guaranteed-ohko')
    expect(koLabel('defense', 0.99)).toBe('mid-high-roll-ohko')
    expect(koLabel('defense', 0.75)).toBe('mid-high-roll-ohko')
    expect(koLabel('defense', 0.1876)).toBe('mid-high-roll-ohko')
    expect(koLabel('defense', 0.1875)).toBe('low-roll-ohko')
    expect(koLabel('defense', 0.01)).toBe('low-roll-ohko')
    expect(koLabel('defense', 0)).toBe('guaranteed-survive')
  })

  it('임계값을 바꾸면 경계가 따라간다', () => {
    expect(koLabel('attack', 0.6, { highRoll: 0.5 })).toBe('high-roll-ohko')
    expect(koLabel('defense', 0.3, { lowRoll: 0.4 })).toBe('low-roll-ohko')
  })

  it('잘못된 확률·임계값·관점은 CoreInputError', () => {
    for (const p of [-0.1, 1.1, Number.NaN, Number.POSITIVE_INFINITY]) expect(() => koLabel('attack', p)).toThrow(CoreInputError)
    expect(() => koLabel('defense', 0.5, { lowRoll: 1 })).toThrow(CoreInputError)
    expect(() => koLabel('attack', 0.5, { highRoll: 0 })).toThrow(CoreInputError)
    expect(() => koLabel('speed' as 'attack', 0.5)).toThrow(CoreInputError)
  })
})
