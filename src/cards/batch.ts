// 한 탭을 동기로 끝까지 계산한다(테스트·비교 기준용). 단계 순서는 실행기와 같다: 1 → 2 → 3 → 4.
import { assembleTab, type AssembleOptions } from './assemble'
import { deriveLocks, type CutLock, type LockDerivation, type LockResolution } from './lock'
import { laneInput, laneResolution, laneTasks, lockedInput } from './lockLane'
import { findLockTarget } from './lockTarget'
import { planTab } from './plan'
import { computeRowTask } from './rowTask'
import { nextStage, pendingTasks, taskKey } from './schedule'
import type { CardInput, DamageTab, JudgementCache, RowTaskResult, TabView } from './types'

/** selections = 사용자 기술 선택(상대 키 opponentKey → 항목 키), options = 조립 옵션(실행기는 lockControls를 켠다) */
export function buildTabView(
  input: CardInput,
  tab: DamageTab,
  cache?: JudgementCache,
  selections: ReadonlyMap<string, string> = new Map(),
  options: AssembleOptions = {},
): TabView {
  const plan = planTab(input, tab)
  const results = new Map<string, RowTaskResult>()
  for (;;) {
    const stage = nextStage(pendingTasks(plan, results, selections))
    if (stage.length === 0) break
    for (const task of stage) results.set(taskKey(task), computeRowTask(plan, task, cache))
  }
  return assembleTab(plan, results, plan.mySp, selections, options)
}

/** 공격·방어 고정 하나를 레인(미니 계획 → 레인 작업 → 해석)으로 동기 해석한다. 코어 밖 예외는 unreachable(reason)로 흡수한다 */
export function resolveLaneLock(input: CardInput, lock: CutLock, cache?: JudgementCache): LockResolution {
  if (lock.kind === 'speed') throw new Error('스피드 고정은 고정 레인이 없다')
  try {
    const plan = planTab(laneInput(input, lock), lock.kind)
    const target = plan.status.kind === 'ok' ? findLockTarget(plan, lock) : null
    const results = new Map<string, RowTaskResult>()
    if (target !== null) for (const task of laneTasks(plan, lock, target)) results.set(taskKey(task), computeRowTask(plan, task, cache))
    return laneResolution(plan, lock, target, results)
  } catch (e) {
    return { kind: 'unreachable', reason: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * 고정이 있는 탭 뷰의 동기 기준 구현: 공격·방어 고정 레인 해석 → speedResolutions와 합쳐 deriveLocks → 기준 갈래 계획 입력 → buildTabView.
 * locks가 비면 buildTabView(input)와 같다.
 */
export function buildLockedTabView(
  input: CardInput,
  tab: DamageTab,
  locks: readonly CutLock[],
  speedResolutions: ReadonlyMap<number, LockResolution>,
  baseChoice: string | null,
  cache?: JudgementCache,
  selections: ReadonlyMap<string, string> = new Map(),
): { view: TabView; derivation: LockDerivation; resolutions: ReadonlyMap<number, LockResolution> } {
  const resolutions = new Map<number, LockResolution>()
  for (const lock of locks) {
    if (lock.kind === 'speed') {
      const r = speedResolutions.get(lock.seq)
      if (r !== undefined) resolutions.set(lock.seq, r)
    } else resolutions.set(lock.seq, resolveLaneLock(input, lock, cache))
  }
  const derivation = deriveLocks({ game: input.game, mySet: input.mySet, locks, resolutions, baseChoice })
  return { view: buildTabView(lockedInput(input, derivation), tab, cache, selections), derivation, resolutions }
}
