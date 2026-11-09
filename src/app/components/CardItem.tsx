import { memo, type Dispatch } from 'react'
import type { BoundaryView, CardView, CustomTarget, RowView, Tab } from '../../cards'
import type { Snapshot } from '../../data/schema'
import { namesOf } from '../../ui/names'
import { CARD_CATEGORY_LABEL, boundaryText, bundleText, categorySymbol, categoryTone, fixedText, shareText, usageText } from '../../ui/format'
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

function Headline({ game, card }: { game: Snapshot; card: CardView }) {
  const h = card.headline
  if (h.kind === 'updating') return <span className="headline updating">갱신 중</span>
  if (h.kind === 'error') return <span className="headline error">계산 불가: {koReason(game, h.reason)}</span>
  if (h.kind === 'no-change') {
    // 안내만 있는 래더 카드는 행이 없어 고정 범주도 없다.
    if (h.fixed.length === 0) return <span className="headline fixed">변화 없음</span>
    return <span className="headline fixed">변화 없음 — {h.fixed.map(fixedText).join(', ')}</span>
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
        {card.category !== null && <span className={`cat cat-${card.category}`}>{CARD_CATEGORY_LABEL[card.category]}</span>}
        <span className="card-bundle num">
          {bundle.stats.length > 0 ? bundleText(bundle.stats) : '관련 SP 없음'}
          {ladder && bundle.share !== undefined && !bundle.minority && <> · {shareText(bundle.share)}</>}
          {ladder && bundle.minority && <> · 소수 배분</>}
          {ladder && bundle.retention !== undefined && <> · 보존 {shareText(bundle.retention, 0)}</>}
          {!ladder && bundle.presetIndex !== undefined && <> · 프리셋 {bundle.presetIndex + 1}</>}
        </span>
        {card.state === 'error' && <span className="badge-error">계산 불가</span>}
        <span className="card-headline" data-testid="card-headline">
          <Headline game={game} card={card} />
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
            {card.hiddenNoChangeRows > 0 && <p className="hint">변화 없음 {card.hiddenNoChangeRows}행(탭 요약에 있습니다)</p>}
            {target !== undefined && <CustomEditor game={game} tab={tab} card={card} target={target} dispatch={dispatch} />}
          </>
        )}
      </div>
    </li>
  )
})
