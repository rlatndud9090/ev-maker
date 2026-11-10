import { memo, type Dispatch } from 'react'
import type { BoundaryView, CardView, CellView, CustomTarget, RowView, Tab } from '../../cards'
import type { Snapshot } from '../../data/schema'
import { namesOf } from '../../ui/names'
import { boundaryText, bundleText, categorySymbol, categoryTone, fixedText, koBadge, shareText, usageText } from '../../ui/format'
import { koReason } from '../../ui/koErrors'
import type { AppAction } from '../state'
import { CustomEditor } from './CustomEditor'
import { RowDetail } from './RowDetail'
import { moveNoticeText, rowTitle } from './text'

interface Props {
  game: Snapshot
  tab: Tab
  card: CardView
  expanded: boolean
  onToggle: (cardId: string) => void
  /** 커스텀 카드면 그 타겟 */
  target?: CustomTarget
  dispatch: Dispatch<AppAction>
}

/** 대표 행의 경계 중 현재 SP에서 가까운 쪽(같으면 위쪽). */
function closest(row: RowView): BoundaryView | undefined {
  const { up, down } = row.nearest
  if (up === undefined) return down
  if (down === undefined) return up
  return Math.abs(down.delta) < Math.abs(up.delta) ? down : up
}

const currentCell = (row: RowView): CellView | undefined => row.cells.find((c) => c.sp === row.current.sp)

/** 카드 줄 배지의 기준 칸: 대표 행의 현재 칸. 전 행 변화 없음 커스텀 카드는 칸이 있는 첫 행. */
function badgeCell(card: CardView): CellView | undefined {
  const h = card.headline
  if (h.kind === 'row') {
    const row = card.rows.find((r) => r.id === h.rowId)
    return row === undefined ? undefined : currentCell(row)
  }
  if (h.kind !== 'no-change') return undefined
  for (const row of card.rows) {
    const cell = currentCell(row)
    if (cell !== undefined) return cell
  }
  return undefined
}

function Headline({ game, card, badge }: { game: Snapshot; card: CardView; badge: boolean }) {
  const h = card.headline
  if (h.kind === 'updating') return <span className="headline updating">갱신 중</span>
  if (h.kind === 'error') return <span className="headline error">계산 불가: {koReason(game, h.reason)}</span>
  if (h.kind === 'no-change') {
    // 배지가 고정 판정을 대신한다. 칸 없는 고정 판정 행(극단 필터·내 SP 무관)만 문구로 보인다.
    if (badge || h.fixed.length === 0) return null
    return <span className="headline fixed">{h.fixed.map(fixedText).join(', ')}</span>
  }
  const row = card.rows.find((r) => r.id === h.rowId)
  if (row === undefined || row.sweepStat === undefined) return null
  const b = closest(row)
  return (
    <span className="headline">
      <span className={`tone-text tone-${categoryTone(row.current.category ?? '')}`} aria-hidden="true">
        {row.current.category !== undefined ? categorySymbol(row.current.category) : ''}
      </span>{' '}
      {rowTitle(game, row, false)} {b && boundaryText(row.sweepStat, b)}
    </span>
  )
}

export const CardItem = memo(function CardItem({ game, tab, card, expanded, onToggle, target, dispatch }: Props) {
  const names = namesOf(game)
  const ladder = card.opponent.source === 'ladder'
  const detailId = `card-detail-${encodeURIComponent(card.id)}`
  const { bundle } = card
  const badge = tab === 'speed' ? undefined : koBadge(tab, badgeCell(card))
  return (
    <li
      className={`card card-${card.state}${expanded ? ' open' : ''}`}
      data-testid="card"
      data-card-id={card.id}
      data-opponent={card.opponent.id}
      data-category={card.category ?? 'none'}
      data-origin={ladder ? 'ladder' : 'custom'}
      data-state={card.state}
    >
      <button type="button" className="card-line" aria-expanded={expanded} aria-controls={detailId} onClick={() => onToggle(card.id)}>
        <span className="card-meta num">
          {ladder ? (
            <>
              <span className="rank">#{card.opponent.rank}</span> <span className="usage">{card.opponent.usage !== undefined ? usageText(card.opponent.usage) : ''}</span>
            </>
          ) : (
            <span className="custom-tag">출처: 사용자 지정</span>
          )}
        </span>
        <span className="card-name">{names.species.label(card.opponent.id)}</span>
        {badge !== undefined && (
          <span className={`ko-badge ko-${badge.tone}`} data-testid="ko-badge" data-tone={badge.tone}>
            {badge.label}
          </span>
        )}
        <span className="card-bundle num">
          {bundle.stats.length > 0 ? bundleText(bundle.stats) : '관련 SP 없음'}
          {ladder && bundle.share !== undefined && !bundle.minority && <> · {shareText(bundle.share)}</>}
          {ladder && bundle.minority && <> · 소수 배분</>}
          {ladder && bundle.retention !== undefined && <> · 보존 {shareText(bundle.retention, 0)}</>}
          {!ladder && bundle.presetIndex !== undefined && <> · 프리셋 {bundle.presetIndex + 1}</>}
        </span>
        {card.state === 'error' && <span className="badge-error">계산 불가</span>}
        <span className="card-headline" data-testid="card-headline">
          <Headline game={game} card={card} badge={badge !== undefined} />
        </span>
        {card.moreRows > 0 && (
          <span className="card-more" data-testid="card-more">
            외 {card.moreRows}행
          </span>
        )}
      </button>
      {card.notices.map((n) => (
        <p key={JSON.stringify([n.kind, n.owner, n.moveId])} className="card-notice" data-testid="card-notice">
          {moveNoticeText(game, n)}
        </p>
      ))}
      <div id={detailId} className="card-detail" hidden={!expanded}>
        {expanded && (
          <>
            {card.state === 'error' && card.error && <p className="row-error">계산 불가: {koReason(game, card.error)}</p>}
            {card.rows.length > 0 && (
              <ol className="rows">
                {card.rows.map((r) => (
                  <RowDetail key={r.id} game={game} tab={tab} row={r} />
                ))}
              </ol>
            )}
            {target !== undefined && <CustomEditor game={game} tab={tab} card={card} target={target} dispatch={dispatch} />}
          </>
        )}
      </div>
    </li>
  )
})
