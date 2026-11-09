import { useState } from 'react'

interface Props {
  label: string
  value: number
  /** 화면 문자열 ↔ 값(기본: 그대로 숫자) */
  toText?: (v: number) => string
  fromText?: (text: string) => number
  /** 입력할 때마다 해석한 값(NaN 포함). 범위 검사는 받는 쪽(리듀서)이 한다 */
  onValue: (v: number) => void
  min?: number
  max?: number
  step?: number
}

const parse = (text: string): number => (text.trim() === '' ? NaN : Number(text))
const show = (v: number): string => (Number.isFinite(v) ? String(v) : '')

/** 입력 중 문자열은 지역 상태로 두고, 포커스를 잃으면 확정 값 표시로 돌아간다. */
export function NumberField({ label, value, toText = show, fromText = parse, onValue, min, max, step }: Props) {
  const [editing, setEditing] = useState<string | null>(null)
  return (
    <label className="num-field">
      {label}
      <input
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        step={step}
        value={editing ?? toText(value)}
        onChange={(e) => {
          setEditing(e.target.value)
          onValue(fromText(e.target.value))
        }}
        onBlur={() => setEditing(null)}
      />
    </label>
  )
}
