import { memo, type Dispatch } from 'react'
import type { CardView, CellView, CustomTarget, RowView, Tab } from '../../cards'
import type { Snapshot } from '../../data/schema'
import { namesOf } from '../../ui/names'
import { bundleText, fixedText, koBadge, orderBadge, shareText, targetParts, type TargetLike } from '../../ui/format'
import { koReason } from '../../ui/koErrors'
import type { AppAction } from '../state'
import { CustomEditor } from './CustomEditor'
import { RowDetail } from './RowDetail'
import { MoveLabel } from './MoveLabel'
import { itemKeyLabel, moveNoticeText } from './text'

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

/** 목표 문구. 판정·최소 SP와 "(다른 능력치에서 n 필요)"를 각각 한 덩어리로 줄바꿈한다. */
function TargetText({ target }: { target: TargetLike }) {
  const { main, need } = targetParts(target)
  return (
    <span className="headline-target" data-testid="headline-target">
      <span className="target-main">{main}</span>
      {need !== undefined && (
        <>
          {' '}
          <span className="target-need">{need}</span>
        </>
      )}
    </span>
  )
}

function Headline({ game, tab, card, badge }: { game: Snapshot; tab: Tab; card: CardView; badge: boolean }) {
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
  // 판정은 결과 배지가 보이고, 여기는 기술 라벨과 "한 단계 위(또는 유지) 최소 SP" 목표만.
  return (
    <span className="headline">
      {row.basis !== undefined && row.basis.kind !== 'rank' && (
        <span className="basis-tag" data-testid="headline-basis" data-row-kind={row.kind}>
          {itemKeyLabel(game, row.basis.item)}
        </span>
      )}{' '}
      <MoveLabel game={game} tab={tab} row={row} />{' '}
      {row.target !== undefined && (
        <TargetText target={row.target} />
      )}
    </span>
  )
}

export const CardItem = memo(function CardItem({ game, tab, card, expanded, onToggle, target, dispatch }: Props) {
  const names = namesOf(game)
  const ladder = card.opponent.source === 'ladder'
  const detailId = `card-detail-${encodeURIComponent(card.id)}`
  const { bundle } = card
  // 공격·방어는 1타 확률 결과 배지, 스피드는 행동 순서 배지. 간단행의 판정 기호는 없고 이 배지가 현재 판정을 글자로 보인다.
  const badge = tab === 'speed' ? undefined : koBadge(tab, badgeCell(card))
  const order = tab === 'speed' ? orderBadge(badgeCell(card)) : undefined
  return (
    <li
      className={`card card-${card.state}${expanded ? ' open' : ''}`}
      data-testid="card"
      data-card-id={card.id}
      data-opponent={card.opponent.id}
      data-category={card.category ?? 'none'}
      data-origin={ladder ? 'ladder' : 'custom'}
      data-rank={ladder ? card.opponent.rank : undefined}
      data-state={card.state}
    >
      <button type="button" className="card-line" aria-expanded={expanded} aria-controls={detailId} onClick={() => onToggle(card.id)}>
        {!ladder && (
          <span className="card-meta">
            <span className="custom-tag">출처: 사용자 지정</span>
          </span>
        )}
        <span className="card-name">{names.species.label(card.opponent.id)}</span>
        {badge !== undefined && (
          <span className={`ko-badge ko-${badge.tone}`} data-testid="ko-badge" data-tone={badge.tone}>
            {badge.label}
          </span>
        )}
        {/* 배분 묶음 라벨 "A32↑ 56.3%": 비중(래더)·소수 배분·프리셋(커스텀)은 작은 회색 글씨 */}
        <span className="card-bundle num" data-testid="card-bundle">
          <span className="bundle-stats">{bundle.stats.length > 0 ? bundleText(bundle.stats) : '관련 SP 없음'}</span>
          {ladder && bundle.share !== undefined && !bundle.minority && <> <span className="bundle-share">{shareText(bundle.share)}</span></>}
          {ladder && bundle.minority && <> <span className="bundle-share">소수 배분</span></>}
          {!ladder && bundle.presetIndex !== undefined && <> <span className="bundle-share">프리셋 {bundle.presetIndex + 1}</span></>}
        </span>
        {order !== undefined && (
          <span className={`ko-badge ko-${order.tone}`} data-testid="order-badge" data-tone={order.tone}>
            {order.label}
          </span>
        )}
        {card.state === 'error' && <span className="badge-error">계산 불가</span>}
        <span className="card-headline" data-testid="card-headline">
          <Headline game={game} tab={tab} card={card} badge={badge !== undefined || order !== undefined} />
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
