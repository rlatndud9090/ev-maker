// 내 성격 변형(무보정·상승) 고르기. 판정은 하지 않고 스냅샷 성격 표에서 실제 성격 id만 찾는다.
import type { PokemonSet } from '../core'
import type { NatureEntry, Snapshot, StatId } from '../data/schema'
import type { NatureVariant, NatureVariants } from './types'

type BoostableStat = Exclude<StatId, 'hp'>
/** 상승 성격 하락 후보 순서: 특공·공격(흔한 고집·조심·겁쟁이·명랑 계열)을 먼저 */
const MINUS_ORDER: readonly BoostableStat[] = ['spa', 'atk', 'def', 'spd', 'spe']

const sortedIds = (game: Snapshot): string[] => Object.keys(game.data.natures).sort()
const isNeutral = (n: NatureEntry): boolean => n.plus === undefined || n.plus === n.minus

/**
 * stat의 무보정·상승 성격. relevant = 이 판정이 의존하는 내 능력치(relevance.ts 기준).
 * 현재 성격이 이미 그 조건(무보정: stat 보정 없음, 상승: stat 상승)이면 현재 id를 쓴다.
 * 상승 성격의 하락은 현재 하락 능력치가 관여하지 않으면 그대로, 아니면 관여하지 않는 첫 능력치(MINUS_ORDER 순).
 */
export function natureVariants(game: Snapshot, current: string, stat: BoostableStat, relevant: readonly StatId[]): NatureVariants {
  const natures = game.data.natures
  const cur: NatureEntry | undefined = Object.prototype.hasOwnProperty.call(natures, current) ? natures[current] : undefined
  const ids = sortedIds(game)
  const curNeutralOnStat = cur !== undefined && (isNeutral(cur) || (cur.plus !== stat && cur.minus !== stat))
  const neutral = curNeutralOnStat ? current : (ids.find((id) => isNeutral(natures[id])) ?? current)

  let plus: string
  if (cur !== undefined && !isNeutral(cur) && cur.plus === stat) {
    plus = current
  } else {
    const free = (s: BoostableStat) => s !== stat && !relevant.includes(s)
    const minus = cur?.minus !== undefined && free(cur.minus) ? cur.minus : (MINUS_ORDER.find(free) ?? MINUS_ORDER.find((s) => s !== stat))
    plus =
      ids.find((id) => natures[id].plus === stat && natures[id].minus === minus) ??
      ids.find((id) => natures[id].plus === stat && natures[id].minus !== stat) ??
      neutral
  }
  return { stat, neutral, plus }
}

/** 변형이 쓰는 성격 id */
export const variantNature = (v: NatureVariants, which: NatureVariant): string => (which === 'neutral' ? v.neutral : v.plus)

export const withNature = (set: PokemonSet, nature: string): PokemonSet => (set.nature === nature ? set : { ...set, nature })
