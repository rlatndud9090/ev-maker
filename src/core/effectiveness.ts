// 방어측 특성 보정을 넣은 기술 배율(대미지 계산 없이 타입·특성만). 계획 단계 후보 거름용.
import type { Snapshot } from '../data/schema'
import { attackEffectiveness, attackMoveType } from './engine'
import { CoreInputError } from './errors'

/** 방어측 특성을 무시하는 공격측 특성(틀깨기 계열) */
export const DEFENDER_ABILITY_IGNORING: readonly string[] = ['moldbreaker', 'turboblaze', 'teravolt']

/** 기술 타입을 무효로 하는 방어측 특성 */
const TYPE_IMMUNE: Readonly<Record<string, readonly string[]>> = {
  levitate: ['Ground'],
  eartheater: ['Ground'],
  waterabsorb: ['Water'],
  stormdrain: ['Water'],
  dryskin: ['Water'],
  voltabsorb: ['Electric'],
  lightningrod: ['Electric'],
  motordrive: ['Electric'],
  flashfire: ['Fire'],
  wellbakedbody: ['Fire'],
  sapsipper: ['Grass'],
}
/** 기술 플래그로 무효로 하는 방어측 특성 */
const FLAG_IMMUNE: Readonly<Record<string, string>> = { soundproof: 'sound', bulletproof: 'bullet', windrider: 'wind' }
/** 기술 타입을 반감하는 방어측 특성 */
const TYPE_HALVED: Readonly<Record<string, readonly string[]>> = {
  thickfat: ['Fire', 'Ice'],
  heatproof: ['Fire'],
  waterbubble: ['Fire'],
  purifyingsalt: ['Ghost'],
}

/**
 * 방어측 특성 보정(0·0.5·1). moveType = 공격측 특성으로 바뀐 뒤의 기술 타입, effectiveness = 그 타입의 상성 배율(신비의부적 판정용).
 * 공격측이 틀깨기 계열이면 1.
 */
export function defenderAbilityFactor(moveType: string, flags: readonly string[], effectiveness: number, defenderAbility: string, attackerAbility: string): number {
  if (DEFENDER_ABILITY_IGNORING.includes(attackerAbility)) return 1
  if (TYPE_IMMUNE[defenderAbility]?.includes(moveType)) return 0
  const flag = FLAG_IMMUNE[defenderAbility]
  if (flag !== undefined && flags.includes(flag)) return 0
  if (defenderAbility === 'wonderguard' && effectiveness <= 1) return 0
  if (TYPE_HALVED[defenderAbility]?.includes(moveType)) return 0.5
  return 1
}

/** 맞는 쪽: 계산에 쓰는 폼(메가면 메가 폼) 타입과 특성 */
export interface EffectivenessDefender {
  types: readonly string[]
  ability: string
}

/** 대미지가 상성과 무관하게 정해지는 기술(무효만 따른다) */
const FIXED_DAMAGE_MOVES: readonly string[] = ['seismictoss', 'nightshade', 'superfang', 'finalgambit', 'endeavor']

/**
 * attacker가 moveId로 defender를 칠 때의 배율 = attackEffectiveness(공격측 특성 타입 변화·기술 특례) × defenderAbilityFactor.
 * 도구·날씨·필드·테라는 넣지 않는다. 스냅샷에 없는 기술은 CoreInputError, 엔진 타입표에 없는 타입은 CoreError.
 */
export function effectivenessAgainst(game: Snapshot, moveId: string, attacker: { ability: string }, defender: EffectivenessDefender): number {
  if (!Object.prototype.hasOwnProperty.call(game.data.moves, moveId)) throw new CoreInputError('move', `${moveId}은 스냅샷에 없는 기술이다`)
  const move = game.data.moves[moveId]
  const type = attackMoveType(moveId, move.type, attacker.ability)
  const eff = attackEffectiveness(type, defender.types, attacker.ability, moveId)
  const factor = defenderAbilityFactor(type, move.flags, eff, defender.ability, attacker.ability)
  if (FIXED_DAMAGE_MOVES.includes(moveId)) return eff === 0 || factor === 0 ? 0 : 1
  return eff * factor
}
