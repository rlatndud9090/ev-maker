import { describe, expect, it } from 'vitest'
import { topMoves } from '../meta/moves'
import { loadMetaSnapshotSync, loadSnapshotSync } from '../data/testing'
import { namesOf } from './names'
import { MOVE_SLOTS, speciesMoveFill } from './setDraft'

const game = loadSnapshotSync()
const names = namesOf(game)
const label = (id: string) => names.species.label(id)
const move = (id: string) => names.moves.label(id)
/** 고정 순위표(종 id → 기술 id 순위). 조회한 id를 기록한다 */
function ranks(table: Record<string, readonly string[]>) {
  const asked: string[] = []
  const of = (id: string) => (asked.push(id), table[id])
  return { asked, of }
}

describe('speciesMoveFill', () => {
  it('목록 안 종으로 바꾸면 그 종 순위 상위 4개의 이름', () => {
    const r = ranks({ garchomp: ['swordsdance', 'earthquake', 'rockslide', 'protect', 'dragonclaw'] })
    expect(speciesMoveFill(game, 'sneasler', label('garchomp'), r.of)).toEqual([move('swordsdance'), move('earthquake'), move('rockslide'), move('protect')])
    expect(r.asked).toEqual(['garchomp'])
  })

  it('4개 미만이면 남는 칸은 빈칸', () => {
    const got = speciesMoveFill(game, 'sneasler', label('garchomp'), () => ['earthquake'])
    expect(got).toEqual([move('earthquake'), '', '', ''])
    expect(got).toHaveLength(MOVE_SLOTS)
  })

  it('메가 폼은 메가 폼 id 순위를 쓰고, 그 항목이 없으면 원종 순위로 대신한다', () => {
    const mega = ranks({ venusaurmega: ['gigadrain', 'sludgebomb'], venusaur: ['sleeppowder'] })
    expect(speciesMoveFill(game, 'garchomp', label('venusaurmega'), mega.of)).toEqual([move('gigadrain'), move('sludgebomb'), '', ''])
    expect(mega.asked).toEqual(['venusaurmega'])
    const base = ranks({ venusaur: ['sleeppowder', 'gigadrain'] })
    expect(speciesMoveFill(game, 'garchomp', label('venusaurmega'), base.of)).toEqual([move('sleeppowder'), move('gigadrain'), '', ''])
    expect(base.asked).toEqual(['venusaurmega', 'venusaur'])
    // 메가 아닌 종은 원종 대신이 없다
    const plain = ranks({})
    expect(speciesMoveFill(game, 'garchomp', label('venusaur'), plain.of)).toBeUndefined()
    expect(plain.asked).toEqual(['venusaur'])
  })

  it('목록 밖 종·같은 종·풀리지 않는 이름이면 undefined(기술 그대로)', () => {
    const r = ranks({ garchomp: ['earthquake'] })
    expect(speciesMoveFill(game, 'garchomp', label('charizard'), r.of)).toBeUndefined()
    expect(speciesMoveFill(game, 'garchomp', label('garchomp'), r.of)).toBeUndefined()
    expect(speciesMoveFill(game, 'garchomp', '없는포켓몬', r.of)).toBeUndefined()
    // 이전에 풀린 종이 없으면(처음부터 빈칸) 목록 안 종으로 바꾼 것이라 채운다
    expect(speciesMoveFill(game, undefined, label('garchomp'), r.of)).toEqual([move('earthquake'), '', '', ''])
  })
})

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
