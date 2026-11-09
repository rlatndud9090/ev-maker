import { useId, useState } from 'react'
import type { NoChangeItem, NoChangeSummary as Summary } from '../../cards'
import type { Snapshot } from '../../data/schema'
import { namesOf } from '../../ui/names'
import { CARD_CATEGORY_LABEL, categorySymbol, categoryTone, fixedText, noChangeTitle } from '../../ui/format'
import { basisText, rowTitle } from './text'

const KIND_NOTE: Record<NoChangeItem['kind'], string> = { row: '전 칸 같음', 'extreme-filter': '극단 필터', 'sp-independent': '내 SP 무관' }

interface Props {
  game: Snapshot
  summary: Summary
  /** 3단계 확인 전이면 true */
  confirming: boolean
}

export function NoChangeSummary({ game, summary, confirming }: Props) {
  const uid = useId()
  const [open, setOpen] = useState(false)
  const names = namesOf(game)
  return (
    <section className="no-change" data-testid="no-change-summary" data-confirming={confirming ? 'true' : 'false'}>
      <button type="button" aria-expanded={open} aria-controls={`${uid}-list`} onClick={() => setOpen((o) => !o)}>
        {noChangeTitle(summary.rows, summary.cards)}
        {confirming && <span className="hint"> · 확인 중</span>}
      </button>
      <ul id={`${uid}-list`} className="no-change-list" hidden={!open}>
        {open &&
          summary.items.map((it, i) => (
            <li key={`${it.cardId}:${i}`}>
              <span className="nc-name">{names.species.label(it.opponent.id)}</span>
              {it.category !== null && <span className="cat">{CARD_CATEGORY_LABEL[it.category]}</span>}
              <span>{rowTitle(game, it)}</span>
              {it.basis && <span className="hint">{basisText(game, it.basis)}</span>}
              <span className="hint">{KIND_NOTE[it.kind]}</span>
              <span>
                <span className={`tone-text tone-${categoryTone(it.fixed)}`} aria-hidden="true">
                  {categorySymbol(it.fixed)}
                </span>{' '}
                {fixedText(it.fixed)}
              </span>
            </li>
          ))}
      </ul>
    </section>
  )
}
