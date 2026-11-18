// 추가 뒤 새 배분으로 포커스·스크롤을 옮기는 요청. 받는 쪽이 처리를 끝내거나 대상을 찾지 못하면 onRevealed로 비운다.
import type { DamageTab, NatureSign, TargetSource } from '../cards'

export interface SpeedRevealRequest {
  tab: 'speed'
  source: TargetSource
  opponentId: string
  sp: number
  nature: NatureSign
}

export interface DamageRevealRequest {
  tab: DamageTab
  groupKey: string
  cardId: string
}

export type RevealRequest = SpeedRevealRequest | DamageRevealRequest

/** nonce = 같은 대상을 다시 요청해도 새 요청으로 보이게 하는 순번 */
export type SpeedReveal = SpeedRevealRequest & { nonce: number }
export type DamageReveal = DamageRevealRequest & { nonce: number }
export type Reveal = SpeedReveal | DamageReveal
