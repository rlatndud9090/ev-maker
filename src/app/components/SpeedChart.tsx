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
import { BundleText } from './BundleText'
import { ItemMark } from './ItemMark'
import { PokemonIcon } from './PokemonIcon'
import { SpeedBadge } from './SpeedBadge'
import { SpeedBadgeDetail } from './SpeedBadgeDetail'
import { rejectionText, toggleDetail, type SpeedBadgeHandlers } from './speedText'
import './speedChart.css'

const DETAIL_ID = 'speed-detail-panel'
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
  /** 표시할 배지가 없음: 띠 아래 빈 상태 안내 */
  empty: boolean
}

type Pending = { kind: 'id'; id: string } | { kind: 'added'; opponentId: string; sp: number; nature: NatureSign }

/** 실수치 내림차순 줄 목록(기준선 띠 포함)과 줄 아래 인라인 상세, 순서 비교 불가 영역 */
export function SpeedChart({ game, model, badges, rows, baseline, shownSet, myTailwind, customTargets, dispatch, empty }: Props) {
  const frame = useRef<HTMLDivElement>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const byId = useMemo(() => new Map(badges.map((b) => [b.id, b])), [badges])
  const rowsRef = useRef(rows)
  const detailRef = useRef(detailId)
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

  /** 그 배지 상세를 연다(이미 열려 있으면 그대로) */
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
      onToggle(id) {
        if (toggleDetail(detailRef.current, id) === null) {
          setActiveId(id)
          close()
        } else open(id)
      },
      onKey(id, e: KeyboardEvent<HTMLButtonElement>) {
        if (!isNavKey(e.key)) return
        e.preventDefault()
        const next = navigate(rowsRef.current, id, e.key)
        setActiveId(next)
        buttonOf(next)?.focus()
      },
    }),
    [open, close, buttonOf],
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

  // 프레임 위·아래 스크롤 여백 = 기준선 띠 높이(포커스·펼친 상세가 끝에 붙은 띠 뒤로 숨지 않게, ADR 결정 1)
  useLayoutEffect(() => {
    const el = frame.current
    const bandEl = el?.querySelector<HTMLElement>('[data-testid="speed-baseline"]')
    if (el === null || el === undefined || bandEl === null || bandEl === undefined) return
    const sync = () => el.style.setProperty('--speed-band-h', `${bandEl.offsetHeight}px`)
    sync()
    const ro = new ResizeObserver(sync)
    ro.observe(bandEl)
    return () => ro.disconnect()
  }, [baseline.kind, rows])

  // 추가·삭제 뒤 포커스
  useEffect(() => {
    const p = pending.current
    if (p === null) return
    const target = p.kind === 'id' ? byId.get(p.id) : badges.find((b) => b.origin === 'added' && b.opponentId === p.opponentId && b.bundle.sp === p.sp && b.bundle.nature === p.nature)
    if (p.kind === 'id' || target !== undefined) pending.current = null
    if (target === undefined) return
    buttonOf(target.id)?.focus()
    // 추가한 배지는 상세를 열어 결과(상태·최소 S·지우기)를 바로 보인다. 삭제 뒤 이웃 배지는 포커스만
    if (p.kind === 'added') open(target.id)
  })

  // 바깥 누름·Esc로 닫는다. 상세 안에서 Esc면 포커스를 연 배지로 돌린다(콤보 목록 닫기 등 먼저 처리된 Esc는 건드리지 않음)
  useEffect(() => {
    if (detailId === null) return
    const onDown = (e: PointerEvent) => {
      if (e.target instanceof Element && e.target.closest('.speed-badge, .speed-detail') === null) setDetailId(null)
    }
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      e.preventDefault()
      const inside = document.activeElement instanceof Element && document.activeElement.closest('.speed-detail') !== null
      setDetailId(null)
      if (!inside) return
      setActiveId(detailId)
      buttonOf(detailId)?.focus()
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [detailId, buttonOf])

  const names = namesOf(game)
  const minSp = useMemo(
    () => (detailBadge === undefined || baseline.kind !== 'ok' ? null : minSpToPass(game, shownSet, detailBadge.speed, myTailwind)),
    [game, shownSet, detailBadge, baseline.kind, myTailwind],
  )

  return (
    <div className="speed-frame" ref={frame} data-testid="speed-frame">
      <ul className="speed-rows" aria-label="스피드 실수치 내림차순">
        {rows.map((row) => {
          const band = row.baseline && baseline.kind === 'ok'
          const hasDetail = detailBadge !== undefined && row.badgeIds.includes(detailBadge.id)
          const badgeList = row.badgeIds.length > 0 && (
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
          )
          const detail = hasDetail && detailBadge !== undefined && (
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
          )
          if (band) {
            // 기준선 띠 = 내 실수치 줄: 구분 텍스트 → 동속 배지. 동속 배지 상세는 띠 바로 아래 항목(띠와 함께 끝에 붙지 않게)
            return (
              <Fragment key={row.speed}>
                <li className="speed-baseline" data-testid="speed-baseline" data-speed={row.speed}>
                  <span className="speed-baseline-label">
                    내 스피드 <b className="num">{baseline.speed}</b>
                    <span className="speed-baseline-bundle num" data-testid="speed-baseline-bundle">
                      <BundleText sp={baseline.sp} nature={baseline.nature} />
                      {baseline.tailwind ? ' · 순풍' : ''}
                    </span>
                  </span>
                  <span className="sr-only">. {baseline.speed}과 같으면 동속, 그보다 아래는 추월</span>
                  {badgeList}
                </li>
                {detail && <li className="speed-row speed-band-detail">{detail}</li>}
              </Fragment>
            )
          }
          if (row.badgeIds.length === 0) return null
          return (
            <li key={row.speed} className="speed-row" data-speed={row.speed}>
              <span className="speed-row-speed num">{row.speed}</span>
              {badgeList}
              {detail}
            </li>
          )
        })}
      </ul>
      {empty && (
        <p className="empty speed-empty" data-testid="speed-empty">
          표시할 상대가 없습니다. 사용률 상위 수나 선택 필터를 바꿔 보세요.
        </p>
      )}
      {model.unsupported.length > 0 && (
        <section className="speed-unsupported" data-testid="speed-unsupported" aria-labelledby="speed-unsupported-h">
          <h3 id="speed-unsupported-h">순서 비교 불가</h3>
          <ul>
            {model.unsupported.map((u) => {
              const r = rejectionText(game, u.rejection, 'opponent')
              return (
                <li key={`${u.origin}:${u.opponentId}:${u.presetIndex ?? ''}`}>
                  <PokemonIcon speciesId={u.speciesId} size={28} lazy />
                  {names.species.label(u.speciesId)}
                  {u.item !== null && <ItemMark item={{ id: u.item, name: names.items.label(u.item), role: 'held' }} lazy game={game} />}
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
