import { describe, expect, it } from 'vitest'
import { cardId, presetKey, rowId } from './ids'

describe('ids', () => {
  it('라벨 이어붙이기로 겹칠 조합도 서로 다른 키가 된다', () => {
    expect(cardId(['a:b', 'c'])).not.toBe(cardId(['a', 'b:c']))
    expect(cardId(['x', null])).not.toBe(cardId(['x', 'null']))
    expect(cardId(['x', 1])).not.toBe(cardId(['x', '1']))
  })

  it('행 id는 카드 id를 품어 다른 카드의 같은 부분과 겹치지 않는다', () => {
    const a = cardId(['attack', 'ladder', 'x'])
    const b = cardId(['attack', 'ladder', 'y'])
    expect(rowId(a, ['base', 'earthquake'])).not.toBe(rowId(b, ['base', 'earthquake']))
    expect(JSON.parse(rowId(a, ['base']))).toEqual([a, 'base'])
  })

  it('presetKey는 탭·분류·번호 튜플', () => {
    expect(presetKey('speed', null, 0)).toBe('["speed",null,0]')
    expect(presetKey('attack', 'physical', 2)).not.toBe(presetKey('attack', 'special', 2))
  })
})
