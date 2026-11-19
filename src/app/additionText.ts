// 배분 추가 판정 문구. 패널·스피드 배지 상세·카드 메뉴 세 진입점이 같은 문구를 쓴다.
import type { AdditionVerdict, UnavailableReason } from '../cards'

export const UNAVAILABLE_TEXT: Readonly<Record<UnavailableReason, string>> = {
  'not-found': '이 포켓몬을 찾을 수 없습니다',
  'my-set-error': '내 세트를 확인해 주세요',
  'no-my-attack-moves': '내 공격기가 없습니다',
  'no-opponent-moves': '이 포켓몬의 공격기가 없습니다',
  'no-key-stats': '판정에 관여하는 능력치가 없습니다',
  'speed-unsupported': '스피드를 계산할 수 없는 세트입니다',
}

export const OBSERVED_STATE_TEXT = { shown: '이미 존재합니다' } as const

/** label = 입력 배분 표기(스피드 bundleLabel, 공·방 bundleText). ok면 빈 문자열 */
export function additionMessage(v: AdditionVerdict, label: string, spMax: number): string {
  switch (v.kind) {
    case 'ok':
      return ''
    case 'duplicate':
      return `이미 존재합니다 — ${label}`
    case 'invalid':
      return `SP는 0~${spMax} 정수로 입력해 주세요.`
    case 'unavailable':
      return `이 탭에서 더할 배분이 없습니다: ${UNAVAILABLE_TEXT[v.reason]}`
  }
}
