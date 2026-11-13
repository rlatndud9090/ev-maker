import { describe, expect, it } from 'vitest'
import { TIER_ORDER, tierRank, type RollTier } from '../core'
import { bestSplitAt, pairCurrentCategory, sumBandOf, sumCells, sumSpans } from './sumBand'
import { minPairPoints } from './target'
import type { PairPoint } from './types'

const T = TIER_ORDER.defense
const MAX = 32

/** 단조 판정: score = a·H + b·B/D가 문턱을 넘을 때마다 한 단계 위 */
const linearJudge =
  (a: number, b: number, steps: readonly number[]) =>
  (hp: number, d: number): RollTier => {
    const s = a * hp + b * d
    let r = 0
    for (const x of steps) if (s >= x) r++
    return T[Math.min(r, T.length - 1)]
  }

/** 합계 t를 모든 분배로 나눠 본 최선 판정(정답) */
function bruteBest(judge: (h: number, d: number) => RollTier, t: number): RollTier {
  let best: RollTier = T[0]
  for (let h = Math.max(0, t - MAX); h <= Math.min(MAX, t); h++) {
    const l = judge(h, t - h)
    if (tierRank('defense', l) > tierRank('defense', best)) best = l
  }
  return best
}

const pt = (atLeast: RollTier, hp: number, defense: number, label: RollTier = atLeast): PairPoint => ({ atLeast, label, hp, defense })

describe('sumCells', () => {
  it('칸 T = max{ r : S_r ≤ T }, 경계 S_r 칸부터 그 단계이고 S_r − 1은 아래 단계', () => {
    const points = [pt(T[0], 0, 0), pt(T[1], 2, 0), pt(T[2], 2, 8), pt(T[3], 10, 12)]
    const cells = sumCells(points, MAX)
    expect(cells).toHaveLength(65)
    expect(cells[0]).toBe(T[0])
    expect(cells[1]).toBe(T[0])
    expect(cells[2]).toBe(T[1])
    expect(cells[9]).toBe(T[1])
    expect(cells[10]).toBe(T[2])
    expect(cells[21]).toBe(T[2])
    expect(cells[22]).toBe(T[3])
    // 최고 단계(확정견딤)는 (32, 32)에서도 닿지 않음 → 끝까지 T[3]
    expect(cells[64]).toBe(T[3])
  })

  it('여러 단계가 같은 최소 합계면 높은 단계가 칸을 차지한다(건너뛴 단계는 칸이 없다)', () => {
    const points = [pt(T[0], 0, 0), pt(T[1], 4, 4, T[2]), pt(T[2], 4, 4), pt(T[3], 20, 20)]
    const cells = sumCells(points, MAX)
    expect(cells[7]).toBe(T[0])
    expect(cells[8]).toBe(T[2])
    expect(cells.includes(T[1])).toBe(false)
  })

  it('H0·B/D0에서 이미 최고 단계면 모든 칸이 그 단계', () => {
    const points = T.map((r) => pt(r, 0, 0, T[4]))
    expect(new Set(sumCells(points, MAX))).toEqual(new Set([T[4]]))
  })

  it.each([
    ['H 효율이 큼', 3, 2, [40, 80, 120, 160]],
    ['B/D 효율이 큼', 1, 4, [20, 60, 100, 130]],
    ['같은 효율(동률 많음)', 2, 2, [10, 50, 90, 140]],
    ['최고 단계 도달 불가', 1, 1, [5, 30, 60, 999]],
  ] as const)('minPairPoints에서 유도한 칸 = 모든 분배 완전 탐색 최선(%s)', (_n, a, b, steps) => {
    const judge = linearJudge(a, b, steps)
    const cells = sumCells(minPairPoints(judge, MAX), MAX)
    for (let t = 0; t <= 2 * MAX; t++) expect([t, cells[t]]).toEqual([t, bruteBest(judge, t)])
  })

  it('점이 없으면 오류', () => {
    expect(() => sumCells([], MAX)).toThrow()
  })
})

describe('sumSpans', () => {
  it('구간 = 같은 판정 연속 칸, 최소 분배와 다른 변형의 같은 단계 최소 분배(없으면 null)', () => {
    const own = [pt(T[0], 0, 0), pt(T[1], 2, 0), pt(T[2], 2, 8)]
    const alt = [pt(T[0], 0, 0), pt(T[1], 0, 0), pt(T[2], 2, 4)]
    expect(sumSpans(sumCells(own, 8), own, alt)).toEqual([
      { from: 0, to: 1, label: T[0], min: { hp: 0, defense: 0 }, alt: { hp: 0, defense: 0 } },
      { from: 2, to: 9, label: T[1], min: { hp: 2, defense: 0 }, alt: { hp: 0, defense: 0 } },
      { from: 10, to: 16, label: T[2], min: { hp: 2, defense: 8 }, alt: { hp: 2, defense: 4 } },
    ])
  })

  it('다른 변형이 그 단계에 닿지 않으면 alt = null', () => {
    const own = [pt(T[0], 0, 0), pt(T[1], 3, 3)]
    const alt = [pt(T[0], 0, 0)]
    const spans = sumSpans(sumCells(own, 8), own, alt)
    expect(spans.map((s) => [s.from, s.to, s.label, s.alt])).toEqual([
      [0, 5, T[0], { hp: 0, defense: 0 }],
      [6, 16, T[1], null],
    ])
  })
})

describe('bestSplitAt', () => {
  const points = [pt(T[0], 0, 0), pt(T[1], 2, 8)]
  it('합계를 지키며 최소 분배 이상, H는 현재 값에 가장 가깝게', () => {
    expect(bestSplitAt(points, T[1], 12, { hp: 5, defense: 7 }, MAX)).toEqual({ label: T[1], split: { hp: 4, defense: 8 } })
    expect(bestSplitAt(points, T[1], 12, { hp: 0, defense: 12 }, MAX)).toEqual({ label: T[1], split: { hp: 2, defense: 10 } })
  })
  it('능력치당 최대를 넘지 않는다', () => {
    expect(bestSplitAt(points, T[1], 60, { hp: 0, defense: 0 }, MAX)).toEqual({ label: T[1], split: { hp: 28, defense: 32 } })
  })
})

describe('sumBandOf', () => {
  const neutral = [pt(T[0], 0, 0), pt(T[1], 2, 0), pt(T[2], 2, 8)]
  const plus = [pt(T[0], 0, 0), pt(T[1], 0, 0), pt(T[2], 0, 4)]
  const base = { points: { neutral, plus }, defenseStat: 'def' as const, max: MAX }

  it('현재 변형 기준 칸·구간, 다른 변형이 alt. 현재 분배가 최적이 아니면 같은 합계 최적 분배', () => {
    const v = sumBandOf({ ...base, nature: 'neutral', fallback: false, current: { hp: 0, defense: 2, label: T[0] } })
    expect(v.max).toBe(64)
    expect(v.cells).toHaveLength(65)
    expect(v.current).toEqual({ hp: 0, defense: 2, sum: 2, label: T[0], best: { label: T[1], split: { hp: 2, defense: 0 } } })
    expect(v.spans[1]).toEqual({ from: 2, to: 9, label: T[1], min: { hp: 2, defense: 0 }, alt: { hp: 0, defense: 0 } })
  })

  it('현재 분배가 이미 최적이면 best 없음, 상승 변형이면 상승 점으로 칠하고 alt는 무보정', () => {
    const v = sumBandOf({ ...base, nature: 'plus', fallback: false, current: { hp: 0, defense: 4, label: T[2] } })
    expect(v.current.best).toBeUndefined()
    expect(v.cells[4].label).toBe(T[2])
    expect(v.spans[0]).toEqual({ from: 0, to: 3, label: T[1], min: { hp: 0, defense: 0 }, alt: { hp: 2, defense: 0 } })
  })

  it('fallback(B/D 하락 성격)이면 best를 붙이지 않는다', () => {
    const v = sumBandOf({ ...base, nature: 'neutral', fallback: true, current: { hp: 0, defense: 2, label: T[0] } })
    expect(v.fallback).toBe(true)
    expect(v.current.best).toBeUndefined()
  })
})

describe('pairCurrentCategory: 현재 분배 판정 출처(드래그 중 모순 방지)', () => {
  const r = (sweepStat: string, status: string, category?: string) => ({ sweepStat, status, current: category === undefined ? {} : { category } })
  it('평소엔 H 행 현재 칸', () => {
    expect(pairCurrentCategory([r('hp', 'ok', 'h'), r('def', 'ok', 'b')], 'def')).toBe('h')
  })
  it('B/D 드래그로 H 행이 갱신 대기면 B/D 행 현재 칸(그 행은 표시 B/D·계획 시점 H로 맞다)', () => {
    expect(pairCurrentCategory([r('hp', 'stale', 'h'), r('def', 'ok', 'b')], 'def')).toBe('b')
    expect(pairCurrentCategory([r('hp', 'stale', 'h'), r('spd', 'ok', 'd')], 'spd')).toBe('d')
  })
  it('두 행이 다 갱신 대기거나 ok가 아니면 없음', () => {
    expect(pairCurrentCategory([r('hp', 'stale', 'h'), r('def', 'stale', 'b')], 'def')).toBeUndefined()
    expect(pairCurrentCategory([r('hp', 'error'), r('def', 'pending')], 'def')).toBeUndefined()
  })
})
