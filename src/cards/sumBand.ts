// 방어 탭 내구 합계 띠: 쌍 최소 조합(PairPoint, 판정 단계 r마다 최소 H+B/D 합계 S_r)에서 합계 T별 최선 판정을 유도한다.
// 판정이 H·B/D 각각에 단조라 칸 T = max{ r : S_r ≤ T }. 판정을 다시 하지 않는다.
import { tierRank, type RollTier } from '../core'
import type { NatureVariant, PairPoint, SumBandSpan, SumBandView, SumSplit } from './types'

const sumOf = (p: SumSplit): number => p.hp + p.defense

/** 순위 순 점(minPairPoints 출력)에서 합계 0~2·max 칸 판정. 칸 T = 합계가 T 이하인 점 중 가장 높은 atLeast */
export function sumCells(points: readonly PairPoint[], max: number): RollTier[] {
  if (points.length === 0) throw new Error('쌍 최소 조합이 비어 있다')
  const out: RollTier[] = []
  for (let t = 0; t <= 2 * max; t++) {
    let label: RollTier | undefined
    for (const p of points) if (sumOf(p) <= t && (label === undefined || tierRank('defense', p.atLeast) > tierRank('defense', label))) label = p.atLeast
    if (label === undefined) throw new Error(`합계 ${t}에서 판정을 낼 점이 없다(첫 점이 H0·B/D0이 아니다)`)
    out.push(label)
  }
  return out
}

/** 같은 판정 연속 칸 → 구간. min = 그 판정의 최소 분배, alt = 다른 성격 변형의 같은 판정 최소 분배(닿지 않으면 null) */
export function sumSpans(cells: readonly RollTier[], points: readonly PairPoint[], alt: readonly PairPoint[]): SumBandSpan[] {
  const out: SumBandSpan[] = []
  cells.forEach((label, t) => {
    const last = out[out.length - 1]
    if (last !== undefined && last.label === label) {
      last.to = t
      return
    }
    const p = points.find((x) => x.atLeast === label)
    if (p === undefined) throw new Error(`판정 ${label}의 최소 조합이 없다`)
    const a = alt.find((x) => x.atLeast === label)
    out.push({ from: t, to: t, label, min: { hp: p.hp, defense: p.defense }, alt: a === undefined ? null : { hp: a.hp, defense: a.defense } })
  })
  return out
}

/** 합계 sum(칸 판정 label)에서 그 판정을 내는 분배 중 현재 분배에 가장 가까운 것(H를 현재 값 쪽으로 맞추고 나머지는 B/D) */
export function bestSplitAt(points: readonly PairPoint[], label: RollTier, sum: number, current: SumSplit, max: number): { label: RollTier; split: SumSplit } {
  const p = points.find((x) => x.atLeast === label) as PairPoint
  const lo = Math.max(p.hp, sum - max)
  const hi = Math.min(max, sum - p.defense)
  const hp = Math.min(hi, Math.max(lo, current.hp))
  return { label, split: { hp, defense: sum - hp } }
}

export interface SumBandInput {
  points: Readonly<Record<NatureVariant, readonly PairPoint[]>>
  /** 띠 기준 변형(현재 성격). 현재 성격이 어느 변형도 아니면(B/D 하락) neutral + fallback */
  nature: NatureVariant
  fallback: boolean
  defenseStat: 'def' | 'spd'
  /** 표시용 현재 H·B/D SP와 현재 분배 실제 판정(H 행 현재 칸) */
  current: SumSplit & { label?: RollTier }
  /** 능력치당 최대 SP */
  max: number
}

/** 내구 합계 띠 뷰. current.best는 같은 합계 최적 판정이 현재 판정보다 좋을 때만(fallback이면 성격 차이라 붙이지 않는다) */
export function sumBandOf(input: SumBandInput): SumBandView {
  const { points, nature, fallback, defenseStat, current, max } = input
  const own = points[nature]
  const alt = points[nature === 'neutral' ? 'plus' : 'neutral']
  const labels = sumCells(own, max)
  const sum = current.hp + current.defense
  const view: SumBandView = {
    defenseStat,
    nature,
    fallback,
    max: 2 * max,
    cells: labels.map((label, t) => ({ sum: t, label })),
    spans: sumSpans(labels, own, alt),
    current: { hp: current.hp, defense: current.defense, sum },
  }
  if (current.label !== undefined) {
    view.current.label = current.label
    const best = bestSplitAt(own, labels[sum], sum, current, max)
    if (!fallback && tierRank('defense', best.label) > tierRank('defense', current.label)) view.current.best = best
  }
  return view
}
