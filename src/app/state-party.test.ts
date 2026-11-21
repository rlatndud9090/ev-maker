import { describe, expect, it } from 'vitest'
import type { CutLock, LockTargetKey } from '../cards'
import type { SetDraft } from '../ui/setDraft'
import { EXAMPLE_DRAFT } from './example'
import { BLANK_DRAFT, PARTY_SIZE, blankSlice, draftSlice, partySlices, sliceOf, type SlotSlice } from './party'
import { initialState, reducer, type AppAction, type AppState } from './state'

const SP_TOTAL = 66
const start = (): AppState => initialState('m-c')
const run = (state: AppState, ...actions: AppAction[]): AppState => actions.reduce(reducer, state)
const select = (index: number): AppAction => ({ type: 'party-select', index })
const add = (lock: Omit<CutLock, 'seq'>): AppAction => ({ type: 'add-lock', lock, spTotal: SP_TOTAL })

const damageTarget = (source: 'ladder' | 'custom', opponentId: string, kind: 'attack' | 'defense' = 'attack'): LockTargetKey => ({
  kind,
  source,
  opponentId,
  category: 'physical',
  bundle: source === 'custom' ? { preset: 0 } : { ladder: 'k' },
  item: null,
  itemKey: 'earthquake',
})
const attackLock = (source: 'ladder' | 'custom', opponentId: string): Omit<CutLock, 'seq'> => ({
  kind: 'attack',
  target: damageTarget(source, opponentId),
  stage: 'guaranteed-ohko',
  stats: ['atk'],
})
const speedLock = (origin: 'ladder' | 'added' | 'preset', opponentId: string): Omit<CutLock, 'seq'> => ({
  kind: 'speed',
  target: {
    kind: 'speed',
    origin,
    opponentId,
    bundle: origin === 'preset' ? { preset: 0 } : { sp: 32, nature: 'plus' },
    condition: 'none',
    filterKind: null,
  },
  stage: 'first',
  stats: ['spe'],
})

const TOGEDEMARU: SetDraft = { ...EXAMPLE_DRAFT, species: '토게데마루', ability: 'ironbarbs', item: '', moves: ['', '', '', ''] }
const addCustom = (rosterId: string): AppAction => ({ type: 'add-custom-target', rosterId, moves: ['tackle'] })

/** 1번 칸 기본 세트에 고정 + 기술 선택, 2번 칸 다른 세트 */
function twoSlots(): AppState {
  return run(
    start(),
    add(attackLock('ladder', 'opp')),
    { type: 'choose-move', choice: { tab: 'attack', source: 'ladder', opponentId: 'opp', key: 'k1' } },
    { type: 'set-lock-base', id: 'plus:atk' },
    select(1),
    { type: 'switch-species', from: undefined, to: 'togedemaru', draft: TOGEDEMARU },
  )
}

describe('party-select', () => {
  it('왕복하면 1번 칸 조각(세트·고정·기준 갈래·기술 선택)이 그대로다(A2)', () => {
    const s0 = run(start(), add(attackLock('ladder', 'opp')), { type: 'set-lock-base', id: 'plus:atk' }, {
      type: 'choose-move',
      choice: { tab: 'attack', source: 'ladder', opponentId: 'opp', key: 'k1' },
    })
    const before = sliceOf(s0)
    const back = run(s0, select(2), select(0))
    expect(sliceOf(back)).toEqual(before)
    expect(back.locks).toHaveLength(1)
    expect(back.lockBase).toBe('plus:atk')
    expect(back.party.active).toBe(0)
  })

  it('전환은 고정을 풀지 않고 보관함에 그대로 둔다', () => {
    const s = twoSlots()
    expect(s.party.active).toBe(1)
    expect(s.locks).toEqual([])
    expect(s.draft.species).toBe('토게데마루')
    expect(s.party.slots[0]?.locks).toHaveLength(1)
    expect(s.party.slots[0]?.draft.sp).toEqual(EXAMPLE_DRAFT.sp)
    expect(s.party.slots[1]).toBeNull()
    const back = reducer(s, select(0))
    expect(back.locks).toHaveLength(1)
    expect(back.draft).toEqual(EXAMPLE_DRAFT)
    expect(back.party.slots[1]?.draft.species).toBe('토게데마루')
  })

  it('빈 칸으로 가면 빈 초안 조각이 올라온다(R6)', () => {
    const s = reducer(start(), select(4))
    expect(sliceOf(s)).toEqual(blankSlice())
    expect(s.draft).toEqual(BLANK_DRAFT)
    expect(s.party.slots[0]?.draft).toEqual(EXAMPLE_DRAFT)
  })

  it('빈 활성 칸을 떠나면 보관함엔 null로 남는다', () => {
    const s = run(start(), select(4), select(0))
    expect(s.party.slots[4]).toBeNull()
  })

  it('세대를 올리고 종 변경 세대로 치며 일회성 신호를 비운다, 탭은 그대로(R5)', () => {
    const s0 = run(start(), { type: 'set-tab', tab: 'defense' }, add(attackLock('ladder', 'opp')), { type: 'reveal-lock', seq: 1 })
    expect(s0.lockReveal).not.toBeNull()
    expect(s0.lockFit).not.toBeNull()
    const s = reducer(s0, select(1))
    expect(s.generation).toBe(s0.generation + 1)
    expect(s.speciesGeneration).toBe(s.generation)
    expect([s.lockReveal, s.lockTrim, s.lockFit]).toEqual([null, null, null])
    expect(s.lockRevealNonce).toBe(s0.lockRevealNonce)
    expect(s.tab).toBe('attack')
    const back = reducer(s, select(0))
    expect(back.generation).toBe(s.generation + 1)
    expect(back.lockReveal).toBeNull()
  })

  it('같은 칸·범위 밖 index는 무시한다', () => {
    const s = start()
    expect(reducer(s, select(0))).toBe(s)
    expect(reducer(s, select(6))).toBe(s)
    expect(reducer(s, select(-1))).toBe(s)
    expect(reducer(s, select(1.5))).toBe(s)
  })

  it('전역 목록·화면 설정은 칸과 무관하다(R11·R13)', () => {
    const s = run(start(), select(1), addCustom('pikachu'), { type: 'set-sort', mode: 'result' }, select(0))
    expect(s.customTargets.map((t) => t.rosterId)).toEqual(['pikachu'])
    expect(s.sortMode).toBe('result')
  })
})

describe('party-clear-slot', () => {
  it('비활성 칸은 보관함만 비운다', () => {
    const s = twoSlots()
    const next = reducer(s, { type: 'party-clear-slot', index: 0 })
    expect(next.party.slots[0]).toBeNull()
    expect(next.draft).toBe(s.draft)
    expect(next.generation).toBe(s.generation)
    expect(reducer(next, { type: 'party-clear-slot', index: 0 })).toBe(next)
  })

  it('활성 칸은 최상위를 빈 조각으로(고정 포함 사라짐)', () => {
    const s = run(start(), add(attackLock('ladder', 'opp')))
    const next = reducer(s, { type: 'party-clear-slot', index: 0 })
    expect(sliceOf(next)).toEqual(blankSlice())
    expect(next.generation).toBe(s.generation + 1)
    expect(reducer(next, { type: 'party-clear-slot', index: 0 })).toBe(next)
  })
})

describe('party-move', () => {
  it('순서가 바뀌어도 활성 칸은 같은 포켓몬을 따라가고 상태가 섞이지 않는다(R9·A8)', () => {
    const s = twoSlots() // 0 = 한카리아스(고정), 1 = 토게데마루(활성)
    const moved = reducer(s, { type: 'party-move', from: 1, to: 4 })
    expect(moved.party.active).toBe(4)
    expect(moved.draft).toBe(s.draft)
    expect(moved.generation).toBe(s.generation)
    const slices = partySlices(moved)
    expect(slices.map((x) => x?.draft.species ?? null)).toEqual(['한카리아스', null, null, null, '토게데마루', null])
    const back = reducer(moved, select(0))
    expect(back.locks).toHaveLength(1)
    expect(back.draft).toEqual(EXAMPLE_DRAFT)
  })

  it('비활성 칸을 활성 칸 앞으로 옮기면 활성 인덱스가 밀린다', () => {
    const s = twoSlots()
    const moved = reducer(s, { type: 'party-move', from: 0, to: 2 })
    expect(moved.party.active).toBe(0)
    expect(partySlices(moved).map((x) => x?.draft.species ?? null)).toEqual(['토게데마루', null, '한카리아스', null, null, null])
  })

  it('같은 자리·범위 밖은 무시', () => {
    const s = twoSlots()
    expect(reducer(s, { type: 'party-move', from: 2, to: 2 })).toBe(s)
    expect(reducer(s, { type: 'party-move', from: 0, to: 6 })).toBe(s)
  })
})

describe('party-clear-all', () => {
  it('6칸을 비우고 1번 칸 활성(빈 상태), 전역 목록은 남긴다(R10)', () => {
    const s = run(twoSlots(), addCustom('pikachu'))
    const next = reducer(s, { type: 'party-clear-all' })
    expect(next.party).toEqual({ slots: Array.from({ length: PARTY_SIZE }, () => null), active: 0 })
    expect(sliceOf(next)).toEqual(blankSlice())
    expect(next.customTargets).toBe(s.customTargets)
  })
})

describe('party-import', () => {
  it('주어진 초안으로 6칸 교체·고정 없음·1번 칸 활성, 전역 목록 유지(R15·R16)', () => {
    const s = run(twoSlots(), addCustom('pikachu'), { type: 'add-speed-bundle', bundle: { source: 'ladder', opponentId: 'x', sp: 10, nature: 'plus' }, spMax: 32 })
    const next = reducer(s, { type: 'party-import', slots: [TOGEDEMARU, null, EXAMPLE_DRAFT] })
    expect(next.party.active).toBe(0)
    expect(sliceOf(next)).toEqual(draftSlice(TOGEDEMARU))
    expect(next.locks).toEqual([])
    expect(partySlices(next).map((x) => x?.draft.species ?? null)).toEqual(['토게데마루', null, '한카리아스', null, null, null])
    expect(next.party.slots[2]?.locks).toEqual([])
    expect(next.customTargets).toBe(s.customTargets)
    expect(next.speedChart.added).toBe(s.speedChart.added)
    expect(next.generation).toBe(s.generation + 1)
  })

  it('6마리를 넘으면 앞 6마리만, 첫 칸이 비면 빈 활성 칸', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ ...EXAMPLE_DRAFT, item: String(i) }))
    const next = reducer(start(), { type: 'party-import', slots: many })
    expect(partySlices(next).map((x) => x?.draft.item)).toEqual(['0', '1', '2', '3', '4', '5'])
    const empty = reducer(start(), { type: 'party-import', slots: [null, EXAMPLE_DRAFT] })
    expect(sliceOf(empty)).toEqual(blankSlice())
    expect(empty.party.slots[1]?.draft).toEqual(EXAMPLE_DRAFT)
  })
})

describe('party-hydrate', () => {
  it('보관함·활성 칸·최상위 조각·전역 목록을 통째로 세팅한다', () => {
    const locked: SlotSlice = { ...draftSlice(TOGEDEMARU), locks: [{ ...attackLock('ladder', 'opp'), seq: 1 }], lockSeq: 2, lockSpTotal: 66, lockNature: { nature: 'hardy' } }
    const slots = [draftSlice(EXAMPLE_DRAFT), null, locked, null, null, null]
    const target = { rosterId: 'pikachu', moves: ['tackle'], edits: {} }
    const s = reducer(start(), { type: 'party-hydrate', saved: { slots, active: 2, globals: { customTargets: [target], speedAdded: [] } } })
    expect(s.party.active).toBe(2)
    expect(sliceOf(s)).toEqual(locked)
    expect(s.party.slots[2]).toBeNull()
    expect(s.party.slots[0]?.draft).toEqual(EXAMPLE_DRAFT)
    expect(s.customTargets).toEqual([target])
    expect(s.addedBundles).toEqual([])
  })

  it('활성 index가 틀리면 1번 칸, 모양이 틀리면 무시', () => {
    const s = reducer(start(), { type: 'party-hydrate', saved: { slots: [draftSlice(TOGEDEMARU)], active: 9, globals: {} } })
    expect(s.party.active).toBe(0)
    expect(s.draft).toEqual(TOGEDEMARU)
    expect(s.party.slots).toHaveLength(PARTY_SIZE)
    const base = start()
    expect(reducer(base, { type: 'party-hydrate', saved: null as never })).toBe(base)
  })
})

describe('remove-custom-target 고정 연쇄(R12·A3)', () => {
  it('최상위와 보관함 모든 칸의 그 목록 밖 타겟 대상 고정을 풀고 다른 고정은 남긴다', () => {
    const s = run(
      start(),
      addCustom('pikachu'),
      add(attackLock('custom', 'pikachu')),
      add(speedLock('preset', 'pikachu')),
      add(attackLock('ladder', 'pikachu')), // 래더 출처 같은 id는 남는다
      select(1),
      { type: 'switch-species', from: undefined, to: 'togedemaru', draft: TOGEDEMARU },
      add(speedLock('added', 'pikachu')),
      add(speedLock('ladder', 'pikachu')),
    )
    expect(s.party.slots[0]?.locks).toHaveLength(3)
    expect(s.locks).toHaveLength(2)
    const next = reducer(s, { type: 'remove-custom-target', rosterId: 'pikachu' })
    expect(next.customTargets).toEqual([])
    expect(next.locks.map((l) => l.target.kind === 'speed' && l.target.origin)).toEqual(['ladder'])
    expect(next.party.slots[0]?.locks.map((l) => l.target.kind !== 'speed' && l.target.source)).toEqual(['ladder'])
    expect(next.generation).toBeGreaterThan(s.generation)
  })

  it('칸의 고정이 모두 풀리면 그 칸의 고정 상태를 비우고 성격을 돌려놓는다', () => {
    const s = run(start(), addCustom('pikachu'), add(attackLock('custom', 'pikachu')), { type: 'set-lock-base', id: 'plus:atk' }, select(1), select(0))
    const stored = run(s, select(1))
    expect(stored.party.slots[0]?.locks).toHaveLength(1)
    const next = reducer(stored, { type: 'remove-custom-target', rosterId: 'pikachu' })
    const slot0 = next.party.slots[0]
    expect(slot0).toEqual({ ...sliceOf(s), locks: [], lockSeq: 1, lockBase: null, lockNature: null, lockSpTotal: null })
    const active = reducer(s, { type: 'remove-custom-target', rosterId: 'pikachu' })
    expect([active.locks, active.lockSeq, active.lockBase, active.lockNature, active.lockSpTotal, active.lockFit]).toEqual([[], 1, null, null, null, null])
    expect(active.draft).toEqual(EXAMPLE_DRAFT)
  })

  it('고정이 없는 칸들은 그대로 둔다(참조 동일)', () => {
    const s = run(start(), addCustom('pikachu'), select(1), select(0))
    const next = reducer(s, { type: 'remove-custom-target', rosterId: 'pikachu' })
    expect(next.party).toBe(s.party)
    expect(next.locks).toBe(s.locks)
  })
})

describe('remove-move 기술 선택 연쇄', () => {
  const MOVE_KEY = JSON.stringify(['earthquake', null])
  it('지운 추가 기술을 가리키는 선택을 최상위와 보관함 모든 칸에서 정리하고 다른 선택은 남긴다', () => {
    const s = run(
      start(),
      { type: 'add-move', opponentId: 'garchomp', moveId: 'earthquake' },
      { type: 'choose-move', choice: { tab: 'attack', source: 'ladder', opponentId: 'opp', key: 'k1' } },
      select(1),
      { type: 'switch-species', from: undefined, to: 'togedemaru', draft: TOGEDEMARU },
      { type: 'choose-move', choice: { tab: 'defense', source: 'ladder', opponentId: 'garchomp', key: MOVE_KEY } },
    )
    // 0번 칸(보관): add-move가 만든 선택 + 다른 선택, 활성 1번: 같은 기술 선택
    const stored0 = s.party.slots[0]?.moveChoices ?? []
    expect(stored0.some((c) => c.opponentId === 'garchomp')).toBe(true)
    expect(s.moveChoices.some((c) => c.opponentId === 'garchomp')).toBe(true)
    const next = reducer(s, { type: 'remove-move', opponentId: 'garchomp', moveId: 'earthquake' })
    expect(next.addedMoves).toEqual([])
    expect(next.moveChoices.some((c) => c.opponentId === 'garchomp')).toBe(false)
    expect(next.party.slots[0]?.moveChoices).toEqual([{ tab: 'attack', source: 'ladder', opponentId: 'opp', key: 'k1' }])
  })

  it('선택이 없는 칸은 참조 그대로 둔다', () => {
    const s = run(
      start(),
      select(1),
      { type: 'switch-species', from: undefined, to: 'togedemaru', draft: TOGEDEMARU },
      select(0),
      { type: 'add-move', opponentId: 'garchomp', moveId: 'earthquake' },
    )
    expect(s.party.slots[1]?.moveChoices).toEqual([])
    const next = reducer(s, { type: 'remove-move', opponentId: 'garchomp', moveId: 'earthquake' })
    expect(next.party).toBe(s.party)
    expect(next.moveChoices).toEqual([])
  })
})
