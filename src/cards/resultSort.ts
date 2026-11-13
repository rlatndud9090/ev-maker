// 목록 "계산결과순": 변동 가능한 포켓몬을 도달 가능한 최선 판정(유리 → 불리) 그룹으로, 그다음 변동 없음·계산 불가·계산 중.
// 판정을 다시 하지 않고 조립이 실은 RowView.best·status·CardView.variable만 읽는다.
import { TIER_ORDER } from '../core'
import type { CardView, Tab } from './types'

/** usage = 사용률 순(계획 순서 그대로), result = 계산결과순 */
export type SortMode = 'usage' | 'result'

/**
 * 결과 그룹. tier = 변동 가능하고 그 판정까지 닿음(공격·방어 RollTier, 스피드 SpeedOrder), no-change = 변동 없음,
 * error = 계산 불가(카드 오류·대표가 계산 불가), pending = 아직 확정 안 됨(대표 갱신 중·성격 변형 결과 대기).
 */
export type ResultBucket = { kind: 'tier'; tier: string } | { kind: 'no-change' } | { kind: 'error' } | { kind: 'pending' }

export interface ResultSection<T> {
  /** 그룹 순서 안에서 유일: 'tier:<판정>' | 'no-change' | 'error' | 'pending' */
  key: string
  bucket: ResultBucket
  items: T[]
}

export const bucketKey = (b: ResultBucket): string => (b.kind === 'tier' ? `tier:${b.tier}` : b.kind)

/**
 * 카드(포켓몬 행에 보이는 배분)의 결과 그룹. 판정 그룹 = 변화 있는 ok·stale 행들의 best 중 그 탭 관점 최선.
 * 대표 행에 묶지 않는다: best·variable은 SP 0~최대 전체 기준이라 표시 SP와 무관하므로, 내 SP를 드래그하는 동안(stale,
 * 대표가 updating)이나 대표가 다른 행으로 바뀌어도 그룹이 흔들리지 않는다. 판정 전·잠정 변화 없음 행이 남았거나
 * 변화 있는 행의 best가 아직 없으면(성격 변형 대기) 최선이 바뀔 수 있어 계산 중.
 */
export function resultBucket(card: CardView, tab: Tab): ResultBucket {
  if (card.state === 'error' || card.headline.kind === 'error') return { kind: 'error' }
  if (card.rows.some((r) => r.status === 'pending' || r.provisional)) return { kind: 'pending' }
  if (!card.variable) return { kind: 'no-change' }
  const order = TIER_ORDER[tab] as readonly string[]
  let best: string | undefined
  for (const r of card.rows) {
    if ((r.status !== 'ok' && r.status !== 'stale') || r.noChange || r.cells.length === 0) continue
    if (r.best === undefined) return { kind: 'pending' }
    if (best === undefined || order.indexOf(r.best) > order.indexOf(best)) best = r.best
  }
  return best === undefined ? { kind: 'pending' } : { kind: 'tier', tier: best }
}

/** 그룹 순번(작을수록 앞): 그 탭 관점 유리한 판정부터, 그다음 변동 없음 → 계산 불가 → 계산 중 */
function bucketRank(tab: Tab, b: ResultBucket): number {
  const order = TIER_ORDER[tab] as readonly string[]
  if (b.kind === 'tier') {
    const i = order.indexOf(b.tier)
    // 관점 밖 판정은 생기지 않지만(조립이 거른다) 생기면 판정 그룹 맨 뒤
    return i < 0 ? order.length : order.length - 1 - i
  }
  const tail = { 'no-change': 1, error: 2, pending: 3 } as const
  return order.length + tail[b.kind]
}

/**
 * 계산결과순 섹션. 같은 그룹 안: 목록 밖 타겟(사용률 없음) 먼저 입력 순(= 추가 순), 그다음 래더 사용률 내림차순, 동률은 입력 순.
 * 빈 그룹은 내지 않는다.
 */
export function sortByResult<T>(items: readonly T[], tab: Tab, cardOf: (item: T) => CardView): ResultSection<T>[] {
  const entries = items.map((item, index) => {
    const card = cardOf(item)
    const bucket = resultBucket(card, tab)
    return { item, index, card, bucket, rank: bucketRank(tab, bucket) }
  })
  entries.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank
    const ca = a.card.opponent.source === 'custom'
    const cb = b.card.opponent.source === 'custom'
    if (ca !== cb) return ca ? -1 : 1
    if (!ca) {
      const d = (b.card.opponent.usage ?? 0) - (a.card.opponent.usage ?? 0)
      if (d !== 0) return d
    }
    return a.index - b.index
  })
  const out: ResultSection<T>[] = []
  for (const e of entries) {
    const key = bucketKey(e.bucket)
    const last = out[out.length - 1]
    if (last !== undefined && last.key === key) last.items.push(e.item)
    else out.push({ key, bucket: e.bucket, items: [e.item] })
  }
  return out
}
