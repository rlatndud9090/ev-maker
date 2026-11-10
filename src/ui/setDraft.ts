// 세트 편집 입력(문자열) → 코어 입력. 빈칸·숫자 아님은 NaN 등 그대로 넘겨 코어가 거부하게 한다(대체값 없음).
import type { Snapshot, StatId } from '../data/schema'
import type { PokemonSet, Status } from '../core'
import { STAT_IDS } from '../core'
import { namesOf, pickSpecies } from './names'

export type BoostStat = Exclude<StatId, 'hp'>
export const BOOST_STATS = STAT_IDS.filter((s): s is BoostStat => s !== 'hp')
export const MOVE_SLOTS = 4

export interface SetDraft {
  species: string
  ability: string
  item: string
  nature: string
  /** 성격 하락이 자동 지정인지(제품 화면 +/− 토글). 없으면 false. */
  natureMinusAuto?: boolean
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
