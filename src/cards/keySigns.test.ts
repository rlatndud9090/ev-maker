import { describe, expect, it } from 'vitest'
import { natureForSigns, normalizeKeySigns, setKeySign, signOf, validKeySigns } from './keySigns'
import { realData } from './testing'

const HB = ['hp', 'def'] as const
const BD = ['def', 'spd'] as const

describe('validKeySigns', () => {
  it('없음·빈 객체·무보정만은 받는다', () => {
    expect(validKeySigns(HB, undefined)).toBe(true)
    expect(validKeySigns(HB, {})).toBe(true)
    expect(validKeySigns(HB, { hp: 'neutral', def: 'neutral' })).toBe(true)
  })

  it('상승 하나·하락 하나(서로 다른 능력치)는 받는다', () => {
    expect(validKeySigns(HB, { def: 'plus' })).toBe(true)
    expect(validKeySigns(HB, { def: 'minus' })).toBe(true)
    expect(validKeySigns(BD, { def: 'plus', spd: 'minus' })).toBe(true)
  })

  it('H에 부호, 상승 둘, 하락 둘, 키 능력치 밖, 알 수 없는 값은 거절한다', () => {
    expect(validKeySigns(HB, { hp: 'plus' })).toBe(false)
    expect(validKeySigns(HB, { hp: 'minus' })).toBe(false)
    expect(validKeySigns(BD, { def: 'plus', spd: 'plus' })).toBe(false)
    expect(validKeySigns(BD, { def: 'minus', spd: 'minus' })).toBe(false)
    expect(validKeySigns(HB, { spd: 'plus' })).toBe(false)
    expect(validKeySigns(HB, { spd: 'neutral' })).toBe(false)
    expect(validKeySigns(HB, JSON.parse('{"def":"up"}'))).toBe(false)
  })
})

describe('setKeySign·normalizeKeySigns', () => {
  it('상승·하락은 다른 능력치에 걸면 옮겨지고, 같은 능력치의 반대 부호는 바꾼다', () => {
    const plusB = setKeySign({}, 'def', 'plus')
    expect(plusB).toEqual({ def: 'plus' })
    expect(setKeySign(plusB, 'spd', 'plus')).toEqual({ spd: 'plus' })
    expect(setKeySign({ spd: 'plus' }, 'def', 'minus')).toEqual({ def: 'minus', spd: 'plus' })
    expect(setKeySign({ def: 'minus', spd: 'plus' }, 'def', 'plus')).toEqual({ def: 'plus' })
    expect(setKeySign({ def: 'minus', spd: 'plus' }, 'spd', 'neutral')).toEqual({ def: 'minus' })
  })

  it('H는 바꾸지 않는다', () => {
    expect(setKeySign({ def: 'plus' }, 'hp', 'plus')).toEqual({ def: 'plus' })
  })

  it('무보정 항목을 빼고, 전부 무보정이면 undefined', () => {
    expect(normalizeKeySigns(undefined)).toBeUndefined()
    expect(normalizeKeySigns({ hp: 'neutral', def: 'neutral' })).toBeUndefined()
    expect(normalizeKeySigns({ hp: 'neutral', def: 'plus' })).toEqual({ def: 'plus' })
    expect(signOf(undefined, 'def')).toBe('neutral')
    expect(signOf({ def: 'minus' }, 'def')).toBe('minus')
  })
})

describe('natureForSigns', () => {
  const { game } = realData()
  const signsOf = (nature: string, keys: readonly ('hp' | 'def' | 'spd')[]) => keys.map((k) => [k, signFor(nature, k)])
  const signFor = (natureId: string, stat: 'hp' | 'def' | 'spd'): string => {
    const n = game.data.natures[natureId]
    if (n.plus === n.minus) return 'neutral'
    return n.plus === stat ? 'plus' : n.minus === stat ? 'minus' : 'neutral'
  }

  it('부호 없음: 기준 성격이 키 능력치에 보정이 없으면 그대로, 있으면 무보정 성격', () => {
    expect(natureForSigns(game, 'jolly', HB, undefined)).toBe('jolly')
    expect(natureForSigns(game, 'jolly', HB, {})).toBe('jolly')
    const n = natureForSigns(game, 'impish', HB, {})
    expect(n).toBeDefined()
    expect(signsOf(n ?? '', HB)).toEqual([
      ['hp', 'neutral'],
      ['def', 'neutral'],
    ])
  })

  it('상승만: 하락은 기준 성격의 하락이 키 능력치가 아니면 그것, 아니면 MINUS_ORDER 순 첫 자유 능력치', () => {
    expect(natureForSigns(game, 'jolly', HB, { def: 'plus' })).toBe('impish')
    expect(natureForSigns(game, 'bold', HB, { def: 'plus' })).toBe('bold')
    expect(natureForSigns(game, 'lax', HB, { def: 'plus' })).toBe('lax')
    expect(natureForSigns(game, 'hardy', HB, { def: 'plus' })).toBe('impish')
    // 기준 하락(spd)이 키 능력치면 다른 능력치로
    expect(natureForSigns(game, 'naive', BD, { def: 'plus' })).toBe('impish')
  })

  it('하락만: 상승은 기준 성격의 상승이 키 능력치가 아니면 그것, 아니면 MINUS_ORDER 순 첫 자유 능력치', () => {
    expect(natureForSigns(game, 'jolly', HB, { def: 'minus' })).toBe('hasty')
    expect(natureForSigns(game, 'hardy', HB, { def: 'minus' })).toBe('mild')
    expect(natureForSigns(game, 'impish', HB, { def: 'minus' })).toBe('mild')
  })

  it('상승·하락 둘 다: 그 쌍의 성격', () => {
    expect(natureForSigns(game, 'jolly', BD, { def: 'plus', spd: 'minus' })).toBe('lax')
    expect(natureForSigns(game, 'lax', BD, { def: 'plus', spd: 'minus' })).toBe('lax')
    expect(natureForSigns(game, 'hardy', BD, { def: 'minus', spd: 'plus' })).toBe('gentle')
  })

  it('결과 성격의 키 능력치 부호는 입력 부호와 정확히 같다(모든 기준 성격·부호 조합)', () => {
    const combos = [{}, { def: 'plus' }, { def: 'minus' }, { spd: 'plus' }, { spd: 'minus' }, { def: 'plus', spd: 'minus' }, { def: 'minus', spd: 'plus' }] as const
    for (const base of Object.keys(game.data.natures)) {
      for (const signs of combos) {
        const n = natureForSigns(game, base, BD, signs)
        expect(n, `${base} ${JSON.stringify(signs)}`).toBeDefined()
        expect(signsOf(n ?? '', BD), `${base} ${JSON.stringify(signs)}`).toEqual(BD.map((k) => [k, signOf(signs, k)]))
      }
    }
  })
})
