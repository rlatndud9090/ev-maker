// 계산 코어 도메인 계약. 코어 함수는 로드된 Snapshot을 명시 인자로 받는 동기 순수 함수다.
import type { MoveCategory, StatId, StatTable } from '../data/schema'

export type SpTable = StatTable
export type BoostTable = Partial<Record<Exclude<StatId, 'hp'>, number>>
export type Status = 'none' | 'par' | 'brn' | 'psn' | 'tox' | 'slp' | 'frz'

export interface PokemonSet {
  /** 스냅샷 매니페스트의 regulation.id와 같아야 한다. */
  regulation: string
  /** 원종 species id(메가 폼 id가 아니다). */
  species: string
  ability: string
  item?: string
  nature: string
  sp: SpTable
  moves: string[]
  /** true면 item의 메가스톤으로 메가 폼을 해석한다. */
  mega?: boolean
  status?: Status
  boosts?: BoostTable
  /** 현재 HP(생략 시 가득). */
  curHp?: number
}

export type GameType = 'Doubles' | 'Singles'
export type Weather = 'none' | 'Sun' | 'Rain' | 'Sand' | 'Snow'
export type Terrain = 'none' | 'Electric' | 'Grassy' | 'Psychic' | 'Misty'

export interface SideConditions {
  tailwind?: boolean
  helpingHand?: boolean
  friendGuard?: boolean
  reflect?: boolean
  lightScreen?: boolean
  /** 총대장 등에 쓰는 쓰러진 아군 수 */
  alliesFainted?: number
}

export interface BattleConditions {
  /** 기본 Doubles */
  gameType?: GameType
  weather?: Weather
  terrain?: Terrain
  attacker?: SideConditions
  defender?: SideConditions
  critical?: boolean
  /** 범위기의 실제 대상 수(더블). 기본 2. */
  spreadTargets?: 1 | 2
  /** 가변 타수 기술의 타수 지정 */
  hits?: number
}

export type CoreErrorCode =
  | 'REGULATION_MISMATCH'
  | 'UNKNOWN_SPECIES'
  | 'UNKNOWN_MOVE'
  | 'UNKNOWN_ITEM'
  | 'UNKNOWN_ABILITY'
  | 'UNKNOWN_NATURE'
  | 'ILLEGAL_ABILITY'
  | 'ILLEGAL_MOVE'
  | 'INVALID_SP'
  | 'SP_TOTAL_EXCEEDED'
  | 'INVALID_MEGA'
  | 'ENGINE_UNSUPPORTED'

export interface CoreErrorDetail {
  code: CoreErrorCode
  message: string
  /** 위반한 필드(예: 'sp.atk', 'item') */
  field?: string
}

/** 입력 검증 실패. 프로그램 예외가 아니라 이유가 담긴 도메인 오류다. */
export class CoreError extends Error {
  readonly details: CoreErrorDetail[]
  constructor(details: CoreErrorDetail[]) {
    super(details.map((d) => d.message).join('; '))
    this.name = 'CoreError'
    this.details = details
  }
}

export type AttackBand = 'mid-or-lower' | 'high-roll-ohko' | 'guaranteed-ohko'
export type DefenseBand = 'mid-or-higher' | 'low-roll-ohko' | 'guaranteed-survive'

export interface BandThresholds {
  /** 고난수 1타 하한(이상), 기본 0.75 */
  highRoll: number
  /** 저난수 1타 상한(이하), 기본 0.1875 */
  lowRoll: number
}

export interface DamageResultOk {
  kind: 'damage'
  /** 타별 16단계 난수 배열(타수 × 16) */
  rolls: number[][]
  hits: number
  /** 합계 분포의 최소·최대 대미지 */
  min: number
  max: number
  defenderHp: number
  minPercent: number
  maxPercent: number
  /** 그 기술 1회로 쓰러질 확률(0~1) */
  ohkoChance: number
  attackBand: AttackBand
  defenseBand: DefenseBand
  /** 계산에 쓴 메가 해석 결과 등 */
  attackerSpecies: string
  defenderSpecies: string
  /** 메가진화로 바뀌기 전 세트 특성 */
  attackerSetAbility: string
  defenderSetAbility: string
  attackerAbility: string
  defenderAbility: string
}

export interface DamageResultStatus {
  kind: 'status'
}

export interface DamageResultImmune {
  kind: 'immune'
}

export type DamageResult = DamageResultOk | DamageResultStatus | DamageResultImmune

export type SpeedOrder = 'first' | 'tie' | 'second'

export interface SpeedResult {
  attackerSpeed: number
  defenderSpeed: number
  order: SpeedOrder
  /** 각 측 첫 기술의 우선도(별도 정보) */
  attackerPriority?: number
  defenderPriority?: number
}

export type OutspeedResult =
  | { kind: 'ok'; sp: number }
  | { kind: 'impossible' }
  | { kind: 'over-budget'; sp: number; remaining: number }

/** 단건 판정·세트 검증 평가 옵션. 기본값은 모두 꺼짐(기존 동작). */
export interface EvalOptions {
  /** true면 SP 합계 상한 검사만 건너뛴다(능력치별 0~최대·합법성 검사는 그대로). */
  ignoreSpTotal?: boolean
}

/** 스윕 옵션. 기본값은 꺼짐(예산 밖 칸은 kind: 'over-budget'). */
export interface SweepOptions {
  /** true면 예산 밖 칸도 판정하고 overBudget: true를 단다. 경계 계산에 포함된다. */
  judgeOverBudget?: boolean
}

export type SweepCell<T> =
  | { sp: number; kind: 'ok'; value: T; category: string; overBudget?: true }
  | { sp: number; kind: 'over-budget' }

export interface SweepResult<T> {
  cells: SweepCell<T>[]
  /** 구간이 바뀌는 SP(경계 − 1과 구간이 다른 SP) */
  boundaries: number[]
}

/** 기술이 실제로 참조하는 능력치(엔진 판별 그대로). */
export interface MoveStatRefs {
  moveId: string
  category: MoveCategory
  /** 변화기면 null. owner 'self' = 기술 사용자, 'target' = 대상(속임수) */
  offense: { owner: 'self' | 'target'; stat: 'atk' | 'spa' | 'def' } | null
  /** 변화기면 null. 사이코쇼크는 'def' */
  defense: 'def' | 'spd' | null
  /** 셸암즈처럼 분류가 능력치에 따라 바뀌는 기술 */
  categoryVaries: boolean
  /** 양쪽 스피드가 위력에 들어가는 기술(엔진 SPEED_DEPENDENT_MOVES). 관여 능력치 S 판정의 기술 쪽 근거 */
  speedDependent: boolean
  /** 대미지가 의존하는 사용자 능력치. 예: 바디프레스 ['def'], 목숨걸기 ['hp'] */
  attackerStats: readonly StatId[]
  /** 대미지가 의존하는 대상 능력치. 'hp' 항상 포함, 속임수면 'atk' 포함 */
  defenderStats: readonly StatId[]
}
