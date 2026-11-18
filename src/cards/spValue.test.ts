import { describe, expect, it } from 'vitest'
import { isSpValue } from './spValue'

describe('isSpValue', () => {
  const spMax = 32

  it('경계값 0·spMax와 그 사이 정수는 받는다', () => {
    for (const v of [0, 1, 16, spMax]) expect(isSpValue(v, spMax), String(v)).toBe(true)
  })

  it('범위 밖·정수 아님·숫자 아님은 받지 않는다', () => {
    for (const v of [-1, spMax + 1, 1.5, NaN, Infinity, '3', null, undefined]) expect(isSpValue(v, spMax), String(v)).toBe(false)
  })
})
