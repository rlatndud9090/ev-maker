import { addedCardId, addedBundleKey } from './ids'
import type { CardView, OpponentHeader, Tab } from './types'

/** 화면 한 행: 같은 상대 포켓몬(출처+id)의 카드들을 배분 선택지로 묶은 것. */
export interface CardGroup {
  /** JSON.stringify([opponent.source, opponent.id]) */
  key: string
  opponent: OpponentHeader
  /** 배분 선택지: 사용자 추가 배분(추가 순) → 관측 배분(사용률 순) → 소수 배분 */
  options: readonly CardView[]
}

export const groupKey = (opponent: OpponentHeader): string => JSON.stringify([opponent.source, opponent.id])

/** 래더: 사용자 추가 배분(추가 순) → 소수 배분이 아닌 것 점유율 내림차순 → 소수 배분. 커스텀: 프리셋 순. 동률은 원래 순서. */
function compareOptions(a: CardView, b: CardView): number {
  if (a.opponent.source === 'ladder') {
    const ua = a.bundle.userAdded
    const ub = b.bundle.userAdded
    if (ua !== undefined || ub !== undefined) {
      if (ua === undefined) return 1
      if (ub === undefined) return -1
      if (ua !== ub) return ua - ub
      return a.order - b.order
    }
    if (a.bundle.minority !== b.bundle.minority) return a.bundle.minority ? 1 : -1
    const d = (b.bundle.share ?? 0) - (a.bundle.share ?? 0)
    if (d !== 0) return d
  } else {
    const d = (a.bundle.presetIndex ?? 0) - (b.bundle.presetIndex ?? 0)
    if (d !== 0) return d
  }
  return a.order - b.order
}

/** 정렬된 카드 목록을 포켓몬마다 한 그룹으로 묶는다. 그룹 순서는 입력에서 처음 나온 순서. */
export function groupCards(cards: readonly CardView[]): CardGroup[] {
  const byKey = new Map<string, { opponent: OpponentHeader; options: CardView[] }>()
  for (const card of cards) {
    const key = groupKey(card.opponent)
    const g = byKey.get(key)
    if (g === undefined) byKey.set(key, { opponent: card.opponent, options: [card] })
    else g.options.push(card)
  }
  // Array.prototype.sort는 안정 정렬이라 order까지 같으면 입력 순서가 남는다.
  return [...byKey].map(([key, g]) => ({ key, opponent: g.opponent, options: g.options.sort(compareOptions) }))
}

/** 기본 선택: 사용자 추가 배분이 아닌 첫 선택지(관측 배분 중 최고 점유율). 모두 사용자 추가면 첫 선택지. */
export function defaultOption(group: CardGroup): CardView {
  return group.options.find((o) => o.bundle.userAdded === undefined) ?? group.options[0]
}

/**
 * 선택 id를 그룹의 선택지로 푼다. 사용자 추가 카드 id가 선택지에 없으면(계획이 같은 키의 관측 묶음으로 합쳐
 * 사용자 카드를 만들지 않은 경우 — 관측 묶음이 나중에 나타나거나 기준을 낮춘 경우) 같은 능력치·SP의 무보정 관측 묶음을 고르고,
 * 그것도 없으면 기본 선택지로 돌아간다.
 */
export function chosenOption(group: CardGroup, tab: Tab, id: string | undefined): CardView {
  if (id === undefined) return defaultOption(group)
  const hit = group.options.find((o) => o.id === id)
  if (hit !== undefined) return hit
  const same = group.options.find(
    (o) =>
      o.opponent.source === 'ladder' &&
      o.bundle.userAdded === undefined &&
      o.bundle.stats.every((s) => s.nature === 'neutral') &&
      addedCardId(tab, o.opponent.id, o.category, addedBundleKey(o.bundle.stats)) === id,
  )
  return same ?? defaultOption(group)
}
