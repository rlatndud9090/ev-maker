// 파티 6칸: 활성 칸 조각은 상태 최상위, 비활성 칸 조각은 보관함(party.slots). React 없음.
import type { Snapshot } from '../data/schema'
import { namesOf } from '../ui/names'
import { MOVE_SLOTS, type SetDraft } from '../ui/setDraft'
import { EXAMPLE_DRAFT } from './example'
import type { AppState } from './state'

export const PARTY_SIZE = 6

/**
 * AppState 키마다 칸 쪽 역할. 새 상태 필드는 여기서 역할을 정해야 컴파일된다(빠짐·남음 모두 오류).
 * slot = 칸마다 보관·복원, transient = 칸 전환·교체 때 비우는 일회성 신호(보관·저장 안 함), global = 파티 공통.
 * generation·speciesGeneration·lockRevealNonce는 실행기·화면이 비교하는 단조 카운터라 칸 사이에서 되돌아가면 안 된다.
 */
const KEY_ROLE = {
  regulation: 'global',
  meta: 'global',
  draft: 'slot',
  speedChart: 'global',
  rollSteps: 'global',
  tab: 'global',
  criteria: 'global',
  filters: 'global',
  customTargets: 'global',
  addedBundles: 'global',
  addedMoves: 'global',
  pinnedBundles: 'global',
  sortMode: 'global',
  moveChoices: 'slot',
  generation: 'global',
  draftCache: 'slot',
  speciesGeneration: 'global',
  locks: 'slot',
  lockSeq: 'slot',
  lockBase: 'slot',
  lockNature: 'slot',
  lockSpTotal: 'slot',
  lockReveal: 'transient',
  lockRevealNonce: 'global',
  lockTrim: 'transient',
  lockFit: 'transient',
  party: 'global',
} as const satisfies Record<keyof AppState, 'slot' | 'transient' | 'global'>

type KeyRole = typeof KEY_ROLE
type KeysWithRole<R> = { [K in keyof KeyRole]: KeyRole[K] extends R ? K : never }[keyof KeyRole]

export type SlotKey = KeysWithRole<'slot'>
export type SlotSlice = Pick<AppState, SlotKey>
export type TransientKey = KeysWithRole<'transient'>

const keysWithRole = <R extends KeyRole[keyof KeyRole]>(role: R) => (Object.keys(KEY_ROLE) as (keyof KeyRole)[]).filter((k) => KEY_ROLE[k] === role)

export const SLOT_KEYS = keysWithRole('slot') as readonly SlotKey[]

/** 칸 전환·비우기·교체·복원 뒤 최상위에 덮는 값 */
export const CLEARED_TRANSIENT = { lockReveal: null, lockTrim: null, lockFit: null } as const satisfies Pick<AppState, TransientKey>

export interface PartyState {
  /** 길이 PARTY_SIZE. null = 빈 칸. 활성 자리는 최상위가 진실이라 이 값은 읽지 않는다(null로 둔다) */
  slots: readonly (SlotSlice | null)[]
  /** 0..PARTY_SIZE−1 */
  active: number
}

/** 저장 복원 입력. 전역 상대 목록은 주어진 것만 덮는다 */
export interface PartyHydration {
  slots: readonly (SlotSlice | null)[]
  active: number
  globals: Partial<PartyGlobals>
}

export interface PartyGlobals {
  customTargets: AppState['customTargets']
  addedBundles: AppState['addedBundles']
  addedMoves: AppState['addedMoves']
  pinnedBundles: AppState['pinnedBundles']
  speedAdded: AppState['speedChart']['added']
}

/** 종 없는 초안(빈 활성 칸). 특성·성격·SP는 종을 고를 때 초안 만들기가 채운다 */
export const BLANK_DRAFT: SetDraft = {
  species: '',
  ability: '',
  item: '',
  nature: 'hardy',
  sp: { hp: '0', atk: '0', def: '0', spa: '0', spd: '0', spe: '0' },
  moves: Array.from({ length: MOVE_SLOTS }, () => ''),
  mega: false,
  status: 'none',
  boosts: { atk: '0', def: '0', spa: '0', spd: '0', spe: '0' },
}

const sliceWith = (draft: SetDraft): SlotSlice => ({
  draft,
  draftCache: {},
  moveChoices: [],
  locks: [],
  lockSeq: 1,
  lockBase: null,
  lockNature: null,
  lockSpTotal: null,
})

export const blankSlice = (): SlotSlice => sliceWith(BLANK_DRAFT)
export const defaultSlice = (): SlotSlice => sliceWith(EXAMPLE_DRAFT)
export const draftSlice = (draft: SetDraft): SlotSlice => sliceWith(draft)

export const emptyParty = (): PartyState => ({ slots: Array.from({ length: PARTY_SIZE }, () => null), active: 0 })

export const isPartyIndex = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < PARTY_SIZE

/** 최상위 조각 */
export function sliceOf(state: SlotSlice): SlotSlice {
  const out = {} as Record<SlotKey, unknown>
  for (const k of SLOT_KEYS) out[k] = state[k]
  return out as SlotSlice
}

const hasSpecies = (slice: SlotSlice): boolean => slice.draft.species.trim() !== ''

/** 종도 고정도 없는 조각은 빈 칸(null)으로 보관한다 */
export const storedSlice = (slice: SlotSlice): SlotSlice | null => (hasSpecies(slice) || slice.locks.length > 0 ? slice : null)

/** 활성 칸이 비어 있는지(종 없음). 화면은 계산 결과 대신 안내만 낸다 */
export const activeSlotEmpty = (state: Pick<AppState, 'draft'>): boolean => state.draft.species.trim() === ''

/** 활성 자리에 최상위 조각을 반영한 6칸 */
export function partySlices(state: Pick<AppState, 'party' | SlotKey>): (SlotSlice | null)[] {
  return state.party.slots.map((s, i) => (i === state.party.active ? storedSlice(sliceOf(state)) : s))
}

/** 파티에 종이 있는 칸이 하나라도 있는지(가져오기 교체 확인 판단) */
export const partyHasMembers = (state: AppState): boolean => partySlices(state).some((s) => s !== null && hasSpecies(s))

export interface PartySlotView {
  index: number
  /** 이름 색인으로 푼 종 id(메가 폼 이름이면 메가 폼 id). 빈 칸·풀리지 않으면 null */
  speciesId: string | null
  itemId: string | null
  /** 초안의 표시 라벨 그대로(빈 칸이면 '') */
  speciesLabel: string
  itemLabel: string
  active: boolean
}

export function partySlotsView(state: AppState, game: Snapshot): PartySlotView[] {
  const names = namesOf(game)
  return partySlices(state).map((slice, index) => {
    const species = slice?.draft.species.trim() ?? ''
    const item = slice?.draft.item.trim() ?? ''
    return {
      index,
      speciesId: species === '' ? null : (names.species.resolve(species) ?? null),
      itemId: item === '' ? null : (names.items.resolve(item) ?? null),
      speciesLabel: species,
      itemLabel: item,
      active: index === state.party.active,
    }
  })
}

/** from 칸을 to 자리로 옮긴(사이 칸은 한 칸씩 밀린) 원래 인덱스 순서 */
export function movedOrder(from: number, to: number): number[] {
  const order = Array.from({ length: PARTY_SIZE }, (_, i) => i)
  const [moved] = order.splice(from, 1)
  order.splice(to, 0, moved)
  return order
}
