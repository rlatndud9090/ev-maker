import { memo, useLayoutEffect, useRef } from 'react'
import { cellLabel, type CellView, type RowView, type Tab } from '../../cards'
import type { Snapshot } from '../../data/schema'
import { categoryLabel, categorySymbol, categoryTone, currentText, fixedText, spanText, spansOf, targetSegments, type TargetLike, type TargetSegment } from '../../ui/format'
import { koReason } from '../../ui/koErrors'
import { PriorityTag, VariableTag } from './MoveLabel'
import { ROW_KIND_LABEL, basisText, rowRefsNote, rowTitle } from './text'

/** 행 조건(기본·랭크 수단·도구) 식별 문자열. e2e가 "조건당 기술 하나(+선공기)"를 대조한다 */
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

/** 띠 스크롤 상자의 양 끝에 더 있는 칸이 있으면 data-more-left/right(가장자리 그라데이션 표시). React 상태 없이 DOM 속성만 바꾼다 */
function markEdges(el: HTMLElement) {
  const max = el.scrollWidth - el.clientWidth
  el.toggleAttribute('data-more-left', el.scrollLeft > 1)
  el.toggleAttribute('data-more-right', el.scrollLeft < max - 1)
}

function Band({ tab, cells, current }: { tab: Tab; cells: readonly CellView[]; current: number }) {
  const ref = useRef<HTMLDivElement>(null)
  // 띠가 상자보다 넓으면(상세 오른쪽 열) 처음 그릴 때 현재 칸이 보이게 옮긴다. 이후 스크롤은 사용자 몫.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const cur = el.querySelector<HTMLElement>('[aria-current="true"]')
    if (cur && el.scrollWidth > el.clientWidth) {
      const left = cur.offsetLeft - el.offsetLeft
      if (left + cur.offsetWidth > el.clientWidth) el.scrollLeft = left + cur.offsetWidth / 2 - el.clientWidth / 2
    }
    markEdges(el)
  }, [])
  return (
    <div className="band-wrap">
      <div className="band-scroll" ref={ref} onScroll={(e) => markEdges(e.currentTarget)}>
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
              title={`${c.sp}: ${categoryLabel(c.category)}${c.need > 0 ? ` (다른 능력치에서 ${c.need} 필요)` : ''}`}
            >
              <span className="cell-sp">{c.sp}</span>
              <span className="cell-sym" aria-hidden="true">
                {categorySymbol(tab, c.category)}
              </span>
              {/* 좁은 칸이라 숫자만(범례가 뜻을 풀고, 칸 title에 전체 문구) */}
              {c.need > 0 && <span className="cell-need">−{c.need}</span>}
            </li>
          ))}
        </ol>
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
      data-priority-kept={row.keptAsPriority ? 'true' : undefined}
      data-variable={(row.status === 'ok' || row.status === 'stale') && !row.provisional ? (row.noChange ? 'false' : 'true') : undefined}
      data-provisional={row.provisional ? 'true' : undefined}
    >
      <div className="row-head">
        <span className="row-kind">{ROW_KIND_LABEL[row.kind]}</span>
        <strong className="row-title">{rowTitle(game, row)}</strong>
        {row.keptAsPriority && <PriorityTag />}
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
          <Band tab={tab} cells={row.cells} current={row.current.sp} />
          <p className="band-legend">
            {spans.map((s) => (
              <span key={s.from} className={s.overBudget ? 'span over' : 'span'}>
                <TierChip tab={tab} category={s.category} />{' '}
                {spanText(s)}
              </span>
            ))}
            {row.cells.some((c) => c.overBudget) && <span className="span over-key">빗금 = 예산 밖(칸 아래 −n = 다른 능력치에서 빼야 할 SP)</span>}
          </p>
        </>
      )}
    </li>
  )
})
