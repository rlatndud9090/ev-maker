// 대전 조건 정규화. 기본값(더블 등)은 코어가 여기서만 정한다.
import type { BattleConditions, GameType, SideConditions, Terrain, Weather } from './types'
import { CoreInputError, assertKnownKeys, integerInRange, isPlainObject, oneOf, optionalBoolean } from './errors'

export const DEFAULT_GAME_TYPE: GameType = 'Doubles'
const GAME_TYPES: readonly GameType[] = ['Doubles', 'Singles']
const WEATHERS: readonly Weather[] = ['none', 'Sun', 'Rain', 'Sand', 'Snow']
const TERRAINS: readonly Terrain[] = ['none', 'Electric', 'Grassy', 'Psychic', 'Misty']
const CONDITION_KEYS = ['gameType', 'weather', 'terrain', 'attacker', 'defender', 'critical', 'spreadTargets', 'hits']
const SIDE_KEYS = ['tailwind', 'helpingHand', 'friendGuard', 'reflect', 'lightScreen', 'alliesFainted']
const MAX_ALLIES_FAINTED = 5

export type NormalizedSide = Required<SideConditions>

export interface NormalizedConditions {
  gameType: GameType
  weather: Weather
  terrain: Terrain
  attacker: NormalizedSide
  defender: NormalizedSide
  critical: boolean
  spreadTargets: 1 | 2
  /** 지정하지 않으면 undefined(엔진 기본 타수) */
  hits?: number
}

function side(v: unknown, field: string): NormalizedSide {
  if (v === undefined) v = {}
  if (!isPlainObject(v)) throw new CoreInputError(field, '객체여야 한다')
  assertKnownKeys(v, SIDE_KEYS, field)
  return {
    tailwind: optionalBoolean(v.tailwind, `${field}.tailwind`),
    helpingHand: optionalBoolean(v.helpingHand, `${field}.helpingHand`),
    friendGuard: optionalBoolean(v.friendGuard, `${field}.friendGuard`),
    reflect: optionalBoolean(v.reflect, `${field}.reflect`),
    lightScreen: optionalBoolean(v.lightScreen, `${field}.lightScreen`),
    alliesFainted:
      v.alliesFainted === undefined ? 0 : integerInRange(v.alliesFainted, 0, MAX_ALLIES_FAINTED, `${field}.alliesFainted`),
  }
}

export function normalizeConditions(c: BattleConditions | undefined): NormalizedConditions {
  const raw: unknown = c ?? {}
  if (!isPlainObject(raw)) throw new CoreInputError('conditions', '객체여야 한다')
  assertKnownKeys(raw, CONDITION_KEYS, 'conditions')
  const out: NormalizedConditions = {
    gameType: raw.gameType === undefined ? DEFAULT_GAME_TYPE : oneOf(raw.gameType, GAME_TYPES, 'conditions.gameType'),
    weather: raw.weather === undefined ? 'none' : oneOf(raw.weather, WEATHERS, 'conditions.weather'),
    terrain: raw.terrain === undefined ? 'none' : oneOf(raw.terrain, TERRAINS, 'conditions.terrain'),
    attacker: side(raw.attacker, 'conditions.attacker'),
    defender: side(raw.defender, 'conditions.defender'),
    critical: optionalBoolean(raw.critical, 'conditions.critical'),
    spreadTargets: raw.spreadTargets === undefined ? 2 : (integerInRange(raw.spreadTargets, 1, 2, 'conditions.spreadTargets') as 1 | 2),
  }
  // 타수 범위는 기술을 알아야 검사할 수 있어 calcDamage에서 다시 확인한다.
  if (raw.hits !== undefined) out.hits = integerInRange(raw.hits, 1, 10, 'conditions.hits')
  return out
}
