import { describe, expect, it } from 'vitest'
import { bundlesOf } from './bundles'
import { realData, syntheticEntry } from './testing'
import { DEFAULT_CRITERIA } from './types'

const { game, bo1 } = realData()
const base = bo1.ranking[0]
const entry = (kept: Array<[string, number]>, keptShare = 0.8) =>
  syntheticEntry(base, { spreads: { kept, keptShare, excludedShare: 0 } })

describe('bundlesOf', () => {
  it('키 능력치의 (SP, 성격 보정)이 같은 배분끼리 점유율을 합치고 대표는 묶음 안 최대 배분', () => {
    const e = entry([
      ['adamant:2/32/0/0/0/32', 0.3],
      ['jolly:2/32/0/0/0/32', 0.2],
      ['bold:2/0/0/0/0/32', 0.1],
      ['hardy:2/32/0/0/0/0', 0.05],
    ])
    // 공격 탭 물리: 키 = H·B. adamant·jolly·hardy는 B 0·보정 없음, bold는 B+.
    const out = bundlesOf(game, e, ['hp', 'def'], DEFAULT_CRITERIA)
    expect(out.map((b) => [b.stats, b.share, b.representativeSpread, b.minority])).toEqual([
      [[{ stat: 'hp', sp: 2, nature: 'neutral' }, { stat: 'def', sp: 0, nature: 'neutral' }], 0.55, 'adamant:2/32/0/0/0/32', false],
      [[{ stat: 'hp', sp: 2, nature: 'neutral' }, { stat: 'def', sp: 0, nature: 'plus' }], 0.1, 'bold:2/0/0/0/0/32', false],
    ])
    expect(out[0].key).toBe(JSON.stringify(out[0].stats))
    expect(out.every((b) => b.retention === 0.8)).toBe(true)
  })

  it('성격 보정이 키 능력치에 걸리면 다른 묶음(A+ ≠ A 보정 없음)', () => {
    const e = entry([
      ['adamant:2/32/0/0/0/32', 0.3],
      ['jolly:2/32/0/0/0/32', 0.2],
    ])
    const out = bundlesOf(game, e, ['atk'], DEFAULT_CRITERIA)
    expect(out.map((b) => b.stats[0].nature)).toEqual(['plus', 'neutral'])
  })

  it('기본 기준은 5%: 정확히 기준값이면 포함(부동소수 합도 넷째 자리로 맞춘다), 미만은 뺀다', () => {
    expect(DEFAULT_CRITERIA.bundleShareMin).toBe(0.05)
    const e = entry([
      ['adamant:0/32/0/0/0/32', 0.5],
      ['adamant:0/32/1/0/0/31', 0.03],
      ['adamant:0/31/1/0/0/32', 0.02],
      ['adamant:0/32/2/0/0/30', 0.0499],
    ])
    const out = bundlesOf(game, e, ['def'], DEFAULT_CRITERIA)
    expect(out.map((b) => b.share)).toEqual([0.5, 0.05])
  })

  it('기준 이상은 상한 없이 전부, 동률은 대표 배분 키 순', () => {
    const kept: Array<[string, number]> = Array.from({ length: 12 }, (_, i) => [`adamant:0/0/${i}/0/0/0`, 0.05])
    const out = bundlesOf(game, entry(kept), ['def'], DEFAULT_CRITERIA)
    expect(out).toHaveLength(12)
    expect(out.map((b) => b.representativeSpread)).toEqual([...kept.map(([k]) => k)].sort())
    expect(out.every((b) => !b.minority)).toBe(true)
  })

  it('물리 공격 기준(H·B): 키 밖 능력치만 다른 배분("H2 C32 S32"·"H2 C16 D16 S32")은 한 묶음으로 합산', () => {
    const e = entry([
      ['modest:2/0/0/32/0/32', 0.04],
      ['modest:2/0/0/16/16/32', 0.03],
      ['bold:2/0/32/0/0/32', 0.1],
    ])
    const out = bundlesOf(game, e, ['hp', 'def'], DEFAULT_CRITERIA)
    // 각각 5% 미만이지만 합 7%라 선택지가 된다.
    expect(out.map((b) => [b.stats.map((s) => [s.stat, s.sp, s.nature]), b.share])).toEqual([
      [[['hp', 2, 'neutral'], ['def', 32, 'plus']], 0.1],
      [[['hp', 2, 'neutral'], ['def', 0, 'neutral']], 0.07],
    ])
    expect(out[1].representativeSpread).toBe('modest:2/0/0/32/0/32')
  })

  it('기준 이상이 없으면 최대 묶음 1장을 소수 배분으로', () => {
    const e = entry([
      ['adamant:0/0/1/0/0/0', 0.04],
      ['adamant:0/0/2/0/0/0', 0.03],
    ])
    const out = bundlesOf(game, e, ['def'], DEFAULT_CRITERIA)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ share: 0.04, minority: true, representativeSpread: 'adamant:0/0/1/0/0/0' })
  })

  it('키 능력치가 없으면 묶음 1개(배분 무관), 보존 배분이 없으면 빈 배열', () => {
    const e = entry([
      ['adamant:0/0/1/0/0/0', 0.3],
      ['modest:0/0/2/0/0/0', 0.2],
    ])
    const out = bundlesOf(game, e, [], DEFAULT_CRITERIA)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ key: '[]', share: 0.5, minority: false })
    expect(bundlesOf(game, entry([]), ['def'], DEFAULT_CRITERIA)).toEqual([])
  })

  it('실데이터: 점유율 합 ≤ 보존률, 정렬 내림차순', () => {
    for (const e of bo1.ranking.slice(0, 10)) {
      const out = bundlesOf(game, e, ['hp', 'def'], { ...DEFAULT_CRITERIA, bundleShareMin: 0 })
      const total = out.reduce((a, b) => a + (b.share ?? 0), 0)
      expect(Math.abs(total - e.spreads.keptShare)).toBeLessThan(1e-3)
      for (let i = 1; i < out.length; i++) expect((out[i - 1].share ?? 0) >= (out[i].share ?? 0)).toBe(true)
    }
  })
})
