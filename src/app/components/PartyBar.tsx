import { useCallback, useEffect, useId, useMemo, useRef, useState, type Dispatch, type DragEvent, type FormEvent, type KeyboardEvent } from 'react'
import type { Snapshot } from '../../data/schema'
import { fetchPaste, normalizePasteUrl, parsePasteText, toDrafts, type PasteReportEntry } from '../../party/pokepaste'
import { PARTY_SIZE, partyHasMembers, partySlotsView, type PartySlotView } from '../party'
import type { AppAction, AppState } from '../state'
import { useAnnounce } from '../useAnnounce'
import { ItemMark } from './ItemMark'
import { PokemonIcon } from './PokemonIcon'
import { Popover } from './Popover'
import { CLEAR_CONFIRM_TEXT, IMPORT_CONFIRM_TEXT, IMPORT_ERROR_TEXT, importedText, movedText, slotLabel, type ImportFailure } from './partyText'
import './partyBar.css'

const ICON_SIZE = 40
const ITEM_SIZE = 20
const DRAG_TYPE = 'application/x-ev-maker-party-slot'

interface Props {
  state: AppState
  game: Snapshot
  dispatch: Dispatch<AppAction>
  /** 테스트 대체용 */
  fetchImpl?: typeof fetch
}

type Confirm = { kind: 'import'; rawUrl: string } | { kind: 'clear' }

export function PartyBar({ state, game, dispatch, fetchImpl }: Props) {
  const uid = useId()
  const slots = useMemo(() => partySlotsView(state, game), [state, game])
  const hasMembers = partyHasMembers(state)
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ImportFailure | null>(null)
  const [report, setReport] = useState<readonly PasteReportEntry[] | null>(null)
  const [confirm, setConfirm] = useState<Confirm | null>(null)
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const [dropAt, setDropAt] = useState<number | null>(null)
  const [announced, announce] = useAnnounce()
  const slotRefs = useRef<(HTMLButtonElement | null)[]>([])
  const pendingFocus = useRef<number | null>(null)
  const importBtn = useRef<HTMLButtonElement>(null)
  const clearBtn = useRef<HTMLButtonElement>(null)
  const confirmBtn = useRef<HTMLButtonElement>(null)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  // 키보드 이동 뒤 포커스를 옮겨진 칸으로
  useEffect(() => {
    const i = pendingFocus.current
    if (i === null) return
    pendingFocus.current = null
    slotRefs.current[i]?.focus()
  })

  useEffect(() => {
    if (confirm !== null) confirmBtn.current?.focus()
  }, [confirm])

  const move = (from: number, to: number) => {
    if (from === to || to < 0 || to >= PARTY_SIZE) return
    dispatch({ type: 'party-move', from, to })
    announce(movedText(to))
  }

  const onSlotKey = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!e.altKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return
    e.preventDefault()
    const to = index + (e.key === 'ArrowLeft' ? -1 : 1)
    if (to < 0 || to >= PARTY_SIZE) return
    pendingFocus.current = to
    move(index, to)
  }

  const onDragStart = (e: DragEvent<HTMLDivElement>, index: number) => {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData(DRAG_TYPE, String(index))
    e.dataTransfer.setData('text/plain', String(index + 1))
    setDragFrom(index)
  }
  const onDragOver = (e: DragEvent<HTMLDivElement>, index: number) => {
    if (dragFrom === null) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dropAt !== index) setDropAt(index)
  }
  const onDrop = (e: DragEvent<HTMLDivElement>, index: number) => {
    e.preventDefault()
    const raw = e.dataTransfer.getData(DRAG_TYPE)
    const from = raw === '' ? dragFrom : Number(raw)
    setDragFrom(null)
    setDropAt(null)
    if (from !== null && Number.isInteger(from)) move(from, index)
  }
  const onDragEnd = () => {
    setDragFrom(null)
    setDropAt(null)
  }

  const runImport = useCallback(
    async (rawUrl: string) => {
      setBusy(true)
      setError(null)
      setReport(null)
      const got = await fetchPaste(rawUrl, fetchImpl)
      if (!alive.current) return
      if (!got.ok) {
        setBusy(false)
        setError(got.reason)
        return
      }
      const { drafts, report } = toDrafts(parsePasteText(got.text), game)
      setBusy(false)
      setReport(report.length > 0 ? report : null)
      const count = drafts.filter((d) => d !== null).length
      if (count === 0) {
        setError('no-species')
        return
      }
      dispatch({ type: 'party-import', slots: drafts })
      announce(importedText(count))
    },
    [fetchImpl, game, dispatch, announce],
  )

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (busy) return
    const parsed = normalizePasteUrl(url)
    if (!parsed.ok) {
      setError('format')
      return
    }
    if (hasMembers) {
      setConfirm({ kind: 'import', rawUrl: parsed.rawUrl })
      return
    }
    void runImport(parsed.rawUrl)
  }

  const closeConfirm = useCallback(() => setConfirm(null), [])
  const cancelConfirm = () => {
    const anchor = confirm?.kind === 'clear' ? clearBtn.current : importBtn.current
    setConfirm(null)
    anchor?.focus()
  }
  const acceptConfirm = () => {
    if (confirm === null) return
    setConfirm(null)
    if (confirm.kind === 'import') {
      importBtn.current?.focus()
      void runImport(confirm.rawUrl)
    } else {
      dispatch({ type: 'party-clear-all' })
      setReport(null)
      slotRefs.current[0]?.focus()
    }
  }
  const confirmAnchor = useCallback(() => (confirm?.kind === 'clear' ? clearBtn.current : importBtn.current), [confirm])

  const errorId = `${uid}-error`
  const confirmId = `${uid}-confirm`
  const confirmTextId = `${uid}-confirm-text`
  const reportId = `${uid}-report`

  return (
    <div className="party-bar" data-testid="party-bar">
      <ol className="party-slots" aria-label="파티">
        {slots.map((slot) => (
          <PartySlot
            key={slot.index}
            slot={slot}
            dragging={dragFrom === slot.index}
            dropTarget={dropAt === slot.index && dragFrom !== null && dragFrom !== slot.index}
            buttonRef={(el) => {
              slotRefs.current[slot.index] = el
            }}
            onSelect={() => dispatch({ type: 'party-select', index: slot.index })}
            onClear={() => {
              dispatch({ type: 'party-clear-slot', index: slot.index })
              slotRefs.current[slot.index]?.focus()
            }}
            onKeyDown={(e) => onSlotKey(e, slot.index)}
            onDragStart={(e) => onDragStart(e, slot.index)}
            onDragOver={(e) => onDragOver(e, slot.index)}
            onDragLeave={() => {
              if (dropAt === slot.index) setDropAt(null)
            }}
            onDrop={(e) => onDrop(e, slot.index)}
            onDragEnd={onDragEnd}
          />
        ))}
      </ol>
      <span className="sr-only" role="status" aria-live="polite">
        {announced}
      </span>
      <form className="party-import" onSubmit={onSubmit} noValidate>
        <label className="sr-only" htmlFor={`${uid}-url`}>
          PokePaste 링크
        </label>
        <input
          id={`${uid}-url`}
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          placeholder="PokePaste 링크 (https://pokepast.es/…)"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value)
            if (error !== null) setError(null)
          }}
          aria-invalid={error === 'format' ? true : undefined}
          aria-describedby={error !== null ? errorId : undefined}
          data-testid="paste-url"
        />
        <button ref={importBtn} type="submit" className="primary" disabled={busy} aria-busy={busy || undefined} data-testid="paste-import">
          {busy ? '가져오는 중…' : '가져오기'}
        </button>
        <button ref={clearBtn} type="button" className="party-clear-all" disabled={!hasMembers || busy} onClick={() => setConfirm({ kind: 'clear' })} data-testid="party-clear-all">
          파티 비우기
        </button>
        {error !== null && (
          <p id={errorId} className="field-alert party-error" role="alert" data-testid="paste-error" data-reason={error}>
            {IMPORT_ERROR_TEXT[error]}
          </p>
        )}
      </form>
      {report !== null && (
        <section className="party-report" aria-labelledby={`${reportId}-h`} data-testid="paste-report">
          <div className="party-report-head">
            <h2 id={`${reportId}-h`}>가져오며 비우거나 건너뛴 항목</h2>
            <button type="button" onClick={() => setReport(null)} aria-label="안내 닫기">
              닫기
            </button>
          </div>
          <ul>
            {report.map((r) => (
              <li key={r.index}>
                <strong>
                  {r.index + 1}. {r.name}
                </strong>
                <ul>
                  {r.issues.map((issue, i) => (
                    <li key={i}>{issue}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      )}
      {confirm !== null && (
        <Popover id={confirmId} labelledBy={confirmTextId} getAnchor={confirmAnchor} onDismiss={closeConfirm} className="party-confirm">
          <p id={confirmTextId}>{confirm.kind === 'import' ? IMPORT_CONFIRM_TEXT : CLEAR_CONFIRM_TEXT}</p>
          <div className="party-confirm-actions">
            <button ref={confirmBtn} type="button" className={confirm.kind === 'import' ? 'primary' : 'danger'} onClick={acceptConfirm} data-testid="party-confirm-ok">
              {confirm.kind === 'import' ? '바꾸기' : '비우기'}
            </button>
            <button type="button" onClick={cancelConfirm} data-testid="party-confirm-cancel">
              취소
            </button>
          </div>
        </Popover>
      )}
    </div>
  )
}

interface SlotProps {
  slot: PartySlotView
  dragging: boolean
  dropTarget: boolean
  buttonRef: (el: HTMLButtonElement | null) => void
  onSelect: () => void
  onClear: () => void
  onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => void
  onDragStart: (e: DragEvent<HTMLDivElement>) => void
  onDragOver: (e: DragEvent<HTMLDivElement>) => void
  onDragLeave: () => void
  onDrop: (e: DragEvent<HTMLDivElement>) => void
  onDragEnd: () => void
}

function PartySlot({ slot, dragging, dropTarget, buttonRef, onSelect, onClear, onKeyDown, onDragStart, onDragOver, onDragLeave, onDrop, onDragEnd }: SlotProps) {
  const filled = slot.speciesLabel.trim() !== ''
  const label = slotLabel(slot)
  const cls = ['party-slot', slot.active && 'is-active', !filled && 'is-empty', dragging && 'is-dragging', dropTarget && 'is-drop-target'].filter(Boolean).join(' ')
  return (
    <li className={cls} data-testid="party-slot" data-index={slot.index} data-active={slot.active ? 'true' : 'false'} data-species-id={slot.speciesId ?? ''}>
      <div className="party-slot-frame" draggable={filled} onDragStart={onDragStart} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop} onDragEnd={onDragEnd}>
        <button
          ref={buttonRef}
          type="button"
          className="party-slot-btn"
          aria-label={label}
          title={filled ? label : `${label} — 눌러서 포켓몬 고르기`}
          aria-current={slot.active ? 'true' : undefined}
          aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight"
          onClick={onSelect}
          onKeyDown={onKeyDown}
        >
          {filled ? (
            <PokemonIcon speciesId={slot.speciesId ?? undefined} size={ICON_SIZE} className="party-mon" />
          ) : (
            <span className="party-slot-empty" aria-hidden="true">
              +
            </span>
          )}
          {filled && slot.itemId !== null && <ItemMark item={{ id: slot.itemId, name: slot.itemLabel, role: 'held' }} size={ITEM_SIZE} className="party-item" />}
        </button>
        {filled && (
          <button type="button" className="party-slot-clear" aria-label={`${slot.index + 1}번 칸 비우기`} title="칸 비우기" onClick={onClear} data-testid="party-slot-clear">
            ×
          </button>
        )}
      </div>
    </li>
  )
}
