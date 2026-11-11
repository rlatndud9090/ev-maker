import { describe, expect, it } from 'vitest'
import { natureVariants } from './natures'
import { realData } from './testing'

const { game } = realData()

describe('natureVariants', () => {
  it('무보정 현재 성격: 무보정은 현재 그대로, 상승은 하락을 관여하지 않는 C(→A) 순으로', () => {
    expect(natureVariants(game, 'hardy', 'atk', ['atk'])).toEqual({ stat: 'atk', neutral: 'hardy', plus: 'adamant' })
    expect(natureVariants(game, 'hardy', 'spa', ['spa'])).toEqual({ stat: 'spa', neutral: 'hardy', plus: 'modest' })
    expect(natureVariants(game, 'hardy', 'def', ['hp', 'def'])).toEqual({ stat: 'def', neutral: 'hardy', plus: 'impish' })
    expect(natureVariants(game, 'hardy', 'spe', ['spe'])).toEqual({ stat: 'spe', neutral: 'hardy', plus: 'jolly' })
  })

  it('현재 성격이 이미 상승이면 상승 = 현재, 무보정은 실제 무보정 성격 id', () => {
    expect(natureVariants(game, 'adamant', 'atk', ['atk'])).toEqual({ stat: 'atk', neutral: 'bashful', plus: 'adamant' })
    expect(game.data.natures.bashful.plus).toBeUndefined()
  })

  it('현재 성격이 그 능력치에 무관한 보정이면 무보정 = 현재, 상승은 현재 하락이 관여하지 않으면 그 하락을 유지', () => {
    // 겁쟁이(+S −A)로 C를 스윕: C 무보정 = 겁쟁이, C 상승 = 조심(+C −A)
    expect(natureVariants(game, 'timid', 'spa', ['spa'])).toEqual({ stat: 'spa', neutral: 'timid', plus: 'modest' })
    // 현재 하락(C)이 관여 능력치면 다른 하락으로
    expect(natureVariants(game, 'jolly', 'atk', ['atk', 'spa'])).toMatchObject({ plus: 'lonely' })
  })

  it('하락 보정 현재 성격: 무보정·상승 모두 현재와 다르다', () => {
    expect(natureVariants(game, 'modest', 'atk', ['atk'])).toEqual({ stat: 'atk', neutral: 'bashful', plus: 'adamant' })
  })

  it('속성: 어떤 현재 성격·능력치에서도 상승 성격은 stat 상승, 하락은 관여 밖(가능할 때), 무보정은 stat 보정 없음', () => {
    const stats = ['atk', 'def', 'spa', 'spd', 'spe'] as const
    for (const current of Object.keys(game.data.natures)) {
      for (const stat of stats) {
        const relevant = ['hp', stat] as const
        const v = natureVariants(game, current, stat, relevant)
        const plus = game.data.natures[v.plus]
        const neutral = game.data.natures[v.neutral]
        expect(plus.plus).toBe(stat)
        expect(plus.minus).not.toBe(stat)
        if (v.plus !== current) expect(relevant).not.toContain(plus.minus)
        expect(neutral.plus === stat && neutral.minus !== stat).toBe(false)
        expect(neutral.minus === stat && neutral.plus !== stat).toBe(false)
      }
    }
  })
})
