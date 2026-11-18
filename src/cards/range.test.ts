import { describe, expect, it } from 'vitest'
import { ladderInRange } from './range'
import { realData } from './testing'

const { bo1 } = realData()

describe('ladderInRange', () => {
  it('선택 종이 없으면 사용률 상위 topN만 남는다', () => {
    const out = ladderInRange(bo1, { topN: 5, selected: [] })
    expect(out.map((e) => e.id)).toEqual(bo1.ranking.slice(0, 5).map((e) => e.id))
  })

  it('선택 종이 있으면 topN과 무관하게 그 종만 사용률 순으로 남고, 메타에 없는 id는 무시한다', () => {
    const [a, b, c] = [bo1.ranking[20], bo1.ranking[2], bo1.ranking[40]]
    const out = ladderInRange(bo1, { topN: 1, selected: [c.id, 'notinmeta', a.id, b.id] })
    expect(out.map((e) => e.id)).toEqual([b.id, a.id, c.id])
  })
})
