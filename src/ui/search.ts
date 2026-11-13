// 한국어 부분 일치 이름 검색. 결과는 id 목록이고, 표시 라벨은 이름 색인(names.ts)이 만든다.
import { moveStatRefs } from '../core'
import type { LocalizedName, Snapshot } from '../data/schema'
import { nameLabel } from './names'

export interface SearchEntry {
  id: string
  label: string
  /** 정규화한 한국어 라벨·영문 이름·id */
  keys: readonly string[]
}

/** 검색 대상 목록(라벨 가나다순). */
export type SearchIndex = readonly SearchEntry[]

const normalize = (text: string): string => text.normalize('NFC').replace(/\s+/g, '').toLowerCase()

interface Named {
  id: string
  name: LocalizedName
}

const cache = new WeakMap<object, SearchIndex>()
const subsetCache = new WeakMap<object, WeakMap<readonly string[], SearchIndex>>()

/** 표의 전체 항목(ids를 주면 그 id만, 표에 없는 id는 건너뛴다). 같은 표·같은 ids 배열이면 캐시를 돌려준다. */
export function searchIndexOf(table: Readonly<Record<string, Named>>, ids?: readonly string[]): SearchIndex {
  const hit = ids === undefined ? cache.get(table) : subsetCache.get(table)?.get(ids)
  if (hit) return hit
  const pick = ids ?? Object.keys(table)
  const out: SearchEntry[] = []
  for (const id of pick) {
    if (!Object.prototype.hasOwnProperty.call(table, id)) continue
    const e = table[id]
    const label = nameLabel(e.name)
    out.push({ id, label, keys: [normalize(label), normalize(e.name.en), normalize(id)] })
  }
  out.sort((a, b) => a.label.localeCompare(b.label, 'ko'))
  if (ids === undefined) cache.set(table, out)
  else {
    let sub = subsetCache.get(table)
    if (!sub) subsetCache.set(table, (sub = new WeakMap()))
    sub.set(ids, out)
  }
  return out
}

/** 일치 순위: 라벨 완전 일치 → 앞부분 일치 → 부분 일치, 같은 순위는 라벨 가나다순. 빈 검색어는 앞에서부터 limit개. */
export function searchNames(index: SearchIndex, query: string, limit: number): string[] {
  const q = normalize(query)
  if (q === '') return index.slice(0, limit).map((e) => e.id)
  const scored: Array<{ id: string; score: number; order: number }> = []
  index.forEach((e, order) => {
    let score = Infinity
    for (const k of e.keys) {
      if (k === q) score = Math.min(score, 0)
      else if (k.startsWith(q)) score = Math.min(score, 1)
      else if (k.includes(q)) score = Math.min(score, 2)
    }
    if (score !== Infinity) scored.push({ id: e.id, score, order })
  })
  scored.sort((a, b) => a.score - b.score || a.order - b.order)
  return scored.slice(0, limit).map((s) => s.id)
}

/** 로스터 종·폼 id가 배울 수 있는 기술 id(메가 폼은 원종 목록). 모르는 id면 빈 배열. */
export function learnableMoves(game: Snapshot, rosterId: string): readonly string[] {
  const d = game.data
  if (!Object.prototype.hasOwnProperty.call(d.species, rosterId)) return []
  const entry = d.species[rosterId]
  if (entry.learnset.length > 0 || !entry.isMega) return entry.learnset
  const base = entry.baseSpecies
  return base !== undefined && Object.prototype.hasOwnProperty.call(d.species, base) ? d.species[base].learnset : []
}

/** 방어 탭 상대 기술 추가 검색 대상: 그 종이 배우는 공격기 중 exclude(이미 목록 후보)와 분류 가변 기술(항목이 되지 않음)을 뺀 것 */
export function addableMoves(game: Snapshot, rosterId: string, exclude: readonly string[]): string[] {
  return learnableMoves(game, rosterId).filter((m) => {
    if (exclude.includes(m) || !Object.prototype.hasOwnProperty.call(game.data.moves, m)) return false
    const refs = moveStatRefs(game, m)
    return refs.category !== 'Status' && !refs.categoryVaries
  })
}
