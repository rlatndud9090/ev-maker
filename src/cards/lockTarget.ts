// 공격·방어 고정 대상의 구조 키 만들기와 계획에서 다시 찾기. 판정은 하지 않는다.
import { CoreError, CoreInputError, moveStatRefs } from '../core'
import type { StatId } from '../data/schema'
import { cardItems } from './items'
import type { CutLock, LockTargetKey } from './lock'
import type { BundleSpec, BundleStat, CardSpec, CardView, DamageTab, TabPlan } from './types'

export type DamageLockKey = Extract<LockTargetKey, { kind: 'attack' | 'defense' }>
export type LockTargetRef = { rowId: string } | { filterId: string }

const bundleKeyOf = (b: BundleSpec): DamageLockKey['bundle'] =>
  b.userAdded !== undefined ? { added: b.key } : b.presetIndex !== undefined ? { preset: b.presetIndex } : { ladder: b.key }

/** itemKey = 카드에서 고른 항목 키(items.itemKey(기술, 조건)) */
export function lockTargetKeyOf(tab: DamageTab, card: Pick<CardSpec | CardView, 'opponent' | 'category' | 'bundle' | 'berry'>, itemKey: string): DamageLockKey {
  return {
    kind: tab,
    source: card.opponent.source,
    opponentId: card.opponent.id,
    category: card.category,
    bundle: bundleKeyOf(card.bundle),
    item: card.berry?.item ?? null,
    itemKey,
  }
}

function bundleMatches(b: BundleSpec, key: DamageLockKey['bundle']): boolean {
  if ('added' in key) return b.userAdded !== undefined && b.key === key.added
  if ('preset' in key) return b.presetIndex === key.preset
  return b.userAdded === undefined && b.presetIndex === undefined && b.key === key.ladder
}

/** 그 카드에서 itemKey 항목의 행(스윕 행만) 또는 극단 필터 */
function locate(plan: TabPlan, card: CardSpec, itemKey: string): LockTargetRef | null {
  const ref = cardItems(plan, card).find((r) => r.key === itemKey)
  if (ref === undefined) return null
  const c = ref.candidate
  if (c.target === 'filter') return plan.filters[c.id] === undefined ? null : { filterId: c.id }
  if (c.target === 'row') {
    const row = plan.rows[c.id]
    return row === undefined || row.error !== undefined || row.sweep === undefined ? null : { rowId: c.id }
  }
  return null
}

/** 상대 공격 능력치(스피드 제외) — 방어 판정이 상대 묶음에서 실제로 보는 능력치 */
function offenseKeyStats(plan: TabPlan, itemKey: string): StatId[] | null {
  let moveId: unknown
  try {
    moveId = (JSON.parse(itemKey) as unknown[])[0]
  } catch {
    return null
  }
  if (typeof moveId !== 'string') return null
  try {
    const refs = moveStatRefs(plan.game, moveId)
    return refs.offense?.owner === 'self' ? refs.attackerStats.filter((s) => s !== 'spe') : []
  } catch (e) {
    if (e instanceof CoreError || e instanceof CoreInputError) return null
    throw e
  }
}

function parseStats(key: string): BundleStat[] | null {
  try {
    const v = JSON.parse(key) as unknown
    return Array.isArray(v) ? (v as BundleStat[]) : null
  } catch {
    return null
  }
}

const projection = (stats: readonly BundleStat[], keep: readonly StatId[]): string =>
  JSON.stringify(stats.filter((s) => keep.includes(s.stat)).map((s) => [s.stat, s.sp, s.nature]))

/**
 * 고정을 이 계획의 행·필터로 다시 찾는다: 같은 탭·출처·상대·분류·도구 카드 중 배분 키가 같은 카드의 같은 항목.
 * 방어 래더 고정은 배분이 없어지면 그 기술의 상대 공격 능력치만 같은 배분으로 옮기고(여럿이면 점유율 높은 쪽), 못 찾으면 null.
 */
export function findLockTarget(plan: TabPlan, lock: Pick<CutLock, 'target'>): LockTargetRef | null {
  const t = lock.target
  if (t.kind === 'speed' || t.kind !== plan.tab) return null
  const same = plan.cards.filter(
    (c) => c.state === 'ok' && c.opponent.source === t.source && c.opponent.id === t.opponentId && c.category === t.category && (c.berry?.item ?? null) === t.item,
  )
  const exact = same.find((c) => bundleMatches(c.bundle, t.bundle))
  if (exact !== undefined) return locate(plan, exact, t.itemKey)
  if (t.kind !== 'defense' || !('ladder' in t.bundle)) return null
  const keep = offenseKeyStats(plan, t.itemKey)
  const stats = parseStats(t.bundle.ladder)
  if (keep === null || stats === null) return null
  const want = projection(stats, keep)
  let best: { ref: LockTargetRef; share: number } | null = null
  for (const c of same) {
    if (c.opponent.source !== 'ladder' || projection(c.bundle.stats, keep) !== want) continue
    const ref = locate(plan, c, t.itemKey)
    const share = c.bundle.share ?? 0
    if (ref !== null && (best === null || share > best.share)) best = { ref, share }
  }
  return best?.ref ?? null
}
