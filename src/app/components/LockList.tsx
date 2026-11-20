// 내 포켓몬 패널의 컷 고정 목록(SP 입력 블록 아래). 기준 갈래는 내 세트 고정 줄의 ▲로 고른다(MySetPanel).
import { useEffect, useId, useRef, type Dispatch, type RefObject } from 'react'
import type { CutLock, LockDerivation, LockResolution } from '../../cards'
import type { Snapshot } from '../../data/schema'
import { useLockUi } from '../lockContext'
import type { AppAction } from '../state'
import { ItemMark } from './ItemMark'
import { PokemonIcon } from './PokemonIcon'
import { LOCK_NAME, lockAllocationText, lockChoiceText, lockDescription, lockDescriptionSpoken, lockOptionText, lockStatusText, lockSubjectSpoken, lockSubjectView } from './lockText'
import './lockPanel.css'

interface Props {
  game: Snapshot
  dispatch: Dispatch<AppAction>
  /** 화면에 보이는 파생(계산 중이면 직전 파생, 없으면 null) */
  derivation: LockDerivation | null
  /** 지금 실행 세대의 고정 해석(계산 중이면 undefined) */
  resolutions: ReadonlyMap<number, LockResolution> | undefined
  /** 마지막 고정을 해제해 목록이 사라질 때 포커스를 받을 곳 */
  fallbackFocus: RefObject<HTMLElement | null>
}

/** 목록 항목의 상대 이미지 크기(px). 스피드 배지 이미지와 같다 */
const ICON_SIZE = 28

function LockItem({ game, lock, derivation, resolution, pending, onReveal, onRemove, removeRef }: {
  game: Snapshot
  lock: CutLock
  derivation: LockDerivation | null
  resolution: LockResolution | undefined
  pending: boolean
  onReveal: () => void
  onRemove: () => void
  removeRef: (el: HTMLButtonElement | null) => void
}) {
  const statusId = useId()
  const view = lockSubjectView(game, lock)
  const status = pending ? undefined : derivation?.statuses.get(lock.seq)
  const chip = status === undefined ? undefined : lockStatusText(status)
  // 활성 고정은 파생 갈래 값(H 공유 합치기·H 최대 배분 반영), 문제 고정은 해석 선택지
  const active = derivation?.statuses.get(lock.seq)?.kind === 'active' && derivation.locks.some((l) => l.seq === lock.seq)
  const options = (active && derivation !== null ? lockChoiceText(derivation, lock) : undefined) ?? lockOptionText(resolution)
  const alloc = lockAllocationText(lock)
  return (
    <li className="lock-item" data-lock-seq={lock.seq} data-lock-kind={lock.kind}>
      <button
        type="button"
        className="lock-desc"
        title={lockDescription(game, lock)}
        aria-label={`${lockDescriptionSpoken(game, lock)} 보기`}
        aria-describedby={chip ? statusId : undefined}
        onClick={onReveal}
      >
        <PokemonIcon speciesId={view.speciesId} size={ICON_SIZE} className="lock-mon" />
        <span className="lock-desc-body">
          {view.bundle !== undefined && <span className="lock-bundle num">{view.bundle}</span>}
          {view.item !== undefined && <ItemMark item={{ ...view.item, role: 'held' }} />}
          {view.note !== undefined && <span className="lock-move">{view.note}</span>}
          {view.badge !== undefined && (
            <span className={`ko-badge ko-${view.badge.tone} ko-small`} data-testid="lock-stage" data-tone={view.badge.tone}>
              {view.badge.label}
            </span>
          )}
          {alloc !== undefined && (
            <span className="lock-alloc" data-testid="lock-alloc">
              {alloc}
            </span>
          )}
        </span>
      </button>
      {options !== undefined && <span className="lock-sp num">{options}</span>}
      {chip && (
        <span id={statusId} className="lock-chip" title={chip.detail}>
          {chip.text}
          {chip.detail !== undefined && <span className="sr-only">: {chip.detail}</span>}
        </span>
      )}
      <button type="button" ref={removeRef} className="lock-remove" aria-label={`${lockSubjectSpoken(game, lock)} 고정 해제`} title="해제" onClick={onRemove}>
        <span aria-hidden="true">×</span>
      </button>
    </li>
  )
}

export function LockList({ game, dispatch, derivation, resolutions, fallbackFocus }: Props) {
  const ui = useLockUi()
  const uid = useId()
  const headRef = useRef<HTMLHeadingElement>(null)
  const removeRefs = useRef(new Map<number, HTMLButtonElement>())
  // 해제한 항목의 자리(해제 뒤 포커스 이동용)
  const focusAt = useRef<number | null>(null)
  const { locks } = ui
  useEffect(() => {
    const at = focusAt.current
    if (at === null) return
    focusAt.current = null
    if (locks.length === 0) {
      fallbackFocus.current?.focus()
      return
    }
    const next = locks[at]
    const el = next === undefined ? undefined : removeRefs.current.get(next.seq)
    if (el !== undefined) el.focus()
    else headRef.current?.focus()
  }, [locks, fallbackFocus])

  if (locks.length === 0) return null
  return (
    <section className="lock-list" aria-labelledby={`${uid}-h`} aria-busy={ui.pending || undefined}>
      <h3 id={`${uid}-h`} ref={headRef} tabIndex={-1} className="lock-list-head">
        {LOCK_NAME}
        {ui.pending && (
          <span className="lock-computing" role="status">
            계산 중…
          </span>
        )}
      </h3>
      <ul className="lock-items">
        {locks.map((lock, i) => (
          <LockItem
            key={lock.seq}
            game={game}
            lock={lock}
            derivation={derivation}
            resolution={resolutions?.get(lock.seq)}
            pending={ui.pending}
            onReveal={() => dispatch({ type: 'reveal-lock', seq: lock.seq })}
            onRemove={() => {
              focusAt.current = i
              ui.removeLock(lock.seq)
            }}
            removeRef={(el) => {
              if (el === null) removeRefs.current.delete(lock.seq)
              else removeRefs.current.set(lock.seq, el)
            }}
          />
        ))}
      </ul>
    </section>
  )
}

