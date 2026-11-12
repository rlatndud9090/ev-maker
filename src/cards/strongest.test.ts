// 카드·조건당 가장 센 기술 하나 + 선공기(사용자 피드백 2026-11-11). 손으로 만든 계획(규칙)과 실데이터(F12)로 확인한다.
import { describe, expect, it } from 'vitest'
import { F12 } from './__fixtures__/acceptance'
import { bands, card, ends, filter, fixed, plan, resultMap, row, swept } from './__fixtures__/handPlan'
import { assembleTab } from './assemble'
import { buildTabView } from './batch'
import { createLruCache } from './cache'
import { judgementKey } from './key'
import { planTab } from './plan'
import { computeRowTask } from './rowTask'
import { candidateStates, pendingTasks, probeKey, taskKey } from './schedule'
import { cardInput } from './testing'
import { DEFAULT_CRITERIA } from './types'
import type { CardInput, CardSpec, CompactCell, ConditionGroup, MoveCandidate, RowTaskResult, Tab, TabPlan, TabView } from './types'


const probe = (id: string, ohkoChance: number, maxPercent: number, extra: Partial<CompactCell> = {}): RowTaskResult => ({
  kind: 'probe',
  id,
  cell: { sp: 0, category: 'x', ohkoChance, maxPercent, ...extra },
})
const cand = (id: string, priority = false, target: MoveCandidate['target'] = 'row'): MoveCandidate => ({ target, id, moveId: `m-${id}`, priority })
const group = (...candidates: MoveCandidate[]): ConditionGroup => ({ id: JSON.stringify(['base']), candidates })

describe('candidateStates(손 계획)', () => {
  it('같은 조건의 단건 판정이 다 나오기 전에는 모두 probing', () => {
    const c = card({ id: 'c', conditions: [group(cand('a'), cand('b'))] })
    expect([...candidateStates(c, resultMap(probe('a', 1, 150))).values()]).toEqual(['probing', 'probing'])
  })

  it('1타 확률 → 최대 대미지 비율 → 앞 후보 순', () => {
    const c = card({ id: 'c', conditions: [group(cand('a'), cand('b'), cand('c'))] })
    expect(Object.fromEntries(candidateStates(c, resultMap(probe('a', 0.5, 200), probe('b', 0.75, 101), probe('c', 0.75, 101))))).toEqual({
      a: 'dropped',
      b: 'chosen',
      c: 'dropped',
    })
    expect(Object.fromEntries(candidateStates(c, resultMap(probe('a', 1, 150), probe('b', 1, 190), probe('c', 1, 160))))).toEqual({
      a: 'dropped',
      b: 'chosen',
      c: 'dropped',
    })
  })

  it('선공기는 약해도 priority로 남고, 무효·계산 불가는 고르지 않는다(무효 선공기도 남지 않음)', () => {
    const c = card({ id: 'c', conditions: [group(cand('imm'), cand('err'), cand('a'), cand('p', true), cand('pi', true))] })
    const results = resultMap(
      probe('imm', 0, 0, { immune: true }),
      { kind: 'error', task: { kind: 'probe', target: 'row', id: 'err' }, reason: { code: 'ILLEGAL_MOVE', message: 'x' } },
      probe('a', 0, 40),
      probe('p', 0, 30),
      probe('pi', 0, 0, { immune: true }),
    )
    expect(Object.fromEntries(candidateStates(c, results))).toEqual({ imm: 'dropped', err: 'error', a: 'chosen', p: 'priority', pi: 'dropped' })
  })

  it('선공기가 가장 세면 chosen, 모두 무효면 첫 후보만 chosen(무효 행으로 상대가 남는다)', () => {
    const c = card({ id: 'c', conditions: [group(cand('a'), cand('p', true))] })
    expect(Object.fromEntries(candidateStates(c, resultMap(probe('a', 0, 40), probe('p', 0, 50))))).toEqual({ a: 'dropped', p: 'chosen' })
    expect(Object.fromEntries(candidateStates(c, resultMap(probe('a', 0, 0, { immune: true }), probe('p', 0, 0, { immune: true }))))).toEqual({
      a: 'chosen',
      p: 'dropped',
    })
  })

  it('고정 판정(속임수)은 그 결과가 단건 판정이다', () => {
    const c = card({ id: 'c', conditions: [group(cand('f', false, 'fixed'), cand('a'))] })
    const f: RowTaskResult = { kind: 'fixed', fixedId: 'f', cell: { sp: 0, category: 'x', ohkoChance: 0, maxPercent: 60 } }
    expect(probeKey(cand('f', false, 'fixed'))).toBe(taskKey({ kind: 'fixed', fixedId: 'f' }))
    expect(Object.fromEntries(candidateStates(c, resultMap(f, probe('a', 0, 55))))).toEqual({ f: 'chosen', a: 'dropped' })
  })
})

describe('대기열·조립(손 계획)', () => {
  const rows = [row({ id: 'a', cardId: 'c', order: 0 }), row({ id: 'b', cardId: 'c', order: 1 }), row({ id: 'p', cardId: 'c', order: 2 })]
  const spec: CardSpec = card({ id: 'c', rowIds: ['a', 'b', 'p'], conditions: [group(cand('a'), cand('b'), cand('p', true))] })
  const p: TabPlan = plan({ cards: [spec], rows })

  it('1단계는 후보 단건 판정만, 고른 뒤에야 고른 후보(+선공기)의 양 끝이 나온다', () => {
    expect(pendingTasks(p, new Map()).stage1).toEqual([
      { kind: 'probe', target: 'row', id: 'a' },
      { kind: 'probe', target: 'row', id: 'b' },
      { kind: 'probe', target: 'row', id: 'p' },
    ])
    const probed = resultMap(probe('a', 0.5, 120), probe('b', 0.1, 90), probe('p', 0, 50))
    expect(pendingTasks(p, probed).stage1).toEqual([
      { kind: 'ends', rowId: 'a' },
      { kind: 'ends', rowId: 'p' },
    ])
  })

  it('고르지 않은 행은 표시·외 k행에 없고, 선공기 행은 keptAsPriority', () => {
    const results = resultMap(
      probe('a', 0.5, 120),
      probe('b', 0.1, 90),
      probe('p', 0, 50),
      ends('a', 'x', 'y'),
      ends('p', 'x', 'y'),
      swept('a', bands([[10, 'x'], [32, 'y']])),
      swept('p', bands([[20, 'x'], [32, 'y']])),
    )
    const view = assembleTab(p, results)
    expect(view.complete).toBe(true)
    const c = view.cards[0]
    expect(c.rows.map((r) => [r.id, r.keptAsPriority ?? false])).toEqual([
      ['a', false],
      ['p', true],
    ])
    expect(c.moreRows).toBe(1)
    expect(view.progress).toEqual({ done: 7, total: 7 })
  })

  it('고른 행이 변화 없음이어도 래더 카드는 그 행(가장 센 기술)을 대표로 목록에 남는다', () => {
    const one = card({ id: 'c', rowIds: ['a', 'b'], conditions: [group(cand('a'), cand('b'))] })
    const pl = plan({ cards: [one], rows: rows.slice(0, 2) })
    const view = assembleTab(pl, resultMap(probe('a', 1, 190), probe('b', 0.125, 101), ends('a', 'x', 'x'), swept('a', bands([[32, 'x']]))))
    expect(view.cards.map((c) => c.rows.map((r) => [r.id, r.noChange]))).toEqual([[['a', true]]])
    expect(view.cards[0].headline).toEqual({ kind: 'row', rowId: 'a' })
    expect(view.cards[0].variable).toBe(false)
  })

  it('모든 후보가 무효면 첫 후보를 고르고(무효 행이 남는다), 계산 불가 후보가 있으면 고르지 않는다', () => {
    const c = card({ id: 'c', conditions: [group(cand('a'), cand('b'), cand('p', true))] })
    const immune = (id: string) => probe(id, 0, 0, { immune: true })
    expect(Object.fromEntries(candidateStates(c, resultMap(immune('a'), immune('b'), immune('p'))))).toEqual({ a: 'chosen', b: 'dropped', p: 'dropped' })
    const err: RowTaskResult = { kind: 'error', task: { kind: 'probe', target: 'row', id: 'a' }, reason: { code: 'ILLEGAL_MOVE', message: 'x' } }
    expect(Object.fromEntries(candidateStates(c, resultMap(err, immune('b'), immune('p'))))).toEqual({ a: 'error', b: 'dropped', p: 'dropped' })
  })

  it('방어 탭: 필터 단위로 고르고 고른 필터만 극단 판정·H행·B행', () => {
    const f1 = filter('f1', 'c', 0)
    const f2 = filter('f2', 'c', 1)
    const dRows = [row({ id: 'h1', cardId: 'c', side: 'defender', stat: 'hp', gate: 'f1' }), row({ id: 'd1', cardId: 'c', side: 'defender', stat: 'def', gate: 'f1', order: 1 }), row({ id: 'h2', cardId: 'c', side: 'defender', stat: 'hp', gate: 'f2', order: 2 }), row({ id: 'd2', cardId: 'c', side: 'defender', stat: 'def', gate: 'f2', order: 3 })]
    const c = card({ id: 'c', rowIds: dRows.map((r) => r.id), filterIds: ['f1', 'f2'], conditions: [group(cand('f1', false, 'filter'), cand('f2', false, 'filter'))] })
    const pl = plan({ cards: [c], rows: dRows, filters: [f1, f2], mySide: 'defender' })
    const probed = new Map([
      [taskKey({ kind: 'probe', target: 'filter', id: 'f1' }), probe('f1', 0, 40)],
      [taskKey({ kind: 'probe', target: 'filter', id: 'f2' }), probe('f2', 0, 70)],
    ])
    expect(pendingTasks(pl, probed).stage1).toEqual([{ kind: 'extreme', filterId: 'f2' }])
  })

  it('고정 판정이 더 약하면 고정 행이 없다', () => {
    const f = fixed('f', 'c')
    const c = card({ id: 'c', rowIds: ['a'], fixedIds: ['f'], conditions: [group(cand('f', false, 'fixed'), cand('a'))] })
    const pl = plan({ cards: [c], rows: [rows[0]], fixed: [f] })
    const weak: RowTaskResult = { kind: 'fixed', fixedId: 'f', cell: { sp: 0, category: 'x', ohkoChance: 0, maxPercent: 10 } }
    const view = assembleTab(pl, resultMap(weak, probe('a', 0, 20), ends('a', 'x', 'y'), swept('a', bands([[5, 'x'], [32, 'y']]))))
    expect(view.cards[0].rows.map((r) => r.id)).toEqual(['a'])
  })
})

describe('분류를 가로지른 가장 센 기술(손 계획, 사용자 피드백 2026-11-11)', () => {
  const rows = [row({ id: 'a', cardId: 'c', order: 0 }), row({ id: 'p', cardId: 'c', order: 1 })]
  const crossSpec = { id: 'x', cardId: 'c', moveId: 'psychic', side: 'attacker' as const, attacker: rows[0].attacker, defender: rows[0].defender, conditions: {} }
  const conditions = [group(cand('a'), cand('x', false, 'probe'), cand('p', true))]

  it('다른 분류 기술(비교 전용 후보)도 1단계 단건 판정을 받고, 그 기술이 가장 세면 이 카드 행은 선공기만 남는다', () => {
    const spec = card({ id: 'c', rowIds: ['a', 'p'], conditions })
    const pl = plan({ cards: [spec], rows, probes: [crossSpec] })
    expect(pendingTasks(pl, new Map()).stage1).toEqual([
      { kind: 'probe', target: 'row', id: 'a' },
      { kind: 'probe', target: 'probe', id: 'x' },
      { kind: 'probe', target: 'row', id: 'p' },
    ])
    const probed = resultMap(probe('a', 0.5, 120), probe('x', 1, 150), probe('p', 0, 50))
    expect(Object.fromEntries(candidateStates(spec, probed))).toEqual({ a: 'dropped', x: 'chosen', p: 'priority' })
    expect(pendingTasks(pl, probed).stage1).toEqual([{ kind: 'ends', rowId: 'p' }])
  })

  it('다른 분류 기술이 가장 세고 선공기도 없으면 이 카드는 행이 없어 래더·커스텀 모두 표시하지 않는다(그 상대의 다른 분류 카드가 보인다)', () => {
    const only = [group(cand('a'), cand('x', false, 'probe'))]
    for (const source of ['ladder', 'custom'] as const) {
      const pl = plan({ cards: [card({ id: 'c', source, rowIds: ['a'], conditions: only })], rows: [rows[0]], probes: [crossSpec] })
      const view = assembleTab(pl, resultMap(probe('a', 0.5, 120), probe('x', 1, 150)))
      expect(view.complete, source).toBe(true)
      expect(view.cards, source).toEqual([])
      expect(view.progress, source).toEqual({ done: 2, total: 2 })
    }
  })

  it('비교 전용 후보뿐인 조건은 두지 않는다(실데이터: 모든 조건에 이 카드 행 후보가 있다)', () => {
    const input = cardInput({ mySet: F12.spSwitch.mySet, filters: { topN: 30, selected: [] } })
    for (const tab of ['attack', 'defense'] as const) {
      const pl = planTab(input, tab)
      for (const c of pl.cards) for (const g of c.conditions) expect(g.candidates.some((x) => x.target !== 'probe'), `${tab} ${c.id}`).toBe(true)
    }
  })
})

describe('probe 캐시 키', () => {
  const input = cardInput({ mySet: F12.sneasler.mySet, filters: { topN: 30, selected: [F12.sneasler.opponent.id] } })
  const pl = planTab(input, 'attack')
  const first = pl.cards[0]
  const ids = first.conditions[0].candidates.map((c) => c.id)

  it('작업 종류가 probe이고, 덮어쓰지 않으므로 내 스윕 능력치 SP가 키에 들어간다(양 끝 키에는 없음)', () => {
    const task = { kind: 'probe', target: 'row', id: ids[0] } as const
    const key = JSON.parse(judgementKey(pl, task)) as unknown[]
    expect(key[1]).toBe('probe')
    const moved = { ...pl, rows: { ...pl.rows, [ids[0]]: { ...pl.rows[ids[0]], attacker: { ...pl.rows[ids[0]].attacker, sp: { ...pl.rows[ids[0]].attacker.sp, atk: 20 } } } } }
    expect(judgementKey(moved, task)).not.toBe(judgementKey(pl, task))
    expect(judgementKey(moved, { kind: 'ends', rowId: ids[0] })).toBe(judgementKey(pl, { kind: 'ends', rowId: ids[0] }))
    expect(judgementKey(pl, task)).not.toBe(judgementKey(pl, { kind: 'ends', rowId: ids[0] }))
    expect(new Set(ids.map((id) => judgementKey(pl, { kind: 'probe', target: 'row', id }))).size).toBe(ids.length)
  })

  it('비교 전용 후보 키 = 같은 대표 배분 다른 분류 카드 행의 단건 판정 키(캐시 공유), 값도 같다', () => {
    const p2 = planTab(cardInput({ mySet: F12.spSwitch.mySet, filters: { topN: 30, selected: [F12.spSwitch.opponent.id] } }), 'attack')
    const of = (category: CardSpec['category']) =>
      p2.cards.find((c) => c.category === category && c.bundle.representativeSpread === F12.spSwitch.opponent.spread) as CardSpec
    const baseOf = (c: CardSpec) => c.conditions.find((g) => g.id === JSON.stringify(['base'])) as ConditionGroup
    const cross = baseOf(of('physical')).candidates.find((x) => x.moveId === 'psychic') as MoveCandidate
    const own = baseOf(of('special')).candidates.find((x) => x.moveId === 'psychic') as MoveCandidate
    expect([cross.target, own.target]).toEqual(['probe', 'row'])
    const crossTask = { kind: 'probe', target: 'probe', id: cross.id } as const
    const ownTask = { kind: 'probe', target: 'row', id: own.id } as const
    expect(judgementKey(p2, crossTask)).toBe(judgementKey(p2, ownTask))
    const a = computeRowTask(p2, crossTask)
    const b = computeRowTask(p2, ownTask)
    expect(a.kind === 'probe' && b.kind === 'probe' ? a.cell : a).toEqual(b.kind === 'probe' ? b.cell : b)
  })

  it('캐시 경유 = 무캐시', () => {
    const cache = createLruCache()
    for (const id of ids) {
      const task = { kind: 'probe', target: 'row', id } as const
      const direct = computeRowTask(pl, task)
      expect(computeRowTask(pl, task, cache)).toEqual(direct)
      expect(computeRowTask(pl, task, cache)).toEqual(direct)
    }
    expect(cache.size).toBe(ids.length)
  })
})

// ---------- 실데이터(F12, 수치 주장은 __fixtures__/acceptance.test가 코어로 봉인) ----------

const memo = new Map<string, { plan: TabPlan; view: TabView }>()
function run(label: string, input: CardInput, tab: Tab) {
  const key = JSON.stringify([label, tab])
  let hit = memo.get(key)
  if (!hit) {
    hit = { plan: planTab(input, tab), view: buildTabView(input, tab) }
    memo.set(key, hit)
  }
  return hit
}

function cardOf(p: TabPlan, view: TabView, ref: { id: string; spread: string }, category: CardSpec['category']) {
  const spec = p.cards.find((c) => c.opponent.id === ref.id && c.category === category && c.bundle.representativeSpread === ref.spread)
  if (!spec) throw new Error(`${ref.id} ${ref.spread} 카드가 없다`)
  return { spec, card: view.cards.find((c) => c.id === spec.id) }
}

/** 표시 행(변화 없음 행 포함)에 나온 (조건, 기술) 집합. 조건 = 랭크 수단 또는 기본 */
function movesByCondition(card: ReturnType<typeof cardOf>): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  const add = (basis: unknown, move: string | undefined) => {
    if (move === undefined) return
    const b = basis as { kind?: string; means?: { id: string } } | undefined
    const k = b?.kind === 'rank' ? (b.means?.id ?? 'rank') : 'base'
    out.set(k, new Set([...(out.get(k) ?? []), move]))
  }
  for (const r of card.card?.rows ?? []) add(r.basis, r.moveId)
  return out
}

describe('실데이터: 카드·조건당 가장 센 기술(+선공기)', () => {
  const example = cardInput({ mySet: F12.sneasler.mySet })

  it('포푸니크: 분함의발구르기만 계산하고(드래곤클로·지진·스톤샤워 행 없음) 그 행이 변화 없음 — 기본 기준(5%)에서 다른 배분도 변화 없음이어도 목록에 남는다(사용자 피드백 2026-11-12)', () => {
    const { plan: p, view } = run('example', example, 'attack')
    const c = cardOf(p, view, F12.sneasler.opponent, 'physical')
    expect(c.spec.conditions.map((g) => g.candidates.map((x) => x.moveId))).toEqual([['earthquake', 'dragonclaw', 'rockslide', 'stompingtantrum']])
    const all = view.cards.filter((x) => x.opponent.id === c.spec.opponent.id)
    expect(all.length).toBeGreaterThan(0)
    expect(all.every((x) => !x.variable)).toBe(true)
    expect(c.card?.rows.map((r) => [r.moveId, r.sweepStat, r.noChange, r.current.category])).toEqual([[F12.sneasler.chosen, 'atk', true, 'guaranteed-ohko']])
    expect(c.card?.headline).toEqual({ kind: 'row', rowId: c.card?.rows[0].id })
    for (const m of F12.sneasler.dropped) expect(c.card?.rows.some((r) => r.moveId === m)).toBe(false)
  })

  it('포푸니크(배분 기준 0.5%): 판정이 바뀌는 다른 배분은 변동 가능, 최대 배분 카드는 변화 없음 행 그대로', () => {
    const { plan: p, view } = run('example-bundle-0.005', cardInput({ mySet: F12.sneasler.mySet, criteria: { ...DEFAULT_CRITERIA, bundleShareMin: 0.005 } }), 'attack')
    const c = cardOf(p, view, F12.sneasler.opponent, 'physical')
    expect(c.spec.conditions.map((g) => g.candidates.map((x) => x.moveId))).toEqual([['earthquake', 'dragonclaw', 'rockslide', 'stompingtantrum']])
    // 같은 상대의 다른 카드에 변화 있는 행이 있다(그래서 이 카드도 선택지).
    const others = view.cards.filter((x) => x.opponent.id === c.spec.opponent.id && x.id !== c.spec.id)
    expect(others.some((x) => x.rows.some((r) => !r.noChange))).toBe(true)
    expect(c.card?.rows.map((r) => [r.moveId, r.noChange, r.current.category])).toEqual([[F12.sneasler.chosen, true, 'guaranteed-ohko']])
    expect(c.card?.headline).toEqual({ kind: 'row', rowId: c.card?.rows[0].id })
    expect([c.card?.variable, others.some((x) => x.variable)]).toEqual([false, true])
    for (const m of F12.sneasler.dropped) expect(c.card?.rows.some((r) => r.moveId === m)).toBe(false)
  })

  it('포푸니크 brave:29/32/5: 1타 확률·최대 대미지 비율 동률이면 슬롯이 앞선 지진', () => {
    const { plan: p, view } = run('example', example, 'attack')
    expect([...(movesByCondition(cardOf(p, view, F12.slotTie.opponent, 'physical')).get('base') ?? [])]).toEqual([F12.slotTie.chosen])
  })

  it('방어 탭 메가플라엣테: 둘 다 확정1타면 최대 대미지 비율이 큰 파멸의빛만(기본·명상 조건 각각)', () => {
    const { plan: p, view } = run('example', example, 'defense')
    const c = cardOf(p, view, F12.maxPercentTie.opponent, 'special')
    expect(c.spec.conditions.map((g) => g.candidates.length)).toEqual([5, 5])
    const by = movesByCondition(c)
    expect([...by.keys()].sort()).toEqual(['base', 'calmmind'])
    for (const moves of by.values()) expect([...moves]).toEqual([F12.maxPercentTie.chosen])
  })

  it('방어 탭 대도각참: 상위 5 후보 중 도각참(가장 셈)과 기습(선공기)만, 아이언헤드·안다리걸기 없음', () => {
    const { plan: p, view } = run('example', example, 'defense')
    const c = cardOf(p, view, F12.defense.opponent, 'physical')
    const by = movesByCondition(c)
    for (const moves of by.values()) {
      expect([...moves].every((m) => m === F12.defense.chosen || m === F12.defense.kept)).toBe(true)
      expect(moves.has(F12.defense.chosen)).toBe(true)
    }
    for (const m of F12.defense.dropped) expect([...by.values()].some((s) => s.has(m))).toBe(false)
    const kept = c.card?.rows.filter((r) => r.moveId === F12.defense.kept) ?? []
    expect(kept.every((r) => r.keptAsPriority === true)).toBe(true)
  })

  it('공격 탭 선공기: 기습은 도각참보다 약해도 keptAsPriority로 남고, 테일아머(키키링) 상대에게는 없다', () => {
    const input = cardInput({ mySet: F12.priority.mySet })
    const { plan: p, view } = run('priority', input, 'attack')
    const c = cardOf(p, view, F12.priority.opponent, 'physical')
    const base = c.card?.rows.filter((r) => r.kind === 'base') ?? []
    expect(base.map((r) => [r.moveId, r.keptAsPriority ?? false])).toEqual([
      [F12.priority.chosen, false],
      [F12.priority.kept, true],
    ])
    const imm = cardOf(p, view, F12.priority.immune.opponent, 'physical')
    expect([...movesByCondition(imm).values()].some((s) => s.has(F12.priority.immune.move))).toBe(false)
  })

  it('SP를 바꾸면(새 계획) 분류를 가로질러 다시 고른다: 메가후딘 C32 사이코키네시스(특수 카드) → A32 드레인펀치(물리 카드)', () => {
    const only = (mySet: CardInput['mySet']) => cardInput({ mySet, filters: { topN: 30, selected: [F12.spSwitch.opponent.id] } })
    for (const [label, mySet, want, shown, empty] of [
      ['C', F12.spSwitch.mySet, F12.spSwitch.special.chosen, 'special', 'physical'],
      ['A', F12.spSwitch.moved, F12.spSwitch.physical.chosen, 'physical', 'special'],
    ] as const) {
      const { plan: p, view } = run(`switch-${label}`, only(mySet), 'attack')
      expect([...(movesByCondition(cardOf(p, view, F12.spSwitch.opponent, shown)).get('base') ?? [])], label).toEqual([want])
      // 다른 분류 카드의 기본 조건 기술(사이코쇼크 / 사이코키네시스)은 더 약해 행이 없다.
      expect(movesByCondition(cardOf(p, view, F12.spSwitch.opponent, empty)).get('base'), label).toBeUndefined()
    }
  })
})

describe('극단 필터에 걸린 선공기 행(변화 없음 행으로 보이는 카드)', () => {
  it('고른 필터·선공기 필터가 둘 다 극단 필터에 걸리면 변화 없음 행 둘, 선공기 쪽만 keptAsPriority', () => {
    const f1 = filter('f1', 'c', 0)
    const f2 = filter('f2', 'c', 1)
    const dRows = [
      row({ id: 'h1', cardId: 'c', side: 'defender', stat: 'hp', gate: 'f1' }),
      row({ id: 'd1', cardId: 'c', side: 'defender', stat: 'def', gate: 'f1', order: 1 }),
      row({ id: 'h2', cardId: 'c', side: 'defender', stat: 'hp', gate: 'f2', order: 2 }),
      row({ id: 'd2', cardId: 'c', side: 'defender', stat: 'def', gate: 'f2', order: 3 }),
    ]
    const c = card({ id: 'c', source: 'custom', rowIds: dRows.map((r) => r.id), filterIds: ['f1', 'f2'], conditions: [group(cand('f1', false, 'filter'), cand('f2', true, 'filter'))] })
    const pl = plan({ cards: [c], rows: dRows, filters: [f1, f2], mySide: 'defender' })
    const results = new Map<string, RowTaskResult>([
      [taskKey({ kind: 'probe', target: 'filter', id: 'f1' }), probe('f1', 0, 70)],
      [taskKey({ kind: 'probe', target: 'filter', id: 'f2' }), probe('f2', 0, 40)],
      [taskKey({ kind: 'extreme', filterId: 'f1' }), { kind: 'extreme', filterId: 'f1', low: { sp: 0, category: 'k' }, high: { sp: 32, category: 'k' } }],
      [taskKey({ kind: 'extreme', filterId: 'f2' }), { kind: 'extreme', filterId: 'f2', low: { sp: 0, category: 'k' }, high: { sp: 32, category: 'k' } }],
    ])
    const v = assembleTab(pl, results)
    expect(v.complete).toBe(true)
    expect(v.cards[0].rows.map((r) => [r.id, r.noChange, r.keptAsPriority ?? false])).toEqual([
      [JSON.stringify(['filter', 'f1']), true, false],
      [JSON.stringify(['filter', 'f2']), true, true],
    ])
  })
})
