// 내 세트 SP 상한(슬라이더·숫자 입력·−/+·리듀서 공통)과 고정 초과 자동 조정.
import { STAT_IDS } from '../core'
import type { LockDerivation } from '../cards'
import type { StatId } from '../data/schema'
import type { LockTrim } from './state'

export interface SpRules {
  spTotal: number
  spMaxPerStat: number
}

/** 고정 능력치 → 기준 갈래 고정 SP. 여기 있는 능력치는 초안 값 대신 이 값으로 센다 */
export type LockedSp = Readonly<Partial<Record<StatId, number>>>

/** 정수가 아닌 SP(빈 칸·소수)는 0으로 센다 */
const spOrZero = (v: number): number => (Number.isInteger(v) ? v : 0)

/**
 * stat에 넣을 수 있는 최대 SP = min(능력치당 상한, max(현재 값, 합계 상한 − 다른 능력치 합)). 이미 초과면 현재 값에서 멈춘다(줄이기만 된다).
 * 정수가 아닌 칸(빈 칸·소수)은 자기 칸이든 다른 칸이든 0으로 센다. 다른 칸을 비워 둔 채 채워도 합계 상한을 넘기지 못한다(R18).
 */
export function spLimit(stat: StatId, sp: Readonly<Record<StatId, number>>, rules: SpRules, lockedSp: LockedSp | null): number {
  const { spTotal, spMaxPerStat } = rules
  const others = STAT_IDS.reduce((a, k) => (k === stat ? a : a + spOrZero(lockedSp?.[k] ?? sp[k])), 0)
  return Math.min(spMaxPerStat, Math.max(spOrZero(sp[stat]), spTotal - others))
}

/** value를 0..spLimit 정수 범위로 자른다 */
export const clampSp = (stat: StatId, value: number, sp: Readonly<Record<StatId, number>>, rules: SpRules, lockedSp: LockedSp | null): number =>
  Math.max(0, Math.min(value, spLimit(stat, sp, rules, lockedSp)))

/** 파생의 기준 갈래 고정 SP(활성 고정 능력치만, 갈래 값이 없으면 0). 기준 갈래가 없으면 null */
export function baseLockedSp(derivation: LockDerivation | null): LockedSp | null {
  const base = derivation?.branches.find((b) => b.id === derivation.baseId)
  if (derivation === null || base === undefined) return null
  return Object.fromEntries(derivation.lockedStats.map((s) => [s, base.lockedSp[s] ?? 0]))
}

/**
 * 고정 밖 능력치를 H→A→B→C→D→S 순서로 0을 향해 줄여 합계(고정 능력치는 lockedSp 값)를 spTotal에 맞춘다. 줄인 능력치만 돌려준다.
 * lockedSp에 없는 능력치가 고정 밖이다. 합을 알 수 없으면(숫자가 아닌 칸) 줄이지 않는다.
 */
export function fitUnlocked(sp: Readonly<Record<StatId, number>>, spTotal: number, lockedSp: LockedSp): LockTrim[] {
  const valueOf = (s: StatId) => lockedSp[s] ?? sp[s]
  let over = STAT_IDS.reduce((a, s) => a + valueOf(s), 0) - spTotal
  if (!Number.isFinite(over)) return []
  const trims: LockTrim[] = []
  for (const stat of STAT_IDS) {
    if (over <= 0) break
    if (lockedSp[stat] !== undefined || sp[stat] <= 0) continue
    const to = Math.max(0, sp[stat] - over)
    trims.push({ stat, from: sp[stat], to })
    over -= sp[stat] - to
  }
  return trims
}
