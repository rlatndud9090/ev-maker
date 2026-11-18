// 배분 추가 판정 질의: 화면 표시와 같은 씨앗·배지 함수로 표시 중인 배분 키를 구해 추가 가능 여부를 가른다.
import { STAT_IDS } from '../core'
import type { StatId } from '../data/schema'
import type { MetaView } from '../meta'
import { bundlesOf } from './bundles'
import { addedBundleKey } from './ids'
import { opponentSeeds } from './plan'
import { isInRange } from './range'
import { customSpeedOpponent, ladderSpeedOpponent, speedKey, type NatureSign, type SpeedChartInput } from './speedChart'
import { isSpValue } from './spValue'
import type { BundleStat, CardFilters, CardInput, Category, CustomTarget, DamageTab, TargetSource } from './types'

export type TargetStatus = 'meta' | 'out-of-range' | 'added' | 'new'

export interface AdditionTarget {
  source: TargetSource
  id: string
}

/** 메타 항목이면 범위 안('meta')·밖('out-of-range'), 아니면 목록 밖 타겟에 있으면 'added', 그 밖은 'new' */
export function targetStatus(view: MetaView, filters: CardFilters, customTargets: readonly CustomTarget[], rosterId: string): TargetStatus {
  const entry = view.entry(rosterId)
  if (entry !== undefined) return isInRange(view, filters, entry.id) ? 'meta' : 'out-of-range'
  return customTargets.some((t) => t.rosterId === rosterId) ? 'added' : 'new'
}

/** 메타 항목이면 래더(메타 항목 id), 아니면 목록 밖(rosterId) */
export function additionTargetOf(view: MetaView, rosterId: string): AdditionTarget {
  const entry = view.entry(rosterId)
  return entry !== undefined ? { source: 'ladder', id: entry.id } : { source: 'custom', id: rosterId }
}

export type UnavailableReason = 'not-found' | 'my-set-error' | 'no-my-attack-moves' | 'no-opponent-moves' | 'no-key-stats' | 'speed-unsupported'

export type AdditionVerdict = { kind: 'ok' } | { kind: 'duplicate' } | { kind: 'invalid' } | { kind: 'unavailable'; reason: UnavailableReason }

export type ObservedState = 'addable' | 'shown' | 'boosted'

const NATURE_SIGNS: readonly NatureSign[] = ['plus', 'neutral', 'minus']
const SPE_KEY: readonly ['spe'] = ['spe']

export interface SpeedObserved {
  sp: number
  nature: NatureSign
  share: number
  speed: number
  state: 'addable' | 'shown'
}

export type SpeedAdditionQuery =
  | { kind: 'ok'; shownKeys: ReadonlySet<string>; observed: readonly SpeedObserved[]; defaultValue: { sp: number; nature: NatureSign } }
  | { kind: 'unavailable'; reason: UnavailableReason }

/** 목록 밖 타겟 해석: 스피드 차트·탭 계획과 같이 메타 항목과 겹치거나 기술이 없으면 대상이 아니다 */
function customTargetOf(view: MetaView, customTargets: readonly CustomTarget[], rosterId: string): { target: CustomTarget; order: number } | undefined {
  const order = customTargets.findIndex((t) => t.rosterId === rosterId)
  const target = customTargets[order]
  if (target === undefined || view.entry(rosterId) !== undefined || target.moves.length === 0) return undefined
  return { target, order }
}

/**
 * 스피드 탭 판정 질의. shownKeys = 차트 위 기본·추가 배지(조건 배지 제외)의 speedKey. 범위 밖 래더 상대는 추가 배지만 친다.
 * observed(래더만) = 점유율 기준 이상(minority 아님) S 묶음, 점유율 내림차순.
 * defaultValue = 래더 1위 묶음(범위 밖이어도) 또는 목록 밖 프리셋 1의 (S SP, S 보정 부호).
 */
export function speedAdditionQuery(input: SpeedChartInput, bundleShareMin: number, target: AdditionTarget): SpeedAdditionQuery {
  const { game, view } = input
  if (target.source === 'ladder') {
    const entry = view.entry(target.id)
    if (entry === undefined) return { kind: 'unavailable', reason: 'not-found' }
    const r = ladderSpeedOpponent(input, entry, !isInRange(view, input.filters, entry.id))
    if (r.kind === 'none') return { kind: 'unavailable', reason: 'speed-unsupported' }
    const passing = new Set(
      bundlesOf(game, entry, SPE_KEY, { bundleShareMin })
        .filter((b) => !b.minority && (b.share ?? 0) >= bundleShareMin)
        .map((b) => speedKey(b.stats[0].sp, b.stats[0].nature)),
    )
    const observed = r.options
      .filter((o) => passing.has(speedKey(o.sp, o.nature)))
      .sort((a, b) => b.share - a.share)
      .map((o): SpeedObserved => ({ sp: o.sp, nature: o.nature, share: o.share, speed: o.speed, state: r.shownKeys.has(speedKey(o.sp, o.nature)) ? 'shown' : 'addable' }))
    return { kind: 'ok', shownKeys: r.shownKeys, observed, defaultValue: { sp: r.top.sp, nature: r.top.nature } }
  }
  const found = customTargetOf(view, input.customTargets, target.id)
  if (found === undefined) return { kind: 'unavailable', reason: 'not-found' }
  const r = customSpeedOpponent(input, found.target, found.order)
  const first = r.badges.find((b) => b.presetIndex === 0 && b.condition.kind === 'none')
  if (first === undefined) return { kind: 'unavailable', reason: 'speed-unsupported' }
  return { kind: 'ok', shownKeys: r.shownKeys, observed: [], defaultValue: { sp: first.bundle.sp, nature: first.bundle.nature } }
}

/** 판정 순서: unavailable → invalid(SP 0~spMax 정수, 부호 plus·neutral·minus) → duplicate(표시 중 키) → ok */
export function judgeSpeedAddition(q: SpeedAdditionQuery, sp: number, nature: NatureSign, spMax: number): AdditionVerdict {
  if (q.kind === 'unavailable') return { kind: 'unavailable', reason: q.reason }
  if (!isSpValue(sp, spMax) || !NATURE_SIGNS.includes(nature)) return { kind: 'invalid' }
  if (q.shownKeys.has(speedKey(sp, nature))) return { kind: 'duplicate' }
  return { kind: 'ok' }
}

export interface DamageObserved {
  stats: readonly BundleStat[]
  share?: number
  state: ObservedState
}

export interface DamageCategoryQuery {
  category: Category
  keyStats: readonly StatId[]
  /** 그 분류에서 탭 계획이 만드는 기본 카드(도구 변형 제외)의 묶음 키 */
  shownKeys: ReadonlySet<string>
  /** 래더만: 점유율 기준 이상 관측 묶음 */
  observed: readonly DamageObserved[]
  defaultSp: Partial<Record<StatId, number>>
}

export type DamageAdditionQuery = { kind: 'ok'; categories: readonly DamageCategoryQuery[] } | { kind: 'unavailable'; reason: UnavailableReason }

/** 관측 줄 상태 판정 순서: 표시 중(shown) → 키 능력치에 성격 보정(boosted) → 추가 가능(addable) */
export function observedState(bundle: { key: string; stats: readonly BundleStat[] }, shownKeys: ReadonlySet<string>): ObservedState {
  if (shownKeys.has(bundle.key)) return 'shown'
  if (bundle.stats.some((s) => s.nature !== 'neutral')) return 'boosted'
  return 'addable'
}

/** 공·방 탭 판정 질의. 분류·키 능력치·표시 키는 탭 계획과 같은 씨앗 함수(opponentSeeds)에서 온다. 키 능력치가 빈 분류는 뺀다 */
export function damageAdditionQuery(input: CardInput, tab: DamageTab, target: AdditionTarget): DamageAdditionQuery {
  const r = opponentSeeds(input, tab, target)
  if (r.kind !== 'ok') return { kind: 'unavailable', reason: r.kind }
  if (r.categories.length === 0) return { kind: 'unavailable', reason: tab === 'attack' ? 'no-my-attack-moves' : 'no-opponent-moves' }
  const categories = r.categories
    .filter((c) => c.keyStats.length > 0)
    .map((c): DamageCategoryQuery => {
      const shownKeys = new Set(c.cards.map((b) => b.key))
      const observed =
        target.source === 'ladder'
          ? c.observed.map((b): DamageObserved => (b.share === undefined ? { stats: b.stats, state: observedState(b, shownKeys) } : { stats: b.stats, share: b.share, state: observedState(b, shownKeys) }))
          : []
      const defaultSp: Partial<Record<StatId, number>> = {}
      for (const s of c.keyStats) defaultSp[s] = c.baseSp[s]
      return { category: c.category, keyStats: c.keyStats, shownKeys, observed, defaultSp }
    })
  if (categories.length === 0) return { kind: 'unavailable', reason: 'no-key-stats' }
  return { kind: 'ok', categories }
}

/** 판정 순서: invalid(sp 키 집합 = 키 능력치, 값 0~spMax 정수) → duplicate(무보정 묶음 키가 표시 중) → ok */
export function judgeDamageAddition(q: DamageCategoryQuery, sp: Readonly<Partial<Record<StatId, number>>>, spMax: number): AdditionVerdict {
  const keys = new Set<string>(q.keyStats)
  const given = Object.keys(sp)
  if (given.length !== keys.size || !given.every((k) => keys.has(k))) return { kind: 'invalid' }
  const stats: { stat: StatId; sp: number }[] = []
  for (const stat of STAT_IDS) {
    if (!keys.has(stat)) continue
    const v = sp[stat]
    if (!isSpValue(v, spMax)) return { kind: 'invalid' }
    stats.push({ stat, sp: v })
  }
  if (q.shownKeys.has(addedBundleKey(stats))) return { kind: 'duplicate' }
  return { kind: 'ok' }
}
