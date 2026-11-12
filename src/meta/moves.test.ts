import { describe, expect, it } from 'vitest'
import type { MetaEntry } from '../data/meta-schema'
import { loadMetaSnapshotSync, loadSnapshotSync } from '../data/testing'
import { topMoves } from './moves'

const game = loadSnapshotSync()
const base = loadMetaSnapshotSync({ regulation: game.manifest.regulation.id }).entries[0]
const withMoves = (shares: Record<string, number>): MetaEntry => ({ ...base, moves: { ...base.moves, shares } })

describe('topMoves', () => {
  it('사용률 내림차순 상위 n개, 변화기 포함', () => {
    const e = withMoves({ earthquake: 0.5, swordsdance: 0.9, protect: 0.7, dragonclaw: 0.2, rockslide: 0.6 })
    expect(topMoves(e, game, 4)).toEqual(['swordsdance', 'protect', 'rockslide', 'earthquake'])
  })

  it('동률은 id 순', () => {
    const e = withMoves({ rockslide: 0.5, earthquake: 0.5, protect: 0.5, dragonclaw: 0.9 })
    expect(topMoves(e, game, 3)).toEqual(['dragonclaw', 'earthquake', 'protect'])
  })

  it('게임 데이터에 없는 기술 id·0 사용률은 건너뛰고 다음 순위, 모자라면 있는 만큼', () => {
    const e = withMoves({ notamove: 0.99, earthquake: 0.4, protect: 0, swordsdance: 0.3 })
    expect(Object.prototype.hasOwnProperty.call(game.data.moves, 'notamove')).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(game.data.moves, 'protect')).toBe(true)
    expect(topMoves(e, game, 4)).toEqual(['earthquake', 'swordsdance'])
    expect(topMoves(withMoves({}), game, 4)).toEqual([])
    expect(topMoves(e, game, 0)).toEqual([])
  })

  it('실제 메타 항목: 결과는 게임 데이터 기술이고 사용률이 줄지 않게 늘어선다', () => {
    const got = topMoves(base, game, 4)
    expect(got).toHaveLength(4)
    const shares = got.map((id) => base.moves.shares[id])
    for (let i = 1; i < shares.length; i++) expect(shares[i]).toBeLessThanOrEqual(shares[i - 1])
    // 뽑히지 않은 기술은 4위 이하
    const fourth = shares[3]
    for (const [id, s] of Object.entries(base.moves.shares)) if (!got.includes(id) && id in game.data.moves) expect(s).toBeLessThanOrEqual(fourth)
  })
})
