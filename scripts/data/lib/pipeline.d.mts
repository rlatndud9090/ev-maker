import type { SnapshotData } from '../../../src/data/schema'
import type { MatchType, MetaIndex } from '../../../src/data/meta-schema'

export class PipelineError extends Error {}

export const PROJECT_ROOT: string

export interface BuildOptions {
  root?: string
  outRoot?: string
  cacheDir?: string
  force?: boolean
  recordHashes?: boolean
  config?: unknown
  aliases?: unknown
  gameOverrides?: unknown
  koOverrides?: unknown
  log?: (message: string) => void
}

export interface BuildResult {
  generated: string[]
  skipped: string[]
  files: string[]
}

export function buildAll(opts?: BuildOptions): Promise<BuildResult>

export type DiffWarning =
  | { kind: 'species' | 'moves'; id: string; field: string; prev: unknown; cur: unknown }
  | { kind: 'species' | 'moves'; id: string; field: string; added: string[]; removed: string[] }

export interface SetDiff {
  added: string[]
  removed: string[]
}

export interface SnapshotDiff {
  species: SetDiff
  megas: SetDiff
  items: SetDiff
  moves: SetDiff
  abilities: SetDiff
  warnings: DiffWarning[]
}

export function diffSnapshots(prev: SnapshotData, cur: SnapshotData): SnapshotDiff

export interface EngineDiffEntry {
  id: string
  field: string
  snapshot: unknown
  engine: unknown
}

export interface EngineReport {
  comparedMoveFlags: string[]
  species: EngineDiffEntry[]
  moves: EngineDiffEntry[]
  items: { onlySnapshot: string[]; onlyEngine: string[] }
  /** 엔진이 대미지 0을 내는(계산을 구현하지 않은) 위력 0 공격기 */
  zeroPowerUnimplemented: string[]
}

export interface Engine {
  readonly __engine: unique symbol
}

export function loadEngine(gen: number): Engine
export function compareWithEngine(
  data: SnapshotData,
  engine: Engine,
  aliases: unknown,
): { report: EngineReport; unsupported: { species: string[]; items: string[]; abilities: string[]; moves: string[] } }

export function stableStringify(value: unknown): string
export function readProjectJson<T = unknown>(rel: string): T

export interface LicenseEntry {
  id: string
  kind: 'code' | 'data'
  name: string
  version: string
  license: string
  source: string | null
  usage: string
  noticeSource: string
  /** true면 라이선스 문구 없이 출처 표기만 하는 항목(license 'NOASSERTION') */
  attributionOnly?: boolean
  months?: Array<{ regulation: string; month: string; match: MatchType; format: string; url: string; publishedAt: string }>
}

export interface Licenses {
  entries: LicenseEntry[]
  trademark: string
  testOnly: Array<{ path: string; source: string; usage: string }>
}

/** root: 입력 루트(node_modules 기준). metaIndex: 커밋된 메타 인덱스. */
export function buildLicenses(
  root: string,
  config: unknown,
  pokeapiLicenseText: string,
  metaIndex: MetaIndex,
): { licenses: Licenses; notices: string }
