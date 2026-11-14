// 내 포켓몬 종 교체 시 초안: 메타 대표 세트로 채우거나(처음 고른 종) 종만 바꾼다(메타 목록 밖 종).
import { STAT_IDS } from '../core'
import type { MetaEntry } from '../data/meta-schema'
import type { Snapshot, StatId } from '../data/schema'
import { namesOf, pickSpecies } from '../ui/names'
import { MOVE_SLOTS, type SetDraft } from '../ui/setDraft'

const has = (table: object, id: string): boolean => Object.prototype.hasOwnProperty.call(table, id)

/**
 * 종만 바꾼 초안(메타 목록 밖 종·풀리지 않는 이름). 메가는 메가 폼 종 이름으로만 고른다(스톤 자동 고정), 메가 폼에서 벗어나면
 * 스톤을 비운다. 새 종이 가질 수 없는 특성이면 첫 특성.
 */
export function speciesOnlyDraft(game: Snapshot, draft: SetDraft, text: string): SetDraft {
  const names = namesOf(game)
  const prev = pickSpecies(game, draft.species)
  const next = pickSpecies(game, text)
  const out: SetDraft = { ...draft, species: text, mega: false }
  if (next) {
    if (!next.base.abilities.includes(draft.ability)) out.ability = next.base.abilities[0]
    if (next.megaStone !== undefined) out.item = names.items.label(next.megaStone)
    else if (prev?.megaStone !== undefined) out.item = ''
  }
  return out
}

/**
 * 그 종 메타 대표 세트(representative.set)로 채운 초안. 메가 폼은 메가 폼 항목, 없으면 원종 항목으로 대신한다(일부 메가는 원종
 * 항목만 있다). 도구는 메가 폼이면 그 메가스톤, 아니면 대표 도구(메가스톤이면 비움). 특성은 그 종이 가질 수 없으면 첫 특성.
 * 게임 데이터에 없는 기술은 건너뛰고 성격은 없으면 지금 값. 메타 목록 밖이거나 이름이 풀리지 않으면 undefined.
 */
export function representativeDraft(game: Snapshot, entryOf: (id: string) => MetaEntry | undefined, draft: SetDraft, text: string): SetDraft | undefined {
  const names = namesOf(game)
  const id = names.species.resolve(text)
  const pick = pickSpecies(game, text)
  if (id === undefined || pick === undefined) return undefined
  const entry = entryOf(id) ?? (pick.megaStone !== undefined ? entryOf(pick.base.id) : undefined)
  if (entry === undefined) return undefined
  const rep = entry.representative.set
  const stones = new Set(game.data.megas.map((m) => m.stone))
  const item = pick.megaStone ?? (rep.item !== undefined && !stones.has(rep.item) ? rep.item : undefined)
  const moves = rep.moves.filter((m) => has(game.data.moves, m)).slice(0, MOVE_SLOTS).map((m) => names.moves.label(m))
  return {
    ...draft,
    species: text,
    mega: false,
    ability: pick.base.abilities.includes(rep.ability) ? rep.ability : pick.base.abilities[0],
    item: item === undefined ? '' : names.items.label(item),
    nature: has(game.data.natures, rep.nature) ? rep.nature : draft.nature,
    natureMinusAuto: has(game.data.natures, rep.nature) ? false : draft.natureMinusAuto,
    sp: Object.fromEntries(STAT_IDS.map((s) => [s, String(rep.sp[s])])) as Record<StatId, string>,
    moves: Array.from({ length: MOVE_SLOTS }, (_, i) => moves[i] ?? ''),
  }
}
