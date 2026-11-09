// 랭크 행 후보: 수단 출처(래더 분포·내 세트·사용자 지정 타겟)와 카드 참조 능력치 적용 규칙.
import type { ResolvedSet } from '../core'
import type { MetaEntry } from '../data/meta-schema'
import type { Snapshot } from '../data/schema'
import { BOOST_STATS, applyMeans, findMeans, setMeans, type BoostStat, type MeansRef } from './rankMeans'
import type { RankBasis } from './types'

export interface MeansCandidate {
  means: MeansRef
  owner: 'me' | 'opponent'
  /** 래더 상대 수단만 */
  share?: number
}

const byString = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)
const byMeans = (a: MeansRef, b: MeansRef): number =>
  byString(a.id, b.id) || byString(a.kind, b.kind)

/** 래더 상대: 특성·기술 분포에서 점유율이 기준 이상이고 수단 목록에 있는 것(id 순). */
export function ladderMeans(entry: MetaEntry, rankShareMin: number): MeansCandidate[] {
  const out: MeansCandidate[] = []
  const pick = (kind: MeansRef['kind'], shares: Record<string, number>) => {
    for (const [id, share] of Object.entries(shares)) {
      if (share >= rankShareMin && findMeans({ kind, id })) out.push({ means: { kind, id }, owner: 'opponent', share })
    }
  }
  pick('ability', entry.abilities)
  pick('move', entry.moves.shares)
  return out.sort((a, b) => byMeans(a.means, b.means))
}

/** 세트의 기술·계산 특성에 있는 수단(점유율 없음, id 순). 내 세트와 목록 밖 타겟이 쓴다. */
export function setMeansCandidates(r: ResolvedSet, owner: 'me' | 'opponent'): MeansCandidate[] {
  return setMeans(r)
    .map((means) => ({ means, owner }))
    .sort((a, b) => byMeans(a.means, b.means))
}

export interface CardRefStats {
  my: readonly BoostStat[]
  opponent: readonly BoostStat[]
}

export interface RankVariant {
  basis: RankBasis
  whiteHerbConsumed: boolean
}

/**
 * 후보마다 수단을 1회 적용해, 바뀐 능력치가 카드 참조 능력치에 하나라도 들면 랭크 변형을 낸다.
 * 순서는 상대 수단 → 내 수단, 그 안은 후보 순서 그대로.
 */
export function rankVariants(
  game: Snapshot,
  candidates: readonly MeansCandidate[],
  me: ResolvedSet,
  opponent: ResolvedSet,
  refs: CardRefStats,
): RankVariant[] {
  const ordered = [...candidates.filter((c) => c.owner === 'opponent'), ...candidates.filter((c) => c.owner === 'me')]
  const out: RankVariant[] = []
  for (const c of ordered) {
    const mine = c.owner === 'me'
    const eff = applyMeans(game, c.means, mine ? me : opponent, mine ? opponent : me)
    if (!eff) continue
    const myBoosts = mine ? eff.userBoosts : eff.targetBoosts
    const opponentBoosts = mine ? eff.targetBoosts : eff.userBoosts
    const hit =
      BOOST_STATS.some((s) => myBoosts[s] !== undefined && refs.my.includes(s)) ||
      BOOST_STATS.some((s) => opponentBoosts[s] !== undefined && refs.opponent.includes(s))
    if (!hit) continue
    const basis: RankBasis = {
      kind: 'rank',
      means: { ...c.means },
      owner: c.owner,
      myBoosts,
      opponentBoosts,
      reactions: eff.reactions,
    }
    if (c.share !== undefined) basis.share = c.share
    out.push({ basis, whiteHerbConsumed: eff.whiteHerbConsumed })
  }
  return out
}
