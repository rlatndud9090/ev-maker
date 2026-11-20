import { describe, expect, it } from 'vitest'
import type { StatId } from '../data/schema'
import { branchNature, laneNature, rowNature, strictVariants } from './lockNature'
import { realData } from './testing'

const { game } = realData()
const N = game.data.natures

describe('branchNature', () => {
  it('상승이 고정 능력치: 내 세트가 이미 그 상승이고 하락이 피할 곳 밖이면 그대로', () => {
    expect(branchNature(game, 'jolly', 'spe', ['spe'])).toBe('jolly')
  })

  it('상승이 고정 능력치: 내 세트 하락 유지 우선, 피할 곳이면 MINUS_ORDER 첫 빈 자리로', () => {
    // 겁쟁이(+S −A)에서 S 상승 갈래가 아닌 A 상승 갈래: 하락 A는 상승과 겹쳐 C로
    expect(branchNature(game, 'timid', 'atk', ['atk'])).toBe('adamant')
    // 무보정에서 S 상승: 하락 없음 → 첫 빈 자리 C
    expect(branchNature(game, 'hardy', 'spe', ['spe'])).toBe('jolly')
    // 명랑(−C)인데 C도 고정 → A로
    expect(branchNature(game, 'jolly', 'spe', ['spe', 'spa'])).toBe('timid')
    // 고집(+A −C)에서 S 상승: 하락 C 유지
    expect(branchNature(game, 'adamant', 'spe', ['spe', 'atk'])).toBe('jolly')
  })

  it('고정 밖: 내 세트 상승이 고정 밖이면 상승 유지·하락만 옮김, 고정 안이면 무보정', () => {
    expect(branchNature(game, 'timid', 'out', ['atk'])).toBe('jolly')
    expect(branchNature(game, 'timid', 'out', ['def'])).toBe('timid')
    expect(branchNature(game, 'jolly', 'out', ['spe'])).toBe('bashful')
    expect(branchNature(game, 'hardy', 'out', ['spe'])).toBe('hardy')
  })

  it('하락 자리가 없으면 null, 하락 없는 무보정 성격은 자리 검사를 하지 않는다', () => {
    const all: StatId[] = ['atk', 'def', 'spa', 'spd', 'spe']
    expect(branchNature(game, 'hardy', 'spe', all)).toBeNull()
    expect(branchNature(game, 'timid', 'out', ['atk', 'def', 'spa', 'spd'])).toBeNull()
    expect(branchNature(game, 'hardy', 'out', all)).toBe('hardy')
    expect(branchNature(game, 'jolly', 'out', all)).toBe('bashful')
  })

  it('속성: 결과 성격의 하락은 avoid·상승 밖이고, 능력치 갈래의 상승은 그 능력치', () => {
    const stats = ['atk', 'def', 'spa', 'spd', 'spe'] as const
    for (const current of Object.keys(N)) {
      for (const x of stats) {
        for (const y of stats) {
          const avoid: StatId[] = x === y ? [x] : [x, y]
          const r = branchNature(game, current, x, avoid)
          expect(r).not.toBeNull()
          expect(N[r as string].plus).toBe(x)
          expect(avoid).not.toContain(N[r as string].minus)
          const o = branchNature(game, current, 'out', avoid)
          if (o !== null && N[o].plus !== undefined && N[o].plus !== N[o].minus) {
            expect(avoid).not.toContain(N[o].plus)
            expect(avoid).not.toContain(N[o].minus)
          }
        }
      }
    }
  })
})

describe('rowNature', () => {
  it('명랑(−C)·S 고정 갈래의 C 행: 하락이 A로 간다', () => {
    expect(rowNature(game, 'jolly', 'spe', ['spe', 'spa'])).toEqual({ nature: 'timid', dropWarning: false })
  })

  it('고정 밖 갈래가 유지한 상승은 행에서도 유지하고 하락만 옮긴다', () => {
    // A 고정, 고정 밖 갈래 = 명랑(+S −C), C 행 → +S −B
    expect(rowNature(game, 'jolly', 'out', ['atk', 'spa'])).toEqual({ nature: 'hasty', dropWarning: false })
  })

  it('셸사이드암형(A·C·B·D 관여) + S 고정: 자리 없음 → 갈래 성격 그대로 + dropWarning', () => {
    expect(rowNature(game, 'jolly', 'spe', ['spe', 'atk', 'spa', 'def', 'spd'])).toEqual({ nature: 'jolly', dropWarning: true })
  })

  it('하락 없는 무보정 갈래 성격은 자리 검사 없이 그대로', () => {
    expect(rowNature(game, 'hardy', 'out', ['spe', 'atk', 'spa', 'def', 'spd'])).toEqual({ nature: 'hardy', dropWarning: false })
  })
})

describe('strictVariants', () => {
  it('엄격 무보정은 v 보정만 없애고 관여 능력치의 다른 상승(+S)은 유지한다(자이로볼·일렉트로볼·애널리틱)', () => {
    // S 고정 +S 갈래: 자이로볼(A·S 관여) A 행
    expect(strictVariants(game, 'jolly', 'atk', false, ['spe', 'atk'])).toEqual({ stat: 'atk', neutral: 'jolly', plus: null })
    // 일렉트로볼·애널리틱(C·S 관여) C 행: 행 성격 겁쟁이(+S −A)
    const row = rowNature(game, 'jolly', 'spe', ['spe', 'spa'])
    expect(strictVariants(game, row.nature, 'spa', false, ['spe', 'spa'])).toEqual({ stat: 'spa', neutral: 'timid', plus: null })
    expect(N.timid.plus).toBe('spe')
  })

  it('엄격 무보정: 행 성격이 +v면 무보정 성격, 하락이 v면 상승을 남기고 하락을 옮긴다', () => {
    expect(strictVariants(game, 'adamant', 'atk', true, ['atk']).neutral).toBe('bashful')
    expect(strictVariants(game, 'jolly', 'spa', false, ['spe', 'spa']).neutral).toBe('timid')
    expect(strictVariants(game, 'hardy', 'atk', false, ['atk']).neutral).toBe('hardy')
  })

  it('엄격 상승: 행 성격 하락을 유지하고, 그 하락이 v면 폴백 없이 null', () => {
    expect(strictVariants(game, 'timid', 'spa', true, ['spa']).plus).toBe('modest')
    expect(strictVariants(game, 'modest', 'atk', true, ['atk']).plus).toBeNull()
    expect(strictVariants(game, 'adamant', 'atk', true, ['atk']).plus).toBe('adamant')
  })

  it('엄격 상승: 하락 없는 행 성격은 avoid 밖 첫 빈 자리, 없으면 null', () => {
    expect(strictVariants(game, 'hardy', 'def', true, ['hp', 'def', 'spe'])).toEqual({ stat: 'def', neutral: 'hardy', plus: 'impish' })
    expect(strictVariants(game, 'hardy', 'def', true, ['hp', 'atk', 'def', 'spa', 'spd', 'spe']).plus).toBeNull()
  })

  it('allowPlus = false면 상승은 늘 null', () => {
    expect(strictVariants(game, 'adamant', 'atk', false, ['atk']).plus).toBeNull()
  })
})

describe('laneNature', () => {
  it('내 세트 하락을 유지한 +lockStat, 하락이 관여 능력치면 옮긴다', () => {
    expect(laneNature(game, 'hardy', 'spe', ['spe'])).toBe('jolly')
    expect(laneNature(game, 'hardy', 'atk', ['atk'])).toBe('adamant')
    expect(laneNature(game, 'modest', 'atk', ['atk'])).toBe('adamant')
    expect(laneNature(game, 'timid', 'def', ['hp', 'def'])).toBe('bold')
  })

  it('속성: 레인 성격에서 strictVariants가 lockStat 무보정·상승을 모두 내고, 하락은 관여 밖', () => {
    const stats = ['atk', 'def', 'spa', 'spd', 'spe'] as const
    for (const current of Object.keys(N)) {
      for (const lockStat of stats) {
        const relevant: StatId[] = lockStat === 'def' || lockStat === 'spd' ? ['hp', lockStat] : [lockStat]
        const lane = laneNature(game, current, lockStat, relevant)
        expect(N[lane].plus).toBe(lockStat)
        expect(relevant).not.toContain(N[lane].minus)
        const v = strictVariants(game, lane, lockStat, true, relevant)
        expect(v.plus).toBe(lane)
        const neutral = N[v.neutral]
        expect(neutral.plus === undefined || neutral.plus === neutral.minus).toBe(true)
      }
    }
  })
})
