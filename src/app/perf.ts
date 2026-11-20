// 브라우저 성능 측정 훅(window.__perf). 진입(제품·dev)과 무관하게 설치되고 e2e가 호출한다. 코어 공개 API를 그대로 부른다.
// 제품 반응성은 e2e/product-perf.spec.ts가 페이지 계측으로 잰다. 여기에는 스피드 차트가 남기는 표식 이름만 둔다.
import type { Snapshot, StatTable } from '../data/schema'
import { calcDamage, sweepDamage, type PokemonSet } from '../core'
import { loadSnapshot } from '../data/loader'
import { assertMetaSnapshot } from '../data/meta-guard'
import type { MetaSnapshot } from '../data/meta-schema'
import { createMetaView, topAssumptions } from '../meta'
import {
  DEFAULT_CRITERIA,
  DEFAULT_ROLL_STEPS,
  computeRowTask,
  createTabAssembler,
  findLockTarget,
  laneInput,
  laneTasks,
  nextStage,
  pendingTasks,
  planTab,
  taskCardId,
  taskKey,
  type CardInput,
  type DamageTab,
  type RowTaskResult,
} from '../cards'
import { toPokemonSet } from '../ui/setDraft'
import { EXAMPLE_DRAFT } from './example'

const ZERO: StatTable = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }

/** 스피드 차트 표식(performance.mark, detail.generation). 첫 표시 = 커밋 직후·그리기 전, 완료 = 그 다음 프레임 */
export const SPEED_CHART_FIRST_MARK = 'speed-chart:first'
export const SPEED_CHART_COMPLETE_MARK = 'speed-chart:complete'

export function markSpeedChart(name: typeof SPEED_CHART_FIRST_MARK | typeof SPEED_CHART_COMPLETE_MARK, generation: number): void {
  if (typeof performance === 'undefined' || typeof performance.mark !== 'function') return
  performance.mark(name, { detail: { generation } })
}

export interface PerfStats {
  median: number
  min: number
  max: number
  runs: number
}

export interface PerfHook {
  /** 대도각참 기습 → 메가마폭시 공격 SP 33칸 sweepDamage */
  sweep(runs?: number, warmup?: number): Promise<PerfStats>
  /** 고집 맘모꾸리 지진 → 상대 300세트 calcDamage */
  batch(runs?: number, warmup?: number): Promise<PerfStats>
  /** m-c 2026-10 Bo1 메타 본문 JSON.parse → 검사 → 뷰 → 상위 30 대표 가정 */
  metaLoad(runs?: number, warmup?: number): Promise<PerfStats>
  /** 예시 세트(moves = 기술 칸 한국어 이름, 없으면 예시 그대로)의 그 탭(기본 공격) (상대, 기술) 행·쌍을 고정할 때 고정 레인(미니 계획 + 레인 작업, 캐시 없음)의 작업 수·판정 수·소요 */
  lane(opponentId: string, moveId: string, moves?: string[], tab?: DamageTab): Promise<LaneStats>
}

export interface LaneStats {
  tasks: number
  /** 레인 작업 결과 칸 수(공격 갈래 칸 하나 = 판정 하나, 방어 계단은 H 칸 수: 한 칸에 판정 여러 번일 수 있다) */
  judgements: number
  ms: number
}

declare global {
  interface Window {
    __perf?: PerfHook
  }
}

function measure(fn: () => void, runs: number, warmup: number): PerfStats {
  for (let i = 0; i < warmup; i++) fn()
  const samples: number[] = []
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now()
    fn()
    samples.push(performance.now() - t0)
  }
  samples.sort((a, b) => a - b)
  const mid = samples.length >> 1
  const median = samples.length % 2 ? samples[mid] : (samples[mid - 1] + samples[mid]) / 2
  return { median, min: samples[0], max: samples[samples.length - 1], runs }
}

const set = (s: Snapshot, p: Omit<PokemonSet, 'regulation' | 'sp'> & { sp?: Partial<StatTable> }): PokemonSet => ({
  ...p,
  regulation: s.manifest.regulation.id,
  sp: { ...ZERO, ...p.sp },
})

function batchOpponents(s: Snapshot, count: number): PokemonSet[] {
  const unsupported = s.manifest.engineUnsupported
  const pool = Object.values(s.data.species)
    // 탈(Disguise)은 코어가 대미지 계산을 거부한다.
    .filter((e) => !e.isMega && !unsupported.species.includes(e.id) && !unsupported.abilities.includes(e.abilities[0]) && e.abilities[0] !== 'disguise')
    .sort((a, b) => a.id.localeCompare(b.id))
  return Array.from({ length: count }, (_, i) => {
    const e = pool[i % pool.length]
    return set(s, { species: e.id, ability: e.abilities[0], nature: 'hardy', moves: [], sp: { hp: i % 2 ? 0 : 32 } })
  })
}

export function installPerfHook(): void {
  window.__perf = {
    async sweep(runs = 50, warmup = 5) {
      const s = await loadSnapshot('m-c')
      const atk = set(s, { species: 'kingambit', ability: 'defiant', nature: 'hardy', moves: ['suckerpunch'] })
      const def = set(s, { species: 'delphox', ability: 'blaze', item: 'delphoxite', mega: true, nature: 'hardy', moves: [], sp: { hp: 2 } })
      return measure(() => void sweepDamage(s, { side: 'attacker', stat: 'atk' }, atk, def, 'suckerpunch'), runs, warmup)
    },
    async batch(runs = 10, warmup = 2) {
      const s = await loadSnapshot('m-c')
      const atk = set(s, { species: 'mamoswine', ability: 'oblivious', nature: 'adamant', moves: ['earthquake'], sp: { atk: 32 } })
      const opponents = batchOpponents(s, 300)
      return measure(() => opponents.forEach((d) => calcDamage(s, atk, d, 'earthquake')), runs, warmup)
    },
    async metaLoad(runs = 20, warmup = 3) {
      const s = await loadSnapshot('m-c')
      const { default: text } = await import('../data/meta/m-c/2026-10-bo1.json?raw')
      const sel = { regulation: 'm-c', match: 'bo1', month: '2026-10' } as const
      return measure(
        () => {
          const meta = JSON.parse(text) as MetaSnapshot
          assertMetaSnapshot(sel, meta)
          if (topAssumptions(createMetaView(meta, s), 30).length !== 30) throw new Error('상위 30 대표 가정 부족')
        },
        runs,
        warmup,
      )
    },
    async lane(opponentId, moveId, moves, tab = 'attack') {
      const s = await loadSnapshot('m-c')
      const { default: text } = await import('../data/meta/m-c/2026-10-bo1.json?raw')
      const input: CardInput = {
        game: s,
        view: createMetaView(JSON.parse(text) as MetaSnapshot, s),
        mySet: toPokemonSet(s, moves === undefined ? EXAMPLE_DRAFT : { ...EXAMPLE_DRAFT, moves }).set,
        rollSteps: DEFAULT_ROLL_STEPS,
        criteria: { ...DEFAULT_CRITERIA },
        filters: { topN: 1, selected: [opponentId] },
        customTargets: [],
      }
      // 고정 후보(대상 키)는 그 상대만 끝까지 계산한 뷰의 고정 조작에서 얻는다(방어 쌍 후보는 그 계단까지)
      const plan = planTab(input, tab)
      const results = new Map<string, RowTaskResult>()
      for (;;) {
        const stage = nextStage(pendingTasks(plan, results, new Map()))
        if (stage.length === 0) break
        for (const task of stage) results.set(taskKey(task), computeRowTask(plan, task))
      }
      const assembler = createTabAssembler(plan, new Map(), { lockControls: true })
      const ids = new Set(plan.cards.filter((c) => c.opponent.id === opponentId).map((c) => c.id))
      const extra = assembler.candidates(results, ids)
      for (const task of [...extra.stage4, ...extra.stage5]) {
        results.set(taskKey(task), computeRowTask(plan, task))
        assembler.invalidate(taskCardId(plan, task))
      }
      const view = assembler.assemble(results)
      const own = view.cards.filter((c) => c.opponent.id === opponentId)
      const control =
        tab === 'attack'
          ? own.flatMap((c) => c.rows).find((r) => r.moveId === moveId)?.lock?.control
          : own.find((c) => c.pair?.lock?.control !== undefined && c.rows.some((r) => r.moveId === moveId))?.pair?.lock?.control
      // 닿는 단계 중 가장 높은 단계(단계 목록은 낮은 단계부터)
      const candidate = control?.kind === 'lockable' ? [...control.stages].reverse().find((s) => s.candidate.kind === 'ready' && s.candidate.resolution.kind === 'ok')?.candidate : undefined
      if (candidate?.kind !== 'ready') throw new Error(`${opponentId} ${moveId} 고정 후보 없음`)
      const lock = { ...candidate.lock, seq: 1 }
      const t0 = performance.now()
      const lanePlan = planTab(laneInput(input, lock), tab)
      const target = findLockTarget(lanePlan, lock)
      const tasks = target === null ? [] : laneTasks(lanePlan, lock, target)
      let judgements = 0
      for (const task of tasks) {
        const r = computeRowTask(lanePlan, task)
        if (r.kind === 'branch') judgements += r.cells.length
        else if (r.kind === 'stairs' && r.stairs !== 'non-monotonic') judgements += r.stairs.length
      }
      return { tasks: tasks.length, judgements, ms: performance.now() - t0 }
    },
  }
}
