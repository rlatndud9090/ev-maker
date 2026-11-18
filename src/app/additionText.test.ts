import { describe, expect, it } from 'vitest'
import type { UnavailableReason } from '../cards'
import { OBSERVED_STATE_TEXT, UNAVAILABLE_TEXT, additionMessage } from './additionText'

const REASONS: readonly UnavailableReason[] = ['not-found', 'my-set-error', 'no-my-attack-moves', 'no-opponent-moves', 'no-key-stats', 'speed-unsupported']

describe('additionMessage', () => {
  it('ok는 빈 문자열', () => {
    expect(additionMessage({ kind: 'ok' }, 'S32↑', 32)).toBe('')
  })

  it('duplicate는 입력 배분 표기를 붙인다', () => {
    expect(additionMessage({ kind: 'duplicate' }, 'S32↑', 32)).toBe('이미 존재합니다 — S32↑')
    expect(additionMessage({ kind: 'duplicate' }, 'H2 B32', 32)).toBe('이미 존재합니다 — H2 B32')
  })

  it('invalid는 spMax를 넣는다', () => {
    expect(additionMessage({ kind: 'invalid' }, '', 32)).toBe('SP는 0~32 정수로 입력해 주세요.')
    expect(additionMessage({ kind: 'invalid' }, 'S1', 20)).toBe('SP는 0~20 정수로 입력해 주세요.')
  })

  it('unavailable은 이유 문구를 붙인다', () => {
    expect(additionMessage({ kind: 'unavailable', reason: 'no-my-attack-moves' }, 'S1', 32)).toBe('이 탭에서 더할 배분이 없습니다: 내 공격기가 없습니다')
    expect(additionMessage({ kind: 'unavailable', reason: 'speed-unsupported' }, '', 32)).toBe('이 탭에서 더할 배분이 없습니다: 스피드를 계산할 수 없는 세트입니다')
    for (const reason of REASONS) {
      expect(UNAVAILABLE_TEXT[reason].length).toBeGreaterThan(0)
      expect(additionMessage({ kind: 'unavailable', reason }, '', 32)).toBe(`이 탭에서 더할 배분이 없습니다: ${UNAVAILABLE_TEXT[reason]}`)
    }
  })

  it('관측 줄 상태 문구', () => {
    expect(OBSERVED_STATE_TEXT).toEqual({ shown: '이미 존재합니다', boosted: '무보정 배분만 추가할 수 있습니다' })
  })
})
