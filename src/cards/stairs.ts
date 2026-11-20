// 방어 쌍 계단: (H, B/D) 판정에서 한 방어 순위에 닿는 H별 최소 B/D. 판정은 judge 콜백으로만 한다.
import { tierRank, type RollTier } from '../core'
import type { Stairs } from './lock'

/**
 * H hpMin~max마다 rank(tierRank 'defense') 이상에 닿는 최소 B/D(hpMin 아래 칸은 null). judge(hp, defense)는 두 SP에 대해
 * 단조라고 가정하고 H를 올리며 B/D를 줄여 간다. 판정은 2 × (max + 1)회 이하이고 같은 점은 한 번만 판정한다.
 * 계단 마지막 칸(H 최대)의 값을 다시 판정해 닿지 않으면 'non-monotonic'(계단 자체만 검사한다).
 */
export function stairsOf(judge: (hp: number, defense: number) => RollTier, rank: number, hpMin: number, max: number): Stairs | 'non-monotonic' {
  const memo = new Map<number, boolean>()
  const reaches = (hp: number, d: number): boolean => {
    const k = hp * (max + 1) + d
    let v = memo.get(k)
    if (v === undefined) {
      v = tierRank('defense', judge(hp, d)) >= rank
      memo.set(k, v)
    }
    return v
  }
  const out: (number | null)[] = new Array<number | null>(max + 1).fill(null)
  let d = -1
  let verified = false
  for (let hp = hpMin; hp <= max; hp++) {
    verified = false
    if (d < 0) {
      if (!reaches(hp, max)) continue
      d = max
      verified = true
    }
    while (d > 0 && reaches(hp, d - 1)) {
      d--
      verified = true
    }
    out[hp] = d
  }
  if (d >= 0 && !verified && !reaches(max, d)) return 'non-monotonic'
  return out
}

/** floors 이상 범위에서 H + B/D 합 최소인 계단 점(동률이면 H 큰 쪽). 닿는 점이 없으면 null */
export function minSumWithFloors(stairs: Stairs, floors: { hp: number; defense: number }): { hp: number; defense: number } | null {
  let best: { hp: number; defense: number } | null = null
  for (let hp = Math.max(0, floors.hp); hp < stairs.length; hp++) {
    const v = stairs[hp]
    if (v === null || v === undefined) continue
    const defense = Math.max(v, floors.defense)
    if (best === null || hp + defense <= best.hp + best.defense) best = { hp, defense }
  }
  return best
}
