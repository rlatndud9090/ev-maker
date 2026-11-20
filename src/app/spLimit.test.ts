import { describe, expect, it } from 'vitest'
import { branchBudget, deriveLocks, type CutLock, type LockResolution } from '../cards'
import { realData } from '../cards/testing'
import type { PokemonSet, SpTable } from '../core'
import { baseLockedSp, clampSp, fitUnlocked, spLimit } from './spLimit'

const { game } = realData()
const rules = game.manifest.rules
const sp = (patch: Partial<SpTable>): SpTable => ({ hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...patch })
const mySet = (s: SpTable): PokemonSet => ({
  regulation: game.manifest.regulation.id,
  species: 'garchomp',
  ability: 'roughskin',
  nature: 'hardy',
  sp: s,
  moves: ['earthquake'],
})
const speedLock: CutLock = {
  seq: 1,
  kind: 'speed',
  target: { kind: 'speed', origin: 'ladder', opponentId: 'opp', bundle: { sp: 32, nature: 'plus' }, condition: 'none', filterKind: null },
  stage: 'first',
  stats: ['spe'],
}
const derive = (committed: SpTable, resolution: LockResolution) =>
  deriveLocks({ game, mySet: mySet(committed), locks: [speedLock], resolutions: new Map([[1, resolution]]), baseChoice: null })

describe('spLimit', () => {
  it('고정이 없으면 min(능력치당 상한, 합계 상한 − 다른 능력치 합), 이미 초과면 현재 값', () => {
    expect(spLimit('def', sp({ hp: 2, atk: 32, spe: 32 }), rules, null)).toBe(0)
    expect(spLimit('def', sp({ hp: 2, atk: 32 }), rules, null)).toBe(rules.spMaxPerStat)
    expect(spLimit('def', sp({ hp: 2, atk: 32, spe: 20 }), rules, null)).toBe(rules.spTotal - 54)
    expect(spLimit('hp', sp({ hp: 10, atk: 32, spe: 32 }), rules, null)).toBe(10)
  })

  it('숫자가 아닌 칸(빈 칸·소수)은 자기 칸이든 다른 칸이든 0으로 센다: 빈 칸을 거쳐도 합계 상한을 넘길 수 없다(R18)', () => {
    expect(spLimit('def', sp({ hp: NaN, atk: 32, spe: 32 }), rules, null)).toBe(2)
    expect(spLimit('def', sp({ hp: 1.5, atk: 32, spe: 32 }), rules, null)).toBe(2)
    expect(spLimit('def', sp({ atk: NaN, spe: 32 }), rules, null)).toBe(rules.spMaxPerStat)
    expect(spLimit('def', sp({ def: NaN, hp: 2, atk: 32, spe: 20 }), rules, null)).toBe(12)
    expect(spLimit('def', sp({ hp: 2, atk: 32, spa: NaN, spe: 32 }), rules, { spe: 19 })).toBe(13)
  })

  it('lockedSp의 능력치는 초안 값 대신 그 값으로 센다(고정 능력치 초안은 해제 복원값이다)', () => {
    expect(spLimit('def', sp({ hp: 2, atk: 32, spe: 32 }), rules, { spe: 20 })).toBe(12)
    expect(spLimit('def', sp({ hp: 2, atk: 32, spe: 32 }), rules, { spe: 0 })).toBe(rules.spMaxPerStat)
  })

  it('기준 갈래가 있으면 cards branchBudget의 남은 예산과 같다', () => {
    const committed = sp({ hp: 2, atk: 32, spe: 32 })
    const d = derive(committed, { kind: 'ok', options: { shape: 'single', stat: 'spe', neutral: 20, plus: null } })
    const base = d.branches.find((b) => b.id === d.baseId)
    if (base === undefined) throw new Error('기준 갈래 없음')
    const locked = baseLockedSp(d)
    expect(locked).toEqual({ spe: 20 })
    for (const stat of ['hp', 'def', 'spa', 'spd'] as const) {
      expect(spLimit(stat, committed, rules, locked)).toBe(Math.min(rules.spMaxPerStat, Math.max(committed[stat], branchBudget(d, base, committed, [stat], rules.spTotal).remaining)))
    }
  })

  it('고정이 모두 비활성(기준 갈래 없음)이면 baseLockedSp는 null: 고정 없는 규칙을 쓴다', () => {
    const d = derive(sp({ hp: 2, atk: 32, spe: 32 }), { kind: 'missing' })
    expect(d.baseId).toBeNull()
    expect(baseLockedSp(d)).toBeNull()
    expect(baseLockedSp(null)).toBeNull()
  })
})

describe('clampSp', () => {
  it('0..상한으로 자른다(숫자 입력 40 → 남은 값, 음수 → 0)', () => {
    const committed = sp({ hp: 2, atk: 32, spe: 20 })
    expect(clampSp('def', 40, committed, rules, null)).toBe(12)
    expect(clampSp('def', 5, committed, rules, null)).toBe(5)
    expect(clampSp('def', -3, committed, rules, null)).toBe(0)
    expect(clampSp('def', 40, committed, rules, { spe: 10 })).toBe(22)
    expect(clampSp('def', 32, sp({ hp: NaN, atk: 32, spe: 32 }), rules, null)).toBe(2)
  })
})

describe('fitUnlocked', () => {
  it('고정 밖을 H→A→B→C→D→S 순으로 0을 향해 줄여 합계를 정확히 상한에 맞춘다', () => {
    // H2 A32 B10 + 고정 S30 = 74 → 8 초과: H 2→0, A 32→26
    expect(fitUnlocked(sp({ hp: 2, atk: 32, def: 10, spe: 32 }), 66, { spe: 30 })).toEqual([
      { stat: 'hp', from: 2, to: 0 },
      { stat: 'atk', from: 32, to: 26 },
    ])
  })

  it('고정 능력치는 건너뛰고 0인 칸은 기록하지 않는다', () => {
    // H20 B14 고정, A0 C10 S32 → 20+14+10+32 = 76: A는 0이라 건너뛰고 C 10→0
    expect(fitUnlocked(sp({ hp: 5, def: 3, spa: 10, spe: 32 }), 66, { hp: 20, def: 14 })).toEqual([{ stat: 'spa', from: 10, to: 0 }])
  })

  it('넘지 않거나 합을 알 수 없으면 줄이지 않는다', () => {
    expect(fitUnlocked(sp({ hp: 2, atk: 32, spe: 32 }), 66, { spe: 32 })).toEqual([])
    expect(fitUnlocked(sp({ hp: NaN, atk: 32, spe: 32 }), 66, { spe: 32 })).toEqual([])
  })

  it('고정 밖을 모두 0으로 줄여도 넘으면 줄인 만큼만 돌려준다', () => {
    expect(fitUnlocked(sp({ hp: 4, spe: 0 }), 66, { atk: 32, def: 32, spe: 10 })).toEqual([{ stat: 'hp', from: 4, to: 0 }])
  })
})
