import { memo, type CSSProperties } from 'react'
import { cellLabel, type CardView, type RowView, type SumBandView, type Tab } from '../../cards'
import type { Snapshot } from '../../data/schema'
import {
  categoryLabel,
  categorySymbol,
  categoryTone,
  currentText,
  fixedText,
  spanNeedText,
  spanText,
  spansOf,
  sumBandAriaLabel,
  sumCurrentText,
  sumFallbackText,
  sumSpanParts,
  targetSegments,
  type TargetLike,
  type TargetSegment,
} from '../../ui/format'
import { koReason } from '../../ui/koErrors'
import { MoveLabel, VariableTag } from './MoveLabel'
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

interface BandCell {
  sp: number
  category: string
  /** 예산 밖 빗금(스피드 탭만) */
  over?: boolean
  title: string
}

/** 띠 눈금(칸 아래 작은 숫자): 0·가운데·끝 */
const tickSps = (cells: readonly BandCell[]): number[] => {
  if (cells.length === 0) return []
  const last = cells.length - 1
  return [...new Set([0, Math.floor(last / 2), last])].map((i) => cells[i].sp)
}

/**
 * 구간 띠: 칸 안에는 글자 없이 판정 색(결과 배지와 같은 5색)만, 칸 사이 틈은 둔다. 칸은 열 폭에 맞춰 줄어들어(1fr) 가로 스크롤이 없다.
 * 현재 칸은 진한 외곽선. 판정 문구는 칸 title·위 판정 줄·아래 범례에 있다(색만으로 정보를 전하지 않는다). 칸은 포커스 대상이 아니다.
 */
function Band({ cells, current, className = '', testId, label }: { cells: readonly BandCell[]; current: number; className?: string; testId?: string; label?: string }) {
  const ticks = tickSps(cells)
  return (
    <div className={`band-wrap${className}`} data-testid={testId} style={{ '--band-cells': cells.length } as CSSProperties}>
      <ol className="band" aria-label={label}>
        {cells.map((c) => (
          <li
            key={c.sp}
            data-testid="band-cell"
            data-sp={c.sp}
            data-category={c.category}
            data-over-budget={c.over === undefined ? undefined : c.over ? 'true' : 'false'}
            aria-current={c.sp === current ? 'true' : undefined}
            className={`cell ko-${categoryTone(c.category)}${c.over ? ' over' : ''}${c.sp === current ? ' current' : ''}`}
            title={c.title}
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

/** 목표 문구: SP 조합("H0 B0+")은 한 덩어리로만 줄바꿈한다. need = "다른 능력치에서 n 필요"(스피드 탭만) */
function TargetText({ target, need }: { target: TargetLike; need: boolean }) {
  const seg = targetSegments(target)
  const opt = (o: TargetSegment) => (
    <>
      {o.lead}
      {o.sps !== undefined && <span className="sp-combo">{o.sps}</span>}
      {need && o.note}
    </>
  )
  return (
    <>
      {seg.judgement}: {opt(seg.neutral)} / {opt(seg.plus)}
    </>
  )
}

/** 판정 전·계산 불가·갱신 대기·성격 변형 확인 중 안내(행·쌍 공용) */
function RowStatus({ game, row }: { game: Snapshot; row: RowView }) {
  return (
    <>
      {row.status === 'pending' && <p className="hint">계산 중…</p>}
      {row.status === 'error' && <p className="row-error">계산 불가: {row.error ? koReason(game, row.error) : '이유 없음'}</p>}
      {row.status === 'stale' && <p className="badge-stale">갱신 대기 — 놓으면 다시 계산합니다</p>}
      {row.provisional && <p className="hint">성격 변형 확인 중…</p>}
    </>
  )
}

const variableAttr = (row: RowView): string | undefined =>
  (row.status === 'ok' || row.status === 'stale') && !row.provisional ? (row.noChange ? 'false' : 'true') : undefined

interface Props {
  game: Snapshot
  tab: Tab
  row: RowView
}

/**
 * 판정 행 하나. 공격·방어 탭(R9): 제목은 기술 라벨만("+2 도각참"), 빗금·"다른 능력치에서 n 필요" 없음.
 * 스피드 탭은 이전 표기(행 종류 배지·근거·능력치 접두·예산 밖 빗금) 그대로.
 */
export const RowDetail = memo(function RowDetail({ game, tab, row }: Props) {
  const speed = tab === 'speed'
  const note = rowRefsNote(game, tab, row)
  const stat = row.sweepStat
  // 현재 판정은 목표 문구와 같은 판정 라벨(코어 5단 판정·행동 순서)로 쓴다.
  const cur = row.cells.find((c) => c.sp === row.current.sp)
  const currentLabel = cur === undefined ? undefined : cellLabel(tab, cur)
  const cells: BandCell[] = row.cells.map((c) => ({
    sp: c.sp,
    category: c.category,
    ...(speed ? { over: c.overBudget } : {}),
    title: `SP ${c.sp}: ${categoryLabel(c.category)}${speed && c.need > 0 ? ` (다른 능력치에서 ${c.need} 필요)` : ''}`,
  }))
  const spans = spansOf(row.cells.map((c) => (speed ? c : { ...c, overBudget: false, need: 0 })))
  return (
    <li
      className={`row row-${row.status}`}
      data-testid="row"
      data-row-kind={row.kind}
      data-status={row.status}
      data-move={row.moveId}
      data-condition={conditionOf(row)}
      data-variable={variableAttr(row)}
      data-provisional={row.provisional ? 'true' : undefined}
    >
      <div className="row-head">
        {speed ? (
          <>
            <span className="row-kind">{ROW_KIND_LABEL[row.kind]}</span>
            <strong className="row-title">{rowTitle(game, row)}</strong>
          </>
        ) : (
          <strong className="row-title">
            <MoveLabel game={game} tab={tab} row={row} />
          </strong>
        )}
        {note && <span className="hint">({note})</span>}
        {speed && row.basis && <span className="row-basis">{basisText(game, row.basis)}</span>}
      </div>
      <RowStatus game={game} row={row} />
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
            {currentText(stat, row.current.sp, currentLabel)} <VariableTag testId="row-variable" />
            {row.target !== undefined && (
              <span className="boundary" data-testid="row-target">
                {' '}
                · <TargetText target={row.target} need={speed} />
              </span>
            )}
          </p>
          <Band cells={cells} current={row.current.sp} />
          <p className="band-legend">
            {spans.map((s) => {
              const need = speed ? spanNeedText(s) : undefined
              return (
                <span key={s.from} className={s.overBudget ? 'span over' : 'span'}>
                  <span className={`tier-swatch ko-${categoryTone(s.category)}`} aria-hidden="true" /> {spanText(s)}
                  {need !== undefined && <span className="span-need"> · {need}</span>}
                </span>
              )
            })}
            {speed && row.cells.some((c) => c.overBudget) && (
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

/** 내구 합계 띠(R10): 가로 = H + B/D 합계 0~64, 칸 = 그 합계 최적 분배의 최선 판정, 범례 = 단계별 합계 구간 + 최소 분배 */
function SumBand({ band }: { band: SumBandView }) {
  const plus = band.nature === 'plus' && !band.fallback
  const stat = band.defenseStat
  const cells: BandCell[] = band.cells.map((c) => ({ sp: c.sum, category: c.label, title: `합계 ${c.sum}: ${categoryLabel(c.label)}` }))
  return (
    <>
      <Band cells={cells} current={band.current.sum} className=" sum-band" testId="sum-band" label={sumBandAriaLabel(stat, band.max)} />
      <p className="band-legend" data-testid="sum-legend">
        {band.spans.map((s) => {
          const p = sumSpanParts(s, stat, plus)
          return (
            <span key={s.from} className="span">
              <span className={`tier-swatch ko-${categoryTone(s.label)}`} aria-hidden="true" /> {p.range}
              {p.min !== undefined && (
                <span className="span-min">
                  {' '}
                  → <span className="sp-combo">{p.min}</span> / <span className="sp-combo">{p.alt}</span>
                </span>
              )}
            </span>
          )
        })}
      </p>
      {band.fallback && <p className="hint" data-testid="sum-fallback">{sumFallbackText(stat, band.fallbackReason)}</p>}
    </>
  )
}

/**
 * 방어 탭 쌍 항목(극단 필터 통과)의 판정 하나: H 행·B/D 행을 합계 띠 하나로 보인다. 띠 = 두 변형 쌍 결과가 나온 뒤, 그 전에는 "갱신 중".
 * 쌍 오류(card.pair.error)면 띠 자리에 "계산 불가"(행 오류가 이미 보이면 거듭 쓰지 않는다). 두 행이 모두 변화 없음(잠정 아님)이면 고정 판정 1줄.
 */
export const PairDetail = memo(function PairDetail({ game, card }: { game: Snapshot; card: CardView }) {
  const rows = card.rows
  const head = rows.find((r) => r.sweepStat === 'hp') ?? rows[0]
  if (head === undefined) return null
  const band = card.pair?.band
  const shownStatus = rows.find((r) => r.status === 'error') ?? rows.find((r) => r.status === 'pending') ?? rows.find((r) => r.status === 'stale')
  // 행 오류가 이미 보이면 쌍 오류를 거듭 쓰지 않는다.
  const pairError = band === undefined && shownStatus?.status !== 'error' ? card.pair?.error : undefined
  const variable = rows.some((r) => (r.status === 'ok' || r.status === 'stale') && !r.noChange && r.cells.length > 0)
  const fixed = !variable && pairError === undefined && rows.every((r) => r.status === 'ok' && r.noChange && !r.provisional) ? head.current.category : undefined
  const status = shownStatus ?? (variable ? undefined : rows.find((r) => r.provisional))
  const note = rowRefsNote(game, 'defense', head)
  const plus = band !== undefined && band.nature === 'plus' && !band.fallback
  const label = band?.current.label
  return (
    <li
      className={`row row-${head.status} row-pair`}
      data-testid="row"
      data-row-kind={head.kind}
      data-status={head.status}
      data-move={head.moveId}
      data-condition={conditionOf(head)}
      data-variable={variable ? 'true' : fixed !== undefined ? 'false' : undefined}
      data-pair="true"
    >
      <div className="row-head">
        <strong className="row-title">
          <MoveLabel game={game} tab="defense" row={head} />
        </strong>
        {note && <span className="hint">({note})</span>}
      </div>
      {status !== undefined && <RowStatus game={game} row={status} />}
      {pairError !== undefined && (
        <p className="row-error" data-testid="sum-band-error">
          계산 불가: {koReason(game, pairError)}
        </p>
      )}
      {fixed !== undefined && (
        <p className="row-fixed">
          <TierChip tab="defense" category={fixed} /> {fixedText(fixed)}
        </p>
      )}
      {variable && band === undefined && pairError === undefined && shownStatus?.status !== 'error' && (
        <p className="hint" data-testid="sum-band-pending">
          갱신 중
        </p>
      )}
      {variable && band !== undefined && (
        <>
          <p className="row-judge" data-testid="sum-current">
            {label !== undefined && (
              <>
                <TierChip tab="defense" category={label} />{' '}
              </>
            )}
            {sumCurrentText(band.current, band.defenseStat, plus)} <VariableTag testId="row-variable" />
          </p>
          <SumBand band={band} />
        </>
      )}
    </li>
  )
})
