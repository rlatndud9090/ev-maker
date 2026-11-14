// 판정에서 실제 쓰는 기술 타입(PRD R13). 계획(대표 기술 선정)과 조립(라벨)이 같은 규칙을 쓴다.
import { WEATHER_NEGATING_ABILITIES, attackMoveType, validateSet, type BattleConditions, type PokemonSet } from '../core'
import type { Snapshot } from '../data/schema'

// 계획의 세트 객체는 바뀌지 않으므로 세트별로 한 번만 해석한다.
const calcAbilities = new WeakMap<PokemonSet, string>()

/** 계산 특성(메가면 메가 폼 특성). 해석할 수 없으면 세트 특성 그대로 */
function calcAbilityOf(game: Snapshot, set: PokemonSet): string {
  const hit = calcAbilities.get(set)
  if (hit !== undefined) return hit
  let ability = set.ability
  try {
    ability = validateSet(game, set, { ignoreSpTotal: true }).ability
  } catch {
    // 계산 불가 세트: 세트 특성 그대로
  }
  calcAbilities.set(set, ability)
  return ability
}

/**
 * 판정에서 실제 쓰는 기술 타입(PRD R13): 공격측 계산 특성(스킨 등)과 판정 조건의 날씨·필드(공격측 특성 유도, ADR 결정 7).
 * 양쪽 중 날씨 무효 특성이 있으면 날씨 없음(엔진 규칙). 스냅샷에 없는 기술이면 undefined.
 */
export function judgedMoveType(game: Snapshot, moveId: string, spec: { attacker: PokemonSet; defender: PokemonSet; conditions: BattleConditions }): string | undefined {
  if (!Object.prototype.hasOwnProperty.call(game.data.moves, moveId)) return undefined
  const attacker = calcAbilityOf(game, spec.attacker)
  const defender = calcAbilityOf(game, spec.defender)
  const negated = WEATHER_NEGATING_ABILITIES.some((a) => a === attacker || a === defender)
  return attackMoveType(moveId, game.data.moves[moveId].type, attacker, { weather: negated ? 'none' : spec.conditions.weather, terrain: spec.conditions.terrain })
}
