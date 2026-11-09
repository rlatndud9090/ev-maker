import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { MAX_CUSTOM_MOVES, type CustomTarget } from '../../cards'
import type { Snapshot } from '../../data/schema'
import type { MetaView } from '../../meta'
import { namesOf } from '../../ui/names'
import { learnableMoves, searchIndexOf, searchNames } from '../../ui/search'
import { Combobox } from './Combobox'

interface Props {
  game: Snapshot
  view: MetaView
  customTargets: readonly CustomTarget[]
  onAdd: (rosterId: string, moves: readonly string[]) => void
  onCancel: () => void
}

/** 표시할 기술 칩 수(선택한 기술은 항상 보인다) */
const MOVE_CHIP_LIMIT = 40

/** 목록 밖 타겟 추가: 종 → 기술 1~4개 → [추가]. 기술은 자동으로 채우지 않는다. */
export function CustomTargetPanel({ game, view, customTargets, onAdd, onCancel }: Props) {
  const uid = useId()
  const names = namesOf(game)
  const [rosterId, setRosterId] = useState<string | null>(null)
  const [moves, setMoves] = useState<string[]>([])
  const [moveQuery, setMoveQuery] = useState('')
  const sectionRef = useRef<HTMLElement>(null)
  useEffect(() => {
    sectionRef.current?.querySelector('input')?.focus()
  }, [])

  const rosterIndex = useMemo(() => {
    const taken = new Set(customTargets.map((t) => t.rosterId))
    const ids = Object.keys(game.data.species).filter((id) => view.entry(id) === undefined && !taken.has(id))
    return searchIndexOf(game.data.species, ids)
  }, [game, view, customTargets])

  const learnable = useMemo(() => (rosterId === null ? [] : learnableMoves(game, rosterId)), [game, rosterId])
  const moveIndex = useMemo(() => searchIndexOf(game.data.moves, learnable), [game, learnable])
  const matched = searchNames(moveIndex, moveQuery, MOVE_CHIP_LIMIT)
  const shown = [...moves, ...matched.filter((m) => !moves.includes(m))]
  const full = moves.length >= MAX_CUSTOM_MOVES

  return (
    <section
      ref={sectionRef}
      className="custom-panel"
      role="region"
      aria-labelledby={`${uid}-h`}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !e.defaultPrevented) onCancel()
      }}
    >
      <h2 id={`${uid}-h`}>목록 밖 포켓몬 추가</h2>
      <p className="hint">메타 목록에 없는 포켓몬을 사용자 지정 가정으로 추가합니다. 기술은 직접 1~{MAX_CUSTOM_MOVES}개 고릅니다.</p>
      <Combobox
        label="추가할 포켓몬"
        index={rosterIndex}
        value={rosterId === null ? '' : names.species.label(rosterId)}
        optionsOnly
        placeholder="이름 검색"
        labelOf={names.species.label}
        onCommit={(_text, id) => {
          if (id === undefined || id === rosterId) return
          setRosterId(id)
          setMoves([])
          setMoveQuery('')
        }}
      />
      {rosterId !== null && (
        <div role="group" aria-labelledby={`${uid}-moves`} className="move-picker">
          <p id={`${uid}-moves`} className="group-title">
            기술 <span className="hint">({moves.length}/{MAX_CUSTOM_MOVES})</span>
          </p>
          <label className="move-search">
            기술 검색
            <input role="combobox" aria-expanded={shown.length > 0} aria-controls={`${uid}-chips`} autoComplete="off" value={moveQuery} onChange={(e) => setMoveQuery(e.target.value)} placeholder="이름 검색" />
          </label>
          <ul id={`${uid}-chips`} className="move-chips">
            {shown.map((m) => {
              const checked = moves.includes(m)
              return (
                <li key={m}>
                  <label className={checked ? 'chip-check on' : 'chip-check'}>
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={!checked && full}
                      onChange={(e) => setMoves((cur) => (e.target.checked ? [...cur, m] : cur.filter((x) => x !== m)))}
                    />
                    {names.moves.label(m)}
                  </label>
                </li>
              )
            })}
          </ul>
          {shown.length === 0 && <p className="hint">일치하는 기술이 없습니다.</p>}
        </div>
      )}
      <div className="panel-actions">
        <button type="button" onClick={onCancel}>
          취소
        </button>
        <button type="button" className="primary" disabled={rosterId === null || moves.length === 0} onClick={() => rosterId !== null && onAdd(rosterId, moves)}>
          추가
        </button>
      </div>
    </section>
  )
}
