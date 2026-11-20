// 컷 고정 중 성격 규칙: 갈래 성격·행 성격·엄격 변형·레인 성격. 판정은 하지 않고 스냅샷 성격 표에서 id만 찾는다.
import type { NatureEntry, Snapshot, StatId } from '../data/schema'

type BoostableStat = Exclude<StatId, 'hp'>
/** 성격 상승이 가는 곳: 고정 능력치 하나 또는 고정 밖 */
export type BranchPlus = BoostableStat | 'out'

/** natures.ts의 하락 후보 순서와 같아야 한다 */
const MINUS_ORDER: readonly BoostableStat[] = ['spa', 'atk', 'def', 'spd', 'spe']

const isNeutral = (n: NatureEntry): boolean => n.plus === undefined || n.plus === n.minus
const entryOf = (game: Snapshot, id: string): NatureEntry | undefined =>
  Object.prototype.hasOwnProperty.call(game.data.natures, id) ? game.data.natures[id] : undefined
const sortedIds = (game: Snapshot): string[] => Object.keys(game.data.natures).sort()

function neutralOf(game: Snapshot, current: string): string {
  const cur = entryOf(game, current)
  if (cur !== undefined && isNeutral(cur)) return current
  return sortedIds(game).find((id) => isNeutral(game.data.natures[id])) ?? current
}

function findNature(game: Snapshot, plus: BoostableStat, minus: BoostableStat): string | null {
  return sortedIds(game).find((id) => game.data.natures[id].plus === plus && game.data.natures[id].minus === minus) ?? null
}

/** 상승 plus 성격의 하락: keep(있고 피할 곳 밖이면) 그대로, 아니면 MINUS_ORDER의 첫 빈 자리. 없으면 null */
function minusSlot(plus: BoostableStat, keep: BoostableStat | undefined, avoid: readonly StatId[]): BoostableStat | null {
  const free = (s: BoostableStat) => s !== plus && !avoid.includes(s)
  if (keep !== undefined && free(keep)) return keep
  return MINUS_ORDER.find(free) ?? null
}

/**
 * 갈래 성격. current = 내 세트 성격, avoid = 하락을 둘 수 없는 능력치(고정 능력치 전부).
 * plus = 능력치면 그 상승(내 세트 하락 유지 우선), 'out'이면 내 세트 상승이 avoid 밖일 때 유지·아니면 무보정.
 * null = 하락 자리 없음(하락 없는 무보정 성격은 검사하지 않는다).
 */
export function branchNature(game: Snapshot, current: string, plus: BranchPlus, avoid: readonly StatId[]): string | null {
  const cur = entryOf(game, current)
  const curPlus = cur !== undefined && !isNeutral(cur) ? cur.plus : undefined
  const curMinus = curPlus !== undefined ? cur?.minus : undefined
  if (plus === 'out') {
    if (curPlus === undefined || avoid.includes(curPlus)) return neutralOf(game, current)
    const minus = minusSlot(curPlus, curMinus, avoid)
    return minus === null ? null : findNature(game, curPlus, minus)
  }
  const minus = minusSlot(plus, curMinus, avoid)
  if (minus === null) return null
  if (curPlus === plus && curMinus === minus) return current
  return findNature(game, plus, minus)
}

/**
 * 행 성격: 갈래 성격의 상승은 그대로 두고 하락만 avoid(고정 + 행 관여 능력치) 밖으로 옮긴다.
 * 자리가 없으면 갈래 성격 그대로 + dropWarning.
 */
export function rowNature(game: Snapshot, branchNatureId: string, plus: BranchPlus, avoid: readonly StatId[]): { nature: string; dropWarning: boolean } {
  const cur = entryOf(game, branchNatureId)
  if (cur === undefined || isNeutral(cur) || cur.plus === undefined) return { nature: branchNatureId, dropWarning: false }
  const up: BoostableStat = plus === 'out' ? cur.plus : plus
  const minus = minusSlot(up, up === cur.plus ? cur.minus : undefined, avoid)
  if (minus === null) return { nature: branchNatureId, dropWarning: true }
  if (up === cur.plus && minus === cur.minus) return { nature: branchNatureId, dropWarning: false }
  const found = findNature(game, up, minus)
  return found === null ? { nature: branchNatureId, dropWarning: true } : { nature: found, dropWarning: false }
}

/**
 * 보는 능력치 v의 엄격 변형. neutral = 행 성격에서 v 보정만 없앤 성격(다른 상승은 유지).
 * plus = allowPlus일 때만 +v, 하락은 행 성격 하락(그 하락이 v면 null). 행 성격에 하락이 없으면 avoid 밖 첫 빈 자리(없으면 null).
 */
export function strictVariants(
  game: Snapshot,
  rowNatureId: string,
  v: BoostableStat,
  allowPlus: boolean,
  avoid: readonly StatId[],
): { stat: BoostableStat; neutral: string; plus: string | null } {
  const cur = entryOf(game, rowNatureId)
  const curPlus = cur !== undefined && !isNeutral(cur) ? cur.plus : undefined
  const curMinus = curPlus !== undefined ? cur?.minus : undefined
  let neutral: string
  if (curPlus === undefined || (curPlus !== v && curMinus !== v)) neutral = rowNatureId
  else if (curPlus === v) neutral = neutralOf(game, rowNatureId)
  else {
    const minus = minusSlot(curPlus, undefined, [v])
    neutral = (minus === null ? null : findNature(game, curPlus, minus)) ?? neutralOf(game, rowNatureId)
  }
  let plus: string | null = null
  if (allowPlus) {
    if (curPlus === v) plus = rowNatureId
    else if (curMinus === v) plus = null
    else if (curMinus !== undefined) plus = findNature(game, v, curMinus)
    else {
      const minus = minusSlot(v, undefined, avoid)
      plus = minus === null ? null : findNature(game, v, minus)
    }
  }
  return { stat: v, neutral, plus }
}

/**
 * 레인 성격: 내 세트 성격·고정 능력치·행 관여 능력치만의 함수. +lockStat이고 하락은 관여 밖이라
 * strictVariants(lockStat, allowPlus = true)가 무보정·상승을 모두 낸다.
 */
export function laneNature(game: Snapshot, current: string, lockStat: BoostableStat, relevant: readonly StatId[]): string {
  const avoid: readonly StatId[] = [lockStat, ...relevant]
  const found = branchNature(game, current, lockStat, avoid)
  if (found !== null) return found
  const minus = MINUS_ORDER.find((s) => s !== lockStat)
  return (minus === undefined ? null : findNature(game, lockStat, minus)) ?? current
}
