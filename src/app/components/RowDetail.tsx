import { memo } from 'react'
import type { CellView, RowView, Tab } from '../../cards'
import type { Snapshot } from '../../data/schema'
import { boundaryText, categoryLabel, categorySymbol, categoryTone, currentText, fixedText, spanText, spansOf } from '../../ui/format'
import { koReason } from '../../ui/koErrors'
import { ROW_KIND_LABEL, basisText, rowRefsNote, rowTitle } from './text'

function Band({ cells, current }: { cells: readonly CellView[]; current: number }) {
  return (
    <div className="band-scroll">
      <ol className="band">
        {cells.map((c) => (
          <li
            key={c.sp}
            data-testid="band-cell"
            data-sp={c.sp}
            data-category={c.category}
            data-over-budget={c.overBudget ? 'true' : 'false'}
            aria-current={c.sp === current ? 'true' : undefined}
            className={`cell tone-${categoryTone(c.category)}${c.overBudget ? ' over' : ''}${c.sp === current ? ' current' : ''}`}
            title={`${c.sp}: ${categoryLabel(c.category)}${c.need > 0 ? ` (다른 능력치에서 ${c.need} 필요)` : ''}`}
          >
            <span className="cell-sp">{c.sp}</span>
            <span className="cell-sym" aria-hidden="true">
              {categorySymbol(c.category)}
            </span>
            {c.need > 0 && <span className="cell-need">{c.need}필요</span>}
          </li>
        ))}
      </ol>
    </div>
  )
}

interface Props {
  game: Snapshot
  tab: Tab
  row: RowView
}

export const RowDetail = memo(function RowDetail({ game, tab, row }: Props) {
  const note = rowRefsNote(game, tab, row)
  const stat = row.sweepStat
  const spans = spansOf(row.cells)
  return (
    <li className={`row row-${row.status}`} data-testid="row" data-row-kind={row.kind} data-status={row.status}>
      <div className="row-head">
        <span className="row-kind">{ROW_KIND_LABEL[row.kind]}</span>
        <strong className="row-title">{rowTitle(game, row)}</strong>
        {note && <span className="hint">({note})</span>}
        {row.basis && <span className="row-basis">{basisText(game, row.basis)}</span>}
      </div>
      {row.status === 'pending' && <p className="hint">계산 중…</p>}
      {row.status === 'error' && <p className="row-error">계산 불가: {row.error ? koReason(game, row.error) : '이유 없음'}</p>}
      {row.status === 'stale' && <p className="badge-stale">갱신 대기 — 놓으면 다시 계산합니다</p>}
      {row.noChange && row.current.category !== undefined && (
        <p className="row-fixed">
          변화 없음 — <span className={`tone-text tone-${categoryTone(row.current.category)}`}>{categorySymbol(row.current.category)}</span> {fixedText(row.current.category)}
        </p>
      )}
      {stat !== undefined && row.cells.length > 0 && !row.noChange && (
        <>
          <p className="row-judge">
            <span className={`tone-text tone-${categoryTone(row.current.category ?? '')}`} aria-hidden="true">
              {row.current.category !== undefined ? categorySymbol(row.current.category) : ''}
            </span>{' '}
            {currentText(stat, row.current.sp, row.current.category)}
            {row.nearest.up && <span className="boundary"> · {boundaryText(stat, row.nearest.up)}</span>}
            {row.nearest.down && <span className="boundary"> · {boundaryText(stat, row.nearest.down)}</span>}
          </p>
          <Band cells={row.cells} current={row.current.sp} />
          <p className="band-legend">
            {spans.map((s) => (
              <span key={s.from} className={s.overBudget ? 'span over' : 'span'}>
                <span className={`tone-text tone-${categoryTone(s.category)}`} aria-hidden="true">
                  {categorySymbol(s.category)}
                </span>{' '}
                {spanText(s)}
              </span>
            ))}
            {row.cells.some((c) => c.overBudget) && <span className="span over-key">빗금 = 예산 밖(다른 능력치에서 빼야 함)</span>}
          </p>
        </>
      )}
    </li>
  )
})
