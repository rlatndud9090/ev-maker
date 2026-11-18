// 카드·행·프리셋 키. 서로 다른 조합이 같은 문자열이 되지 않게 라벨을 잇지 않고 튜플을 직렬화한다.
import { STAT_IDS } from '../core'
import type { StatId } from '../data/schema'
import type { AddedBundle, BundleStat, Category, PinnedBundle, PresetIndex, SpeedAddedBundle, Tab, TargetSource } from './types'

type Part = string | number | null

/** 성묘: 기본 조건 대신 쓰러진 아군 1·2·3(위력 100·150·200) 조건 항목만 둔다(위력 50 항목 없음). 랭크 후 항목은 1기절 기준 */
export const LAST_RESPECTS = 'lastrespects'
export const LAST_RESPECTS_FAINTS: readonly number[] = [1, 2, 3]
export const faintConditionId = (fainted: number): string => JSON.stringify(['faint', fainted])

export function cardId(parts: readonly Part[]): string {
  return JSON.stringify(parts)
}

/** 카드 id를 첫 원소로 둔 튜플이라 다른 카드의 행과 겹치지 않는다. */
export function rowId(cardId: string, parts: readonly Part[]): string {
  return JSON.stringify([cardId, ...parts])
}

export function presetKey(tab: Tab, category: Category | null, preset: PresetIndex): string {
  return JSON.stringify([tab, category, preset])
}

/** 사용자 추가 배분의 묶음 키(성격 보정은 늘 neutral). 입력 stats 순서와 무관하게 STAT_IDS 순으로 직렬화한다(관측 묶음 키와 같은 순서) */
export function addedBundleKey(stats: readonly { stat: StatId; sp: number }[]): string {
  const ordered = STAT_IDS.flatMap((stat) => stats.filter((s) => s.stat === stat))
  return JSON.stringify(ordered.map((s) => ({ stat: s.stat, sp: s.sp, nature: 'neutral' })))
}

/** 사용자 추가 배분의 동일성 키: (탭, 출처, 상대, 분류, STAT_IDS 순 {stat, sp, nature}) 튜플. 입력 stats 순서와 무관하다 */
export function bundleIdentity(b: { tab: Tab; source: TargetSource; opponentId: string; category: Category | null; stats: readonly BundleStat[] }): string {
  const stats = STAT_IDS.flatMap((stat) => b.stats.filter((s) => s.stat === stat).map((s) => ({ stat: s.stat, sp: s.sp, nature: s.nature })))
  return JSON.stringify([b.tab, b.source, b.opponentId, b.category, stats])
}

/** 직접 추가 배분의 키 능력치 SP(STAT_IDS 순) */
const addedStats = (added: AddedBundle): { stat: BundleStat['stat']; sp: number }[] =>
  STAT_IDS.flatMap((stat) => {
    const sp = added.sp[stat]
    return sp === undefined ? [] : [{ stat, sp }]
  })

export const addedBundleIdentity = (a: AddedBundle): string =>
  bundleIdentity({ tab: a.tab, source: a.source, opponentId: a.opponentId, category: a.category, stats: addedStats(a).map((s) => ({ ...s, nature: 'neutral' })) })

export const speedBundleIdentity = (b: SpeedAddedBundle): string =>
  bundleIdentity({ tab: 'speed', source: b.source, opponentId: b.opponentId, category: null, stats: [{ stat: 'spe', sp: b.sp, nature: b.nature }] })

/**
 * 사용자 추가 배분 카드 id: 관측 묶음 카드 id 뒤에 'user' 표지를 붙여 같은 키의 관측 카드와 겹치지 않는다.
 * 반감열매 변형 카드(berry = 열매 id)는 뒤에 그 열매를 붙인다(같은 직접 추가 배분이 기본 행·열매 행에 함께 생긴다).
 */
export function addedCardId(tab: Tab, source: TargetSource, opponentId: string, category: Category | null, bundleKey: string, berry?: string): string {
  return cardId(berry === undefined ? [tab, source, opponentId, category, bundleKey, 'user'] : [tab, source, opponentId, category, bundleKey, 'user', berry])
}

/** 직접 추가 배분의 고정 항목(키 = 그 배분 카드의 묶음 키: 키 능력치 STAT_IDS 순, 무보정) */
export function addedBundlePin(added: AddedBundle): PinnedBundle {
  return { tab: added.tab, source: added.source, opponentId: added.opponentId, category: added.category, key: addedBundleKey(addedStats(added)) }
}

/** 같은 (탭, 출처, 상대, 분류, 묶음 키, 반감열매 행) 고정인지 */
export const samePin = (a: PinnedBundle, b: PinnedBundle): boolean =>
  a.tab === b.tab &&
  a.source === b.source &&
  a.opponentId === b.opponentId &&
  a.category === b.category &&
  a.key === b.key &&
  (a.item ?? null) === (b.item ?? null)

/** 화면이 추가 직후(계산이 끝나기 전) 그 카드를 미리 고를 때 쓰는 id. 계획(plan)과 같은 규칙이다. */
export function addedBundleCardId(
  added: { tab: Tab; source: TargetSource; opponentId: string; category: Category | null },
  stats: readonly { stat: StatId; sp: number }[],
  berry?: string,
): string {
  return addedCardId(added.tab, added.source, added.opponentId, added.category, addedBundleKey(stats), berry)
}
