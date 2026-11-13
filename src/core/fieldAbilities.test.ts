import { describe, expect, it } from 'vitest'
import { MC, mkSet } from './testing'
import {
  abilityTerrain,
  abilityWeather,
  attackMoveType,
  calcDamage,
  effectivenessAgainst,
  validateSet,
  withAttackerField,
  type BattleConditions,
  type DamageResult,
  type DamageResultOk,
  type PokemonSet,
} from './index'

const ok = (r: DamageResult): DamageResultOk => {
  if (r.kind !== 'damage') throw new Error(`대미지 결과가 아니다: ${r.kind}`)
  return r
}
const BASE: BattleConditions = { attacker: { tailwind: false }, defender: { tailwind: false } }
/** 공격측 계산 특성(메가면 메가 폼 특성) 기준 조건으로 판정 */
const judged = (atk: PokemonSet, def: PokemonSet, move: string): DamageResultOk =>
  ok(calcDamage(MC, atk, def, move, withAttackerField(BASE, validateSet(MC, atk).ability)))

// 메가리자몽Y: 코어는 메가 폼 id 직접 지정을 거부하므로 원종 + mega + 메가스톤으로 지정한다
const zardY = mkSet({ species: 'charizard', ability: 'blaze', item: 'charizarditey', mega: true, nature: 'modest', sp: { spa: 32 }, moves: ['heatwave', 'weatherball'] })
const incineroar = mkSet({ species: 'incineroar', ability: 'intimidate', nature: 'adamant', sp: { atk: 32 }, moves: ['flareblitz'] })
const garchomp = mkSet({ species: 'garchomp', ability: 'roughskin', sp: { hp: 2 } })
const kingambit = mkSet({ species: 'kingambit', ability: 'defiant', sp: { hp: 2 } })
const rillaboom = mkSet({ species: 'rillaboom', ability: 'grassysurge', nature: 'adamant', sp: { atk: 32 }, moves: ['woodhammer'] })
const rillaboomOvergrow = { ...rillaboom, ability: 'overgrow' }

describe('공격측 특성 날씨·필드 표(R12)', () => {
  it('날씨·필드 설정 특성만 값을 내고, 델타스트림(엔진 미처리)·그 밖 특성은 none', () => {
    expect(['drought', 'desolateland', 'orichalcumpulse'].map(abilityWeather)).toEqual(['Sun', 'Sun', 'Sun'])
    expect(['drizzle', 'primordialsea', 'sandstream', 'snowwarning'].map(abilityWeather)).toEqual(['Rain', 'Rain', 'Sand', 'Snow'])
    expect(['electricsurge', 'hadronengine', 'psychicsurge', 'grassysurge', 'mistysurge'].map(abilityTerrain)).toEqual(['Electric', 'Electric', 'Psychic', 'Grassy', 'Misty'])
    for (const a of ['deltastream', 'blaze', 'megasol', 'cloudnine', 'toString', '']) {
      expect([abilityWeather(a), abilityTerrain(a)], a).toEqual(['none', 'none'])
    }
  })

  it('withAttackerField: 설정 특성이 아니면 같은 객체, 설정 특성이면 기존 조건(순풍 등)을 유지한 채 합친다', () => {
    expect(withAttackerField(BASE, 'intimidate')).toBe(BASE)
    expect(withAttackerField(BASE, 'drought')).toEqual({ ...BASE, weather: 'Sun' })
    expect(withAttackerField(BASE, 'grassysurge')).toEqual({ ...BASE, terrain: 'Grassy' })
    expect(BASE).toEqual({ attacker: { tailwind: false }, defender: { tailwind: false } })
  })

  it('메가 폼은 메가 폼 특성 기준: 메가리자몽Y 해결 세트 특성은 가뭄', () => {
    expect(validateSet(MC, zardY).ability).toBe('drought')
    expect(validateSet(MC, { ...zardY, mega: undefined, item: undefined }).ability).toBe('blaze')
  })
})

describe('AC33 공격측 특성 날씨·필드 판정', () => {
  it('공격측 가뭄(메가리자몽Y)의 불꽃 기술 = 쾌청 기준(날씨 없음보다 크다)', () => {
    const sun = judged(zardY, garchomp, 'heatwave')
    const none = ok(calcDamage(MC, zardY, garchomp, 'heatwave', BASE))
    expect(sun.rolls).toEqual(ok(calcDamage(MC, zardY, garchomp, 'heatwave', { ...BASE, weather: 'Sun' })).rolls)
    expect(sun.max).toBeGreaterThan(none.max)
    expect(sun.min).toBeGreaterThan(none.min)
  })

  it('같은 메가리자몽Y가 맞는 쪽이면 상대(어흥염) 플레어드라이브는 날씨 없음 기준', () => {
    const r = judged(incineroar, zardY, 'flareblitz')
    expect(withAttackerField(BASE, validateSet(MC, incineroar).ability)).toBe(BASE)
    expect(r.rolls).toEqual(ok(calcDamage(MC, incineroar, zardY, 'flareblitz', BASE)).rolls)
    expect(r.max).toBeLessThan(ok(calcDamage(MC, incineroar, zardY, 'flareblitz', { ...BASE, weather: 'Sun' })).max)
  })

  it('그래스메이커 공격측의 풀 기술은 땅에 붙은 대상에 그래스필드 보정을 받는다', () => {
    const grassy = judged(rillaboom, garchomp, 'woodhammer')
    const plain = judged(rillaboomOvergrow, garchomp, 'woodhammer')
    expect(grassy.rolls).toEqual(ok(calcDamage(MC, rillaboom, garchomp, 'woodhammer', { ...BASE, terrain: 'Grassy' })).rolls)
    expect(plain.rolls).toEqual(ok(calcDamage(MC, rillaboomOvergrow, garchomp, 'woodhammer', BASE)).rolls)
    expect(grassy.max).toBeGreaterThan(plain.max)
  })

  it('공격측 날씨의 웨더볼: 쾌청이면 불꽃·위력 2배(강철에 2배), 날씨 없으면 노말 50(강철에 반감)', () => {
    const sun = judged(zardY, kingambit, 'weatherball')
    const none = ok(calcDamage(MC, zardY, kingambit, 'weatherball', BASE))
    expect(sun.max / none.max).toBeGreaterThan(7)
    expect(attackMoveType('weatherball', 'Normal', 'drought', { weather: 'Sun' })).toBe('Fire')
    expect(attackMoveType('weatherball', 'Normal', 'drought')).toBe('Normal')
    expect(attackMoveType('weatherball', 'Normal', 'sandstream', { weather: 'Sand' })).toBe('Rock')
    expect(attackMoveType('weatherball', 'Normal', 'snowwarning', { weather: 'Snow' })).toBe('Ice')
    expect(attackMoveType('weatherball', 'Normal', 'drizzle', { weather: 'Rain' })).toBe('Water')
    expect(attackMoveType('weatherball', 'Normal', 'megasol')).toBe('Fire')
    // 스킨 특성은 웨더볼 타입을 바꾸지 않는다
    expect(attackMoveType('weatherball', 'Normal', 'pixilate')).toBe('Normal')
    expect(attackMoveType('terrainpulse', 'Normal', 'psychicsurge', { terrain: 'Psychic' })).toBe('Psychic')
    expect(attackMoveType('terrainpulse', 'Normal', 'mistysurge', { terrain: 'Misty' })).toBe('Fairy')
    expect(attackMoveType('terrainpulse', 'Normal', 'grassysurge', { terrain: 'Grassy' })).toBe('Grass')
  })

  it('후보 배율(effectivenessAgainst): 공격측 날씨·필드로 바뀐 웨더볼·대지의파동 타입을 쓰고, 어느 쪽이든 구름보기면 날씨 없음', () => {
    const steel = { types: ['Dark', 'Steel'], ability: 'defiant' }
    expect(effectivenessAgainst(MC, 'weatherball', { ability: 'drought', weather: 'Sun' }, steel)).toBe(2)
    expect(effectivenessAgainst(MC, 'weatherball', { ability: 'drought' }, steel)).toBe(0.5)
    expect(effectivenessAgainst(MC, 'weatherball', { ability: 'drought', weather: 'Sun' }, { types: ['Dragon', 'Ground'], ability: 'roughskin' })).toBe(0.5)
    expect(effectivenessAgainst(MC, 'weatherball', { ability: 'drought', weather: 'Sun' }, { types: ['Dark', 'Steel'], ability: 'cloudnine' })).toBe(0.5)
    expect(effectivenessAgainst(MC, 'weatherball', { ability: 'drought', weather: 'Sun' }, { types: ['Grass'], ability: 'flashfire' })).toBe(0)
    expect(effectivenessAgainst(MC, 'terrainpulse', { ability: 'psychicsurge', terrain: 'Psychic' }, { types: ['Fighting'], ability: 'guts' })).toBe(2)
  })
})
