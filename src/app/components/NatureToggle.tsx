import type { NatureSign } from '../../cards'

interface Props {
  value: NatureSign
  onChange: (next: NatureSign) => void
  /** 버튼 data-testid 접두사(`${testIdPrefix}-plus`, `${testIdPrefix}-minus`) */
  testIdPrefix: string
}

/** 스피드 성격 보정 ▲▼ 토글: 보정 없음 ↔ 상승 / 보정 없음 ↔ 하락. 눌림 상태는 aria-pressed */
export function NatureToggle({ value, onChange, testIdPrefix }: Props) {
  return (
    <span className="nat-btns" role="group" aria-label="스피드 성격 보정">
      <button
        type="button"
        className="nat-btn plus"
        aria-pressed={value === 'plus'}
        aria-label="스피드 성격 상승"
        data-testid={`${testIdPrefix}-plus`}
        onClick={() => onChange(value === 'plus' ? 'neutral' : 'plus')}
      >
        ▲
      </button>
      <button
        type="button"
        className="nat-btn minus"
        aria-pressed={value === 'minus'}
        aria-label="스피드 성격 하락"
        data-testid={`${testIdPrefix}-minus`}
        onClick={() => onChange(value === 'minus' ? 'neutral' : 'minus')}
      >
        ▼
      </button>
    </span>
  )
}
