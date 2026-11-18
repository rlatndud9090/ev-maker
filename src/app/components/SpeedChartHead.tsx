import type { Dispatch, Ref } from 'react'
import { SPEED_CONDITION_KINDS, type SpeedConditionFilters } from '../../cards'
import type { AppAction } from '../state'
import { CONDITION_FILTER_LABEL } from './speedText'


interface Props {
  filters: SpeedConditionFilters
  myTailwind: boolean
  dispatch: Dispatch<AppAction>
  headRef?: Ref<HTMLDivElement>
}

/** 차트 머리: 조건 배지 필터 칩 4개 + "내 순풍" 칩. 프레임 밖이라 스크롤과 무관하게 보인다 */
export function SpeedChartHead({ filters, myTailwind, dispatch, headRef }: Props) {
  return (
    <div className="speed-head" ref={headRef} data-testid="speed-head">
      <div className="speed-chips" role="group" aria-labelledby="speed-filter-label">
        <span id="speed-filter-label" className="speed-chips-label">
          조건 배지
        </span>
        {SPEED_CONDITION_KINDS.map((k) => (
          <button
            key={k}
            type="button"
            className="speed-chip"
            aria-pressed={filters[k]}
            data-filter={k}
            onClick={() => dispatch({ type: 'set-speed-filter', kind: k, on: !filters[k] })}
          >
            {CONDITION_FILTER_LABEL[k]}
          </button>
        ))}
      </div>
      <span className="speed-chip-sep" aria-hidden="true" />
      <button
        type="button"
        className="speed-chip"
        aria-pressed={myTailwind}
        data-filter="my-tailwind"
        onClick={() => dispatch({ type: 'set-my-tailwind', on: !myTailwind })}
      >
        내 순풍
      </button>
    </div>
  )
}
