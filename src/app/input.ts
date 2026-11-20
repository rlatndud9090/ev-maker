// 화면 상태 → 카드 모델 입력. 내 세트 초안은 보정 없이 그대로 넘겨 코어가 판단하게 한다.
import type { CardInput, LockResolution } from '../cards'
import type { Snapshot } from '../data/schema'
import type { MetaView } from '../meta'
import { toPokemonSet } from '../ui/setDraft'
import type { LockRun } from './executor'
import type { AppState } from './state'

/** 실행기 고정 입력. 고정이 없으면 undefined(고정 없는 경로). speed = 스피드 고정 해석 */
export function toLockRun(state: Pick<AppState, 'locks' | 'lockBase'>, speed: ReadonlyMap<number, LockResolution>): LockRun | undefined {
  return state.locks.length === 0 ? undefined : { locks: state.locks, speed, baseChoice: state.lockBase }
}

export function toCardInput(state: AppState, game: Snapshot, view: MetaView): CardInput {
  return {
    game,
    view,
    mySet: toPokemonSet(game, state.draft).set,
    rollSteps: state.rollSteps,
    criteria: state.criteria,
    filters: state.filters,
    customTargets: state.customTargets,
    addedBundles: state.addedBundles,
    addedMoves: state.addedMoves,
  }
}
