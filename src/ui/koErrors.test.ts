import { describe, expect, it } from 'vitest'
import { CoreError, validateSet, type PokemonSet } from '../core'
import { loadSnapshotSync } from '../data/testing'
import { draftFieldOf, josa, koReason } from './koErrors'

const game = loadSnapshotSync()
const regulation = game.manifest.regulation.id

const garchomp = (patch: Partial<PokemonSet> = {}): PokemonSet => ({
  regulation,
  species: 'garchomp',
  ability: 'roughskin',
  nature: 'hardy',
  sp: { hp: 2, atk: 32, def: 0, spa: 0, spd: 0, spe: 32 },
  moves: ['earthquake'],
  ...patch,
})

/** 코어가 실제로 낸 첫 오류 상세. */
function coreReason(set: PokemonSet) {
  try {
    validateSet(game, set)
  } catch (e) {
    if (e instanceof CoreError) return e.details[0]
    throw e
  }
  throw new Error('검증이 통과했다')
}

describe('koReason', () => {
  it('배울 수 없는 기술은 종·기술 한국어 이름으로', () => {
    const set = garchomp({ moves: ['earthquake', 'suckerpunch'] })
    const reason = coreReason(set)
    expect(reason.code).toBe('ILLEGAL_MOVE')
    expect(koReason(game, reason, set)).toBe('한카리아스는 기습을 배울 수 없습니다')
    expect(draftFieldOf(reason)).toBe('moves[1]')
  })

  it('SP 합계 초과는 합계와 상한을 보인다', () => {
    const set = garchomp({ sp: { hp: 6, atk: 32, def: 0, spa: 0, spd: 0, spe: 32 } })
    const reason = coreReason(set)
    expect(reason.code).toBe('SP_TOTAL_EXCEEDED')
    expect(koReason(game, reason, set)).toBe('SP 합계 70이 상한 66을 넘습니다')
    expect(draftFieldOf(reason)).toBe('sp')
  })

  it('SP 칸 위반은 능력치 이름과 칸 위치', () => {
    const set = garchomp({ sp: { hp: NaN, atk: 32, def: 0, spa: 0, spd: 0, spe: 32 } })
    const reason = coreReason(set)
    expect(koReason(game, reason, set)).toBe('SP HP는 0~32 사이 정수여야 합니다')
    expect(draftFieldOf(reason)).toBe('sp.hp')
  })

  it('가질 수 없는 특성·모르는 종', () => {
    const bad = garchomp({ ability: 'intimidate' })
    expect(koReason(game, coreReason(bad), bad)).toBe('한카리아스는 특성 위협을 가질 수 없습니다')
    const unknown = garchomp({ species: '없는종' })
    expect(koReason(game, coreReason(unknown), unknown)).toBe('포켓몬 "없는종"을(를) 찾을 수 없습니다')
  })

  it('중복 기술', () => {
    const set = garchomp({ moves: ['earthquake', 'earthquake'] })
    expect(koReason(game, coreReason(set), set)).toBe('지진이 두 번 들어 있습니다')
  })

  it('접두가 붙은 field도 원인 칸을 찾고, 모르는 코드는 원문을 덧붙인다', () => {
    expect(draftFieldOf({ code: 'ENGINE_UNSUPPORTED', field: 'defender.ability', message: 'x' })).toBe('ability')
    expect(koReason(game, { code: 'INPUT', field: 'conditions', message: '알 수 없음' })).toBe('계산할 수 없습니다 (알 수 없음)')
    expect(koReason(game, { code: 'WHITE_HERB_MULTIHIT', field: 'move', message: 'm' })).toBe('하양허브를 소비한 랭크 변화 뒤의 연속기는 계산하지 않습니다')
  })
})

describe('josa', () => {
  it('받침에 따라 조사를 고른다', () => {
    expect(josa('한카리아스', '은', '는')).toBe('한카리아스는')
    expect(josa('지진', '을', '를')).toBe('지진을')
    expect(josa('SP 공격', '은', '는')).toBe('SP 공격은')
    expect(josa('74', '이', '가')).toBe('74가')
    expect(josa('70', '이', '가')).toBe('70이')
    expect(josa('66', '을', '를')).toBe('66을')
  })
})
