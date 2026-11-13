import { describe, expect, it } from 'vitest'
import { mayUnlockPair, neededVariants, nextStage, pendingTasks, primaryCardIds, rowChanges, rowJudgements, taskCardId, taskKey } from './schedule'
import { createTabAssembler } from './assemble'
import { card, ends, extreme, failed, filter, fixed, fixedResult, pairResult, plan, resultMap, row, swept, bands, variantSwept } from './__fixtures__/handPlan'

describe('taskKey', () => {
  it('sweep은 단계와 무관하게 같은 키, 종류·id가 다르면 다른 키', () => {
    expect(taskKey({ kind: 'sweep', rowId: 'r', stage: 2 })).toBe(taskKey({ kind: 'sweep', rowId: 'r', stage: 3 }))
    const keys = [
      taskKey({ kind: 'ends', rowId: 'r' }),
      taskKey({ kind: 'sweep', rowId: 'r', stage: 2 }),
      taskKey({ kind: 'extreme', filterId: 'r' }),
      taskKey({ kind: 'fixed', fixedId: 'r' }),
      taskKey({ kind: 'pair', filterId: 'r', nature: 'neutral' }),
      taskKey({ kind: 'pair', filterId: 'r', nature: 'plus' }),
      taskKey({ kind: 'variant', rowId: 'r', nature: 'neutral' }),
      taskKey({ kind: 'variant', rowId: 'r', nature: 'plus' }),
      taskKey({ kind: 'ends', rowId: 'r2' }),
    ]
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('pendingTasks', () => {
  const p = plan({
    cards: [
      card({ id: 'A', order: 0, rowIds: ['a1', 'a2', 'a3'], filterIds: ['fA'], fixedIds: ['xA'] }),
      card({ id: 'B', order: 1, rowIds: ['b1', 'bErr'] }),
      card({ id: 'E', order: 2, error: { code: 'ILLEGAL_MOVE', message: 'x' }, rowIds: ['e1'] }),
    ],
    rows: [
      row({ id: 'a1', cardId: 'A', order: 0, stat: 'hp', side: 'defender', gate: 'fA' }),
      row({ id: 'a2', cardId: 'A', order: 1, stat: 'def', side: 'defender', gate: 'fA' }),
      row({ id: 'a3', cardId: 'A', order: 2 }),
      row({ id: 'b1', cardId: 'B' }),
      row({ id: 'bErr', cardId: 'B', order: 1, error: { code: 'WHITE_HERB_MULTIHIT', message: 'x' } }),
      row({ id: 'e1', cardId: 'E' }),
    ],
    filters: [filter('fA', 'A')],
    fixed: [fixed('xA', 'A')],
  })

  it('1단계: 카드 순 → 필터·gate 없는 양 끝·고정, gate 행·error 행·error 카드는 내지 않는다', () => {
    expect(pendingTasks(p, new Map())).toEqual({
      stage1: [
        { kind: 'extreme', filterId: 'fA' },
        { kind: 'ends', rowId: 'a3' },
        { kind: 'fixed', fixedId: 'xA' },
        { kind: 'ends', rowId: 'b1' },
      ],
      stage2: [],
      stage3: [],
      stage4: [],
      stage5: [],
    })
  })

  it('필터 통과 → gate 행 양 끝, 양 끝이 다르면 2단계·같으면 3단계', () => {
    const r = resultMap(extreme('fA', 'x', 'y'), ends('a3', 'p', 'q'), fixedResult('xA', 'k'), ends('b1', 'p', 'p'))
    expect(pendingTasks(p, r)).toEqual({
      stage1: [
        { kind: 'ends', rowId: 'a1' },
        { kind: 'ends', rowId: 'a2' },
      ],
      stage2: [{ kind: 'sweep', rowId: 'a3', stage: 2 }],
      stage3: [{ kind: 'sweep', rowId: 'b1', stage: 3 }],
      stage4: [],
      stage5: [],
    })
  })

  it('필터에 걸리거나 필터가 오류면 gate 행 작업이 생기지 않는다(최종 확정)', () => {
    for (const f of [extreme('fA', 'x', 'x'), failed({ kind: 'extreme', filterId: 'fA' })]) {
      const r = resultMap(f, ends('a3', 'p', 'p'), fixedResult('xA', 'k'), ends('b1', 'p', 'p'))
      expect(pendingTasks(p, r).stage1).toEqual([])
    }
  })

  it('결과(오류 포함)가 있는 작업은 다시 내지 않는다', () => {
    const r = resultMap(
      extreme('fA', 'x', 'x'),
      failed({ kind: 'ends', rowId: 'a3' }),
      failed({ kind: 'fixed', fixedId: 'xA' }),
      ends('b1', 'p', 'p'),
      swept('b1', bands([[32, 'p']])),
    )
    expect(pendingTasks(p, r)).toEqual({ stage1: [], stage2: [], stage3: [], stage4: [], stage5: [] })
    const r2 = resultMap(extreme('fA', 'x', 'x'), ends('a3', 'p', 'q'), failed({ kind: 'sweep', rowId: 'a3', stage: 2 }))
    expect(pendingTasks(p, r2).stage2).toEqual([])
  })

  describe('5단계: 방어 쌍', () => {
    const base = [extreme('fA', 'x', 'y'), ends('a1', 'p', 'q'), ends('a2', 'p', 'p'), ends('a3', 'p', 'p'), fixedResult('xA', 'k'), ends('b1', 'p', 'p')]
    const changing = swept('a1', bands([[10, 'p'], [32, 'q']]))
    const flat = swept('a2', bands([[32, 'p']]))

    it('필터 통과 + 두 행 스윕 완료 + 한 행이라도 변화 → 성격 변형마다 pair 1건, 결과가 있으면 다시 내지 않는다', () => {
      const r = resultMap(...base, changing, flat)
      expect(pendingTasks(p, r).stage5).toEqual([
        { kind: 'pair', filterId: 'fA', nature: 'neutral' },
        { kind: 'pair', filterId: 'fA', nature: 'plus' },
      ])
      r.set(taskKey({ kind: 'pair', filterId: 'fA', nature: 'neutral' }), pairResult('fA', 'neutral', []))
      expect(pendingTasks(p, r).stage5).toEqual([{ kind: 'pair', filterId: 'fA', nature: 'plus' }])
      r.set(taskKey({ kind: 'pair', filterId: 'fA', nature: 'plus' }), pairResult('fA', 'plus', []))
      expect(pendingTasks(p, r).stage5).toEqual([])
    })

    it('한 행 스윕이 남았거나, 두 행 모두 변화 없거나, 필터에 걸리면 내지 않는다', () => {
      expect(pendingTasks(p, resultMap(...base, changing)).stage5).toEqual([])
      // 양 끝 칸도 실제 칸이라 변화 판단에 들어간다: 두 행 모두 양 끝·스윕이 같아야 변화 없음
      expect(pendingTasks(p, resultMap(...base, ends('a1', 'p', 'p'), swept('a1', bands([[32, 'p']])), flat)).stage5).toEqual([])
      const blocked = [extreme('fA', 'x', 'x'), ...base.slice(1)]
      expect(pendingTasks(p, resultMap(...blocked, changing, flat)).stage5).toEqual([])
    })

    it('mayUnlockPair: 그 필터의 마지막 행 sweep일 때만 true', () => {
      const one = resultMap(...base, changing)
      expect(mayUnlockPair(p, one, { kind: 'sweep', rowId: 'a1', stage: 2 })).toBe(false)
      const both = resultMap(...base, changing, flat)
      expect(mayUnlockPair(p, both, { kind: 'sweep', rowId: 'a2', stage: 3 })).toBe(true)
      expect(mayUnlockPair(p, both, { kind: 'sweep', rowId: 'b1', stage: 3 })).toBe(false)
      expect(mayUnlockPair(p, both, { kind: 'ends', rowId: 'a2' })).toBe(false)
    })

    it('nextStage는 1 → 2 → 3 → 4 → 5 중 처음 비지 않은 단계', () => {
      const t = { kind: 'pair', filterId: 'fA', nature: 'plus' } as const
      const v = { kind: 'variant', rowId: 'a1', nature: 'plus' } as const
      expect(nextStage({ stage1: [], stage2: [], stage3: [], stage4: [], stage5: [t] })).toEqual([t])
      expect(nextStage({ stage1: [], stage2: [], stage3: [], stage4: [v], stage5: [t] })).toEqual([v])
      expect(nextStage({ stage1: [], stage2: [], stage3: [], stage4: [], stage5: [] })).toEqual([])
    })
  })
})

describe('4단계: 성격 변형 스윕', () => {
  // v1: 무보정 = 현재(hardy), 상승만 다름. v2: 두 변형 모두 현재와 다름. 방어 쌍 행 g1·g2는 필터와 같은 변형.
  const natures = { stat: 'atk', neutral: 'hardy', plus: 'adamant' } as const
  const p = plan({
    cards: [card({ id: 'A', rowIds: ['v1', 'v2'] }), card({ id: 'D', order: 1, rowIds: ['g1', 'g2'], filterIds: ['fD'] })],
    rows: [
      row({ id: 'v1', cardId: 'A', natures }),
      row({ id: 'v2', cardId: 'A', order: 1, natures: { stat: 'atk', neutral: 'bashful', plus: 'adamant' }, nature: 'modest' }),
      row({ id: 'g1', cardId: 'D', stat: 'hp', side: 'defender', gate: 'fD', natures: { stat: 'def', neutral: 'hardy', plus: 'bold' } }),
      row({ id: 'g2', cardId: 'D', order: 1, stat: 'def', side: 'defender', gate: 'fD', natures: { stat: 'def', neutral: 'hardy', plus: 'bold' } }),
    ],
    filters: [filter('fD', 'D', 0, { stat: 'def', neutral: 'hardy', plus: 'bold' })],
  })
  const pd = { ...p, mySide: 'defender' as const }

  it('현재 성격과 같은 변형은 작업을 만들지 않는다', () => {
    expect(neededVariants(p, p.rows.v1)).toEqual(['plus'])
    expect(neededVariants(p, p.rows.v2)).toEqual(['neutral', 'plus'])
  })

  it('양 끝이 나온 행마다 변형 스윕을 4단계로 낸다(현재 스윕 2·3단계와 별개)', () => {
    const r = resultMap(ends('v1', 'p', 'p'), ends('v2', 'p', 'q'))
    const t = pendingTasks(p, r)
    expect(t.stage2).toEqual([{ kind: 'sweep', rowId: 'v2', stage: 2 }])
    expect(t.stage3).toEqual([{ kind: 'sweep', rowId: 'v1', stage: 3 }])
    expect(t.stage4).toEqual([
      { kind: 'variant', rowId: 'v1', nature: 'plus' },
      { kind: 'variant', rowId: 'v2', nature: 'neutral' },
      { kind: 'variant', rowId: 'v2', nature: 'plus' },
    ])
    r.set(taskKey({ kind: 'variant', rowId: 'v1', nature: 'plus' }), variantSwept('v1', 'plus', bands([[32, 'p']])))
    expect(pendingTasks(p, r).stage4).toHaveLength(2)
  })

  it('양 끝 range(무보정 0·상승 최대)만 달라도 2단계 스윕으로 올린다', () => {
    expect(pendingTasks(p, resultMap(ends('v1', 'p', 'p', ['p', 'q']))).stage2).toEqual([{ kind: 'sweep', rowId: 'v1', stage: 2 }])
  })

  it('rowJudgements: 현재와 같은 변형은 현재 칸을 쓰고, 빠진 변형이 있으면 variantsDone false', () => {
    const cur = bands([[32, 'p']])
    const plus = bands([[20, 'p'], [32, 'q']])
    const r = resultMap(ends('v1', 'p', 'p', ['p', 'q']), swept('v1', cur))
    expect(rowJudgements(p, r, 'v1')).toEqual({ current: cur, neutral: cur, variantsDone: false })
    r.set(taskKey({ kind: 'variant', rowId: 'v1', nature: 'plus' }), variantSwept('v1', 'plus', plus))
    const j = rowJudgements(p, r, 'v1')
    expect(j).toEqual({ current: cur, neutral: cur, plus, variantsDone: true })
    const e = r.get(taskKey({ kind: 'ends', rowId: 'v1' }))
    if (e?.kind !== 'ends') throw new Error('ends')
    expect(rowChanges(e, j)).toBe(true)
    expect(rowChanges({ ...e, range: { low: e.low, high: e.high } }, { variantsDone: true, current: cur, neutral: cur, plus: cur })).toBe(false)
  })

  it('rowChanges: 현재 성격(하락 보정) 칸만 바뀌고 무보정·상승이 전부 같으면 변화 없음', () => {
    // v2는 현재 성격이 조심(A 하락). 현재 칸은 p → q로 바뀌지만 무보정·상승 33칸은 전부 p.
    const flat = bands([[32, 'p']])
    const r = resultMap(ends('v2', 'q', 'p', ['p', 'p']), swept('v2', bands([[3, 'q'], [32, 'p']])))
    expect(pendingTasks(p, r).stage2).toEqual([])
    r.set(taskKey({ kind: 'variant', rowId: 'v2', nature: 'neutral' }), variantSwept('v2', 'neutral', flat))
    r.set(taskKey({ kind: 'variant', rowId: 'v2', nature: 'plus' }), variantSwept('v2', 'plus', flat))
    const e = r.get(taskKey({ kind: 'ends', rowId: 'v2' }))
    if (e?.kind !== 'ends') throw new Error('ends')
    expect(rowChanges(e, rowJudgements(p, r, 'v2'))).toBe(false)
    expect(rowChanges(e, { variantsDone: false })).toBe(false)
  })

  it('방어 쌍: 두 행의 현재·변형 스윕이 모두 끝나야 pair를 내고, 변형으로만 바뀌어도 낸다', () => {
    const flat = bands([[32, 'p']])
    const base = [extreme('fD', 'p', 'q'), ends('g1', 'p', 'p'), ends('g2', 'p', 'p'), swept('g1', flat), swept('g2', flat)]
    const r = resultMap(...base, variantSwept('g1', 'plus', flat))
    expect(pendingTasks(pd, r).stage5).toEqual([])
    expect(mayUnlockPair(pd, r, { kind: 'variant', rowId: 'g1', nature: 'plus' })).toBe(false)
    r.set(taskKey({ kind: 'variant', rowId: 'g2', nature: 'plus' }), variantSwept('g2', 'plus', bands([[25, 'p'], [32, 'q']])))
    expect(mayUnlockPair(pd, r, { kind: 'variant', rowId: 'g2', nature: 'plus' })).toBe(true)
    expect(pendingTasks(pd, r).stage5).toEqual([
      { kind: 'pair', filterId: 'fD', nature: 'neutral' },
      { kind: 'pair', filterId: 'fD', nature: 'plus' },
    ])
    const allFlat = resultMap(...base, variantSwept('g1', 'plus', flat), variantSwept('g2', 'plus', flat))
    expect(pendingTasks(pd, allFlat).stage5).toEqual([])
  })
})

describe('primaryCardIds·taskCardId·증분 pending', () => {
  const as = (c: ReturnType<typeof card>, opponent: string, patch: Partial<ReturnType<typeof card>['bundle']> = {}, category: 'physical' | 'special' = 'physical') => ({
    ...c,
    category,
    opponent: { ...c.opponent, id: opponent },
    bundle: { ...c.bundle, ...patch },
  })
  const p = plan({
    cards: [
      as(card({ id: 'x1', rowIds: ['r1'] }), 'x', { share: 0.5 }),
      as(card({ id: 'x2', order: 1, rowIds: ['r2'] }), 'x', { share: 0.1 }),
      as(card({ id: 'x3', order: 2 }), 'x', { share: 0.3 }, 'special'),
      as(card({ id: 'xu', order: 3 }), 'x', { userAdded: 0 }),
      as(card({ id: 'y1', order: 4, filterIds: ['fy'], fixedIds: ['xy'] }), 'y', { share: 0.2 }),
      card({ id: 'c1', order: 5, source: 'custom' }),
      card({ id: 'c2', order: 6, source: 'custom' }),
    ],
    rows: [row({ id: 'r1', cardId: 'x1', stat: 'atk' }), row({ id: 'r2', cardId: 'x2', stat: 'atk' })],
    filters: [filter('fy', 'y1')],
    fixed: [fixed('xy', 'y1')],
  })

  it('래더 상대·분류마다 계획 순 첫 관측 카드 + 사용자 추가 카드 + 커스텀 카드 전부', () => {
    expect([...primaryCardIds(p)]).toEqual(['x1', 'x3', 'xu', 'y1', 'c1', 'c2'])
  })

  it('작업 → 카드 id', () => {
    expect(taskCardId(p, { kind: 'ends', rowId: 'r2' })).toBe('x2')
    expect(taskCardId(p, { kind: 'sweep', rowId: 'r1', stage: 3 })).toBe('x1')
    expect(taskCardId(p, { kind: 'variant', rowId: 'r1', nature: 'plus' })).toBe('x1')
    expect(taskCardId(p, { kind: 'extreme', filterId: 'fy' })).toBe('y1')
    expect(taskCardId(p, { kind: 'pair', filterId: 'fy', nature: 'neutral' })).toBe('y1')
    expect(taskCardId(p, { kind: 'fixed', fixedId: 'xy' })).toBe('y1')
    expect(taskCardId(p, { kind: 'probe', target: 'row', id: 'r2' })).toBe('x2')
    expect(taskCardId(p, { kind: 'probe', target: 'filter', id: 'fy' })).toBe('y1')
  })

  it('증분 조립기의 pending은 결과가 바뀐 카드만 invalidate해도 pendingTasks와 같고, 카드 필터로 층을 나눈다', () => {
    const asm = createTabAssembler(p)
    const results = new Map()
    expect(asm.pending(results)).toEqual(pendingTasks(p, results))
    for (const r of [ends('r1', 'a', 'b'), extreme('fy', 'k', 'k'), fixedResult('xy', 'q')]) {
      const [k, v] = [...resultMap(r)][0]
      results.set(k, v)
    }
    for (const id of ['x1', 'y1']) asm.invalidate(id)
    expect(asm.pending(results)).toEqual(pendingTasks(p, results))
    const primary = primaryCardIds(p)
    const first = asm.pending(results, (id) => primary.has(id))
    const rest = asm.pending(results, (id) => !primary.has(id))
    expect(first.stage1).toEqual([])
    expect(first.stage2).toEqual([{ kind: 'sweep', rowId: 'r1', stage: 2 }])
    expect(rest.stage1).toEqual([{ kind: 'ends', rowId: 'r2' }])
  })
})
