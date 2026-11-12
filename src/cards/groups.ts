import type { CardView, OpponentHeader } from './types'

/** 화면 한 행: 같은 상대 포켓몬(출처+id)의 카드들을 배분 선택지로 묶은 것. */
export interface CardGroup {
  /** JSON.stringify([opponent.source, opponent.id]) */
  key: string
  opponent: OpponentHeader
  /** 사용률 순 배분 선택지. 첫 항목이 기본 선택이다 */
  options: readonly CardView[]
}

export const groupKey = (opponent: OpponentHeader): string => JSON.stringify([opponent.source, opponent.id])

/** 래더: 소수 배분이 아닌 것 점유율 내림차순 → 소수 배분. 커스텀: 프리셋 순. 동률은 원래 순서. */
function compareOptions(a: CardView, b: CardView): number {
  if (a.opponent.source === 'ladder') {
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
