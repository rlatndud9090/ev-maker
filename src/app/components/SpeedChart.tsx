import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type Dispatch, type KeyboardEvent } from 'react'
import {
  focusAfterRemove,
  minSpToPass,
  navigate,
  speedBranchLines,
  speedLockBadge,
  speedLockCandidate,
  statusOf,
  type CustomTarget,
  type SpeedBranchLine,
  type LadderRow,
  type NatureSign,
  type SpeedBadge as Badge,
  type SpeedBaseline,
  type SpeedChartInput,
  type SpeedChartModel,
  type SpeedLockCandidate,
  type TargetSource,
} from '../../cards'
import type { EvalOptions, PokemonSet } from '../../core'
import type { Snapshot } from '../../data/schema'
import { namesOf } from '../../ui/names'
import { useLockUi } from '../lockContext'
import type { SpeedReveal } from '../reveal'
import type { AppAction } from '../state'
import { OUTSIDE_FILTER_TEXT, speedPinDisabledText } from './lockText'
import { BundleText } from './BundleText'
import { ItemMark } from './ItemMark'
import { PokemonIcon } from './PokemonIcon'
import { SpeedBadge } from './SpeedBadge'
import { SpeedBadgeDetail } from './SpeedBadgeDetail'
import { Popover } from './Popover'
import { lockedMinSp, rejectionText, toggleDetail, type SpeedBadgeHandlers } from './speedText'
import './speedChart.css'

const DETAIL_ID = 'speed-detail-panel'
const NAV_KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'] as const
type NavKeyName = (typeof NAV_KEYS)[number]
const isNavKey = (k: string): k is NavKeyName => (NAV_KEYS as readonly string[]).includes(k)

interface Props {
  game: Snapshot
  model: SpeedChartModel
  /** 차트 모델 입력(배지 상세 추가 판정이 같은 입력을 쓴다) */
  input: SpeedChartInput
  bundleShareMin: number
  badges: readonly Badge[]
  rows: readonly LadderRow[]
  baseline: SpeedBaseline
  shownSet: PokemonSet
  /** 고정 후보·갈래 예산의 내 세트(고정 전 값). 고정 문맥이 없으면 없음 */
  lockSet?: PokemonSet
  /** 확정된 내 세트(드래그 중 표시 SP 없음). 핀 비활성 판정용. 고정 문맥이 없으면 없음 */
  confirmedLockSet?: PokemonSet
  myTailwind: boolean
  customTargets: readonly CustomTarget[]
  dispatch: Dispatch<AppAction>
  /** 표시할 배지가 없음: 띠 아래 빈 상태 안내 */
  empty: boolean
  /** 패널에서 추가한 배분: 그 배지로 포커스하고 상세를 연다 */
  reveal: SpeedReveal | null
  onRevealed: () => void
}

type Pending = { kind: 'id'; id: string } | { kind: 'added'; source: TargetSource; opponentId: string; sp: number; nature: NatureSign }

const IGNORE_TOTAL: EvalOptions = { ignoreSpTotal: true }
const NO_SEQS: readonly number[] = []

/** 실수치 내림차순 줄 목록(기준선 띠 포함)과 배지에 붙는 상세 팝오버, 순서 비교 불가 영역 */
export function SpeedChart({ game, model, input, bundleShareMin, badges, rows, baseline, shownSet, lockSet, confirmedLockSet, myTailwind, customTargets, dispatch, empty, reveal, onRevealed }: Props) {
  const frame = useRef<HTMLDivElement>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const byId = useMemo(() => new Map(badges.map((b) => [b.id, b])), [badges])
  const rowsRef = useRef(rows)
  const detailRef = useRef(detailId)
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
  const open = useCallback((id: string) => {
    // 다음 커밋 전에 오는 이전 팝오버의 닫기(dismiss)가 새로 연 상세를 닫지 않게 바로 바꾼다
    detailRef.current = id
    setActiveId(id)
    setDetailId(id)
  }, [])
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

  // 프레임 위·아래 스크롤 여백 = 기준선 띠 높이(포커스한 배지가 끝에 붙은 띠 뒤로 숨지 않게)
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

  // 패널 추가 요청은 배지 상세 추가와 같은 경로(아래 포커스 효과)로 넘긴다. 이 효과가 먼저 돌아야 같은 커밋에서 포커스한다.
  useEffect(() => {
    if (reveal === null) return
    pending.current = { kind: 'added', source: reveal.source, opponentId: reveal.opponentId, sp: reveal.sp, nature: reveal.nature }
    onRevealed()
  }, [reveal, onRevealed])

  // 추가·삭제 뒤 포커스. 차트 모델은 동기 계산이라 요청 뒤 첫 커밋에 대상이 없으면 생기지 않은 것이다(요청을 버린다).
  useEffect(() => {
    const p = pending.current
    if (p === null) return
    pending.current = null
    const target =
      p.kind === 'id'
        ? byId.get(p.id)
        : badges.find((b) => b.origin === 'added' && b.source === p.source && b.opponentId === p.opponentId && b.bundle.sp === p.sp && b.bundle.nature === p.nature)
    if (target === undefined) return
    buttonOf(target.id)?.focus()
    // 추가한 배지는 상세를 열어 결과(상태·최소 S·지우기)를 바로 보인다. 삭제 뒤 이웃 배지는 포커스만
    if (p.kind === 'added') open(target.id)
  })

  // 팝오버 닫기(Esc·바깥 누름·배지가 스크롤로 가려짐): 로빙 자리는 연 배지에 둔다(포커스 복귀는 팝오버가 한다).
  // 이미 다른 배지로 바뀐 뒤 늦게 온 이전 팝오버의 닫기는 무시한다
  const dismiss = useCallback((id: string) => {
    if (detailRef.current !== id) return
    setActiveId(id)
    setDetailId(null)
  }, [])

  // 컷 고정: 고정 중에는 합계 검사를 끄고(계획 세트), 갈래 줄은 갈래 예산으로(speedBranchLines)
  const lockUi = useLockUi()
  const { locks, derivation, reveal: lockReveal, clearReveal } = lockUi
  const locked = locks.length > 0
  // 고정이 이어진 배지(해석과 같은 규칙: 기준 변경으로 기본↔추가가 바뀌어도 그 배지가 고정 상태)
  const lockedById = useMemo(() => {
    const m = new Map<string, number[]>()
    for (const l of locks) {
      if (l.target.kind !== 'speed') continue
      const b = speedLockBadge(badges, l.target)
      if (b !== undefined) m.set(b.id, [...(m.get(b.id) ?? []), l.seq])
    }
    return m
  }, [locks, badges])
  const lockedBy = (b: Badge): readonly number[] => lockedById.get(b.id) ?? NO_SEQS

  const names = namesOf(game)
  const minSp = useMemo(() => {
    if (detailBadge === undefined || baseline.kind !== 'ok') return null
    if (!locked) return minSpToPass(game, shownSet, detailBadge.speed, myTailwind)
    const r = minSpToPass(game, shownSet, detailBadge.speed, myTailwind, IGNORE_TOTAL)
    return r === null ? null : lockedMinSp(r)
  }, [game, shownSet, detailBadge, baseline.kind, myTailwind, locked])
  const spTotal = game.manifest.rules.spTotal
  const lockLines = useMemo((): readonly SpeedBranchLine[] | null => {
    if (!locked || derivation === null || detailBadge === undefined || lockSet === undefined || baseline.kind !== 'ok') return null
    const lines = speedBranchLines({ game, mySet: shownSet, derivation, badge: detailBadge, myTailwind, mySp: lockSet.sp, spTotal })
    return lines.length === 0 ? null : lines
  }, [locked, derivation, detailBadge, lockSet, baseline.kind, game, shownSet, myTailwind, spTotal])
  // 핀을 누를 때만 그 배지 후보를 만든다(배지마다 미리 만들지 않는다)
  const pinCandidate = useMemo(
    () => (lockSet === undefined ? undefined : (b: Badge): SpeedLockCandidate => speedLockCandidate(game, lockSet, b, myTailwind, locked ? IGNORE_TOTAL : undefined)),
    [game, lockSet, myTailwind, locked],
  )
  // 핀 비활성 판정: 확정 세트·고정 기준으로 배지마다 한 번(드래그 중에는 다시 판정하지 않는다). 계산 중·바로 고정 가능이면 활성
  const check = lockUi.check
  const pinDisabled = useMemo(() => {
    if (confirmedLockSet === undefined) return undefined
    const memo = new Map<string, string | null>()
    return (b: Badge): string | undefined => {
      let r = memo.get(b.id)
      if (r === undefined) {
        r = speedPinDisabledText(speedLockCandidate(game, confirmedLockSet, b, myTailwind, locked ? IGNORE_TOTAL : undefined), check) ?? null
        memo.set(b.id, r)
      }
      return r ?? undefined
    }
  }, [game, confirmedLockSet, myTailwind, locked, check])

  // 고정 목록의 이동 요청: 그 배지 상세를 열고 포커스, 표시 필터 밖이면 안내(조건 칩은 리듀서가 켠다)
  // 요청은 렌더 중 한 번만 처리하고(nonce), 요청 지우기·포커스는 커밋 뒤에 한다
  const [revealDone, setRevealDone] = useState<{ nonce: number; outside: number | null; badgeId?: string } | null>(null)
  const revealLock = lockReveal === null ? undefined : locks.find((l) => l.seq === lockReveal.seq)
  if (lockReveal !== null && revealLock !== undefined && revealLock.target.kind === 'speed' && revealDone?.nonce !== lockReveal.nonce) {
    const b = speedLockBadge(badges, revealLock.target)
    if (b === undefined) {
      const missing = derivation?.statuses.get(revealLock.seq)?.kind === 'missing'
      setRevealDone({ nonce: lockReveal.nonce, outside: missing ? null : revealLock.seq })
    } else {
      setRevealDone({ nonce: lockReveal.nonce, outside: null, badgeId: b.id })
      setActiveId(b.id)
      setDetailId(b.id)
    }
  }
  const revealNonce = lockReveal?.nonce
  useEffect(() => {
    if (revealDone !== null && revealDone.nonce === revealNonce) clearReveal()
  }, [revealDone, revealNonce, clearReveal])
  const revealFocused = useRef<number | null>(null)
  useLayoutEffect(() => {
    const id = revealDone?.badgeId
    if (revealDone === null || id === undefined || revealFocused.current === revealDone.nonce) return
    const btn = buttonOf(id)
    if (btn === null) return
    revealFocused.current = revealDone.nonce
    btn.scrollIntoView({ block: 'nearest' })
    btn.focus({ preventScroll: true })
  })
  const outside = revealDone !== null && revealDone.outside !== null && locks.some((l) => l.seq === revealDone.outside)

  return (
    <>
      <div className="speed-frame" ref={frame} data-testid="speed-frame">
        {locked && (
          <p className="lock-outside" role="status" data-testid="lock-outside">
            {outside ? OUTSIDE_FILTER_TEXT : ''}
          </p>
        )}
        <ul className="speed-rows" aria-label="스피드 실수치 내림차순">
          {rows.map((row) => {
            const band = row.baseline && baseline.kind === 'ok'
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
                      lockedBy={lockedBy(b)}
                      pinCandidate={pinCandidate}
                      pinDisabled={pinDisabled === undefined || lockedBy(b).length > 0 ? undefined : pinDisabled(b)}
                    />
                  )
                })}
              </ul>
            )
            if (band) {
              // 기준선 띠 = 내 실수치 줄: 구분 텍스트 → 동속 배지
              return (
                <li key={row.speed} className="speed-baseline" data-testid="speed-baseline" data-speed={row.speed}>
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
              )
            }
            if (row.badgeIds.length === 0) return null
            return (
              <li key={row.speed} className="speed-row" data-speed={row.speed}>
                <span className="speed-row-speed num">{row.speed}</span>
                {badgeList}
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
                    {u.item !== null && <ItemMark item={{ id: u.item, name: names.items.label(u.item), role: 'held' }} lazy />}
                    {u.presetIndex !== undefined && ` (프리셋 ${u.presetIndex + 1})`} · {r.reason} · {r.cause}
                  </li>
                )
              })}
            </ul>
          </section>
        )}
      </div>
      {/* 상세는 프레임 밖 고정 배치 팝오버: 줄을 밀지 않고, DOM은 프레임 바로 뒤라 배지에서 Tab 한 번에 들어간다 */}
      {detailBadge !== undefined && (
        <Popover
          key={detailBadge.id}
          id={DETAIL_ID}
          label={`${names.species.label(detailBadge.speciesId)} 상세`}
          getAnchor={() => buttonOf(detailBadge.id)}
          onDismiss={() => dismiss(detailBadge.id)}
          closeWhenAnchorHidden
          ignoreOutside=".speed-badge, .cut-pin-wrap"
        >
          <SpeedBadgeDetail
            game={game}
            model={model}
            input={input}
            bundleShareMin={bundleShareMin}
            badge={detailBadge}
            status={statusOf(detailBadge.speed, baseline)}
            baseline={baseline}
            minSp={minSp}
            lockLines={lockLines}
            lockPending={locked && derivation === null}
            myTailwind={myTailwind}
            target={detailBadge.source === 'custom' ? customTargets.find((t) => t.rosterId === detailBadge.opponentId) : undefined}
            dispatch={dispatch}
            onAdded={(b) => {
              pending.current = { kind: 'added', ...b }
            }}
            onRemove={(b) => {
              const next = focusAfterRemove(rowsRef.current, b.id)
              pending.current = next === null ? null : { kind: 'id', id: next }
              setDetailId(null)
              dispatch({ type: 'remove-speed-bundle', bundle: { source: b.source, opponentId: b.opponentId, sp: b.bundle.sp, nature: b.bundle.nature } })
            }}
          />
        </Popover>
      )}
    </>
  )
}
