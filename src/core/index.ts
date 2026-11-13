// 계산 코어 공개 API. 모든 함수는 로드된 Snapshot을 명시 인자로 받는 동기 순수 함수다.
export * from './types'
export { CoreInputError } from './errors'
export { STAT_IDS, statValue, natureMultiplier, type NatureMultiplier } from './stats'
export { validateSet, computeStats, spNoGainCells, type ResolvedSet } from './set'
export { DEFAULT_GAME_TYPE } from './conditions'
export { calcDamage } from './damage'
export {
  DEFAULT_THRESHOLDS,
  JUDGEMENT_ORDER,
  attackBand,
  defenseBand,
  judgementRank,
  koLabel,
  nextBetter,
  normalizeThresholds,
  ROLL_DENOMINATOR,
  TIER_ORDER,
  normalizeRollSteps,
  nextBetterTier,
  rollTier,
  tierRank,
  type RollTier,
  type JudgementSide,
  type KoLabel,
  type KoSide,
} from './bands'
export { WEATHER_NEGATING_ABILITIES, finalSpeed, compareSpeed, minSpToOutspeed, checkSpeedSupport } from './speed'
export { sweep, sweepDamage, sweepSpeed, judgeDamage, judgeSpeed, type CellJudgement, type DamageCategoryOptions, type DamageSweepTarget } from './sweep'
export { moveStatRefs } from './moveRefs'
export { DEFENDER_ABILITY_IGNORING, defenderAbilityFactor, effectivenessAgainst, type EffectivenessDefender } from './effectiveness'
export {
  SPEED_DEPENDENT_MOVES,
  SPEED_DEPENDENT_ATTACKER_ABILITIES,
  attackEffectiveness,
  attackMoveType,
  engineMoveOverrides,
  typeEffectiveness,
  type MoveTypeField,
} from './engine'
export { abilityTerrain, abilityWeather, withAttackerField } from './fieldAbilities'
