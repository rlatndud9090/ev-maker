import { describe, expect, it } from 'vitest'
import type { CutLock } from '../cards'
import type { StatId } from '../data/schema'
import type { SetDraft } from '../ui/setDraft'
import type { LockedSp } from './spLimit'
import { initialState, reducer, type AppAction, type AppState } from './state'

const SP_TOTAL = 66
const RULES = { spTotal: SP_TOTAL, spMaxPerStat: 32 }
const start = (): AppState => initialState('m-c')
const run = (state: AppState, ...actions: AppAction[]): AppState => actions.reduce(reducer, state)

const speedLock: Omit<CutLock, 'seq'> = {
  kind: 'speed',
  target: { kind: 'speed', origin: 'ladder', opponentId: 'opp', bundle: { sp: 32, nature: 'plus' }, condition: 'none', filterKind: null },
  stage: 'first',
  stats: ['spe'],
}
const locked = (): AppState => run(start(), { type: 'add-lock', lock: speedLock, spTotal: SP_TOTAL })

interface AdjustInput {
  sp?: Partial<Record<StatId, number>>
  nature?: Pick<SetDraft, 'nature' | 'natureMinusAuto'>
  lockBase?: string
  lockedSp?: LockedSp
  keep?: readonly StatId[]
}
const adjust = ({ sp = {}, nature, lockBase, lockedSp = {}, keep = [] }: AdjustInput): AppAction => {
  const action: AppAction = { type: 'apply-adjust', sp, lockedSp, keep, rules: RULES }
  if (nature !== undefined) action.nature = nature
  if (lockBase !== undefined) action.lockBase = lockBase
  return action
}
const spOf = (s: AppState) => s.draft.sp

describe('apply-adjust 고정 없음', () => {
  it('조정·keep 능력치는 두고 나머지를 H→S 순서로 줄여 알림에 남긴다, 세대 +1 한 번', () => {
    const s = start()
    const next = reducer(s, adjust({ sp: { def: 20 }, keep: ['def', 'atk'] }))
    expect(spOf(next)).toEqual({ hp: '0', atk: '32', def: '20', spa: '0', spd: '0', spe: '14' })
    expect(next.lockTrim).toEqual([
      { stat: 'hp', from: 2, to: 0 },
      { stat: 'spe', from: 32, to: 14 },
    ])
    expect(next.generation).toBe(s.generation + 1)
    expect(next.lockBase).toBeNull()
  })

  it('예산 안이면 자르지 않고 이전 알림을 비운다', () => {
    const s = { ...run(start(), { type: 'commit-sp', stat: 'spe', value: 20, rules: RULES, lockedSp: null }), lockTrim: [{ stat: 'hp' as const, from: 9, to: 0 }] }
    const next = reducer(s, adjust({ sp: { def: 12 }, keep: ['def'] }))
    expect(spOf(next).def).toBe('12')
    expect(next.lockTrim).toBeNull()
  })

  it('SP를 0..spMaxPerStat 정수로 자른다', () => {
    const s = run(start(), { type: 'commit-sp', stat: 'atk', value: 0, rules: RULES, lockedSp: null }, { type: 'commit-sp', stat: 'spe', value: 0, rules: RULES, lockedSp: null })
    expect(spOf(reducer(s, adjust({ sp: { def: 50 } }))).def).toBe('32')
    expect(spOf(reducer(s, adjust({ sp: { def: -3, spd: 7.6 } })))).toMatchObject({ def: '0', spd: '8' })
    expect(reducer(s, adjust({ sp: { def: Number.NaN } }))).toBe(s)
  })

  it('기준 갈래 id는 고정이 없으면 무시한다', () => {
    const s = start()
    expect(reducer(s, adjust({ lockBase: 'b2' }))).toBe(s)
  })

  it('바뀐 게 없으면 상태 그대로', () => {
    const s = start()
    expect(reducer(s, adjust({ sp: { atk: 32, spe: 32 }, keep: ['atk'] }))).toBe(s)
    expect(reducer(s, adjust({ nature: { nature: 'hardy' } }))).toBe(s)
  })

  it('초안에 숫자가 아닌 칸이 있으면 줄이지 않는다', () => {
    const s = reducer(start(), { type: 'set-draft', draft: { ...start().draft, sp: { ...start().draft.sp, hp: '' } } })
    const next = reducer(s, adjust({ sp: { def: 20 }, keep: ['def'] }))
    expect(spOf(next)).toMatchObject({ hp: '', atk: '32', def: '20', spe: '32' })
    expect(next.lockTrim).toBeNull()
  })
})

describe('apply-adjust 성격', () => {
  it('성격과 자동 하락 표지를 쓰고, 표지가 없으면 지운다', () => {
    const withAuto = reducer(start(), adjust({ nature: { nature: 'adamant', natureMinusAuto: true } }))
    expect(withAuto.draft.nature).toBe('adamant')
    expect(withAuto.draft.natureMinusAuto).toBe(true)
    expect(withAuto.generation).toBe(1)
    const plain = reducer(withAuto, adjust({ nature: { nature: 'jolly' } }))
    expect(plain.draft.nature).toBe('jolly')
    expect('natureMinusAuto' in plain.draft).toBe(false)
  })
})

describe('apply-adjust 고정 중', () => {
  it('고정 능력치 키는 버리고(초안 값 = 복원값 유지) 고정·기준 갈래를 그대로 둔다', () => {
    const s = run(locked(), { type: 'set-lock-base', id: 'b1' })
    const next = reducer(s, adjust({ sp: { spe: 10, def: 10 }, lockedSp: { spe: 20 }, keep: ['def'] }))
    expect(spOf(next)).toMatchObject({ hp: '2', atk: '32', def: '10', spe: '32' })
    expect(next.locks).toBe(s.locks)
    expect(next.lockBase).toBe('b1')
    expect(next.lockTrim).toBeNull()
    expect(next.generation).toBe(s.generation + 1)
  })

  it('기준 갈래 고정 SP로 세어 lockSpTotal에 맞추고 고정 능력치는 줄이지 않는다', () => {
    const next = reducer(locked(), adjust({ sp: { def: 20 }, lockedSp: { spe: 28 }, keep: ['def'] }))
    expect(spOf(next)).toMatchObject({ hp: '0', atk: '18', def: '20', spe: '32' })
    expect(next.lockTrim).toEqual([
      { stat: 'hp', from: 2, to: 0 },
      { stat: 'atk', from: 32, to: 18 },
    ])
  })

  it('lockedSp에서 빠진 고정 능력치는 초안 값으로 센다', () => {
    const next = reducer(locked(), adjust({ sp: { def: 10 }, keep: ['def'] }))
    expect(spOf(next)).toMatchObject({ hp: '0', atk: '24', def: '10', spe: '32' })
  })

  it('기준 갈래를 바꾸고 SP가 그대로여도 세대 +1 한 번', () => {
    const s = locked()
    const next = reducer(s, adjust({ lockBase: 'b2', lockedSp: { spe: 32 } }))
    expect(next.lockBase).toBe('b2')
    expect(next.generation).toBe(s.generation + 1)
    expect(reducer(next, adjust({ lockBase: 'b2', lockedSp: { spe: 32 } }))).toBe(next)
  })

  it('대기 중인 자동 조정 표지를 지운다', () => {
    const s = locked()
    expect(s.lockFit).toBe(s.generation)
    const next = reducer(s, adjust({ sp: { def: 0 }, lockBase: 'b2', lockedSp: { spe: 32 } }))
    expect(next.lockFit).toBeNull()
  })
})
