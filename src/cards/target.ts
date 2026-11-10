// "최소 <능력치><SP> 필요" 목표. 판정과 순위는 코어(koLabel·judgementRank)만 쓴다.
// 한 단계 위 = judgementRank 순위 + 1 이상(건너뛴 칸은 실제 판정을 라벨로 쓴다). 코어 nextBetter는 이 규칙에 쓰지 않는다.
import { JUDGEMENT_ORDER, judgementRank, koLabel } from '../core'
import type { JudgementSide, KoLabel } from '../core'
import type { StatId } from '../data/schema'
import type { CellView, CompactCell, PairPoint, TargetView } from './types'

/**
 * 칸의 판정 라벨. 대미지 칸은 koLabel 4단, 스피드 칸은 행동 순서 범주 그대로.
 * 코어가 낸 칸이 아니면(1타 확률 없음·행동 순서 밖 범주) undefined.
 */
export function cellLabel(side: JudgementSide, cell: CompactCell): string | undefined {
  if (side === 'speed') return (JUDGEMENT_ORDER.speed as readonly string[]).includes(cell.category) ? cell.category : undefined
  return cell.ohkoChance === undefined ? undefined : koLabel(side, cell.ohkoChance)
}

/**
 * 단일 능력치 행: 현재 칸보다 한 단계 이상 위 판정을 내는 가장 낮은 SP, 없으면 현재 판정 이상을 내는 가장 낮은 SP.
 * cells는 0~최대 33칸, need는 그 칸의 CellView.need 그대로다. 라벨을 낼 수 없는 칸이 있으면 목표 없음.
 */
export function singleTarget(side: JudgementSide, stat: StatId, cells: readonly CellView[], currentSp: number): TargetView | undefined {
  const labels = cells.map((c) => cellLabel(side, c))
  const ci = cells.findIndex((c) => c.sp === currentSp)
  if (ci < 0 || labels.some((l) => l === undefined)) return undefined
  const ranks = labels.map((l) => judgementRank(side, l as string))
  const pick = (min: number) => ranks.findIndex((r) => r >= min)
  const better = pick(ranks[ci] + 1)
  const i = better >= 0 ? better : pick(ranks[ci])
  return { label: labels[i] as string, goal: better >= 0 ? 'better' : 'keep', stats: [{ stat, sp: cells[i].sp }], need: cells[i].need }
}

/**
 * 방어 2축 최소 조합. judge(hp, defense)는 두 SP에 대해 단조(어느 쪽을 올려도 판정이 나빠지지 않음)라고 가정한다.
 * 순위마다 계단 경계를 H 0 → max로 따라가며 각 H의 최소 B/D를 줄여 간다. 평가는 (hp, defense)별로 한 번만 한다.
 */
export function minPairPoints(judge: (hp: number, defense: number) => KoLabel, max: number): PairPoint[] {
  const memo = new Map<number, KoLabel>()
  const labelAt = (hp: number, d: number): KoLabel => {
    const k = hp * (max + 1) + d
    let v = memo.get(k)
    if (v === undefined) {
      v = judge(hp, d)
      memo.set(k, v)
    }
    return v
  }
  const rankAt = (hp: number, d: number) => judgementRank('defense', labelAt(hp, d))
  const top = rankAt(max, max)
  const out: PairPoint[] = []
  for (let r = 0; r <= top; r++) {
    const atLeast = JUDGEMENT_ORDER.defense[r]
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

/** 방어 탭 행: 그 행 현재 판정에서 한 단계 위 점, 없으면 현재 판정 유지 점. remaining = 잔여 예산(표시용 SP 기준). */
export function pairTarget(
  points: readonly PairPoint[],
  currentLabel: string,
  defenseStat: StatId,
  current: { hp: number; defense: number },
  remaining: number,
): TargetView | undefined {
  const r = judgementRank('defense', currentLabel)
  const at = (rank: number) => points.find((p) => judgementRank('defense', p.atLeast) === rank)
  const better = at(r + 1)
  const p = better ?? at(r)
  if (p === undefined) return undefined
  const need = Math.max(0, p.hp + p.defense - (current.hp + current.defense) - remaining)
  return {
    label: p.label,
    goal: better !== undefined ? 'better' : 'keep',
    stats: [
      { stat: 'hp', sp: p.hp },
      { stat: defenseStat, sp: p.defense },
    ],
    need,
  }
}
