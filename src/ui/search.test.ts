import { describe, expect, it } from 'vitest'
import { loadSnapshotSync } from '../data/testing'
import { addableMoves, learnableMoves, searchIndexOf, searchNames } from './search'

const game = loadSnapshotSync()

describe('searchNames', () => {
  const species = searchIndexOf(game.data.species)

  it('한국어 부분 일치로 찾는다', () => {
    const ids = searchNames(species, '카리', 50)
    expect(ids).toContain('garchomp')
  })

  it('메가 폼 이름으로 메가 폼 id를 찾는다', () => {
    const ids = searchNames(species, '메가한카', 10)
    expect(ids).toContain('garchompmega')
    expect(game.data.species.garchompmega.isMega).toBe(true)
  })

  it('완전 일치가 앞부분·부분 일치보다 먼저 온다', () => {
    const ids = searchNames(species, '한카리아스', 10)
    expect(ids[0]).toBe('garchomp')
  })

  it('공백·대소문자를 무시하고 영문 이름·id도 찾는다', () => {
    expect(searchNames(species, 'Garchomp', 5)).toContain('garchomp')
    expect(searchNames(searchIndexOf(game.data.moves), '드래곤 클로', 5)).toContain('dragonclaw')
  })

  it('limit와 빈 검색어', () => {
    expect(searchNames(species, '', 3)).toHaveLength(3)
    expect(searchNames(species, '아', 2)).toHaveLength(2)
    expect(searchNames(species, '없는이름퀘퀘', 5)).toEqual([])
  })

  it('ids를 주면 그 항목만 검색한다', () => {
    const index = searchIndexOf(game.data.moves, ['earthquake', 'dragonclaw', 'not-a-move'])
    expect(index.map((e) => e.id).sort()).toEqual(['dragonclaw', 'earthquake'])
    expect(searchNames(index, '지', 5)).toEqual(['earthquake'])
  })
})

describe('learnableMoves', () => {
  it('메가 폼은 원종 기술을 쓴다', () => {
    expect(learnableMoves(game, 'garchompmega')).toEqual(game.data.species.garchomp.learnset)
    expect(learnableMoves(game, 'garchomp')).toContain('earthquake')
    expect(learnableMoves(game, 'nope')).toEqual([])
  })
})

describe('addableMoves', () => {
  it('배우는 공격기만, 제외 목록·변화기 없이(메가는 원종 습득표)', () => {
    const all = addableMoves(game, 'garchompmega', [])
    expect(all).toContain('earthquake')
    expect(all.every((m) => game.data.species.garchomp.learnset.includes(m))).toBe(true)
    expect(all.some((m) => game.data.moves[m].category === 'Status')).toBe(false)
    expect(game.data.species.garchomp.learnset.some((m) => game.data.moves[m]?.category === 'Status')).toBe(true)
    expect(addableMoves(game, 'garchomp', ['earthquake'])).not.toContain('earthquake')
    expect(addableMoves(game, 'nope', [])).toEqual([])
  })

  it('분류 가변 기술(셸암즈)은 빠진다', () => {
    const learner = Object.keys(game.data.species).find((id) => learnableMoves(game, id).includes('shellsidearm'))
    expect(learner).toBeDefined()
    expect(addableMoves(game, learner as string, [])).not.toContain('shellsidearm')
  })
})
