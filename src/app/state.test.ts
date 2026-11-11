import { describe, expect, it } from 'vitest'
import { DEFAULT_CRITERIA, DEFAULT_ROLL_STEPS, DEFAULT_TOP_N } from '../cards'
import { realData } from '../cards/testing'
import { toPokemonSet } from '../ui/setDraft'
import { EXAMPLE_DRAFT } from './example'
import { toCardInput } from './input'
import { initialState, reducer, type AppAction, type AppState } from './state'

const start = (): AppState => initialState('m-c')
const run = (state: AppState, ...actions: AppAction[]): AppState => actions.reduce(reducer, state)

describe('initialState', () => {
  it('예시 세트·기본 메타·공격 탭·기본 기준·상위 30·세대 0', () => {
    const s = start()
    expect(s.draft).toEqual(EXAMPLE_DRAFT)
    expect(s.meta).toBeNull()
    expect(s.tab).toBe('attack')
    expect(s.criteria).toEqual(DEFAULT_CRITERIA)
    expect(s.filters).toEqual({ topN: DEFAULT_TOP_N, selected: [] })
    expect(s.conditions).toEqual({ myTailwind: false, opponentTailwind: false })
    expect(s.customTargets).toEqual([])
    expect(s.rollSteps).toBe(14)
    expect(s.rollSteps).toBe(DEFAULT_ROLL_STEPS)
    expect(s.generation).toBe(0)
  })
})

describe('reducer', () => {
  it('메타 변경은 선택을 비우고 세대를 올린다(같은 메타는 그대로)', () => {
    const picked = run(start(), { type: 'set-selected', ids: ['garchomp', 'incineroar'] })
    const next = reducer(picked, { type: 'set-meta', meta: { match: 'bo3', month: '2026-10' } })
    expect(next.filters.selected).toEqual([])
    expect(next.meta).toEqual({ match: 'bo3', month: '2026-10' })
    expect(next.generation).toBe(picked.generation + 1)
    expect(reducer(next, { type: 'set-meta', meta: { match: 'bo3', month: '2026-10' } })).toBe(next)
  })

  it('필터 비우기 → 상위 N 보기, 같은 선택은 그대로', () => {
    const picked = reducer(start(), { type: 'set-selected', ids: ['garchomp'] })
    expect(picked.generation).toBe(1)
    expect(reducer(picked, { type: 'set-selected', ids: ['garchomp'] })).toBe(picked)
    const cleared = reducer(picked, { type: 'set-selected', ids: [] })
    expect(cleared.filters.selected).toEqual([])
    expect(cleared.generation).toBe(2)
  })

  it('표시 기준 변경은 세대를 올리고 범위 밖 값은 무시한다', () => {
    const s = start()
    const next = reducer(s, { type: 'set-criteria', criteria: { bundleShareMin: 0.1, cardsPerCategory: 2 } })
    expect(next.criteria).toEqual({ ...DEFAULT_CRITERIA, bundleShareMin: 0.1, cardsPerCategory: 2 })
    expect(next.generation).toBe(1)
    for (const criteria of [{ bundleShareMin: NaN }, { rankShareMin: 1.5 }, { scarfShareMin: -0.1 }, { cardsPerCategory: 0 }, { cardsPerCategory: 2.5 }]) {
      expect(reducer(next, { type: 'set-criteria', criteria })).toBe(next)
    }
    expect(reducer(next, { type: 'set-criteria', criteria: { bundleShareMin: 0.1 } })).toBe(next)
  })

  it('고난수 기준은 1~15 정수 n 하나만 반영하고 세대를 올린다(같은 값·범위 밖·비정수는 그대로)', () => {
    const s = start()
    const next = reducer(s, { type: 'set-roll-steps', steps: 12 })
    expect(next.rollSteps).toBe(12)
    expect(next.generation).toBe(1)
    expect(reducer(next, { type: 'set-roll-steps', steps: 12 })).toBe(next)
    for (const steps of [0, 16, -1, 2.5, NaN, Infinity]) expect(reducer(next, { type: 'set-roll-steps', steps })).toBe(next)
    expect(reducer(s, { type: 'set-roll-steps', steps: 1 }).rollSteps).toBe(1)
    expect(reducer(s, { type: 'set-roll-steps', steps: 15 }).rollSteps).toBe(15)
    const back = reducer(next, { type: 'set-roll-steps', steps: 14 })
    expect(back.rollSteps).toBe(DEFAULT_ROLL_STEPS)
    expect(back.generation).toBe(2)
  })

  it('상위 N은 1 이상 정수만', () => {
    const s = start()
    expect(reducer(s, { type: 'set-top-n', topN: 10 }).filters.topN).toBe(10)
    for (const topN of [0, -3, 2.5, NaN]) expect(reducer(s, { type: 'set-top-n', topN })).toBe(s)
    expect(reducer(s, { type: 'set-top-n', topN: DEFAULT_TOP_N })).toBe(s)
  })

  it('드래그 확정은 세대를 올리고 같은 값 확정은 무변화', () => {
    const s = start()
    const next = reducer(s, { type: 'commit-sp', stat: 'atk', value: 28 })
    expect(next.draft.sp.atk).toBe('28')
    expect(next.generation).toBe(1)
    expect(reducer(next, { type: 'commit-sp', stat: 'atk', value: 28 })).toBe(next)
    expect(reducer(next, { type: 'commit-sp', stat: 'atk', value: NaN })).toBe(next)
  })

  it('탭 전환은 세대를 바꾸지 않는다', () => {
    const s = start()
    const next = reducer(s, { type: 'set-tab', tab: 'speed' })
    expect(next.tab).toBe('speed')
    expect(next.generation).toBe(0)
    expect(reducer(next, { type: 'set-tab', tab: 'speed' })).toBe(next)
  })

  it('순풍·세트 초안 변경', () => {
    const s = start()
    const wind = reducer(s, { type: 'set-tailwind', side: 'opponent', on: true })
    expect(wind.conditions).toEqual({ myTailwind: false, opponentTailwind: true })
    expect(wind.generation).toBe(1)
    expect(reducer(wind, { type: 'set-tailwind', side: 'opponent', on: true })).toBe(wind)
    expect(reducer(s, { type: 'set-draft', draft: { ...EXAMPLE_DRAFT } })).toBe(s)
    expect(reducer(s, { type: 'set-draft', draft: { ...EXAMPLE_DRAFT, nature: 'jolly' } }).generation).toBe(1)
  })

  it('목록 밖 타겟: 기술 0개·5개 이상·중복·이미 있는 타겟은 무시', () => {
    const s = start()
    expect(reducer(s, { type: 'add-custom-target', rosterId: 'rotomwash', moves: [] })).toBe(s)
    expect(reducer(s, { type: 'add-custom-target', rosterId: 'rotomwash', moves: ['a', 'b', 'c', 'd', 'e'] })).toBe(s)
    expect(reducer(s, { type: 'add-custom-target', rosterId: 'rotomwash', moves: ['hydropump', 'hydropump'] })).toBe(s)
    const added = reducer(s, { type: 'add-custom-target', rosterId: 'rotomwash', moves: ['hydropump', 'thunderbolt'] })
    expect(added.customTargets).toEqual([{ rosterId: 'rotomwash', moves: ['hydropump', 'thunderbolt'], edits: {} }])
    expect(added.generation).toBe(1)
    expect(reducer(added, { type: 'add-custom-target', rosterId: 'rotomwash', moves: ['hydropump'] })).toBe(added)
  })

  it('타겟 기술 편집은 1~4개만, 프리셋 편집·제거', () => {
    const added = reducer(start(), { type: 'add-custom-target', rosterId: 'rotomwash', moves: ['hydropump', 'thunderbolt'] })
    expect(reducer(added, { type: 'set-custom-moves', rosterId: 'rotomwash', moves: [] })).toBe(added)
    expect(reducer(added, { type: 'set-custom-moves', rosterId: 'rotomwash', moves: ['a', 'b', 'c', 'd', 'e'] })).toBe(added)
    expect(reducer(added, { type: 'set-custom-moves', rosterId: 'nope', moves: ['hydropump'] })).toBe(added)
    const one = reducer(added, { type: 'set-custom-moves', rosterId: 'rotomwash', moves: ['hydropump'] })
    expect(one.customTargets[0].moves).toEqual(['hydropump'])
    expect(one.generation).toBe(added.generation + 1)

    const key = JSON.stringify(['attack', 'physical', 0])
    const edited = reducer(one, { type: 'edit-preset', rosterId: 'rotomwash', key, edit: { sp: { hp: 32 }, nature: 'bold' } })
    expect(edited.customTargets[0].edits[key]).toEqual({ sp: { hp: 32 }, nature: 'bold' })
    expect(reducer(edited, { type: 'edit-preset', rosterId: 'rotomwash', key, edit: { sp: { hp: 32 }, nature: 'bold' } })).toBe(edited)

    const removed = reducer(edited, { type: 'remove-custom-target', rosterId: 'rotomwash' })
    expect(removed.customTargets).toEqual([])
    expect(reducer(removed, { type: 'remove-custom-target', rosterId: 'rotomwash' })).toBe(removed)
  })
})

describe('toCardInput', () => {
  it('초안을 보정 없이 세트로 풀고 상태 값을 그대로 넘긴다', () => {
    const { game, bo1 } = realData()
    const s = run(start(), { type: 'commit-sp', stat: 'hp', value: 10 }, { type: 'set-top-n', topN: 10 })
    const input = toCardInput(s, game, bo1)
    expect(input.mySet).toEqual(toPokemonSet(game, s.draft).set)
    expect(input.mySet.sp.hp).toBe(10)
    expect(input.filters.topN).toBe(10)
    expect(input.view).toBe(bo1)
    const strict = run(s, { type: 'set-roll-steps', steps: 15 })
    expect(toCardInput(strict, game, bo1).rollSteps).toBe(15)
    expect(input.rollSteps).toBe(14)
    const broken = reducer(s, { type: 'set-draft', draft: { ...s.draft, sp: { ...s.draft.sp, def: '' } } })
    expect(toCardInput(broken, game, bo1).mySet.sp.def).toBeNaN()
  })
})
