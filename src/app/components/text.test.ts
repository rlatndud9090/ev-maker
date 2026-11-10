import { describe, expect, it } from 'vitest'
import type { MoveStatRefs } from '../../core'
import type { RankBasis } from '../../cards'
import { moveRankParts } from './text'

const refs = (offense: MoveStatRefs['offense']): Pick<MoveStatRefs, 'offense'> => ({ offense })
const rank = (myBoosts: RankBasis['myBoosts'], opponentBoosts: RankBasis['opponentBoosts']): RankBasis => ({
  kind: 'rank',
  means: { kind: 'move', id: 'swordsdance' },
  owner: 'opponent',
  myBoosts,
  opponentBoosts,
  reactions: [],
})

describe('moveRankParts', () => {
  it('방어 탭: 상대(기술 사용자) 공격 능력치 랭크는 부호만', () => {
    expect(moveRankParts('defense', { basis: rank({}, { atk: 2 }), refs: refs({ owner: 'self', stat: 'atk' }) })).toEqual({ own: '+2', rest: '' })
  })
  it('공격 탭: 내 공격 랭크는 부호만, 상대 쪽 랭크는 rest', () => {
    expect(moveRankParts('attack', { basis: rank({ atk: -1 }, { def: 1 }), refs: refs({ owner: 'self', stat: 'atk' }) })).toEqual({ own: '−1', rest: '상대 B+1' })
  })
  it('공격 능력치가 아닌 랭크는 모두 rest(내 B+2)', () => {
    expect(moveRankParts('defense', { basis: rank({ def: 2 }, {}), refs: refs({ owner: 'self', stat: 'atk' }) })).toEqual({ own: undefined, rest: '내 B+2' })
  })
  it('속임수(대상 공격 참조)는 부호만 붙이지 않는다', () => {
    expect(moveRankParts('defense', { basis: rank({ atk: 2 }, {}), refs: refs({ owner: 'target', stat: 'atk' }) })).toEqual({ own: undefined, rest: '내 A+2' })
  })
  it('스피드 탭(refs 없음)·랭크 아닌 근거', () => {
    expect(moveRankParts('speed', { basis: rank({}, { spe: -1 }) })).toEqual({ own: undefined, rest: '상대 S−1' })
    expect(moveRankParts('attack', { basis: { kind: 'scarf', item: 'choicescarf', share: 0.2 } })).toEqual({ rest: '' })
  })
})
