// 메타 스냅샷 스키마. 생성기(scripts/data)와 앱(src/data, src/meta)이 공유하는 계약이다.
// 생성기가 Node 타입 제거로 이 파일을 직접 import하므로 다른 모듈은 import type으로만 참조한다.
import type { PokemonSet } from '../core/types'
import type { StatId } from './schema'

export const META_SCHEMA_VERSION = 1

export type MatchType = 'bo1' | 'bo3'
export const MATCH_TYPES: readonly MatchType[] = ['bo1', 'bo3']

/** 도구 분포의 "도구 없음" 키. 게임 데이터 도구 id가 아니다. */
export const NO_ITEM = 'nothing'

/** 원천 월 형식 YYYY-MM. */
export const META_MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/

/** id → 점유율(0~1, 소수 넷째 자리 반올림). */
export type Shares = Record<string, number>

export interface MetaParams {
  minUsage: number
  spreadTarget: number
  spreadMax: number
  itemMin: number
  moveMin: number
  teammatesTop: number
}

export interface MetaManifest {
  schemaVersion: number
  /** 게임 데이터 레귤레이션 id */
  regulation: string
  /** YYYY-MM */
  month: string
  match: MatchType
  source: {
    format: string
    cutoff: number
    url: string
    /** 압축 해제 본문 sha256 */
    sha256: string
    /** ISO 8601 */
    publishedAt: string
    /** 원천 info["number of battles"] */
    battles: number
  }
  params: MetaParams
  /** sha256은 연결한 data.json 바이트의 해시 */
  gameData: { regulation: string; schemaVersion: number; sha256: string }
  /** 원천 전체 종 Σ가중 출현 수 ÷ 12, 소수 첫째 자리 */
  sample: { weightedBattles: number }
}

export interface DistributionShares {
  /** 컷을 넘긴 값(위반 제외 후) */
  shares: Shares
  /** shares 합(기술은 최대 4) */
  keptShare: number
  /** 위반으로 뺀 몫 */
  excludedShare: number
}

/** spread 키 형식 "성격id:H/A/B/C/D/S"(예 "adamant:2/32/0/0/0/32"). */
export type SpreadShare = [key: string, share: number]

export interface MetaEntry {
  /** 로스터 종·폼 id(메가는 메가 폼 id) */
  id: string
  /** 1부터, 사용률 내림차순·동률은 id 순 */
  rank: number
  /** 원천 usage 그대로(반올림하지 않음) */
  usage: number
  /** weighted는 Σ특성(소수 둘째 자리), raw는 원천 Raw count */
  sample: { weighted: number; raw: number }
  mega?: { base: string; stone: string }
  /** 위반 제외 후 전부. 메가 항목은 메가 폼 특성 기준 */
  abilities: Shares
  items: DistributionShares
  /** 빈 칸("") 제외 */
  moves: DistributionShares
  /** kept는 점유율 내림차순·동률은 key 순 */
  spreads: { kept: SpreadShare[]; keptShare: number; excludedShare: number }
  /** 위반 제외 후 전체 spread 기준 주변분포 */
  natures: Shares
  /** 능력치별 키 "0"~"32" */
  spMarginal: Record<StatId, Shares>
  /** 위반 제외 후 비율 상위 teammatesTop */
  teammates: Shares
  representative: {
    set: PokemonSet
    basis: 'modal-combination'
    abilityBasis?: 'source-top' | 'base-first-slot'
  }
}

export interface MetaSnapshot {
  manifest: MetaManifest
  /** rank 순 */
  entries: MetaEntry[]
}

export interface MetaIndexItem {
  match: MatchType
  month: string
  /** "<레귤레이션>/<월>-<매치>.json"(예 "m-c/2026-10-bo1.json") */
  file: string
  format: string
  url: string
  publishedAt: string
  /** 원천 info["number of battles"](스냅샷 manifest.source.battles와 같다). 기본 매치 방식 선택에 쓴다 */
  battles: number
}

/** src/data/meta/index.json. 각 배열은 (month, match) 순 */
export interface MetaIndex {
  schemaVersion: number
  regulations: Record<string, MetaIndexItem[]>
}
