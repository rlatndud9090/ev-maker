// 1타 확률 → 공격·방어 관점 구간. 단건 판정과 스윕이 같은 임계값 정규화를 공유한다.
import type { AttackBand, BandThresholds, DefenseBand, SpeedOrder } from './types'
import { CoreInputError, assertKnownKeys, isPlainObject } from './errors'

export const DEFAULT_THRESHOLDS: Readonly<BandThresholds> = Object.freeze({ highRoll: 0.75, lowRoll: 0.1875 })

function ratio(v: unknown, field: string, { allowOne }: { allowOne: boolean }): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0 || v > 1 || (!allowOne && v === 1)) {
    throw new CoreInputError(field, `0 초과 ${allowOne ? '1 이하' : '1 미만'} 실수여야 한다(받은 값: ${String(v)})`)
  }
  return v
}

export function normalizeThresholds(t: Partial<BandThresholds> | undefined): BandThresholds {
  if (t === undefined) return DEFAULT_THRESHOLDS
  if (!isPlainObject(t)) throw new CoreInputError('thresholds', '객체여야 한다')
  assertKnownKeys(t, ['highRoll', 'lowRoll'], 'thresholds')
  return {
    highRoll: t.highRoll === undefined ? DEFAULT_THRESHOLDS.highRoll : ratio(t.highRoll, 'thresholds.highRoll', { allowOne: true }),
    lowRoll: t.lowRoll === undefined ? DEFAULT_THRESHOLDS.lowRoll : ratio(t.lowRoll, 'thresholds.lowRoll', { allowOne: false }),
  }
}

function chance(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) {
    throw new CoreInputError('ohkoChance', `0~1 실수여야 한다(받은 값: ${String(v)})`)
  }
  return v
}

/** 확정 1타(100%) / 고난수 1타(highRoll 이상) / 중난수 이하 */
export function attackBand(ohkoChance: number, thresholds?: Partial<BandThresholds>): AttackBand {
  const p = chance(ohkoChance)
  const t = normalizeThresholds(thresholds)
  if (p >= 1) return 'guaranteed-ohko'
  if (p >= t.highRoll) return 'high-roll-ohko'
  return 'mid-or-lower'
}

/** 확정 버팀(0%) / 저난수 1타(lowRoll 이하) / 중난수 이상 */
export function defenseBand(ohkoChance: number, thresholds?: Partial<BandThresholds>): DefenseBand {
  const p = chance(ohkoChance)
  const t = normalizeThresholds(thresholds)
  if (p <= 0) return 'guaranteed-survive'
  if (p <= t.lowRoll) return 'low-roll-ohko'
  return 'mid-or-higher'
}

export type KoSide = 'attack' | 'defense'
export type KoLabel =
  | 'guaranteed-ohko'
  | 'high-roll-ohko'
  | 'mid-low-roll-ohko'
  | 'mid-high-roll-ohko'
  | 'low-roll-ohko'
  | 'guaranteed-survive'

/**
 * 1타 확률 → 카드 결과 배지 라벨(구간과 별개인 표시용 6단).
 * 공격(내가 때림): 1 / highRoll 이상 / 그 아래 / 0. 방어(상대가 때림): 1 / lowRoll 초과 / lowRoll 이하 / 0.
 */
export function koLabel(side: KoSide, ohkoChance: number, thresholds?: Partial<BandThresholds>): KoLabel {
  if (side !== 'attack' && side !== 'defense') throw new CoreInputError('side', `attack 또는 defense여야 한다(받은 값: ${String(side)})`)
  const p = chance(ohkoChance)
  const t = normalizeThresholds(thresholds)
  if (p >= 1) return 'guaranteed-ohko'
  if (p <= 0) return 'guaranteed-survive'
  if (side === 'attack') return p >= t.highRoll ? 'high-roll-ohko' : 'mid-low-roll-ohko'
  return p > t.lowRoll ? 'mid-high-roll-ohko' : 'low-roll-ohko'
}

export type JudgementSide = KoSide | 'speed'

/** 판정의 나쁨 → 좋음 순서(사용자 관점). 공격·방어는 koLabel 4단, 스피드는 행동 순서. */
export const JUDGEMENT_ORDER: Readonly<{ attack: readonly KoLabel[]; defense: readonly KoLabel[]; speed: readonly SpeedOrder[] }> = Object.freeze({
  attack: Object.freeze(['guaranteed-survive', 'mid-low-roll-ohko', 'high-roll-ohko', 'guaranteed-ohko'] as const),
  defense: Object.freeze(['guaranteed-ohko', 'mid-high-roll-ohko', 'low-roll-ohko', 'guaranteed-survive'] as const),
  speed: Object.freeze(['second', 'tie', 'first'] as const),
})

function orderOf(side: JudgementSide): readonly string[] {
  if (side !== 'attack' && side !== 'defense' && side !== 'speed') {
    throw new CoreInputError('side', `attack·defense·speed 중 하나여야 한다(받은 값: ${String(side)})`)
  }
  return JUDGEMENT_ORDER[side]
}

/** 0 = 가장 나쁨. 그 관점에 없는 판정은 CoreInputError */
export function judgementRank(side: JudgementSide, label: string): number {
  const i = orderOf(side).indexOf(label)
  if (i < 0) throw new CoreInputError('label', `${side} 판정이 아니다(받은 값: ${String(label)})`)
  return i
}

/** 한 단계 위 판정. 이미 최상위면 null */
export function nextBetter(side: JudgementSide, label: string): string | null {
  return orderOf(side)[judgementRank(side, label) + 1] ?? null
}

/** 1타 확률 분모(16단계 난수). 5단 판정의 기준 n은 1~ROLL_DENOMINATOR−1 정수다 */
export const ROLL_DENOMINATOR = 16

export type RollTier = 'guaranteed-ohko' | 'high-roll-ohko' | 'mid-roll-ohko' | 'low-roll-ohko' | 'guaranteed-survive'

/** 5단 판정 기준 n 검증(1~ROLL_DENOMINATOR−1 정수) */
export function normalizeRollSteps(steps: unknown): number {
  if (typeof steps !== 'number' || !Number.isInteger(steps) || steps < 1 || steps > ROLL_DENOMINATOR - 1) {
    throw new CoreInputError('rollSteps', `1~${ROLL_DENOMINATOR - 1} 정수여야 한다(받은 값: ${String(steps)})`)
  }
  return steps
}

/**
 * 1타 확률 → 5단 판정. 1 / n/16 이상 / 그 사이 / (16−n)/16 이하 / 0.
 * n ≤ 8이라 두 경계가 겹치면 고난수가 우선한다(p ≥ n/16이면 고난수, 아니고 p ≤ (16−n)/16이면 저난수).
 */
export function rollTier(ohkoChance: number, steps: number): RollTier {
  const p = chance(ohkoChance)
  const n = normalizeRollSteps(steps)
  if (p >= 1) return 'guaranteed-ohko'
  if (p <= 0) return 'guaranteed-survive'
  if (p >= n / ROLL_DENOMINATOR) return 'high-roll-ohko'
  if (p <= (ROLL_DENOMINATOR - n) / ROLL_DENOMINATOR) return 'low-roll-ohko'
  return 'mid-roll-ohko'
}

/** 5단 판정의 나쁨 → 좋음 순서(사용자 관점). 공격은 확정1타가 최선, 방어는 확정견딤이 최선, 스피드는 행동 순서. */
export const TIER_ORDER: Readonly<{ attack: readonly RollTier[]; defense: readonly RollTier[]; speed: readonly SpeedOrder[] }> = Object.freeze({
  attack: Object.freeze(['guaranteed-survive', 'low-roll-ohko', 'mid-roll-ohko', 'high-roll-ohko', 'guaranteed-ohko'] as const),
  defense: Object.freeze(['guaranteed-ohko', 'high-roll-ohko', 'mid-roll-ohko', 'low-roll-ohko', 'guaranteed-survive'] as const),
  speed: Object.freeze(['second', 'tie', 'first'] as const),
})

function tierOrderOf(side: JudgementSide): readonly string[] {
  if (side !== 'attack' && side !== 'defense' && side !== 'speed') {
    throw new CoreInputError('side', `attack·defense·speed 중 하나여야 한다(받은 값: ${String(side)})`)
  }
  return TIER_ORDER[side]
}

/** TIER_ORDER 순위(0 = 가장 나쁨). 그 관점에 없는 판정은 CoreInputError */
export function tierRank(side: JudgementSide, label: string): number {
  const i = tierOrderOf(side).indexOf(label)
  if (i < 0) throw new CoreInputError('label', `${side} 5단 판정이 아니다(받은 값: ${String(label)})`)
  return i
}

/** 5단 판정의 한 단계 위. 이미 최상위면 null */
export function nextBetterTier(side: JudgementSide, label: string): string | null {
  return tierOrderOf(side)[tierRank(side, label) + 1] ?? null
}
