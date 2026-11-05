// 실능치 공식의 단일 원천(레벨 50 고정, IV 없음). 스피드·표시·스윕·엔진 대조가 모두 이 값을 쓴다.
import type { NatureEntry, StatId, StatTable } from '../data/schema'
import { CoreInputError } from './errors'

export const STAT_IDS: readonly StatId[] = ['hp', 'atk', 'def', 'spa', 'spd', 'spe']

export type NatureMultiplier = 0.9 | 1 | 1.1
const TENTHS: Record<NatureMultiplier, number> = { 0.9: 9, 1: 10, 1.1: 11 }

export function natureMultiplier(nature: NatureEntry, stat: StatId): NatureMultiplier {
  if (stat === 'hp' || nature.plus === nature.minus) return 1
  if (nature.plus === stat) return 1.1
  if (nature.minus === stat) return 0.9
  return 1
}

/** HP = 종족값 + SP + 75(종족값 1이면 1). 그 외 = ⌊(종족값 + SP + 20) × 성격보정⌋. */
export function statValue(stat: StatId, base: number, sp: number, mult: NatureMultiplier = 1): number {
  if (!Number.isInteger(base) || base < 1) throw new CoreInputError('base', `양의 정수여야 한다(받은 값: ${base})`)
  if (!Number.isInteger(sp) || sp < 0) throw new CoreInputError('sp', `0 이상 정수여야 한다(받은 값: ${sp})`)
  const tenths = TENTHS[mult]
  if (tenths === undefined) throw new CoreInputError('mult', `0.9|1|1.1 중 하나여야 한다(받은 값: ${mult})`)
  if (stat === 'hp') return base === 1 ? 1 : base + sp + 75
  // 부동소수 곱 대신 정수 비율로 내림한다(×1.1 → ×11/10).
  return Math.floor(((base + sp + 20) * tenths) / 10)
}

export function statTable(baseStats: StatTable, nature: NatureEntry, sp: StatTable): StatTable {
  const out = {} as StatTable
  for (const s of STAT_IDS) out[s] = statValue(s, baseStats[s], sp[s], natureMultiplier(nature, s))
  return out
}
