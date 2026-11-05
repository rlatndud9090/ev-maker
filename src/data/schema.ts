// 레귤레이션 스냅샷 스키마. 생성기(scripts/data)와 앱(src/core, src/data)이 공유하는 계약이다.
// 모든 id는 Showdown id(소문자 영숫자)이며 레귤레이션 사이에 변하지 않는다. 이름은 표시용이다.

export const SNAPSHOT_SCHEMA_VERSION = 1

export type StatId = 'hp' | 'atk' | 'def' | 'spa' | 'spd' | 'spe'
export type StatTable = Record<StatId, number>

export type MoveCategory = 'Physical' | 'Special' | 'Status'

/** 한국어 이름과 그 출처. fallback이면 영문 대체이며 대체 목록에도 올라 있어야 한다. */
export interface LocalizedName {
  en: string
  ko: string
  koSource: 'pokeapi' | 'mega-rule' | 'override' | 'fallback'
  /** 같은 한국어 이름을 가진 항목을 구분하는 보조 라벨(예: 수컷/암컷). */
  koLabel?: string
}

export interface SpeciesEntry {
  id: string
  name: LocalizedName
  num: number
  types: string[]
  baseStats: StatTable
  weightkg: number
  /** 가질 수 있는 특성 id 목록(원천 슬롯 순서 유지). */
  abilities: string[]
  /** 배울 수 있는 기술 id 목록(정렬됨). 메가 폼은 원종의 목록을 쓴다. */
  learnset: string[]
  isMega: boolean
  /** 메가 폼이면 원종 id. */
  baseSpecies?: string
  /** 메가 폼이면 필요한 메가스톤 도구 id. */
  requiredItem?: string
}

export interface MoveEntry {
  id: string
  name: LocalizedName
  type: string
  category: MoveCategory
  basePower: number
  accuracy: number | true
  priority: number
  /** 고정 타수면 숫자, 가변이면 [최소, 최대]. 단타면 생략. */
  multihit?: number | [number, number]
  target: string
  flags: string[]
}

export interface NamedEntry {
  id: string
  name: LocalizedName
}

export interface NatureEntry extends NamedEntry {
  plus?: Exclude<StatId, 'hp'>
  minus?: Exclude<StatId, 'hp'>
}

export interface MegaEntry {
  /** 원종 id */
  base: string
  /** 메가스톤 도구 id */
  stone: string
  /** 메가 폼 species id */
  forme: string
}

export interface RegulationRules {
  level: number
  spMaxPerStat: number
  spTotal: number
  /** ISO 8601 UTC */
  start: string
  end: string
}

export interface SourceInfo {
  gameData: {
    /** 예: { "@pkmn/mods": "0.10.13", "@pkmn/dex": "0.10.13" } */
    packages: Record<string, string>
    /** lockfile의 integrity 해시(패키지별) */
    integrity: Record<string, string>
    /** 원천 모드 이름(예: champions, championsregmb) */
    mode: string
    /** 정적 대조로 확인한 Showdown 커밋(참고값) */
    showdownCommitRef?: string
    /** 고정 설정에 기록한 원천 기준 시각(ISO 8601) */
    sourceTime: string
  }
  ko: {
    pokeapiCommit: string
    files: Record<string, string>
    sourceTime: string
  }
}

export interface EngineUnsupported {
  species: string[]
  items: string[]
  abilities: string[]
  moves: string[]
}

export interface SnapshotManifest {
  schemaVersion: number
  regulation: { id: string; name: string }
  rules: RegulationRules
  source: SourceInfo
  engineUnsupported: EngineUnsupported
  /** 적용된 보정표 항목 수(내역은 리포트) */
  overridesApplied: number
}

export interface SnapshotData {
  species: Record<string, SpeciesEntry>
  moves: Record<string, MoveEntry>
  items: Record<string, NamedEntry>
  abilities: Record<string, NamedEntry>
  natures: Record<string, NatureEntry>
  megas: MegaEntry[]
}

export interface Snapshot {
  manifest: SnapshotManifest
  data: SnapshotData
}

/** src/data/regulations/index.json */
export interface RegulationIndex {
  schemaVersion: number
  default: string
  regulations: Array<{ id: string; name: string; mode: string; frozen: boolean }>
}
