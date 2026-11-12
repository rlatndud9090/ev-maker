// 상대 배분 묶음: 키 능력치의 (SP, 성격 보정)이 같은 보존 배분끼리 점유율을 합친다.
import { STAT_IDS, natureMultiplier } from '../core'
import type { MetaEntry } from '../data/meta-schema'
import type { Snapshot, StatId } from '../data/schema'
import { parseSpreadKey } from '../meta'
import type { BundleSpec, BundleStat, DisplayCriteria } from './types'

/** 메타 점유율은 소수 넷째 자리 값이라 합도 그 자리로 맞춰 기준 비교의 부동소수 오차를 없앤다. */
const round4 = (v: number): number => Math.round(v * 1e4) / 1e4

const byString = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

export function natureSign(game: Snapshot, natureId: string, stat: StatId): BundleStat['nature'] {
  const nature = Object.prototype.hasOwnProperty.call(game.data.natures, natureId) ? game.data.natures[natureId] : undefined
  if (!nature) return 'neutral'
  const m = natureMultiplier(nature, stat)
  return m > 1 ? 'plus' : m < 1 ? 'minus' : 'neutral'
}

/** 키 능력치만 STAT_IDS 순으로 뽑은 묶음 튜플. */
export function bundleStats(
  game: Snapshot,
  keyStats: readonly StatId[],
  nature: string,
  sp: Readonly<Record<StatId, number>>,
): BundleStat[] {
  const keys = new Set(keyStats)
  return STAT_IDS.filter((s) => keys.has(s)).map((stat) => ({ stat, sp: sp[stat], nature: natureSign(game, nature, stat) }))
}

/**
 * 묶음을 점유율 내림(동률 대표 배분 키 순)으로 정렬해, 기준 이상을 전부 낸다(상한 없음).
 * 기준 이상이 없으면 최대 묶음 1장을 minority로 낸다. 보존 배분이 없으면 빈 배열.
 */
export function bundlesOf(
  game: Snapshot,
  entry: MetaEntry,
  keyStats: readonly StatId[],
  criteria: Pick<DisplayCriteria, 'bundleShareMin'>,
): BundleSpec[] {
  const groups = new Map<string, { stats: BundleStat[]; share: number; rep: { key: string; share: number } }>()
  for (const [spreadKey, share] of entry.spreads.kept) {
    const { nature, sp } = parseSpreadKey(spreadKey)
    const stats = bundleStats(game, keyStats, nature, sp)
    const key = JSON.stringify(stats)
    const g = groups.get(key)
    if (!g) {
      groups.set(key, { stats, share, rep: { key: spreadKey, share } })
      continue
    }
    g.share += share
    if (share > g.rep.share || (share === g.rep.share && spreadKey < g.rep.key)) g.rep = { key: spreadKey, share }
  }
  const all = [...groups.entries()]
    .map(([key, g]) => ({ key, stats: g.stats, share: round4(g.share), rep: g.rep.key }))
    .sort((a, b) => b.share - a.share || byString(a.rep, b.rep))
  const toSpec = (b: (typeof all)[number], minority: boolean): BundleSpec => ({
    key: b.key,
    stats: b.stats,
    share: b.share,
    retention: entry.spreads.keptShare,
    minority,
    representativeSpread: b.rep,
  })
  const passing = all.filter((b) => b.share >= criteria.bundleShareMin)
  if (passing.length > 0) return passing.map((b) => toSpec(b, false))
  return all.length > 0 ? [toSpec(all[0], true)] : []
}
