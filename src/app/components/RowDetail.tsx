import { memo, type CSSProperties } from 'react'
import { cellLabel, type CellView, type RowView, type Tab } from '../../cards'
import type { Snapshot } from '../../data/schema'
import { categoryLabel, categorySymbol, categoryTone, currentText, fixedText, spanNeedText, spanText, spansOf, targetSegments, type TargetLike, type TargetSegment } from '../../ui/format'
import { koReason } from '../../ui/koErrors'
import { VariableTag } from './MoveLabel'
import { ROW_KIND_LABEL, basisText, rowRefsNote, rowTitle } from './text'

/** 행 조건(기본·랭크 수단·도구) 식별 문자열 */
const conditionOf = (row: RowView): string =>
  row.basis === undefined ? 'base' : row.basis.kind === 'rank' ? JSON.stringify([row.basis.owner, row.basis.means.kind, row.basis.means.id]) : JSON.stringify([row.basis.kind, row.basis.item])

/** 판정 색 칩(결과 배지와 같은 5색) + 그 탭 관점의 좋고 나쁨 기호 */
function TierChip({ tab, category }: { tab: Tab; category: string }) {
  return (
    <span className={`tier-chip ko-${categoryTone(category)}`} aria-hidden="true">
      {categorySymbol(tab, category)}
    </span>
  )
}

/** 띠 눈금(칸 아래 작은 숫자): 0·가운데·끝 SP */
const tickSps = (cells: readonly CellView[]): number[] => {
  if (cells.length === 0) return []
  const last = cells.length - 1
  return [...new Set([0, Math.floor(last / 2), last])].map((i) => cells[i].sp)
}

/**
 * 0~최대 SP 구간 띠: 칸 안에는 글자 없이 판정 색(결과 배지와 같은 5색)만, 칸 사이 틈은 둔다. 칸은 오른쪽 열 폭에 맞춰
 * 줄어들어(1fr) 가로 스크롤이 없다. 현재 칸은 진한 외곽선, 예산 밖은 빗금. 판정 문구는 칸 title("SP n: 판정")·위 판정 줄·아래 범례에 있다
 * (색만으로 정보를 전하지 않는다). 칸은 포커스 대상이 아니다.
 */
function Band({ cells, current }: { cells: readonly CellView[]; current: number }) {
  const ticks = tickSps(cells)
  return (
    <div className="band-wrap" style={{ '--band-cells': cells.length } as CSSProperties}>
      <ol className="band">
        {cells.map((c) => (
          <li
            key={c.sp}
            data-testid="band-cell"
            data-sp={c.sp}
            data-category={c.category}
            data-over-budget={c.overBudget ? 'true' : 'false'}
            aria-current={c.sp === current ? 'true' : undefined}
            className={`cell ko-${categoryTone(c.category)}${c.overBudget ? ' over' : ''}${c.sp === current ? ' current' : ''}`}
            title={`SP ${c.sp}: ${categoryLabel(c.category)}${c.need > 0 ? ` (다른 능력치에서 ${c.need} 필요)` : ''}`}
          />
        ))}
      </ol>
      <div className="band-ticks" aria-hidden="true">
        {ticks.map((sp, i) => (
          <span key={sp} className="band-tick num" style={{ gridColumn: cells.findIndex((c) => c.sp === sp) + 1 }} data-edge={i === 0 ? 'start' : i === ticks.length - 1 ? 'end' : undefined}>
            {sp}
          </span>
        ))}
      </div>
    </div>
  )
}

/** 목표 문구: SP 조합("H0 B0+")은 한 덩어리로만 줄바꿈한다 */
function TargetText({ target }: { target: TargetLike }) {
  const seg = targetSegments(target)
  const opt = (o: TargetSegment) => (
    <>
      {o.lead}
      {o.sps !== undefined && <span className="sp-combo">{o.sps}</span>}
      {o.note}
    </>
  )
  return (
    <>
      {seg.judgement}: {opt(seg.neutral)} / {opt(seg.plus)}
    </>
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
  // 현재 판정은 목표 문구와 같은 판정 라벨(코어 5단 판정·행동 순서)로 쓴다.
  const cur = row.cells.find((c) => c.sp === row.current.sp)
  const currentLabel = cur === undefined ? undefined : cellLabel(tab, cur)
  return (
    <li
      className={`row row-${row.status}`}
      data-testid="row"
      data-row-kind={row.kind}
      data-status={row.status}
      data-move={row.moveId}
      data-condition={conditionOf(row)}
      data-variable={(row.status === 'ok' || row.status === 'stale') && !row.provisional ? (row.noChange ? 'false' : 'true') : undefined}
      data-provisional={row.provisional ? 'true' : undefined}
    >
      <div className="row-head">
        <span className="row-kind">{ROW_KIND_LABEL[row.kind]}</span>
        <strong className="row-title">{rowTitle(game, row)}</strong>
        {note && <span className="hint">({note})</span>}
        {row.basis && <span className="row-basis">{basisText(game, row.basis)}</span>}
      </div>
      {row.status === 'pending' && <p className="hint">계산 중…</p>}
      {row.status === 'error' && <p className="row-error">계산 불가: {row.error ? koReason(game, row.error) : '이유 없음'}</p>}
      {row.status === 'stale' && <p className="badge-stale">갱신 대기 — 놓으면 다시 계산합니다</p>}
      {row.provisional && <p className="hint">성격 변형 확인 중…</p>}
      {row.noChange && !row.provisional && row.current.category !== undefined && (
        <p className="row-fixed">
          <TierChip tab={tab} category={row.current.category} /> {fixedText(row.current.category)}
        </p>
      )}
      {stat !== undefined && row.cells.length > 0 && !row.noChange && (
        <>
          <p className="row-judge">
            {row.current.category !== undefined && (
              <>
                <TierChip tab={tab} category={row.current.category} />{' '}
              </>
            )}
            {currentText(stat, row.current.sp, currentLabel)}{' '}
            <VariableTag testId="row-variable" />
            {row.target !== undefined && (
              <span className="boundary" data-testid="row-target">
                {' '}
                · <TargetText target={row.target} />
              </span>
            )}
          </p>
          <Band cells={row.cells} current={row.current.sp} />
          <p className="band-legend">
            {spans.map((s) => {
              const need = spanNeedText(s)
              return (
                <span key={s.from} className={s.overBudget ? 'span over' : 'span'}>
                  <span className={`tier-swatch ko-${categoryTone(s.category)}`} aria-hidden="true" />{' '}
                  {spanText(s)}
                  {need !== undefined && <span className="span-need"> · {need}</span>}
                </span>
              )
            })}
            {row.cells.some((c) => c.overBudget) && (
              <span className="span over-key">
                <span className="tier-swatch over-swatch" aria-hidden="true" /> 빗금 = 예산 밖(다른 능력치에서 SP를 빼야 닿는 칸)
              </span>
            )}
          </p>
        </>
      )}
    </li>
  )
})
