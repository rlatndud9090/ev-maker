import type { SnapshotData } from '../../../src/data/schema'

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
