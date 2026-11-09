// 한 탭을 동기로 끝까지 계산한다(테스트·비교 기준용). 단계 순서는 실행기와 같다: 1 → 2 → 3.
import { assembleTab } from './assemble'
import { planTab } from './plan'
import { computeRowTask } from './rowTask'
import { pendingTasks, taskKey } from './schedule'
import type { CardInput, JudgementCache, RowTaskResult, Tab, TabView } from './types'

export function buildTabView(input: CardInput, tab: Tab, cache?: JudgementCache): TabView {
  const plan = planTab(input, tab)
  const results = new Map<string, RowTaskResult>()
  for (;;) {
    const p = pendingTasks(plan, results)
    const stage = p.stage1.length > 0 ? p.stage1 : p.stage2.length > 0 ? p.stage2 : p.stage3
    if (stage.length === 0) break
    for (const task of stage) results.set(taskKey(task), computeRowTask(plan, task, cache))
  }
  return assembleTab(plan, results)
}
