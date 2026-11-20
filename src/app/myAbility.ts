import { CoreError, CoreInputError, validateSet, type EvalOptions, type PokemonSet } from '../core'
import type { Snapshot } from '../data/schema'

/** 내 계산 특성(메가면 메가 폼). 해석할 수 없으면 null. 고정 중 계획 세트는 합계 검사를 끈 options로 본다 */
export function abilityOf(game: Snapshot, set: PokemonSet, options?: EvalOptions): string | null {
  try {
    return validateSet(game, set, options).ability
  } catch (e) {
    if (e instanceof CoreError || e instanceof CoreInputError) return null
    throw e
  }
}
