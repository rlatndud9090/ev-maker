import { describe, expect, it } from 'vitest'
import { loadSnapshotSync } from '../data/testing'
import { autoMinus, choiceOf, natureIdFor, refreshAuto, toggleMinus, togglePlus, type NatureChoice } from './natureToggle'

const game = loadSnapshotSync()
const NONE: NatureChoice = { minusAuto: false }
const PHYS = ['earthquake']
const SPEC = ['thunderbolt']
const nat = (c: NatureChoice) => natureIdFor(game, c.plus, c.minus)

describe('성격 +/− 토글', () => {
  it('+만 누르면 −가 자동: A↔C, 그 밖은 특수만이면 A 아니면 C', () => {
    expect(nat(togglePlus(game, NONE, 'atk', SPEC))).toBe('adamant')
    expect(nat(togglePlus(game, NONE, 'spa', PHYS))).toBe('modest')
    expect(togglePlus(game, NONE, 'spe', PHYS)).toEqual({ plus: 'spe', minus: 'spa', minusAuto: true })
    expect(togglePlus(game, NONE, 'spe', SPEC)).toEqual({ plus: 'spe', minus: 'atk', minusAuto: true })
    expect(autoMinus(game, 'def', [...PHYS, ...SPEC])).toBe('spa')
    expect(autoMinus(game, 'spd', [])).toBe('spa')
  })

  it('+는 한 줄만: 다른 줄을 누르면 옮겨 가고, 같은 줄을 다시 누르면 무보정', () => {
    const a = togglePlus(game, NONE, 'atk', PHYS)
    const s = togglePlus(game, a, 'spe', PHYS)
    expect(s.plus).toBe('spe')
    expect(togglePlus(game, s, 'spe', PHYS)).toEqual(NONE)
    expect(game.data.natures[nat(NONE)].plus ?? null).toBe(game.data.natures[nat(NONE)].minus ?? null)
  })

  it('−는 한 줄만, + 없이·+와 같은 줄에는 못 켠다, 직접 고른 −를 다시 누르면 자동으로', () => {
    expect(toggleMinus(game, NONE, 'atk', PHYS)).toEqual(NONE)
    const a = togglePlus(game, NONE, 'spe', PHYS)
    expect(toggleMinus(game, a, 'spe', PHYS)).toBe(a)
    const d = toggleMinus(game, a, 'def', PHYS)
    expect(d).toEqual({ plus: 'spe', minus: 'def', minusAuto: false })
    expect(nat(d)).toBe('hasty')
    expect(toggleMinus(game, d, 'spd', PHYS).minus).toBe('spd')
    expect(toggleMinus(game, d, 'def', PHYS)).toEqual({ plus: 'spe', minus: 'spa', minusAuto: true })
  })

  it('직접 고른 −는 +를 옮겨도 유지, +가 그 줄로 오면 자동으로', () => {
    const d = toggleMinus(game, togglePlus(game, NONE, 'spe', PHYS), 'def', PHYS)
    expect(togglePlus(game, d, 'atk', PHYS)).toEqual({ plus: 'atk', minus: 'def', minusAuto: false })
    expect(togglePlus(game, d, 'def', PHYS)).toEqual({ plus: 'def', minus: 'spa', minusAuto: true })
  })

  it('기술이 바뀌면 자동 −만 다시 정한다', () => {
    const a = togglePlus(game, NONE, 'spe', PHYS)
    expect(refreshAuto(game, a, SPEC).minus).toBe('atk')
    const d = toggleMinus(game, a, 'def', PHYS)
    expect(refreshAuto(game, d, SPEC)).toBe(d)
  })

  it('성격 id ↔ 토글 상태 왕복', () => {
    expect(choiceOf(game, 'jolly', true)).toEqual({ plus: 'spe', minus: 'spa', minusAuto: true })
    expect(choiceOf(game, 'hardy', true)).toEqual(NONE)
    for (const n of Object.values(game.data.natures)) {
      const c = choiceOf(game, n.id, false)
      expect(game.data.natures[nat(c)].plus).toBe(c.plus === undefined ? game.data.natures[nat(c)].plus : n.plus)
      if (c.plus !== undefined) expect(nat(c)).toBe(n.id)
    }
  })
})
