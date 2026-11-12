import { describe, expect, it, vi } from 'vitest'
import { assembleTab } from './assemble'
import { computeRowTask } from './rowTask'
import {
  bands,
  card,
  ends,
  extreme,
  failed,
  filter,
  fixed,
  fixedResult,
  pairResult,
  plan,
  resultMap,
  row,
  sp,
  swept,
  variantSwept,
} from './__fixtures__/handPlan'
import type { MoveNotice, RowView, TabView } from './types'

vi.mock('./rowTask', () => ({ computeRowTask: vi.fn() }))

const rowOf = (v: TabView, rowId: string): RowView => {
  const r = v.cards.flatMap((c) => c.rows).find((x) => x.id === rowId)
  if (!r) throw new Error(`행 ${rowId} 없음`)
  return r
}

describe('assembleTab: 칸·n·경계', () => {
  const cards = [card({ id: 'A', rowIds: ['ra', 'rh'] })]
  const rows = [row({ id: 'ra', cardId: 'A', stat: 'atk' }), row({ id: 'rh', cardId: 'A', order: 1, stat: 'hp', dependsOn: ['atk'] })]
  const results = resultMap(
    ends('ra', 'lo', 'hi'),
    swept('ra', bands([[12, 'lo'], [19, 'mid'], [32, 'hi']])),
    ends('rh', 'x', 'y'),
    swept('rh', bands([[5, 'x'], [32, 'y']])),
  )

  it('잔여 0: need = 칸 sp − 현재 SP, 현재 칸·경계 증감', () => {
    const mySp = sp({ atk: 16, hp: 32, spe: 18 })
    const v = assembleTab(plan({ cards, rows, mySp }), results)
    const r = rowOf(v, 'ra')
    expect(r.status).toBe('ok')
    expect(r.current).toEqual({ sp: 16, category: 'mid' })
    expect(r.cells[16]).toMatchObject({ need: 0, overBudget: false })
    expect(r.cells[17]).toMatchObject({ need: 1, overBudget: true })
    expect(r.cells[32].need).toBe(16)
    expect(r.boundaries).toEqual([
      { sp: 13, from: 'lo', to: 'mid', delta: -3, need: 0 },
      { sp: 20, from: 'mid', to: 'hi', delta: 4, need: 4 },
    ])
    expect(r.nearest).toEqual({ up: r.boundaries[1], down: r.boundaries[0] })
  })

  it('잔여가 있으면 그만큼 need가 줄고, 경계가 현재 SP와 같으면 아래쪽(delta 0)', () => {
    const v = assembleTab(plan({ cards, rows, mySp: sp({ atk: 13, hp: 10 }) }), results)
    const r = rowOf(v, 'ra')
    expect(r.cells[32].need).toBe(0)
    expect(r.cells.every((c) => !c.overBudget)).toBe(true)
    expect(r.nearest.down?.sp).toBe(13)
    expect(r.nearest.down?.delta).toBe(0)
    const tight = rowOf(assembleTab(plan({ cards, rows, mySp: sp({ atk: 0, hp: 32, def: 30 }) }), results), 'ra')
    expect(tight.cells.findIndex((c) => c.overBudget)).toBe(5)
    expect(tight.cells[5].need).toBe(1)
  })

  it('표시용 SP: 드래그 행은 현재 칸·경계 증감이, 모든 행은 n이 바뀌고 의존 행은 칸 그대로 stale(판정 재계산 0회)', () => {
    const mySp = sp({ atk: 16, hp: 32, spe: 18 })
    const p = plan({ cards, rows, mySp })
    const before = assembleTab(p, results)
    const after = assembleTab(p, results, { ...mySp, atk: 10 })
    expect(vi.mocked(computeRowTask)).not.toHaveBeenCalled()
    const ra = rowOf(after, 'ra')
    expect(ra.status).toBe('ok')
    expect(ra.current).toEqual({ sp: 10, category: 'lo' })
    expect(ra.boundaries.map((b) => b.delta)).toEqual([3, 10])
    expect(ra.cells[16].need).toBe(0)
    expect(ra.cells[17].need).toBe(1)
    const rh0 = rowOf(before, 'rh')
    const rh = rowOf(after, 'rh')
    expect(rh0.status).toBe('ok')
    expect(rh.status).toBe('stale')
    expect(rh.cells.map((c) => c.category)).toEqual(rh0.cells.map((c) => c.category))
    expect(rh.boundaries.map((b) => b.sp)).toEqual(rh0.boundaries.map((b) => b.sp))
    expect(rh0.cells[32].need).toBe(0)
    expect(rh.cells[32].need).toBe(0)
    const rhTight = rowOf(assembleTab(p, results, { ...mySp, atk: 10, def: 6, hp: 10 }), 'rh')
    expect(rhTight.current.sp).toBe(10)
    expect(rhTight.cells[32].need).toBe(0)
    expect(rowOf(assembleTab(p, results, { ...mySp, atk: 10, spe: 32 }), 'rh').cells[32].need).toBe(8)
  })
})

describe('assembleTab: headline·k', () => {
  const mySp = sp({ atk: 16, def: 16, spa: 16 })
  const rows = [
    row({ id: 'base', cardId: 'A', order: 0, stat: 'atk' }),
    row({ id: 'rank', cardId: 'A', order: 1, kind: 'rank', stat: 'def' }),
    row({ id: 'far', cardId: 'A', order: 2, stat: 'spa' }),
  ]
  const results = (a: number, b: number) =>
    resultMap(
      ends('base', 'l', 'h'),
      swept('base', bands([[a - 1, 'l'], [32, 'h']])),
      ends('rank', 'l', 'h'),
      swept('rank', bands([[b - 1, 'l'], [32, 'h']])),
      ends('far', 'l', 'h'),
      swept('far', bands([[29, 'l'], [32, 'h']])),
    )
  const p = plan({ cards: [card({ id: 'A', rowIds: ['base', 'rank', 'far'] })], rows, mySp })

  it('min |delta|가 가장 작은 행, 동률이면 base → rank', () => {
    expect(assembleTab(p, results(20, 18)).cards[0].headline).toEqual({ kind: 'row', rowId: 'rank' })
    expect(assembleTab(p, results(12, 20)).cards[0].headline).toEqual({ kind: 'row', rowId: 'base' })
    expect(assembleTab(p, results(20, 18)).cards[0].moreRows).toBe(2)
  })

  it('동률·같은 kind면 order 순', () => {
    const p2 = plan({
      cards: [card({ id: 'A', rowIds: ['r1', 'r0'] })],
      rows: [row({ id: 'r1', cardId: 'A', order: 1, stat: 'def' }), row({ id: 'r0', cardId: 'A', order: 0, stat: 'atk' })],
      mySp,
    })
    const r = resultMap(ends('r1', 'l', 'h'), swept('r1', bands([[19, 'l'], [32, 'h']])), ends('r0', 'l', 'h'), swept('r0', bands([[11, 'l'], [32, 'h']])))
    const c = assembleTab(p2, r).cards[0]
    expect(c.headline).toEqual({ kind: 'row', rowId: 'r0' })
    expect(c.rows.map((x) => x.id)).toEqual(['r0', 'r1'])
  })

  it('동률·같은 kind면 수단 순서가 아니라 기술 슬롯 순, 같은 기술은 H 행 → B 행', () => {
    const rk = (id: string, order: number, moveId: string) => row({ id, cardId: 'A', order, kind: 'rank', moveId, stat: 'atk' })
    // 계획은 수단마다 → 슬롯마다 쌓는다: 수단1(m1·m2), 수단2(m1·m2)
    const rows2 = [
      row({ id: 'b1', cardId: 'A', order: 0, moveId: 'm1' }),
      row({ id: 'b2', cardId: 'A', order: 1, moveId: 'm2' }),
      rk('x-m2', 3, 'm2'),
      rk('x-m1', 2, 'm1'),
      rk('y-m1', 4, 'm1'),
      rk('y-m2', 5, 'm2'),
    ]
    const p2 = plan({ cards: [card({ id: 'A', rowIds: ['b1', 'b2', 'x-m1', 'x-m2', 'y-m1', 'y-m2'] })], rows: rows2, mySp })
    const far = (id: string) => [ends(id, 'l', 'h'), swept(id, bands([[29, 'l'], [32, 'h']]))]
    const near = (id: string) => [ends(id, 'l', 'h'), swept(id, bands([[19, 'l'], [32, 'h']]))]
    const r = resultMap(...far('b1'), ...far('b2'), ...far('x-m1'), ...near('x-m2'), ...near('y-m1'), ...far('y-m2'))
    expect(assembleTab(p2, r).cards[0].headline).toEqual({ kind: 'row', rowId: 'y-m1' })

    const def = (id: string, order: number, stat: 'hp' | 'def') => row({ id, cardId: 'D', order, kind: 'rank', moveId: 'm1', stat, side: 'defender' })
    const p3 = plan({
      mySide: 'defender',
      cards: [card({ id: 'D', rowIds: ['x-h', 'x-b', 'y-h', 'y-b'] })],
      rows: [def('x-h', 0, 'hp'), def('x-b', 1, 'def'), def('y-h', 2, 'hp'), def('y-b', 3, 'def')],
      mySp: sp({ hp: 16, def: 16 }),
    })
    const r3 = resultMap(...far('x-h'), ...near('x-b'), ...near('y-h'), ...far('y-b'))
    expect(assembleTab(p3, r3).cards[0].headline).toEqual({ kind: 'row', rowId: 'y-h' })
  })

  it('드래그로 변화 있는 행이 stale이 되어 대표가 updating이어도 변동 가능은 유지된다(noChange는 표시 SP와 무관)', () => {
    const custom = plan({
      cards: [card({ id: 'C', source: 'custom', rowIds: ['base'] })],
      rows: [row({ id: 'base', cardId: 'C', stat: 'atk', dependsOn: ['def'] })],
      mySp,
    })
    const r = resultMap(ends('base', 'l', 'h'), swept('base', bands([[20, 'l'], [32, 'h']])))
    const idle = assembleTab(custom, r).cards[0]
    expect([idle.headline.kind, idle.variable]).toEqual(['row', true])
    const drag = assembleTab(custom, r, { ...mySp, def: 3 }).cards[0]
    expect([drag.rows[0].status, drag.headline.kind, drag.variable]).toEqual(['stale', 'updating', true])
  })

  it('ok 경계 행이 없으면 stale·pending → updating, 그다음 error', () => {
    const custom = plan({
      cards: [card({ id: 'C', source: 'custom', rowIds: ['base', 'rank'] })],
      rows: [row({ id: 'base', cardId: 'C', stat: 'atk' }), row({ id: 'rank', cardId: 'C', order: 1, stat: 'def', dependsOn: ['atk'] })],
      mySp,
    })
    expect(assembleTab(custom, new Map()).cards[0].headline).toEqual({ kind: 'updating' })
    const errBase = failed({ kind: 'ends', rowId: 'base' })
    const withErr = resultMap(errBase, ends('rank', 'l', 'h'), swept('rank', bands([[20, 'l'], [32, 'h']])))
    expect(assembleTab(custom, withErr).cards[0].headline).toEqual({ kind: 'row', rowId: 'rank' })
    expect(assembleTab(custom, withErr, { ...mySp, atk: 3 }).cards[0].headline).toEqual({ kind: 'updating' })
    const allErr = resultMap(errBase, failed({ kind: 'ends', rowId: 'rank' }))
    const c = assembleTab(custom, allErr).cards[0]
    expect(c.headline).toEqual({ kind: 'error', reason: (errBase as { reason: unknown }).reason })
    expect(c.moreRows).toBe(1)
  })

  it('안내(notices)는 headline·k에 들지 않는다', () => {
    const notice: MoveNotice = { kind: 'category-varies', moveId: 'shellsidearm', owner: 'opponent' }
    const tabNotice: MoveNotice = { kind: 'category-varies', moveId: 'shellsidearm', owner: 'me' }
    const pn = plan({ cards: [card({ id: 'A', rowIds: ['base', 'rank', 'far'], notices: [notice] })], rows, mySp, notices: [tabNotice] })
    const v = assembleTab(pn, results(20, 18))
    const plain = assembleTab(p, results(20, 18))
    expect(v.notices).toEqual([tabNotice])
    expect(v.cards[0].notices).toEqual([notice])
    expect({ ...v.cards[0], notices: [] }).toEqual(plain.cards[0])
  })

  it('변화 있는 행이 없으면 대표 행 = 기본 조건 가장 센 기술 행(선공기 행·랭크 행보다 앞), 변동 가능 아님, k = 표시 행 수 − 1', () => {
    const pr = plan({
      cards: [card({ id: 'A', rowIds: ['rank', 'pri', 'base'], conditions: [{ id: JSON.stringify(['base']), candidates: [
        { target: 'row', id: 'pri', moveId: 'm-pri', priority: true },
        { target: 'row', id: 'base', moveId: 'm-base', priority: false },
      ] }] })],
      rows: [
        row({ id: 'rank', cardId: 'A', order: 0, kind: 'rank', moveId: 'm-base', stat: 'atk' }),
        row({ id: 'pri', cardId: 'A', order: 1, moveId: 'm-pri', stat: 'atk' }),
        row({ id: 'base', cardId: 'A', order: 2, moveId: 'm-base', stat: 'atk' }),
      ],
      mySp,
    })
    const flat = (id: string, cat: string) => [ends(id, cat, cat), swept(id, bands([[32, cat]]))]
    const probes = resultMap(
      { kind: 'probe', id: 'pri', cell: { sp: 0, category: 'l', ohkoChance: 0, maxPercent: 30 } },
      { kind: 'probe', id: 'base', cell: { sp: 0, category: 'h', ohkoChance: 0, maxPercent: 60 } },
      ...flat('rank', 'h'),
      ...flat('pri', 'l'),
      ...flat('base', 'h'),
    )
    const c = assembleTab(pr, probes).cards[0]
    expect(c.rows.map((r) => [r.id, r.noChange, r.keptAsPriority ?? false])).toEqual([
      ['rank', true, false],
      ['pri', true, true],
      ['base', true, false],
    ])
    expect(c.headline).toEqual({ kind: 'row', rowId: 'base' })
    expect(c.variable).toBe(false)
    expect(c.moreRows).toBe(2)
    // 기본 조건 행이 아직 판정 전이면 updating(나중에 대표가 바뀔 수 있다)
    const early = new Map(probes)
    early.delete(JSON.stringify(['sweep', 'base']))
    expect(assembleTab(pr, early).cards[0].headline).toEqual({ kind: 'updating' })
  })

  it('변화 있는 행이 하나라도 있으면 그 행이 대표이고 카드는 변동 가능', () => {
    const c = assembleTab(p, results(20, 18)).cards[0]
    expect(c.headline).toEqual({ kind: 'row', rowId: 'rank' })
    expect(c.variable).toBe(true)
  })
})

describe('assembleTab: 변화 없음·카드 표시', () => {
  const rows = [
    row({ id: 'h', cardId: 'L', order: 0, stat: 'hp', side: 'defender', gate: 'f1' }),
    row({ id: 'b', cardId: 'L', order: 1, stat: 'def', side: 'defender', gate: 'f1' }),
    row({ id: 'same', cardId: 'L', order: 2, stat: 'hp', side: 'defender' }),
    row({ id: 'diff', cardId: 'L', order: 3, stat: 'hp', side: 'defender' }),
    row({ id: 'q', cardId: 'Q', stat: 'hp', side: 'defender' }),
  ]
  const p = plan({
    mySide: 'defender',
    cards: [
      card({ id: 'L', rowIds: ['h', 'b', 'same', 'diff'], filterIds: ['f1'], fixedIds: ['x1'] }),
      card({ id: 'Q', order: 1, rowIds: ['q'] }),
      card({ id: 'Z', order: 2 }),
    ],
    rows,
    filters: [filter('f1', 'L')],
    fixed: [fixed('x1', 'L')],
  })
  const stage1 = [extreme('f1', 'k', 'k'), ends('same', 'p', 'p'), ends('diff', 'p', 'q'), fixedResult('x1', 'fx'), ends('q', 'p', 'p')]

  it('래더 카드는 그 카드의 1·2단계(가장 센 기술·양 끝·변화 스윕)가 끝나야 보이고, 판정 변화와 무관하게 보인다', () => {
    const v0 = assembleTab(p, new Map())
    expect(v0.cards).toEqual([])
    expect(v0.stage12Done).toBe(false)
    const v1 = assembleTab(p, resultMap(...stage1))
    // L은 변화 스윕(2단계)이 남았고, Q는 확인 스윕(3단계)만 남아 판정 전 행으로 보인다. 행이 하나도 없는 Z는 없다.
    expect(v1.cards.map((c) => c.id)).toEqual(['Q'])
    expect(v1.cards[0].rows.map((r) => [r.id, r.status])).toEqual([['q', 'pending']])
    expect(v1.cards[0].headline).toEqual({ kind: 'updating' })
    expect(v1.progress).toEqual({ done: 5, total: 8 })
  })

  it('3단계 대기 행은 판정 전 행으로, 극단 필터에 걸린 기술·내 SP 무관 판정은 변화 없음 행으로 카드에 남는다', () => {
    const v = assembleTab(p, resultMap(...stage1, swept('diff', bands([[10, 'p'], [32, 'q']]))))
    expect(v.stage12Done).toBe(true)
    expect(v.complete).toBe(false)
    expect(v.cards.map((c) => c.id)).toEqual(['L', 'Q'])
    const l = v.cards[0]
    expect(l.rows.map((r) => [r.id, r.status, r.noChange, r.current.category ?? null])).toEqual([
      [JSON.stringify(['filter', 'f1']), 'ok', true, 'k'],
      ['same', 'pending', false, null],
      ['diff', 'ok', false, 'p'],
      [JSON.stringify(['fixed', 'x1']), 'ok', true, 'fx'],
    ])
    expect(l.headline).toEqual({ kind: 'row', rowId: 'diff' })
    expect(l.variable).toBe(true)
    expect(l.moreRows).toBe(3)
    // 내 SP 무관 판정 행은 결과 배지용 칸을 싣는다
    expect(l.rows[3].fixedCell).toEqual({ sp: 0, category: 'fx' })
  })

  it('완료: 변화 없음 카드(Q)도 목록에 남고 대표 행은 그 행, 변동 가능 아님', () => {
    const v = assembleTab(
      p,
      resultMap(...stage1, swept('diff', bands([[10, 'p'], [32, 'q']])), swept('same', bands([[32, 'p']])), swept('q', bands([[32, 'p']]))),
    )
    expect(v.complete).toBe(true)
    expect(v.progress).toEqual({ done: 8, total: 8 })
    expect(v.cards.map((c) => c.id)).toEqual(['L', 'Q'])
    expect(v.cards[0].rows.map((r) => r.noChange)).toEqual([true, true, false, true])
    expect([v.cards[0].variable, v.cards[0].moreRows]).toEqual([true, 3])
    const q = v.cards[1]
    expect(q.rows.map((r) => [r.id, r.noChange, r.current.category])).toEqual([['q', true, 'p']])
    expect(q.rows[0].cells).toHaveLength(33)
    expect(q.headline).toEqual({ kind: 'row', rowId: 'q' })
    expect([q.variable, q.moreRows]).toEqual([false, 0])
  })

  it('커스텀 카드는 계획 직후부터 보이고, 변화 없음 행·극단 필터 1행·고정 판정을 noChange 행으로 남긴다', () => {
    const pc = plan({
      mySide: 'defender',
      cards: [card({ id: 'C', source: 'custom', rowIds: ['h', 'b', 'same'], filterIds: ['f1'], fixedIds: ['x1'] })],
      rows: rows.slice(0, 3).map((r) => ({ ...r, cardId: 'C' })),
      filters: [filter('f1', 'C')],
      fixed: [fixed('x1', 'C')],
    })
    const v0 = assembleTab(pc, new Map())
    expect(v0.cards[0].rows.map((r) => r.status)).toEqual(['pending', 'pending', 'pending', 'pending'])
    expect(v0.cards[0].headline).toEqual({ kind: 'updating' })
    const v = assembleTab(pc, resultMap(extreme('f1', 'k', 'k'), ends('same', 'p', 'p'), swept('same', bands([[32, 'p']])), fixedResult('x1', 'fx')))
    const c = v.cards[0]
    expect(c.rows.map((r) => [r.noChange, r.current.category])).toEqual([
      [true, 'k'],
      [true, 'p'],
      [true, 'fx'],
    ])
    expect(c.rows[0].moveId).toBe('tackle')
    expect(c.rows[1].cells).toHaveLength(33)
    // 동률 순서(kind → 슬롯 → H 행 → 순번)로 첫 행 = 극단 필터 행
    expect(c.headline).toEqual({ kind: 'row', rowId: JSON.stringify(['filter', 'f1']) })
    expect([c.variable, c.moreRows]).toEqual([false, 2])
  })

  it('필터 오류는 gate 행 대신 오류 행 1개', () => {
    const v = assembleTab(p, resultMap(...stage1.slice(1), failed({ kind: 'extreme', filterId: 'f1' }), swept('diff', bands([[10, 'p'], [32, 'q']])), swept('same', bands([[32, 'p']]))))
    const c = v.cards.find((x) => x.id === 'L')
    expect(c?.rows.map((r) => r.status)).toEqual(['error', 'ok', 'ok', 'ok'])
    expect(c?.moreRows).toBe(3)
  })
})

describe('assembleTab: 탭 상태·오류 카드', () => {
  it('계획 오류는 그대로, 카드 없음', () => {
    const p = { ...plan({ cards: [] }), status: { kind: 'my-set-error' as const, reasons: [{ code: 'INVALID_SP' as const, message: 'x' }] } }
    const v = assembleTab(p, new Map())
    expect(v.status).toEqual(p.status)
    expect(v.cards).toEqual([])
    expect(v.complete).toBe(true)
  })

  it('행 오류 field가 내 쪽 접두면 my-set-error로 올리고, 상대 쪽이면 그 행만 오류', () => {
    const p = plan({ mySide: 'defender', cards: [card({ id: 'A', rowIds: ['r'] })], rows: [row({ id: 'r', cardId: 'A', stat: 'hp', side: 'defender' })] })
    const mine = assembleTab(p, resultMap(failed({ kind: 'ends', rowId: 'r' }, 'defender.ability')))
    expect(mine.status).toEqual({ kind: 'my-set-error', reasons: [{ code: 'ENGINE_UNSUPPORTED', field: 'defender.ability', message: '지원하지 않는다' }] })
    expect(mine.cards).toEqual([])
    const theirs = assembleTab(p, resultMap(failed({ kind: 'ends', rowId: 'r' }, 'attacker.ability')))
    expect(theirs.status).toEqual({ kind: 'ok' })
    expect(theirs.cards[0].rows[0]).toMatchObject({ status: 'error', error: { field: 'attacker.ability' } })
  })

  it('error 카드와 계획 단계 오류 행은 바로 보인다', () => {
    const reason = { code: 'ILLEGAL_MOVE' as const, message: '배울 수 없다' }
    const p = plan({
      cards: [card({ id: 'E', error: reason }), card({ id: 'W', order: 1, rowIds: ['w'] })],
      rows: [row({ id: 'w', cardId: 'W', error: { code: 'WHITE_HERB_MULTIHIT', message: 'x' } })],
    })
    const v = assembleTab(p, new Map())
    expect(v.cards.map((c) => [c.id, c.state, c.headline.kind])).toEqual([
      ['E', 'error', 'error'],
      ['W', 'ok', 'error'],
    ])
    expect(v.complete).toBe(true)
  })
})

describe('assembleTab: 성격 변형(무보정·상승)', () => {
  // 현재 성격 hardy = 무보정 변형, 상승 변형만 따로 계산한다.
  const natures = { stat: 'atk', neutral: 'hardy', plus: 'adamant' } as const
  const cards = [card({ id: 'A', rowIds: ['v'] }), card({ id: 'C', order: 1, source: 'custom', rowIds: ['c'] })]
  const rows = [row({ id: 'v', cardId: 'A', natures }), row({ id: 'c', cardId: 'C', natures })]
  const flat = bands([[32, 'guaranteed-survive']])
  const plusChanges = bands([
    [22, 'guaranteed-survive'],
    [32, 'low-roll-ohko'],
  ])
  const mySp = sp({ atk: 12 })
  const p = plan({ cards, rows, mySp })
  const base = [ends('v', 'guaranteed-survive', 'guaranteed-survive'), swept('v', flat), ends('c', 'guaranteed-survive', 'guaranteed-survive'), swept('c', flat)]

  it('현재 성격 칸이 다 같으면 변형 스윕 전에는 래더·커스텀 모두 잠정 noChange(provisional, 행은 보인다) — 대표는 updating', () => {
    const v = assembleTab(p, resultMap(...base))
    expect(v.complete).toBe(false)
    expect([rowOf(v, 'v').noChange, rowOf(v, 'v').provisional]).toEqual([true, true])
    expect(v.cards.find((c) => c.id === 'A')?.variable).toBe(false)
    expect(v.cards.map((c) => [c.id, c.headline.kind])).toEqual([
      ['A', 'updating'],
      ['C', 'updating'],
    ])
    expect([rowOf(v, 'c').noChange, rowOf(v, 'c').provisional]).toEqual([true, true])
    // 변형이 나오면 잠정 표지가 사라지고 대표 행이 선다(변화 없음 확정 또는 변동 가능).
    const done = assembleTab(p, resultMap(...base, variantSwept('v', 'plus', flat), variantSwept('c', 'plus', plusChanges)))
    expect([rowOf(done, 'v').provisional, rowOf(done, 'c').provisional]).toEqual([undefined, undefined])
    expect(done.cards.map((c) => [c.id, c.headline, c.variable])).toEqual([
      ['A', { kind: 'row', rowId: 'v' }, false],
      ['C', { kind: 'row', rowId: 'c' }, true],
    ])
  })

  it('상승 성격으로만 바뀌면 래더 행을 표시하고 목표는 변형 칸에서(무보정 불가 / 상승 최소), 대표 행도 된다', () => {
    const v = assembleTab(p, resultMap(...base, variantSwept('v', 'plus', plusChanges), variantSwept('c', 'plus', plusChanges)))
    const r = rowOf(v, 'v')
    expect(r.noChange).toBe(false)
    expect(r.boundaries).toEqual([])
    expect(r.target).toEqual({
      label: 'low-roll-ohko',
      goal: 'better',
      plusStat: 'atk',
      neutral: null,
      plus: { label: 'low-roll-ohko', stats: [{ stat: 'atk', sp: 23 }], need: 0 },
    })
    expect(v.cards.find((c) => c.id === 'A')?.headline).toEqual({ kind: 'row', rowId: 'v' })
    expect(v.cards.find((c) => c.id === 'A')?.variable).toBe(true)
    expect(rowOf(v, 'c').noChange).toBe(false)
    expect(v.complete).toBe(true)
  })

  it('변형도 같으면 래더·커스텀 행 모두 noChange(변동 가능 아님)', () => {
    const v = assembleTab(p, resultMap(...base, variantSwept('v', 'plus', flat), variantSwept('c', 'plus', flat)))
    expect(v.complete).toBe(true)
    expect([rowOf(v, 'v').noChange, rowOf(v, 'v').current.category]).toEqual([true, 'guaranteed-survive'])
    expect(v.cards.map((c) => [c.id, c.variable])).toEqual([
      ['A', false],
      ['C', false],
    ])
    expect(rowOf(v, 'c').noChange).toBe(true)
  })

  it('양 끝 range(무보정 0·상승 최대)가 다르면 변형 스윕 전에도 래더 행을 변화 있음으로 낸다(목표는 변형 결과 뒤)', () => {
    const v = assembleTab(p, resultMap(ends('v', 'guaranteed-survive', 'guaranteed-survive', ['guaranteed-survive', 'low-roll-ohko']), swept('v', flat)))
    const r = rowOf(v, 'v')
    expect([r.status, r.noChange, r.target]).toEqual(['ok', false, undefined])
  })

  it('변형 스윕이 오류면 목표 없음("상승 불가"로 보이지 않는다)', () => {
    const changing = bands([
      [9, 'guaranteed-survive'],
      [32, 'low-roll-ohko'],
    ])
    const r = resultMap(ends('v', 'guaranteed-survive', 'low-roll-ohko'), swept('v', changing))
    r.set(JSON.stringify(['variant', 'v', 'plus']), failed({ kind: 'variant', rowId: 'v', nature: 'plus' }))
    const v = assembleTab(plan({ cards: [cards[0]], rows: [rows[0]], mySp }), r)
    const row = rowOf(v, 'v')
    expect([row.status, row.noChange, row.target]).toEqual(['ok', false, undefined])
  })

  it('변형 결과가 남았으면 목표 없음, 진행 수는 변형·쌍 작업을 센다', () => {
    const changing = bands([
      [9, 'guaranteed-survive'],
      [32, 'low-roll-ohko'],
    ])
    const r = resultMap(ends('v', 'guaranteed-survive', 'low-roll-ohko'), swept('v', changing))
    const v = assembleTab(plan({ cards: [cards[0]], rows: [rows[0]], mySp }), r)
    expect(rowOf(v, 'v').target).toBeUndefined()
    expect(v.progress).toEqual({ done: 2, total: 3 })
  })

  it('방어 탭: 두 성격 쌍 결과가 다 나와야 목표, H행·D행이 같은 목표', () => {
    const dn = { stat: 'def', neutral: 'hardy', plus: 'impish' } as const
    const dp = plan({
      mySide: 'defender',
      cards: [card({ id: 'D', rowIds: ['h', 'b'], filterIds: ['f'] })],
      rows: [row({ id: 'h', cardId: 'D', stat: 'hp', side: 'defender', gate: 'f', natures: dn }), row({ id: 'b', cardId: 'D', order: 1, stat: 'def', side: 'defender', gate: 'f', natures: dn })],
      filters: [filter('f', 'D', 0, dn)],
      mySp: sp({ hp: 2, def: 0 }),
    })
    const cells = bands([
      [5, 'mid-roll-ohko'],
      [32, 'low-roll-ohko'],
    ])
    const flatLow = bands([[32, 'low-roll-ohko']])
    const r = resultMap(
      extreme('f', 'mid-roll-ohko', 'guaranteed-survive'),
      ends('h', 'mid-roll-ohko', 'low-roll-ohko'),
      ends('b', 'mid-roll-ohko', 'low-roll-ohko'),
      swept('h', cells),
      swept('b', cells),
      variantSwept('h', 'plus', flatLow),
      variantSwept('b', 'plus', flatLow),
      pairResult('f', 'neutral', [
        { atLeast: 'guaranteed-ohko', label: 'mid-roll-ohko', hp: 0, defense: 0 },
        { atLeast: 'high-roll-ohko', label: 'mid-roll-ohko', hp: 0, defense: 0 },
        { atLeast: 'mid-roll-ohko', label: 'mid-roll-ohko', hp: 0, defense: 0 },
        { atLeast: 'low-roll-ohko', label: 'low-roll-ohko', hp: 6, defense: 0 },
      ]),
    )
    expect(rowOf(assembleTab(dp, r), 'h').target).toBeUndefined()
    r.set(
      JSON.stringify(['pair', 'f', 'plus']),
      pairResult('f', 'plus', [
        { atLeast: 'guaranteed-ohko', label: 'low-roll-ohko', hp: 0, defense: 0 },
        { atLeast: 'high-roll-ohko', label: 'low-roll-ohko', hp: 0, defense: 0 },
        { atLeast: 'mid-roll-ohko', label: 'low-roll-ohko', hp: 0, defense: 0 },
        { atLeast: 'low-roll-ohko', label: 'low-roll-ohko', hp: 0, defense: 0 },
        { atLeast: 'guaranteed-survive', label: 'guaranteed-survive', hp: 4, defense: 10 },
      ]),
    )
    const v = assembleTab(dp, r)
    const want = {
      label: 'low-roll-ohko',
      goal: 'better',
      plusStat: 'def',
      neutral: { label: 'low-roll-ohko', stats: [{ stat: 'hp', sp: 6 }, { stat: 'def', sp: 0 }], need: 0 },
      plus: { label: 'low-roll-ohko', stats: [{ stat: 'hp', sp: 0 }, { stat: 'def', sp: 0 }], need: 0 },
    }
    expect(rowOf(v, 'h').target).toEqual(want)
    expect(rowOf(v, 'b').target).toEqual(want)
    expect(v.complete).toBe(true)
  })
})

describe('assembleTab: 판정 변화와 무관하게 래더 상대·배분 카드를 보인다(사용자 피드백 2026-11-12)', () => {
  const same = (c: ReturnType<typeof card>, opponent: string) => ({ ...c, opponent: { ...c.opponent, id: opponent } })
  const rows = [
    row({ id: 'a', cardId: 'A', stat: 'hp', side: 'defender' }),
    row({ id: 'b', cardId: 'B', stat: 'hp', side: 'defender' }),
    row({ id: 'c', cardId: 'C', stat: 'hp', side: 'defender' }),
  ]
  const p = plan({
    mySide: 'defender',
    cards: [same(card({ id: 'A', rowIds: ['a'] }), 'x'), same(card({ id: 'B', order: 1, rowIds: ['b'] }), 'x'), same(card({ id: 'C', order: 2, rowIds: ['c'] }), 'y')],
    rows,
  })
  const flat = bands([[32, 'p']])
  const stage1 = [ends('a', 'p', 'q'), ends('b', 'p', 'p'), ends('c', 'p', 'p')]

  it('완료: 변화 없음 배분(B)·어떤 배분도 변화가 없는 상대(C)도 행·대표 행과 함께 보이고, 변동 가능은 변화 있는 카드만', () => {
    const v = assembleTab(p, resultMap(...stage1, swept('a', bands([[10, 'p'], [32, 'q']])), swept('b', flat), swept('c', flat)))
    expect(v.complete).toBe(true)
    expect(v.cards.map((c) => [c.id, c.headline, c.variable])).toEqual([
      ['A', { kind: 'row', rowId: 'a' }, true],
      ['B', { kind: 'row', rowId: 'b' }, false],
      ['C', { kind: 'row', rowId: 'c' }, false],
    ])
    expect(v.cards[1].rows.map((r) => [r.id, r.status, r.noChange, r.current.category])).toEqual([['b', 'ok', true, 'p']])
  })

  it('모든 카드가 변화 없음이어도 전부 보인다', () => {
    const v = assembleTab(p, resultMap(ends('a', 'p', 'p'), ends('b', 'p', 'p'), ends('c', 'p', 'p'), swept('a', flat), swept('b', flat), swept('c', flat)))
    expect(v.complete).toBe(true)
    expect(v.cards.map((c) => [c.id, c.variable])).toEqual([
      ['A', false],
      ['B', false],
      ['C', false],
    ])
  })

  it('3단계 확인 스윕 전에는 판정 전 행(갱신 중)으로, 2단계가 남은 카드는 넣지 않는다', () => {
    const early = assembleTab(p, resultMap(...stage1))
    expect(early.cards.map((c) => c.id)).toEqual(['B', 'C'])
    expect(early.cards.map((c) => c.headline)).toEqual([{ kind: 'updating' }, { kind: 'updating' }])
    const v = assembleTab(p, resultMap(...stage1, swept('a', bands([[10, 'p'], [32, 'q']]))))
    expect(v.complete).toBe(false)
    expect(v.cards.map((c) => c.id)).toEqual(['A', 'B', 'C'])
    expect(v.cards[1].rows.map((r) => [r.id, r.status])).toEqual([['b', 'pending']])
  })
})
