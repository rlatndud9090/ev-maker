import { describe, expect, it } from 'vitest'
import type { CutLock, LockTargetKey } from '../cards'
import type { StatId } from '../data/schema'
import type { SetDraft } from '../ui/setDraft'
import { EXAMPLE_DRAFT } from './example'
import type { LockedSp } from './spLimit'
import { initialState, reducer, type AppAction, type AppState } from './state'

const SP_TOTAL = 66
const start = (): AppState => initialState('m-c')
const run = (state: AppState, ...actions: AppAction[]): AppState => actions.reduce(reducer, state)

const speedTarget = (opponentId = 'opp', filterKind: 'tailwind' | null = null): LockTargetKey => ({
  kind: 'speed',
  origin: 'ladder',
  opponentId,
  bundle: { sp: 32, nature: 'plus' },
  condition: filterKind ?? 'none',
  filterKind,
})
const damageTarget = (kind: 'attack' | 'defense', opponentId = 'opp'): LockTargetKey => ({
  kind,
  source: 'ladder',
  opponentId,
  category: 'physical',
  bundle: { ladder: 'k' },
  item: null,
  itemKey: 'earthquake',
})
const speedLock = (opponentId = 'opp', filterKind: 'tailwind' | null = null): Omit<CutLock, 'seq'> => ({
  kind: 'speed',
  target: speedTarget(opponentId, filterKind),
  stage: 'first',
  stats: ['spe'],
})
const attackLock = (opponentId = 'opp'): Omit<CutLock, 'seq'> => ({ kind: 'attack', target: damageTarget('attack', opponentId), stage: 'guaranteed-ohko', stats: ['atk'] })
const defenseLock = (opponentId = 'opp', defense: 'def' | 'spd' = 'def'): Omit<CutLock, 'seq'> => ({
  kind: 'defense',
  target: damageTarget('defense', opponentId),
  stage: 'guaranteed-survive',
  stats: ['hp', defense],
})
const add = (lock: Omit<CutLock, 'seq'>): AppAction => ({ type: 'add-lock', lock, spTotal: SP_TOTAL })
const RULES = { spTotal: SP_TOTAL, spMaxPerStat: 32 }
/** SP 확정. lockedSp = 화면이 함께 보내는 기준 갈래 고정 SP */
const commit = (stat: StatId, value: number, lockedSp: LockedSp | null = null): AppAction => ({ type: 'commit-sp', stat, value, rules: RULES, lockedSp })
const withSp = (d: SetDraft, sp: Partial<Record<StatId, string>>): SetDraft => ({ ...d, sp: { ...d.sp, ...sp } })

const LOCK_FIELDS = { locks: [], lockSeq: 1, lockBase: null, lockNature: null, lockSpTotal: null, lockReveal: null, lockTrim: null, lockFit: null }
const lockFields = (s: AppState) => ({ locks: s.locks, lockSeq: s.lockSeq, lockBase: s.lockBase, lockNature: s.lockNature, lockSpTotal: s.lockSpTotal, lockReveal: s.lockReveal, lockTrim: s.lockTrim, lockFit: s.lockFit })

describe('initialState 고정 필드', () => {
  it('고정 없음·seq 1·기준/상한/이동/자르기 없음', () => {
    expect(lockFields(start())).toEqual(LOCK_FIELDS)
  })
})

describe('add-lock', () => {
  it('seq를 생성 순으로 붙이고 첫 고정의 합계 상한을 기억한다, 세대 +1', () => {
    const s = run(start(), add(speedLock()), { type: 'add-lock', lock: attackLock(), spTotal: 70 })
    expect(s.locks.map((l) => [l.seq, l.kind])).toEqual([
      [1, 'speed'],
      [2, 'attack'],
    ])
    expect(s.lockSeq).toBe(3)
    expect(s.lockSpTotal).toBe(SP_TOTAL)
    expect(s.generation).toBe(2)
    expect(s.draft).toEqual(EXAMPLE_DRAFT)
  })

  it('같은 (대상, 단계, 배분)은 무시하고, 같은 능력치의 다른 단계·다른 대상은 교체한다(seq 새로, 고정 1개)', () => {
    const s = run(start(), add(attackLock()))
    expect(reducer(s, add(attackLock()))).toBe(s)
    const stage = reducer(s, add({ ...attackLock(), stage: 'high-roll-ohko' }))
    expect(stage.locks.map((l) => [l.seq, l.stage])).toEqual([[2, 'high-roll-ohko']])
    const target = reducer(stage, add(attackLock('other')))
    expect(target.locks.map((l) => [l.seq, l.target.opponentId])).toEqual([[3, 'other']])
    const speed = run(start(), add(speedLock('a')), add(speedLock('b')))
    expect(speed.locks.map((l) => [l.seq, l.target.opponentId])).toEqual([[2, 'b']])
    // 배분이 다르면 같은 대상·단계라도 교체한다
    const def = run(start(), add(defenseLock()))
    const hMax = reducer(def, add({ ...defenseLock(), allocation: 'h-max' }))
    expect(hMax.locks.map((l) => [l.seq, l.allocation])).toEqual([[2, 'h-max']])
    expect(reducer(hMax, add({ ...defenseLock(), allocation: 'h-max' }))).toBe(hMax)
  })

  it('교체 규칙: H 밖 능력치가 겹치면 교체(종류가 달라도), H만 공유하는 방어 쌍은 함께 남는다', () => {
    const pairs = run(start(), add(defenseLock('a', 'def')), add(defenseLock('b', 'spd')))
    expect(pairs.locks.map((l) => l.stats)).toEqual([
      ['hp', 'def'],
      ['hp', 'spd'],
    ])
    const hb = reducer(pairs, add(defenseLock('c', 'def')))
    expect(hb.locks.map((l) => [l.seq, l.target.opponentId])).toEqual([
      [2, 'b'],
      [3, 'c'],
    ])
    const bodyPress = reducer(hb, add({ ...attackLock('d'), stats: ['def'] }))
    expect(bodyPress.locks.map((l) => [l.seq, l.kind, l.stats])).toEqual([
      [2, 'defense', ['hp', 'spd']],
      [4, 'attack', ['def']],
    ])
    expect(run(start(), add(speedLock()), add(attackLock())).locks).toHaveLength(2)
  })

  it('교체는 액션 한 번: 세대 +1 한 번·자동 조정 대기, 첫 고정 직전 성격 유지, 다시 고정되는 S는 초안 값 그대로', () => {
    const s = run(start(), add(speedLock('a')), commit('def', 12, { spe: 20 }), { type: 'set-draft', draft: { ...start().draft, nature: 'adamant' } })
    expect(s.draft.sp.spe).toBe('32')
    const next = reducer(s, { type: 'add-lock', lock: speedLock('b'), spTotal: SP_TOTAL, lockedSp: { spe: 20 } })
    expect(next.generation).toBe(s.generation + 1)
    expect(next.lockFit).toBe(next.generation)
    expect(next.lockNature).toEqual(s.lockNature)
    expect(next.draft).toBe(s.draft)
    expect(next.lockTrim).toBeNull()
    expect(next.lockSpTotal).toBe(SP_TOTAL)
  })

  it('바디프레스 B가 H+B를 교체하면 풀리는 H는 복원되고 66을 넘으면 잘린다', () => {
    const h20b14 = withSp(EXAMPLE_DRAFT, { hp: '20', atk: '0', def: '14', spe: '32' })
    const s = run(start(), { type: 'set-draft', draft: h20b14 }, add(defenseLock()), commit('atk', 20, { hp: 0, def: 0, spe: 0 }))
    // 실제 세트: H0 A20 B? S32. B를 바디프레스로 다시 고정(B는 기준 갈래 값 0으로 센다): H20 + A20 + B0 + S32 = 72 → H 14
    const next = reducer(s, { type: 'add-lock', lock: { ...attackLock('bp'), stats: ['def'] }, spTotal: SP_TOTAL, lockedSp: { hp: 0, def: 0 } })
    expect(next.locks.map((l) => l.stats)).toEqual([['def']])
    expect(next.lockTrim).toEqual([{ stat: 'hp', from: 20, to: 14 }])
    expect(next.draft.sp).toMatchObject({ hp: '14', def: '14' })
  })

  it('교체 해제 자르기는 새 고정 능력치를 addingSp(고정 뒤 값)로 센다: 교체 전 기준 갈래 값(B30)으로 세어 H를 더 자르지 않는다', () => {
    const h20b14 = withSp(EXAMPLE_DRAFT, { hp: '20', atk: '0', def: '14', spe: '32' })
    const s = run(start(), { type: 'set-draft', draft: h20b14 }, add(defenseLock()), commit('atk', 20, { hp: 0, def: 30, spe: 0 }))
    const bodyPress = { ...attackLock('bp'), stats: ['def'] } satisfies Omit<CutLock, 'seq'>
    // 교체 전 값으로 세면 H20 + A20 + B30 + S32 = 102 → H 0
    expect(reducer(s, { type: 'add-lock', lock: bodyPress, spTotal: SP_TOTAL, lockedSp: { hp: 20, def: 30 } }).lockTrim).toEqual([{ stat: 'hp', from: 20, to: 0 }])
    // 새 고정 B0으로 세면 H20 + A20 + B0 + S32 = 72 → H 14
    const next = reducer(s, { type: 'add-lock', lock: bodyPress, spTotal: SP_TOTAL, lockedSp: { hp: 20, def: 30 }, addingSp: { def: 0 } })
    expect(next.lockTrim).toEqual([{ stat: 'hp', from: 20, to: 14 }])
    expect(next.draft.sp.hp).toBe('14')
  })

  it('base는 기준 갈래를 바꾸고, 같은 고정이라도 기준이 다르면 다시 건다. 교체된 고정의 이동 요청은 버린다', () => {
    const s = run(start(), add(attackLock()))
    const based = reducer(s, { type: 'add-lock', lock: attackLock(), spTotal: SP_TOTAL, base: 'plus:atk' })
    expect(based.lockBase).toBe('plus:atk')
    expect(based.locks.map((l) => l.seq)).toEqual([2])
    expect(reducer(based, { type: 'add-lock', lock: attackLock(), spTotal: SP_TOTAL, base: 'plus:atk' })).toBe(based)
    const revealed = run(start(), add(speedLock('a')), add(attackLock()), { type: 'reveal-lock', seq: 1 })
    expect(revealed.lockReveal?.seq).toBe(1)
    expect(reducer(revealed, add(speedLock('b'))).lockReveal).toBeNull()
    expect(reducer(revealed, add({ ...defenseLock() })).lockReveal?.seq).toBe(1)
  })

  it('형식이 틀리면 무시한다(종류·단계·능력치 모양·대상 종류·합계 상한)', () => {
    const s = start()
    const bad: Omit<CutLock, 'seq'>[] = [
      { ...speedLock(), stage: 'guaranteed-ohko' },
      { ...speedLock(), stats: ['atk'] },
      { ...speedLock(), stats: ['spe', 'spe'] },
      { ...attackLock(), stats: ['hp'] },
      { ...attackLock(), stats: ['atk', 'spa'] },
      { ...attackLock(), stage: 'guaranteed-survive' },
      { ...attackLock(), target: damageTarget('defense') },
      { ...attackLock(), target: speedTarget() },
      { ...defenseLock(), stats: ['def', 'hp'] },
      { ...defenseLock(), stats: ['hp', 'atk'] },
      { ...defenseLock(), stats: ['hp'] },
      { ...defenseLock(), stage: 'first' },
      { ...defenseLock(), kind: 'speed' },
    ]
    for (const lock of bad) expect(reducer(s, add(lock))).toBe(s)
    const badAlloc = [
      { ...speedLock(), allocation: 'h-max' },
      { ...attackLock(), allocation: 'h-max' },
      { ...defenseLock(), allocation: 'min-sum' },
      { ...defenseLock(), allocation: 'x' },
    ] as unknown as Omit<CutLock, 'seq'>[]
    for (const lock of badAlloc) expect(reducer(s, add(lock))).toBe(s)
    expect(reducer(s, add({ ...defenseLock(), allocation: 'h-max' })).locks[0].allocation).toBe('h-max')
    expect(reducer(s, { type: 'add-lock', lock: speedLock(), spTotal: SP_TOTAL, base: 1 as unknown as string })).toBe(s)
    for (const spTotal of [0, -1, 1.5, NaN]) expect(reducer(s, { type: 'add-lock', lock: speedLock(), spTotal })).toBe(s)
    expect(reducer(s, add({ ...defenseLock(), stage: 'low-roll-ohko' })).locks).toHaveLength(1)
    expect(reducer(s, add({ ...attackLock(), stats: ['def'] })).locks).toHaveLength(1)
  })
})

describe('결정 18 무고정 동일성: 고정 추가 → 전부 해제', () => {
  it('초안이 고정 전과 엄격 동일하고 고정 필드가 초기값으로 돌아온다', () => {
    const before = reducer(start(), { type: 'set-draft', draft: { ...EXAMPLE_DRAFT, nature: 'jolly', natureMinusAuto: true } })
    const locked = run(
      before,
      add(speedLock()),
      add(attackLock()),
      add(defenseLock()),
      { type: 'set-lock-base', id: 'out' },
      // 고정 중 고정 밖 ▲▼로 성격을 바꿔도 전부 해제하면 첫 고정 직전 성격으로 돌아온다(R13)
      { type: 'set-draft', draft: { ...before.draft, nature: 'modest', natureMinusAuto: false } },
    )
    expect(locked.draft.nature).toBe('modest')
    const after = run(locked, { type: 'remove-lock', seq: 2 }, { type: 'remove-lock', seq: 1 }, { type: 'remove-lock', seq: 3 })
    expect(after.draft).toEqual(before.draft)
    for (const k of Object.keys(before.draft) as (keyof SetDraft)[]) expect(after.draft[k]).toEqual(before.draft[k])
    expect(Object.keys(after.draft).sort()).toEqual(Object.keys(before.draft).sort())
    expect(lockFields(after)).toEqual(LOCK_FIELDS)
    expect({ ...after, generation: 0 }).toEqual({ ...before, generation: 0 })
  })

  it('자동 하락 표지가 없던 초안은 고정 중 편집 뒤에도 표지 없이 돌아온다', () => {
    const before = start()
    expect('natureMinusAuto' in before.draft).toBe(false)
    const s = run(before, add(speedLock()), { type: 'set-draft', draft: { ...before.draft, nature: 'timid', natureMinusAuto: true } })
    expect(s.draft.natureMinusAuto).toBe(true)
    const after = reducer(s, { type: 'remove-lock', seq: 1 }).draft
    expect(after).toEqual(before.draft)
    expect('natureMinusAuto' in after).toBe(false)
  })
})

describe('고정 중 정규화', () => {
  it('기술·도구·성격 편집은 받고 고정 능력치 SP만 덮어쓴다, 세대 +1. 첫 고정 직전 성격은 lockNature에 남는다', () => {
    const s = run(start(), add(speedLock()))
    const edited = { ...withSp(s.draft, { spe: '5', def: '3' }), moves: ['지진', '', '', ''], item: '구애스카프', nature: 'jolly', natureMinusAuto: true }
    const next = reducer(s, { type: 'set-draft', draft: edited })
    expect(next.draft.moves).toEqual(['지진', '', '', ''])
    expect(next.draft.item).toBe('구애스카프')
    expect(next.draft.sp.def).toBe('3')
    expect(next.draft.sp.spe).toBe('32')
    expect(next.draft.nature).toBe('jolly')
    expect(next.draft.natureMinusAuto).toBe(true)
    expect(next.lockNature).toEqual({ nature: 'hardy' })
    expect(next.generation).toBe(s.generation + 1)
    // 두 번째 고정은 복원값을 덮지 않는다
    expect(reducer(next, add(attackLock())).lockNature).toEqual({ nature: 'hardy' })
  })

  it('고정 능력치 SP만 바꾼 편집은 상태 그대로(세대 그대로)', () => {
    const s = run(start(), add(speedLock()))
    expect(reducer(s, { type: 'set-draft', draft: withSp(s.draft, { spe: '0' }) })).toBe(s)
  })

  it('고정 능력치 commit-sp는 무시하고 다른 능력치는 받는다', () => {
    const s = run(start(), add(defenseLock()))
    const lockedSp = { hp: 0, def: 0 }
    expect(reducer(s, commit('hp', 10, lockedSp))).toBe(s)
    expect(reducer(s, commit('def', 10, lockedSp))).toBe(s)
    const spd = reducer(s, commit('spd', 2, lockedSp))
    expect(spd.draft.sp.spd).toBe('2')
    expect(spd.generation).toBe(s.generation + 1)
  })
})

describe('AC6 해제 복원', () => {
  it('S 고정과 공격 고정 중 S만 풀면 S는 고정 전 값, 공격 고정은 남는다', () => {
    const s = run(start(), add(speedLock()), add(attackLock()), { type: 'set-draft', draft: withSp(EXAMPLE_DRAFT, { spe: '0', atk: '0' }) })
    expect(s.draft.sp.spe).toBe('32')
    const next = reducer(s, { type: 'remove-lock', seq: 1 })
    expect(next.draft.sp.spe).toBe('32')
    expect(next.locks.map((l) => l.seq)).toEqual([2])
    expect(next.lockSpTotal).toBe(SP_TOTAL)
    expect(next.lockTrim).toBeNull()
    expect(next.generation).toBe(s.generation + 1)
    expect(reducer(next, commit('spe', 10)).draft.sp.spe).toBe('10')
    expect(reducer(next, commit('atk', 10, { atk: 10 }))).toBe(next)
  })

  it('H2 A32 S32에서 S 고정 → B12 → S 해제면 S는 20으로 잘리고 알림이 남는다', () => {
    const s = run(start(), add(speedLock()), commit('def', 12, { spe: 20 }))
    expect(s.draft.sp).toEqual({ hp: '2', atk: '32', def: '12', spa: '0', spd: '0', spe: '32' })
    const next = reducer(s, { type: 'remove-lock', seq: 1 })
    expect(next.draft.sp.spe).toBe('20')
    expect(next.lockTrim).toEqual([{ stat: 'spe', from: 32, to: 20 }])
    expect(next.locks).toEqual([])
    expect(next.lockSpTotal).toBeNull()
    const dismissed = reducer(next, { type: 'dismiss-lock-trim' })
    expect(dismissed.lockTrim).toBeNull()
    expect(dismissed.generation).toBe(next.generation)
    expect(reducer(dismissed, { type: 'dismiss-lock-trim' })).toBe(dismissed)
  })

  it('다른 고정이 남은 부분 해제는 남은 고정 능력치를 기준 갈래 SP(lockedSp)로 세어 자른다', () => {
    // H2 A32 S32에서 S 고정(S20)·A 고정(A10) → B32. S만 풀면 실제 세트는 H2 A10 B32라 S는 66 − 44 = 22까지 남는다
    const s = run(start(), add(speedLock()), add(attackLock()), commit('def', 32, { spe: 20, atk: 10 }))
    expect(s.draft.sp).toEqual({ hp: '2', atk: '32', def: '32', spa: '0', spd: '0', spe: '32' })
    const next = reducer(s, { type: 'remove-lock', seq: 1, lockedSp: { spe: 20, atk: 10 } })
    expect(next.draft.sp.spe).toBe('22')
    expect(next.draft.sp.atk).toBe('32')
    expect(next.lockTrim).toEqual([{ stat: 'spe', from: 32, to: 22 }])
    expect(reducer(s, { type: 'remove-lock', seq: 1 }).draft.sp.spe).toBe('0')
  })

  const h20b14 = withSp(EXAMPLE_DRAFT, { hp: '20', atk: '0', def: '14', spe: '32' })

  it('같은 능력치(H) 고정이 남아 있으면 그 능력치는 풀리지 않는다: H+B만 풀면 H는 고정 유지, B만 복원', () => {
    const s = run(start(), { type: 'set-draft', draft: h20b14 }, add(defenseLock('a', 'def')), add(defenseLock('b', 'spd')), commit('atk', 20, { hp: 0, def: 0, spd: 0 }))
    const next = reducer(s, { type: 'remove-lock', seq: 1, lockedSp: { hp: 0, def: 0, spd: 0 } })
    expect(next.locks.map((l) => l.seq)).toEqual([2])
    // H(고정 유지)는 기준 갈래 값 0으로 세어 H0 A20 B14 D0 S32 = 66 → 자르지 않는다
    expect(next.lockTrim).toBeNull()
    expect(next.draft.sp).toEqual({ hp: '20', atk: '20', def: '14', spa: '0', spd: '0', spe: '32' })
    expect(reducer(next, commit('hp', 1, { hp: 0, spd: 0 }))).toBe(next)
  })

  it('방어 쌍 고정을 풀면 두 능력치를 함께 복원하고 B부터 자른다', () => {
    const s = run(start(), { type: 'set-draft', draft: h20b14 }, add(defenseLock()), commit('atk', 20, { hp: 0, def: 0, spe: 0 }))
    const next = reducer(s, { type: 'remove-lock', seq: 1 })
    expect(next.lockTrim).toEqual([
      { stat: 'def', from: 14, to: 0 },
      { stat: 'hp', from: 20, to: 14 },
    ])
    expect(next.draft.sp).toEqual({ hp: '14', atk: '20', def: '0', spa: '0', spd: '0', spe: '32' })
  })

  it('전부 해제(종 변경)는 나중에 만든 고정의 능력치부터 자른다', () => {
    const sneasler = { ...EXAMPLE_DRAFT, species: '포푸니크' }
    const leave = (first: Omit<CutLock, 'seq'>, second: Omit<CutLock, 'seq'>) =>
      run(start(), { type: 'set-draft', draft: h20b14 }, add(first), add(second), commit('atk', 20, { hp: 0, def: 0, spe: 0 }), { type: 'switch-species', from: 'garchomp', to: 'sneasler', draft: sneasler })
    const defLast = leave(speedLock(), defenseLock())
    expect(defLast.lockTrim).toEqual([
      { stat: 'def', from: 14, to: 0 },
      { stat: 'hp', from: 20, to: 14 },
    ])
    expect(defLast.draftCache.garchomp.sp).toEqual({ hp: '14', atk: '20', def: '0', spa: '0', spd: '0', spe: '32' })
    const speLast = leave(defenseLock(), speedLock())
    expect(speLast.lockTrim).toEqual([{ stat: 'spe', from: 32, to: 12 }])
    expect(speLast.draftCache.garchomp.sp).toEqual({ hp: '20', atk: '20', def: '14', spa: '0', spd: '0', spe: '12' })
  })

  it('알림은 마지막 고정 조작의 것만 남는다: 잘림 없는 해제·새 핀·기준 갈래 변경은 이전 알림을 지운다', () => {
    const trimmed = run(start(), add(speedLock()), commit('def', 12, { spe: 20 }), { type: 'remove-lock', seq: 1 })
    expect(trimmed.lockTrim).toEqual([{ stat: 'spe', from: 32, to: 20 }])
    const pinned = reducer(trimmed, add(attackLock()))
    expect(pinned.lockTrim).toBeNull()
    expect(reducer({ ...pinned, lockTrim: trimmed.lockTrim }, { type: 'remove-lock', seq: 1 }).lockTrim).toBeNull()
    expect(reducer({ ...pinned, lockTrim: trimmed.lockTrim }, { type: 'set-lock-base', id: 'out' }).lockTrim).toBeNull()
  })

  it('없는 seq 해제는 무시한다', () => {
    const s = run(start(), add(speedLock()))
    expect(reducer(s, { type: 'remove-lock', seq: 9 })).toBe(s)
  })
})

describe('AC8 종 변경', () => {
  const sneasler: SetDraft = { ...EXAMPLE_DRAFT, species: '포푸니크', ability: 'unburden', item: '하얀허브', nature: 'adamant', moves: ['인파이트', '', '', ''] }

  it('고정을 비우고 보관소에는 잘린(합계 이하) 초안을 넣는다, 돌아와도 고정은 비어 있다', () => {
    const s = run(
      start(),
      add(speedLock()),
      { type: 'set-lock-base', id: 'out' },
      commit('def', 12, { spe: 20 }),
      { type: 'reveal-lock', seq: 1 },
      { type: 'set-draft', draft: { ...start().draft, sp: { ...start().draft.sp, def: '12' }, nature: 'modest', natureMinusAuto: false } },
    )
    const moved = reducer(s, { type: 'switch-species', from: 'garchomp', to: 'sneasler', draft: sneasler })
    expect(moved.locks).toEqual([])
    expect(moved.lockNature).toBeNull()
    // 보관소 초안도 첫 고정 직전 성격으로 돌아간다(R13)
    expect(moved.draftCache.garchomp.nature).toBe(start().draft.nature)
    expect(moved.lockBase).toBeNull()
    expect(moved.lockSpTotal).toBeNull()
    expect(moved.lockReveal).toBeNull()
    expect(moved.lockSeq).toBe(1)
    expect(moved.lockTrim).toEqual([{ stat: 'spe', from: 32, to: 20 }])
    expect(moved.draft).toEqual(sneasler)
    const cached = moved.draftCache.garchomp
    expect(cached.sp).toEqual({ hp: '2', atk: '32', def: '12', spa: '0', spd: '0', spe: '20' })
    expect(Object.values(cached.sp).reduce((a, v) => a + Number(v), 0)).toBeLessThanOrEqual(SP_TOTAL)
    expect(moved.speciesGeneration).toBe(moved.generation)
    expect(moved.generation).toBeGreaterThan(s.generation)
    const back = reducer(moved, { type: 'switch-species', from: 'sneasler', to: 'garchomp', draft: { ...sneasler, species: 'garchomp' } })
    expect(back.locks).toEqual([])
    expect(back.draft).toEqual({ ...cached, species: 'garchomp' })
  })

  it('메가 전환(원종 ↔ 메가 폼 종, sameBase)은 고정을 유지하고 고정 능력치를 덮어쓴 초안을 받는다', () => {
    const s = run(start(), add(speedLock()), commit('def', 12, { spe: 20 }))
    const megaDraft = { ...withSp(s.draft, { spe: '0', def: '4' }), species: '메가한카리아스', item: '한카리아스나이트' }
    const mega = reducer(s, { type: 'switch-species', from: 'garchomp', to: 'garchompmega', draft: megaDraft, sameBase: true })
    expect(mega.locks).toEqual(s.locks)
    expect(mega.lockSpTotal).toBe(SP_TOTAL)
    expect(mega.lockTrim).toBeNull()
    expect(mega.draft.species).toBe('메가한카리아스')
    expect(mega.draft.sp.spe).toBe('32')
    expect(mega.draft.sp.def).toBe('4')
    expect(mega.draftCache.garchomp).toEqual(s.draft)
    expect(mega.generation).toBe(s.generation + 1)
    const back = reducer(mega, { type: 'switch-species', from: 'garchompmega', to: 'garchomp', draft: { ...megaDraft, species: '한카리아스' }, sameBase: true })
    expect(back.locks).toEqual(s.locks)
    expect(back.draft.sp).toEqual(s.draft.sp)
  })

  it('sameBase가 없으면 메가 폼 종으로 바꿔도 종 변경이다(고정을 지운다)', () => {
    const s = run(start(), add(speedLock()))
    const moved = reducer(s, { type: 'switch-species', from: 'garchomp', to: 'garchompmega', draft: { ...s.draft, species: '메가한카리아스' } })
    expect(moved.locks).toEqual([])
  })
})

describe('reveal-lock', () => {
  it('그 고정의 탭으로 바꾸고 nonce를 올린다, 세대 그대로', () => {
    const s = run(start(), add(speedLock()), add(defenseLock()))
    const r1 = reducer(s, { type: 'reveal-lock', seq: 2 })
    expect(r1.tab).toBe('defense')
    expect(r1.lockReveal).toEqual({ seq: 2, nonce: 1 })
    expect(r1.generation).toBe(s.generation)
    const r2 = reducer(r1, { type: 'reveal-lock', seq: 2 })
    expect(r2.lockReveal).toEqual({ seq: 2, nonce: 2 })
    const r3 = reducer(r2, { type: 'reveal-lock', seq: 1 })
    expect(r3.tab).toBe('speed')
    expect(r3.lockReveal).toEqual({ seq: 1, nonce: 3 })
    expect(reducer(s, { type: 'reveal-lock', seq: 9 })).toBe(s)
  })

  it('스피드 고정의 꺼진 조건 필터만 켜고 상위 N·선택은 그대로, 세대 그대로', () => {
    const s = run(start(), { type: 'set-selected', ids: ['garchomp'] }, add(speedLock('opp', 'tailwind')))
    expect(s.speedChart.filters.tailwind).toBe(false)
    const r = reducer(s, { type: 'reveal-lock', seq: 1 })
    expect(r.speedChart.filters).toEqual({ ...s.speedChart.filters, tailwind: true })
    expect(r.filters).toBe(s.filters)
    expect(r.generation).toBe(s.generation)
    const plain = run(start(), add(speedLock()))
    expect(reducer(plain, { type: 'reveal-lock', seq: 1 }).speedChart).toBe(plain.speedChart)
  })

  it('다른 탭으로 가면 이동 요청을 버린다, 같은 탭·clear-reveal', () => {
    const r = run(start(), add(attackLock()), { type: 'set-tab', tab: 'speed' }, { type: 'reveal-lock', seq: 1 })
    expect(r.tab).toBe('attack')
    expect(reducer(r, { type: 'set-tab', tab: 'attack' })).toBe(r)
    expect(reducer(r, { type: 'set-tab', tab: 'defense' }).lockReveal).toBeNull()
    const cleared = reducer(r, { type: 'clear-reveal' })
    expect(cleared.lockReveal).toBeNull()
    expect(cleared.generation).toBe(r.generation)
    expect(reducer(cleared, { type: 'clear-reveal' })).toBe(cleared)
  })

  it('처리 뒤 비운(clear-reveal) 요청을 다시 내도 nonce는 계속 오른다(같은 탭에서 두 번 눌러도 새 요청)', () => {
    const s = run(start(), add(attackLock()), { type: 'reveal-lock', seq: 1 })
    expect(s.lockReveal).toEqual({ seq: 1, nonce: 1 })
    const again = run(s, { type: 'clear-reveal' }, { type: 'reveal-lock', seq: 1 })
    expect(again.lockReveal).toEqual({ seq: 1, nonce: 2 })
    const afterTab = run(again, { type: 'set-tab', tab: 'speed' }, { type: 'reveal-lock', seq: 1 })
    expect(afterTab.lockReveal).toEqual({ seq: 1, nonce: 3 })
  })

  it('이동 요청 대상 고정을 풀면 요청도 버린다', () => {
    const r = run(start(), add(attackLock()), add(speedLock()), { type: 'reveal-lock', seq: 1 })
    expect(reducer(r, { type: 'remove-lock', seq: 1 }).lockReveal).toBeNull()
    expect(reducer(r, { type: 'remove-lock', seq: 2 }).lockReveal).toEqual(r.lockReveal)
  })
})

describe('set-lock-base(AC14 상태)', () => {
  it('계산 입력: 바뀌면 세대 +1, 같은 값은 그대로, 고정이 없으면 무시', () => {
    expect(reducer(start(), { type: 'set-lock-base', id: 'out' }).lockBase).toBeNull()
    const s = run(start(), add(speedLock()), add(attackLock()))
    const based = reducer(s, { type: 'set-lock-base', id: 'plus:spe' })
    expect(based.lockBase).toBe('plus:spe')
    expect(based.generation).toBe(s.generation + 1)
    expect(reducer(based, { type: 'set-lock-base', id: 'plus:spe' })).toBe(based)
    expect(reducer(based, { type: 'set-lock-base', id: null }).generation).toBe(based.generation + 1)
  })

  it('고정이 남아 있으면 기준 선택을 지키고, 0개가 되면 비운다', () => {
    const s = run(start(), add(speedLock()), add(attackLock()), { type: 'set-lock-base', id: 'plus:atk' })
    const one = reducer(s, { type: 'remove-lock', seq: 1 })
    expect(one.lockBase).toBe('plus:atk')
    expect(reducer(one, { type: 'remove-lock', seq: 2 }).lockBase).toBeNull()
  })
})

describe('세대를 올리지 않는 액션', () => {
  it('스피드 차트 상태·이동 요청·자르기 알림은 고정 중에도 세대 그대로', () => {
    const s = run(start(), add(speedLock()))
    const actions: AppAction[] = [
      { type: 'set-speed-filter', kind: 'tailwind', on: true },
      { type: 'set-my-tailwind', on: true },
      { type: 'add-speed-bundle', bundle: { source: 'ladder', opponentId: 'x', sp: 10, nature: 'plus' }, spMax: 32 },
      { type: 'reveal-lock', seq: 1 },
      { type: 'clear-reveal' },
      { type: 'dismiss-lock-trim' },
      { type: 'set-tab', tab: 'defense' },
    ]
    expect(run(s, ...actions).generation).toBe(s.generation)
  })
})

describe('R19 고정 초과 자동 조정(fit-locks)', () => {
  const fit = (s: AppState, lockedSp: LockedSp | null): AppState => reducer(s, { type: 'fit-locks', token: s.lockFit ?? -1, lockedSp })

  it('핀 고정은 그 세대로 표지를 단다. 파생이 오면 고정 밖을 H→A 순으로 줄여 66에 맞추고 알린 뒤 표지를 비운다', () => {
    const s = run(start(), add(speedLock()))
    expect(s.lockFit).toBe(s.generation)
    // H2 A32 + 기준 갈래 S40(가정) = 74 → H 2→0, A 32→26
    const next = fit(s, { spe: 40 })
    expect(next.draft.sp).toEqual({ hp: '0', atk: '26', def: '0', spa: '0', spd: '0', spe: '32' })
    expect(next.lockTrim).toEqual([
      { stat: 'hp', from: 2, to: 0 },
      { stat: 'atk', from: 32, to: 26 },
    ])
    expect(next.lockFit).toBeNull()
    expect(next.generation).toBe(s.generation + 1)
  })

  it('넘지 않으면 초안은 그대로 표지만 비운다(세대 그대로)', () => {
    const s = run(start(), add(speedLock()))
    const next = fit(s, { spe: 19 })
    expect(next.draft).toBe(s.draft)
    expect(next.lockTrim).toBeNull()
    expect(next.lockFit).toBeNull()
    expect(next.generation).toBe(s.generation)
  })

  it('한 번만 적용한다: 표지를 비운 뒤의 fit-locks(재계산으로 생긴 초과 포함)는 무시한다', () => {
    const s = fit(run(start(), add(speedLock())), { spe: 19 })
    // 도구 변경(재계산)으로 고정 SP가 커져도 표지가 없어 줄이지 않는다
    const item = reducer(s, { type: 'set-draft', draft: { ...s.draft, item: '생명의구슬' } })
    expect(item.lockFit).toBeNull()
    expect(reducer(item, { type: 'fit-locks', token: item.generation, lockedSp: { spe: 40 } })).toBe(item)
    const trimmed = fit(run(start(), add(speedLock())), { spe: 40 })
    expect(reducer(trimmed, { type: 'fit-locks', token: trimmed.generation, lockedSp: { spe: 40 } })).toBe(trimmed)
  })

  it('교체의 해제 자르기 알림에 뒤이은 자동 조정 자르기를 합친다(같은 능력치는 처음 값 → 마지막 값)', () => {
    const h20b14 = withSp(EXAMPLE_DRAFT, { hp: '20', atk: '0', def: '14', spe: '32' })
    const s = run(start(), { type: 'set-draft', draft: h20b14 }, add(defenseLock()), commit('atk', 20, { hp: 0, def: 0, spe: 0 }))
    const replaced = reducer(s, { type: 'add-lock', lock: { ...attackLock('bp'), stats: ['def'] }, spTotal: SP_TOTAL, lockedSp: { hp: 0, def: 0 }, addingSp: { def: 0 } })
    expect(replaced.lockTrim).toEqual([{ stat: 'hp', from: 20, to: 14 }])
    // 파생 B10: H14 + A20 + B10 + S32 = 76 → H 14→4
    expect(fit(replaced, { def: 10 }).lockTrim).toEqual([{ stat: 'hp', from: 20, to: 4 }])
    // 파생 B30: 96 → H 14→0, A 20→4
    expect(fit(replaced, { def: 30 }).lockTrim).toEqual([
      { stat: 'hp', from: 20, to: 0 },
      { stat: 'atk', from: 20, to: 4 },
    ])
    // 알림을 닫은 뒤라면 자동 조정 자르기만
    expect(fit(reducer(replaced, { type: 'dismiss-lock-trim' }), { def: 10 }).lockTrim).toEqual([{ stat: 'hp', from: 14, to: 4 }])
  })

  it('지난 표지(token 불일치)는 무시한다', () => {
    const s = run(start(), add(speedLock()), add(attackLock()))
    expect(s.lockFit).toBe(s.generation)
    expect(reducer(s, { type: 'fit-locks', token: s.generation - 1, lockedSp: { spe: 40 } })).toBe(s)
  })

  it('기준 갈래 변경(set-lock-base)도 표지를 단다. 같은 선택은 표지를 달지 않는다', () => {
    const s = fit(run(start(), add(speedLock())), { spe: 19 })
    const picked = reducer(s, { type: 'set-lock-base', id: 'plus:spe' })
    expect(picked.lockFit).toBe(picked.generation)
    const done = fit(picked, { spe: 7 })
    expect(reducer(done, { type: 'set-lock-base', id: 'plus:spe' })).toBe(done)
  })

  it('기준 갈래가 없으면(null) 줄이지 않고 표지만 비운다', () => {
    const s = run(start(), add(speedLock()))
    const next = fit(s, null)
    expect(next.draft).toBe(s.draft)
    expect(next.lockFit).toBeNull()
  })

  it('갈래 계산에서 빠진 고정의 능력치는 줄이지 않고 초안 값으로 센다', () => {
    // 방어 고정(H·B)이 문제 고정이라 lockedSp에 없다: H2는 줄이지 않고 A부터
    const s = run(start(), add(defenseLock()), add(speedLock()))
    const next = fit(s, { spe: 40 })
    expect(next.lockTrim).toEqual([{ stat: 'atk', from: 32, to: 24 }])
    expect(next.draft.sp.hp).toBe('2')
  })

  it('고정을 모두 풀면 표지도 비운다', () => {
    const s = run(start(), add(speedLock()), { type: 'remove-lock', seq: 1 })
    expect(s.lockFit).toBeNull()
  })
})
