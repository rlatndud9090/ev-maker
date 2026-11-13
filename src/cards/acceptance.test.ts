// PRD 수용 기준의 도메인 부분을 고정 입력(__fixtures__/acceptance)과 buildTabView로 확인한다.
// 기대 판정은 코어 직접 호출로 만들고, 카드 모델 함수(planTab)는 어떤 행·세트가 계획됐는지 찾는 데만 쓴다.
import { describe, expect, it } from 'vitest'
import {
  CoreError,
  CoreInputError,
  STAT_IDS,
  attackEffectiveness,
  attackMoveType,
  judgeDamage,
  judgeSpeed,
  natureMultiplier,
  sweepDamage,
  sweepSpeed,
  validateSet,
  type BattleConditions,
  type PokemonSet,
  type SweepResult,
} from '../core'
import { createMetaLoader } from '../data/meta-loader'
import type { MetaEntry, MetaIndex, MetaSnapshot } from '../data/meta-schema'
import type { StatId } from '../data/schema'
import { loadRegulationIndexSync } from '../data/testing'
import { createMetaView, parseSpreadKey, representativeAssumption, type MetaView } from '../meta'
import {
  EXAMPLE_SET,
  F1,
  F10,
  F11,
  F2,
  F3,
  F4,
  F5,
  F6,
  F7,
  F8,
  F9,
  opponentSet,
  shellSideArmEntry,
  whiteHerbShellSmashEntry,
  withIllegalRepresentativeMove,
  type Boundary,
  type OpponentRef,
} from './__fixtures__/acceptance'
import { buildTabView } from './batch'
import { defaultOption, groupCards, groupItems } from './groups'
import { BASE_CONDITION_ID, itemKey } from './items'
import { opponentKey } from './schedule'
import { createLruCache } from './cache'
import { presetKey } from './ids'
import { planTab } from './plan'
import { cardInput, realData, syntheticView } from './testing'
import { DEFAULT_CRITERIA, TABS } from './types'
import type { CardInput, CardSpec, CardView, ExtremeSpec, MoveCandidate, OpponentHeader, RankBasis, RowKind, RowSpec, RowView, ScarfBasis, Tab, TabPlan, TabView } from './types'
import { DEFAULT_ROLL_STEPS } from './types'
/** 카드 입력과 같은 제품 판정 기준(cardInput 기본값). 코어 직접 호출 기대값도 이 기준으로 낸다 */
const N = DEFAULT_ROLL_STEPS

const { game, bo1, bo3 } = realData()
const { spTotal, spMaxPerStat } = game.manifest.rules
const OVER = { judgeOverBudget: true, rollSteps: N }
const IGNORE_TOTAL = { ignoreSpTotal: true, rollSteps: N }

// 파일 전체가 같은 판정 캐시를 쓴다(캐시 경유 = 무캐시는 batch.test가 봉인).
const cache = createLruCache(200_000)
const memo = new Map<string, { plan: TabPlan; view: TabView }>()

/** label은 입력 조합마다 유일해야 한다(같은 label이면 첫 결과를 재사용). */
function run(label: string, input: CardInput, tab: Tab): { plan: TabPlan; view: TabView } {
  const key = JSON.stringify([label, tab])
  let hit = memo.get(key)
  if (!hit) {
    hit = { plan: planTab(input, tab), view: buildTabView(input, tab, cache) }
    memo.set(key, hit)
  }
  return hit
}

const top = (mySet: PokemonSet, extra: Partial<CardInput> = {}) => cardInput({ mySet, ...extra })
const only = (mySet: PokemonSet, ids: string[], extra: Partial<CardInput> = {}) =>
  cardInput({ mySet, filters: { topN: 30, selected: ids }, ...extra })

const entryOf = (view: MetaView, id: string): MetaEntry => {
  const e = view.entry(id)
  if (!e) throw new Error(`메타에 ${id}이 없다`)
  return e
}

function boundariesOf<T>(r: SweepResult<T>): Boundary[] {
  return r.boundaries.map((b) => {
    const from = r.cells[b - 1]
    const to = r.cells[b]
    if (from.kind !== 'ok' || to.kind !== 'ok') throw new Error('예산 밖 판정이 꺼진 스윕')
    return { sp: b, from: from.category, to: to.category }
  })
}
const categoriesOf = <T>(r: SweepResult<T>): string[] => r.cells.map((c) => (c.kind === 'ok' ? c.category : 'over-budget'))
const rowBoundaries = (row: RowView): Boundary[] => row.boundaries.map((b) => ({ sp: b.sp, from: b.from, to: b.to }))

/** 계획 행 명세를 코어에 그대로 넣은 스윕. 거부되면 null. */
function coreSweep(spec: Pick<RowSpec, 'judge' | 'sweep' | 'attacker' | 'defender' | 'moveId' | 'conditions'>): SweepResult<unknown> | null {
  try {
    if (spec.judge === 'speed') return sweepSpeed(game, spec.attacker, spec.defender, spec.conditions, OVER)
    if (!spec.sweep || !spec.moveId) throw new Error('대미지 행에 스윕 대상·기술이 없다')
    return sweepDamage(game, spec.sweep, spec.attacker, spec.defender, spec.moveId, spec.conditions, undefined, OVER)
  } catch (e) {
    if (e instanceof CoreError || e instanceof CoreInputError) return null
    throw e
  }
}

function coreCategory(f: () => { category: string }): string | null {
  try {
    return f().category
  } catch (e) {
    if (e instanceof CoreError || e instanceof CoreInputError) return null
    throw e
  }
}

const withSp = (s: PokemonSet, patch: Partial<Record<StatId, number>>): PokemonSet => ({ ...s, sp: { ...s.sp, ...patch } })

/** 표시 카드에서 그 상대에 대해 나온 모든 행(종류·근거). 변화 없음 행도 카드 안에 있다. */
function rowsFor(view: TabView, opponentId: string): { kind: RowKind; moveId?: string; basis?: RankBasis | ScarfBasis }[] {
  return view.cards.filter((c) => c.opponent.id === opponentId).flatMap((c) => c.rows.map((r) => ({ kind: r.kind, moveId: r.moveId, basis: r.basis })))
}

/** 표시 카드 안의 변화 없음 행(ok). kind: row = 스윕 행, extreme-filter = 극단 필터에 걸린 기술 1행, sp-independent = 내 SP 무관 판정. */
interface NoChangeRow {
  cardId: string
  opponent: OpponentHeader
  kind: 'row' | 'extreme-filter' | 'sp-independent'
  rowKind: RowKind
  moveId?: string
  sweepStat?: StatId
  basis?: RankBasis | ScarfBasis
  fixed: string
}
function noChangeRows(view: TabView): NoChangeRow[] {
  return view.cards.flatMap((c) =>
    c.rows
      .filter((r) => r.noChange && r.status === 'ok')
      .map((r): NoChangeRow => {
        const kind = r.id.startsWith('["filter",') ? 'extreme-filter' : r.id.startsWith('["fixed",') ? 'sp-independent' : 'row'
        const fixed = r.current.category ?? r.cells[0]?.category
        if (fixed === undefined) throw new Error(`변화 없음 행 ${r.id}에 범주가 없다`)
        return { cardId: c.id, opponent: c.opponent, kind, rowKind: r.kind, moveId: r.moveId, sweepStat: r.sweepStat, basis: r.basis, fixed }
      }),
  )
}

function cardBySpread(plan: TabPlan, view: TabView, ref: OpponentRef, category: CardSpec['category']): { spec: CardSpec; card?: CardView } {
  const spec = plan.cards.find((c) => c.opponent.id === ref.id && c.category === category && c.bundle.representativeSpread === ref.spread)
  if (!spec) throw new Error(`${ref.id} ${ref.spread} ${category} 카드가 계획에 없다`)
  return { spec, card: view.cards.find((c) => c.id === spec.id) }
}

function shownRow(card: CardView | undefined, pred: (r: RowView) => boolean): RowView {
  const row = card?.rows.find(pred)
  if (!row) throw new Error(`카드 ${card?.id}에 찾는 행이 없다`)
  return row
}

const meansKey = (b: RankBasis | ScarfBasis | undefined): string | null =>
  b === undefined ? null : b.kind === 'rank' ? JSON.stringify([b.owner, b.means.kind, b.means.id]) : JSON.stringify([b.kind, b.item])

/** 내 쪽 세트의 성격만 바꾼 행 명세 */
function withMyNature(plan: TabPlan, spec: RowSpec, nature: string): RowSpec {
  return plan.mySide === 'attacker' ? { ...spec, attacker: { ...spec.attacker, nature } } : { ...spec, defender: { ...spec.defender, nature } }
}

type CoreProbe = { kind: 'ok'; p: number; max: number } | { kind: 'immune' } | { kind: 'error' }
type CoreVar = { kind: 'variable' } | { kind: 'fixed'; cat: string } | { kind: 'error' }

/** 오라클 항목: 계획 후보(기술 × 랭크 조건)를 코어로 직접 판정한 값 */
interface OracleItem {
  key: string
  moveId: string
  rankBefore: boolean
  priority: boolean
  cand: MoveCandidate
  basis?: RankBasis
  probe: CoreProbe
  moveOrder: number
  condOrder: number
}

function coreProbe(plan: TabPlan, c: MoveCandidate): CoreProbe {
  const opt = { rollSteps: N }
  try {
    let v
    if (c.target === 'filter') {
      const f = plan.filters[c.id]
      v = judgeDamage(game, 'defender', f.attacker, f.defender, f.moveId, f.conditions, undefined, opt).value
    } else if (c.target === 'fixed') {
      const f = plan.fixed[c.id]
      v = judgeDamage(game, 'attacker', f.attacker, f.defender, f.moveId, f.conditions, undefined, opt).value
    } else {
      const r = plan.rows[c.id]
      if (r.error || !r.sweep || !r.moveId) return { kind: 'error' }
      v = judgeDamage(game, r.sweep.side, r.attacker, r.defender, r.moveId, r.conditions, undefined, opt).value
    }
    return v.kind === 'damage' ? { kind: 'ok', p: v.ohkoChance, max: v.maxPercent } : { kind: 'immune' }
  } catch (e) {
    if (e instanceof CoreError || e instanceof CoreInputError) return { kind: 'error' }
    throw e
  }
}

/** 스윕 행: 현재·무보정·상승 성격 33칸 스윕(예산 밖 판정)의 범주가 모두 같으면 고정 */
function coreRowVar(plan: TabPlan, spec: RowSpec): CoreVar {
  const r = coreSweep(spec)
  if (r === null || spec.natures === undefined) return { kind: 'error' }
  const cats = categoriesOf(r)
  const variants = [spec.natures.neutral, spec.natures.plus].map((n) => coreSweep(withMyNature(plan, spec, n)))
  if (variants.some((v) => v === null)) return { kind: 'error' }
  const all = [...cats, ...variants.flatMap((v) => categoriesOf(v as SweepResult<unknown>))]
  return all.every((c) => c === cats[0]) ? { kind: 'fixed', cat: cats[0] } : { kind: 'variable' }
}

/** 극단 필터 = 내 H·(B|D) 함께 0·무보정 / 함께 최대·상승(예산 무시). 같으면 그 판정으로 고정 */
function coreExtreme(f: ExtremeSpec): { low: string; high: string } | null {
  const at = (v: number, nature: string) => {
    const defender = withSp({ ...f.defender, nature }, { [f.stats[0]]: v, [f.stats[1]]: v })
    return coreCategory(() => judgeDamage(game, 'defender', f.attacker, defender, f.moveId, f.conditions, undefined, IGNORE_TOTAL))
  }
  const low = at(0, f.natures.neutral)
  const high = at(spMaxPerStat, f.natures.plus)
  return low === null || high === null ? null : { low, high }
}

function coreVar(plan: TabPlan, card: CardSpec, c: MoveCandidate): CoreVar {
  if (c.target === 'row') return coreRowVar(plan, plan.rows[c.id])
  if (c.target === 'fixed') {
    const f = plan.fixed[c.id]
    const cat = coreCategory(() => judgeDamage(game, 'attacker', f.attacker, f.defender, f.moveId, f.conditions, undefined, { rollSteps: N }))
    return cat === null ? { kind: 'error' } : { kind: 'fixed', cat }
  }
  const ex = coreExtreme(plan.filters[c.id])
  if (ex === null) return { kind: 'error' }
  if (ex.low === ex.high) return { kind: 'fixed', cat: ex.low }
  const vars = card.rowIds.filter((id) => plan.rows[id].gate === c.id).map((id) => coreRowVar(plan, plan.rows[id]))
  if (vars.some((v) => v.kind === 'variable')) return { kind: 'variable' }
  if (vars.some((v) => v.kind === 'error')) return { kind: 'error' }
  return vars[0]
}

/**
 * 기본 항목(PRD R4)의 독립 재구현: 가장 센 순 정렬(정상 → 계산 불가 → 무효, 1타 확률 → 최대 대미지 비율 → 같은 기술 랭크 전 → 기술·조건 순) →
 * 기준 기술(가장 센 정상 랭크 전 항목, 방어 탭 speedEdge면 랭크 전·후 중 변동인 선공기 우선) → 랭크 전 P·후 Q 표.
 */
function oracleDefault(items: readonly OracleItem[], priorityRule: boolean, varOf: (i: OracleItem) => CoreVar): OracleItem {
  const cls = (i: OracleItem) => (i.probe.kind === 'ok' ? 0 : i.probe.kind === 'error' ? 1 : 2)
  const sorted = [...items].sort((a, b) => {
    if (cls(a) !== cls(b)) return cls(a) - cls(b)
    if (a.probe.kind === 'ok' && b.probe.kind === 'ok') {
      if (a.probe.p !== b.probe.p) return b.probe.p - a.probe.p
      if (a.probe.max !== b.probe.max) return b.probe.max - a.probe.max
    }
    if (a.moveId === b.moveId && a.rankBefore !== b.rankBefore) return a.rankBefore ? -1 : 1
    return a.moveOrder - b.moveOrder || a.condOrder - b.condOrder
  })
  const valid = (i: OracleItem) => i.probe.kind === 'ok'
  const variable = (i: OracleItem) => varOf(i).kind === 'variable'
  const qsOf = (moveId: string) => sorted.filter((i) => i.moveId === moveId && !i.rankBefore && valid(i))
  const pq = (moveId: string): OracleItem => {
    const p = sorted.find((i) => i.moveId === moveId && i.rankBefore) as OracleItem
    const qs = qsOf(moveId)
    const q = qs.find(variable) ?? qs[0]
    if (!valid(p)) return q ?? p
    const pv = varOf(p)
    if (pv.kind !== 'fixed' || pv.cat === 'guaranteed-ohko' || q === undefined) return p
    const qv = varOf(q)
    return qv.kind === 'variable' || (qv.kind === 'fixed' && qv.cat === 'guaranteed-survive') ? q : p
  }
  const pre = sorted.filter((i) => i.rankBefore && valid(i))
  if (pre.length === 0) return sorted[0]
  if (priorityRule) for (const p of pre) if (p.priority && [p, ...qsOf(p.moveId)].some(variable)) return pq(p.moveId)
  return pq(pre[0].moveId)
}

function oracleItems(plan: TabPlan, card: CardSpec): OracleItem[] {
  const moveOrder = new Map<string, number>()
  for (const g of card.conditions) for (const c of g.candidates) if (!moveOrder.has(c.moveId)) moveOrder.set(c.moveId, moveOrder.size)
  return card.conditions.flatMap((g, gi) =>
    g.candidates.map((c) => {
      const basis = c.target === 'filter' ? plan.filters[c.id].basis : c.target === 'row' && plan.rows[c.id].basis?.kind === 'rank' ? (plan.rows[c.id].basis as RankBasis) : undefined
      const it: OracleItem = {
        key: JSON.stringify([c.moveId, g.id]),
        moveId: c.moveId,
        rankBefore: g.id === JSON.stringify(['base']),
        priority: Object.prototype.hasOwnProperty.call(game.data.moves, c.moveId) && game.data.moves[c.moveId].priority > 0,
        cand: c,
        probe: coreProbe(plan, c),
        moveOrder: moveOrder.get(c.moveId) as number,
        condOrder: gi,
      }
      if (basis !== undefined) it.basis = basis
      return it
    }),
  )
}

/**
 * 계획의 래더 카드를 코어로 직접 판정해 보이는 항목(기본 항목, PRD R4)·표시 카드·변화 없음 행·표시 행 칸을 다시 만든다.
 * 카드는 보이는 항목 하나의 행만 낸다(공격 탭 1행·고정 판정 1행, 방어 탭 극단 필터에 걸리면 1행, 통과하면 H 행·B/D 행).
 * 반감열매 변형 카드는 기본 항목의 기술이 그 열매를 발동시킬 때만 보인다. 행 = 현재·무보정·상승 성격 33칸 스윕(예산 밖 판정)의 합집합.
 */
function expectMatchesCore(plan: TabPlan, view: TabView): { items: number; cards: number; allSame: number } {
  expect(plan.status).toEqual({ kind: 'ok' })
  expect(view.complete).toBe(true)
  const shownLadder: string[] = []
  let emptyCards = 0
  let allSame = 0
  let noChangeCount = 0
  for (const card of plan.cards) {
    if (card.opponent.source !== 'ladder') continue
    const viewCard = view.cards.find((c) => c.id === card.id)
    if (card.state === 'error') {
      // 반감열매 변형의 해석 실패는 기본 카드가 같은 이유로 보이므로 보이지 않는다.
      if (card.berry === undefined) shownLadder.push(card.id)
      else expect(viewCard, card.id).toBeUndefined()
      continue
    }
    const items = oracleItems(plan, card)
    // 후보 없는 카드(스피드 탭)는 모든 행이 보인다.
    const plain = card.conditions.length === 0
    if (!plain && items.length === 0) {
      expect(viewCard, card.id).toBeUndefined()
      emptyCards++
      continue
    }
    const vars = new Map<string, CoreVar>()
    const varOf = (i: OracleItem) => {
      let v = vars.get(i.key)
      if (v === undefined) {
        v = coreVar(plan, card, i.cand)
        vars.set(i.key, v)
      }
      return v
    }
    const def = plain ? undefined : oracleDefault(items, plan.tab === 'defense' && card.speedEdge === true, varOf)
    if (def !== undefined && card.berry !== undefined && !card.berry.triggers.includes(def.moveId)) {
      expect(viewCard, card.id).toBeUndefined()
      continue
    }
    shownLadder.push(card.id)
    expect(viewCard, card.id).toBeDefined()
    expect(viewCard?.shownItem, card.id).toBe(def?.key)
    expect(viewCard?.selected, card.id).toBe(false)
    // 보이는 항목의 행(예상): [행 id 또는 null(필터 1행), 변화 없음 범주 또는 null(변화 있음·오류), 오류]
    const want: { kind: NoChangeRow['kind'] | 'changing' | 'error'; moveId?: string; sweepStat?: StatId; fixed?: string; basis: string | null; rowId?: string }[] = []
    const sweepRow = (rowId: string) => {
      const spec = plan.rows[rowId]
      const moveId = spec.moveId
      const basis = meansKey(spec.basis)
      if (spec.error) return want.push({ kind: 'error', moveId, basis })
      const v = coreRowVar(plan, spec)
      if (v.kind === 'error') return want.push({ kind: 'error', moveId, basis })
      if (v.kind === 'fixed') return want.push({ kind: 'row', moveId, sweepStat: spec.sweep?.stat, fixed: v.cat, basis })
      want.push({ kind: 'changing', moveId, sweepStat: spec.sweep?.stat, basis, rowId })
    }
    if (def === undefined) for (const rowId of card.rowIds) sweepRow(rowId)
    else if (def.probe.kind === 'error') want.push({ kind: 'error', moveId: def.moveId, basis: meansKey(def.basis) })
    else if (def.cand.target === 'row') sweepRow(def.cand.id)
    else if (def.cand.target === 'fixed') {
      const v = varOf(def)
      if (v.kind === 'fixed') want.push({ kind: 'sp-independent', moveId: def.moveId, fixed: v.cat, basis: null })
      else want.push({ kind: 'error', moveId: def.moveId, basis: null })
    } else {
      const filterId = def.cand.id
      const ex = coreExtreme(plan.filters[filterId])
      if (ex === null) want.push({ kind: 'error', moveId: def.moveId, basis: meansKey(def.basis) })
      else if (ex.low === ex.high) want.push({ kind: 'extreme-filter', moveId: def.moveId, fixed: ex.low, basis: meansKey(def.basis) })
      else for (const rowId of card.rowIds) if (plan.rows[rowId].gate === filterId) sweepRow(rowId)
    }
    expect(viewCard?.rows.length, card.id).toBe(want.length)
    const noChange = want.filter((w) => w.kind === 'row' || w.kind === 'extreme-filter' || w.kind === 'sp-independent')
    const actual = noChangeRows(view).filter((i) => i.cardId === card.id)
    expect(actual.map((i) => JSON.stringify([i.kind, i.moveId ?? null, i.sweepStat ?? null, i.fixed, meansKey(i.basis)])).sort(), card.id).toEqual(
      noChange.map((w) => JSON.stringify([w.kind, w.moveId ?? null, w.sweepStat ?? null, w.fixed, w.basis])).sort(),
    )
    noChangeCount += noChange.length
    for (const w of want) {
      if (w.kind === 'error') expect(viewCard?.rows.some((r) => r.status === 'error' && r.moveId === w.moveId), card.id).toBe(true)
      if (w.kind !== 'changing' || w.rowId === undefined) continue
      const spec = plan.rows[w.rowId]
      const r = coreSweep(spec) as SweepResult<unknown>
      const row = viewCard?.rows.find((x) => x.id === w.rowId)
      expect(row, w.rowId).toBeDefined()
      expect(row?.cells.map((x) => x.category), w.rowId).toEqual(categoriesOf(r))
      expect(row?.boundaries.map((b) => b.sp), w.rowId).toEqual(r.boundaries)
    }
    if (want.every((w) => w.kind !== 'changing' && w.kind !== 'error')) {
      // 보이는 항목의 행이 모두 변화 없음: 대표 행은 그 행이고 "변동 가능"이 아니다.
      expect(viewCard?.headline.kind, card.id).toBe('row')
      expect(viewCard?.variable, card.id).toBe(false)
      allSame++
    }
  }
  expect(view.cards.filter((c) => c.opponent.source === 'ladder').map((c) => c.id)).toEqual(plan.cards.map((c) => c.id).filter((id) => shownLadder.includes(id)))
  return { items: noChangeCount, cards: emptyCards, allSame }
}

// ---------- AC 1·F9 예시 세트 ----------

describe('AC1 예시 세트(F9): 세 탭 모두 표시 카드가 있다', () => {
  it.each(TABS)('%s', (tab) => {
    const { view } = run('example', top(EXAMPLE_SET), tab)
    expect(view.status).toEqual({ kind: 'ok' })
    expect(view.cards.length).toBeGreaterThan(0)
  })

  it('공격 탭 스톤샤워·스피드 탭 기본 행 경계 = 코어', () => {
    const atk = run('example', top(EXAMPLE_SET), 'attack')
    const { card } = cardBySpread(atk.plan, atk.view, F9.attack.opponent, 'physical')
    const row = shownRow(card, (r) => r.kind === 'base' && r.moveId === F9.attack.move)
    const direct = sweepDamage(game, { side: 'attacker', stat: 'atk' }, EXAMPLE_SET, opponentSet(bo1, F9.attack.opponent), F9.attack.move, undefined, undefined, OVER)
    expect(rowBoundaries(row)).toEqual(boundariesOf(direct))

    const spd = run('example', top(EXAMPLE_SET), 'speed')
    const s = cardBySpread(spd.plan, spd.view, F9.speed.opponent, null)
    const base = shownRow(s.card, (r) => r.kind === 'base')
    expect(rowBoundaries(base)).toEqual(boundariesOf(sweepSpeed(game, EXAMPLE_SET, opponentSet(bo1, F9.speed.opponent), undefined, OVER)))
  })
})

// ---------- AC 2 공격 탭 고정 입력(F1) ----------

describe('AC2 공격 탭 고정 입력(F1)', () => {
  for (const which of ['full', 'spare'] as const) {
    it(`${which}: 카드 순서는 변화 있는 상대의 사용률 순, 현재 판정·경계·n = 코어·정의식`, () => {
      const mySet = F1[which]
      const { plan, view } = run(`F1-${which}`, top(mySet), 'attack')
      const current = mySet.sp[F1.sweepStat]
      const remaining = spTotal - STAT_IDS.reduce((s, k) => s + mySet.sp[k], 0)
      expect(remaining).toBe(F1.remaining[which])

      // 기준 이상 전부(상한 없음) + 변화 없음 배분도 선택지라 표시 카드는 고정 목록보다 많다. 고정 목록은 그 안에 같은 순서로 있다.
      const shownKeys = view.cards.map((c) => JSON.stringify([c.opponent.id, c.bundle.representativeSpread]))
      const at = F1.cards.map((c) => shownKeys.indexOf(JSON.stringify([c.opponent.id, c.opponent.spread])))
      expect(at.every((i) => i >= 0)).toBe(true)
      expect([...at].sort((a, b) => a - b)).toEqual(at)
      expect(view.cards.length).toBeGreaterThan(F1.cards.length)
      const ranks = view.cards.map((c) => c.opponent.rank as number)
      expect([...ranks].sort((a, b) => a - b)).toEqual(ranks)

      for (const ref of F1.cards) {
        const { card } = cardBySpread(plan, view, ref.opponent, 'physical')
        const row = shownRow(card, (r) => r.kind === 'base' && r.moveId === F1.move)
        const direct = sweepDamage(game, { side: 'attacker', stat: F1.sweepStat }, mySet, opponentSet(bo1, ref.opponent), F1.move, undefined, undefined, OVER)
        const at = direct.cells[current]
        expect(row.current).toEqual({ sp: current, category: at.kind === 'ok' ? at.category : undefined })
        expect(rowBoundaries(row)).toEqual(boundariesOf(direct))
        expect(row.boundaries.map((b) => b.need)).toEqual(row.boundaries.map((b) => Math.max(0, b.sp - current - remaining)))
        expect(row.boundaries.map((b) => b.delta)).toEqual(row.boundaries.map((b) => b.sp - current))
        for (const cell of row.cells) {
          expect(cell.need).toBe(Math.max(0, cell.sp - current - remaining))
          expect(cell.overBudget).toBe(cell.sp > current + remaining)
        }
        // 고정 상수(notes 기록)와도 같다.
        expect(rowBoundaries(row)).toEqual(ref.boundaries)
        expect(row.boundaries.map((b) => b.need)).toEqual(ref.need[which])
        expect(row.current.category).toBe(ref.current)
      }
    })
  }

  it('변화 없는 래더 카드·행도 목록에 남고(변동 가능 아님) 행·칸이 코어 재판정과 같다', () => {
    const { plan, view } = run('F1-full', top(F1.full), 'attack')
    const n = expectMatchesCore(plan, view)
    expect(n.allSame).toBeGreaterThan(0)
    expect(n.items).toBeGreaterThan(0)
  })
})

// ---------- AC 3 묶음 ----------

/** 보존 배분을 키 능력치(SP, 성격 보정)로 직접 묶은 점유율(내림차순). */
function directBundles(entry: MetaEntry, keyStats: readonly StatId[]): { stats: string; share: number }[] {
  const groups = new Map<string, number>()
  for (const [key, share] of entry.spreads.kept) {
    const { nature, sp } = parseSpreadKey(key)
    const n = game.data.natures[nature]
    const stats = STAT_IDS.filter((s) => keyStats.includes(s)).map((s) => {
      const m = natureMultiplier(n, s)
      return [s, sp[s], m > 1 ? 'plus' : m < 1 ? 'minus' : 'neutral']
    })
    const k = JSON.stringify(stats)
    groups.set(k, (groups.get(k) ?? 0) + share)
  }
  return [...groups.entries()].map(([stats, share]) => ({ stats, share: Math.round(share * 1e4) / 1e4 })).sort((a, b) => b.share - a.share)
}
const statsKey = (c: CardSpec) => JSON.stringify(c.bundle.stats.map((s) => [s.stat, s.sp, s.nature]))

describe('AC3 묶음(실제 스냅샷 예시)', () => {
  it('공격 물리 카드: 한카리아스 H·B 묶음 점유율 = 보존 배분 합, 기준(기본 5%) 이상 전부(상한 없음), 보존률, 관련 능력치는 H·B만', () => {
    const { plan } = run('F1-full', top(F1.full), 'attack')
    const e = entryOf(bo1, 'garchomp')
    const expected = directBundles(e, ['hp', 'def']).filter((b) => b.share >= DEFAULT_CRITERIA.bundleShareMin)
    // 상한이 없다: 기준을 0.5%로 낮추면 상한이 있던 시절(3장)보다 선택지가 많다(실제 스냅샷).
    const low = run('F1-full-bundle-0.005', only(F1.full, ['garchomp'], { criteria: { ...DEFAULT_CRITERIA, bundleShareMin: 0.005 } }), 'attack').plan
    const lowExpected = directBundles(e, ['hp', 'def']).filter((b) => b.share >= 0.005)
    expect(lowExpected.length).toBeGreaterThan(3)
    expect(low.cards.filter((c) => c.category === 'physical').map((c) => [statsKey(c), c.bundle.share])).toEqual(lowExpected.map((b) => [b.stats, b.share]))
    const cards = plan.cards.filter((c) => c.opponent.id === 'garchomp' && c.category === 'physical')
    expect(cards.map((c) => [statsKey(c), c.bundle.share])).toEqual(expected.map((b) => [b.stats, b.share]))
    expect(cards[0].bundle.share).toBe(F1.cards.find((c) => c.opponent.id === 'garchomp')?.bundleShare)
    for (const c of cards) {
      expect(c.bundle.stats.map((s) => s.stat)).toEqual(['hp', 'def'])
      expect(c.bundle.retention).toBe(e.spreads.keptShare)
      expect(c.bundle.minority).toBe(false)
    }
  })

  it('방어 특수 카드: 메가플라엣테 묶음은 상대 C만', () => {
    const { plan } = run('example', top(EXAMPLE_SET), 'defense')
    const cards = plan.cards.filter((c) => c.opponent.id === F3.bothOhko.opponent.id && c.category === 'special')
    expect(cards.length).toBeGreaterThan(0)
    for (const c of cards) expect(c.bundle.stats.map((s) => s.stat)).toEqual(['spa'])
    const expected = directBundles(entryOf(bo1, 'floettemega'), ['spa']).filter((b) => b.share >= DEFAULT_CRITERIA.bundleShareMin)
    expect(cards.map((c) => [statsKey(c), c.bundle.share])).toEqual(expected.map((b) => [b.stats, b.share]))
  })

  it('포켓몬·분류당 카드 = 기준 이상 묶음 수(없으면 소수 배분 1장), 모든 관측 카드 점유율 ≥ 기준(기본 5%) 또는 소수 배분', () => {
    let over3 = 0
    for (const tab of TABS) {
      const { plan } = run('example', top(EXAMPLE_SET), tab)
      const count = new Map<string, number>()
      for (const c of plan.cards) {
        if (c.opponent.source !== 'ladder') continue
        expect(c.bundle.minority || (c.bundle.share ?? 0) >= DEFAULT_CRITERIA.bundleShareMin, c.id).toBe(true)
        const k = JSON.stringify([c.opponent.id, c.category])
        count.set(k, (count.get(k) ?? 0) + 1)
      }
      over3 += [...count.values()].filter((n) => n > 3).length
    }
    expect(over3).toBeGreaterThan(0)
  })
})

// ---------- AC 4 혼합 세트(F2) ----------

describe('AC4 혼합 세트·사이코쇼크(F2)', () => {
  it('같은 상대가 물리(H·B)·특수(H·D) 카드로 나뉘고 사이코쇼크는 물리 카드 행이다', () => {
    const { plan, view } = run('F2', top(F2.mySet), 'attack')
    const moves = (c: CardSpec) => [...new Set(c.rowIds.map((id) => plan.rows[id].moveId))]
    const kommoo = (category: CardSpec['category']) => plan.cards.filter((c) => c.opponent.id === F2.opponent && c.category === category)
    for (const c of kommoo('physical')) {
      expect(c.bundle.stats.map((s) => s.stat)).toEqual(['hp', 'def'])
      expect(moves(c).sort()).toEqual(['drainpunch', 'psyshock'])
    }
    for (const c of kommoo('special')) {
      expect(c.bundle.stats.map((s) => s.stat)).toEqual(['hp', 'spd'])
      expect(moves(c)).toEqual(['psychic'])
    }
    const phys = cardBySpread(plan, view, F2.physical.opponent, 'physical')
    const spec = cardBySpread(plan, view, F2.special.opponent, 'special')
    for (const [side, card] of [
      [F2.physical, phys.card],
      [F2.special, spec.card],
    ] as const) {
      const row = shownRow(card, (r) => r.kind === 'base' && r.moveId === side.move)
      const direct = sweepDamage(game, { side: 'attacker', stat: F2.sweepStat }, F2.mySet, opponentSet(bo1, side.opponent), side.move, undefined, undefined, OVER)
      expect(rowBoundaries(row)).toEqual(boundariesOf(direct))
      expect(rowBoundaries(row)).toEqual(side.boundaries)
    }
    const psyshock = shownRow(phys.card, (r) => r.moveId === 'psyshock' && r.kind === 'base')
    expect(psyshock.refs).toMatchObject({ category: 'Special', defense: 'def' })
  })

  it('항목은 그 분류 카드의 기술만이고, 처음 보이는 배분은 분류별 기본 항목을 견줘 정한다: 짜랑고우거는 특수기 사이코키네시스가 무투자 확정1타라 특수 배분이 기본(PRD R4·R6)', () => {
    const { plan, view } = run('F2', top(F2.mySet), 'attack')
    const c = cardBySpread(plan, view, F2.crossDropped.opponent, 'physical')
    const base = c.spec.conditions.find((g) => g.id === JSON.stringify(['base']))
    expect(base?.candidates.map((x) => [x.moveId, x.target])).toEqual([
      ['psyshock', 'row'],
      ['drainpunch', 'row'],
    ])
    // 물리 카드도 보인다(이전: 다른 분류 기술이 가장 세면 이 카드는 빠졌다)
    expect(c.card).toBeDefined()
    const [group] = groupCards(view.cards.filter((v) => v.opponent.id === F2.crossDropped.opponent.id && v.berry === undefined), 'attack')
    expect(defaultOption(group).category).toBe('special')
    expect(groupItems(group)[0].item.moveId).toBe('psychic')
    expect(new Set(groupItems(group).map((g) => g.item.moveId))).toEqual(new Set(['psychic', 'psyshock', 'drainpunch']))
  })

  it('분류마다 카드 = 그 분류 키(H·B / H·D)로 묶은 기준 이상 묶음 전부', () => {
    const { plan } = run('F2', top(F2.mySet), 'attack')
    const e = entryOf(bo1, F2.opponent)
    for (const category of ['physical', 'special'] as const) {
      const cards = plan.cards.filter((c) => c.opponent.id === F2.opponent && c.category === category)
      const expected = directBundles(e, ['hp', category === 'physical' ? 'def' : 'spd']).filter((b) => b.share >= DEFAULT_CRITERIA.bundleShareMin)
      expect(cards.length).toBeGreaterThan(0)
      expect(cards.map((c) => [statsKey(c), c.bundle.share])).toEqual(expected.map((b) => [b.stats, b.share]))
    }
  })
})

// ---------- AC 5 방어 극단 필터(F3) ----------

/** 오라클용 내 특성 보정(PRD R2 목록): 무효 0, 반감 0.5. 상대 틀깨기 계열이면 보지 않는다. */
const ORACLE_IMMUNE: Record<string, (type: string, flags: readonly string[]) => boolean> = {
  levitate: (t) => t === 'Ground',
  eartheater: (t) => t === 'Ground',
  waterabsorb: (t) => t === 'Water',
  stormdrain: (t) => t === 'Water',
  dryskin: (t) => t === 'Water',
  voltabsorb: (t) => t === 'Electric',
  lightningrod: (t) => t === 'Electric',
  motordrive: (t) => t === 'Electric',
  flashfire: (t) => t === 'Fire',
  sapsipper: (t) => t === 'Grass',
  soundproof: (_t, f) => f.includes('sound'),
}
const ORACLE_HALVED: Record<string, string[]> = { thickfat: ['Fire', 'Ice'], heatproof: ['Fire'], waterbubble: ['Fire'], purifyingsalt: ['Ghost'] }

/** 방어 탭 래더 상대 기본 후보(PRD R2): 변화기 제외 · 사용률 ≥ 5% · 나에게 1배 이상, 없으면 사용률 1위 하나(동률 id 순). */
function defenseCandidates(view: MetaView, e: MetaEntry, mySet: PokemonSet): string[] {
  const me = validateSet(game, mySet)
  const oppSet = representativeAssumption(view, e.id).set
  const opp = validateSet(game, oppSet).ability
  const ranked = Object.entries(e.moves.shares)
    .filter(([m]) => !game.data.moves[m] || game.data.moves[m].category !== 'Status')
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
  const factor = (m: string): number => {
    const move = game.data.moves[m]
    const type = attackMoveType(m, move.type, opp)
    const eff = attackEffectiveness(type, me.species.types, opp, m)
    if (['moldbreaker', 'turboblaze', 'teravolt'].includes(opp)) return eff
    if (ORACLE_IMMUNE[me.ability]?.(type, move.flags)) return 0
    return ORACLE_HALVED[me.ability]?.includes(type) ? eff / 2 : eff
  }
  const hit = ranked.filter(([m, share]) => share >= 0.05 && (!game.data.moves[m] || factor(m) >= 1)).map(([m]) => m)
  return hit.length > 0 ? hit : ranked.slice(0, 1).map(([m]) => m)
}

describe('AC5 방어 탭 극단 필터(F3)', () => {
  it('둘 다 확정견딤·둘 다 확정1타(낮은 극단 무보정, 높은 극단 상승 성격) → 변화 없음 1행(고정 판정 = 코어 두 극단)', () => {
    const { plan, view } = run('example', top(EXAMPLE_SET), 'defense')
    for (const c of [F3.bothSurvive, F3.bothOhko]) {
      const { spec, card } = cardBySpread(plan, view, c.opponent, game.data.moves[c.move].category === 'Physical' ? 'physical' : 'special')
      // H행·B/D행 쌍 대신 극단 필터 1행만(칸 없음, 변화 없음)
      expect(card?.rows.filter((r) => r.moveId === c.move && r.kind === 'base').map((r) => [r.noChange, r.cells.length])).toEqual([[true, 0]])
      const item = noChangeRows(view).find((i) => i.cardId === spec.id && i.kind === 'extreme-filter' && i.moveId === c.move && i.rowKind === 'base')
      expect(item?.fixed, c.move).toBe(c.low)
      const attacker = opponentSet(bo1, c.opponent)
      const stat = game.data.moves[c.move].category === 'Physical' ? 'def' : 'spd'
      const at = (v: number, nature: string) =>
        judgeDamage(game, 'defender', attacker, withSp({ ...EXAMPLE_SET, nature }, { hp: v, [stat]: v }), c.move, undefined, undefined, IGNORE_TOTAL).category
      expect([at(0, EXAMPLE_SET.nature), at(spMaxPerStat, F3.plusNature[stat])]).toEqual([item?.fixed, item?.fixed])
      const filter = plan.filters[spec.filterIds.find((id) => plan.filters[id].moveId === c.move && plan.filters[id].basis === undefined) ?? '']
      expect(filter.natures).toEqual({ stat, neutral: EXAMPLE_SET.nature, plus: F3.plusNature[stat] })
    }
  })

  it('현재 성격 두 극단이 같아도 상승 성격 높은 극단이 다르면 통과해 H 행·D 행이 생긴다(그 항목을 보일 때)', () => {
    const { plan, view } = run('example', top(EXAMPLE_SET), 'defense')
    // F3.plusOnly(문포스): 기본 조건 항목과 명상 랭크 후 항목이 모두 목록에 있다(파멸의빛은 동시채용 하한 미달이라 명상 조건이 없다)
    const weaker = cardBySpread(plan, view, F3.plusOnly.opponent, 'special')
    const calm = JSON.stringify(['rank', 'opponent', 'move', 'calmmind'])
    const keys = new Set(weaker.card?.items.map((i) => i.key))
    expect(keys.has(itemKey(F3.plusOnly.move, BASE_CONDITION_ID))).toBe(true)
    expect(keys.has(itemKey(F3.plusOnly.move, calm))).toBe(true)
    expect(keys.has(itemKey('lightofruin', calm))).toBe(false)
    const c = F3.plusOnlyStrongest
    const sel = new Map([[opponentKey({ source: 'ladder', id: c.opponent.id }), itemKey(c.move, BASE_CONDITION_ID)]])
    const chosen = buildTabView(only(EXAMPLE_SET, [c.opponent.id]), 'defense', cache, sel)
    const { spec } = cardBySpread(plan, view, c.opponent, 'special')
    const card = chosen.cards.find((x) => x.id === spec.id)
    expect(card?.selected).toBe(true)
    expect(noChangeRows(chosen).some((i) => i.cardId === spec.id && i.kind === 'extreme-filter' && i.moveId === c.move)).toBe(false)
    // 필터를 통과했으니 H 행·D 행이 각각 나온다(행마다 변화 있음 또는 변화 없음)
    const shown = (card?.rows ?? []).filter((r) => r.moveId === c.move && r.kind === 'base').map((r) => r.sweepStat)
    expect([...shown].sort()).toEqual(['hp', 'spd'])
  })

  it('현재 성격으로는 전 칸 같고 상승 성격으로만 바뀌는 래더 행은 표시된다(공격 탭 F1 메가눈여아)', () => {
    const { plan, view } = run('F1-full', top(F1.full), 'attack')
    const { card } = cardBySpread(plan, view, F1.plusOnly.opponent, 'physical')
    const row = shownRow(card, (r) => r.kind === 'base' && r.moveId === F1.move)
    expect(row.noChange).toBe(false)
    expect(row.boundaries).toEqual([])
    expect(new Set(row.cells.map((x) => x.category))).toEqual(new Set([F1.plusOnly.fixed]))
    expect(row.target).toEqual({
      label: F1.plusOnly.label,
      goal: 'better',
      plusStat: 'atk',
      neutral: null,
      plus: { label: F1.plusOnly.label, stats: [{ stat: 'atk', sp: F1.plusOnly.plus }], need: Math.max(0, F1.plusOnly.plus - F1.full.sp.atk - F1.remaining.full) },
    })
    expect(card?.headline).toEqual({ kind: 'row', rowId: row.id })
  })

  it('현재·무보정·상승 모두 같은 래더 행도 변화 없음 행으로 카드에 남고, 대표 행이지만 변동 가능이 아니다(F1 대도각참)', () => {
    const { plan, view } = run('F1-full', top(F1.full), 'attack')
    const { spec, card } = cardBySpread(plan, view, F1.bothSame.opponent, 'physical')
    expect(noChangeRows(view).filter((i) => i.cardId === spec.id).map((i) => [i.kind, i.moveId, i.fixed])).toEqual([['row', F1.move, F1.bothSame.fixed]])
    const row = shownRow(card, (r) => r.kind === 'base' && r.moveId === F1.move)
    expect(card?.headline).toEqual({ kind: 'row', rowId: row.id })
    expect(card?.variable).toBe(false)
    expect(row.cells).toHaveLength(33)
  })

  it('필터를 통과한 기술은 H 행·B 행으로 나오고 경계 = 코어', () => {
    const { plan, view } = run('example', top(EXAMPLE_SET), 'defense')
    const { card } = cardBySpread(plan, view, F3.passing.opponent, 'physical')
    const attacker = opponentSet(bo1, F3.passing.opponent)
    for (const [stat, fixed] of [
      ['hp', F3.passing.hpBoundaries],
      ['def', F3.passing.defBoundaries],
    ] as const) {
      const row = shownRow(card, (r) => r.kind === 'base' && r.moveId === F3.passing.move && r.sweepStat === stat)
      const direct = sweepDamage(game, { side: 'defender', stat }, attacker, EXAMPLE_SET, F3.passing.move, undefined, undefined, OVER)
      expect(rowBoundaries(row)).toEqual(boundariesOf(direct))
      expect(rowBoundaries(row)).toEqual(fixed)
    }
  })

  // "둘 다 저난수 1타"의 실데이터 부재는 __fixtures__/acceptance.test.ts의 전수 탐색이, 분기 표시는 handPlan 조립 테스트가 봉인한다.

  it('래더 카드 항목·판정 행의 상대 기술은 기본 후보(변화기 제외·사용률 5% 이상·나에게 1배 이상, 없으면 1위) 안이고 기본 후보는 모두 항목이다', () => {
    const { plan, view } = run('example', top(EXAMPLE_SET), 'defense')
    const used = view.cards.filter((c) => c.opponent.source === 'ladder').flatMap((c) => c.rows.map((r) => [c.opponent.id, r.moveId] as const))
    expect(used.length).toBeGreaterThan(0)
    for (const [id, move] of used) expect(defenseCandidates(bo1, entryOf(bo1, id), EXAMPLE_SET), id).toContain(move)
    const ids = new Set(plan.cards.filter((c) => c.opponent.source === 'ladder').map((c) => c.opponent.id))
    for (const id of ids) {
      const items = new Set(plan.cards.filter((c) => c.opponent.id === id).flatMap((c) => c.conditions.flatMap((g) => g.candidates.map((x) => x.moveId))))
      expect(items, id).toEqual(new Set(defenseCandidates(bo1, entryOf(bo1, id), EXAMPLE_SET)))
    }
  })

  it('표시 카드·변화 없음 행·표시 행 칸 = 코어 재판정(극단 필터 1건 = 1행)', () => {
    const { plan, view } = run('example', top(EXAMPLE_SET), 'defense')
    expect(expectMatchesCore(plan, view).items).toBeGreaterThan(0)
  })
})

// ---------- AC 6 변화 없음 행(목록에서 빼지 않는다, 사용자 피드백 2026-11-12) ----------

const kingambitFoul = (moves: string[]): PokemonSet => ({ ...F5.defiant.mySet, moves })

describe('AC6 변화 없음 행(목록에서 빼지 않는다)', () => {
  it.each(TABS)('예시 세트 %s 탭: 표시 카드·변화 없음 행 = 코어 재판정, 행이 남는 래더 카드는 판정 변화와 무관하게 전부 보인다', (tab) => {
    const { plan, view } = run('example', top(EXAMPLE_SET), tab)
    const n = expectMatchesCore(plan, view)
    // 예시 세트 실데이터: 모든 행이 변화 없음인 래더 카드가 있다(예전 정책이면 목록에서 빠지던 카드).
    expect(n.allSame, tab).toBeGreaterThan(0)
    // 상위 N 래더 상대는 모두 목록에 있다(상대마다 적어도 한 카드).
    const ladder = new Set(view.cards.filter((c) => c.opponent.source === 'ladder').map((c) => c.opponent.id))
    expect([...new Set(plan.cards.filter((c) => c.opponent.source === 'ladder').map((c) => c.opponent.id))].filter((id) => !ladder.has(id)), tab).toEqual([])
  })

  it('내 SP 무관(속임수) 1건 = 1행: 모든 래더 카드가 고정 판정 1행으로 보이고 변동 가능이 아니다', () => {
    const { plan, view } = run('foul-only', top(kingambitFoul(['foulplay'])), 'attack')
    const ok = plan.cards.filter((c) => c.opponent.source === 'ladder' && c.state === 'ok')
    expect(ok.every((c) => c.rowIds.length === 0 && c.fixedIds.length === 1)).toBe(true)
    const n = expectMatchesCore(plan, view)
    expect(n).toEqual({ items: ok.length, cards: 0, allSame: ok.length })
    const rows = noChangeRows(view)
    expect(rows.every((i) => i.kind === 'sp-independent')).toBe(true)
    // 칸이 없는 고정 판정 행도 결과 배지용 판정 칸(fixedCell)을 싣는다.
    for (const c of view.cards) for (const r of c.rows) expect(r.fixedCell?.category, r.id).toBe(r.current.category)
  })

  it('속임수 + 일반 기술: 속임수가 가장 세면 고정 판정 1행만, 아니면 속임수는 어디에도 없다', () => {
    const { plan, view } = run('foul-mixed', top(kingambitFoul(['foulplay', 'kowtowcleave']), { filters: { topN: 12, selected: [] } }), 'attack')
    expectMatchesCore(plan, view)
    const itemsOf = (id: string) => noChangeRows(view).filter((i) => i.cardId === id).map((i) => [i.kind, i.moveId])
    // 실데이터: 포푸니크 adamant:2/32/0/0/0/32는 속임수(최대 60.5%)가 도각참(55.4%)보다 세고, 키키링 quiet:10/0/13/30/13/0은 도각참이 확정1타
    const foul = cardBySpread(plan, view, { id: 'sneasler', spread: 'adamant:2/32/0/0/0/32' }, 'physical')
    expect(foul.card?.rows.map((r) => r.moveId)).toEqual(['foulplay'])
    expect(itemsOf(foul.spec.id)).toEqual([['sp-independent', 'foulplay']])
    const cleave = cardBySpread(plan, view, { id: 'farigiraf', spread: 'quiet:10/0/13/30/13/0' }, 'physical')
    expect(cleave.card?.rows.map((r) => r.moveId)).toEqual(['kowtowcleave'])
    expect(itemsOf(cleave.spec.id)).toEqual([])
  })

  it('목록 밖 커스텀 카드도 변화 없음 행이 카드 안에 남는다', () => {
    const target = { rosterId: F10.rosterId, moves: [...F10.moves], edits: {} }
    const { view } = run('custom-rotom', top(EXAMPLE_SET, { customTargets: [target] }), 'attack')
    const custom = view.cards.filter((c) => c.opponent.source === 'custom')
    expect(custom).toHaveLength(3)
    expect(custom.flatMap((c) => c.rows).some((r) => r.noChange)).toBe(true)
    for (const c of custom) expect(c.shownItem, c.id).toBe(c.defaultItem?.key)
  })
})

// ---------- AC 7 스피드 탭(F4) ----------

describe('AC7 스피드 탭 스카프·순풍(F4)', () => {
  it('스카프 ≥ 10% → 점유율 최대 S 묶음 카드에 스카프 행 1개(판정 = 코어)', () => {
    const { plan, view } = run('example', top(EXAMPLE_SET), 'speed')
    const { spec } = cardBySpread(plan, view, F4.scarf.opponent, null)
    const first = plan.cards.find((c) => c.opponent.id === F4.scarf.opponent.id)
    expect(first?.id).toBe(spec.id)
    const scarfRows = spec.rowIds.map((id) => plan.rows[id]).filter((r) => r.kind === 'scarf')
    expect(scarfRows).toHaveLength(1)
    expect(scarfRows[0].basis).toEqual({ kind: 'scarf', item: 'choicescarf', share: F4.scarf.scarfShare })
    const direct = sweepSpeed(game, EXAMPLE_SET, { ...opponentSet(bo1, F4.scarf.opponent), item: 'choicescarf' }, undefined, OVER)
    const item = noChangeRows(view).find((i) => i.cardId === spec.id && i.rowKind === 'scarf')
    expect(new Set(categoriesOf(direct))).toEqual(new Set([item?.fixed]))
    // 같은 종의 다른 묶음 카드에는 스카프 행이 없다.
    for (const c of plan.cards.filter((x) => x.opponent.id === F4.scarf.opponent.id && x.id !== spec.id)) {
      expect(c.rowIds.some((id) => plan.rows[id].kind === 'scarf')).toBe(false)
    }
  })

  it('스카프 < 10% → 스카프 행 없음', () => {
    const { view } = run('example', top(EXAMPLE_SET), 'speed')
    const rows = rowsFor(view, F4.noScarf.opponent.id)
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.some((r) => r.kind === 'scarf' || r.kind === 'non-scarf')).toBe(false)
  })

  it('대표 도구 스카프 → 스카프 아닌 행 1개(도구 = 스카프를 뺀 최다, 경계 = 코어)', () => {
    const { plan, view } = run('example', top(EXAMPLE_SET), 'speed')
    const { card } = cardBySpread(plan, view, F4.nonScarf.opponent, null)
    const rows = card?.rows.filter((r) => r.kind === 'non-scarf') ?? []
    expect(rows).toHaveLength(1)
    expect(rows[0].basis).toMatchObject({ kind: 'non-scarf', item: F4.nonScarf.item })
    const direct = sweepSpeed(game, EXAMPLE_SET, { ...opponentSet(bo1, F4.nonScarf.opponent), item: F4.nonScarf.item }, undefined, OVER)
    expect(rowBoundaries(rows[0])).toEqual(boundariesOf(direct))
    expect(rowBoundaries(rows[0])).toEqual(F4.nonScarf.boundaries)
  })

  it('내 순풍·상대 순풍을 켜면 현재 판정이 코어 판정대로 바뀐다', () => {
    const cases = [
      ['my', F4.myTailwind, { myTailwind: true, opponentTailwind: false }, { attacker: { tailwind: true }, defender: { tailwind: false } }],
      ['opp', F4.opponentTailwind, { myTailwind: false, opponentTailwind: true }, { attacker: { tailwind: false }, defender: { tailwind: true } }],
    ] as const
    for (const [label, c, conditions, battle] of cases) {
      const opp = opponentSet(bo1, c.opponent)
      const current = (v: TabView, p: TabPlan) => shownOrHidden(p, v, c.opponent)
      const off = run('example', top(EXAMPLE_SET), 'speed')
      const on = run(`tailwind-${label}`, top(EXAMPLE_SET, { conditions }), 'speed')
      expect(current(off.view, off.plan)).toBe(judgeSpeed(game, EXAMPLE_SET, opp).category)
      expect(current(on.view, on.plan)).toBe(judgeSpeed(game, EXAMPLE_SET, opp, battle as BattleConditions).category)
      expect([current(off.view, off.plan), current(on.view, on.plan)]).toEqual([c.off, c.on])
    }
  })
})

/** 스피드 탭 기본 행의 현재 판정(변화 없음 행도 카드 안에 있다). */
function shownOrHidden(plan: TabPlan, view: TabView, ref: OpponentRef): string | undefined {
  const { card } = cardBySpread(plan, view, ref, null)
  return card?.rows.find((r) => r.kind === 'base')?.current.category
}

// ---------- AC 8 랭크 행(F5) ----------

describe('AC8 랭크 행(F5)', () => {
  const intimidateRows = (view: TabView, id: string) =>
    rowsFor(view, id).filter((r) => r.basis?.kind === 'rank' && r.basis.means.id === F5.threat.ability && r.basis.owner === 'opponent')

  it('상대 위협·막말내뱉기(≥ 10%)는 공격 탭 랭크 행이 아니다(내 오기 발동 "+1" 행 없음, 2026-11-12 능동 랭크업만)', () => {
    for (const [label, s] of [
      ['defiant', F5.defiant],
      ['non-defiant', F5.nonDefiant],
    ] as const) {
      const { plan, view } = run(`F5-${label}`, only(s.mySet, [F5.threat.opponent]), 'attack')
      expect(rowsFor(view, F5.threat.opponent).length, label).toBeGreaterThan(0)
      expect(intimidateRows(view, F5.threat.opponent), label).toEqual([])
      expect(Object.values(plan.rows).some((r) => r.basis?.kind === 'rank'), label).toBe(false)
      expect(Object.values(plan.rows).some((r) => r.basis?.kind === 'rank' && r.basis.reactions.includes('defiant')), label).toBe(false)
    }
  })

  it('내 칼춤 랭크 행 칸 = 같은 랭크를 넣은 코어 스윕(어흥염 상대)', () => {
    const s = F5.swordsDance
    const { plan, view } = run('F5-sd-core', only(s.mySet, [F5.threat.opponent]), 'attack')
    const shown = view.cards.flatMap((c) => c.rows.filter((x) => x.kind === 'rank' && x.cells.length > 0))
    expect(shown.length).toBeGreaterThan(0)
    for (const card of view.cards) {
      const spec = plan.cards.find((c) => c.id === card.id) as CardSpec
      for (const r of card.rows.filter((x) => x.kind === 'rank' && x.cells.length > 0)) {
        const b = r.basis as RankBasis
        const direct = sweepDamage(
          game,
          { side: 'attacker', stat: r.sweepStat as StatId },
          { ...s.mySet, boosts: b.myBoosts },
          { ...spec.opponentSet, boosts: b.opponentBoosts },
          r.moveId as string,
          { attacker: { tailwind: false }, defender: { tailwind: false } },
          undefined,
          OVER,
        )
        expect(r.cells.map((c) => c.category)).toEqual(categoriesOf(direct))
      }
    }
  })

  it('내 칼춤 → 공격 탭 물리 카드마다 A+2 랭크 행(점유율 없음), 칼춤이 없으면 없다', () => {
    const ids = [F5.threat.opponent, 'sneasler']
    const sd = run('F5-sd', only(F5.swordsDance.mySet, ids), 'attack')
    const plain = run('F5-sd-none', only(F5.defiant.mySet, ids), 'attack')
    const sdRows = (plan: TabPlan) => (c: CardSpec) =>
      c.rowIds.map((id) => plan.rows[id]).filter((r) => r.basis?.kind === 'rank' && r.basis.owner === 'me' && r.basis.means.id === 'swordsdance')
    for (const c of sd.plan.cards.filter((x) => x.category === 'physical' && x.state === 'ok')) {
      const rows = sdRows(sd.plan)(c)
      expect(rows.length, c.id).toBeGreaterThan(0)
      for (const r of rows) {
        const b = r.basis as RankBasis
        expect(b.myBoosts.atk).toBe(F5.swordsDance.myBoosts.atk)
        expect(b.share).toBeUndefined()
      }
    }
    for (const c of plain.plan.cards) expect(sdRows(plain.plan)(c)).toEqual([])
  })
})

// ---------- AC 10 상위 N·선택 ----------

describe('AC10 상위 N·포켓몬 선택', () => {
  const target = { rosterId: F10.rosterId, moves: [...F10.moves], edits: {} }
  const ladderIds = (view: TabView) =>
    new Set(view.cards.filter((c) => c.opponent.source === 'ladder').map((c) => c.opponent.id))

  it('상위 10 → 래더 카드는 사용률 상위 10마리만, 커스텀은 유지', () => {
    const { view } = run('top10', top(EXAMPLE_SET, { filters: { topN: 10, selected: [] }, customTargets: [target] }), 'speed')
    expect(ladderIds(view)).toEqual(new Set(bo1.ranking.slice(0, 10).map((e) => e.id)))
    expect(view.cards.filter((c) => c.opponent.source === 'custom')).toHaveLength(3)
  })

  it('선택 2마리 → 래더 카드는 그 2마리만, 커스텀은 유지', () => {
    const ids = ['incineroar', 'basculegion']
    const { view } = run('select2', only(EXAMPLE_SET, ids, { customTargets: [target] }), 'speed')
    expect(ladderIds(view)).toEqual(new Set(ids))
    expect(view.cards.filter((c) => c.opponent.source === 'custom')).toHaveLength(3)
  })
})

// ---------- AC 11 목록 밖 타겟(F6·F10) ----------

describe('AC11 목록 밖 타겟(F6·F10)', () => {
  const target = { rosterId: F10.rosterId, moves: [...F10.moves], edits: {} }
  const customCards = (view: TabView) => view.cards.filter((c) => c.opponent.source === 'custom')

  it('공격 탭: 분류마다 프리셋 3장, 점유율·보존률·통계 배분 없음, 행 칸 = 코어', () => {
    const { plan, view } = run('custom-rotom', top(EXAMPLE_SET, { customTargets: [target] }), 'attack')
    const cards = customCards(view)
    expect(cards.map((c) => [c.opponent.id, c.category, c.bundle.presetIndex])).toEqual([
      [F10.rosterId, 'physical', 0],
      [F10.rosterId, 'physical', 1],
      [F10.rosterId, 'physical', 2],
    ])
    for (const c of cards) {
      expect(c.opponent).toEqual({ id: F10.rosterId, source: 'custom' })
      expect(c.bundle.share).toBeUndefined()
      expect(c.bundle.retention).toBeUndefined()
      expect(c.bundle.representativeSpread).toBeUndefined()
      const spec = plan.cards.find((x) => x.id === c.id) as CardSpec
      expect(spec.opponentSet.species).toBe(F10.rosterId)
      expect(spec.opponentSet.moves).toEqual(F10.moves)
      for (const r of c.rows.filter((x) => x.kind === 'base')) {
        const direct = sweepDamage(game, { side: 'attacker', stat: 'atk' }, EXAMPLE_SET, spec.opponentSet, r.moveId as string, undefined, undefined, OVER)
        expect(r.cells.map((x) => x.category)).toEqual(categoriesOf(direct))
        expect(r.noChange).toBe(new Set(categoriesOf(direct)).size === 1)
      }
    }
  })

  it('방어 탭: 분류마다 프리셋 3장이 모두 보이고, 하이드로펌프가 폴터가이스트보다 세 처음 보이는 배분은 특수 프리셋 1(PRD R7 목록 밖 타겟)', () => {
    const { plan, view } = run('custom-rotom', top(EXAMPLE_SET, { customTargets: [target] }), 'defense')
    const planned = plan.cards.filter((c) => c.opponent.source === 'custom')
    expect(planned.map((c) => [c.category, c.bundle.presetIndex])).toEqual([
      ['physical', 0],
      ['physical', 1],
      ['physical', 2],
      ['special', 0],
      ['special', 1],
      ['special', 2],
    ])
    // 물리 카드의 대표 세트(프리셋)로 코어를 직접 불러도 하이드로펌프가 폴터가이스트보다 세다(1타 확률 → 최대 대미지 비율).
    for (const c of planned.filter((x) => x.category === 'physical')) {
      const score = (move: string) => {
        const v = judgeDamage(game, 'defender', c.opponentSet, EXAMPLE_SET, move, undefined, undefined, { rollSteps: N }).value
        return v.kind === 'damage' ? [v.ohkoChance, v.maxPercent] : [-1, -1]
      }
      const [hp, hm] = score(F10.special)
      const [pp, pm] = score(F10.physical)
      expect(hp > pp || (hp === pp && hm > pm), c.id).toBe(true)
    }
    const all = customCards(view)
    expect(all.map((c) => [c.category, c.bundle.presetIndex])).toEqual([
      ['physical', 0],
      ['physical', 1],
      ['physical', 2],
      ['special', 0],
      ['special', 1],
      ['special', 2],
    ])
    const [group] = groupCards(all, 'defense')
    expect([defaultOption(group).category, defaultOption(group).bundle.presetIndex]).toEqual(['special', 0])
    for (const c of all.filter((x) => x.category === 'physical')) expect(c.rows.map((r) => r.moveId)).toEqual(expect.arrayContaining([F10.physical]))
    const cards = all.filter((x) => x.category === 'special')
    for (const c of cards) {
      const moves = new Set(c.rows.map((r) => r.moveId))
      const want = c.category === 'physical' ? 'Physical' : 'Special'
      expect(F10.moves.filter((m) => game.data.moves[m].category === want)).toEqual(expect.arrayContaining([...moves]))
      expect([...moves]).toEqual([F10.special])
      const spec = plan.cards.find((x) => x.id === c.id) as CardSpec
      for (const r of c.rows.filter((x) => x.cells.length > 0 && x.kind === 'base')) {
        const direct = sweepDamage(game, { side: 'defender', stat: r.sweepStat as StatId }, spec.opponentSet, EXAMPLE_SET, r.moveId as string, undefined, undefined, OVER)
        expect(r.cells.map((x) => x.category)).toEqual(categoriesOf(direct))
      }
    }
  })

  it('스피드 탭: 타겟 기술의 상대 하락기(일렉트릭네트)는 랭크 행이 아니고(능동 랭크업만), 기본 행 판정 = 코어', () => {
    const { plan, view } = run('custom-rotom', top(EXAMPLE_SET, { customTargets: [target] }), 'speed')
    const cards = customCards(view)
    expect(cards).toHaveLength(3)
    for (const c of cards) {
      expect(c.rows.filter((r) => r.kind === 'rank')).toEqual([])
      expect(Object.values(plan.rows).some((r) => r.cardId === c.id && r.basis?.kind === 'rank' && r.basis.means.id === F10.rankMeans)).toBe(false)
      const base = c.rows.filter((r) => r.kind === 'base')
      expect(base).toHaveLength(1)
      const spec = plan.cards.find((x) => x.id === c.id) as CardSpec
      const direct = sweepSpeed(game, EXAMPLE_SET, spec.opponentSet, undefined, OVER)
      expect(base[0].cells.map((x) => x.category)).toEqual(categoriesOf(direct))
    }
  })

  it('프리셋 SP·타겟 기술을 고치면 그 카드 판정이 코어대로 바뀐다', () => {
    const k = presetKey('attack', 'physical', 0)
    const edited = { ...target, edits: { [k]: { sp: { hp: 0, def: 0 } } } }
    const before = run('custom-rotom', top(EXAMPLE_SET, { customTargets: [target] }), 'attack')
    const after = run('custom-rotom-edit', top(EXAMPLE_SET, { customTargets: [edited] }), 'attack')
    const first = (r: { plan: TabPlan; view: TabView }) => r.plan.cards.find((c) => c.opponent.source === 'custom' && c.bundle.presetIndex === 0) as CardSpec
    expect(first(after).opponentSet.sp).toMatchObject({ hp: 0, def: 0 })
    expect(first(before).opponentSet.sp).toMatchObject({ hp: 32, def: 32 })
    const cellsOf = (r: { plan: TabPlan; view: TabView }) =>
      r.view.cards.find((c) => c.id === first(r).id)?.rows.find((x) => x.kind === 'base' && x.moveId === 'dragonclaw')?.cells.map((c) => [c.category, c.maxPercent])
    const direct = sweepDamage(game, { side: 'attacker', stat: 'atk' }, EXAMPLE_SET, first(after).opponentSet, 'dragonclaw', undefined, undefined, OVER)
    expect(cellsOf(after)).toEqual(direct.cells.map((c) => (c.kind === 'ok' && c.value.kind === 'damage' ? [c.category, c.value.maxPercent] : null)))
    expect(cellsOf(after)).not.toEqual(cellsOf(before))

    const fewer = run('custom-rotom-hydro', top(EXAMPLE_SET, { customTargets: [{ ...target, moves: [F10.special] }] }), 'defense')
    expect(customCards(fewer.view).map((c) => c.category)).toEqual(['special', 'special', 'special'])
  })

  it('목록 밖 메가 폼은 원종 + 메가스톤 + mega, 목록 안 종은 충돌로 돌린다', () => {
    const mega = { rosterId: F6.outsideMega.rosterId, moves: ['aurasphere'], edits: {} }
    const conflict = { rosterId: F6.conflict, moves: ['dragonclaw'], edits: {} }
    const { plan, view } = run('custom-mega-conflict', top(EXAMPLE_SET, { customTargets: [mega, conflict] }), 'speed')
    const cards = plan.cards.filter((c) => c.opponent.source === 'custom')
    expect(cards.map((c) => c.opponent.id)).toEqual([F6.outsideMega.rosterId, F6.outsideMega.rosterId, F6.outsideMega.rosterId])
    for (const c of cards) expect(c.opponentSet).toMatchObject({ species: F6.outsideMega.base, item: F6.outsideMega.stone, mega: true })
    expect(view.customTargetConflicts).toEqual([F6.conflict])
  })
})

// ---------- AC 11a 셸암즈(F8) ----------

describe('AC11a 셸암즈는 카드·행이 되지 않고 안내로만', () => {
  it('내 셸암즈 → 탭 안내, 그 기술 행 없음', () => {
    const { view } = run('F8-me', top(F8.myShellSideArm), 'attack')
    expect(view.notices).toEqual([{ kind: 'category-varies', moveId: 'shellsidearm', owner: 'me' }])
    expect(view.cards.flatMap((c) => c.rows).some((r) => r.moveId === 'shellsidearm')).toBe(false)
  })

  it('상대 셸암즈 → 그 상대 항목의 안내로 보이고 행·항목이 되지 않는다', () => {
    const synthetic = shellSideArmEntry(entryOf(bo1, 'farigiraf'))
    const view = syntheticView(game, bo1.meta, [...bo1.ranking, synthetic])
    // 독(셸암즈)이 1배 이상이라 기본 후보에 드는 풀 타입 내 세트(예시 세트 한카리아스는 독 반감이라 후보가 아니다)
    const grass: PokemonSet = { ...EXAMPLE_SET, species: 'rillaboom', ability: 'grassysurge', moves: ['grassyglide', 'woodhammer'] }
    const { plan, view: tv } = run('F8-opp-grass', only(grass, [F8.opponentShellSideArm], { view }), 'defense')
    const cards = plan.cards.filter((c) => c.opponent.id === F8.opponentShellSideArm)
    expect(cards.length).toBeGreaterThan(0)
    for (const c of cards) {
      expect(c.notices).toEqual([{ kind: 'category-varies', moveId: 'shellsidearm', owner: 'opponent' }])
      expect(c.rowIds.some((id) => plan.rows[id].moveId === 'shellsidearm')).toBe(false)
    }
    expect(tv.cards.flatMap((c) => c.rows).some((r) => r.moveId === 'shellsidearm')).toBe(false)
    // 화면에 닿는 유일한 경로는 탭 뷰다: 그 상대의 표시 카드 머리에 안내가 있어야 한다.
    const shown = tv.cards.filter((c) => c.opponent.id === F8.opponentShellSideArm)
    expect(shown.some((c) => c.notices.some((n) => n.moveId === 'shellsidearm' && n.owner === 'opponent'))).toBe(true)
  })
})

describe('AC11a 내 목숨걸기는 공격 탭에서 계산하지 않고 안내로만', () => {
  const lucario: PokemonSet = {
    regulation: 'm-c',
    species: 'lucario',
    ability: 'justified',
    nature: 'adamant',
    sp: { hp: 32, atk: 32, def: 0, spa: 0, spd: 0, spe: 0 },
    moves: ['finalgambit', 'closecombat'],
  }

  it('공격 탭: 탭 안내만, 목숨걸기 행 없음', () => {
    const { view } = run('finalgambit-me', top(lucario), 'attack')
    expect(view.notices).toEqual([{ kind: 'attacker-hp-dependent', moveId: 'finalgambit', owner: 'me' }])
    expect(view.cards.flatMap((c) => c.rows).some((r) => r.moveId === 'finalgambit')).toBe(false)
  })
})

// ---------- AC 12 오류 격리(F7·F8) ----------

describe('AC12 오류 격리', () => {
  it('방어 탭 기술 오류: 그 항목만 계산 불가(목록에 표시), 고르면 그 행만 계산 불가, 같은 카드의 다른 항목은 정상', () => {
    const { plan, view } = run('F7-row', only(EXAMPLE_SET, [F7.rowError.opponent]), 'defense')
    expect(view.status).toEqual({ kind: 'ok' })
    const cards = view.cards.filter((c) => c.opponent.id === F7.rowError.opponent)
    expect(cards.length).toBeGreaterThan(0)
    for (const c of cards) {
      const bad = c.items.filter((i) => i.moveId === F7.rowError.move)
      expect(bad.length).toBeGreaterThan(0)
      for (const i of bad) expect(i).toMatchObject({ status: 'error', error: { code: F7.rowError.code, field: F7.rowError.field } })
      expect(c.items.some((i) => i.status === 'ok')).toBe(true)
      expect(c.state).toBe('ok')
    }
    expectMatchesCore(plan, view)
    const sel = new Map([[opponentKey({ source: 'ladder', id: F7.rowError.opponent }), itemKey(F7.rowError.move, BASE_CONDITION_ID)]])
    const chosen = buildTabView(only(EXAMPLE_SET, [F7.rowError.opponent]), 'defense', cache, sel)
    const picked = chosen.cards.filter((c) => c.opponent.id === F7.rowError.opponent && c.selected)
    expect(picked.length).toBeGreaterThan(0)
    for (const c of picked) {
      expect(c.rows.map((r) => r.status)).toEqual(['error'])
      expect(c.rows[0].error).toMatchObject({ code: F7.rowError.code, field: F7.rowError.field })
    }
  })

  it('공격 탭 상대 특성 오류: 그 상대 행 전부 계산 불가, 다른 상대는 정상', () => {
    const { view } = run('F7-ability', only(EXAMPLE_SET, [F7.opponentAbilityError.opponent, 'sneasler']), 'attack')
    expect(view.status).toEqual({ kind: 'ok' })
    const bad = view.cards.filter((c) => c.opponent.id === F7.opponentAbilityError.opponent)
    expect(bad.length).toBeGreaterThan(0)
    for (const c of bad) {
      expect(c.rows.length).toBeGreaterThan(0)
      for (const r of c.rows) expect(r.error).toMatchObject({ code: F7.opponentAbilityError.code, field: F7.opponentAbilityError.field })
      expect(c.headline.kind).toBe('error')
    }
    const others = view.cards.filter((c) => c.opponent.id === 'sneasler')
    expect(others.length).toBeGreaterThan(0)
    for (const c of view.cards.filter((x) => x.opponent.id === 'sneasler')) expect(c.rows.every((r) => r.status === 'ok')).toBe(true)
  })

  it('상대 세트 해석 실패 → 그 카드만 error(합성)', () => {
    const entries = bo1.ranking.map((e) => (e.id === F7.opponentCardError.opponent ? withIllegalRepresentativeMove(e, F7.opponentCardError.illegalMove) : e))
    const view = syntheticView(game, bo1.meta, entries)
    const { view: tv } = run('F7-card', only(EXAMPLE_SET, [F7.opponentCardError.opponent, 'sneasler'], { view }), 'attack')
    const bad = tv.cards.filter((c) => c.opponent.id === F7.opponentCardError.opponent)
    expect(bad.length).toBeGreaterThan(0)
    for (const c of bad) {
      expect(c.state).toBe('error')
      expect(c.error?.code).toBe(F7.opponentCardError.code)
      expect(c.headline).toEqual({ kind: 'error', reason: c.error })
    }
    const ok = tv.cards.filter((c) => c.opponent.id === 'sneasler')
    expect(ok.length).toBeGreaterThan(0)
  })

  it('내 세트 오류: 합계 초과는 세 탭 모두, 퀵드로는 스피드 탭만, 방어측 탈은 방어 탭만', () => {
    for (const tab of TABS) {
      const { view } = run('F7-total', top(F7.mySet.spTotal.set, { filters: { topN: 5, selected: [] } }), tab)
      expect(view.status.kind, tab).toBe('my-set-error')
      if (view.status.kind === 'my-set-error') expect(view.status.reasons.map((r) => r.code)).toContain(F7.mySet.spTotal.code)
      expect(view.cards).toEqual([])
    }
    const quick = (tab: Tab) => run('F7-quick', top(F7.mySet.speedOnly.set, { filters: { topN: 5, selected: [] } }), tab).view
    expect(quick('speed').status).toMatchObject({ kind: 'my-set-error', reasons: [{ field: F7.mySet.speedOnly.field }] })
    expect(quick('attack').status).toEqual({ kind: 'ok' })
    expect(quick('defense').status).toEqual({ kind: 'ok' })

    const d = F7.mySet.defenseOnly
    const disguise = (tab: Tab) => run('F7-disguise', only(d.set, [d.attacker.id]), tab).view
    const def = disguise('defense')
    expect(def.status.kind).toBe('my-set-error')
    if (def.status.kind === 'my-set-error') expect(def.status.reasons.map((r) => r.field)).toContain(d.field)
    expect(disguise('attack').status).toEqual({ kind: 'ok' })
    expect(disguise('attack').cards.length).toBeGreaterThan(0)
    expect(disguise('speed').status).toEqual({ kind: 'ok' })
  })

  it('내 하양허브 + 껍질깨기: 그 랭크 행의 연속기만 WHITE_HERB_MULTIHIT', () => {
    const w = F8.myWhiteHerb
    const { plan } = run('F8-wh-me', top(w.mySet, { filters: { topN: 10, selected: [] } }), 'attack')
    const rank = Object.values(plan.rows).filter((r) => r.basis?.kind === 'rank' && r.basis.owner === 'me' && r.basis.means.id === w.means)
    expect(rank.length).toBeGreaterThan(0)
    for (const r of rank) {
      if (r.moveId === w.multihit) expect(r.error?.code).toBe('WHITE_HERB_MULTIHIT')
      else expect(r.error).toBeUndefined()
    }
    expect(rank.some((r) => r.moveId === w.other)).toBe(true)
    const base = Object.values(plan.rows).filter((r) => r.kind === 'base' && r.moveId === w.multihit)
    expect(base.length).toBeGreaterThan(0)
    for (const r of base) expect(r.error).toBeUndefined()
  })

  it('상대 하양허브 + 껍질깨기(합성): 방어 탭 그 랭크 후 항목의 연속기만 계산 불가로 표시', () => {
    const w = F8.opponentWhiteHerb
    const view = syntheticView(game, bo1.meta, [...bo1.ranking, whiteHerbShellSmashEntry(entryOf(bo1, 'sneasler'))])
    const { view: tv } = run('F8-wh-opp', only(EXAMPLE_SET, [w.opponent], { view }), 'defense')
    const items = tv.cards.filter((c) => c.opponent.id === w.opponent).flatMap((c) => c.items)
    const bad = items.filter((i) => i.basis?.means.id === w.means && i.moveId === w.multihit)
    expect(bad.length).toBeGreaterThan(0)
    for (const i of bad) expect(i).toMatchObject({ status: 'error', error: { code: 'WHITE_HERB_MULTIHIT' } })
    expect(items.filter((i) => i.status === 'error').every((i) => i.moveId === w.multihit && i.basis !== undefined)).toBe(true)
  })
})

// ---------- AC 13 Bo3·월 변경 ----------

describe('AC13 Bo3·월 변경 → 그 스냅샷 기준·출처', () => {
  const sourceOf = (meta: MetaSnapshot) => ({
    match: meta.manifest.match,
    month: meta.manifest.month,
    cutoff: meta.manifest.source.cutoff,
    format: meta.manifest.source.format,
  })

  it('Bo3: 출처와 래더 상대(순위·사용률)가 Bo3 스냅샷이다', () => {
    const { view } = run('bo3', top(EXAMPLE_SET, { view: bo3, filters: { topN: 10, selected: [] } }), 'speed')
    expect(view.source).toEqual(sourceOf(bo3.meta))
    expect(view.source).not.toEqual(sourceOf(bo1.meta))
    const heads = view.cards.map((c) => c.opponent)
    expect(new Set(heads.map((h) => h.id))).toEqual(new Set(bo3.ranking.slice(0, 10).map((e) => e.id)))
    for (const h of heads) expect([h.rank, h.usage]).toEqual([entryOf(bo3, h.id).rank, entryOf(bo3, h.id).usage])
  })

  it('월 변경(합성 인덱스 + 로더): 그 월 스냅샷의 출처·순위로 다시 그린다', async () => {
    const month = '2026-09'
    const base = bo1.meta
    const dropped = 'garchomp'
    const synthetic = syntheticView(game, { ...base, manifest: { ...base.manifest, month } }, base.entries.filter((e) => e.id !== dropped))
    const indexItem = { match: 'bo1' as const, month, file: `${base.manifest.regulation}/${month}-bo1.json`, format: base.manifest.source.format, url: 'https://example.test/x.json', publishedAt: '2026-10-01T00:00:00Z', battles: base.manifest.source.battles }
    const index: MetaIndex = { schemaVersion: 1, regulations: { [base.manifest.regulation]: [indexItem] } }
    const loader = createMetaLoader(index, loadRegulationIndexSync(), {
      [`./meta/${base.manifest.regulation}/${month}-bo1.json`]: async () => synthetic.meta,
    })
    const meta = await loader.load({ regulation: base.manifest.regulation, month, match: 'bo1' })
    const view = createMetaView(meta, game)
    const before = run('F1-full', top(F1.full), 'attack').view
    const after = buildTabView(top(F1.full, { view }), 'attack', cache)
    expect(after.source).toEqual({ ...sourceOf(base), month })
    expect(before.cards.some((c) => c.opponent.id === dropped)).toBe(true)
    expect(after.cards.some((c) => c.opponent.id === dropped)).toBe(false)
    for (const c of after.cards) expect(c.opponent.rank).toBe(entryOf(view, c.opponent.id).rank)
    // 빠진 종 자리에 상위 30으로 들어온 종의 카드는 맨 뒤에 붙을 수 있다(5단 판정에서는 들어온 종도 판정이 바뀐다)
    const kept = new Set(bo1.ranking.slice(0, 30).map((e) => e.id))
    expect(after.cards.filter((c) => kept.has(c.opponent.id)).map((c) => c.opponent.id)).toEqual(
      before.cards.filter((c) => c.opponent.id !== dropped).map((c) => c.opponent.id),
    )
    for (const c of after.cards.filter((x) => !kept.has(x.opponent.id))) expect(c.opponent.rank).toBe(30)
  })
})

// ---------- AC 15 표시 기준 ----------

describe('AC15 표시 기준 3개를 바꾸면 결과가 그에 맞게 바뀐다', () => {
  const criteria = (patch: Partial<typeof DEFAULT_CRITERIA>) => ({ ...DEFAULT_CRITERIA, ...patch })

  it('묶음 기준: 높이면 기준 미만 묶음이 빠지고, 넘는 묶음이 없으면 소수 배분 1장', () => {
    const e = entryOf(bo1, 'garchomp')
    for (const min of [0.05, 0.3, 0.5]) {
      const { plan } = run(`bundle-${min}`, only(F1.full, ['garchomp'], { criteria: criteria({ bundleShareMin: min }) }), 'attack')
      const cards = plan.cards.filter((c) => c.category === 'physical')
      const all = directBundles(e, ['hp', 'def'])
      const passing = all.filter((b) => b.share >= min)
      const expected = passing.length > 0 ? passing.map((b) => [b.stats, b.share, false]) : [[all[0].stats, all[0].share, true]]
      expect(cards.map((c) => [statsKey(c), c.bundle.share, c.bundle.minority]), String(min)).toEqual(expected)
    }
  })

  it('묶음 기준 1(100%)이면 포켓몬·분류당 소수 배분 1장', () => {
    const { plan } = run('min-1', top(F1.full, { criteria: criteria({ bundleShareMin: 1 }) }), 'attack')
    const keys = plan.cards.map((c) => JSON.stringify([c.opponent.id, c.category]))
    expect(new Set(keys).size).toBe(keys.length)
    expect(plan.cards.every((c) => c.bundle.minority)).toBe(true)
    const def = run('F1-full', top(F1.full), 'attack').plan
    expect(def.cards.length).toBeGreaterThan(plan.cards.length)
  })

  it('랭크 기준: 상대 나비춤 점유율 이하면 스피드 탭 랭크 행, 점유율보다 높이면 사라진다', () => {
    const quiver = (rankShareMin: number) =>
      rowsFor(run(`rank-${rankShareMin}`, only(EXAMPLE_SET, ['volcarona'], { criteria: criteria({ rankShareMin }) }), 'speed').view, 'volcarona').filter(
        (r) => r.basis?.kind === 'rank' && r.basis.owner === 'opponent' && r.basis.means.id === 'quiverdance',
      )
    const share = (bo1.entry('volcarona') as MetaEntry).moves.shares.quiverdance
    expect(quiver(share).length).toBeGreaterThan(0)
    expect(quiver(share + 0.0001)).toEqual([])
  })

  it('스카프 기준: 올리면 대쓰여너 스카프 행이 사라지고, 내리면 타부자고에 생긴다', () => {
    const hi = run('scarf-0.2', top(EXAMPLE_SET, { criteria: criteria({ scarfShareMin: 0.2 }) }), 'speed').view
    expect(rowsFor(hi, F4.scarf.opponent.id).some((r) => r.kind === 'scarf')).toBe(false)
    const lo = run('scarf-0.04', top(EXAMPLE_SET, { criteria: criteria({ scarfShareMin: 0.04 }) }), 'speed').view
    const scarf = rowsFor(lo, F4.noScarf.opponent.id).filter((r) => r.kind === 'scarf')
    expect(scarf).toHaveLength(1)
    expect(scarf[0].basis).toEqual({ kind: 'scarf', item: 'choicescarf', share: F4.noScarf.scarfShare })
  })
})

// ---------- ADR 결정 3: 관여 능력치 S(F11) ----------

describe('관여 능력치 S(F11): 스피드 의존 기술 행만 내 S에 의존한다', () => {
  it('자이로볼 행은 dependsOn에 spe가 있고 러스터캐논 행은 없다(코어로 의존 확인)', () => {
    const opp = opponentSet(bo1, F11.opponent)
    const pct = (s: PokemonSet, move: string, spe: number) => {
      const r = judgeDamage(game, 'attacker', withSp(s, { spe }), opp, move, undefined, undefined, IGNORE_TOTAL).value
      return r.kind === 'damage' ? r.maxPercent : NaN
    }
    for (const [label, c, depends] of [
      ['dependent', F11.dependent, true],
      ['independent', F11.independent, false],
    ] as const) {
      const [lo, hi] = F11.speeds
      expect(pct(c.mySet, c.move, lo) !== pct(c.mySet, c.move, hi)).toBe(depends)
      const { plan } = run(`F11-${label}`, only(c.mySet, [F11.opponent.id]), 'attack')
      const rows = Object.values(plan.rows).filter((r) => r.moveId === c.move)
      expect(rows.length).toBeGreaterThan(0)
      for (const r of rows) expect(r.dependsOn.includes('spe'), label).toBe(depends)
    }
  })
})
