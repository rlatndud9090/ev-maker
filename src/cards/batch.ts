// 한 탭을 동기로 끝까지 계산한다(테스트·비교 기준용). 단계 순서는 실행기와 같다: 1 → 2 → 3 → 4.
import { assembleTab } from './assemble'
import { planTab } from './plan'
import { computeRowTask } from './rowTask'
import { nextStage, pendingTasks, taskKey } from './schedule'
import type { CardInput, JudgementCache, RowTaskResult, Tab, TabView } from './types'

/** selections = 사용자 기술 선택(상대 키 opponentKey → 항목 키) */
export function buildTabView(input: CardInput, tab: Tab, cache?: JudgementCache, selections: ReadonlyMap<string, string> = new Map()): TabView {
  const plan = planTab(input, tab)
  const results = new Map<string, RowTaskResult>()
  for (;;) {
    const stage = nextStage(pendingTasks(plan, results, selections))
    if (stage.length === 0) break
    for (const task of stage) results.set(taskKey(task), computeRowTask(plan, task, cache))
  }
  return assembleTab(plan, results, plan.mySp, selections)
}
