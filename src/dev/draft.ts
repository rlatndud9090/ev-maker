// 편집기 입력(문자열) → 코어 입력. 빈칸·숫자 아님은 NaN 등 그대로 넘겨 코어가 거부하게 한다(대체값 없음).
import type { Snapshot, StatId } from '../data/schema'
import type { BattleConditions, GameType, PokemonSet, Status, Terrain, Weather } from '../core'
import { DEFAULT_GAME_TYPE, STAT_IDS } from '../core'
import { namesOf, pickSpecies } from './names'

export type BoostStat = Exclude<StatId, 'hp'>
export const BOOST_STATS = STAT_IDS.filter((s): s is BoostStat => s !== 'hp')
export const MOVE_SLOTS = 4

export interface SetDraft {
  species: string
  ability: string
  item: string
  nature: string
  sp: Record<StatId, string>
  moves: string[]
  mega: boolean
  status: Status
  boosts: Record<BoostStat, string>
}

/** 빈칸은 0이 아니라 NaN(Number('')은 0이라 따로 막는다). */
export const parseNumber = (text: string): number => (text.trim() === '' ? NaN : Number(text))

export interface DraftResolution {
  set: PokemonSet
  /** 메가 폼 이름으로 골라 메가가 강제됐는지 */
  megaByName: boolean
}

export function toPokemonSet(snapshot: Snapshot, d: SetDraft): DraftResolution {
  const names = namesOf(snapshot)
  const pick = pickSpecies(snapshot, d.species)
  const set: PokemonSet = {
    regulation: snapshot.manifest.regulation.id,
    species: pick?.base.id ?? names.species.resolve(d.species) ?? d.species,
    ability: d.ability,
    nature: d.nature,
    sp: Object.fromEntries(STAT_IDS.map((s) => [s, parseNumber(d.sp[s])])) as Record<StatId, number>,
    moves: d.moves.filter((m) => m.trim() !== '').map((m) => names.moves.resolve(m) ?? m),
  }
  if (d.item.trim() !== '') set.item = names.items.resolve(d.item) ?? d.item
  const megaByName = pick?.megaStone !== undefined
  if (megaByName || d.mega) set.mega = true
  if (d.status !== 'none') set.status = d.status
  set.boosts = Object.fromEntries(BOOST_STATS.map((s) => [s, parseNumber(d.boosts[s])]))
  return { set, megaByName }
}

/** 공격 기술 슬롯의 기술 id(풀리지 않으면 원문). */
export function moveIdOf(snapshot: Snapshot, d: SetDraft, slot: number): string | undefined {
  const text = d.moves[slot]?.trim()
  if (!text) return undefined
  return namesOf(snapshot).moves.resolve(text) ?? text
}

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
