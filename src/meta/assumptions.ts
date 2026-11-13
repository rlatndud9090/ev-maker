// 메타 뷰: 순위·이름 조인·대표 가정·상대 조회·오버레이 병합·세트 검증. 로드된 스냅샷을 인자로 받는 동기 순수 함수다.
import { CoreError, CoreInputError, STAT_IDS, validateSet, type SpTable } from '../core'
import { NO_ITEM, type MetaEntry, type MetaSnapshot } from '../data/meta-schema'
import type { Snapshot, StatId } from '../data/schema'
import type {
  Assumption,
  AssumptionOverlay,
  DisplayName,
  ExternalSource,
  LadderSource,
  MetaView,
  NameKind,
  OpponentLookup,
  ResolvedAssumption,
  SetDisplayNames,
  TopAssumption,
} from './types'

const EXTERNAL_KINDS: readonly ExternalSource['kind'][] = ['custom', 'sns', 'article']
const NO_ITEM_NAME: Omit<DisplayName, 'id'> = { ko: '도구 없음', en: 'No Item', missing: false }
const SPREAD_KEY = /^([a-z0-9]+):(\d+)\/(\d+)\/(\d+)\/(\d+)\/(\d+)\/(\d+)$/

const hasOwn = (obj: object, key: string): boolean => Object.prototype.hasOwnProperty.call(obj, key)

/** 메타 스냅샷과 같은 레귤레이션의 게임 데이터로 뷰를 만든다. 레귤레이션이 다르면 throw. */
export function createMetaView(meta: MetaSnapshot, game: Snapshot): MetaView {
  const regulation = game.manifest.regulation.id
  if (meta.manifest.regulation !== regulation) {
    throw new Error(`메타 스냅샷 레귤레이션 ${meta.manifest.regulation}이 게임 데이터 ${regulation}과 다르다`)
  }
  const byId = new Map<string, MetaEntry>()
  for (const e of meta.entries) {
    if (byId.has(e.id)) throw new Error(`메타 항목 id ${e.id}이 중복됐다`)
    byId.set(e.id, e)
  }
  const ranking = [...meta.entries].sort((a, b) => a.rank - b.rank || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return {
    meta,
    game,
    ranking,
    entry: (id) => byId.get(id),
    name: (kind, id) => displayName(game, kind, id),
  }
}

function displayName(game: Snapshot, kind: NameKind, id: string): DisplayName {
  if (kind === 'items' && id === NO_ITEM) return { id, ...NO_ITEM_NAME }
  const table: Record<string, { name: { ko: string; en: string } }> = game.data[kind]
  if (!hasOwn(table, id)) return { id, ko: id, en: id, missing: true }
  const { ko, en } = table[id].name
  return { id, ko, en, missing: false }
}

export function ladderSource(meta: MetaSnapshot): LadderSource {
  const { match, month, source } = meta.manifest
  return { kind: 'ladder', origin: 'smogon-chaos', format: source.format, match, month, cutoff: source.cutoff, url: source.url }
}

function requireEntry(view: MetaView, entryId: string): MetaEntry {
  const entry = view.entry(entryId)
  if (!entry) throw new Error(`메타 항목 ${entryId}이 없다`)
  return entry
}

/** 래더 대표 세트(최빈 조합) 가정. share는 1위 spread 점유율. */
export function representativeAssumption(view: MetaView, entryId: string): Assumption {
  const entry = requireEntry(view, entryId)
  const { set, abilityBasis } = entry.representative
  const a: Assumption = { target: entry.id, set: structuredClone(set), source: ladderSource(view.meta), basis: 'modal-combination' }
  const top = entry.spreads.kept[0]
  if (top) a.share = top[1]
  if (abilityBasis) a.abilityBasis = abilityBasis
  return a
}

/** spread 키 "성격id:H/A/B/C/D/S"를 성격과 SP 표로 푼다. 형식이 틀리면 throw. */
export function parseSpreadKey(key: string): { nature: string; sp: SpTable } {
  const m = SPREAD_KEY.exec(key)
  if (!m) throw new Error(`spread 키 형식이 잘못됐다: ${key}`)
  const sp = Object.fromEntries(STAT_IDS.map((s: StatId, i) => [s, Number(m[i + 2])])) as SpTable
  return { nature: m[1], sp }
}

/** 대표 세트의 성격·SP만 spreads.kept[spreadIndex]로 바꾼 관측 배분 가정. */
export function observedSpreadAssumption(view: MetaView, entryId: string, spreadIndex: number): Assumption {
  const entry = requireEntry(view, entryId)
  const kept = entry.spreads.kept
  if (!Number.isInteger(spreadIndex) || spreadIndex < 0 || spreadIndex >= kept.length) {
    throw new RangeError(`${entryId}의 보존 spread 인덱스는 0~${kept.length - 1}이다(받은 값: ${spreadIndex})`)
  }
  const [key, share] = kept[spreadIndex]
  if (!SPREAD_KEY.test(key)) throw new Error(`${entryId}의 spread 키 형식이 잘못됐다: ${key}`)
  const { nature, sp } = parseSpreadKey(key)
  const a = representativeAssumption(view, entryId)
  a.set = { ...a.set, nature, sp }
  a.basis = 'observed-spread'
  a.share = share
  return a
}

/**
 * 가정 세트를 코어 세트 검증에 통과시킨다. 검증 실패(CoreError·CoreInputError)와
 * 해석된 종이 target과 다른 경우(대상 불일치)만 usable: false로 돌린다.
 */
export function resolveAssumption(game: Snapshot, a: Assumption): ResolvedAssumption {
  try {
    const resolved = validateSet(game, a.set)
    if (resolved.species.id !== a.target) {
      const error = new CoreInputError('target', `대상 불일치: target ${a.target}, 해석된 종 ${resolved.species.id}`)
      return { usable: false, assumption: a, error }
    }
    return { usable: true, assumption: a, resolved }
  } catch (error) {
    if (error instanceof CoreError || error instanceof CoreInputError) return { usable: false, assumption: a, error }
    throw error
  }
}

export function setDisplayNames(view: MetaView, r: ResolvedAssumption): SetDisplayNames {
  const { set } = r.assumption
  const species = r.usable ? r.resolved.species.id : r.assumption.target
  const names: SetDisplayNames = {
    species: view.name('species', species),
    ability: view.name('abilities', set.ability),
    nature: view.name('natures', set.nature),
    moves: set.moves.map((m) => view.name('moves', m)),
  }
  if (set.item !== undefined) names.item = view.name('items', set.item)
  return names
}

/** 순위 상위 n개 항목의 대표 가정을 해석하고 이름을 붙인다. */
export function topAssumptions(view: MetaView, n = 30): TopAssumption[] {
  return view.ranking.slice(0, n).map((entry) => {
    const result = resolveAssumption(view.game, representativeAssumption(view, entry.id))
    return { entry, result, names: setDisplayNames(view, result) }
  })
}

/** 래더 외 출처 오버레이의 계약 위반을 throw한다. */
export function validateOverlay(game: Snapshot, overlay: AssumptionOverlay): void {
  const regulation = game.manifest.regulation.id
  if (overlay.regulation !== regulation) {
    throw new Error(`오버레이 레귤레이션 ${overlay.regulation}이 게임 데이터 ${regulation}과 다르다`)
  }
  overlay.assumptions.forEach((a, i) => {
    const at = `assumptions[${i}]`
    if (!EXTERNAL_KINDS.includes(a.source.kind as ExternalSource['kind'])) {
      throw new Error(`${at}.source.kind는 ${EXTERNAL_KINDS.join('|')} 중 하나여야 한다(받은 값: ${a.source.kind})`)
    }
    if (a.basis !== 'as-published') throw new Error(`${at}.basis는 as-published여야 한다(받은 값: ${a.basis})`)
    if (a.share !== undefined) throw new Error(`${at}.share는 래더 출처에만 쓴다`)
    if (typeof a.target !== 'string' || !hasOwn(game.data.species, a.target)) {
      throw new Error(`${at}.target ${String(a.target)}이 레귤레이션 로스터에 없다`)
    }
    if (a.set.regulation !== regulation) {
      throw new Error(`${at}.set.regulation ${a.set.regulation}이 ${regulation}과 다르다`)
    }
  })
}

/** ladder 가정 뒤에 같은 target의 오버레이 가정을 해석해 붙인다. */
export function mergeOverlay(
  game: Snapshot,
  ladder: ResolvedAssumption[],
  overlay: AssumptionOverlay | undefined,
  target: string,
): ResolvedAssumption[] {
  const extra = (overlay?.assumptions ?? []).filter((a) => a.target === target).map((a) => resolveAssumption(game, a))
  return [...ladder, ...extra]
}

/** 로스터 종·폼 id로 상대 가정을 조회한다. 메타 항목이 없으면 오버레이 가정만 담은 no-ladder. */
export function lookupOpponent(view: MetaView, rosterId: string, overlay?: AssumptionOverlay): OpponentLookup {
  const { game } = view
  if (typeof rosterId !== 'string' || !hasOwn(game.data.species, rosterId)) {
    throw new Error(`${String(rosterId)}이 레귤레이션 로스터에 없다`)
  }
  if (overlay) validateOverlay(game, overlay)
  const entry = view.entry(rosterId)
  if (!entry) return { status: 'no-ladder', assumptions: mergeOverlay(game, [], overlay, rosterId) }
  const ladder = [resolveAssumption(game, representativeAssumption(view, rosterId))]
  return { status: 'ladder', entry, assumptions: mergeOverlay(game, ladder, overlay, rosterId) }
}
