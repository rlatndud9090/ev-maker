import { STAT_IDS, type SpTable } from '../core'
import type { StatId } from '../data/schema'

/** SP 합이 total을 넘으면 키 밖 능력치에서 큰 것부터(동률 STAT_IDS 순) 덜어 낸다(제자리 수정). */
export function trimSp(sp: SpTable, keys: ReadonlySet<StatId>, total: number): void {
  let over = STAT_IDS.reduce((a, s) => a + sp[s], 0) - total
  const others = STAT_IDS.filter((s) => !keys.has(s))
  while (over > 0) {
    const s = others.reduce<StatId | undefined>((best, x) => (sp[x] > 0 && (best === undefined || sp[x] > sp[best]) ? x : best), undefined)
    if (s === undefined) return
    const cut = Math.min(over, sp[s])
    sp[s] -= cut
    over -= cut
  }
}
