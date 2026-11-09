// 탭 뷰의 id 값 → 화면 문구(이름 색인 사용). 판정은 하지 않는다.
import type { BoostTable } from '../../core'
import type { MetaSourceView, RankBasis, RowView, ScarfBasis, Tab } from '../../cards'
import type { MatchType } from '../../data/meta-schema'
import type { Snapshot } from '../../data/schema'
import { NO_ITEM } from '../../data/meta-schema'
import { namesOf } from '../../ui/names'
import { STAT_SHORT, refsNote, shareText } from '../../ui/format'

export const TAB_LABEL: Record<Tab, string> = { attack: '공격', defense: '방어', speed: '스피드' }

export const ROW_KIND_LABEL: Record<RowView['kind'], string> = { base: '기본', rank: '랭크', scarf: '스카프', 'non-scarf': '스카프 아님' }

export function meansLabel(game: Snapshot, means: { kind: 'ability' | 'move'; id: string }): string {
  const names = namesOf(game)
  return means.kind === 'ability' ? names.abilities.label(means.id) : names.moves.label(means.id)
}

/** 반응 id는 특성 또는 도구 */
export function reactionLabel(game: Snapshot, id: string): string {
  const d = game.data
  const names = namesOf(game)
  if (Object.prototype.hasOwnProperty.call(d.abilities, id)) return names.abilities.label(id)
  return names.items.label(id)
}

export function itemKeyLabel(game: Snapshot, item: string): string {
  return item === NO_ITEM ? '도구 없음' : namesOf(game).items.label(item)
}

const boostsText = (who: string, b: BoostTable): string =>
  Object.entries(b)
    .filter(([, v]) => v !== undefined && v !== 0)
    .map(([s, v]) => `${who} ${STAT_SHORT[s as keyof typeof STAT_SHORT]}${(v as number) > 0 ? '+' : '−'}${Math.abs(v as number)}`)
    .join(' ')

/** 랭크·스카프 행 근거: "상대 위협 31.2% · 내 A−1 · 반응: 오기" */
export function basisText(game: Snapshot, basis: RankBasis | ScarfBasis): string {
  if (basis.kind !== 'rank') return `${itemKeyLabel(game, basis.item)} ${shareText(basis.share)}`
  const owner = basis.owner === 'me' ? '내' : '상대'
  const share = basis.share !== undefined ? ` ${shareText(basis.share)}` : basis.owner === 'opponent' ? ' (사용자 지정)' : ''
  const parts = [`${owner} ${meansLabel(game, basis.means)}${share}`]
  const boosts = [boostsText('내', basis.myBoosts), boostsText('상대', basis.opponentBoosts)].filter((t) => t !== '').join(' ')
  if (boosts !== '') parts.push(boosts)
  if (basis.reactions.length > 0) parts.push(`반응: ${basis.reactions.map((r) => reactionLabel(game, r)).join('·')}`)
  return parts.join(' · ')
}

/** 행 제목: "지진", "H · 인파이트", "스피드 비교" */
export function rowTitle(game: Snapshot, row: Pick<RowView, 'moveId' | 'sweepStat'>, withStat = true): string {
  const names = namesOf(game)
  const move = row.moveId === undefined ? '스피드 비교' : names.moves.label(row.moveId)
  return row.sweepStat === undefined || !withStat ? move : `${STAT_SHORT[row.sweepStat]} · ${move}`
}

/** 그 기술의 분류와 참조 능력치가 다를 때의 메모. 기술을 쓰는 쪽은 탭으로 정해진다(방어 탭은 상대). */
export function rowRefsNote(game: Snapshot, tab: Tab, row: Pick<RowView, 'moveId' | 'refs'>): string | undefined {
  if (row.moveId === undefined || row.refs === undefined) return undefined
  if (!Object.prototype.hasOwnProperty.call(game.data.moves, row.moveId)) return undefined
  return refsNote(game.data.moves[row.moveId].category, row.refs, tab === 'defense' ? 'opponent' : 'me')
}

export const categoryVariesText = (game: Snapshot, moveId: string): string =>
  `${namesOf(game).moves.label(moveId)}: 분류가 능력치에 따라 바뀌어 계산하지 않습니다`

export const MATCH_LABEL: Record<MatchType, string> = { bo1: 'Bo1', bo3: 'Bo3' }

export function sourceText(s: MetaSourceView): string {
  return `${MATCH_LABEL[s.match]} · ${s.month} · 컷 ${s.cutoff} · ${s.format}`
}
