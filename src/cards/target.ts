// "최소 A32 / A15+" 목표. 판정과 순위는 코어(rollTier 범주·tierRank)만 쓴다.
// 한 단계 위 = tierRank 순위 + 1 이상(건너뛴 칸은 실제 판정을 라벨로 쓴다). 성격 변형(무보정·상승)마다 최소치를 따로 낸다.
import { TIER_ORDER, tierRank } from '../core'
import type { JudgementSide, RollTier } from '../core'
import type { StatId } from '../data/schema'
import type { CellView, CompactCell, PairPoint, TargetOption, TargetView } from './types'

/** 칸의 판정 라벨 = 코어가 낸 범주(대미지 rollTier 5단, 스피드 행동 순서). 그 관점 순서 밖 범주면 undefined. */
export function cellLabel(side: JudgementSide, cell: Pick<CompactCell, 'category'>): string | undefined {
  return (TIER_ORDER[side] as readonly string[]).includes(cell.category) ? cell.category : undefined
}

type Variants<T> = { neutral?: readonly T[]; plus?: readonly T[] }

/** 두 선택지에서 목표 뷰를 만든다. better = 어느 한쪽이라도 현재 + 1 순위에 닿음, 아니면 현재 순위 유지(keep). 둘 다 없으면 undefined. */
function choose(
  side: JudgementSide,
  currentLabel: string,
  plusStat: Exclude<StatId, 'hp'>,
  pick: (which: 'neutral' | 'plus', minRank: number) => TargetOption | null,
): TargetView | undefined {
  const cur = tierRank(side, currentLabel)
  const at = (min: number) => ({ neutral: pick('neutral', min), plus: pick('plus', min) })
  let goal: TargetView['goal'] = 'better'
  let o = at(cur + 1)
  if (o.neutral === null && o.plus === null) {
    goal = 'keep'
    o = at(cur)
  }
  const labels = [o.neutral, o.plus].filter((x): x is TargetOption => x !== null).map((x) => x.label)
  if (labels.length === 0) return undefined
  const label = labels.reduce((a, b) => (tierRank(side, b) < tierRank(side, a) ? b : a))
  return { label, goal, plusStat, neutral: o.neutral, plus: o.plus }
}

/**
 * 단일 능력치 행: 성격 변형마다 목표 순위 이상을 내는 가장 낮은 SP. 목표 순위 = 현재 칸보다 한 단계 위(어느 변형도 닿지 않으면 현재 유지).
 * 각 변형 cells는 0~최대 33칸, need는 그 칸의 CellView.need 그대로다. 라벨을 낼 수 없는 칸이 있으면 목표 없음. 변형 칸이 없으면 그쪽은 null.
 */
export function singleTarget(
  side: JudgementSide,
  stat: StatId,
  plusStat: Exclude<StatId, 'hp'>,
  currentLabel: string,
  variants: Variants<CellView>,
): TargetView | undefined {
  const all = [...(variants.neutral ?? []), ...(variants.plus ?? [])]
  if (all.some((c) => cellLabel(side, c) === undefined)) return undefined
  return choose(side, currentLabel, plusStat, (which, min) => {
    const c = variants[which]?.find((x) => tierRank(side, x.category) >= min)
    return c === undefined ? null : { label: c.category, stats: [{ stat, sp: c.sp }], need: c.need }
  })
}

/**
 * 방어 2축 최소 조합. judge(hp, defense)는 두 SP에 대해 단조(어느 쪽을 올려도 판정이 나빠지지 않음)라고 가정한다.
 * 순위마다 계단 경계를 H 0 → max로 따라가며 각 H의 최소 B/D를 줄여 간다. 평가는 (hp, defense)별로 한 번만 한다.
 */
export function minPairPoints(judge: (hp: number, defense: number) => RollTier, max: number): PairPoint[] {
  const memo = new Map<number, RollTier>()
  const labelAt = (hp: number, d: number): RollTier => {
    const k = hp * (max + 1) + d
    let v = memo.get(k)
    if (v === undefined) {
      v = judge(hp, d)
      memo.set(k, v)
    }
    return v
  }
  const rankAt = (hp: number, d: number) => tierRank('defense', labelAt(hp, d))
  const top = rankAt(max, max)
  const out: PairPoint[] = []
  for (let r = 0; r <= top; r++) {
    const atLeast = TIER_ORDER.defense[r]
    if (rankAt(0, 0) >= r) {
      out.push({ atLeast, label: labelAt(0, 0), hp: 0, defense: 0 })
      continue
    }
    let best: { hp: number; defense: number } | undefined
    let d = -1
    for (let hp = 0; hp <= max; hp++) {
      if (best !== undefined && hp > best.hp + best.defense) break
      if (d < 0) {
        if (rankAt(hp, max) < r) continue
        d = max
      }
      while (d > 0 && rankAt(hp, d - 1) >= r) d--
      const sum = hp + d
      if (best === undefined || sum < best.hp + best.defense || (sum === best.hp + best.defense && hp > best.hp)) best = { hp, defense: d }
    }
    if (best === undefined) throw new Error(`판정 ${atLeast} 이상이 (${max}, ${max})에서 나왔는데 최소 조합을 찾지 못했다`)
    out.push({ atLeast, label: labelAt(best.hp, best.defense), hp: best.hp, defense: best.defense })
  }
  return out
}

/** 방어 탭 행: 성격 변형별 쌍 점에서 현재 판정 한 단계 위, 없으면 현재 판정 유지. remaining = 잔여 예산(표시용 SP 기준). */
export function pairTarget(
  points: Variants<PairPoint>,
  currentLabel: string,
  defenseStat: Exclude<StatId, 'hp'>,
  current: { hp: number; defense: number },
  remaining: number,
): TargetView | undefined {
  return choose('defense', currentLabel, defenseStat, (which, min) => {
    const p = points[which]?.find((x) => tierRank('defense', x.atLeast) === min)
    if (p === undefined) return null
    const need = Math.max(0, p.hp + p.defense - (current.hp + current.defense) - remaining)
    return {
      label: p.label,
      stats: [
        { stat: 'hp', sp: p.hp },
        { stat: defenseStat, sp: p.defense },
      ],
      need,
    }
  })
}
