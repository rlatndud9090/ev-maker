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

/**
 * 종을 바꿀 때 기술 칸 미리 채우기: 새 종이 이전 종(마지막으로 풀린 종 id)과 다르고 사용률 순위가 있으면 그 상위 MOVE_SLOTS개의
 * 이름(모자라면 남는 칸은 빈칸). topMovesOf는 종 id의 기술 사용률 순위(메타 목록 밖이면 undefined) — 메타 조회는 호출자(app) 몫이다.
 * 메가 폼은 메가 폼 id 순위를 쓰고, 그 항목이 없으면 원종 순위로 대신한다: 메타가 메가를 따로 집계하지만 일부 메가는 원종 항목만
 * 있다(2026-10 Bo1 excadrillmega·sableyemega·venusaurmega, Bo3 excadrillmega·venusaurmega). 메가 폼은 원종 기술을 그대로 쓰므로
 * 이전 종의(새 종이 못 배울 수 있는) 기술을 남기는 것보다 낫다. 같은 종·풀리지 않는 이름·목록 밖 종이면 undefined(기술 그대로).
 */
export function speciesMoveFill(
  snapshot: Snapshot,
  prevSpeciesId: string | undefined,
  nextSpecies: string,
  topMovesOf: (id: string) => readonly string[] | undefined,
): string[] | undefined {
  const names = namesOf(snapshot)
  const next = names.species.resolve(nextSpecies)
  if (next === undefined || next === prevSpeciesId) return undefined
  const pick = pickSpecies(snapshot, nextSpecies)
  const ids = topMovesOf(next) ?? (pick?.megaStone !== undefined ? topMovesOf(pick.base.id) : undefined)
  if (ids === undefined) return undefined
  const labels = ids.slice(0, MOVE_SLOTS).map((id) => names.moves.label(id))
  return Array.from({ length: MOVE_SLOTS }, (_, i) => labels[i] ?? '')
}
