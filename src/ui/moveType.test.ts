import { describe, expect, it } from 'vitest'
import { MC, mkSet } from '../core/testing'
import { judgedMoveType } from '../cards/assemble'
import { calcAbilityOf, myMoveType } from './moveType'

const megaGardevoir = mkSet({ species: 'gardevoir', ability: 'synchronize', item: 'gardevoirite', mega: true, moves: ['hypervoice'] })
const gardevoir = mkSet({ species: 'gardevoir', ability: 'synchronize', moves: ['hypervoice'] })
const charizardY = mkSet({ species: 'charizard', ability: 'blaze', item: 'charizarditey', mega: true, moves: ['weatherball'] })
const garchomp = mkSet({ species: 'garchomp', ability: 'roughskin', moves: ['earthquake'] })

describe('바뀐 기술 타입(R13)', () => {
  it('내 기술 칸: 메가 폼 특성(페어리스킨)이면 하이퍼보이스는 페어리, 원종이면 노말, 해석 실패면 기본 타입', () => {
    expect(myMoveType(MC, 'hypervoice', calcAbilityOf(MC, megaGardevoir))).toBe('Fairy')
    expect(myMoveType(MC, 'hypervoice', calcAbilityOf(MC, gardevoir))).toBe('Normal')
    expect(calcAbilityOf(MC, { ...gardevoir, moves: ['없는기술'] })).toBeUndefined()
    expect(myMoveType(MC, 'hypervoice', undefined)).toBe('Normal')
    expect(myMoveType(MC, 'weatherball', calcAbilityOf(MC, charizardY))).toBe('Fire')
  })

  it('판정 행: 공격측 계산 특성과 판정 조건 날씨로 정한다(맞는 쪽 날씨 무효 특성이면 날씨 없음)', () => {
    expect(judgedMoveType(MC, 'hypervoice', { attacker: megaGardevoir, defender: garchomp, conditions: {} })).toBe('Fairy')
    expect(judgedMoveType(MC, 'weatherball', { attacker: charizardY, defender: garchomp, conditions: { weather: 'Sun' } })).toBe('Fire')
    // 맞는 쪽이 메가리자몽Y여도 공격측 판정 조건에 날씨가 없으면 바뀌지 않는다
    expect(judgedMoveType(MC, 'weatherball', { attacker: garchomp, defender: charizardY, conditions: {} })).toBe('Normal')
    const cloudNine = mkSet({ species: 'altaria', ability: 'cloudnine', moves: [] })
    expect(judgedMoveType(MC, 'weatherball', { attacker: charizardY, defender: cloudNine, conditions: { weather: 'Sun' } })).toBe('Normal')
    expect(judgedMoveType(MC, '없는기술', { attacker: megaGardevoir, defender: garchomp, conditions: {} })).toBeUndefined()
  })
})
