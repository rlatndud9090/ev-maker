import { describe, expect, it } from 'vitest'
import { CoreError } from './types'
import { attackEffectiveness, attackMoveType, typeEffectiveness } from './engine'
import { CoreInputError } from './errors'
import { defenderAbilityFactor, effectivenessAgainst } from './effectiveness'
import { MC } from './testing'

describe('typeEffectiveness(기본 타입표)', () => {
  it('단타입·복합 타입 배율을 곱한다', () => {
    expect(typeEffectiveness('Ground', ['Fire'])).toBe(2)
    expect(typeEffectiveness('Ground', ['Fire', 'Flying'])).toBe(0)
    expect(typeEffectiveness('Ice', ['Dragon', 'Ground'])).toBe(4)
    expect(typeEffectiveness('Steel', ['Dragon', 'Ground'])).toBe(1)
    expect(typeEffectiveness('Fire', ['Water', 'Dragon'])).toBe(0.25)
    expect(typeEffectiveness('Dark', ['Psychic', 'Normal'])).toBe(2)
    expect(typeEffectiveness('Normal', ['Ghost'])).toBe(0)
  })

  it('타입표에 없는 타입은 CoreError', () => {
    expect(() => typeEffectiveness('Nope', ['Fire'])).toThrow(CoreError)
    expect(() => typeEffectiveness('Fire', ['Nope'])).toThrow(CoreError)
  })
})

describe('attackMoveType·attackEffectiveness(공격측 특성 타입 변화)', () => {
  it('스킨 특성은 노말 기술만 바꾸고, 노말스킨은 모두 노말, 촉촉보이스는 소리 기술만 물', () => {
    expect(attackMoveType('quickattack', 'Normal', 'aerilate')).toBe('Flying')
    expect(attackMoveType('quickattack', 'Normal', 'pixilate')).toBe('Fairy')
    expect(attackMoveType('xscissor', 'Bug', 'aerilate')).toBe('Bug')
    expect(attackMoveType('iceshard', 'Ice', 'normalize')).toBe('Normal')
    expect(attackMoveType('hypervoice', 'Normal', 'liquidvoice')).toBe('Water')
    expect(attackMoveType('quickattack', 'Normal', 'liquidvoice')).toBe('Normal')
    expect(attackMoveType('weatherball', 'Normal', 'aerilate')).toBe('Normal')
    expect(attackMoveType('quickattack', 'Normal', 'moxie')).toBe('Normal')
  })

  it('배짱·심안은 노말·격투 기술의 고스트 무효를 등배로', () => {
    expect(attackEffectiveness('Normal', ['Ghost'], 'scrappy')).toBe(1)
    expect(attackEffectiveness('Fighting', ['Ghost', 'Steel'], 'mindseye')).toBe(2)
    expect(attackEffectiveness('Normal', ['Ghost'], 'innerfocus')).toBe(0)
    expect(attackEffectiveness('Dark', ['Ghost'], 'scrappy')).toBe(2)
  })

  it('기술 id를 주면 엔진 기술별 특례(프리즈드라이·플라잉프레스·니힐라이트)를 넣는다', () => {
    // 프리즈드라이: 물에 2배(물/고스트 대쓰여너 → 2배, 기본 표로는 0.5배)
    expect(attackEffectiveness('Ice', ['Water', 'Ghost'], 'snowwarning')).toBe(0.5)
    expect(attackEffectiveness('Ice', ['Water', 'Ghost'], 'snowwarning', 'freezedry')).toBe(2)
    expect(attackEffectiveness('Ice', ['Water', 'Ground'], 'snowwarning', 'freezedry')).toBe(4)
    // 플라잉프레스: 격투 × 비행 상성(풀 = 1 × 2, 노말/비행 = 2 × 1, 바위 = 2 × 0.5)
    expect(attackEffectiveness('Fighting', ['Grass'], 'unburden', 'flyingpress')).toBe(2)
    expect(attackEffectiveness('Fighting', ['Grass'], 'unburden')).toBe(1)
    expect(attackEffectiveness('Fighting', ['Rock'], 'unburden', 'flyingpress')).toBe(1)
    expect(attackEffectiveness('Fighting', ['Ghost'], 'scrappy', 'flyingpress')).toBe(1)
    // 그 밖의 기술은 기본 표 그대로
    expect(attackEffectiveness('Ice', ['Water'], 'snowwarning', 'icebeam')).toBe(0.5)
  })
})

describe('effectivenessAgainst(방어측 특성 보정)', () => {
  const vs = (moveId: string, attacker: string, types: string[], ability: string) => effectivenessAgainst(MC, moveId, { ability: attacker }, { types, ability })

  it('무효 특성은 0: 부유+땅, 저수+물, 피뢰침+전기, 타오르는불꽃+불꽃, 초식+풀(없으면 타입 상성 그대로)', () => {
    expect(vs('earthquake', 'roughskin', ['Steel'], 'levitate')).toBe(0)
    expect(vs('earthquake', 'roughskin', ['Steel'], 'clearbody')).toBe(2)
    expect(vs('surf', 'torrent', ['Fire'], 'waterabsorb')).toBe(0)
    expect(vs('thunderbolt', 'static', ['Water'], 'lightningrod')).toBe(0)
    expect(vs('flamethrower', 'blaze', ['Grass'], 'flashfire')).toBe(0)
    expect(defenderAbilityFactor('Grass', [], 1, 'sapsipper', 'overgrow')).toBe(0)
  })

  it('반감 특성은 0.5: 두꺼운지방+불꽃·얼음, 정화의소금+고스트(다른 타입은 1)', () => {
    expect(vs('flamethrower', 'blaze', ['Normal'], 'thickfat')).toBe(0.5)
    expect(vs('icebeam', 'torrent', ['Dragon'], 'thickfat')).toBe(1)
    expect(vs('shadowball', 'levitate', ['Rock'], 'purifyingsalt')).toBe(0.5)
    expect(vs('earthquake', 'roughskin', ['Normal'], 'thickfat')).toBe(1)
  })

  it('공격측 틀깨기 계열이면 방어측 특성 보정을 넣지 않는다', () => {
    expect(vs('earthquake', 'moldbreaker', ['Steel'], 'levitate')).toBe(2)
    expect(vs('flamethrower', 'moldbreaker', ['Normal'], 'thickfat')).toBe(1)
    expect(defenderAbilityFactor('Electric', [], 1, 'voltabsorb', 'teravolt')).toBe(1)
    expect(defenderAbilityFactor('Fire', [], 1, 'flashfire', 'turboblaze')).toBe(1)
  })

  it('스킨 특성으로 바뀐 타입으로 본다: 프리즈스킨 노말기 → 얼음(두꺼운지방 반감), 스카이스킨 노말기 → 비행(부유 무관)', () => {
    expect(vs('quickattack', 'refrigerate', ['Dragon'], 'thickfat')).toBe(1)
    expect(vs('quickattack', 'refrigerate', ['Normal'], 'thickfat')).toBe(0.5)
    expect(vs('quickattack', 'aerilate', ['Grass'], 'levitate')).toBe(2)
    expect(vs('quickattack', 'pixilate', ['Ghost'], 'cursedbody')).toBe(1)
    expect(vs('quickattack', 'innerfocus', ['Ghost'], 'cursedbody')).toBe(0)
  })

  it('방음은 소리 기술만 무효, 방탄은 탄 기술만 무효', () => {
    expect(vs('hypervoice', 'cloudnine', ['Water'], 'soundproof')).toBe(0)
    expect(vs('boomburst', 'soundproof', ['Water'], 'soundproof')).toBe(0)
    expect(vs('quickattack', 'cloudnine', ['Water'], 'soundproof')).toBe(1)
    expect(vs('shadowball', 'cursedbody', ['Psychic'], 'bulletproof')).toBe(0)
  })

  it('신비의부적은 효과가 굉장한 기술만 맞는다', () => {
    expect(vs('flamethrower', 'blaze', ['Bug', 'Ghost'], 'wonderguard')).toBe(2)
    expect(vs('earthquake', 'roughskin', ['Bug', 'Ghost'], 'wonderguard')).toBe(0)
  })

  it('고정 대미지 기술(지구던지기·나이트헤드·분노의앞니 등)은 반감이어도 1, 무효(상성·특성)만 0', () => {
    expect(vs('seismictoss', 'synchronize', ['Psychic'], 'innerfocus')).toBe(1)
    expect(vs('seismictoss', 'synchronize', ['Ghost'], 'innerfocus')).toBe(0)
    expect(vs('nightshade', 'levitate', ['Normal'], 'innerfocus')).toBe(0)
    expect(vs('superfang', 'hustle', ['Steel'], 'thickfat')).toBe(1)
    expect(vs('seismictoss', 'synchronize', ['Bug', 'Ghost'], 'wonderguard')).toBe(0)
  })

  it('스냅샷에 없는 기술은 CoreInputError', () => {
    expect(() => vs('nosuchmove', 'blaze', ['Normal'], 'thickfat')).toThrow(CoreInputError)
  })
})
