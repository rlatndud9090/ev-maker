import type { MatchType } from '../../../src/data/meta-schema'

export const PROJECT_ROOT: string
export const META_MAX_BYTES: number

export class MetaPipelineError extends Error {}

export interface MetaBuildOptions {
  regulation: string
  month: string
  match?: MatchType[]
  record?: boolean
  force?: boolean
  root?: string
  outRoot?: string
  cacheDir?: string
  config?: unknown
  /** 기록 모드가 쓸 경로(기본 <root>/scripts/data/meta.config.json) */
  configPath?: string
  fetch?: (url: string) => Promise<Response>
  log?: (message: string) => void
}

export interface MetaRecorded {
  regulation: string
  month: string
  match: MatchType
  sha256: string
  publishedAt: string
}

export interface MetaBuildResult {
  generated: string[]
  skipped: string[]
  recorded: MetaRecorded[]
  files: string[]
  noticeUpdateRequired: boolean
}

export function buildMeta(opts: MetaBuildOptions): Promise<MetaBuildResult>
