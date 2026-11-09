// 계획 + 행 작업 결과 → 탭 뷰. 판정을 다시 하지 않고 표시용 SP로 산술·조회만 한다. 비용 O(행 × 33).
import type { SpTable } from '../core'
import type { StatId } from '../data/schema'
import { cardPending, filterState, pendingTasks, taskKey } from './schedule'
import type {
  BoundaryView,
  CardSpec,
  CardView,
  CellView,
  CompactCell,
  ErrorReason,
  Headline,
  NoChangeItem,
  ResultMap,
  RowKind,
  RowSpec,
  RowView,
  TabPlan,
  TabStatus,
  TabView,
} from './types'

const KIND_RANK: Readonly<Record<RowKind, number>> = { base: 0, rank: 1, scarf: 2, 'non-scarf': 2 }
const STAT_KEYS: readonly StatId[] = ['hp', 'atk', 'def', 'spa', 'spd', 'spe']

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

function sweptRow(ctx: Ctx, spec: RowSpec, stat: StatId, cells: readonly CompactCell[], noChange: boolean): RowView {
  const views = cellViews(ctx, cells, stat)
  const sp = ctx.displaySp[stat]
  const boundaries = boundariesOf(views, sp)
  const stale = spec.dependsOn.some((s) => ctx.displaySp[s] !== ctx.plan.mySp[s])
  const current: RowView['current'] = { sp }
  const at = views.find((c) => c.sp === sp)
  if (at !== undefined) current.category = at.category
  return { ...headOf(spec), status: stale ? 'stale' : 'ok', noChange, cells: views, current, boundaries, nearest: nearestOf(boundaries) }
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
    if (row.status !== 'ok' || row.noChange || row.boundaries.length === 0) continue
    const score = Math.min(...row.boundaries.map((b) => Math.abs(b.delta)))
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

function buildCard(ctx: Ctx, card: CardSpec): CardBuild {
  const { plan, results } = ctx
  const ladder = card.opponent.source === 'ladder'
  const base = { id: card.id, order: card.order, state: card.state, notices: card.notices, opponent: card.opponent, category: card.category, bundle: card.bundle }
  if (card.state === 'error') {
    const view: CardView = { ...base, error: cardError(card), rows: [], hiddenNoChangeRows: 0, headline: headlineOf(card, []), moreRows: 0 }
    return { view, displayed: true, emptyDone: false, items: [], mySetReasons: [] }
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

  const filterDone = new Set<string>()
  for (const rowId of card.rowIds) {
    const spec = plan.rows[rowId]
    if (spec.error !== undefined) {
      rows.push(bareRow(ctx, headOf(spec), 'error', { error: spec.error }))
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
        const head: RowHead = { id: JSON.stringify(['filter', spec.gate]), kind: filter.basis ? 'rank' : 'base', order: spec.order, moveId: filter.moveId }
        if (filter.basis !== undefined) head.basis = filter.basis
        if (f.kind === 'error') rows.push(bareRow(ctx, head, 'error', { error: fail(f.result.reason) }))
        else if (ladder) items.push(item('extreme-filter', f.result.low.category, { rowKind: head.kind, moveId: filter.moveId, basis: filter.basis }))
        else rows.push(bareRow(ctx, head, 'ok', { category: f.result.low.category, noChange: true }))
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
      // 양 끝이 같은 래더 행은 3단계 확인 전까지 잠정 제외한다.
      if (ends.low.category !== ends.high.category || !ladder) rows.push(bareRow(ctx, headOf(spec), 'pending'))
      continue
    }
    if (swept.kind === 'error') {
      rows.push(bareRow(ctx, headOf(spec), 'error', { error: fail(swept.reason) }))
      continue
    }
    if (swept.kind !== 'sweep') throw new Error(`행 ${rowId}의 스윕 결과 종류가 ${swept.kind}다`)
    const first = swept.cells[0]
    if (first === undefined) throw new Error(`행 ${rowId}의 스윕 칸이 비어 있다`)
    const same = swept.cells.every((c) => c.category === first.category)
    if (same && ladder) {
      items.push(item('row', first.category, { rowKind: spec.kind, moveId: spec.moveId, sweepStat: stat, basis: spec.basis }))
      continue
    }
    rows.push(sweptRow(ctx, spec, stat, swept.cells, same))
  }

  const fixedOrder = card.rowIds.reduce((m, id) => Math.max(m, plan.rows[id].order + 1), 0)
  card.fixedIds.forEach((fixedId, i) => {
    const spec = plan.fixed[fixedId]
    const head: RowHead = { id: JSON.stringify(['fixed', fixedId]), kind: 'base', order: fixedOrder + i, moveId: spec.moveId }
    const r = results.get(taskKey({ kind: 'fixed', fixedId }))
    if (r === undefined) {
      if (!ladder) rows.push(bareRow(ctx, head, 'pending'))
    } else if (r.kind === 'error') {
      rows.push(bareRow(ctx, head, 'error', { error: fail(r.reason) }))
    } else if (r.kind !== 'fixed') {
      throw new Error(`고정 판정 ${fixedId}의 결과 종류가 ${r.kind}다`)
    } else if (ladder) {
      items.push(item('sp-independent', r.cell.category, { moveId: spec.moveId }))
    } else {
      rows.push(bareRow(ctx, head, 'ok', { category: r.cell.category, noChange: true }))
    }
  })

  rows.sort((a, b) => a.order - b.order)
  const pending = cardPending(plan, card, results)
  const settled = pending.stage1.length === 0 && pending.stage2.length === 0
  const allDone = settled && pending.stage3.length === 0
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
    displayed: !ladder || (settled && visible),
    emptyDone: ladder && allDone && !visible,
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

function progressCount(plan: TabPlan, results: ResultMap): number {
  let done = 0
  const has = (key: string) => (results.has(key) ? 1 : 0)
  for (const card of plan.cards) {
    if (card.state === 'error') continue
    for (const filterId of card.filterIds) done += has(taskKey({ kind: 'extreme', filterId }))
    for (const rowId of card.rowIds) {
      done += has(taskKey({ kind: 'ends', rowId })) + has(taskKey({ kind: 'sweep', rowId, stage: 2 }))
    }
    for (const fixedId of card.fixedIds) done += has(taskKey({ kind: 'fixed', fixedId }))
  }
  return done
}

/** displaySp 기본값은 계획 시점 SP. 카드 순서는 계획 순서 그대로다. */
export function assembleTab(plan: TabPlan, results: ResultMap, displaySp: SpTable = plan.mySp): TabView {
  const pending = pendingTasks(plan, results)
  const done = progressCount(plan, results)
  const shell = {
    tab: plan.tab,
    source: plan.source,
    progress: { done, total: done + pending.stage1.length + pending.stage2.length + pending.stage3.length },
    stage12Done: pending.stage1.length === 0 && pending.stage2.length === 0,
    complete: pending.stage1.length === 0 && pending.stage2.length === 0 && pending.stage3.length === 0,
    customTargetConflicts: plan.customTargetConflicts,
    notices: plan.notices,
  }
  const empty = { rows: 0, cards: 0, items: [] }
  if (plan.status.kind !== 'ok') return { ...shell, status: plan.status, cards: [], noChange: empty }

  const ctx: Ctx = { plan, results, displaySp, spSum: STAT_KEYS.reduce((s, k) => s + displaySp[k], 0) }
  const builds = plan.cards.map((card) => buildCard(ctx, card))
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
}
