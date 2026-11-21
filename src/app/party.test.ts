import { describe, expect, it } from 'vitest'
import { buildTabView, DAMAGE_TABS } from '../cards'
import { realData } from '../cards/testing'
import { EXAMPLE_DRAFT } from './example'
import { toCardInput } from './input'
import {
  BLANK_DRAFT,
  CLEARED_TRANSIENT,
  PARTY_SIZE,
  SLOT_KEYS,
  activeSlotEmpty,
  blankSlice,
  defaultSlice,
  movedOrder,
  partyHasMembers,
  partySlotsView,
  sliceOf,
  storedSlice,
} from './party'
import { initialState, reducer, type AppState } from './state'

const start = (): AppState => initialState('m-c')

describe('칸 조각 키', () => {
  it('세트 딸림 필드만 칸 조각이고 일회성 신호·세대 카운터·전역은 빠진다', () => {
    expect([...SLOT_KEYS].sort()).toEqual(['draft', 'draftCache', 'lockBase', 'lockNature', 'lockSeq', 'lockSpTotal', 'locks', 'moveChoices'])
    expect(Object.keys(CLEARED_TRANSIENT).sort()).toEqual(['lockFit', 'lockReveal', 'lockTrim'])
  })

  it('조각 키·일회성 키·나머지 키를 합치면 상태의 모든 키다(런타임 확인)', () => {
    const s = start()
    for (const k of [...SLOT_KEYS, ...Object.keys(CLEARED_TRANSIENT)]) expect(Object.prototype.hasOwnProperty.call(s, k)).toBe(true)
  })
})

describe('기본 상태(R23)', () => {
  it('1번 칸 활성·기본 세트 조각, 나머지 빈 칸', () => {
    const s = start()
    expect(s.party.active).toBe(0)
    expect(s.party.slots).toHaveLength(PARTY_SIZE)
    expect(s.party.slots.every((x) => x === null)).toBe(true)
    expect(sliceOf(s)).toEqual(defaultSlice())
    expect(s.draft).toBe(EXAMPLE_DRAFT)
  })

  it('기존 initialState와 같은 조각 값(빈 고정·캐시·기술 선택)', () => {
    const s = start()
    expect(sliceOf(s)).toEqual({ draft: EXAMPLE_DRAFT, draftCache: {}, moveChoices: [], locks: [], lockSeq: 1, lockBase: null, lockNature: null, lockSpTotal: null })
    expect(s.generation).toBe(0)
  })
})

describe('storedSlice·activeSlotEmpty', () => {
  it('종도 고정도 없는 조각은 빈 칸', () => {
    expect(storedSlice(blankSlice())).toBeNull()
    expect(storedSlice(defaultSlice())).not.toBeNull()
    expect(activeSlotEmpty({ draft: BLANK_DRAFT })).toBe(true)
    expect(activeSlotEmpty({ draft: { ...BLANK_DRAFT, species: '  ' } })).toBe(true)
    expect(activeSlotEmpty({ draft: EXAMPLE_DRAFT })).toBe(false)
  })
})

describe('movedOrder', () => {
  it('앞에서 뒤로, 뒤에서 앞으로 옮기면 사이 칸이 밀린다', () => {
    expect(movedOrder(0, 2)).toEqual([1, 2, 0, 3, 4, 5])
    expect(movedOrder(4, 1)).toEqual([0, 4, 1, 2, 3, 5])
  })
})

describe('partySlotsView', () => {
  const { game } = realData()

  it('활성 자리는 최상위 조각으로 그리고 라벨을 id로 푼다', () => {
    const view = partySlotsView(start(), game)
    expect(view).toHaveLength(PARTY_SIZE)
    expect(view[0]).toEqual({ index: 0, speciesId: 'garchomp', itemId: 'lifeorb', speciesLabel: '한카리아스', itemLabel: '생명의구슬', active: true })
    expect(view.slice(1).every((v) => v.speciesId === null && v.itemId === null && v.speciesLabel === '' && !v.active)).toBe(true)
  })

  it('전환 뒤 보관함 칸도 보이고 빈 활성 칸은 빈 칸으로 보인다', () => {
    const s = reducer(start(), { type: 'party-select', index: 3 })
    const view = partySlotsView(s, game)
    expect(view[0]).toMatchObject({ speciesId: 'garchomp', active: false })
    expect(view[3]).toMatchObject({ speciesId: null, itemId: null, active: true })
    expect(partyHasMembers(s)).toBe(true)
    expect(partyHasMembers(reducer(s, { type: 'party-clear-all' }))).toBe(false)
  })

  it('풀리지 않는 라벨은 id null, 라벨은 원문', () => {
    const s = reducer(start(), { type: 'set-draft', draft: { ...EXAMPLE_DRAFT, species: '없는포켓몬', item: '' } })
    expect(partySlotsView(s, game)[0]).toMatchObject({ speciesId: null, itemId: null, speciesLabel: '없는포켓몬', itemLabel: '' })
  })
})

describe('빈 활성 칸 계산 경로', () => {
  it('종 없는 초안으로도 공격·방어 뷰가 예외 없이 내 세트 오류로 끝난다', () => {
    const { game, bo1 } = realData()
    const s = reducer(start(), { type: 'party-select', index: 1 })
    expect(activeSlotEmpty(s)).toBe(true)
    const input = toCardInput(s, game, bo1)
    for (const tab of DAMAGE_TABS) expect(buildTabView(input, tab).status.kind).toBe('my-set-error')
  })
})
