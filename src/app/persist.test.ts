import { describe, expect, it } from 'vitest'
import type { CutLock } from '../cards'
import { realData } from '../cards/testing'
import { EXAMPLE_DRAFT } from './example'
import { partySlices } from './party'
import { STORAGE_KEY, VERSION, loadPersisted, savePersisted, serialize, type PersistedParty, type StorageLike } from './persist'
import { initialState, reducer, type AppAction, type AppState } from './state'

const { game } = realData()
const run = (state: AppState, ...actions: AppAction[]): AppState => actions.reduce(reducer, state)

class MemoryStorage implements StorageLike {
  map = new Map<string, string>()
  getItem(key: string) {
    return this.map.get(key) ?? null
  }
  setItem(key: string, value: string) {
    this.map.set(key, value)
  }
}

const throwing: StorageLike = {
  getItem: () => {
    throw new Error('blocked')
  },
  setItem: () => {
    throw new Error('quota')
  },
}

const attackLock: Omit<CutLock, 'seq'> = {
  kind: 'attack',
  target: {
    kind: 'attack',
    source: 'ladder',
    opponentId: 'garchomp',
    category: 'physical',
    bundle: { ladder: 'k' },
    item: null,
    itemKey: 'earthquake',
  },
  stage: 'guaranteed-ohko',
  stats: ['atk'],
}

const SECOND = { ...EXAMPLE_DRAFT, species: '망나뇽', item: '생명의구슬', moves: ['신속', '지진', '', ''] }

/** 칸 3개(1번 고정 있음, 3번 활성), 전역 목록 채움 */
function richState(): AppState {
  return run(
    initialState(game.manifest.regulation.id),
    { type: 'add-lock', lock: attackLock, spTotal: 66 },
    { type: 'add-custom-target', rosterId: 'pikachu', moves: ['thunderbolt'] },
    { type: 'party-select', index: 2 },
    { type: 'set-draft', draft: SECOND },
  )
}

const roundTrip = (state: AppState): { saved: PersistedParty | null; restored: AppState } => {
  const storage = new MemoryStorage()
  savePersisted(storage, state)
  const saved = loadPersisted(storage, game)
  const restored = saved === null ? initialState(state.regulation) : reducer(initialState(state.regulation), { type: 'party-hydrate', saved })
  return { saved, restored }
}

describe('저장 왕복', () => {
  it('상태 → 저장 → 로드 → 복원하면 6칸 조각·활성 칸·전역 목록이 같다(R22)', () => {
    const state = richState()
    expect(state.locks).toHaveLength(0)
    expect(partySlices(state)[0]?.locks).toHaveLength(1)
    const { saved, restored } = roundTrip(state)
    expect(saved).not.toBeNull()
    expect(restored.party.active).toBe(2)
    expect(partySlices(restored)).toEqual(partySlices(state))
    expect(restored.draft).toEqual(SECOND)
    expect(restored.customTargets).toEqual(state.customTargets)
    expect(restored.addedBundles).toEqual(state.addedBundles)
    expect(restored.pinnedBundles).toEqual(state.pinnedBundles)
    expect(restored.addedMoves).toEqual(state.addedMoves)
    expect(restored.speedChart.added).toEqual(state.speedChart.added)
  })

  it('복원한 칸으로 옮기면 고정이 그대로 올라온다', () => {
    const { restored } = roundTrip(richState())
    const back = reducer(restored, { type: 'party-select', index: 0 })
    expect(back.locks).toHaveLength(1)
    expect(back.draft).toEqual(EXAMPLE_DRAFT)
  })

  it('저장 내용에 버전·레귤레이션이 있고 일회성 신호·세대·화면 설정은 없다(N4)', () => {
    const saved = serialize(richState())
    expect(saved.version).toBe(VERSION)
    expect(saved.regulation).toBe(game.manifest.regulation.id)
    expect(saved.slots).toHaveLength(6)
    const text = JSON.stringify(saved)
    for (const key of ['lockReveal', 'lockTrim', 'lockFit', 'generation', 'speciesGeneration', 'lockRevealNonce', '"tab"', 'filters', 'sortMode']) {
      expect(text).not.toContain(key)
    }
  })

  it('저장이 없으면 null(기본 상태 유지, R23)', () => {
    expect(loadPersisted(new MemoryStorage(), game)).toBeNull()
    expect(loadPersisted(null, game)).toBeNull()
  })
})

describe('읽을 수 없는 저장은 버린다(R24)', () => {
  const store = (text: string) => {
    const s = new MemoryStorage()
    s.setItem(STORAGE_KEY, text)
    return s
  }
  const valid = () => JSON.parse(JSON.stringify(serialize(richState()))) as Record<string, unknown>

  it('버전이 다르면 null', () => {
    expect(loadPersisted(store(JSON.stringify({ ...valid(), version: 2 })), game)).toBeNull()
    expect(loadPersisted(store(JSON.stringify({ ...valid(), version: undefined })), game)).toBeNull()
  })

  it('깨진 JSON이면 null', () => {
    expect(loadPersisted(store('{"version":1,'), game)).toBeNull()
    expect(loadPersisted(store('null'), game)).toBeNull()
    expect(loadPersisted(store('[]'), game)).toBeNull()
  })

  it('모양이 틀리면 null', () => {
    const v = valid()
    expect(loadPersisted(store(JSON.stringify({ ...v, active: 6 })), game)).toBeNull()
    expect(loadPersisted(store(JSON.stringify({ ...v, slots: (v.slots as unknown[]).slice(0, 5) })), game)).toBeNull()
    const badSlot = structuredClone(v) as { slots: { draft: { sp: unknown } }[] }
    badSlot.slots[0].draft.sp = { hp: 2 }
    expect(loadPersisted(store(JSON.stringify(badSlot)), game)).toBeNull()
    const badGlobals = structuredClone(v) as { globals: { customTargets: unknown } }
    badGlobals.globals.customTargets = 'x'
    expect(loadPersisted(store(JSON.stringify(badGlobals)), game)).toBeNull()
  })

  it('초안 기술 수·상태이상·랭크·SP 값 타입이 틀리면 null', () => {
    type Slots = { slots: ({ draft: Record<string, unknown> } | null)[] }
    const mutate = (f: (d: Record<string, unknown>) => void) => {
      const v = structuredClone(valid()) as Slots
      const slot = v.slots.find((x) => x !== null)
      if (!slot) throw new Error('slot')
      f(slot.draft)
      return loadPersisted(store(JSON.stringify(v)), game)
    }
    expect(mutate(() => {})).not.toBeNull()
    expect(mutate((d) => (d.moves = ['', '', ''])), 'moves 3개').toBeNull()
    expect(mutate((d) => (d.moves = ['', '', '', 3])), 'moves 숫자').toBeNull()
    expect(mutate((d) => (d.status = 'burn')), 'status').toBeNull()
    expect(mutate((d) => (d.boosts = { ...(d.boosts as object), atk: 1 })), 'boosts 숫자').toBeNull()
    expect(mutate((d) => (d.sp = { ...(d.sp as object), spe: null })), 'sp null').toBeNull()
  })

  it('고정의 target 필드 타입이 틀리면 null', () => {
    type Lock = { kind: string; target: Record<string, unknown> }
    const mutate = (f: (l: Lock) => void) => {
      const v = structuredClone(valid()) as { slots: ({ locks: Lock[] } | null)[] }
      const slot = v.slots.find((x) => x !== null && x.locks.length > 0)
      if (!slot) throw new Error('lock')
      f(slot.locks[0])
      return loadPersisted(store(JSON.stringify(v)), game)
    }
    expect(mutate(() => {})).not.toBeNull()
    expect(mutate((l) => (l.target.itemKey = 1)), 'itemKey').toBeNull()
    expect(mutate((l) => (l.target.bundle = 'k')), 'bundle').toBeNull()
    expect(mutate((l) => (l.target.source = 'other')), 'source').toBeNull()
    expect(mutate((l) => delete l.target.item), 'item 누락').toBeNull()
    expect(mutate((l) => (l.target.kind = 'speed')), 'kind 불일치').toBeNull()
    expect(
      mutate((l) => {
        l.kind = 'speed'
        l.target = { kind: 'speed', origin: 'ladder', opponentId: 'x', bundle: { sp: 32, nature: 'plus' }, condition: 'none', filterKind: null }
      }),
      '정상 스피드 타깃',
    ).not.toBeNull()
    expect(
      mutate((l) => {
        l.kind = 'speed'
        l.target = { kind: 'speed', origin: 'ladder', opponentId: 'x', bundle: { sp: '32' }, condition: 'none', filterKind: null }
      }),
      '스피드 bundle',
    ).toBeNull()
  })

  it('저장소가 예외를 던지면 읽기는 null, 쓰기는 삼킨다', () => {
    expect(loadPersisted(throwing, game)).toBeNull()
    expect(() => savePersisted(throwing, richState())).not.toThrow()
  })
})

describe('레귤레이션이 다른 저장', () => {
  it('세트는 살리고 풀리지 않는 도구·기술·특성만 비운다, 종이 안 풀리면 그 칸을 비운다', () => {
    const saved = serialize(richState())
    const foreign: PersistedParty = {
      ...saved,
      regulation: 'other-reg',
      slots: saved.slots.map((s, i) => {
        if (s === null) return null
        if (i === 0) return { ...s, draft: { ...s.draft, item: '없는도구', ability: 'nope', moves: ['지진', '없는기술', '', ''] } }
        return { ...s, draft: { ...s.draft, species: '없는포켓몬' } }
      }),
    }
    const storage = new MemoryStorage()
    storage.setItem(STORAGE_KEY, JSON.stringify(foreign))
    const loaded = loadPersisted(storage, game)
    expect(loaded).not.toBeNull()
    const first = loaded!.slots[0]!
    expect(first.draft.species).toBe(EXAMPLE_DRAFT.species)
    expect(first.draft.item).toBe('')
    expect(first.draft.ability).toBe('')
    expect(first.draft.moves).toEqual(['지진', '', '', ''])
    expect(first.locks).toHaveLength(1)
    expect(loaded!.slots[2]).toBeNull()
    expect(loaded!.globals.customTargets).toEqual(saved.globals.customTargets)
  })
})
