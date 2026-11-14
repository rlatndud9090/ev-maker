// 내 기술 칸 타입(PRD R13): 내 계산 특성(메가면 메가 폼 특성)과 그 특성이 까는 날씨·필드로 바뀐 기술 타입.
import { WEATHER_NEGATING_ABILITIES, abilityTerrain, abilityWeather, attackMoveType, validateSet, type PokemonSet } from '../core'
import type { Snapshot } from '../data/schema'

/** 내 세트의 계산 특성. 세트를 해석할 수 없으면 undefined(호출 측은 기본 타입을 쓴다) */
export function calcAbilityOf(game: Snapshot, set: PokemonSet): string | undefined {
  try {
    return validateSet(game, set, { ignoreSpTotal: true }).ability
  } catch {
    return undefined
  }
}

/** ability = calcAbilityOf 결과. 없거나 스냅샷에 없는 기술이면 기본 타입(없으면 undefined) */
export function myMoveType(game: Snapshot, moveId: string, ability: string | undefined): string | undefined {
  if (!Object.prototype.hasOwnProperty.call(game.data.moves, moveId)) return undefined
  const base = game.data.moves[moveId].type
  if (ability === undefined) return base
  const weather = WEATHER_NEGATING_ABILITIES.includes(ability) ? 'none' : abilityWeather(ability)
  return attackMoveType(moveId, base, ability, { weather, terrain: abilityTerrain(ability) })
}
