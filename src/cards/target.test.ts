import { describe, expect, it } from 'vitest'
import { STAT_IDS, TIER_ORDER, judgeDamage, rollTier, tierRank } from '../core'
import type { PokemonSet, RollTier } from '../core'
import type { StatId } from '../data/schema'
import { EXAMPLE_SET, F1, opponentSet } from './__fixtures__/acceptance'
import { buildTabView } from './batch'
import { createLruCache } from './cache'
import { judgementKey } from './key'
import { withNature } from './natures'
import { planTab } from './plan'
import { computeRowTask } from './rowTask'
import { minPairPoints, pairTarget, singleTarget } from './target'
import { cardInput, realData } from './testing'
import type { CellView, ExtremeSpec, PairPoint, RowView, TabPlan, TargetOption } from './types'
import { DEFAULT_ROLL_STEPS } from './types'

/** 카드 입력과 같은 제품 고난수 기준(cardInput 기본값). 코어 직접 호출 기대값도 이 기준의 5단 판정으로 낸다 */
const N = DEFAULT_ROLL_STEPS

const { game, bo1 } = realData()
const { spTotal, spMaxPerStat } = game.manifest.rules
const OPTS = { ignoreSpTotal: true, rollSteps: N }

/** [[끝 sp, 판정], …] → 0~32 CellView. need = max(0, sp − avail). */
function tierCells(spans: ReadonlyArray<readonly [number, string]>, avail = 32): CellView[] {
  const out: CellView[] = []
  let i = 0
  for (const [end, category] of spans) {
    for (; i <= end; i++) out.push({ sp: i, category, overBudget: i > avail, need: Math.max(0, i - avail) })
  }
  return out
}
const opt = (stat: StatId, sp: number, label: string, need = 0): TargetOption => ({ label, stats: [{ stat, sp }], need })

describe('singleTarget', () => {
  const neutral = tierCells([
    [9, 'guaranteed-survive'],
    [19, 'mid-roll-ohko'],
    [29, 'high-roll-ohko'],
    [32, 'guaranteed-ohko'],
  ])
  const plus = tierCells([
    [5, 'guaranteed-survive'],
    [14, 'mid-roll-ohko'],
    [24, 'high-roll-ohko'],
    [32, 'guaranteed-ohko'],
  ])

  it('공격: 변형마다 현재보다 한 단계 위의 가장 낮은 SP, label은 두 선택지 중 낮은 판정', () => {
    expect(singleTarget('attack', 'atk', 'atk', 'mid-roll-ohko', { neutral, plus })).toEqual({
      label: 'high-roll-ohko',
      goal: 'better',
      plusStat: 'atk',
      neutral: opt('atk', 20, 'high-roll-ohko'),
      plus: opt('atk', 15, 'high-roll-ohko'),
    })
    // 한 단계를 건너뛰면 그 칸의 실제 판정, 두 선택지 실제 판정이 다르면 낮은 쪽이 label
    const jump = tierCells([
      [14, 'low-roll-ohko'],
      [32, 'guaranteed-ohko'],
    ])
    expect(singleTarget('attack', 'atk', 'atk', 'low-roll-ohko', { neutral, plus: jump })).toEqual({
      label: 'mid-roll-ohko',
      goal: 'better',
      plusStat: 'atk',
      neutral: opt('atk', 10, 'mid-roll-ohko'),
      plus: opt('atk', 15, 'guaranteed-ohko'),
    })
  })

  it('한쪽만 위에 닿으면 다른 쪽은 null(불가), 둘 다 못 닿으면 현재 판정 유지 최소값', () => {
    const capped = tierCells([
      [4, 'guaranteed-survive'],
      [32, 'mid-roll-ohko'],
    ])
    expect(singleTarget('attack', 'atk', 'atk', 'mid-roll-ohko', { neutral: capped, plus })).toEqual({
      label: 'high-roll-ohko',
      goal: 'better',
      plusStat: 'atk',
      neutral: null,
      plus: opt('atk', 15, 'high-roll-ohko'),
    })
    expect(singleTarget('attack', 'atk', 'atk', 'mid-roll-ohko', { neutral: capped, plus: capped })).toEqual({
      label: 'mid-roll-ohko',
      goal: 'keep',
      plusStat: 'atk',
      neutral: opt('atk', 5, 'mid-roll-ohko'),
      plus: opt('atk', 5, 'mid-roll-ohko'),
    })
  })

  it('최상위면 유지 최소값(현재보다 낮을 수 있다), 유지도 못 하는 변형은 null', () => {
    const weak = tierCells([[32, 'high-roll-ohko']])
    expect(singleTarget('attack', 'atk', 'atk', 'guaranteed-ohko', { neutral: weak, plus })).toEqual({
      label: 'guaranteed-ohko',
      goal: 'keep',
      plusStat: 'atk',
      neutral: null,
      plus: opt('atk', 25, 'guaranteed-ohko'),
    })
  })

  it('need는 그 칸 CellView.need 그대로(예산 초과분), 변형마다 따로', () => {
    const n20 = tierCells(
      [
        [25, 'mid-roll-ohko'],
        [32, 'guaranteed-ohko'],
      ],
      20,
    )
    const p20 = tierCells(
      [
        [18, 'mid-roll-ohko'],
        [32, 'guaranteed-ohko'],
      ],
      20,
    )
    const t = singleTarget('attack', 'atk', 'atk', 'mid-roll-ohko', { neutral: n20, plus: p20 })
    expect([t?.neutral?.need, t?.plus?.need]).toEqual([6, 0])
  })

  it('방어 단일 행: 확률이 내려갈수록 좋다(같은 5단 척도, 방향만 반대)', () => {
    const cells = tierCells([
      [5, 'guaranteed-ohko'],
      [12, 'mid-roll-ohko'],
      [20, 'low-roll-ohko'],
      [32, 'guaranteed-survive'],
    ])
    expect(singleTarget('defense', 'hp', 'def', 'mid-roll-ohko', { neutral: cells, plus: cells })).toMatchObject({
      label: 'low-roll-ohko',
      goal: 'better',
      plusStat: 'def',
      neutral: opt('hp', 13, 'low-roll-ohko'),
    })
  })

  it('스피드: 후공 → 동속 → 선공', () => {
    const speed = (cats: string[]): CellView[] => cats.map((c, sp) => ({ sp, category: c, overBudget: false, need: 0 }))
    const n = speed([...Array<string>(10).fill('second'), 'tie', ...Array<string>(22).fill('first')])
    const p = speed([...Array<string>(6).fill('second'), ...Array<string>(27).fill('first')])
    expect(singleTarget('speed', 'spe', 'spe', 'second', { neutral: n, plus: p })).toEqual({
      label: 'tie',
      goal: 'better',
      plusStat: 'spe',
      neutral: opt('spe', 10, 'tie'),
      plus: opt('spe', 6, 'first'),
    })
    expect(singleTarget('speed', 'spe', 'spe', 'first', { neutral: n, plus: p })).toMatchObject({
      goal: 'keep',
      neutral: { stats: [{ sp: 11 }] },
      plus: { stats: [{ sp: 6 }] },
    })
  })

  it('코어 판정 범주가 아닌 칸이 있거나 두 변형 칸이 모두 없으면 목표 없음', () => {
    const bare = Array.from({ length: 33 }, (_, sp): CellView => ({ sp, category: 'p', overBudget: false, need: 0 }))
    expect(singleTarget('attack', 'atk', 'atk', 'mid-roll-ohko', { neutral: bare, plus })).toBeUndefined()
    expect(singleTarget('attack', 'atk', 'atk', 'mid-roll-ohko', {})).toBeUndefined()
  })
})

/** 무차별 33×33: 순위마다 SP 합 최소, 동률이면 H 큰 쪽. */
function brute(judge: (hp: number, d: number) => RollTier, max: number): PairPoint[] {
  const out: PairPoint[] = []
  TIER_ORDER.defense.forEach((atLeast, r) => {
    let best: { hp: number; defense: number; label: RollTier } | undefined
    for (let hp = 0; hp <= max; hp++) {
      for (let d = 0; d <= max; d++) {
        const label = judge(hp, d)
        if (tierRank('defense', label) < r) continue
        const sum = hp + d
        if (best === undefined || sum < best.hp + best.defense || (sum === best.hp + best.defense && hp > best.hp)) best = { hp, defense: d, label }
      }
    }
    if (best !== undefined) out.push({ atLeast, ...best })
  })
  return out
}

/** 1타 확률 = 대미지 계수 − (H, D) 선형 감소를 5단으로 자른 합성 판정(단조). */
const linear =
  (k: number, wh: number, wd: number) =>
  (hp: number, d: number): RollTier =>
    rollTier(Math.min(1, Math.max(0, k - wh * hp - wd * d)), N)

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
  const neutral: PairPoint[] = [
    { atLeast: 'guaranteed-ohko', label: 'guaranteed-ohko', hp: 0, defense: 0 },
    { atLeast: 'high-roll-ohko', label: 'high-roll-ohko', hp: 2, defense: 0 },
    { atLeast: 'mid-roll-ohko', label: 'mid-roll-ohko', hp: 2, defense: 4 },
    { atLeast: 'low-roll-ohko', label: 'guaranteed-survive', hp: 4, defense: 12 },
    { atLeast: 'guaranteed-survive', label: 'guaranteed-survive', hp: 4, defense: 12 },
  ]
  const plus: PairPoint[] = [
    { atLeast: 'guaranteed-ohko', label: 'guaranteed-ohko', hp: 0, defense: 0 },
    { atLeast: 'high-roll-ohko', label: 'high-roll-ohko', hp: 0, defense: 1 },
    { atLeast: 'mid-roll-ohko', label: 'mid-roll-ohko', hp: 1, defense: 2 },
    { atLeast: 'low-roll-ohko', label: 'low-roll-ohko', hp: 2, defense: 6 },
    { atLeast: 'guaranteed-survive', label: 'guaranteed-survive', hp: 2, defense: 8 },
  ]
  const pt = (hp: number, d: number, label: string, need: number, stat: 'def' | 'spd' = 'def'): TargetOption => ({
    label,
    stats: [
      { stat: 'hp', sp: hp },
      { stat, sp: d },
    ],
    need,
  })

  it('변형마다 한 단계 위 점, n = (합 증가분 − 잔여) > 0일 때만, label은 낮은 쪽', () => {
    expect(pairTarget({ neutral, plus }, 'mid-roll-ohko', 'def', { hp: 2, defense: 4 }, 3)).toEqual({
      label: 'low-roll-ohko',
      goal: 'better',
      plusStat: 'def',
      neutral: pt(4, 12, 'guaranteed-survive', 7),
      plus: pt(2, 6, 'low-roll-ohko', 0),
    })
    expect(pairTarget({ neutral, plus }, 'mid-roll-ohko', 'spd', { hp: 2, defense: 4 }, 20)?.neutral).toEqual(pt(4, 12, 'guaranteed-survive', 0, 'spd'))
  })

  it('최상위면 유지 최소값, 위 점이 어느 변형에도 없으면 현재 판정 유지, 한쪽만 있으면 다른 쪽 null', () => {
    expect(pairTarget({ neutral, plus }, 'guaranteed-survive', 'def', { hp: 20, defense: 20 }, 0)).toMatchObject({
      goal: 'keep',
      neutral: pt(4, 12, 'guaranteed-survive', 0),
      plus: pt(2, 8, 'guaranteed-survive', 0),
    })
    expect(pairTarget({ neutral: neutral.slice(0, 2), plus: plus.slice(0, 2) }, 'high-roll-ohko', 'def', { hp: 10, defense: 0 }, 0)).toMatchObject({
      label: 'high-roll-ohko',
      goal: 'keep',
    })
    expect(pairTarget({ neutral: neutral.slice(0, 2), plus }, 'high-roll-ohko', 'def', { hp: 0, defense: 0 }, 32)).toEqual({
      label: 'mid-roll-ohko',
      goal: 'better',
      plusStat: 'def',
      neutral: null,
      plus: pt(1, 2, 'mid-roll-ohko', 0),
    })
  })
})

// ---------- 실데이터 ----------

const rowOf = (rows: readonly RowView[], id: string): RowView => {
  const r = rows.find((x) => x.id === id)
  if (r === undefined) throw new Error(`행 ${id}이 없다`)
  return r
}

/** 코어 직접 스캔: 목표 순위 이상을 내는 가장 낮은 SP(없으면 null) */
function scan(labelAt: (sp: number) => string, side: 'attack' | 'defense', minRank: number): number | null {
  for (let sp = 0; sp <= spMaxPerStat; sp++) if (tierRank(side, labelAt(sp)) >= minRank) return sp
  return null
}

describe('공격 탭 최소 A 2종(F1)', () => {
  for (const which of ['full', 'spare'] as const) {
    it(`${which}: 첫 카드 드래곤클로 행 목표 = 무보정·상승 성격 각각 코어 직접 스캔(5단 한 단계 위의 가장 낮은 A), n = 증가분 − 잔여`, () => {
      const mySet = F1[which]
      const input = cardInput({ mySet })
      const view = buildTabView(input, 'attack')
      const plan = planTab(input, 'attack')
      const ref = F1.targetCard
      const card = view.cards.find((c) => c.opponent.id === ref.opponent.id && c.bundle.representativeSpread === ref.opponent.spread)
      const row = card?.rows.find((r) => r.kind === 'base' && r.moveId === F1.move)
      if (row === undefined) throw new Error('F1 첫 카드 행이 없다')
      const natures = plan.rows[row.id].natures
      if (natures === undefined) throw new Error('성격 변형 없음')
      expect(natures).toEqual({ stat: 'atk', neutral: mySet.nature, plus: F1.plusNature })
      const opp = opponentSet(bo1, ref.opponent)
      const labelAt = (nature: string) => (a: number) =>
        judgeDamage(game, 'attacker', { ...withNature(mySet, nature), sp: { ...mySet.sp, atk: a } }, opp, F1.move, undefined, undefined, OPTS).category
      const current = mySet.sp.atk
      const r = tierRank('attack', labelAt(mySet.nature)(current))
      const remaining = spTotal - STAT_IDS.reduce((s, k) => s + mySet.sp[k], 0)
      const n = scan(labelAt(mySet.nature), 'attack', r + 1)
      const p = scan(labelAt(F1.plusNature), 'attack', r + 1)
      if (n === null || p === null) throw new Error('F1은 두 변형 모두 위에 닿는다')
      const o = (sp: number, nature: string) => opt('atk', sp, labelAt(nature)(sp), Math.max(0, sp - current - remaining))
      const want = { neutral: o(n, mySet.nature), plus: o(p, F1.plusNature) }
      const label = tierRank('attack', want.neutral.label) <= tierRank('attack', want.plus.label) ? want.neutral.label : want.plus.label
      expect(row.target).toEqual({ label, goal: 'better', plusStat: 'atk', ...want })
      // 고정값(notes): 현재 A12 중난수1타 → 고난수1타 무보정 A27 / 상승 A11+
      expect(labelAt(mySet.nature)(current)).toBe(ref.current)
      expect(row.target).toMatchObject({
        label: ref.label,
        neutral: { stats: [{ sp: ref.neutral }], need: Math.max(0, ref.neutral - current - remaining) },
        plus: { stats: [{ sp: ref.plus }], need: Math.max(0, ref.plus - current - remaining) },
      })
    })
  }
})

describe('방어 탭 H·B 최소 조합 2종(예시 세트)', () => {
  const input = cardInput({ mySet: EXAMPLE_SET })
  const plan = planTab(input, 'defense')
  const view = buildTabView(input, 'defense')
  const judgeOf = (spec: ExtremeSpec, nature: string) => (hp: number, d: number) => {
    const defender = { ...withNature(spec.defender, nature), sp: { ...spec.defender.sp, hp, [spec.stats[1]]: d } }
    return judgeDamage(game, 'defender', spec.attacker, defender, spec.moveId, spec.conditions, undefined, OPTS).category as RollTier
  }

  it('속성: 쌍 결과가 있는 필터 몇 개에서 성격 변형마다 무차별 33×33과 같다', () => {
    const pairs = Object.values(plan.filters)
      .flatMap((spec) => (['neutral', 'plus'] as const).map((nature) => ({ spec, nature, r: computeRowTask(plan, { kind: 'pair', filterId: spec.id, nature }) })))
      .filter(({ r }) => r.kind === 'pair' && r.points.length > 1)
      .slice(0, 4)
    expect(pairs.length).toBeGreaterThan(0)
    for (const { spec, nature, r } of pairs) {
      expect(r.kind === 'pair' && r.points).toEqual(brute(judgeOf(spec, nature === 'neutral' ? spec.natures.neutral : spec.natures.plus), spMaxPerStat))
    }
  })

  it('H행·B/D행이 같은 쌍 목표 2종을 싣고, 목표 판정은 현재보다 한 단계 위(두 변형 모두 불가면 유지), n = 합 증가분 − 잔여', () => {
    const remaining = spTotal - STAT_IDS.reduce((s, k) => s + EXAMPLE_SET.sp[k], 0)
    let checked = 0
    let filters = 0
    for (const card of view.cards) {
      for (const filterId of plan.cards.find((c) => c.id === card.id)?.filterIds ?? []) {
        const spec = plan.filters[filterId]
        const rows = card.rows.filter((r) => plan.rows[r.id]?.gate === filterId && !r.noChange)
        // 무차별 33×33 × 성격 2종이라 앞쪽 필터 8개만 대조한다
        if (rows.length === 0 || filters >= 8) continue
        filters++
        const cur = { hp: EXAMPLE_SET.sp.hp, defense: EXAMPLE_SET.sp[spec.stats[1]] }
        const rank = tierRank('defense', judgeOf(spec, EXAMPLE_SET.nature)(cur.hp, cur.defense))
        const all = { neutral: brute(judgeOf(spec, spec.natures.neutral), spMaxPerStat), plus: brute(judgeOf(spec, spec.natures.plus), spMaxPerStat) }
        const at = (r: number) => ({
          neutral: all.neutral.find((p) => tierRank('defense', p.atLeast) === r) ?? null,
          plus: all.plus.find((p) => tierRank('defense', p.atLeast) === r) ?? null,
        })
        let goal: 'better' | 'keep' = 'better'
        let want = at(rank + 1)
        if (want.neutral === null && want.plus === null) {
          goal = 'keep'
          want = at(rank)
        }
        const toOpt = (p: PairPoint | null): TargetOption | null =>
          p === null
            ? null
            : {
                label: p.label,
                stats: [
                  { stat: 'hp', sp: p.hp },
                  { stat: spec.stats[1], sp: p.defense },
                ],
                need: Math.max(0, p.hp + p.defense - cur.hp - cur.defense - remaining),
              }
        const labels = [want.neutral, want.plus].filter((x): x is PairPoint => x !== null).map((x) => x.label)
        const label = labels.reduce((a, b) => (tierRank('defense', b) < tierRank('defense', a) ? b : a))
        for (const row of rows) {
          expect(row.target).toEqual({ label, goal, plusStat: spec.stats[1], neutral: toOpt(want.neutral), plus: toOpt(want.plus) })
          checked++
        }
      }
    }
    expect(checked).toBeGreaterThan(4)
  }, 20_000) // 33×33 전수 대조라 전체 병렬 실행에서 기본 5초를 넘을 수 있다

  it('변동 가능 카드의 대표 행이 쌍 목표를 가진다(카드 headline → 그 행 target 선택지 stats 두 개)', () => {
    const withTarget = view.cards.filter((c) => c.headline.kind === 'row' && c.variable)
    expect(withTarget.length).toBeGreaterThan(0)
    for (const c of withTarget) {
      const h = c.headline
      if (h.kind !== 'row') continue
      const t = rowOf(c.rows, h.rowId).target
      expect((t?.neutral ?? t?.plus)?.stats).toHaveLength(2)
    }
  })

  it('캐시 키: pair는 같은 필터의 extreme과 다르고 성격 변형마다 다르며, 내 H·B/D SP와 무관, 캐시 적중 결과 = 무캐시', () => {
    const filterId = Object.keys(plan.filters)[0]
    const task = { kind: 'pair', filterId, nature: 'plus' } as const
    const pairKey = judgementKey(plan, task)
    expect(pairKey).not.toBe(judgementKey(plan, { kind: 'extreme', filterId }))
    expect(pairKey).not.toBe(judgementKey(plan, { ...task, nature: 'neutral' }))
    const spec = plan.filters[filterId]
    const moved = (patch: Partial<PokemonSet['sp']>): TabPlan => ({
      ...plan,
      filters: { ...plan.filters, [filterId]: { ...spec, defender: { ...spec.defender, sp: { ...spec.defender.sp, ...patch } } } },
    })
    expect(judgementKey(moved({ hp: 30, [spec.stats[1]]: 30 }), task)).toBe(pairKey)
    const other = spec.stats[1] === 'def' ? 'spd' : 'def'
    // 참조하지 않는 방어 능력치는 키에서 빠진다(관여 능력치만).
    expect(judgementKey(moved({ [other]: spec.defender.sp[other] + 5 }), task)).toBe(pairKey)
    expect(judgementKey(moved({ atk: spec.defender.sp.atk + 5 }), task)).toBe(pairKey)
    const c = createLruCache()
    const cold = computeRowTask(plan, task, c)
    expect(c.size).toBe(1)
    expect(computeRowTask(plan, task, c)).toEqual(cold)
    expect(computeRowTask(plan, task)).toEqual(cold)
  })
})
