import { describe, expect, it } from 'vitest'
import { moveStatRefs } from '../core'
import type { StatId } from '../data/schema'
import { adjustView, type AdjustInput } from './adjust'
import type { Branch, LockDerivation } from './lock'
import { taskKey } from './schedule'
import { bands, card, ends, extreme, failed, filter, game, pairResult, plan, resultMap, row, sp, swept, variantSwept } from './__fixtures__/handPlan'
import type { AdjustStat, AdjustView, CompactCell, ExtremeSpec, PairPoint, RowSpec, RowTaskResult, TabPlan } from './types'

const branch = (id: string, nature: string, lockedSp: Partial<Record<StatId, number>>): Branch => ({
  id,
  plus: id === 'out' ? 'out' : (id.slice('plus:'.length) as Branch['plus']),
  nature,
  lockedSp,
  lockedSum: Object.values(lockedSp).reduce((a, b) => a + (b ?? 0), 0),
  choice: new Map(),
})

function locked(p: TabPlan, branches: Branch[], baseId: string, lockedStats: StatId[]): TabPlan {
  const derivation: LockDerivation = { locks: [], statuses: new Map(), branches, baseId, lockedStats, overTotal: 0 }
  const base = branches.find((b) => b.id === baseId) as Branch
  return { ...p, lock: { mode: 'main', derivation, base, overTotal: 0 } }
}

const ready = (v: AdjustView | undefined): AdjustView => {
  expect(v?.state).toBe('ready')
  return v as AdjustView
}

const statsText = (stats: readonly AdjustStat[]): string => stats.map((s) => `${s.stat}${s.sp}${s.plus ? '+' : ''}${s.locked ? 'L' : ''}`).join(' ')

/** 결과 목록 요약: 결과 → [lead, 선택지마다 ok면 "stat sp(+)(L)" 목록(H 최대 배분이 있으면 " | H 최대 목록") / off 사유] */
function summary(v: AdjustView) {
  return v.results.map((r) => ({
    label: r.label,
    lead: r.lead,
    current: r.current,
    options: r.options.map((o) => (o.kind === 'ok' ? `${statsText(o.stats)}${o.hMax === undefined ? '' : ` | ${statsText(o.hMax)}`}` : o.reason)),
  }))
}

// ---------- 공격 행 ----------

const ATK_NEUTRAL = bands([
  [9, 'guaranteed-survive'],
  [19, 'low-roll-ohko'],
  [27, 'high-roll-ohko'],
  [32, 'guaranteed-ohko'],
])
const ATK_PLUS = bands([
  [4, 'guaranteed-survive'],
  [12, 'low-roll-ohko'],
  [16, 'mid-roll-ohko'],
  [22, 'high-roll-ohko'],
  [32, 'guaranteed-ohko'],
])

function attackRow(patch: Partial<RowSpec> = {}): RowSpec {
  const spec = row({ id: 'r1', cardId: 'c1', stat: 'atk', natures: { stat: 'atk', neutral: 'hardy', plus: 'adamant' } })
  return { ...spec, moveId: 'earthquake', refs: moveStatRefs(game, 'earthquake'), ...patch }
}

function attackPlan(spec: RowSpec = attackRow()): TabPlan {
  return plan({ cards: [card({ id: 'c1', rowIds: [spec.id] })], rows: [spec] })
}

const attackResults = (plus: CompactCell[] | RowTaskResult | null = ATK_PLUS): Map<string, RowTaskResult> => {
  const rs = [ends('r1', 'guaranteed-survive', 'guaranteed-ohko'), swept('r1', ATK_NEUTRAL)]
  if (plus !== null) rs.push(Array.isArray(plus) ? variantSwept('r1', 'plus', plus) : plus)
  return resultMap(...rs)
}

const input = (p: TabPlan, results: AdjustInput['results'], o: Partial<AdjustInput> = {}): AdjustInput => ({
  plan: p,
  results,
  shown: { target: 'row', id: 'r1' },
  displaySp: sp(),
  ...o,
})

describe('adjustView: 고정 없는 공격 행', () => {
  it('무보정·상승 두 선택지, 좋은 결과부터. 내 세트가 무보정(hardy)이면 상승이 더 싸도 lead는 무보정, 상승으로만 닿는 결과만 상승', () => {
    const v = ready(adjustView(input(attackPlan(), attackResults(), { current: 'low-roll-ohko' })))
    expect(v.natures).toEqual([
      { id: 'neutral', plus: null, nature: 'hardy', branchId: null, lockedSp: {} },
      { id: 'plus', plus: 'atk', nature: 'adamant', branchId: null, lockedSp: {} },
    ])
    expect(summary(v)).toEqual([
      { label: 'guaranteed-ohko', lead: 0, current: false, options: ['atk28', 'atk23+'] },
      { label: 'high-roll-ohko', lead: 0, current: false, options: ['atk20', 'atk17+'] },
      // 무보정은 A20에서 중난수를 건너뛰어 고난수가 되므로 중난수는 상승으로만 고를 수 있다(lead도 상승)
      { label: 'mid-roll-ohko', lead: 1, current: false, options: ['unreachable', 'atk13+'] },
      { label: 'low-roll-ohko', lead: 0, current: true, options: ['atk10', 'atk5+'] },
      { label: 'guaranteed-survive', lead: 0, current: false, options: ['atk0', 'atk0+'] },
    ])
    expect(v.keep).toEqual(['atk'])
    expect(v.relevant).toEqual(['atk'])
  })

  it('예산 = 66 − 판정이 의존하는 다른 능력치 SP. 예산 밖은 budget이고 어느 선택지도 ok가 아닌 결과는 빠진다', () => {
    const spec = attackRow({ dependsOn: ['def', 'spe'] })
    const v = ready(adjustView(input(attackPlan(spec), attackResults(), { displaySp: sp({ def: 20, spe: 32, spa: 32 }) })))
    // 예산 14: 고정 밖 다른 능력치(spa 32)는 예산을 막지 않는다
    expect(summary(v)).toEqual([
      // 무보정이 예산 밖이면 닿는 선택지(상승)가 lead
      { label: 'mid-roll-ohko', lead: 1, current: false, options: ['budget', 'atk13+'] },
      { label: 'low-roll-ohko', lead: 0, current: false, options: ['atk10', 'atk5+'] },
      { label: 'guaranteed-survive', lead: 0, current: false, options: ['atk0', 'atk0+'] },
    ])
    expect(v.keep).toEqual(['atk', 'def', 'spe'])
  })

  it('비단조 칸에서도 각 결과의 SP는 그 결과 이상의 실제 최소이고, 더 좋은 결과와 같은 비용인 결과는 빠진다', () => {
    const wobble = bands([
      [9, 'guaranteed-survive'],
      [11, 'high-roll-ohko'],
      [14, 'low-roll-ohko'],
      [32, 'guaranteed-ohko'],
    ])
    const v = ready(adjustView(input(attackPlan(), attackResults(wobble))))
    // 상승: A10에서 고난수(그 위 A12~14 저난수), A15 확정1타. 중난수·저난수는 고난수와 같은 A10이라 상승으로는 고를 수 없다
    expect(summary(v)).toEqual([
      { label: 'guaranteed-ohko', lead: 0, current: false, options: ['atk28', 'atk15+'] },
      { label: 'high-roll-ohko', lead: 0, current: false, options: ['atk20', 'atk10+'] },
      { label: 'low-roll-ohko', lead: 0, current: false, options: ['atk10', 'unreachable'] },
      { label: 'guaranteed-survive', lead: 0, current: false, options: ['atk0', 'atk0+'] },
    ])
  })

  it('상승 바닥(A0+)이 이미 더 좋은 결과면 낮은 결과에서 상승은 unreachable(고르면 다른 결과가 난다)', () => {
    const highFloor = bands([
      [12, 'low-roll-ohko'],
      [22, 'high-roll-ohko'],
      [32, 'guaranteed-ohko'],
    ])
    const v = ready(adjustView(input(attackPlan(), attackResults(highFloor))))
    expect(summary(v)).toEqual([
      { label: 'guaranteed-ohko', lead: 0, current: false, options: ['atk28', 'atk23+'] },
      { label: 'high-roll-ohko', lead: 0, current: false, options: ['atk20', 'atk13+'] },
      { label: 'low-roll-ohko', lead: 0, current: false, options: ['atk10', 'atk0+'] },
      { label: 'guaranteed-survive', lead: 0, current: false, options: ['atk0', 'unreachable'] },
    ])
  })

  it('변형 결과가 없으면 computing(그 변형 작업, 중복 없음), 변형 오류면 그 선택지는 모든 결과에서 unreachable', () => {
    const waiting = adjustView(input(attackPlan(), attackResults(null)))
    expect(waiting).toEqual({ state: 'computing', tasks: [{ kind: 'variant', rowId: 'r1', nature: 'plus' }], natures: [], results: [], keep: ['atk'], relevant: ['atk'] })
    const broken = ready(adjustView(input(attackPlan(), attackResults(failed({ kind: 'variant', rowId: 'r1', nature: 'plus' })))))
    expect(broken.results.every((r) => r.options[1].kind === 'off' && r.options[1].reason === 'unreachable')).toBe(true)
    expect(broken.results.map((r) => r.label)).toEqual(['guaranteed-ohko', 'high-roll-ohko', 'low-roll-ohko', 'guaranteed-survive'])
  })

  it('내 세트가 조정 능력치 상승(adamant)이면 lead는 상승, 상승이 그 결과를 정확히 못 내면 닿는 가장 싼 선택지', () => {
    const mine = attackRow()
    mine.attacker = { ...mine.attacker, nature: 'adamant' }
    // 현재 성격이 상승 변형이라 본 스윕이 상승 칸이고 무보정이 변형 작업이다
    const adamantResults = (plus: CompactCell[]) =>
      resultMap(ends('r1', 'guaranteed-survive', 'guaranteed-ohko'), swept('r1', plus), variantSwept('r1', 'neutral', ATK_NEUTRAL))
    const v = ready(adjustView(input(attackPlan(mine), adamantResults(ATK_PLUS))))
    expect(summary(v).map((r) => [r.label, r.lead])).toEqual([
      ['guaranteed-ohko', 1],
      ['high-roll-ohko', 1],
      ['mid-roll-ohko', 1],
      ['low-roll-ohko', 1],
      ['guaranteed-survive', 1],
    ])
    const highFloor = bands([
      [12, 'low-roll-ohko'],
      [22, 'high-roll-ohko'],
      [32, 'guaranteed-ohko'],
    ])
    const floor = ready(adjustView(input(attackPlan(mine), adamantResults(highFloor))))
    // 상승 A0+가 이미 저난수라 확정견딤은 무보정으로만 닿는다
    expect(summary(floor).map((r) => [r.label, r.lead])).toEqual([
      ['guaranteed-ohko', 1],
      ['high-roll-ohko', 1],
      ['low-roll-ohko', 1],
      ['guaranteed-survive', 0],
    ])
  })

  it('내 세트 상승이 판정과 무관한 능력치(jolly, S 상승)면 무보정 세트처럼 lead는 무보정', () => {
    const mine = attackRow({ natures: { stat: 'atk', neutral: 'jolly', plus: 'adamant' } })
    mine.attacker = { ...mine.attacker, nature: 'jolly' }
    const v = ready(adjustView(input(attackPlan(mine), attackResults())))
    expect(summary(v).map((r) => r.lead)).toEqual([0, 0, 1, 0, 0])
  })

  it('계산 불가 행·방어 탭 필터 행·없는 항목은 대상이 아니다', () => {
    const err = attackRow({ error: { code: 'ILLEGAL_MOVE', message: 'x' } })
    expect(adjustView(input(attackPlan(err), attackResults()))).toBeUndefined()
    expect(adjustView(input(attackPlan(), attackResults(), { shown: { target: 'row', id: 'nope' } }))).toBeUndefined()
  })
})

// ---------- 공격 행 + 스피드 고정(기준 S16+, 무보정안 S29) ----------

const speedBranches = (withOut = true): Branch[] => [branch('plus:spe', 'timid', { spe: 16 }), ...(withOut ? [branch('out', 'hardy', { spe: 29 })] : [])]

function speedLockedAttack(withOut = true): TabPlan {
  // 기준 갈래 행 성격: timid의 하락(A)을 관여 밖(C)으로 옮긴 jolly, A 상승 불가
  const spec = attackRow({ natures: { stat: 'atk', neutral: 'jolly', plus: 'jolly' }, lock: { nature: 'jolly', strict: { neutral: 'jolly', plus: null }, viewLocked: false } })
  spec.attacker = { ...spec.attacker, nature: 'jolly' }
  return locked(attackPlan(spec), speedBranches(withOut), 'plus:spe', ['spe'])
}

const branchResult = (nature: string, cells: CompactCell[]): RowTaskResult => ({ kind: 'branch', rowId: 'r1', nature, cells })

describe('adjustView: 고정 중 공격 행', () => {
  it('무보정 = 기준 갈래(S16+ 유지), A 상승 = out 갈래(S29로 자동 전환, 그 고정 SP를 자물쇠로 표기)·그 갈래 예산', () => {
    const p = speedLockedAttack()
    const results = resultMap(ends('r1', 'guaranteed-survive', 'guaranteed-ohko'), swept('r1', ATK_NEUTRAL), branchResult('adamant', ATK_PLUS))
    const v = ready(adjustView(input(p, results)))
    expect(v.natures).toEqual([
      { id: 'neutral', plus: null, nature: 'jolly', branchId: 'plus:spe', lockedSp: { spe: 16 } },
      { id: 'plus', plus: 'atk', nature: 'adamant', branchId: 'out', lockedSp: { spe: 29 } },
    ])
    // 행 성격 jolly(S 상승)와 같은 상승 선택지가 없으므로 lead는 무보정(기준 갈래 유지)
    expect(summary(v)[0]).toEqual({ label: 'guaranteed-ohko', lead: 0, current: false, options: ['atk28', 'atk23+ spe29L'] })
    expect(v.keep).toEqual(['atk'])
  })

  it('out 갈래 재스윕 결과가 없으면 computing(branch 작업), out 갈래가 파생에 없으면 상승은 no-branch', () => {
    const results = resultMap(ends('r1', 'guaranteed-survive', 'guaranteed-ohko'), swept('r1', ATK_NEUTRAL))
    expect(adjustView(input(speedLockedAttack(), results))).toMatchObject({ state: 'computing', tasks: [{ kind: 'branch', rowId: 'r1', nature: 'adamant' }] })
    const v = ready(adjustView(input(speedLockedAttack(false), results)))
    expect(v.natures[1]).toMatchObject({ id: 'plus', off: 'no-branch', branchId: null })
    expect(v.results.every((r) => r.options[1].kind === 'off' && r.options[1].reason === 'no-branch')).toBe(true)
    expect(v.results.every((r) => r.lead === 0)).toBe(true)
  })

  it('예산은 선택지 갈래의 고정 합을 뺀다: S29 갈래는 A37까지', () => {
    const p = speedLockedAttack()
    const steep = bands([
      [30, 'high-roll-ohko'],
      [32, 'guaranteed-ohko'],
    ])
    const tight = { ...p, spTotal: 50 }
    const results = resultMap(ends('r1', 'guaranteed-survive', 'guaranteed-ohko'), swept('r1', steep), branchResult('adamant', steep))
    const v = ready(adjustView(input(tight, results)))
    // 무보정 예산 50 − 16 = 34, 상승 예산 50 − 29 = 21
    expect(summary(v)).toEqual([
      { label: 'guaranteed-ohko', lead: 0, current: false, options: ['atk31', 'budget'] },
      { label: 'high-roll-ohko', lead: 0, current: false, options: ['atk0', 'atk0+ spe29L'] },
    ])
  })

  it('보는 능력치가 고정이면 locked(선택지·결과 없음)', () => {
    const p = locked(attackPlan(), [branch('plus:atk', 'adamant', { atk: 20 }), branch('out', 'hardy', { atk: 28 })], 'plus:atk', ['atk'])
    expect(adjustView(input(p, attackResults()))).toEqual({ state: 'locked', natures: [], results: [], keep: ['atk'], relevant: ['atk'] })
  })
})

// ---------- 방어 쌍 ----------

const point = (atLeast: PairPoint['atLeast'], hp: number, defense: number, label = atLeast): PairPoint => ({ atLeast, label, hp, defense })

/** 물리 기술(지진) 필터. 관여 능력치 H·B */
const physical = (natures?: ExtremeSpec['natures']): ExtremeSpec => ({ ...filter('f1', 'c1', 0, natures), moveId: 'earthquake' })

function defensePlan(f: ExtremeSpec): TabPlan {
  const h = row({ id: 'h', cardId: 'c1', stat: 'hp', side: 'defender', gate: f.id })
  const d = row({ id: 'd', cardId: 'c1', stat: f.stats[1], side: 'defender', gate: f.id, order: 1 })
  return { ...plan({ cards: [card({ id: 'c1', rowIds: ['h', 'd'], filterIds: [f.id] })], rows: [h, d], filters: [f], mySide: 'defender' }), tab: 'defense' }
}

const defInput = (p: TabPlan, results: AdjustInput['results'], o: Partial<AdjustInput> = {}): AdjustInput => input(p, results, { shown: { target: 'filter', id: 'f1' }, ...o })

/** at(H) = 그 H에서 순위에 닿는 최소 B/D(hpMin 아래는 null) */
const stairsResult = (nature: string, rank: number, hpMin: number, at: (hp: number) => number | null): RowTaskResult => ({
  kind: 'stairs',
  filterId: 'f1',
  nature,
  rank,
  hpMin,
  stairs: Array.from({ length: 33 }, (_, h) => (h < hpMin ? null : at(h))),
})

/** 순위 1~4 계단(H 0부터): 순위 r은 B/D = max(0, k[r−1] − H / per)(H per당 B/D 1을 대신한다) */
const stairsLine = (nature: string, k: readonly number[], per = 1): RowTaskResult[] =>
  [1, 2, 3, 4].map((rank) => stairsResult(nature, rank, 0, (h) => Math.max(0, k[rank - 1] - Math.floor(h / per))))

/** 고정 없는 방어 쌍 H 최대용 계단: H·B 1:1, 순위별 합이 쌍 점 합과 같다(무보정 4·8·14·30, 상승 2·6·10·24) */
const LINE_NEUTRAL = [4, 8, 14, 30]
const LINE_PLUS = [2, 6, 10, 24]

describe('adjustView: 고정 없는 방어 쌍', () => {
  const f = physical({ stat: 'def', neutral: 'hardy', plus: 'bold' })
  const passed = extreme('f1', 'guaranteed-ohko', 'guaranteed-survive')

  it('쌍 최소 조합 점(H·B)으로 확정견딤부터, 확정1타는 작업 없이 H0 B0', () => {
    const pairs = [
      passed,
      pairResult('f1', 'neutral', [point('high-roll-ohko', 0, 4), point('mid-roll-ohko', 4, 4), point('low-roll-ohko', 8, 6), point('guaranteed-survive', 20, 10)]),
      pairResult('f1', 'plus', [point('high-roll-ohko', 0, 2), point('mid-roll-ohko', 2, 4), point('low-roll-ohko', 6, 4), point('guaranteed-survive', 16, 8)]),
    ]
    // 쌍 점이 있으면 H 최대용 계단(무보정 hardy·상승 bold, H 0부터)을 기다린다
    const waiting = adjustView(defInput(defensePlan(f), resultMap(...pairs)))
    expect(waiting?.state).toBe('computing')
    expect(waiting?.tasks).toEqual(['hardy', 'bold'].flatMap((nature) => [1, 2, 3, 4].map((rank) => ({ kind: 'stairs', filterId: 'f1', nature, rank, hpMin: 0 }))))
    const results = resultMap(...pairs, ...stairsLine('hardy', LINE_NEUTRAL), ...stairsLine('bold', LINE_PLUS))
    const v = ready(adjustView(defInput(defensePlan(f), results, { current: 'mid-roll-ohko' })))
    // H 최대: 확정견딤은 H32 B0, 그 아래는 다음 순위에 닿지 않는 가장 큰 H(무보정 저난수 H29: H30이면 B0으로 확정견딤). 확정1타는 없다
    expect(summary(v)).toEqual([
      { label: 'guaranteed-survive', lead: 0, current: false, options: ['hp20 def10 | hp32 def0', 'hp16 def8+ | hp32 def0+'] },
      { label: 'low-roll-ohko', lead: 0, current: false, options: ['hp8 def6 | hp29 def0', 'hp6 def4+ | hp23 def0+'] },
      { label: 'mid-roll-ohko', lead: 0, current: true, options: ['hp4 def4 | hp13 def0', 'hp2 def4+ | hp9 def0+'] },
      { label: 'high-roll-ohko', lead: 0, current: false, options: ['hp0 def4 | hp7 def0', 'hp0 def2+ | hp5 def0+'] },
      { label: 'guaranteed-ohko', lead: 0, current: false, options: ['hp0 def0', 'hp0 def0+'] },
    ])
    expect(v.keep).toEqual(['hp', 'def'])
    expect(v.relevant).toEqual(['hp', 'def'])
  })

  it('lead는 내 세트(방어측) 성격 기준: B 상승(bold)이면 상승, 반대쪽 D 상승(careful)이면 무보정', () => {
    const results = resultMap(
      passed,
      pairResult('f1', 'neutral', [point('high-roll-ohko', 0, 4), point('mid-roll-ohko', 4, 4), point('low-roll-ohko', 8, 6), point('guaranteed-survive', 20, 10)]),
      pairResult('f1', 'plus', [point('high-roll-ohko', 0, 2), point('mid-roll-ohko', 2, 4), point('low-roll-ohko', 6, 4), point('guaranteed-survive', 16, 8)]),
      ...stairsLine('hardy', LINE_NEUTRAL),
      ...stairsLine('bold', LINE_PLUS),
    )
    const leads = (nature: string) => {
      const p = defensePlan(f)
      const mine = p.filters.f1
      const withMine: TabPlan = { ...p, filters: { ...p.filters, f1: { ...mine, defender: { ...mine.defender, nature } } } }
      return ready(adjustView(defInput(withMine, results))).results.map((r) => [r.label, r.lead])
    }
    expect(leads('bold')).toEqual([
      ['guaranteed-survive', 1],
      ['low-roll-ohko', 1],
      ['mid-roll-ohko', 1],
      ['high-roll-ohko', 1],
      ['guaranteed-ohko', 1],
    ])
    expect(leads('careful').map(([, lead]) => lead)).toEqual([0, 0, 0, 0, 0])
  })

  it('쌍 결과가 없으면 computing(두 변형 쌍 작업), 필터를 통과하지 않으면 대상이 아니다', () => {
    const v = adjustView(defInput(defensePlan(f), resultMap(passed)))
    expect(v?.state).toBe('computing')
    expect(v?.tasks?.map(taskKey).sort()).toEqual([taskKey({ kind: 'pair', filterId: 'f1', nature: 'neutral' }), taskKey({ kind: 'pair', filterId: 'f1', nature: 'plus' })].sort())
    expect(adjustView(defInput(defensePlan(f), resultMap(extreme('f1', 'guaranteed-survive', 'guaranteed-survive'))))).toBeUndefined()
  })
})

describe('adjustView: 고정 중 방어 쌍', () => {
  it('스피드 고정 중(쌍 고정 없음): 무보정 = 기준 쌍 점, B 상승 = out 갈래 H 0부터 계단의 최소 합', () => {
    const f: ExtremeSpec = {
      ...physical({ stat: 'def', neutral: 'timid', plus: 'timid' }),
      lock: { nature: 'timid', strict: { neutral: 'timid', plus: null }, viewLocked: false },
    }
    f.defender = { ...f.defender, nature: 'timid' }
    const p = locked(defensePlan(f), speedBranches(), 'plus:spe', ['spe'])
    const passed = extreme('f1', 'guaranteed-ohko', 'guaranteed-survive')
    const pair = pairResult('f1', 'neutral', [point('high-roll-ohko', 0, 4), point('mid-roll-ohko', 4, 4), point('low-roll-ohko', 8, 6), point('guaranteed-survive', 20, 10)])
    const waiting = adjustView(defInput(p, resultMap(passed, pair)))
    expect(waiting?.state).toBe('computing')
    // 무보정(쌍 점)의 H 최대용 timid 계단 + 상승의 impish 계단(합 최소·H 최대가 함께 쓴다)
    expect(waiting?.tasks).toEqual(['timid', 'impish'].flatMap((nature) => [1, 2, 3, 4].map((rank) => ({ kind: 'stairs', filterId: 'f1', nature, rank, hpMin: 0 }))))
    // 계단(H별 최소 B)에서 H + B 최소: 순위 4는 H12 B4(합 16)
    const stairs = [1, 2, 3, 4].map((rank) => stairsResult('impish', rank, 0, (h) => (rank < 4 ? rank : h < 12 ? 20 : 4)))
    const v = ready(adjustView(defInput(p, resultMap(passed, pair, ...stairs, ...stairsLine('timid', LINE_NEUTRAL)))))
    expect(v.natures.map((n) => [n.id, n.branchId, n.nature])).toEqual([
      ['neutral', 'plus:spe', 'timid'],
      ['plus', 'out', 'impish'],
    ])
    // 행 성격 timid(S 상승)와 같은 상승 선택지가 없어 lead는 무보정(H+B 합 30 > 상승 16이어도)
    // H 최대: 무보정 H32 B0, 상승은 예산 66 − 29 = 37 안에서 H32 B4(합 36)
    expect(summary(v)[0]).toEqual({ label: 'guaranteed-survive', lead: 0, current: false, options: ['hp20 def10 | hp32 def0', 'hp12 def4+ spe29L | hp32 def4+ spe29L'] })
  })

  it('H+B 고정 중 D를 조정: 무보정 / D 상승 / B 상승 세 선택지, 각각 H·B·D를 표기(H·B 자물쇠), 예산은 그 갈래 고정 합을 뺀다', () => {
    const f: ExtremeSpec = {
      ...filter('f1', 'c1', 0, { stat: 'spd', neutral: 'bold', plus: 'bold' }),
      moveId: 'thunderbolt',
      stats: ['hp', 'spd'],
      lock: { nature: 'bold', strict: { neutral: 'bold', plus: null }, viewLocked: true },
    }
    f.defender = { ...f.defender, nature: 'bold' }
    const p = locked(defensePlan(f), [branch('plus:def', 'bold', { hp: 20, def: 12 }), branch('out', 'hardy', { hp: 20, def: 18 })], 'plus:def', ['hp', 'def'])
    const passed = extreme('f1', 'guaranteed-ohko', 'guaranteed-survive')
    const bold = [1, 2, 3, 4].map((rank) => stairsResult('bold', rank, 20, (h) => (h === 20 ? [0, 0, 4, 10, 30][rank] : null)))
    const careful = [1, 2, 3, 4].map((rank) => stairsResult('careful', rank, 20, (h) => (h === 20 ? [0, 0, 2, 6, 20][rank] : null)))
    const waiting = adjustView(defInput(p, resultMap(passed, ...bold)))
    expect(waiting?.tasks).toEqual([1, 2, 3, 4].map((rank) => ({ kind: 'stairs', filterId: 'f1', nature: 'careful', rank, hpMin: 20 })))
    const v = ready(adjustView(defInput(p, resultMap(passed, ...bold, ...careful))))
    expect(v.natures).toEqual([
      // 기준이 B 상승이라 무보정은 out 갈래(B18)
      { id: 'neutral', plus: null, nature: 'hardy', branchId: 'out', lockedSp: { hp: 20, def: 18 } },
      { id: 'plus', plus: 'spd', nature: 'careful', branchId: 'out', lockedSp: { hp: 20, def: 18 } },
      { id: 'other-plus', plus: 'def', nature: 'bold', branchId: 'plus:def', lockedSp: { hp: 20, def: 12 } },
    ])
    // 예산: out 66 − 38 = 28, plus:def 66 − 32 = 34. 확정1타(순위 0)는 B 0이라 순위 1과 같은 비용이라 빠진다
    // 내 행 성격 bold(B 상승) → lead는 반대쪽 B 상승 선택지(기준 갈래), D 상승이 더 싸도
    expect(summary(v)).toEqual([
      { label: 'guaranteed-survive', lead: 2, current: false, options: ['budget', 'hp20L def18L spd20+', 'hp20L def12+L spd30'] },
      { label: 'low-roll-ohko', lead: 2, current: false, options: ['hp20L def18L spd10', 'hp20L def18L spd6+', 'hp20L def12+L spd10'] },
      { label: 'mid-roll-ohko', lead: 2, current: false, options: ['hp20L def18L spd4', 'hp20L def18L spd2+', 'hp20L def12+L spd4'] },
      { label: 'high-roll-ohko', lead: 2, current: false, options: ['hp20L def18L spd0', 'hp20L def18L spd0+', 'hp20L def12+L spd0'] },
    ])
    // 같은 계획에서 내 성격만 바꿔 세 갈래 lead 규칙을 본다(성격 → 상승 능력치만 읽는다)
    const leads = (nature: string) => {
      const mine = p.filters.f1
      const q: TabPlan = { ...p, filters: { ...p.filters, f1: { ...mine, defender: { ...mine.defender, nature } } } }
      return ready(adjustView(defInput(q, resultMap(passed, ...bold, ...careful)))).results.map((r) => r.lead)
    }
    // D 상승(careful) → D 상승 선택지
    expect(leads('careful')).toEqual([1, 1, 1, 1])
    // 무보정(hardy)·무관 상승(adamant) → 무보정. 확정견딤은 무보정이 예산 밖이라 닿는 가장 싼 D 상승(20 < 30)
    expect(leads('hardy')).toEqual([1, 0, 0, 0])
    expect(leads('adamant')).toEqual([1, 0, 0, 0])
    // H가 고정이라 H 최대 배분은 없다(계단 작업도 그 갈래 고정 H에서만 기다렸다)
    expect(v.results.flatMap((r) => r.options).some((o) => o.kind === 'ok' && o.hMax !== undefined)).toBe(false)
    expect(v.keep).toEqual(['spd'])
    expect(v.relevant).toEqual(['hp', 'spd'])
  })

  it('조정할 쪽(B/D)이 고정이면 locked', () => {
    const f = physical()
    const p = locked(defensePlan(f), [branch('plus:def', 'bold', { hp: 20, def: 12 }), branch('out', 'hardy', { hp: 20, def: 18 })], 'plus:def', ['hp', 'def'])
    expect(adjustView(defInput(p, resultMap(extreme('f1', 'guaranteed-ohko', 'guaranteed-survive'))))?.state).toBe('locked')
  })
})

describe('adjustView: 방어 쌍 H 최대 배분', () => {
  /** A32·S 고정(쌍 고정 없음, H 고정 밖): 기준 S16+ 갈래 예산 66 − 48 = 18, out 갈래(S29) 예산 66 − 61 = 5 */
  function attackSpeedLocked(dependsOn: ExtremeSpec['dependsOn'] = []): TabPlan {
    const f: ExtremeSpec = {
      ...physical({ stat: 'def', neutral: 'timid', plus: 'timid' }),
      dependsOn,
      lock: { nature: 'timid', strict: { neutral: 'timid', plus: null }, viewLocked: false },
    }
    f.defender = { ...f.defender, nature: 'timid' }
    const branches = [branch('plus:spe', 'timid', { atk: 32, spe: 16 }), branch('out', 'hardy', { atk: 32, spe: 29 })]
    return locked(defensePlan(f), branches, 'plus:spe', ['atk', 'spe'])
  }
  const passed = extreme('f1', 'guaranteed-ohko', 'guaranteed-survive')
  // H 2당 B 1을 대신하는 계단(쌍 최소 합 점은 H 0)
  const pair = pairResult('f1', 'neutral', [point('high-roll-ohko', 0, 4), point('mid-roll-ohko', 0, 8), point('low-roll-ohko', 0, 12), point('guaranteed-survive', 0, 30)])
  const results = () => resultMap(passed, pair, ...stairsLine('timid', [4, 8, 12, 30], 2), ...stairsLine('impish', [2, 6, 10, 26], 2))

  it('예산이 모자라면 H 최대는 32보다 낮다: 예산 안에서 가장 큰 H와 그 H의 최소 B, 다음 순위에 닿는 H는 건너뛴다', () => {
    const v = ready(adjustView(defInput(attackSpeedLocked(), results())))
    expect(summary(v)).toEqual([
      // 저난수: H12 B6(합 18 = 예산). H14면 B5로 합 19
      { label: 'low-roll-ohko', lead: 0, current: false, options: ['hp0 def12 | hp12 def6', 'budget'] },
      { label: 'mid-roll-ohko', lead: 0, current: false, options: ['hp0 def8 | hp18 def0', 'budget'] },
      // 고난수: H16~18이면 B0으로 중난수에 닿아 정확하지 않아 H15. 상승(out 갈래)은 예산 5 안에서 H5
      { label: 'high-roll-ohko', lead: 0, current: false, options: ['hp0 def4 | hp15 def0', 'hp0 def2+ spe29L | hp5 def0+ spe29L'] },
      { label: 'guaranteed-ohko', lead: 0, current: false, options: ['hp0 def0', 'hp0 def0+ spe29L'] },
    ])
  })

  it('H 최대가 합 최소와 같으면(예산이 합 최소와 같고 H를 올릴 수 없음) 하나만 둔다', () => {
    // 판정이 의존하는 고정 밖 C6이 예산을 막아 기준 갈래 예산 12
    const v = ready(adjustView(defInput(attackSpeedLocked(['spa']), results(), { displaySp: sp({ spa: 6 }) })))
    expect(summary(v)[0]).toEqual({ label: 'low-roll-ohko', lead: 0, current: false, options: ['hp0 def12', 'budget'] })
  })
})
