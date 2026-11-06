// 상대 세트 가정 계약. 출처가 무엇이든 가정은 계산 코어 세트(PokemonSet) 하나로 코어에 들어간다.
import type { CoreError, PokemonSet } from '../core/types'
import type { CoreInputError } from '../core/errors'
import type { ResolvedSet } from '../core/set'
import type { MatchType, MetaEntry, MetaSnapshot } from '../data/meta-schema'
import type { Snapshot } from '../data/schema'

export type AssumptionSourceKind = 'ladder' | 'custom' | 'sns' | 'article'

export interface LadderSource {
  kind: 'ladder'
  origin: 'smogon-chaos'
  format: string
  match: MatchType
  month: string
  cutoff: number
  url: string
}

export interface ExternalSource {
  kind: 'custom' | 'sns' | 'article'
  link?: string
  author?: string
  date?: string
  memo?: string
}

/** ladder는 modal-combination·observed-spread, 그 밖의 출처는 as-published. */
export type AssumptionBasis = 'modal-combination' | 'observed-spread' | 'as-published'

export interface Assumption {
  /** 로스터 종·폼 id(메가는 메가 폼 id) */
  target: string
  /** 계산 코어 세트 계약 그대로(메가 = 원종 + 스톤 + mega: true) */
  set: PokemonSet
  source: LadderSource | ExternalSource
  basis: AssumptionBasis
  intent?: string
  /** ladder만: 쓴 spread의 점유율(0~1) */
  share?: number
  abilityBasis?: 'source-top' | 'base-first-slot'
}

export interface AssumptionOverlay {
  regulation: string
  assumptions: Assumption[]
}

export type ResolvedAssumption =
  | { usable: true; assumption: Assumption; resolved: ResolvedSet }
  | { usable: false; assumption: Assumption; error: CoreError | CoreInputError }

/** missing이면 게임 데이터에 없는 id이며 ko·en에 원문 id가 들어 있다. */
export interface DisplayName {
  id: string
  ko: string
  en: string
  missing: boolean
}

export type NameKind = 'species' | 'items' | 'abilities' | 'moves' | 'natures'

export type OpponentLookup =
  | { status: 'ladder'; entry: MetaEntry; assumptions: ResolvedAssumption[] }
  | { status: 'no-ladder'; assumptions: ResolvedAssumption[] }

export interface SetDisplayNames {
  /** 해석된 계산 종(메가면 메가 폼)의 이름 */
  species: DisplayName
  item?: DisplayName
  ability: DisplayName
  nature: DisplayName
  moves: DisplayName[]
}

export interface TopAssumption {
  entry: MetaEntry
  result: ResolvedAssumption
  names: SetDisplayNames
}

export interface MetaView {
  readonly meta: MetaSnapshot
  readonly game: Snapshot
  /** rank 오름차순 */
  readonly ranking: readonly MetaEntry[]
  entry(id: string): MetaEntry | undefined
  name(kind: NameKind, id: string): DisplayName
}
