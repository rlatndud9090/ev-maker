import { describe, expect, it } from 'vitest'
import { JUDGEMENT_ORDER, STAT_IDS, judgeDamage, judgementRank, koLabel } from '../core'
import type { KoLabel, PokemonSet } from '../core'
import { EXAMPLE_SET, F1, opponentSet } from './__fixtures__/acceptance'
import { buildTabView } from './batch'
import { createLruCache } from './cache'
import { judgementKey } from './key'
import { planTab } from './plan'
import { computeRowTask } from './rowTask'
import { minPairPoints, pairTarget, singleTarget } from './target'
import { cardInput, realData } from './testing'
import type { CellView, ExtremeSpec, PairPoint, RowView, TabPlan } from './types'

const { game, bo1 } = realData()
const { spTotal, spMaxPerStat } = game.manifest.rules
const IGNORE_TOTAL = { ignoreSpTotal: true }

/** [[끝 sp, 1타 확률], …] → 0~32 CellView. need = max(0, sp − avail). */
function damageCells(spans: ReadonlyArray<readonly [number, number]>, avail = 32): CellView[] {
  const out: CellView[] = []
  let i = 0
  for (const [end, p] of spans) {
    for (; i <= end; i++) out.push({ sp: i, category: 'x', ohkoChance: p, overBudget: i > avail, need: Math.max(0, i - avail) })
  }
  return out
}

describe('singleTarget', () => {
  it('공격: 현재보다 한 단계 위의 가장 낮은 SP, 한 단계를 건너뛰면 그 칸의 실제 판정', () => {
    const cells = damageCells([
      [9, 0],
      [19, 0.5],
      [29, 0.8],
      [32, 1],
    ])
    expect(singleTarget('attack', 'atk', cells, 12)).toEqual({ label: 'high-roll-ohko', goal: 'better', stats: [{ stat: 'atk', sp: 20 }], need: 0 })
    expect(singleTarget('attack', 'atk', cells, 0)).toEqual({ label: 'mid-low-roll-ohko', goal: 'better', stats: [{ stat: 'atk', sp: 10 }], need: 0 })
    const jump = damageCells([
      [14, 0.5],
      [32, 1],
    ])
    expect(singleTarget('attack', 'atk', jump, 3)?.label).toBe('guaranteed-ohko')
    expect(singleTarget('attack', 'atk', jump, 3)?.stats).toEqual([{ stat: 'atk', sp: 15 }])
  })

  it('최상위면 그 판정 유지 최소값(현재보다 낮을 수 있다), 위가 불가능해도 유지 최소값', () => {
    const top = damageCells([
      [7, 0.5],
      [32, 1],
    ])
    expect(singleTarget('attack', 'atk', top, 32)).toEqual({ label: 'guaranteed-ohko', goal: 'keep', stats: [{ stat: 'atk', sp: 8 }], need: 0 })
    const capped = damageCells([
      [4, 0],
      [32, 0.3],
    ])
    expect(singleTarget('attack', 'atk', capped, 20)).toEqual({ label: 'mid-low-roll-ohko', goal: 'keep', stats: [{ stat: 'atk', sp: 5 }], need: 0 })
  })

  it('need는 그 칸 CellView.need 그대로(예산 초과분)', () => {
    const cells = damageCells(
      [
        [25, 0.5],
        [32, 1],
      ],
      20,
    )
    expect(singleTarget('attack', 'atk', cells, 12)?.need).toBe(6)
  })

  it('방어 단일 행: 확률이 내려갈수록 좋다', () => {
    const cells = damageCells([
      [5, 1],
      [12, 0.5],
      [32, 0],
    ])
    expect(singleTarget('defense', 'hp', cells, 8)).toEqual({ label: 'guaranteed-survive', goal: 'better', stats: [{ stat: 'hp', sp: 13 }], need: 0 })
  })

  it('스피드: 후공 → 동속 → 선공, 동속 칸이 없으면 선공', () => {
    const speed = (cats: string[]): CellView[] => cats.map((c, sp) => ({ sp, category: c, overBudget: false, need: 0 }))
    const cats = [...Array<string>(10).fill('second'), 'tie', ...Array<string>(22).fill('first')]
    expect(singleTarget('speed', 'spe', speed(cats), 3)).toEqual({ label: 'tie', goal: 'better', stats: [{ stat: 'spe', sp: 10 }], need: 0 })
    expect(singleTarget('speed', 'spe', speed(cats), 10)?.stats).toEqual([{ stat: 'spe', sp: 11 }])
    expect(singleTarget('speed', 'spe', speed(cats), 30)).toMatchObject({ label: 'first', goal: 'keep', stats: [{ stat: 'spe', sp: 11 }] })
    const noTie = [...Array<string>(10).fill('second'), ...Array<string>(23).fill('first')]
    expect(singleTarget('speed', 'spe', speed(noTie), 0)).toMatchObject({ label: 'first', goal: 'better', stats: [{ stat: 'spe', sp: 10 }] })
  })

  it('코어가 낸 칸이 아니면(1타 확률 없음·행동 순서 밖 범주) 목표 없음', () => {
    const bare = Array.from({ length: 33 }, (_, sp): CellView => ({ sp, category: 'p', overBudget: false, need: 0 }))
    expect(singleTarget('attack', 'atk', bare, 0)).toBeUndefined()
    expect(singleTarget('speed', 'spe', bare, 0)).toBeUndefined()
  })
})

/** 무차별 33×33: 순위마다 SP 합 최소, 동률이면 H 큰 쪽. */
function brute(judge: (hp: number, d: number) => KoLabel, max: number): PairPoint[] {
  const out: PairPoint[] = []
  JUDGEMENT_ORDER.defense.forEach((atLeast, r) => {
    let best: { hp: number; defense: number; label: KoLabel } | undefined
    for (let hp = 0; hp <= max; hp++) {
      for (let d = 0; d <= max; d++) {
        const label = judge(hp, d)
        if (judgementRank('defense', label) < r) continue
        const sum = hp + d
        if (best === undefined || sum < best.hp + best.defense || (sum === best.hp + best.defense && hp > best.hp)) best = { hp, defense: d, label }
      }
    }
    if (best !== undefined) out.push({ atLeast, ...best })
  })
  return out
}

/** 1타 확률 = 대미지 계수 − (H, D) 선형 감소를 4단으로 자른 합성 판정(단조). */
const linear =
  (k: number, wh: number, wd: number) =>
  (hp: number, d: number): KoLabel =>
    koLabel('defense', Math.min(1, Math.max(0, k - wh * hp - wd * d)))

describe('minPairPoints', () => {
  it('SP 합 최소, 동률이면 H가 큰 쪽', () => {
    // H·D 가중이 같아 합이 같은 점이 여럿이면 H를 고른다.
    const points = minPairPoints(linear(1.2, 0.05, 0.05), spMaxPerStat)
    const survive = points.find((p) => p.atLeast === 'guaranteed-survive')
    expect(survive).toEqual({ atLeast: 'guaranteed-survive', label: 'guaranteed-survive', hp: 24, defense: 0 })
    // D가 훨씬 효율적이면 D를 쓴다.
    expect(minPairPoints(linear(1.2, 0.01, 0.1), spMaxPerStat).at(-1)).toMatchObject({ hp: 0, defense: 12 })
  })

  it('(0,0)에서 이미 그 판정이면 (0,0), 최대치에서도 안 되는 판정은 빠진다', () => {
    const points = minPairPoints(linear(2, 0.01, 0.01), spMaxPerStat)
    expect(points).toEqual([{ atLeast: 'guaranteed-ohko', label: 'guaranteed-ohko', hp: 0, defense: 0 }])
  })

  it('속성: 합성 단조 판정 여러 개에서 무차별 33×33과 같고, 평가 횟수는 200회 이하', () => {
    const cases = [linear(1.2, 0.05, 0.05), linear(1.5, 0.03, 0.06), linear(0.9, 0.02, 0.01), linear(3, 0.05, 0.05), linear(1.05, 0.004, 0.03)]
    for (const judge of cases) {
      let n = 0
      const counted = (hp: number, d: number) => {
        n++
        return judge(hp, d)
      }
      expect(minPairPoints(counted, spMaxPerStat)).toEqual(brute(judge, spMaxPerStat))
      expect(n).toBeLessThanOrEqual(200)
    }
  })
})

describe('pairTarget', () => {
  const points: PairPoint[] = [
    { atLeast: 'guaranteed-ohko', label: 'guaranteed-ohko', hp: 0, defense: 0 },
    { atLeast: 'mid-high-roll-ohko', label: 'mid-high-roll-ohko', hp: 2, defense: 0 },
    { atLeast: 'low-roll-ohko', label: 'guaranteed-survive', hp: 4, defense: 12 },
    { atLeast: 'guaranteed-survive', label: 'guaranteed-survive', hp: 4, defense: 12 },
  ]

  it('한 단계 위 점, n = (합 증가분 − 잔여) > 0일 때만', () => {
    expect(pairTarget(points, 'mid-high-roll-ohko', 'def', { hp: 2, defense: 6 }, 3)).toEqual({
      label: 'guaranteed-survive',
      goal: 'better',
      stats: [
        { stat: 'hp', sp: 4 },
        { stat: 'def', sp: 12 },
      ],
      need: 5,
    })
    expect(pairTarget(points, 'mid-high-roll-ohko', 'spd', { hp: 2, defense: 6 }, 8)?.need).toBe(0)
  })

  it('최상위면 유지 최소값(합이 줄면 n 0), 위 점이 없으면 현재 판정 유지', () => {
    expect(pairTarget(points, 'guaranteed-survive', 'def', { hp: 20, defense: 20 }, 0)).toMatchObject({ goal: 'keep', need: 0, stats: [{ sp: 4 }, { sp: 12 }] })
    expect(pairTarget(points.slice(0, 2), 'mid-high-roll-ohko', 'def', { hp: 10, defense: 0 }, 0)).toMatchObject({
      label: 'mid-high-roll-ohko',
      goal: 'keep',
      stats: [{ sp: 2 }, { sp: 0 }],
    })
  })
})

// ---------- 실데이터 ----------

const rowOf = (rows: readonly RowView[], id: string): RowView => {
  const r = rows.find((x) => x.id === id)
  if (r === undefined) throw new Error(`행 ${id}이 없다`)
  return r
}

describe('공격 탭 최소 A(F1)', () => {
  for (const which of ['full', 'spare'] as const) {
    it(`${which}: 첫 카드 드래곤클로 행 목표 = 코어 직접 스캔(koLabel 한 단계 위의 가장 낮은 A), n = 증가분 − 잔여`, () => {
      const mySet = F1[which]
      const view = buildTabView(cardInput({ mySet }), 'attack')
      const ref = F1.cards[0]
      const card = view.cards.find((c) => c.opponent.id === ref.opponent.id && c.bundle.representativeSpread === ref.opponent.spread)
      const row = card?.rows.find((r) => r.kind === 'base' && r.moveId === F1.move)
      if (row === undefined) throw new Error('F1 첫 카드 행이 없다')
      const opp = opponentSet(bo1, ref.opponent)
      const labelAt = (a: number) => {
        const set: PokemonSet = { ...mySet, sp: { ...mySet.sp, atk: a } }
        const v = judgeDamage(game, 'attacker', set, opp, F1.move, undefined, undefined, IGNORE_TOTAL).value
        return koLabel('attack', v.kind === 'damage' ? v.ohkoChance : 0)
      }
      const current = mySet.sp.atk
      const r = judgementRank('attack', labelAt(current))
      let sp = 0
      while (judgementRank('attack', labelAt(sp)) < r + 1) sp++
      const remaining = spTotal - STAT_IDS.reduce((s, k) => s + mySet.sp[k], 0)
      expect(row.target).toEqual({ label: labelAt(sp), goal: 'better', stats: [{ stat: 'atk', sp }], need: Math.max(0, sp - current - remaining) })
      // 고정 경계(F1: A20 고난수)와 같다.
      expect(row.target).toMatchObject({ label: 'high-roll-ohko', stats: [{ stat: 'atk', sp: 20 }], need: ref.need[which][0] })
    })
  }
})

describe('방어 탭 H·B 최소 조합(예시 세트)', () => {
  const input = cardInput({ mySet: EXAMPLE_SET })
  const plan = planTab(input, 'defense')
  const view = buildTabView(input, 'defense')
  const judgeOf = (spec: ExtremeSpec) => (hp: number, d: number) => {
    const defender = { ...spec.defender, sp: { ...spec.defender.sp, hp, [spec.stats[1]]: d } }
    const v = judgeDamage(game, 'defender', spec.attacker, defender, spec.moveId, spec.conditions, undefined, IGNORE_TOTAL).value
    return koLabel('defense', v.kind === 'damage' ? v.ohkoChance : 0)
  }

  it('속성: 쌍 결과가 있는 필터 몇 개에서 무차별 33×33과 같다', () => {
    const pairs = Object.values(plan.filters)
      .map((spec) => ({ spec, r: computeRowTask(plan, { kind: 'pair', filterId: spec.id }) }))
      .filter(({ r }) => r.kind === 'pair' && r.points.length > 1)
      .slice(0, 3)
    expect(pairs.length).toBeGreaterThan(0)
    for (const { spec, r } of pairs) expect(r.kind === 'pair' && r.points).toEqual(brute(judgeOf(spec), spMaxPerStat))
  })

  it('H행·B/D행이 같은 쌍 목표를 싣고, 목표 판정은 현재보다 한 단계 위(불가능하면 유지), n = 합 증가분 − 잔여', () => {
    const remaining = spTotal - STAT_IDS.reduce((s, k) => s + EXAMPLE_SET.sp[k], 0)
    let checked = 0
    for (const card of view.cards) {
      for (const filterId of plan.cards.find((c) => c.id === card.id)?.filterIds ?? []) {
        const spec = plan.filters[filterId]
        const rows = card.rows.filter((r) => plan.rows[r.id]?.gate === filterId && !r.noChange)
        if (rows.length === 0) continue
        const judge = judgeOf(spec)
        const cur = { hp: EXAMPLE_SET.sp.hp, defense: EXAMPLE_SET.sp[spec.stats[1]] }
        const rank = judgementRank('defense', judge(cur.hp, cur.defense))
        const all = brute(judge, spMaxPerStat)
        const want = all.find((p) => judgementRank('defense', p.atLeast) === rank + 1) ?? all.find((p) => judgementRank('defense', p.atLeast) === rank)
        if (want === undefined) throw new Error('유지 점이 없다')
        for (const row of rows) {
          expect(row.target).toEqual({
            label: want.label,
            goal: judgementRank('defense', want.atLeast) > rank ? 'better' : 'keep',
            stats: [
              { stat: 'hp', sp: want.hp },
              { stat: spec.stats[1], sp: want.defense },
            ],
            need: Math.max(0, want.hp + want.defense - cur.hp - cur.defense - remaining),
          })
          checked++
        }
      }
    }
    expect(checked).toBeGreaterThan(4)
  })

  it('대표 행이 쌍 목표를 가진다(카드 headline → 그 행 target.stats 두 개)', () => {
    const withTarget = view.cards.filter((c) => c.headline.kind === 'row')
    expect(withTarget.length).toBeGreaterThan(0)
    for (const c of withTarget) {
      const h = c.headline
      if (h.kind !== 'row') continue
      expect(rowOf(c.rows, h.rowId).target?.stats).toHaveLength(2)
    }
  })

  it('캐시 키: pair는 같은 필터의 extreme과 다르고, 내 H·B/D SP와 무관, 캐시 적중 결과 = 무캐시', () => {
    const filterId = Object.keys(plan.filters)[0]
    const pairKey = judgementKey(plan, { kind: 'pair', filterId })
    expect(pairKey).not.toBe(judgementKey(plan, { kind: 'extreme', filterId }))
    const spec = plan.filters[filterId]
    const moved = (patch: Partial<PokemonSet['sp']>): TabPlan => ({
      ...plan,
      filters: { ...plan.filters, [filterId]: { ...spec, defender: { ...spec.defender, sp: { ...spec.defender.sp, ...patch } } } },
    })
    expect(judgementKey(moved({ hp: 30, [spec.stats[1]]: 30 }), { kind: 'pair', filterId })).toBe(pairKey)
    const other = spec.stats[1] === 'def' ? 'spd' : 'def'
    const otherShifted = judgementKey(moved({ [other]: spec.defender.sp[other] + 5 }), { kind: 'pair', filterId })
    // 참조하지 않는 방어 능력치는 키에서 빠진다(관여 능력치만).
    expect(otherShifted).toBe(pairKey)
    expect(judgementKey(moved({ atk: spec.defender.sp.atk + 5 }), { kind: 'pair', filterId })).toBe(pairKey)
    const c = createLruCache()
    const cold = computeRowTask(plan, { kind: 'pair', filterId }, c)
    expect(c.size).toBe(1)
    expect(computeRowTask(plan, { kind: 'pair', filterId }, c)).toEqual(cold)
    expect(computeRowTask(plan, { kind: 'pair', filterId })).toEqual(cold)
  })
})
