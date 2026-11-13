import { describe, expect, it } from 'vitest'
import { BASE_CONDITION_ID, DEFAULT_CRITERIA, DEFAULT_ROLL_STEPS, DEFAULT_TOP_N, itemKey, type AddedBundle, type PinnedBundle } from '../cards'
import type { StatId } from '../data/schema'
import { realData } from '../cards/testing'
import { toPokemonSet } from '../ui/setDraft'
import { EXAMPLE_DRAFT } from './example'
import { toCardInput } from './input'
import { initialState, reducer, type AppAction, type AppState, type MoveChoice } from './state'

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
    expect(s.addedBundles).toEqual([])
    expect(s.pinnedBundles).toEqual([])
    expect(s.addedMoves).toEqual([])
    expect(s.criteria.bundleShareMin).toBe(0.05)
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
    const next = reducer(s, { type: 'set-criteria', criteria: { bundleShareMin: 0.1 } })
    expect(next.criteria).toEqual({ ...DEFAULT_CRITERIA, bundleShareMin: 0.1 })
    expect(Object.keys(next.criteria).sort()).toEqual(['berryShareMin', 'bundleShareMin', 'rankShareMin', 'scarfShareMin'])
    expect(next.generation).toBe(1)
    for (const criteria of [{ bundleShareMin: NaN }, { bundleShareMin: 1.01 }, { rankShareMin: 1.5 }, { scarfShareMin: -0.1 }, { berryShareMin: 2 }]) {
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

  it('정렬 전환은 기본 사용률, 세대를 바꾸지 않고 같은 값·잘못된 값은 그대로', () => {
    const s = start()
    expect(s.sortMode).toBe('usage')
    const next = reducer(s, { type: 'set-sort', mode: 'result' })
    expect(next.sortMode).toBe('result')
    expect(next.generation).toBe(s.generation)
    expect(reducer(next, { type: 'set-sort', mode: 'result' })).toBe(next)
    expect(reducer(next, { type: 'set-sort', mode: 'bogus' as 'usage' })).toBe(next)
    expect(reducer(next, { type: 'set-sort', mode: 'usage' }).sortMode).toBe('usage')
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

  describe('사용자 추가 배분', () => {
    const hb = (hp: number, def: number): AddedBundle => ({ tab: 'attack', opponentId: 'garchomp', category: 'physical', sp: { hp, def } })
    const add = (bundle: AddedBundle, keyStats: StatId[] = ['hp', 'def']): AppAction => ({ type: 'add-bundle', bundle, keyStats, spMax: 32 })

    it('0~32 정수·키 능력치 집합이 같을 때만 추가 순으로 담고 세대를 올린다', () => {
      const s = start()
      const one = reducer(s, add(hb(0, 32)))
      expect(one.addedBundles).toEqual([hb(0, 32)])
      expect(one.generation).toBe(1)
      const two = reducer(one, add(hb(32, 0)))
      expect(two.addedBundles).toEqual([hb(0, 32), hb(32, 0)])
      expect(two.generation).toBe(2)
      // 경계값 0·32는 받는다(위에서), 그 밖은 무시
      for (const bad of [hb(-1, 0), hb(33, 0), hb(1.5, 0), hb(NaN, 0), hb(0, Infinity)]) expect(reducer(s, add(bad))).toBe(s)
    })

    it('키 능력치 집합이 다르거나 비었으면 무시', () => {
      const s = start()
      expect(reducer(s, add(hb(0, 0), ['hp']))).toBe(s)
      expect(reducer(s, add(hb(0, 0), ['hp', 'spd']))).toBe(s)
      expect(reducer(s, add({ ...hb(0, 0), sp: { hp: 0 } }))).toBe(s)
      expect(reducer(s, add({ ...hb(0, 0), sp: {} }, []))).toBe(s)
      expect(reducer(s, add({ ...hb(0, 0), opponentId: '' }))).toBe(s)
    })

    it('같은 (탭, 상대, 분류, SP)는 중복으로 무시, 하나라도 다르면 따로 담는다', () => {
      const one = reducer(start(), add(hb(4, 8)))
      expect(reducer(one, add(hb(4, 8)))).toBe(one)
      const otherTab = reducer(one, add({ ...hb(4, 8), tab: 'defense' }))
      const otherCategory = reducer(one, add({ ...hb(4, 8), category: 'special' }))
      expect(otherTab.addedBundles).toHaveLength(2)
      expect(otherCategory.addedBundles).toHaveLength(2)
    })

    it('삭제는 같은 배분만 지우고, 없으면 그대로', () => {
      const two = run(start(), add(hb(0, 32)), add(hb(32, 0)))
      const removed = reducer(two, { type: 'remove-bundle', bundle: hb(0, 32) })
      expect(removed.addedBundles).toEqual([hb(32, 0)])
      expect(removed.generation).toBe(two.generation + 1)
      expect(reducer(removed, { type: 'remove-bundle', bundle: hb(0, 32) })).toBe(removed)
    })

    // 직접 추가 배분의 고정 키 = 키 능력치 STAT_IDS 순·무보정 묶음 키(관측 묶음 키와 같은 형식)
    const pinOfHb = (hp: number, def: number, extra: Partial<PinnedBundle> = {}): PinnedBundle => ({
      tab: 'attack',
      opponentId: 'garchomp',
      category: 'physical',
      key: JSON.stringify([
        { stat: 'hp', sp: hp, nature: 'neutral' },
        { stat: 'def', sp: def, nature: 'neutral' },
      ]),
      ...extra,
    })
    const observed = (key: string): PinnedBundle => ({ tab: 'attack', opponentId: 'garchomp', category: 'physical', key })

    it('추가는 고정도 함께(추가 순, 관측 고정과 한 목록), 같은 키 고정이 이미 있으면 고정을 겹치지 않는다', () => {
      const s = run(start(), { type: 'pin-bundle', pin: observed('obs-a') }, add(hb(0, 32)), add(hb(32, 0)))
      expect(s.pinnedBundles).toEqual([observed('obs-a'), pinOfHb(0, 32), pinOfHb(32, 0)])
      const pre = run(start(), { type: 'pin-bundle', pin: pinOfHb(4, 8) })
      const added = reducer(pre, add(hb(4, 8)))
      expect(added.addedBundles).toEqual([hb(4, 8)])
      expect(added.pinnedBundles).toEqual([pinOfHb(4, 8)])
    })

    it('관측 배분 고정은 세대를 올리지 않고 맨 뒤에 붙는다. 중복·빈 id/키는 무시', () => {
      const s = start()
      const one = reducer(s, { type: 'pin-bundle', pin: observed('a') })
      expect(one.pinnedBundles).toEqual([observed('a')])
      expect(one.generation).toBe(s.generation)
      const two = reducer(one, { type: 'pin-bundle', pin: { ...observed('b'), tab: 'defense' } })
      expect(two.pinnedBundles).toEqual([observed('a'), { ...observed('b'), tab: 'defense' }])
      expect(reducer(two, { type: 'pin-bundle', pin: observed('a') })).toBe(two)
      expect(reducer(s, { type: 'pin-bundle', pin: observed('') })).toBe(s)
      expect(reducer(s, { type: 'pin-bundle', pin: { ...observed('a'), opponentId: '' } })).toBe(s)
    })

    it('고정 해제: 관측 배분은 고정만 빠지고(세대 그대로), 직접 추가 배분은 삭제된다(세대 +1). 없으면 그대로', () => {
      const s = run(start(), { type: 'pin-bundle', pin: observed('a') }, add(hb(0, 32)), { type: 'pin-bundle', pin: observed('b') })
      const obsOff = reducer(s, { type: 'unpin-bundle', pin: observed('a') })
      expect(obsOff.pinnedBundles).toEqual([pinOfHb(0, 32), observed('b')])
      expect(obsOff.addedBundles).toEqual([hb(0, 32)])
      expect(obsOff.generation).toBe(s.generation)
      const userOff = reducer(obsOff, { type: 'unpin-bundle', pin: pinOfHb(0, 32) })
      expect(userOff.pinnedBundles).toEqual([observed('b')])
      expect(userOff.addedBundles).toEqual([])
      expect(userOff.generation).toBe(obsOff.generation + 1)
      expect(reducer(userOff, { type: 'unpin-bundle', pin: observed('a') })).toBe(userOff)
      // 다른 탭·분류의 같은 키는 다른 고정
      expect(reducer(userOff, { type: 'unpin-bundle', pin: { ...observed('b'), category: 'special' } })).toBe(userOff)
    })

    it('관측 배분과 키가 같은 직접 추가 배분: 그 키의 고정을 풀면 추가 배분도 함께 지운다(세대 +1)', () => {
      const s = run(start(), { type: 'pin-bundle', pin: pinOfHb(4, 8) }, add(hb(4, 8)))
      const off = reducer(s, { type: 'unpin-bundle', pin: pinOfHb(4, 8) })
      expect(off.pinnedBundles).toEqual([])
      expect(off.addedBundles).toEqual([])
      expect(off.generation).toBe(s.generation + 1)
    })

    it('통계 기준·월·최소 비중을 바꿨다 되돌려도 고정은 그대로 남는다(기준 왕복)', () => {
      const s = run(start(), { type: 'pin-bundle', pin: observed('a') }, add(hb(0, 32)))
      const away = run(s, { type: 'set-criteria', criteria: { bundleShareMin: 0.2 } }, { type: 'set-meta', meta: { match: 'bo3', month: '2026-09' } })
      expect(away.pinnedBundles).toEqual(s.pinnedBundles)
      expect(away.addedBundles).toEqual(s.addedBundles)
      const back = run(away, { type: 'set-criteria', criteria: { bundleShareMin: s.criteria.bundleShareMin } }, { type: 'set-meta', meta: { match: 'bo1', month: '2026-10' } })
      expect(back.pinnedBundles).toEqual([observed('a'), pinOfHb(0, 32)])
    })

    it('remove-bundle도 그 배분의 고정을 지운다', () => {
      const two = run(start(), add(hb(0, 32)), add(hb(32, 0)))
      const removed = reducer(two, { type: 'remove-bundle', bundle: hb(0, 32) })
      expect(removed.pinnedBundles).toEqual([pinOfHb(32, 0)])
    })

    it('toCardInput이 추가 배분을 그대로 넘긴다', () => {
      const { game, bo1 } = realData()
      const s = reducer(start(), add(hb(0, 32)))
      expect(toCardInput(s, game, bo1).addedBundles).toEqual([hb(0, 32)])
    })
  })
})

describe('상대 기술 추가·직접 선택 해제', () => {
  const choice = (opponentId: string, key: string, tab: MoveChoice['tab'] = 'defense'): MoveChoice => ({ tab, source: 'ladder', opponentId, key })
  const rankKey = (moveId: string) => itemKey(moveId, JSON.stringify(['rank', 'opponent', 'move', 'swordsdance']))
  const addMove = (opponentId: string, moveId: string): AppAction => ({ type: 'add-move', opponentId, moveId })

  it('add-move: 추가(세대 +1) + 그 기술 랭크 전 항목을 (방어 탭, 래더, 상대) 직접 선택으로 바꾼다', () => {
    const s = run(start(), { type: 'choose-move', choice: choice('kingambit', itemKey('ironhead', BASE_CONDITION_ID)) }, { type: 'choose-move', choice: choice('kingambit', 'x', 'attack') })
    const added = reducer(s, addMove('kingambit', 'thunderpunch'))
    expect(added.addedMoves).toEqual([{ opponentId: 'kingambit', moveId: 'thunderpunch' }])
    expect(added.generation).toBe(s.generation + 1)
    expect(added.moveChoices).toEqual([choice('kingambit', 'x', 'attack'), choice('kingambit', itemKey('thunderpunch', BASE_CONDITION_ID))])
  })

  it('add-move: 같은 (상대, 기술)이 이미 있거나 빈 문자열이면 무시', () => {
    const s = reducer(start(), addMove('kingambit', 'thunderpunch'))
    expect(reducer(s, addMove('kingambit', 'thunderpunch'))).toBe(s)
    expect(reducer(s, addMove('', 'thunderpunch'))).toBe(s)
    expect(reducer(s, addMove('kingambit', ''))).toBe(s)
    expect(reducer(s, addMove('garchomp', 'thunderpunch')).addedMoves).toHaveLength(2)
  })

  it('remove-move: 삭제(세대 +1), 그 기술 항목(랭크 후 포함)이 선택돼 있으면 해제, 다른 기술 선택은 유지', () => {
    const s = run(start(), addMove('kingambit', 'thunderpunch'), addMove('kingambit', 'crunch'))
    const removed = reducer(s, { type: 'remove-move', opponentId: 'kingambit', moveId: 'thunderpunch' })
    expect(removed.addedMoves).toEqual([{ opponentId: 'kingambit', moveId: 'crunch' }])
    expect(removed.generation).toBe(s.generation + 1)
    expect(removed.moveChoices).toEqual([choice('kingambit', itemKey('crunch', BASE_CONDITION_ID))])
    const rank = run(s, { type: 'choose-move', choice: choice('kingambit', rankKey('thunderpunch')) })
    expect(reducer(rank, { type: 'remove-move', opponentId: 'kingambit', moveId: 'thunderpunch' }).moveChoices).toEqual([])
    const kept = reducer(rank, { type: 'remove-move', opponentId: 'kingambit', moveId: 'crunch' })
    expect(kept.moveChoices).toBe(rank.moveChoices)
    expect(reducer(s, { type: 'remove-move', opponentId: 'kingambit', moveId: 'nope' })).toBe(s)
  })

  it('set-draft: SP·성격만 바뀌면 직접 선택 유지, 종·기술·도구·특성·메가가 바뀌면 전부 해제(추가 기술은 남는다)', () => {
    const s = run(start(), addMove('kingambit', 'thunderpunch'), { type: 'choose-move', choice: choice('garchomp', 'y', 'attack') })
    const sp = reducer(s, { type: 'set-draft', draft: { ...s.draft, sp: { ...s.draft.sp, hp: '10' }, nature: 'jolly', natureMinusAuto: true } })
    expect(sp.generation).toBe(s.generation + 1)
    expect(sp.moveChoices).toBe(s.moveChoices)
    expect(reducer(s, { type: 'commit-sp', stat: 'def', value: 4 }).moveChoices).toBe(s.moveChoices)
    for (const draft of [
      { ...s.draft, item: 'choiceband' },
      { ...s.draft, ability: 'sandveil' },
      { ...s.draft, species: 'kingambit' },
      { ...s.draft, moves: [...s.draft.moves].reverse() },
      { ...s.draft, mega: !s.draft.mega },
    ]) {
      const next = reducer(s, { type: 'set-draft', draft })
      expect(next.moveChoices).toEqual([])
      expect(next.addedMoves).toEqual(s.addedMoves)
      expect(next.generation).toBe(s.generation + 1)
    }
  })

  it('toCardInput이 추가 기술을 넘긴다', () => {
    const { game, bo1 } = realData()
    const s = reducer(start(), addMove('kingambit', 'thunderpunch'))
    expect(toCardInput(s, game, bo1).addedMoves).toEqual([{ opponentId: 'kingambit', moveId: 'thunderpunch' }])
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

describe('종 교체(switch-species)', () => {
  const sneasler = { ...EXAMPLE_DRAFT, species: '포푸니크', ability: 'unburden', item: '하얀허브', nature: 'adamant', moves: ['인파이트', '', '', ''] }
  it('떠나는 종의 초안을 기억하고 처음 고른 종은 준 초안을 쓴다, 세대 +1·종 교체 세대 기록', () => {
    const next = reducer(start(), { type: 'switch-species', from: 'garchomp', to: 'sneasler', draft: sneasler })
    expect(next.draft).toEqual(sneasler)
    expect(next.draftCache).toEqual({ garchomp: EXAMPLE_DRAFT })
    expect(next.generation).toBe(1)
    expect(next.speciesGeneration).toBe(1)
  })

  it('돌아오면 기억한 초안이 준 초안보다 우선한다(종 칸 글자만 새 입력)', () => {
    const edited = { ...EXAMPLE_DRAFT, item: '구애스카프', sp: { ...EXAMPLE_DRAFT.sp, hp: '10' } }
    const s = run(
      start(),
      { type: 'set-draft', draft: edited },
      { type: 'switch-species', from: 'garchomp', to: 'sneasler', draft: sneasler },
      { type: 'switch-species', from: 'sneasler', to: 'garchomp', draft: { ...sneasler, species: 'garchomp' } },
    )
    expect(s.draft).toEqual({ ...edited, species: 'garchomp' })
    expect(s.draftCache.sneasler).toEqual(sneasler)
    expect(s.speciesGeneration).toBe(s.generation)
  })

  it('종 기억·종 교체 세대는 계산 입력이 아니다, SP 변경은 종 교체 세대를 바꾸지 않는다', () => {
    const { game, bo1 } = realData()
    const s = reducer(start(), { type: 'switch-species', from: 'garchomp', to: 'sneasler', draft: sneasler })
    const sp = reducer(s, { type: 'commit-sp', stat: 'hp', value: 5 })
    expect(sp.generation).toBe(s.generation + 1)
    expect(sp.speciesGeneration).toBe(s.speciesGeneration)
    expect(toCardInput(s, game, bo1)).toEqual(toCardInput({ ...s, draftCache: {}, speciesGeneration: 0 }, game, bo1))
  })

  it('from === to면 set-draft와 같다(기억·종 교체 세대 그대로), from이 없으면 기억하지 않는다', () => {
    const s = start()
    const same = reducer(s, { type: 'switch-species', from: 'garchomp', to: 'garchomp', draft: { ...EXAMPLE_DRAFT, item: '' } })
    expect(same.draftCache).toEqual({})
    expect(same.speciesGeneration).toBe(0)
    expect(same.draft.item).toBe('')
    expect(reducer(s, { type: 'switch-species', from: undefined, to: 'sneasler', draft: sneasler }).draftCache).toEqual({})
  })

  it('직접 고른 기술 항목은 종이 바뀌면 풀린다', () => {
    const choice: MoveChoice = { tab: 'attack', source: 'ladder', opponentId: 'incineroar', key: itemKey('earthquake', BASE_CONDITION_ID) }
    const s = run(start(), { type: 'choose-move', choice }, { type: 'switch-species', from: 'garchomp', to: 'sneasler', draft: sneasler })
    expect(s.moveChoices).toEqual([])
  })
})
