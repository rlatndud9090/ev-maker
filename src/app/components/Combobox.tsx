import { useId, useState, type KeyboardEvent } from 'react'
import { searchNames, type SearchIndex } from '../../ui/search'

interface Props {
  /** 접근명이자 보이는 라벨 */
  label: string
  index: SearchIndex
  /** 확정된 입력 문자열 */
  value: string
  /** 후보를 고르면 id와 함께, 자유 입력을 확정(Enter·포커스 이탈)하면 id 없이 */
  onCommit: (text: string, id?: string) => void
  labelOf: (id: string) => string
  placeholder?: string
  limit?: number
  /** 확정 뒤 입력을 비운다(목록에 하나씩 더하는 검색) */
  clearOnCommit?: boolean
  /** 자유 입력 확정을 막는다(후보만 고를 수 있음) */
  optionsOnly?: boolean
  hideLabel?: boolean
  className?: string
  disabled?: boolean
  /** 입력의 aria-describedby(접근명은 label 그대로) */
  describedBy?: string
}

/** 한국어 부분 일치 후보가 붙은 입력. IME 조합 중 Enter는 확정으로 보지 않는다. */
export function Combobox(p: Props) {
  const uid = useId()
  const listId = `${uid}-list`
  const [editing, setEditing] = useState<string | null>(null)
  const [active, setActive] = useState(-1)
  const open = editing !== null
  const text = editing ?? p.value
  const ids = open ? searchNames(p.index, editing === p.value ? '' : editing, p.limit ?? 12) : []

  const finish = () => {
    setEditing(null)
    setActive(-1)
  }
  const pick = (id: string) => {
    p.onCommit(p.labelOf(id), id)
    finish()
  }
  const commitText = () => {
    if (editing !== null && editing !== p.value && !p.optionsOnly) p.onCommit(editing)
    finish()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!open) {
        setEditing(p.value)
        return
      }
      const n = ids.length
      if (n === 0) return
      setActive((a) => (e.key === 'ArrowDown' ? (a + 1) % n : (a - 1 + n) % n))
    } else if (e.key === 'Enter') {
      // Safari는 조합을 끝내는 Enter를 compositionend 뒤 keyCode 229로 보낸다.
      if (e.nativeEvent.isComposing || e.keyCode === 229) return
      e.preventDefault()
      if (active >= 0 && active < ids.length) pick(ids[active])
      else if (p.optionsOnly && ids.length > 0 && editing !== '') pick(ids[0])
      else commitText()
    } else if (e.key === 'Escape') {
      if (open) {
        e.preventDefault()
        finish()
      }
    }
  }

  return (
    <div className={`combo ${p.className ?? ''}`}>
      <label className={p.hideLabel ? 'combo-label sr-only-label' : 'combo-label'}>
        <span className={p.hideLabel ? 'sr-only' : undefined}>{p.label}</span>
        <input
          role="combobox"
          aria-expanded={open && ids.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && active >= 0 && active < ids.length ? `${uid}-o${active}` : undefined}
          autoComplete="off"
          value={p.clearOnCommit && !open ? '' : text}
          placeholder={p.placeholder}
          disabled={p.disabled}
          aria-describedby={p.describedBy}
          onFocus={(e) => {
            setEditing(p.clearOnCommit ? '' : p.value)
            e.currentTarget.select()
          }}
          onChange={(e) => {
            setEditing(e.target.value)
            setActive(-1)
          }}
          onBlur={commitText}
          onKeyDown={onKeyDown}
        />
      </label>
      <ul id={listId} role="listbox" aria-label={`${p.label} 후보`} className="combo-list" hidden={!open || ids.length === 0}>
        {ids.map((id, i) => (
          <li
            key={id}
            id={`${uid}-o${i}`}
            role="option"
            aria-selected={i === active}
            className={i === active ? 'active' : undefined}
            onMouseDown={(e) => {
              e.preventDefault()
              pick(id)
            }}
          >
            {p.labelOf(id)}
          </li>
        ))}
      </ul>
    </div>
  )
}
