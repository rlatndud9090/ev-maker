// 공격측 특성이 스스로 까는 날씨·필드(PRD R12, ADR 결정 7). 맞는 쪽 특성은 보지 않는다.
import type { BattleConditions, Terrain, Weather } from './types'

/**
 * 계산 특성 id(메가면 메가 폼 특성) → 날씨. 엔진(champions)은 강한 날씨(Harsh Sunshine·Heavy Rain)의 불꽃·물 보정을 넣지 않아
 * 끝의대지·시작의바다는 쾌청·비로 근사한다. 델타스트림(Strong Winds)은 엔진이 처리하지 않아 넣지 않는다.
 */
const WEATHER_SETTERS: Readonly<Record<string, Exclude<Weather, 'none'>>> = {
  drought: 'Sun',
  desolateland: 'Sun',
  orichalcumpulse: 'Sun',
  drizzle: 'Rain',
  primordialsea: 'Rain',
  sandstream: 'Sand',
  snowwarning: 'Snow',
}

const TERRAIN_SETTERS: Readonly<Record<string, Exclude<Terrain, 'none'>>> = {
  electricsurge: 'Electric',
  hadronengine: 'Electric',
  psychicsurge: 'Psychic',
  grassysurge: 'Grassy',
  mistysurge: 'Misty',
}

const own = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k)

export function abilityWeather(ability: string): Weather {
  return own(WEATHER_SETTERS, ability) ? WEATHER_SETTERS[ability] : 'none'
}

export function abilityTerrain(ability: string): Terrain {
  return own(TERRAIN_SETTERS, ability) ? TERRAIN_SETTERS[ability] : 'none'
}

/** 공격측 계산 특성이 까는 날씨·필드를 c에 합친다. 둘 다 없으면 c를 그대로 돌려준다(캐시 키 불변). */
export function withAttackerField(c: BattleConditions, attackerAbility: string): BattleConditions {
  const weather = abilityWeather(attackerAbility)
  const terrain = abilityTerrain(attackerAbility)
  if (weather === 'none' && terrain === 'none') return c
  const out: BattleConditions = { ...c }
  if (weather !== 'none') out.weather = weather
  if (terrain !== 'none') out.terrain = terrain
  return out
}
