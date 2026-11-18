import { describe, expect, it } from 'vitest'
import {
  addedBundleCardId,
  addedBundleIdentity,
  addedBundleKey,
  addedBundlePin,
  addedCardId,
  bundleIdentity,
  cardId,
  presetKey,
  rowId,
  samePin,
  speedBundleIdentity,
} from './ids'
import type { StatId } from '../data/schema'
import type { AddedBundle, BundleStat, SpeedAddedBundle } from './types'

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

describe('사용자 추가 배분 키', () => {
  const hb: AddedBundle = { tab: 'attack', source: 'ladder', opponentId: 'garchomp', category: 'physical', sp: { hp: 4, def: 8 } }
  const stats: { stat: StatId; sp: number }[] = [
    { stat: 'hp', sp: 4 },
    { stat: 'def', sp: 8 },
  ]
  const key = '[{"stat":"hp","sp":4,"nature":"neutral"},{"stat":"def","sp":8,"nature":"neutral"}]'

  it('래더 추가 카드 id는 [탭, ladder, 상대, 분류, 묶음 키, user(, 열매)] 직렬화와 같다', () => {
    expect(addedCardId('attack', 'ladder', 'garchomp', 'physical', key)).toBe(JSON.stringify(['attack', 'ladder', 'garchomp', 'physical', key, 'user']))
    expect(addedCardId('attack', 'ladder', 'garchomp', 'physical', key, 'babiriberry')).toBe(
      JSON.stringify(['attack', 'ladder', 'garchomp', 'physical', key, 'user', 'babiriberry']),
    )
    expect(addedBundleCardId(hb, stats)).toBe(JSON.stringify(['attack', 'ladder', 'garchomp', 'physical', key, 'user']))
    expect(addedBundleCardId({ ...hb, source: 'custom' }, stats)).toBe(JSON.stringify(['attack', 'custom', 'garchomp', 'physical', key, 'user']))
  })

  it('addedBundleKey는 같은 SP의 무보정 관측 묶음 키(JSON.stringify(stats))와 같다', () => {
    const observed: BundleStat[] = [
      { stat: 'hp', sp: 4, nature: 'neutral' },
      { stat: 'def', sp: 8, nature: 'neutral' },
    ]
    expect(addedBundleKey(stats)).toBe(JSON.stringify(observed))
    expect(addedBundleKey(stats)).toBe(key)
  })

  it('출처만 다른 두 항목은 동일성 키가 다르다', () => {
    const base = { tab: 'attack' as const, opponentId: 'garchomp', category: 'physical' as const, stats: [{ stat: 'hp' as const, sp: 4, nature: 'neutral' as const }] }
    expect(bundleIdentity({ ...base, source: 'ladder' })).not.toBe(bundleIdentity({ ...base, source: 'custom' }))
    expect(addedBundleIdentity(hb)).not.toBe(addedBundleIdentity({ ...hb, source: 'custom' }))
    const spe: SpeedAddedBundle = { source: 'ladder', opponentId: 'garchomp', sp: 10, nature: 'plus' }
    expect(speedBundleIdentity(spe)).not.toBe(speedBundleIdentity({ ...spe, source: 'custom' }))
  })

  it('동일성 키는 튜플 직렬화이고 능력치 입력 순서와 무관하다', () => {
    expect(addedBundleIdentity(hb)).toBe(JSON.stringify(['attack', 'ladder', 'garchomp', 'physical', JSON.parse(key)]))
    expect(addedBundleIdentity({ ...hb, sp: { def: 8, hp: 4 } })).toBe(addedBundleIdentity(hb))
    expect(addedBundleIdentity({ ...hb, sp: { hp: 8, def: 4 } })).not.toBe(addedBundleIdentity(hb))
    expect(speedBundleIdentity({ source: 'ladder', opponentId: 'garchomp', sp: 10, nature: 'plus' })).toBe(
      JSON.stringify(['speed', 'ladder', 'garchomp', null, [{ stat: 'spe', sp: 10, nature: 'plus' }]]),
    )
    expect(speedBundleIdentity({ source: 'ladder', opponentId: 'garchomp', sp: 10, nature: 'plus' })).not.toBe(
      speedBundleIdentity({ source: 'ladder', opponentId: 'garchomp', sp: 10, nature: 'minus' }),
    )
  })

  it('고정 항목은 출처를 담고, 출처가 다르면 같은 고정이 아니다', () => {
    const pin = addedBundlePin(hb)
    expect(pin).toEqual({ tab: 'attack', source: 'ladder', opponentId: 'garchomp', category: 'physical', key })
    expect(samePin(pin, addedBundlePin({ ...hb, sp: { def: 8, hp: 4 } }))).toBe(true)
    expect(samePin(pin, addedBundlePin({ ...hb, source: 'custom' }))).toBe(false)
  })
})
