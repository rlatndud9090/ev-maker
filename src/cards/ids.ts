// 카드·행·프리셋 키. 서로 다른 조합이 같은 문자열이 되지 않게 라벨을 잇지 않고 튜플을 직렬화한다.
import type { Category, PresetIndex, Tab } from './types'

type Part = string | number | null

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

/** 사용자 추가 배분의 묶음 키(성격 보정은 늘 neutral). stats는 키 능력치 STAT_IDS 순. */
export function addedBundleKey(stats: readonly { stat: string; sp: number }[]): string {
  return JSON.stringify(stats.map((s) => ({ stat: s.stat, sp: s.sp, nature: 'neutral' })))
}

/** 사용자 추가 배분 카드 id: 관측 묶음 카드 id 뒤에 'user' 표지를 붙여 같은 키의 관측 카드와 겹치지 않는다. */
export function addedCardId(tab: Tab, opponentId: string, category: Category | null, bundleKey: string): string {
  return cardId([tab, 'ladder', opponentId, category, bundleKey, 'user'])
}

/** 화면이 추가 직후(계산이 끝나기 전) 그 카드를 미리 고를 때 쓰는 id. 계획(plan)과 같은 규칙이다. */
export function addedBundleCardId(added: { tab: Tab; opponentId: string; category: Category | null }, stats: readonly { stat: string; sp: number }[]): string {
  return addedCardId(added.tab, added.opponentId, added.category, addedBundleKey(stats))
}
