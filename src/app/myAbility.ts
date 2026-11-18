import { CoreError, CoreInputError, validateSet, type PokemonSet } from '../core'
import type { Snapshot } from '../data/schema'

/** 내 계산 특성(메가면 메가 폼). 해석할 수 없으면 null */
export function abilityOf(game: Snapshot, set: PokemonSet): string | null {
  try {
    return validateSet(game, set).ability
  } catch (e) {
    if (e instanceof CoreError || e instanceof CoreInputError) return null
    throw e
  }
}
