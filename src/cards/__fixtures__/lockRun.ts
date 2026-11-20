// 테스트 전용: 고정 탭을 레인 해석 → 파생 → 기준 갈래 계획 → 행 작업 → 카드 수요(고정 후보·조정 모델 대기 작업)까지 동기로 끝낸다. 앱 코드에서 import하지 않는다.
import { assembleTab, createTabAssembler } from '../assemble'
import { resolveLaneLock } from '../batch'
import { deriveLocks, type CutLock, type LockDerivation, type LockResolution } from '../lock'
import { lockedInput } from '../lockLane'
import { planTab } from '../plan'
import { computeRowTask } from '../rowTask'
import { nextStage, pendingTasks, taskKey } from '../schedule'
import type { CardInput, DamageTab, JudgementCache, LockCandidate, RowLockView, RowTask, RowTaskResult, TabPlan, TabView } from '../types'

export interface LockRun {
  plan: TabPlan
  results: Map<string, RowTaskResult>
  view: TabView
  derivation: LockDerivation
  resolutions: ReadonlyMap<number, LockResolution>
}

export interface LockRunOptions {
  /** 스피드 고정 해석. resolved가 있으면 모든 고정에 그 해석을 쓰고 레인을 돌리지 않는다 */
  speed?: ReadonlyMap<number, LockResolution>
  resolved?: ReadonlyMap<number, LockResolution>
  baseChoice?: string | null
  selections?: ReadonlyMap<string, string>
  /** 모든 카드의 고정 후보·조정 모델 대기 작업(TabAssembler.candidates)을 돌린다 */
  demand?: boolean
  cache?: JudgementCache
}

const STAGES = ['stage1', 'stage2', 'stage3', 'stage4', 'stage5'] as const

export function runLocked(input: CardInput, tab: DamageTab, locks: readonly CutLock[], o: LockRunOptions = {}): LockRun {
  const selections = o.selections ?? new Map<string, string>()
  const resolutions = new Map<number, LockResolution>()
  for (const lock of locks) {
    const given = o.resolved?.get(lock.seq)
    if (given !== undefined) resolutions.set(lock.seq, given)
    else if (o.resolved !== undefined) continue
    else if (lock.kind !== 'speed') resolutions.set(lock.seq, resolveLaneLock(input, lock, o.cache))
    else {
      const r = o.speed?.get(lock.seq)
      if (r !== undefined) resolutions.set(lock.seq, r)
    }
  }
  const derivation = deriveLocks({ game: input.game, mySet: input.mySet, locks, resolutions, baseChoice: o.baseChoice ?? null })
  const plan = planTab(lockedInput(input, derivation), tab)
  const results = new Map<string, RowTaskResult>()
  const run = (tasks: readonly RowTask[]) => {
    for (const t of tasks) if (!results.has(taskKey(t))) results.set(taskKey(t), computeRowTask(plan, t, o.cache))
  }
  for (;;) {
    for (;;) {
      const stage = nextStage(pendingTasks(plan, results, selections))
      if (stage.length === 0) break
      run(stage)
    }
    if (o.demand !== true) break
    const demand = createTabAssembler(plan, selections, { lockControls: true, adjust: true }).candidates(results, new Set(plan.cards.map((c) => c.id)))
    const fresh = STAGES.flatMap((k) => demand[k])
    if (fresh.length === 0) break
    run(fresh)
  }
  return { plan, results, view: assembleTab(plan, results, plan.mySp, selections, { lockControls: o.demand === true, adjust: o.demand === true }), derivation, resolutions }
}

/** 고정 없는 기존 경로(buildTabView와 같은 단계 순서)의 계획·결과·뷰 */
export function runPlain(input: CardInput, tab: DamageTab, selections: ReadonlyMap<string, string> = new Map(), cache?: JudgementCache): { plan: TabPlan; results: Map<string, RowTaskResult>; view: TabView } {
  const plan = planTab(input, tab)
  const results = new Map<string, RowTaskResult>()
  for (;;) {
    const stage = nextStage(pendingTasks(plan, results, selections))
    if (stage.length === 0) break
    for (const t of stage) results.set(taskKey(t), computeRowTask(plan, t, cache))
  }
  return { plan, results, view: assembleTab(plan, results, plan.mySp, selections) }
}

/** 조작의 단계 중 해석이 끝나 닿는(ok) 첫 후보 */
export function readyStage(control: RowLockView['control']): Extract<LockCandidate, { kind: 'ready' }> | undefined {
  if (control?.kind !== 'lockable') return undefined
  for (const { candidate } of control.stages) if (candidate.kind === 'ready' && candidate.resolution.kind === 'ok') return candidate
  return undefined
}
