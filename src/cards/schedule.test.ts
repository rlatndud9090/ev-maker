import { describe, expect, it } from 'vitest'
import { mayUnlockPair, nextStage, pendingTasks, taskKey } from './schedule'
import { card, ends, extreme, failed, filter, fixed, fixedResult, plan, resultMap, row, swept, bands } from './__fixtures__/handPlan'

describe('taskKey', () => {
  it('sweep은 단계와 무관하게 같은 키, 종류·id가 다르면 다른 키', () => {
    expect(taskKey({ kind: 'sweep', rowId: 'r', stage: 2 })).toBe(taskKey({ kind: 'sweep', rowId: 'r', stage: 3 }))
    const keys = [
      taskKey({ kind: 'ends', rowId: 'r' }),
      taskKey({ kind: 'sweep', rowId: 'r', stage: 2 }),
      taskKey({ kind: 'extreme', filterId: 'r' }),
      taskKey({ kind: 'fixed', fixedId: 'r' }),
      taskKey({ kind: 'pair', filterId: 'r' }),
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
    expect(pendingTasks(p, r)).toEqual({ stage1: [], stage2: [], stage3: [], stage4: [] })
    const r2 = resultMap(extreme('fA', 'x', 'x'), ends('a3', 'p', 'q'), failed({ kind: 'sweep', rowId: 'a3', stage: 2 }))
    expect(pendingTasks(p, r2).stage2).toEqual([])
  })

  describe('4단계: 방어 쌍', () => {
    const base = [extreme('fA', 'x', 'y'), ends('a1', 'p', 'q'), ends('a2', 'p', 'p'), ends('a3', 'p', 'p'), fixedResult('xA', 'k'), ends('b1', 'p', 'p')]
    const changing = swept('a1', bands([[10, 'p'], [32, 'q']]))
    const flat = swept('a2', bands([[32, 'p']]))

    it('필터 통과 + 두 행 스윕 완료 + 한 행이라도 변화 → pair 1건, 결과가 있으면 다시 내지 않는다', () => {
      const r = resultMap(...base, changing, flat)
      expect(pendingTasks(p, r).stage4).toEqual([{ kind: 'pair', filterId: 'fA' }])
      r.set(taskKey({ kind: 'pair', filterId: 'fA' }), { kind: 'pair', filterId: 'fA', points: [] })
      expect(pendingTasks(p, r).stage4).toEqual([])
    })

    it('한 행 스윕이 남았거나, 두 행 모두 변화 없거나, 필터에 걸리면 내지 않는다', () => {
      expect(pendingTasks(p, resultMap(...base, changing)).stage4).toEqual([])
      expect(pendingTasks(p, resultMap(...base, swept('a1', bands([[32, 'p']])), flat)).stage4).toEqual([])
      const blocked = [extreme('fA', 'x', 'x'), ...base.slice(1)]
      expect(pendingTasks(p, resultMap(...blocked, changing, flat)).stage4).toEqual([])
    })

    it('mayUnlockPair: 그 필터의 마지막 행 sweep일 때만 true', () => {
      const one = resultMap(...base, changing)
      expect(mayUnlockPair(p, one, { kind: 'sweep', rowId: 'a1', stage: 2 })).toBe(false)
      const both = resultMap(...base, changing, flat)
      expect(mayUnlockPair(p, both, { kind: 'sweep', rowId: 'a2', stage: 3 })).toBe(true)
      expect(mayUnlockPair(p, both, { kind: 'sweep', rowId: 'b1', stage: 3 })).toBe(false)
      expect(mayUnlockPair(p, both, { kind: 'ends', rowId: 'a2' })).toBe(false)
    })

    it('nextStage는 1 → 2 → 3 → 4 중 처음 비지 않은 단계', () => {
      const t = { kind: 'pair', filterId: 'fA' } as const
      expect(nextStage({ stage1: [], stage2: [], stage3: [], stage4: [t] })).toEqual([t])
      expect(nextStage({ stage1: [], stage2: [], stage3: [], stage4: [] })).toEqual([])
    })
  })
})
