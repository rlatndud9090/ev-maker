import { describe, expect, it } from 'vitest'
import { topMoves } from '../meta/moves'
import { loadMetaSnapshotSync, loadSnapshotSync } from '../data/testing'
import { MOVE_SLOTS } from './setDraft'

const game = loadSnapshotSync()

describe('메타 메가 항목(원종 대신 근거)', () => {
  // 메가 폼이 원종과 같은 기술을 쓰는지(메가 대신 원종 순위가 그 메가 폼이 배울 수 있는 기술인지)
  it('메가 항목이 없는 메가 폼의 원종 항목 기술은 그 원종이 배운다', () => {
    let checked = 0
    for (const match of ['bo1', 'bo3'] as const) {
      const meta = loadMetaSnapshotSync({ regulation: game.manifest.regulation.id, match })
      const byId = new Map(meta.entries.map((e) => [e.id, e]))
      const missing = game.data.megas.filter((m) => !byId.has(m.forme) && byId.has(m.base))
      for (const m of missing) {
        const base = byId.get(m.base)!
        const learn = new Set(game.data.species[m.base].learnset)
        expect(topMoves(base, game, MOVE_SLOTS).every((id) => learn.has(id)), `${match} ${m.forme}`).toBe(true)
        checked++
      }
    }
    expect(checked).toBeGreaterThan(0)
  })
})
