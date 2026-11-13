import { describe, expect, it } from 'vitest'
import { realData } from '../cards/testing'
import { EXAMPLE_SET } from '../cards/__fixtures__/acceptance'
import { toPokemonSet } from '../ui/setDraft'
import { EXAMPLE_DRAFT } from './example'

describe('EXAMPLE_DRAFT', () => {
  it('수용 기준 고정 입력의 예시 세트(EXAMPLE_SET)로 풀린다', () => {
    const { set, megaByName } = toPokemonSet(realData().game, EXAMPLE_DRAFT)
    expect(megaByName).toBe(false)
    expect(set).toEqual({ ...EXAMPLE_SET, boosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 } })
  })
})
