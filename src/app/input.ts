// 화면 상태 → 카드 모델 입력. 내 세트 초안은 보정 없이 그대로 넘겨 코어가 판단하게 한다.
import type { CardInput } from '../cards'
import type { Snapshot } from '../data/schema'
import type { MetaView } from '../meta'
import { toPokemonSet } from '../ui/setDraft'
import type { AppState } from './state'

export function toCardInput(state: AppState, game: Snapshot, view: MetaView): CardInput {
  return {
    game,
    view,
    mySet: toPokemonSet(game, state.draft).set,
    conditions: state.conditions,
    criteria: state.criteria,
    filters: state.filters,
    customTargets: state.customTargets,
  }
}
