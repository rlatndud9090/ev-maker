// 선공기 행 조건(사용자 피드백 2026-11-12). 판정은 코어 타입표·특성 타입 변화 규칙만 조회한다.
import { attackEffectiveness, attackMoveType } from '../core'
import type { Snapshot } from '../data/schema'

/** 선공기를 쓰는 쪽: 계산에 쓰는 폼(메가면 메가 폼) 타입과 특성 */
export interface PriorityUser {
  types: readonly string[]
  ability: string
}

/**
 * 가장 센 기술이 아닌 선공기(우선도 > 0)를 별도 행으로 남길 자격: 대상 약점(상성 > 1)이거나,
 * 사용자 자속(기술 타입이 사용자 타입 중 하나)이면서 반감·무효가 아님(상성 ≥ 1).
 * 기술 타입은 코어가 대미지 계산에서 바꾸는 타입(스킨 특성·촉촉보이스·노말스킨, attackMoveType), 상성은 배짱·심안의 고스트 등배까지 넣는다
 * (attackEffectiveness). 도구·날씨·테라·방어측 특성에 따른 변화는 넣지 않는다.
 * 스냅샷에 없는 기술·선공기가 아닌 기술·엔진 타입표에 없는 타입(CoreError)은 false(그 카드의 선공기 행만 없고 계획은 계속한다).
 */
export function keepsPriorityRow(game: Snapshot, moveId: string, user: PriorityUser, targetTypes: readonly string[]): boolean {
  if (!Object.prototype.hasOwnProperty.call(game.data.moves, moveId)) return false
  const move = game.data.moves[moveId]
  if (move.priority <= 0) return false
  try {
    const type = attackMoveType(moveId, move.type, user.ability)
    const eff = attackEffectiveness(type, targetTypes, user.ability)
    if (eff > 1) return true
    return user.types.includes(type) && eff >= 1
  } catch {
    return false
  }
}
