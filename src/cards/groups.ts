import { addedCardId, addedBundleKey, samePin } from './ids'
import type { BerryVariant, CardView, ItemView, OpponentHeader, PinnedBundle, Tab } from './types'

/** 화면 한 행: 같은 상대 포켓몬(출처+id)·같은 반감열매 변형의 카드들을 배분 선택지로 묶은 것. */
export interface CardGroup {
  /** JSON.stringify([opponent.source, opponent.id]), 반감열매 행은 JSON.stringify([source, id, 열매 id]) */
  key: string
  opponent: OpponentHeader
  /** 반감열매 행(공격 탭)이면 그 열매 */
  berry?: BerryVariant
  /** 배분 선택지: 고정 배분(고정한 순) → 관측 배분(사용률 순) → 소수 배분 */
  options: readonly CardView[]
  /** 고정된 선택지 카드 id(options 순). 직접 추가 배분은 늘 고정이다 */
  pinned: readonly string[]
}

export const groupKey = (opponent: OpponentHeader, berry?: string): string =>
  JSON.stringify(berry === undefined ? [opponent.source, opponent.id] : [opponent.source, opponent.id, berry])


/** 화면 배분 카드 → 그 카드의 고정 항목(래더만 고정할 수 있다). 반감열매 행 고정은 그 열매를 담아 기본 행 고정과 따로다 */
export function pinOf(tab: Tab, card: CardView): PinnedBundle {
  const pin: PinnedBundle = { tab, opponentId: card.opponent.id, category: card.category, key: card.bundle.key }
  if (card.berry !== undefined) pin.item = card.berry.item
  return pin
}

/** 고정 없이: 래더는 사용자 추가 배분(추가 순) → 소수 배분이 아닌 것 점유율 내림차순 → 소수 배분. 커스텀: 프리셋 순. 동률은 원래 순서. */
function compareBase(a: CardView, b: CardView): number {
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

/** 고정 순번(없으면 -1). 래더 카드만 고정된다. */
function pinIndex(tab: Tab | undefined, pins: readonly PinnedBundle[], card: CardView): number {
  if (tab === undefined || card.opponent.source !== 'ladder' || pins.length === 0) return -1
  const p = pinOf(tab, card)
  return pins.findIndex((x) => samePin(x, p))
}

/**
 * 정렬된 카드 목록을 포켓몬마다 한 그룹으로 묶는다. 그룹 순서는 입력에서 처음 나온 순서.
 * 선택지 순서: 고정 배분(pins 안 순서 = 고정·추가한 순) → 고정 아닌 것(compareBase). 직접 추가 배분은 pins에 없어도 고정으로 친다
 * (상태는 추가와 함께 고정하므로 보통은 pins에 있다).
 */
export function groupCards(cards: readonly CardView[], tab?: Tab, pins: readonly PinnedBundle[] = []): CardGroup[] {
  const byKey = new Map<string, { opponent: OpponentHeader; berry?: BerryVariant; options: CardView[] }>()
  for (const card of cards) {
    const key = groupKey(card.opponent, card.berry?.item)
    const g = byKey.get(key)
    if (g === undefined) byKey.set(key, card.berry === undefined ? { opponent: card.opponent, options: [card] } : { opponent: card.opponent, berry: card.berry, options: [card] })
    else g.options.push(card)
  }
  return [...byKey].map(([key, g]) => {
    const index = new Map(g.options.map((o) => [o, pinIndex(tab, pins, o)]))
    // 직접 추가인데 pins에 없는 것은 고정 맨 뒤(추가 순은 compareBase가 지킨다)
    const rank = (o: CardView) => {
      const i = index.get(o) ?? -1
      return i >= 0 ? i : o.bundle.userAdded !== undefined ? pins.length : -1
    }
    // Array.prototype.sort는 안정 정렬이라 order까지 같으면 입력 순서가 남는다.
    const options = g.options.sort((a, b) => {
      const ra = rank(a)
      const rb = rank(b)
      if (ra >= 0 || rb >= 0) {
        if (ra < 0) return 1
        if (rb < 0) return -1
        if (ra !== rb) return ra - rb
      }
      return compareBase(a, b)
    })
    const group: CardGroup = { key, opponent: g.opponent, options, pinned: options.filter((o) => rank(o) >= 0).map((o) => o.id) }
    if (g.berry !== undefined) group.berry = g.berry
    return group
  })
}

/** 그 선택지가 고정됐는지 */
export const isPinned = (group: CardGroup, card: CardView): boolean => group.pinned.includes(card.id)

/** 고정 없을 때의 기본 배분: 사용자 추가 배분이 아닌 선택지 중 첫째(관측 배분 중 최고 점유율, 커스텀은 프리셋 1). 모두 사용자 추가면 첫 선택지. */
function baseDefault(options: readonly CardView[]): CardView | undefined {
  let best: CardView | undefined
  for (const o of options) {
    if (o.bundle.userAdded !== undefined) continue
    if (best === undefined || compareBase(o, best) < 0) best = o
  }
  return best ?? options[0]
}

/**
 * 분류 기본 배분: 그 분류의 고정 배분 중 고정 순 첫째(직접 추가 포함), 없으면 고정 없을 때의 기본 배분(관측 최고 점유율, 커스텀은 프리셋 1).
 * 그 분류 선택지가 없으면 undefined. (사용자 결정 2026-11-13: 고정 배분 우선 — 이전: 기본 선택은 고정과 무관하게 관측 최고 점유율)
 */
export function categoryDefault(group: CardGroup, category: CardView['category']): CardView | undefined {
  const options = group.options.filter((o) => o.category === category)
  for (const id of group.pinned) {
    const hit = options.find((o) => o.id === id)
    if (hit !== undefined) return hit
  }
  return baseDefault(options)
}

/** 분류 순서(선택지에 처음 나온 순서 = 계획의 물리 → 특수) */
function categoriesOf(group: CardGroup): CardView['category'][] {
  return [...new Set(group.options.map((o) => o.category))]
}

/** 분류 사이 비교: 방어 탭 선공기 우선으로 정해진 쪽 → 기준 기술 단건 판정이 센 쪽(1타 확률 → 최대 대미지 비율). 같으면 0 */
function compareDefaults(a: CardView, b: CardView): number {
  const da = a.defaultItem
  const db = b.defaultItem
  if (da === undefined || db === undefined) return da === undefined ? (db === undefined ? 0 : 1) : -1
  if (da.viaPriority !== db.viaPriority) return da.viaPriority ? -1 : 1
  const ca = da.basisCell
  const cb = db.basisCell
  if (ca === undefined || cb === undefined) return ca === undefined ? (cb === undefined ? 0 : 1) : -1
  const p = (cb.ohkoChance ?? 0) - (ca.ohkoChance ?? 0)
  if (p !== 0) return p
  return (cb.maxPercent ?? 0) - (ca.maxPercent ?? 0)
}

/**
 * 기본 선택: 분류마다 분류 기본 배분을 두고, 그 기본 항목을 견줘(compareDefaults, 같으면 분류 순) 이긴 분류의 기본 배분.
 * 분류가 하나면 그 분류 기본 배분이다.
 */
export function defaultOption(group: CardGroup): CardView {
  let best: CardView | undefined
  for (const category of categoriesOf(group)) {
    const card = categoryDefault(group, category)
    if (card !== undefined && (best === undefined || compareDefaults(card, best) < 0)) best = card
  }
  return best ?? group.options[0]
}

/** 기술 선택 목록의 항목 하나와 그 항목을 판정한 카드(그 분류 기본 배분) */
export interface GroupItem {
  item: ItemView
  card: CardView
}

const ITEM_STATUS_RANK: Readonly<Record<ItemView['status'], number>> = { ok: 0, pending: 1, error: 2, immune: 3 }

/**
 * 포켓몬 한 줄의 기술 선택 목록: 분류마다 분류 기본 배분의 항목을 모아 가장 세게 치는 순(정상 → 판정 전 → 계산 불가 → 무효,
 * 정상끼리 1타 확률 → 최대 대미지 비율, 같으면 분류 순·카드 안 순서)으로 낸다.
 */
export function groupItems(group: CardGroup): GroupItem[] {
  const out: GroupItem[] = []
  for (const category of categoriesOf(group)) {
    const card = categoryDefault(group, category)
    if (card !== undefined) for (const item of card.items) out.push({ item, card })
  }
  return out
    .map((g, i) => ({ g, i }))
    .sort((a, b) => {
      const sa = ITEM_STATUS_RANK[a.g.item.status]
      const sb = ITEM_STATUS_RANK[b.g.item.status]
      if (sa !== sb) return sa - sb
      const ca = a.g.item.cell
      const cb = b.g.item.cell
      if (a.g.item.status === 'ok' && ca !== undefined && cb !== undefined) {
        const p = (cb.ohkoChance ?? 0) - (ca.ohkoChance ?? 0)
        if (p !== 0) return p
        const m = (cb.maxPercent ?? 0) - (ca.maxPercent ?? 0)
        if (m !== 0) return m
      }
      return a.i - b.i
    })
    .map(({ g }) => g)
}

/**
 * 선택 id를 그룹의 선택지로 푼다. 사용자 추가 카드 id가 선택지에 없으면(계획이 같은 키의 관측 묶음으로 합쳐
 * 사용자 카드를 만들지 않은 경우 — 관측 묶음이 나중에 나타나거나 기준을 낮춘 경우) 같은 능력치·SP의 무보정 관측 묶음을 고르고,
 * 그것도 없으면 기본 선택지로 돌아간다.
 */
export function chosenOption(group: CardGroup, tab: Tab, chosen: string | undefined): CardView {
  if (chosen === undefined) return defaultOption(group)
  return matchedOption(group, tab, chosen) ?? defaultOption(group)
}

function matchedOption(group: CardGroup, tab: Tab, chosen: string): CardView | undefined {
  const hit = group.options.find((o) => o.id === chosen)
  if (hit !== undefined) return hit
  return group.options.find(
    (o) =>
      o.opponent.source === 'ladder' &&
      o.bundle.userAdded === undefined &&
      o.bundle.stats.every((s) => s.nature === 'neutral') &&
      addedCardId(tab, o.opponent.id, o.category, addedBundleKey(o.bundle.stats), o.berry?.item) === chosen,
  )
}
