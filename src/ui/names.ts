// 표시 이름 ↔ id 조회. 판정은 하지 않고, 풀리지 않은 입력은 원문 그대로 코어에 넘겨 코어가 거부하게 한다.
import type { LocalizedName, Snapshot, SpeciesEntry } from '../data/schema'

export const nameLabel = (n: LocalizedName): string => (n.koLabel ? `${n.ko}(${n.koLabel})` : n.ko)

interface Named {
  id: string
  name: LocalizedName
}

export interface NameIndex {
  /** 한국어 라벨·영문 이름(소문자)·id → id */
  resolve(text: string): string | undefined
  label(id: string): string
}

function buildIndex(table: Record<string, Named>): NameIndex {
  const byText = new Map<string, string>()
  for (const e of Object.values(table)) {
    byText.set(e.id, e.id)
    byText.set(e.name.en.toLowerCase(), e.id)
  }
  // 한국어 라벨이 영문·id와 겹치면 한국어 라벨을 우선한다.
  for (const e of Object.values(table)) byText.set(nameLabel(e.name), e.id)
  return {
    resolve: (text) => byText.get(text.trim()) ?? byText.get(text.trim().toLowerCase()),
    label: (id) => (Object.prototype.hasOwnProperty.call(table, id) ? nameLabel(table[id].name) : id),
  }
}

export interface SnapshotNames {
  species: NameIndex
  moves: NameIndex
  items: NameIndex
  abilities: NameIndex
  natures: NameIndex
  /** 원종과 메가 폼 전부(라벨 정렬) */
  speciesOptions: string[]
  itemOptions: string[]
}

const cache = new WeakMap<Snapshot, SnapshotNames>()

const sortedLabels = (table: Record<string, Named>) =>
  Object.values(table)
    .map((e) => nameLabel(e.name))
    .sort((a, b) => a.localeCompare(b, 'ko'))

export function namesOf(snapshot: Snapshot): SnapshotNames {
  let n = cache.get(snapshot)
  if (!n) {
    const d = snapshot.data
    n = {
      species: buildIndex(d.species),
      moves: buildIndex(d.moves),
      items: buildIndex(d.items),
      abilities: buildIndex(d.abilities),
      natures: buildIndex(d.natures),
      speciesOptions: sortedLabels(d.species),
      itemOptions: sortedLabels(d.items),
    }
    cache.set(snapshot, n)
  }
  return n
}

export interface SpeciesPick {
  /** 원종 id */
  base: SpeciesEntry
  /** 메가 폼 이름으로 골랐으면 그 메가스톤 id */
  megaStone?: string
}

/** 종 입력 해석. 메가 폼 이름은 원종 + 메가스톤으로 푼다(코어 계약: species는 원종). */
export function pickSpecies(snapshot: Snapshot, text: string): SpeciesPick | undefined {
  const id = namesOf(snapshot).species.resolve(text)
  if (id === undefined) return undefined
  const entry = snapshot.data.species[id]
  if (!entry.isMega) return { base: entry }
  const mega = snapshot.data.megas.find((m) => m.forme === entry.id)
  const base = mega && snapshot.data.species[mega.base]
  return mega && base ? { base, megaStone: mega.stone } : undefined
}

export function learnsetOptions(snapshot: Snapshot, base: SpeciesEntry | undefined): string[] {
  if (!base) return []
  const names = namesOf(snapshot).moves
  return base.learnset.map((m) => names.label(m)).sort((a, b) => a.localeCompare(b, 'ko'))
}

const heldItemCache = new WeakMap<Snapshot, readonly string[]>()

/** 도구 수동 선택 후보: 메가스톤 제외(메가는 메가 폼 종을 고르면 스톤이 자동 고정된다). 스냅샷마다 같은 배열을 돌려준다(검색 색인 캐시 키). */
export function heldItemIds(snapshot: Snapshot): readonly string[] {
  let ids = heldItemCache.get(snapshot)
  if (!ids) {
    const stones = new Set(snapshot.data.megas.map((m) => m.stone))
    ids = Object.keys(snapshot.data.items).filter((id) => !stones.has(id))
    heldItemCache.set(snapshot, ids)
  }
  return ids
}
