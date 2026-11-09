// dev 편집기 전용 전투 조건 초안·첫 화면 값. 세트 초안은 src/ui/setDraft.
import type { StatId } from '../data/schema'
import type { BattleConditions, GameType, Terrain, Weather } from '../core'
import { DEFAULT_GAME_TYPE } from '../core'
import { parseNumber, type BoostStat, type SetDraft } from '../ui/setDraft'

export interface SideDraft {
  tailwind: boolean
  helpingHand: boolean
  friendGuard: boolean
  reflect: boolean
  lightScreen: boolean
  alliesFainted: string
}

export interface ConditionsDraft {
  gameType: GameType
  weather: Weather
  terrain: Terrain
  critical: boolean
  /** undefined면 코어 기본값 */
  spreadTargets?: 1 | 2
  /** 빈칸이면 기술 기본 타수 */
  hits: string
  attacker: SideDraft
  defender: SideDraft
}

const toSide = (s: SideDraft) => ({ ...s, alliesFainted: parseNumber(s.alliesFainted) })

export function toConditions(c: ConditionsDraft): BattleConditions {
  const out: BattleConditions = {
    gameType: c.gameType,
    weather: c.weather,
    terrain: c.terrain,
    critical: c.critical,
    attacker: toSide(c.attacker),
    defender: toSide(c.defender),
  }
  if (c.spreadTargets !== undefined) out.spreadTargets = c.spreadTargets
  if (c.hits.trim() !== '') out.hits = parseNumber(c.hits)
  return out
}

const zeroSp = (): Record<StatId, string> => ({ hp: '0', atk: '0', def: '0', spa: '0', spd: '0', spe: '0' })
const zeroBoosts = (): Record<BoostStat, string> => ({ atk: '0', def: '0', spa: '0', spd: '0', spe: '0' })
const side = (): SideDraft => ({
  tailwind: false,
  helpingHand: false,
  friendGuard: false,
  reflect: false,
  lightScreen: false,
  alliesFainted: '0',
})

/** 첫 화면 대면: notes 독립 기준값 a(대도각참 기습 → 메가마폭시). */
export const INITIAL_ATTACKER: SetDraft = {
  species: '대도각참',
  ability: 'defiant',
  item: '',
  nature: 'hardy',
  sp: { ...zeroSp(), atk: '32' },
  moves: ['기습', '', '', ''],
  mega: false,
  status: 'none',
  boosts: zeroBoosts(),
}

export const INITIAL_DEFENDER: SetDraft = {
  species: '메가마폭시',
  ability: 'blaze',
  item: '마폭시나이트',
  nature: 'hardy',
  sp: { ...zeroSp(), hp: '2' },
  moves: ['', '', '', ''],
  mega: true,
  status: 'none',
  boosts: zeroBoosts(),
}

export const INITIAL_CONDITIONS: ConditionsDraft = {
  gameType: DEFAULT_GAME_TYPE,
  weather: 'none',
  terrain: 'none',
  critical: false,
  hits: '',
  attacker: side(),
  defender: side(),
}
