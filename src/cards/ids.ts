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
