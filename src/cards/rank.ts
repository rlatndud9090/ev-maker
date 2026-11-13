// 랭크 행 후보: 수단 출처(래더 분포·내 세트·사용자 지정 타겟)와 카드 참조 능력치 적용 규칙.
import type { ResolvedSet } from '../core'
import type { MetaEntry } from '../data/meta-schema'
import type { Snapshot } from '../data/schema'
import { BOOST_STATS, applyMeans, isActiveMeans, setMeans, usableAfterMeans, type BoostStat, type MeansRef } from './rankMeans'
import type { RankBasis, Tab } from './types'

export interface MeansCandidate {
  means: MeansRef
  owner: 'me' | 'opponent'
  /** 래더 상대 수단만 */
  share?: number
}

const byString = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)
const byMeans = (a: MeansRef, b: MeansRef): number =>
  byString(a.id, b.id) || byString(a.kind, b.kind)

/**
 * 탭별로 랭크 조건을 만드는 수단 주인(능동 수단만 있으므로 주인 = 랭크가 오르는 쪽).
 * 공격 탭 = 내 랭크업만(상대 철벽 등 방어 랭크업은 보지 않는다), 방어 탭 = 공격하는 상대의 랭크업만(내 방어 랭크업은 다루지 않는다), 스피드 탭 = 양쪽.
 */
export const TAB_MEANS_OWNERS: Readonly<Record<Tab, readonly MeansCandidate['owner'][]>> = {
  attack: ['me'],
  defense: ['opponent'],
  speed: ['opponent', 'me'],
}

/** 래더 상대: 특성·기술 분포에서 점유율이 기준 이상인 능동 수단(id 순). */
export function ladderMeans(entry: MetaEntry, rankShareMin: number): MeansCandidate[] {
  const out: MeansCandidate[] = []
  const pick = (kind: MeansRef['kind'], shares: Record<string, number>) => {
    for (const [id, share] of Object.entries(shares)) {
      if (share >= rankShareMin && isActiveMeans({ kind, id })) out.push({ means: { kind, id }, owner: 'opponent', share })
    }
  }
  pick('ability', entry.abilities)
  pick('move', entry.moves.shares)
  return out.sort((a, b) => byMeans(a.means, b.means))
}

/** 세트의 기술·계산 특성에 있는 능동 수단(점유율 없음, id 순). 내 세트와 목록 밖 타겟이 쓴다. */
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

/** 동시채용 하한 max(0, a + b − 1). 점유율이 소수 넷째 자리라 같은 자리로 반올림해 경계 비교가 부동소수 오차에 흔들리지 않게 한다. */
export function coAdoptionFloor(a: number, b: number): number {
  return Math.max(0, Math.round((a + b - 1) * 1e4) / 1e4)
}

/**
 * 랭크 조건 basis에서 수단을 쓴 쪽(attackerOwner)이 기술 moveId로 공격하는 경우가 판정 후보가 되는가.
 * - 수단 주인과 공격하는 쪽이 같고 기술 수단이면 첫 턴 전용 기술은 불가(usableAfterMeans).
 * - 래더 상대 수단(점유율 a)이면 그 기술 점유율 b와의 동시채용 하한이 rankShareMin 이상이어야 한다.
 *   메타 대표 세트에 수단과 기술이 함께 있으면(특성 수단은 통계 근거가 있는 대표 특성) 하한과 무관하게 후보다.
 * 내 세트 수단·목록 밖 타겟 수단(점유율 없음)과 수단 주인이 공격하지 않는 경우는 하한을 보지 않는다.
 */
export function rankMoveAllowed(
  basis: Pick<RankBasis, 'means' | 'owner' | 'share'>,
  attackerOwner: MeansCandidate['owner'],
  moveId: string,
  entry: MetaEntry | undefined,
  rankShareMin: number,
): boolean {
  if (basis.owner !== attackerOwner) return true
  if (!usableAfterMeans(basis.means, moveId)) return false
  if (basis.owner !== 'opponent' || basis.share === undefined || entry === undefined) return true
  const rep = entry.representative.set
  // 대표 특성이 통계 근거 없는 첫 슬롯 대체값(base-first-slot)이면 동시채용 근거가 아니다.
  const repHasMeans =
    basis.means.kind === 'move'
      ? rep.moves.includes(basis.means.id)
      : rep.ability === basis.means.id && entry.representative.abilityBasis !== 'base-first-slot'
  if (repHasMeans && rep.moves.includes(moveId)) return true
  return coAdoptionFloor(basis.share, entry.moves.shares[moveId] ?? 0) >= rankShareMin
}
