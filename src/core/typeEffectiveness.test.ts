import { describe, expect, it } from 'vitest'
import { CoreError } from './types'
import { attackEffectiveness, attackMoveType, typeEffectiveness } from './engine'

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
