import { describe, expect, it } from 'vitest'
import { CoreInputError, koLabel } from '.'

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
