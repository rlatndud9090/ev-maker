// 계획 + 행 작업 결과 → 탭 뷰. 판정을 다시 하지 않고 표시용 SP로 산술·조회만 한다. 비용 O(행 × 33).
import type { SpTable } from '../core'
import type { StatId } from '../data/schema'
import {
  candidateStates,
  cardPending,
  filterState,
  neededVariants,
  probeKey,
  rowChanges,
  rowJudgements,
  taskKey,
  type CandidateState,
  type RowJudgements,
} from './schedule'
import { groupKey } from './groups'
import { cellLabel, pairTarget, singleTarget } from './target'
import { NATURE_VARIANTS } from './types'
import type {
  BoundaryView,
  CardSpec,
  CardView,
  CellView,
  CompactCell,
  ErrorReason,
  Headline,
  NoChangeItem,
  PairPoint,
  PendingTasks,
  ResultMap,
  RowKind,
  RowSpec,
  RowTask,
  RowView,
  TabPlan,
  TabStatus,
  TabView,
  TargetView,
} from './types'

const KIND_RANK: Readonly<Record<RowKind, number>> = { base: 0, rank: 1, scarf: 2, 'non-scarf': 2 }
const STAT_KEYS: readonly StatId[] = ['hp', 'atk', 'def', 'spa', 'spd', 'spe']
const STAGE_KEYS = ['stage1', 'stage2', 'stage3', 'stage4', 'stage5'] as const

interface Ctx {
  plan: TabPlan
  results: ResultMap
  displaySp: SpTable
  spSum: number
}

interface CardBuild {
  view: CardView
  displayed: boolean
  /** 모든 작업이 끝났고 표시 행이 없는 래더 카드(요약 M) */
  emptyDone: boolean
  /** 이 카드의 1·2단계 작업이 끝남 */
  settled: boolean
  items: NoChangeItem[]
  mySetReasons: ErrorReason[]
}

function cellViews(ctx: Ctx, cells: readonly CompactCell[], stat: StatId): CellView[] {
  const available = ctx.plan.spTotal - (ctx.spSum - ctx.displaySp[stat])
  return cells.map((c) => {
    const need = Math.max(0, c.sp - available)
    return { ...c, overBudget: need > 0, need }
  })
}

function boundariesOf(cells: readonly CellView[], current: number): BoundaryView[] {
  const out: BoundaryView[] = []
  for (let i = 1; i < cells.length; i++) {
    const prev = cells[i - 1]
    const cur = cells[i]
    if (prev.category !== cur.category) {
      out.push({ sp: cur.sp, from: prev.category, to: cur.category, delta: cur.sp - current, need: cur.need })
    }
  }
  return out
}

function nearestOf(boundaries: readonly BoundaryView[]): RowView['nearest'] {
  const nearest: { up?: BoundaryView; down?: BoundaryView } = {}
  for (const b of boundaries) {
    if (b.delta > 0 && (nearest.up === undefined || b.delta < nearest.up.delta)) nearest.up = b
    if (b.delta <= 0 && (nearest.down === undefined || b.delta > nearest.down.delta)) nearest.down = b
  }
  return nearest
}

type RowHead = Pick<RowView, 'id' | 'kind' | 'order' | 'moveId' | 'sweepStat' | 'refs' | 'basis'>

function headOf(spec: RowSpec): RowHead {
  const head: RowHead = { id: spec.id, kind: spec.kind, order: spec.order }
  if (spec.moveId !== undefined) head.moveId = spec.moveId
  if (spec.sweep !== undefined) head.sweepStat = spec.sweep.stat
  if (spec.refs !== undefined) head.refs = spec.refs
  if (spec.basis !== undefined) head.basis = spec.basis
  return head
}

/** 칸이 없는 행(판정 전·오류·고정 범주). */
function bareRow(ctx: Ctx, head: RowHead, status: RowView['status'], extra: { error?: ErrorReason; category?: string; noChange?: boolean } = {}): RowView {
  const current: RowView['current'] = { sp: head.sweepStat === undefined ? 0 : ctx.displaySp[head.sweepStat] }
  if (extra.category !== undefined) current.category = extra.category
  const row: RowView = { ...head, status, noChange: extra.noChange ?? false, cells: [], current, boundaries: [], nearest: {} }
  if (extra.error !== undefined) row.error = extra.error
  return row
}

/**
 * 방어 탭(필터가 있는 행)은 성격 변형별 쌍 결과, 그 밖은 그 행의 성격 변형별 33칸에서 목표를 낸다.
 * 필요한 변형 결과(방어 탭은 두 쌍 결과)가 다 나오기 전이나 그중 오류가 있으면 목표 없음(오류를 "불가"로 보이지 않는다).
 */
function targetOf(ctx: Ctx, spec: RowSpec, stat: StatId, j: RowJudgements, at: CellView | undefined): TargetView | undefined {
  const { plan } = ctx
  const side = spec.judge === 'speed' ? 'speed' : plan.mySide === 'attacker' ? 'attack' : 'defense'
  const label = at === undefined ? undefined : cellLabel(side, at)
  if (label === undefined || spec.natures === undefined || !j.variantsDone || j.variantError) return undefined
  const plusStat = spec.natures.stat
  if (spec.gate === undefined) {
    const views = (cells: readonly CompactCell[] | undefined) => (cells === undefined ? undefined : cellViews(ctx, cells, stat))
    return singleTarget(side, stat, plusStat, label, { neutral: views(j.neutral), plus: views(j.plus) })
  }
  const points: { neutral?: PairPoint[]; plus?: PairPoint[] } = {}
  for (const nature of NATURE_VARIANTS) {
    const r = ctx.results.get(taskKey({ kind: 'pair', filterId: spec.gate, nature }))
    if (r === undefined || r.kind !== 'pair') return undefined
    points[nature] = [...r.points]
  }
  const current = { hp: ctx.displaySp.hp, defense: ctx.displaySp[plusStat] }
  return pairTarget(points, label, plusStat, current, plan.spTotal - ctx.spSum)
}

function sweptRow(ctx: Ctx, spec: RowSpec, stat: StatId, j: RowJudgements, noChange: boolean): RowView {
  const cells = j.current
  if (cells === undefined) throw new Error(`행 ${spec.id}의 현재 성격 스윕이 없다`)
  const views = cellViews(ctx, cells, stat)
  const sp = ctx.displaySp[stat]
  const boundaries = boundariesOf(views, sp)
  const stale = spec.dependsOn.some((s) => ctx.displaySp[s] !== ctx.plan.mySp[s])
  const current: RowView['current'] = { sp }
  const at = views.find((c) => c.sp === sp)
  if (at !== undefined) current.category = at.category
  const row: RowView = { ...headOf(spec), status: stale ? 'stale' : 'ok', noChange, cells: views, current, boundaries, nearest: nearestOf(boundaries) }
  const target = noChange ? undefined : targetOf(ctx, spec, stat, j, at)
  if (target !== undefined) row.target = target
  return row
}

const SWEEP_STAT_RANK: Readonly<Partial<Record<StatId, number>>> = { hp: 0 }

/** 동률 순서: kind → 기술 슬롯(카드 행에서 그 기술이 처음 나온 순서) → H 행 먼저 → 카드 안 순번. */
function tieKey(row: RowView, slotOf: ReadonlyMap<string, number>): readonly number[] {
  const slot = row.moveId === undefined ? 0 : (slotOf.get(row.moveId) ?? 0)
  const stat = row.sweepStat === undefined ? 0 : (SWEEP_STAT_RANK[row.sweepStat] ?? 1)
  return [KIND_RANK[row.kind], slot, stat, row.order]
}

function lexLess(a: readonly number[], b: readonly number[]): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i]
  return false
}

function headlineOf(card: CardSpec, rows: readonly RowView[], slotOf: ReadonlyMap<string, number> = new Map()): Headline {
  if (card.state === 'error') return { kind: 'error', reason: cardError(card) }
  let best: { row: RowView; score: number; tie: readonly number[] } | undefined
  for (const row of rows) {
    if (row.status !== 'ok' || row.noChange || row.cells.length === 0) continue
    // 현재 성격 칸에 경계가 없는 행(성격 변형으로만 판정이 바뀜)은 경계 있는 행 뒤에 둔다.
    const score = row.boundaries.length === 0 ? Infinity : Math.min(...row.boundaries.map((b) => Math.abs(b.delta)))
    const tie = tieKey(row, slotOf)
    if (best === undefined || score < best.score || (score === best.score && lexLess(tie, best.tie))) best = { row, score, tie }
  }
  if (best !== undefined) return { kind: 'row', rowId: best.row.id }
  if (rows.some((r) => r.status === 'stale' || r.status === 'pending')) return { kind: 'updating' }
  const errored = rows.find((r) => r.status === 'error')
  if (errored?.error !== undefined) return { kind: 'error', reason: errored.error }
  const fixed: string[] = []
  for (const r of rows) {
    if (r.current.category !== undefined && !fixed.includes(r.current.category)) fixed.push(r.current.category)
  }
  return { kind: 'no-change', fixed }
}

function cardError(card: CardSpec): ErrorReason {
  if (card.error === undefined) throw new Error(`error 카드 ${card.id}에 이유가 없다`)
  return card.error
}

/**
 * keep = 변화 없음 선택지로 보이는 래더 카드: 커스텀 카드처럼 변화 없음 행·잠정 행을 rows에 남기고 요약 항목은 내지 않는다
 * (그 상대의 다른 카드가 보일 때만 assembleTab이 다시 조립한다).
 */
function buildCard(ctx: Ctx, card: CardSpec, pending: PendingTasks, keep = false): CardBuild {
  const { plan, results } = ctx
  const ladder = card.opponent.source === 'ladder'
  /** 변화 없음 행을 요약으로 빼는 카드(keep이 아닌 래더) */
  const hide = ladder && !keep
  const base = { id: card.id, order: card.order, state: card.state, notices: card.notices, opponent: card.opponent, category: card.category, bundle: card.bundle }
  if (card.state === 'error') {
    const view: CardView = { ...base, error: cardError(card), rows: [], hiddenNoChangeRows: 0, headline: headlineOf(card, []), moreRows: 0 }
    return { view, displayed: true, emptyDone: false, settled: true, items: [], mySetReasons: [] }
  }

  const rows: RowView[] = []
  const items: NoChangeItem[] = []
  const reasons: ErrorReason[] = []
  const item = (kind: NoChangeItem['kind'], fixed: string, extra: Partial<NoChangeItem>): NoChangeItem =>
    withoutUndefined({ cardId: card.id, opponent: card.opponent, category: card.category, kind, ...extra, fixed })
  const fail = (reason: ErrorReason): ErrorReason => {
    if (reason.field?.startsWith(`${plan.mySide}.`)) reasons.push(reason)
    return reason
  }

  const states = candidateStates(card, results)
  const probeErrors = new Map<string, ErrorReason>()
  for (const group of card.conditions) {
    for (const c of group.candidates) {
      const r = results.get(probeKey(c))
      if (c.target !== 'fixed' && r?.kind === 'error') probeErrors.set(c.id, r.reason)
    }
  }
  const filterDone = new Set<string>()
  const filterHead = (gate: string, order: number): RowHead => {
    const filter = plan.filters[gate]
    const head: RowHead = { id: JSON.stringify(['filter', gate]), kind: filter.basis ? 'rank' : 'base', order, moveId: filter.moveId }
    if (filter.basis !== undefined) head.basis = filter.basis
    return head
  }
  for (const rowId of card.rowIds) {
    const spec = plan.rows[rowId]
    if (spec.error !== undefined) {
      rows.push(bareRow(ctx, headOf(spec), 'error', { error: spec.error }))
      continue
    }
    const candidate = spec.gate ?? rowId
    const state: CandidateState | undefined = states.get(candidate)
    if (state === 'dropped') continue
    if (state === 'probing') {
      if (!hide) rows.push(bareRow(ctx, headOf(spec), 'pending'))
      continue
    }
    if (state === 'error') {
      const reason = probeErrors.get(candidate) as ErrorReason
      if (spec.gate === undefined) rows.push(bareRow(ctx, headOf(spec), 'error', { error: fail(reason) }))
      else if (!filterDone.has(spec.gate)) {
        filterDone.add(spec.gate)
        rows.push(bareRow(ctx, filterHead(spec.gate, spec.order), 'error', { error: fail(reason) }))
      }
      continue
    }
    if (spec.gate !== undefined) {
      const f = filterState(results, spec.gate)
      if (f.kind === 'pending') {
        rows.push(bareRow(ctx, headOf(spec), 'pending'))
        continue
      }
      if (f.kind !== 'passed') {
        if (filterDone.has(spec.gate)) continue
        filterDone.add(spec.gate)
        const filter = plan.filters[spec.gate]
        const head = filterHead(spec.gate, spec.order)
        if (f.kind === 'error') rows.push(bareRow(ctx, head, 'error', { error: fail(f.result.reason) }))
        else if (hide) items.push(item('extreme-filter', f.result.low.category, { rowKind: head.kind, moveId: filter.moveId, basis: filter.basis }))
        else {
          const blocked = bareRow(ctx, head, 'ok', { category: f.result.low.category, noChange: true })
          // 가장 센 기술이 아니지만 선공기라 남은 극단 필터 행도 선공기 표지를 단다(스윕 행과 같은 규칙).
          if (state === 'priority') blocked.keptAsPriority = true
          rows.push(blocked)
        }
        continue
      }
    }
    const stat = spec.sweep?.stat
    if (stat === undefined) throw new Error(`행 ${rowId}에 스윕 대상이 없다`)
    const ends = results.get(taskKey({ kind: 'ends', rowId }))
    if (ends === undefined) {
      rows.push(bareRow(ctx, headOf(spec), 'pending'))
      continue
    }
    if (ends.kind === 'error') {
      rows.push(bareRow(ctx, headOf(spec), 'error', { error: fail(ends.reason) }))
      continue
    }
    if (ends.kind !== 'ends') throw new Error(`행 ${rowId}의 양 끝 결과 종류가 ${ends.kind}다`)
    const swept = results.get(taskKey({ kind: 'sweep', rowId, stage: 2 }))
    if (swept === undefined) {
      // 변형 범위 끝(무보정 0·상승 최대)이 같은 래더 행은 3단계 확인 전까지 잠정 제외한다.
      if (rowChanges(ends, { variantsDone: false }) || !hide) rows.push(bareRow(ctx, headOf(spec), 'pending'))
      continue
    }
    if (swept.kind === 'error') {
      rows.push(bareRow(ctx, headOf(spec), 'error', { error: fail(swept.reason) }))
      continue
    }
    if (swept.kind !== 'sweep') throw new Error(`행 ${rowId}의 스윕 결과 종류가 ${swept.kind}다`)
    const first = swept.cells[0]
    if (first === undefined) throw new Error(`행 ${rowId}의 스윕 칸이 비어 있다`)
    const j = rowJudgements(plan, results, rowId)
    const same = !rowChanges(ends, j)
    // 현재 성격으로는 같아도 성격 변형 스윕이 남았으면 래더 행은 잠정 제외(변화 없음 확정 전)한다.
    if (same && hide && !j.variantsDone) continue
    if (same && hide) {
      items.push(item('row', first.category, { rowKind: spec.kind, moveId: spec.moveId, sweepStat: stat, basis: spec.basis }))
      continue
    }
    const row = sweptRow(ctx, spec, stat, j, same)
    if (state === 'priority') row.keptAsPriority = true
    rows.push(row)
  }

  const fixedOrder = card.rowIds.reduce((m, id) => Math.max(m, plan.rows[id].order + 1), 0)
  card.fixedIds.forEach((fixedId, i) => {
    const spec = plan.fixed[fixedId]
    const head: RowHead = { id: JSON.stringify(['fixed', fixedId]), kind: 'base', order: fixedOrder + i, moveId: spec.moveId }
    const r = results.get(taskKey({ kind: 'fixed', fixedId }))
    const state = states.get(fixedId)
    if (state === 'dropped') return
    if (r === undefined || state === 'probing') {
      if (!hide) rows.push(bareRow(ctx, head, 'pending'))
    } else if (r.kind === 'error') {
      rows.push(bareRow(ctx, head, 'error', { error: fail(r.reason) }))
    } else if (r.kind !== 'fixed') {
      throw new Error(`고정 판정 ${fixedId}의 결과 종류가 ${r.kind}다`)
    } else if (hide) {
      items.push(item('sp-independent', r.cell.category, { moveId: spec.moveId }))
    } else {
      const row = bareRow(ctx, head, 'ok', { category: r.cell.category, noChange: true })
      if (state === 'priority') row.keptAsPriority = true
      rows.push(row)
    }
  })

  rows.sort((a, b) => a.order - b.order)
  const settled = pending.stage1.length === 0 && pending.stage2.length === 0
  const allDone = settled && pending.stage3.length === 0 && pending.stage4.length === 0 && pending.stage5.length === 0
  const shown = rows.filter((r) => !r.noChange).length
  const view: CardView = {
    ...base,
    rows,
    hiddenNoChangeRows: items.length,
    headline: headlineOf(card, rows, slotOrder(plan, card)),
    moreRows: Math.max(0, shown - 1),
  }
  // 안내(notices)가 있는 래더 카드는 행이 없어도 표시한다: 카드 머리가 안내의 유일한 화면 경로다(AC 11a).
  const visible = rows.length > 0 || card.notices.length > 0
  return {
    view,
    // 커스텀 카드도 다른 분류 기술이 가장 세 행이 하나도 남지 않으면 뺀다(그 상대의 다른 분류 카드가 보인다).
    displayed: hide ? settled && visible : visible,
    emptyDone: hide && allDone && !visible,
    settled,
    items,
    mySetReasons: reasons,
  }
}

/** 계획은 기본 행을 슬롯 순(공격 탭 내 기술 슬롯, 방어 탭 상대 기술 사용률 순)으로 먼저 쌓는다. */
function slotOrder(plan: TabPlan, card: CardSpec): Map<string, number> {
  const out = new Map<string, number>()
  for (const id of card.rowIds) {
    const moveId = plan.rows[id].moveId
    if (moveId !== undefined && !out.has(moveId)) out.set(moveId, out.size)
  }
  return out
}

function withoutUndefined<T extends object>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T
}

/** 한 카드의 끝난 작업 수(진행률 분자). */
function cardDone(plan: TabPlan, card: CardSpec, results: ResultMap): number {
  if (card.state === 'error') return 0
  let done = 0
  const has = (key: string) => (results.has(key) ? 1 : 0)
  for (const group of card.conditions) {
    for (const c of group.candidates) if (c.target !== 'fixed') done += has(probeKey(c))
  }
  for (const filterId of card.filterIds) {
    done += has(taskKey({ kind: 'extreme', filterId }))
    for (const nature of NATURE_VARIANTS) done += has(taskKey({ kind: 'pair', filterId, nature }))
  }
  for (const rowId of card.rowIds) {
    done += has(taskKey({ kind: 'ends', rowId })) + has(taskKey({ kind: 'sweep', rowId, stage: 2 }))
    for (const nature of neededVariants(plan, plan.rows[rowId])) done += has(taskKey({ kind: 'variant', rowId, nature }))
  }
  for (const fixedId of card.fixedIds) done += has(taskKey({ kind: 'fixed', fixedId }))
  return done
}

/** 카드별 조립 캐시 항목. 카드 결과가 바뀌면(invalidate) 통째로 버린다. */
interface CardMemo {
  pending: PendingTasks
  done: number
  /** 그 표시용 SP로 조립한 카드(SP가 바뀌면 다시) */
  build?: CardBuild
  /** 변화 없음 선택지로 다시 조립한 카드(필요할 때만) */
  kept?: CardBuild
}

/**
 * 한 탭 계획의 증분 조립기. 카드 판정은 그 카드 작업 결과에만 기대므로, 결과가 바뀐 카드(invalidate)만 다시 계산하고
 * 나머지 카드의 남은 작업·진행 수·조립 결과는 재사용한다. 결과 맵을 바꾸는 쪽이 그 작업의 카드를 invalidate해야 한다.
 */
export interface TabAssembler {
  invalidate(cardId: string): void
  /** pendingTasks(plan, results)와 같은 값(카드 순 → 행 순). only가 있으면 그 카드들만 */
  pending(results: ResultMap, only?: (cardId: string) => boolean): PendingTasks
  assemble(results: ResultMap, displaySp?: SpTable): TabView
}

const sameSp = (a: SpTable, b: SpTable): boolean => STAT_KEYS.every((k) => a[k] === b[k])

export function createTabAssembler(plan: TabPlan): TabAssembler {
  const memo = new Map<string, CardMemo>()
  let builtSp: SpTable | null = null
  const entry = (card: CardSpec, results: ResultMap): CardMemo => {
    let m = memo.get(card.id)
    if (m === undefined) {
      m = { pending: cardPending(plan, card, results), done: cardDone(plan, card, results) }
      memo.set(card.id, m)
    }
    return m
  }
  return {
    invalidate(cardId) {
      memo.delete(cardId)
    },
    pending(results, only) {
      const out = { stage1: [] as RowTask[], stage2: [] as RowTask[], stage3: [] as RowTask[], stage4: [] as RowTask[], stage5: [] as RowTask[] }
      for (const card of plan.cards) {
        if (only !== undefined && !only(card.id)) continue
        const p = entry(card, results).pending
        for (const k of STAGE_KEYS) for (const t of p[k]) out[k].push(t)
      }
      return out
    },
    assemble(results, displaySp = plan.mySp) {
      if (builtSp === null || !sameSp(builtSp, displaySp)) {
        for (const m of memo.values()) {
          delete m.build
          delete m.kept
        }
        builtSp = { ...displaySp }
      }
      const entries = plan.cards.map((card) => entry(card, results))
      let done = 0
      const left = { stage1: 0, stage2: 0, stage3: 0, stage4: 0, stage5: 0 }
      for (const m of entries) {
        done += m.done
        for (const k of STAGE_KEYS) left[k] += m.pending[k].length
      }
      const total = done + left.stage1 + left.stage2 + left.stage3 + left.stage4 + left.stage5
      const stage12Done = left.stage1 === 0 && left.stage2 === 0
      const shell = {
        tab: plan.tab,
        rollSteps: plan.rollSteps,
        source: plan.source,
        progress: { done, total },
        stage12Done,
        complete: stage12Done && left.stage3 === 0 && left.stage4 === 0 && left.stage5 === 0,
        customTargetConflicts: plan.customTargetConflicts,
        notices: plan.notices,
      }
      const empty = { rows: 0, cards: 0, items: [] }
      if (plan.status.kind !== 'ok') return { ...shell, status: plan.status, cards: [], noChange: empty }

      const ctx: Ctx = { plan, results, displaySp, spSum: STAT_KEYS.reduce((sum, k) => sum + displaySp[k], 0) }
      const first = plan.cards.map((card, i) => {
        const m = entries[i]
        m.build ??= buildCard(ctx, card, m.pending)
        return m.build
      })
      // 변화 없음 배분도 선택지: 같은 상대의 다른 카드가 보이면, 1·2단계가 끝났는데 표시 행이 없는 래더 카드를 변화 없음 행과 함께 넣는다.
      const shown = new Set(first.filter((b) => b.displayed && b.view.opponent.source === 'ladder').map((b) => groupKey(b.view.opponent)))
      const builds = first.map((b, i) => {
        const card = plan.cards[i]
        if (b.displayed || card.opponent.source !== 'ladder' || !b.settled || !shown.has(groupKey(card.opponent))) return b
        const m = entries[i]
        m.kept ??= buildCard(ctx, card, m.pending, true)
        return m.kept.displayed ? m.kept : b
      })
      const reasons: ErrorReason[] = []
      const seen = new Set<string>()
      for (const r of builds.flatMap((b) => b.mySetReasons)) {
        const k = JSON.stringify([r.code, r.field ?? null, r.message])
        if (!seen.has(k)) {
          seen.add(k)
          reasons.push(r)
        }
      }
      if (reasons.length > 0) {
        const status: TabStatus = { kind: 'my-set-error', reasons }
        return { ...shell, status, cards: [], noChange: empty }
      }
      const items = builds.flatMap((b) => b.items)
      return {
        ...shell,
        status: plan.status,
        cards: builds.filter((b) => b.displayed).map((b) => b.view),
        noChange: { rows: items.length, cards: builds.filter((b) => b.emptyDone).length, items },
      }
    },
  }
}

/** displaySp 기본값은 계획 시점 SP. 카드 순서는 계획 순서 그대로다(한 번 조립: 캐시 없음). */
export function assembleTab(plan: TabPlan, results: ResultMap, displaySp: SpTable = plan.mySp): TabView {
  return createTabAssembler(plan).assemble(results, displaySp)
}
