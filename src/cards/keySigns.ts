// 공·방 추가 배분의 키 능력치별 성격 보정 부호 규칙과, 그 부호를 만족하는 계산용 성격 고르기.
import { STAT_IDS } from '../core'
import type { NatureEntry, Snapshot, StatId } from '../data/schema'
import { natureSign } from './bundles'
import { MINUS_ORDER } from './natures'
import type { BundleStat, KeySigns } from './types'

type Sign = BundleStat['nature']
type BoostableStat = Exclude<StatId, 'hp'>

const SIGNS: readonly unknown[] = ['plus', 'neutral', 'minus']
const BOOSTABLE: readonly BoostableStat[] = ['atk', 'def', 'spa', 'spd', 'spe']

export const signOf = (signs: KeySigns | undefined, stat: StatId): Sign => signs?.[stat] ?? 'neutral'

/** 부호 규칙: 키 능력치에만, 값은 plus·neutral·minus, H는 무보정만, 상승·하락은 각각 최대 하나(한 능력치에 하나라 서로 다른 능력치다) */
export function validKeySigns(keyStats: readonly StatId[], signs: KeySigns | undefined): boolean {
  if (signs === undefined) return true
  if (typeof signs !== 'object' || signs === null) return false
  let plus = 0
  let minus = 0
  for (const name of Object.keys(signs)) {
    const stat = keyStats.find((k) => k === name)
    if (stat === undefined) return false
    const sign: unknown = signs[stat]
    if (!SIGNS.includes(sign)) return false
    if (sign === 'neutral') continue
    if (stat === 'hp') return false
    if (sign === 'plus') plus++
    else minus++
  }
  return plus <= 1 && minus <= 1
}

/** 무보정 항목을 뺀 부호(STAT_IDS 순). 전부 무보정이면 undefined */
export function normalizeKeySigns(signs: KeySigns | undefined): KeySigns | undefined {
  const out: Partial<Record<StatId, Sign>> = {}
  for (const stat of STAT_IDS) {
    const s = signOf(signs, stat)
    if (s !== 'neutral') out[stat] = s
  }
  return Object.keys(out).length === 0 ? undefined : out
}

/** 한 능력치의 부호를 바꾼다. 상승·하락을 다른 능력치에 걸면 원래 그 부호였던 능력치는 무보정이 된다(옮김). H는 바꾸지 않는다 */
export function setKeySign(signs: KeySigns | undefined, stat: StatId, next: Sign): KeySigns {
  if (stat === 'hp') return signs ?? {}
  const out: Partial<Record<StatId, Sign>> = {}
  for (const s of STAT_IDS) {
    const cur = signOf(signs, s)
    if (s === stat || cur === 'neutral' || (next !== 'neutral' && cur === next)) continue
    out[s] = cur
  }
  if (next !== 'neutral') out[stat] = next
  return out
}

const isNeutral = (n: NatureEntry): boolean => n.plus === undefined || n.plus === n.minus

/**
 * 키 능력치 부호를 정확히 만족하는 계산용 성격 id. 기준 성격(base)에서 출발한다.
 * 상승 X·하락 Y → +X/−Y. 상승만 → 하락은 키 능력치·H가 아닌 능력치(기준 성격의 하락이 그렇다면 그것, 아니면 MINUS_ORDER 순 첫 번째). 하락만도 같은 방식.
 * 둘 다 없음 → 기준 성격이 키 능력치에 보정을 주지 않으면 그대로, 주면 무보정 성격.
 * 만족하는 성격이 스냅샷에 없으면 undefined.
 */
export function natureForSigns(game: Snapshot, base: string, keyStats: readonly StatId[], signs: KeySigns | undefined): string | undefined {
  const natures = game.data.natures
  const ids = Object.keys(natures).sort()
  const cur: NatureEntry | undefined = Object.prototype.hasOwnProperty.call(natures, base) ? natures[base] : undefined
  const plus = BOOSTABLE.find((s) => signOf(signs, s) === 'plus')
  const minus = BOOSTABLE.find((s) => signOf(signs, s) === 'minus')
  if (plus === undefined && minus === undefined) {
    if (!keyStats.some((s) => natureSign(game, base, s) !== 'neutral')) return base
    return ids.find((id) => isNeutral(natures[id]))
  }
  const boosted = cur !== undefined && !isNeutral(cur)
  const free = (s: BoostableStat, other: BoostableStat | undefined): boolean => !keyStats.includes(s) && s !== other
  const pick = (own: BoostableStat | undefined, other: BoostableStat | undefined): BoostableStat | undefined =>
    own !== undefined && boosted && free(own, other) ? own : MINUS_ORDER.find((s) => free(s, other))
  const p = plus ?? pick(cur?.plus, minus)
  const m = minus ?? pick(cur?.minus, plus)
  if (p === undefined || m === undefined) return undefined
  if (cur !== undefined && cur.plus === p && cur.minus === m) return base
  return ids.find((id) => natures[id].plus === p && natures[id].minus === m)
}
