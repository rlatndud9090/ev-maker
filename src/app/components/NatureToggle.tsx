import type { NatureSign } from '../../cards'

interface Props {
  value: NatureSign
  onChange: (next: NatureSign) => void
  /** 버튼 data-testid 접두사(`${testIdPrefix}-plus`, `${testIdPrefix}-minus`) */
  testIdPrefix: string
  /** 접근 이름의 능력치 이름(기본 스피드) */
  statLabel?: string
}

/** 능력치 성격 보정 ▲▼ 토글: 보정 없음 ↔ 상승 / 보정 없음 ↔ 하락. 눌림 상태는 aria-pressed */
export function NatureToggle({ value, onChange, testIdPrefix, statLabel = '스피드' }: Props) {
  return (
    <span className="nat-btns" role="group" aria-label={`${statLabel} 성격 보정`}>
      <button
        type="button"
        className="nat-btn plus"
        aria-pressed={value === 'plus'}
        aria-label={`${statLabel} 성격 상승`}
        data-testid={`${testIdPrefix}-plus`}
        onClick={() => onChange(value === 'plus' ? 'neutral' : 'plus')}
      >
        ▲
      </button>
      <button
        type="button"
        className="nat-btn minus"
        aria-pressed={value === 'minus'}
        aria-label={`${statLabel} 성격 하락`}
        data-testid={`${testIdPrefix}-minus`}
        onClick={() => onChange(value === 'minus' ? 'neutral' : 'minus')}
      >
        ▼
      </button>
    </span>
  )
}
