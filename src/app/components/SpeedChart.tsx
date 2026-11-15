import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type Dispatch, type KeyboardEvent } from 'react'
import {
  focusAfterRemove,
  minSpToPass,
  navigate,
  statusOf,
  type CustomTarget,
  type LadderRow,
  type NatureSign,
  type SpeedBadge as Badge,
  type SpeedBaseline,
  type SpeedChartModel,
} from '../../cards'
import type { PokemonSet } from '../../core'
import type { Snapshot } from '../../data/schema'
import { namesOf } from '../../ui/names'
import type { AppAction } from '../state'
import { SpeedBadge } from './SpeedBadge'
import { SpeedBadgeDetail } from './SpeedBadgeDetail'
import { rejectionText, type SpeedBadgeHandlers } from './speedText'
import './speedChart.css'

const DETAIL_ID = 'speed-detail-panel'
const HOVER_DELAY_MS = 250
const NAV_KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'] as const
type NavKeyName = (typeof NAV_KEYS)[number]
const isNavKey = (k: string): k is NavKeyName => (NAV_KEYS as readonly string[]).includes(k)

interface Props {
  game: Snapshot
  model: SpeedChartModel
  badges: readonly Badge[]
  rows: readonly LadderRow[]
  baseline: SpeedBaseline
  shownSet: PokemonSet
  myTailwind: boolean
  customTargets: readonly CustomTarget[]
  dispatch: Dispatch<AppAction>
}

type Pending = { kind: 'id'; id: string } | { kind: 'added'; opponentId: string; sp: number; nature: NatureSign }

/** 실수치 내림차순 줄 목록(기준선 띠 포함)과 줄 아래 인라인 상세, 순서 비교 불가 영역 */
export function SpeedChart({ game, model, badges, rows, baseline, shownSet, myTailwind, customTargets, dispatch }: Props) {
  const frame = useRef<HTMLDivElement>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const byId = useMemo(() => new Map(badges.map((b) => [b.id, b])), [badges])
  const rowsRef = useRef(rows)
  const detailRef = useRef(detailId)
  const hover = useRef<ReturnType<typeof setTimeout> | null>(null)
  const anchor = useRef<{ id: string; top: number } | null>(null)
  const pending = useRef<Pending | null>(null)

  useLayoutEffect(() => {
    rowsRef.current = rows
    detailRef.current = detailId
  })

  const firstId = rows.find((r) => r.badgeIds.length > 0)?.badgeIds[0] ?? null
  const active = activeId !== null && byId.has(activeId) ? activeId : firstId
  const detailBadge = detailId === null ? undefined : byId.get(detailId)

  const buttonOf = useCallback((id: string): HTMLButtonElement | null => {
    for (const el of frame.current?.querySelectorAll<HTMLButtonElement>('[data-testid="speed-badge"]') ?? []) if (el.dataset.badgeId === id) return el
    return null
  }, [])

  const open = useCallback(
    (id: string) => {
      const btn = buttonOf(id)
      if (btn !== null && detailRef.current !== id) anchor.current = { id, top: btn.getBoundingClientRect().top }
      setActiveId(id)
      setDetailId(id)
    },
    [buttonOf],
  )
  const close = useCallback(() => setDetailId(null), [])

  const handlers = useMemo<SpeedBadgeHandlers>(
    () => ({
      onOpen: open,
      onHover(id) {
        if (hover.current !== null) clearTimeout(hover.current)
        hover.current = id === null ? null : setTimeout(() => open(id), HOVER_DELAY_MS)
      },
      onKey(id, e: KeyboardEvent<HTMLButtonElement>) {
        if (e.key === 'Escape') {
          if (detailRef.current === null) return
          e.preventDefault()
          close()
          return
        }
        if (!isNavKey(e.key)) return
        e.preventDefault()
        const next = navigate(rowsRef.current, id, e.key)
        setActiveId(next)
        buttonOf(next)?.focus()
      },
    }),
    [open, close, buttonOf],
  )

  useEffect(
    () => () => {
      if (hover.current !== null) clearTimeout(hover.current)
    },
    [],
  )

  // 상세가 다른 줄로 옮겨 가도 포커스한 배지의 화면 위치를 유지한다
  useLayoutEffect(() => {
    const a = anchor.current
    anchor.current = null
    const el = frame.current
    if (a === null || el === null || a.id !== detailId) return
    const btn = buttonOf(a.id)
    if (btn !== null) el.scrollTop += btn.getBoundingClientRect().top - a.top
  }, [detailId, buttonOf])

  // 추가·삭제 뒤 포커스
  useEffect(() => {
    const p = pending.current
    if (p === null) return
    const target = p.kind === 'id' ? byId.get(p.id) : badges.find((b) => b.origin === 'added' && b.opponentId === p.opponentId && b.bundle.sp === p.sp && b.bundle.nature === p.nature)
    if (p.kind === 'id' || target !== undefined) pending.current = null
    if (target !== undefined) buttonOf(target.id)?.focus()
  })

  // 바깥 누름으로 닫는다(마우스가 떠나는 것만으로는 닫지 않는다)
  useEffect(() => {
    if (detailId === null) return
    const onDown = (e: PointerEvent) => {
      if (e.target instanceof Element && e.target.closest('.speed-badge, .speed-detail') === null) setDetailId(null)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [detailId])

  const baselineSpeed = baseline.kind === 'ok' ? baseline.speed : null
  const names = namesOf(game)
  const minSp = useMemo(
    () => (detailBadge === undefined || baseline.kind !== 'ok' ? null : minSpToPass(game, shownSet, detailBadge.speed, myTailwind)),
    [game, shownSet, detailBadge, baseline.kind, myTailwind],
  )

  return (
    <div className="speed-frame" ref={frame} data-testid="speed-frame">
      <ul className="speed-rows" aria-label="스피드 실수치 내림차순">
        {rows.map((row) => (
          <Fragment key={row.speed}>
            {row.baseline && baselineSpeed !== null && (
              <li className="speed-baseline" data-testid="speed-baseline">
                <span>
                  내 스피드 <b className="num">{baselineSpeed}</b>
                </span>
                <span className="sr-only">. {baselineSpeed}과 같으면 동속, 그보다 아래는 추월</span>
              </li>
            )}
            {row.badgeIds.length > 0 && (
              <li className="speed-row" data-speed={row.speed}>
                <span className="speed-row-speed num">{row.speed}</span>
                <span className="speed-row-diff num" aria-hidden="true">
                  {row.diff === null ? '' : `−${row.diff}`}
                </span>
                <ul className="speed-badges" aria-label={`실수치 ${row.speed}`}>
                  {row.badgeIds.map((id) => {
                    const b = byId.get(id)
                    if (b === undefined) return null
                    return (
                      <SpeedBadge
                        key={id}
                        game={game}
                        badge={b}
                        status={statusOf(b.speed, baseline)}
                        active={id === active}
                        open={id === detailId}
                        detailId={DETAIL_ID}
                        handlers={handlers}
                      />
                    )
                  })}
                </ul>
                {detailBadge !== undefined && row.badgeIds.includes(detailBadge.id) && (
                  <SpeedBadgeDetail
                    id={DETAIL_ID}
                    game={game}
                    model={model}
                    badge={detailBadge}
                    status={statusOf(detailBadge.speed, baseline)}
                    baseline={baseline}
                    minSp={minSp}
                    myTailwind={myTailwind}
                    target={customTargets.find((t) => t.rosterId === detailBadge.opponentId)}
                    dispatch={dispatch}
                    onClose={close}
                    onAdded={(b) => {
                      pending.current = { kind: 'added', ...b }
                    }}
                    onRemove={(b) => {
                      const next = focusAfterRemove(rowsRef.current, b.id)
                      pending.current = next === null ? null : { kind: 'id', id: next }
                      setDetailId(null)
                      dispatch({ type: 'remove-speed-bundle', bundle: { opponentId: b.opponentId, sp: b.bundle.sp, nature: b.bundle.nature } })
                    }}
                  />
                )}
              </li>
            )}
          </Fragment>
        ))}
      </ul>
      {model.unsupported.length > 0 && (
        <section className="speed-unsupported" data-testid="speed-unsupported" aria-labelledby="speed-unsupported-h">
          <h3 id="speed-unsupported-h">순서 비교 불가</h3>
          <ul>
            {model.unsupported.map((u) => {
              const r = rejectionText(game, u.rejection, 'opponent')
              return (
                <li key={`${u.origin}:${u.opponentId}:${u.presetIndex ?? ''}`}>
                  {names.species.label(u.speciesId)}
                  {u.presetIndex !== undefined && ` (프리셋 ${u.presetIndex + 1})`} · {r.reason} · {r.cause}
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </div>
  )
}
