import { describe, expect, it } from 'vitest'
import type { MetaEntry } from '../data/meta-schema'
import { TAB_MEANS_OWNERS, coAdoptionFloor, ladderMeans, rankMoveAllowed } from './rank'
import { realData, syntheticEntry } from './testing'
import { DEFAULT_CRITERIA } from './types'

const { bo1 } = realData()
const entryOf = (id: string): MetaEntry => bo1.entry(id) as MetaEntry
const MIN = DEFAULT_CRITERIA.rankShareMin
const sd = (share: number) => ({ means: { kind: 'move' as const, id: 'swordsdance' }, owner: 'opponent' as const, share })

describe('탭별 수단 주인', () => {
  it('공격 탭 = 나만, 방어 탭 = 상대만(내 방어 랭크업은 후속 별도 UI), 스피드 탭 = 양쪽', () => {
    expect(TAB_MEANS_OWNERS).toEqual({ attack: ['me'], defense: ['opponent'], speed: ['opponent', 'me'] })
  })
})

describe('ladderMeans: 능동 수단만', () => {
  it('어흥염: 위협·막말내뱉기는 기준 이상이어도 후보가 아니다', () => {
    const e = entryOf('incineroar')
    expect(e.abilities.intimidate).toBeGreaterThan(MIN)
    expect(e.moves.shares.partingshot).toBeGreaterThan(MIN)
    expect(ladderMeans(e, MIN)).toEqual([])
  })

  it('대도각참: 칼춤(12.93%)만, 오기(반응 특성)는 아니다', () => {
    expect(ladderMeans(entryOf('kingambit'), MIN)).toEqual([{ means: { kind: 'move', id: 'swordsdance' }, owner: 'opponent', share: 0.1293 }])
  })
})

describe('동시채용 하한', () => {
  it('max(0, a + b − 1), 넷째 자리 반올림', () => {
    expect(coAdoptionFloor(0.7068, 0.2638)).toBe(0)
    expect(coAdoptionFloor(0.7068, 0.7985)).toBe(0.5053)
    expect(coAdoptionFloor(0.3, 0.8)).toBe(0.1)
    expect(coAdoptionFloor(1, 1)).toBe(1)
  })

  it('경계: 하한이 정확히 기준값이면 통과, 0.0001 모자라면 탈락', () => {
    const e = syntheticEntry(entryOf('kingambit'), { moves: { shares: { swordsdance: 0.3, a: 0.8, b: 0.7999 }, keptShare: 1.8999, excludedShare: 0 } })
    expect(rankMoveAllowed(sd(0.3), 'opponent', 'a', e, MIN)).toBe(true)
    expect(rankMoveAllowed(sd(0.3), 'opponent', 'b', e, MIN)).toBe(false)
  })

  it('대표 세트에 수단과 기술이 둘 다 있으면 하한과 무관하게 통과', () => {
    const base = entryOf('kingambit')
    const lowShares = { moves: { shares: { swordsdance: 0.15, suckerpunch: 0.5 }, keptShare: 0.65, excludedShare: 0 } }
    const without = syntheticEntry(base, lowShares)
    expect(rankMoveAllowed(sd(0.15), 'opponent', 'suckerpunch', without, MIN)).toBe(false)
    const withRep = syntheticEntry(base, {
      ...lowShares,
      representative: { ...base.representative, set: { ...base.representative.set, moves: ['swordsdance', 'suckerpunch'] } },
    })
    expect(rankMoveAllowed(sd(0.15), 'opponent', 'suckerpunch', withRep, MIN)).toBe(true)
  })

  it('특성 수단(가속)은 특성 점유율 a로 같은 식, 대표 특성이 수단이고 대표 기술이면 통과', () => {
    const base = entryOf('kingambit')
    const boost = { means: { kind: 'ability' as const, id: 'speedboost' }, owner: 'opponent' as const }
    const e = syntheticEntry(base, { moves: { shares: { x: 0.5, y: 0.2 }, keptShare: 0.7, excludedShare: 0 } })
    expect(rankMoveAllowed({ ...boost, share: 0.6 }, 'opponent', 'x', e, MIN)).toBe(true)
    expect(rankMoveAllowed({ ...boost, share: 0.6 }, 'opponent', 'y', e, MIN)).toBe(false)
    const rep = syntheticEntry(e, { representative: { ...base.representative, set: { ...base.representative.set, ability: 'speedboost', moves: ['y'] } } })
    expect(rankMoveAllowed({ ...boost, share: 0.6 }, 'opponent', 'y', rep, MIN)).toBe(true)
  })

  it('대표 특성이 첫 슬롯 대체값(base-first-slot)이면 특성 수단 예외를 쓰지 않고 하한으로 본다', () => {
    const base = entryOf('kingambit')
    const boost = { means: { kind: 'ability' as const, id: 'speedboost' }, owner: 'opponent' as const, share: 0.6 }
    const e = syntheticEntry(base, { moves: { shares: { y: 0.2 }, keptShare: 0.2, excludedShare: 0 } })
    const repSet = { ...base.representative.set, ability: 'speedboost', moves: ['y'] }
    const sourced = syntheticEntry(e, { representative: { ...base.representative, set: repSet, abilityBasis: 'source-top' } })
    const fallback = syntheticEntry(e, { representative: { ...base.representative, set: repSet, abilityBasis: 'base-first-slot' } })
    expect(rankMoveAllowed(boost, 'opponent', 'y', sourced, MIN)).toBe(true)
    expect(rankMoveAllowed(boost, 'opponent', 'y', fallback, MIN)).toBe(false)
  })

  it('실데이터 메가플라엣테: 명상 × 파멸의빛은 하한 0이라 탈락, 명상 × 문포스는 통과', () => {
    const e = entryOf('floettemega')
    const a = e.moves.shares.calmmind
    expect(coAdoptionFloor(a, e.moves.shares.lightofruin)).toBe(0)
    const cm = { means: { kind: 'move' as const, id: 'calmmind' }, owner: 'opponent' as const, share: a }
    expect(e.representative.set.moves).not.toContain('lightofruin')
    expect(rankMoveAllowed(cm, 'opponent', 'lightofruin', e, MIN)).toBe(false)
    expect(rankMoveAllowed(cm, 'opponent', 'moonblast', e, MIN)).toBe(true)
  })

  it('하한을 보지 않는 경우: 내 수단, 목록 밖 타겟(점유율·항목 없음), 수단 주인이 공격하지 않음', () => {
    const e = syntheticEntry(entryOf('kingambit'), { moves: { shares: { swordsdance: 0.1, z: 0.1 }, keptShare: 0.2, excludedShare: 0 } })
    expect(rankMoveAllowed({ means: { kind: 'move', id: 'swordsdance' }, owner: 'me' }, 'me', 'z', e, MIN)).toBe(true)
    expect(rankMoveAllowed({ means: { kind: 'move', id: 'swordsdance' }, owner: 'opponent' }, 'opponent', 'z', undefined, MIN)).toBe(true)
    expect(rankMoveAllowed({ means: { kind: 'move', id: 'irondefense' }, owner: 'me' }, 'opponent', 'z', e, MIN)).toBe(true)
  })

  it('첫 턴 전용: 수단 주인이 공격할 때 기술 수단 뒤 불가(내 세트·래더 모두), 다른 쪽 수단이면 가능', () => {
    const e = entryOf('golisopodmega')
    expect(rankMoveAllowed({ means: { kind: 'move', id: 'swordsdance' }, owner: 'me' }, 'me', 'firstimpression', undefined, MIN)).toBe(false)
    expect(rankMoveAllowed(sd(1), 'opponent', 'firstimpression', e, MIN)).toBe(false)
    expect(rankMoveAllowed({ means: { kind: 'move', id: 'irondefense' }, owner: 'me' }, 'opponent', 'firstimpression', e, MIN)).toBe(true)
  })
})
