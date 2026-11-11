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
  type JudgementSide,
  type KoLabel,
  type KoSide,
} from './bands'
export { finalSpeed, compareSpeed, minSpToOutspeed, checkSpeedSupport } from './speed'
export { sweep, sweepDamage, sweepSpeed, judgeDamage, judgeSpeed, type CellJudgement, type DamageSweepTarget } from './sweep'
export { moveStatRefs } from './moveRefs'
export { SPEED_DEPENDENT_MOVES, SPEED_DEPENDENT_ATTACKER_ABILITIES, engineMoveOverrides } from './engine'
