import { describe, expect, it } from 'vitest'
import { TIER_ORDER, judgeDamage, tierRank, type PokemonSet, type RollTier } from '../core'
import { minSumWithFloors, stairsOf } from './stairs'
import { minPairPoints } from './target'
import { realData } from './testing'
import { DEFAULT_ROLL_STEPS } from './types'

const MAX = 32

/** 두 SP에 대해 단조인 합성 판정(점수 → 방어 5단) */
function monotone(a: number, b: number, c: number, cuts: readonly number[]) {
  return (hp: number, d: number): RollTier => {
    const score = a * hp + b * d + c * hp * d
    const r = cuts.filter((x) => score >= x).length
    return TIER_ORDER.defense[Math.min(r, TIER_ORDER.defense.length - 1)]
  }
}

function counted(judge: (hp: number, d: number) => RollTier) {
  const calls = { n: 0 }
  return { calls, judge: (hp: number, d: number) => (calls.n++, judge(hp, d)) }
}

const GRIDS = [
  monotone(1, 1, 0, [10, 25, 40, 55]),
  monotone(2, 1, 0.05, [8, 30, 60, 90]),
  monotone(0.3, 3, 0, [5, 20, 50, 97]),
  monotone(1, 0, 0, [0, 1, 2, 99]),
  monotone(0, 1, 0, [31, 32, 33, 34]),
  monotone(0.5, 0.5, 0.2, [3, 40, 100, 220]),
]

const { game } = realData()
const reg = game.manifest.regulation.id
const attacker: PokemonSet = { regulation: reg, species: 'garchomp', ability: 'roughskin', nature: 'adamant', sp: { hp: 0, atk: 32, def: 0, spa: 0, spd: 0, spe: 32 }, moves: ['earthquake'] }
const defender: PokemonSet = { regulation: reg, species: 'metagross', ability: 'clearbody', nature: 'impish', sp: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, moves: ['ironhead'] }
const realJudge = (hp: number, d: number): RollTier =>
  judgeDamage(game, 'defender', attacker, { ...defender, sp: { ...defender.sp, hp, def: d } }, 'earthquake', undefined, undefined, { ignoreSpTotal: true, rollSteps: DEFAULT_ROLL_STEPS })
    .category as RollTier

function bruteMin(judge: (hp: number, d: number) => RollTier, rank: number, floors: { hp: number; defense: number }) {
  let best: { hp: number; defense: number } | null = null
  for (let hp = floors.hp; hp <= MAX; hp++)
    for (let d = floors.defense; d <= MAX; d++) {
      if (tierRank('defense', judge(hp, d)) < rank) continue
      if (best === null || hp + d < best.hp + best.defense || (hp + d === best.hp + best.defense && hp > best.hp)) best = { hp, defense: d }
    }
  return best
}

describe('stairsOf·minSumWithFloors', () => {
  it('순위별 계단(H 하한 0)의 최소 합 = 기존 minPairPoints 점(합성 격자 + 실데이터)', () => {
    for (const judge of [...GRIDS, realJudge]) {
      const points = minPairPoints(judge, MAX)
      for (const p of points) {
        const stairs = stairsOf(judge, tierRank('defense', p.atLeast), 0, MAX)
        expect(stairs).not.toBe('non-monotonic')
        expect(minSumWithFloors(stairs as (number | null)[], { hp: 0, defense: 0 })).toEqual({ hp: p.hp, defense: p.defense })
      }
      const unreachable = points.length
      if (unreachable < TIER_ORDER.defense.length) {
        const stairs = stairsOf(judge, unreachable, 0, MAX)
        expect(stairs).toEqual(new Array(MAX + 1).fill(null))
      }
    }
  })

  it('고정 이상 범위의 최소 합 = 완전 탐색(동률 H 큰 쪽)', () => {
    const floorsList = [
      { hp: 0, defense: 0 },
      { hp: 12, defense: 0 },
      { hp: 0, defense: 20 },
      { hp: 20, defense: 8 },
      { hp: 32, defense: 32 },
    ]
    for (const judge of [...GRIDS, realJudge])
      for (let rank = 0; rank < TIER_ORDER.defense.length; rank++)
        for (const floors of floorsList) {
          const stairs = stairsOf(judge, rank, floors.hp, MAX)
          expect(stairs).not.toBe('non-monotonic')
          expect(minSumWithFloors(stairs as (number | null)[], floors), `rank ${rank} floors ${JSON.stringify(floors)}`).toEqual(bruteMin(judge, rank, floors))
        }
  })

  it('H 하한 아래 칸은 null, 하한 이상은 그 H의 최소 B/D', () => {
    const judge = GRIDS[0]
    const stairs = stairsOf(judge, 2, 10, MAX) as (number | null)[]
    expect(stairs.slice(0, 10).every((v) => v === null)).toBe(true)
    for (let hp = 10; hp <= MAX; hp++) {
      const v = stairs[hp]
      const min = [...Array(MAX + 1).keys()].find((d) => tierRank('defense', judge(hp, d)) >= 2) ?? null
      expect(v).toBe(min)
    }
  })

  it('H를 올렸는데 마지막 칸이 단계 아래로 떨어지면 non-monotonic', () => {
    const base = GRIDS[0]
    const bad = (hp: number, d: number): RollTier => (hp === MAX ? TIER_ORDER.defense[0] : base(hp, d))
    expect(stairsOf(bad, 2, 0, MAX)).toBe('non-monotonic')
    expect(stairsOf(base, 2, 0, MAX)).not.toBe('non-monotonic')
  })

  it('한 단위 판정은 66회 이하(같은 점은 한 번만)', () => {
    for (const judge of [...GRIDS, realJudge])
      for (let rank = 0; rank < TIER_ORDER.defense.length; rank++)
        for (const hpMin of [0, 5, 16, 32]) {
          const c = counted(judge)
          stairsOf(c.judge, rank, hpMin, MAX)
          expect(c.calls.n).toBeLessThanOrEqual(66)
        }
    const c = counted(monotone(0, 1, 0, [32, 33, 34, 35]))
    stairsOf(c.judge, 1, 0, MAX)
    expect(c.calls.n).toBeLessThanOrEqual(66)
  })

  it('minSumWithFloors: 닿는 점이 없으면 null', () => {
    expect(minSumWithFloors(new Array(MAX + 1).fill(null), { hp: 0, defense: 0 })).toBeNull()
    expect(minSumWithFloors([null, 5, 3], { hp: 0, defense: 4 })).toEqual({ hp: 2, defense: 4 })
  })
})
