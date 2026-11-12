// PRD 수용 기준의 도메인 부분을 고정 입력(__fixtures__/acceptance)과 buildTabView로 확인한다.
// 기대 판정은 코어 직접 호출로 만들고, 카드 모델 함수(planTab)는 어떤 행·세트가 계획됐는지 찾는 데만 쓴다.
import { describe, expect, it } from 'vitest'
import {
  CoreError,
  CoreInputError,
  STAT_IDS,
  judgeDamage,
  judgeSpeed,
  moveStatRefs,
  natureMultiplier,
  sweepDamage,
  sweepSpeed,
  type BattleConditions,
  type PokemonSet,
  type SweepResult,
} from '../core'
import { createMetaLoader } from '../data/meta-loader'
import type { MetaEntry, MetaIndex, MetaSnapshot } from '../data/meta-schema'
import type { StatId } from '../data/schema'
import { loadRegulationIndexSync } from '../data/testing'
import { createMetaView, parseSpreadKey, type MetaView } from '../meta'
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
import { createLruCache } from './cache'
import { presetKey } from './ids'
import { defenseMoveIds, planTab } from './plan'
import { cardInput, realData, syntheticView } from './testing'
import { DEFAULT_CRITERIA, TABS } from './types'
import type { CardInput, CardSpec, CardView, NoChangeItem, RankBasis, RowKind, RowSpec, RowView, ScarfBasis, Tab, TabPlan, TabView } from './types'
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

/** 표시 카드 + 요약 항목에서 그 상대에 대해 나온 모든 행(종류·근거). */
function rowsFor(view: TabView, opponentId: string): { kind: RowKind; moveId?: string; basis?: RankBasis | ScarfBasis; shown: boolean }[] {
  const shown = view.cards.filter((c) => c.opponent.id === opponentId).flatMap((c) => c.rows.map((r) => ({ kind: r.kind, moveId: r.moveId, basis: r.basis, shown: true })))
  const hidden = view.noChange.items
    .filter((i) => i.opponent.id === opponentId && i.rowKind !== undefined)
    .map((i) => ({ kind: i.rowKind as RowKind, moveId: i.moveId, basis: i.basis, shown: false }))
  return [...shown, ...hidden]
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

type CorePick = 'kept' | 'dropped' | 'error'

/** 후보 기술(행을 만들 수 있는 공격기): 분류 고정이고 공격측 HP에 의존하지 않는다. 스냅샷에 없으면 null */
function candidateRefs(moveId: string, mine: boolean): ReturnType<typeof moveStatRefs> | null {
  if (!Object.prototype.hasOwnProperty.call(game.data.moves, moveId)) return null
  const refs = moveStatRefs(game, moveId)
  if (!refs.offense || !refs.defense || refs.categoryVaries) return null
  if (mine && refs.offense.owner === 'self' && refs.attackerStats.includes('hp')) return null
  return refs
}

/**
 * 카드·조건(기본 / 랭크 수단 하나)마다 현재 세트 단건 판정을 코어로 직접 내 가장 센 기술(1타 확률 → 최대 대미지 비율 → 슬롯·사용률 순)과
 * 선공기만 남긴다. 후보는 분류를 가로지른 상대 한 마리의 기술 전부다(사용자 피드백 2026-11-11): 다른 분류 기술은 이 카드의 대표 세트·같은 조건 세트로
 * 판정하고, 그 기술이 고르면 이 카드의 행은 빠진다. 무효는 버리고 코어가 거부하면 error. 키 = 공격 탭 행·고정 id, 방어 탭 필터 id.
 */
function corePicks(plan: TabPlan, card: CardSpec, meta: MetaView): Map<string, CorePick> {
  type Cand = { id: string; moveId: string; order: number; judge: () => ReturnType<typeof judgeDamage> }
  type Sets = { side: 'attacker' | 'defender'; attacker: PokemonSet; defender: PokemonSet; conditions: RowSpec['conditions']; herb: boolean }
  const groups = new Map<string, Cand[]>()
  const sets = new Map<string, Sets>()
  const add = (group: string | null, c: Cand) => groups.set(group ?? 'base', [...(groups.get(group ?? 'base') ?? []), c])
  const opt = { rollSteps: N }
  const defense = plan.tab === 'defense'
  const entry = meta.entry(card.opponent.id)
  const mySet = plan.rows[card.rowIds[0]]?.attacker ?? plan.fixed[card.fixedIds[0]]?.attacker
  const allMoves = defense ? defenseMoveIds(game, entry as MetaEntry) : (mySet?.moves ?? [])
  const orderOf = (moveId: string) => allMoves.indexOf(moveId)
  const herbOf = (b: RankBasis | ScarfBasis | undefined) => b?.kind === 'rank' && b.reactions.includes('whiteherb')
  card.filterIds.forEach((id) => {
    const f = plan.filters[id]
    sets.set(meansKey(f.basis) ?? 'base', { side: 'defender', attacker: f.attacker, defender: f.defender, conditions: f.conditions, herb: herbOf(f.basis) })
    add(meansKey(f.basis), { id, moveId: f.moveId, order: orderOf(f.moveId), judge: () => judgeDamage(game, 'defender', f.attacker, f.defender, f.moveId, f.conditions, undefined, opt) })
  })
  for (const rowId of card.rowIds) {
    const r = plan.rows[rowId]
    if (r.error || r.gate !== undefined || r.judge !== 'damage' || !r.sweep || !r.moveId) continue
    const moveId = r.moveId
    const side = r.sweep.side
    sets.set(meansKey(r.basis) ?? 'base', { side, attacker: r.attacker, defender: r.defender, conditions: r.conditions, herb: herbOf(r.basis) })
    add(meansKey(r.basis), { id: rowId, moveId, order: r.attacker.moves.indexOf(moveId), judge: () => judgeDamage(game, side, r.attacker, r.defender, moveId, r.conditions, undefined, opt) })
  }
  for (const fixedId of card.fixedIds) {
    const f = plan.fixed[fixedId]
    if (!sets.has('base')) sets.set('base', { side: 'attacker', attacker: f.attacker, defender: f.defender, conditions: f.conditions, herb: false })
    add(null, { id: fixedId, moveId: f.moveId, order: f.attacker.moves.indexOf(f.moveId), judge: () => judgeDamage(game, 'attacker', f.attacker, f.defender, f.moveId, f.conditions, undefined, opt) })
  }
  // 다른 분류 기술(비교 전용). 랭크 조건에서는 상대 능력치 기술·하양허브 소비 뒤 연속기를 뺀다.
  const myDefense = card.category === 'physical' ? 'def' : 'spd'
  for (const [key, g] of sets) {
    for (const moveId of allMoves) {
      const refs = candidateRefs(moveId, !defense)
      if (refs === null || refs.defense === myDefense) continue
      if (key !== 'base' && (refs.offense?.owner === 'target' || (g.herb && game.data.moves[moveId].multihit !== undefined))) continue
      add(key === 'base' ? null : key, {
        id: JSON.stringify(['cross', key, moveId]),
        moveId,
        order: orderOf(moveId),
        judge: () => judgeDamage(game, g.side, g.attacker, g.defender, moveId, g.conditions, undefined, opt),
      })
    }
  }
  const out = new Map<string, CorePick>()
  for (const cands of groups.values()) {
    const scored: { c: Cand; p: number; max: number }[] = []
    for (const c of [...cands].sort((a, b) => a.order - b.order)) {
      try {
        const v = c.judge().value
        out.set(c.id, 'dropped')
        if (v.kind === 'damage') scored.push({ c, p: v.ohkoChance, max: v.maxPercent })
      } catch (e) {
        if (!(e instanceof CoreError || e instanceof CoreInputError)) throw e
        out.set(c.id, 'error')
      }
    }
    const best = scored.reduce<(typeof scored)[number] | undefined>((b, x) => (b === undefined || x.p > b.p || (x.p === b.p && x.max > b.max) ? x : b), undefined)
    for (const x of scored) if (x === best || game.data.moves[x.c.moveId].priority > 0) out.set(x.c.id, 'kept')
  }
  return out
}

/**
 * 계획의 래더 카드를 코어로 직접 판정해 "변화 없음" 요약·표시 카드·표시 행 칸을 다시 만든다.
 * 행은 카드·조건당 가장 센 기술(+선공기)만(corePicks), 고르지 않은 기술은 표시·요약 어디에도 없다.
 * 극단 필터 = 내 H·(B|D) 함께 0·무보정 / 함께 최대·상승(예산 무시), 행 = 현재·무보정·상승 성격 33칸 스윕(예산 밖 판정)의 합집합, 고정 = 단건 판정.
 */
function expectMatchesCore(plan: TabPlan, view: TabView, meta: MetaView = bo1): { items: number; cards: number; promoted: number } {
  expect(plan.status).toEqual({ kind: 'ok' })
  expect(view.complete).toBe(true)
  const items: string[] = []
  const shownLadder: string[] = []
  const perCard: { id: string; group: string; shown: number; items: string[] }[] = []
  let emptyCards = 0
  let promoted = 0
  for (const card of plan.cards) {
    if (card.opponent.source !== 'ladder') continue
    if (card.state === 'error') {
      perCard.push({ id: card.id, group: JSON.stringify([card.opponent.source, card.opponent.id]), shown: 1, items: [] })
      continue
    }
    const start = items.length
    let shown = 0
    const picks = corePicks(plan, card, meta)
    const viewCard = view.cards.find((c) => c.id === card.id)
    const gates = new Map<string, 'passed' | 'shown' | 'hidden'>()
    for (const rowId of card.rowIds) {
      const spec = plan.rows[rowId]
      if (spec.error) {
        shown++
        continue
      }
      const pick = picks.get(spec.gate ?? rowId)
      if (pick === 'dropped') {
        expect(viewCard?.rows.find((x) => x.id === rowId), rowId).toBeUndefined()
        continue
      }
      if (pick === 'error') {
        if (spec.gate === undefined || !gates.has(spec.gate)) shown++
        if (spec.gate !== undefined) gates.set(spec.gate, 'shown')
        continue
      }
      if (spec.gate !== undefined) {
        let g = gates.get(spec.gate)
        if (g === undefined) {
          const f = plan.filters[spec.gate]
          const at = (v: number, nature: string) => {
            const defender = withSp({ ...f.defender, nature }, { [f.stats[0]]: v, [f.stats[1]]: v })
            return coreCategory(() => judgeDamage(game, 'defender', f.attacker, defender, f.moveId, f.conditions, undefined, IGNORE_TOTAL))
          }
          const low = at(0, f.natures.neutral)
          const high = at(spMaxPerStat, f.natures.plus)
          if (low === null || high === null) g = 'shown'
          else if (low === high) {
            g = 'hidden'
            items.push(JSON.stringify([card.id, 'extreme-filter', f.moveId, null, low, meansKey(f.basis)]))
          } else g = 'passed'
          if (g === 'shown') shown++
          gates.set(spec.gate, g)
        }
        if (g !== 'passed') continue
      }
      const r = coreSweep(spec)
      if (r === null) {
        shown++
        continue
      }
      const cats = categoriesOf(r)
      const natures = spec.natures
      if (natures === undefined) throw new Error(`스윕 행 ${rowId}에 성격 변형이 없다`)
      const variantCats = [natures.neutral, natures.plus].flatMap((n) => {
        const v = coreSweep(withMyNature(plan, spec, n))
        return v === null ? [] : categoriesOf(v)
      })
      if ([...cats, ...variantCats].every((c) => c === cats[0])) {
        items.push(JSON.stringify([card.id, 'row', spec.moveId ?? null, spec.sweep?.stat ?? null, cats[0], meansKey(spec.basis)]))
        continue
      }
      shown++
      const row = view.cards.find((c) => c.id === card.id)?.rows.find((x) => x.id === rowId)
      expect(row, rowId).toBeDefined()
      expect(row?.cells.map((c) => c.category), rowId).toEqual(cats)
      expect(row?.boundaries.map((b) => b.sp), rowId).toEqual(r.boundaries)
    }
    for (const fixedId of card.fixedIds) {
      if (picks.get(fixedId) === 'dropped') continue
      const f = plan.fixed[fixedId]
      const c = coreCategory(() => judgeDamage(game, 'attacker', f.attacker, f.defender, f.moveId, f.conditions, undefined, { rollSteps: N }))
      if (c === null) shown++
      else items.push(JSON.stringify([card.id, 'sp-independent', f.moveId, null, c, null]))
    }
    perCard.push({ id: card.id, group: JSON.stringify([card.opponent.source, card.opponent.id]), shown, items: items.splice(start) })
  }
  // 변화 없음 배분도 선택지: 표시 행이 없는 카드라도 같은 상대의 다른 카드가 보이면 변화 없음 행(요약 항목 1건 = 1행)과 함께 보이고 요약에서 빠진다.
  const shownGroups = new Set(perCard.filter((c) => c.shown > 0).map((c) => c.group))
  for (const c of perCard) {
    if (c.shown > 0) shownLadder.push(c.id)
    else if (c.items.length > 0 && shownGroups.has(c.group)) {
      shownLadder.push(c.id)
      const v = view.cards.find((x) => x.id === c.id)
      expect(v?.rows.length, c.id).toBe(c.items.length)
      expect(v?.rows.every((r) => r.noChange && r.status === 'ok'), c.id).toBe(true)
      expect(v?.headline.kind, c.id).toBe('no-change')
      expect(v?.hiddenNoChangeRows, c.id).toBe(0)
      promoted++
    } else {
      items.push(...c.items)
      emptyCards++
    }
  }
  for (const c of perCard) if (c.shown > 0) items.push(...c.items)
  const actual = view.noChange.items.map((i: NoChangeItem) =>
    JSON.stringify([i.cardId, i.kind, i.moveId ?? null, i.sweepStat ?? null, i.fixed, meansKey(i.basis)]),
  )
  expect([...actual].sort()).toEqual([...items].sort())
  expect(view.noChange.rows).toBe(items.length)
  expect(view.noChange.cards).toBe(emptyCards)
  expect(view.cards.filter((c) => c.opponent.source === 'ladder').map((c) => c.id)).toEqual(plan.cards.map((c) => c.id).filter((id) => shownLadder.includes(id)))
  return { items: items.length, cards: emptyCards, promoted }
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

  it('변화 없는 래더 카드·행은 요약으로 가고 수가 코어 재판정과 같다', () => {
    const { plan, view } = run('F1-full', top(F1.full), 'attack')
    const n = expectMatchesCore(plan, view)
    expect(n.cards).toBeGreaterThan(0)
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

  it('가장 센 기술은 분류를 가로질러 고른다: 짜랑고우거 물리 카드는 특수기 사이코키네시스가 무투자 확정1타라 사이코쇼크 행이 없고 카드가 빠진다(사용자 피드백 2026-11-11)', () => {
    const { plan, view } = run('F2', top(F2.mySet), 'attack')
    const c = cardBySpread(plan, view, F2.crossDropped.opponent, 'physical')
    const base = c.spec.conditions.find((g) => g.id === JSON.stringify(['base']))
    expect(base?.candidates.map((x) => [x.moveId, x.target])).toEqual([
      ['psyshock', 'row'],
      ['psychic', 'probe'],
      ['drainpunch', 'row'],
    ])
    expect(c.card).toBeUndefined()
    expect(view.noChange.items.filter((i) => i.cardId === c.spec.id)).toEqual([])
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

/** 변화기를 뺀 점유율 상위 5(동률 id 순). */
function topAttackMoves(e: MetaEntry): string[] {
  return Object.entries(e.moves.shares)
    .filter(([m]) => !game.data.moves[m] || game.data.moves[m].category !== 'Status')
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, 5)
    .map(([m]) => m)
}

describe('AC5 방어 탭 극단 필터(F3)', () => {
  it('둘 다 확정견딤·둘 다 확정1타(낮은 극단 무보정, 높은 극단 상승 성격) → 요약(고정 판정 = 코어 두 극단)', () => {
    const { plan, view } = run('example', top(EXAMPLE_SET), 'defense')
    for (const c of [F3.bothSurvive, F3.bothOhko]) {
      const { spec, card } = cardBySpread(plan, view, c.opponent, game.data.moves[c.move].category === 'Physical' ? 'physical' : 'special')
      expect(card?.rows.some((r) => r.moveId === c.move && r.kind === 'base') ?? false).toBe(false)
      const item = view.noChange.items.find((i) => i.cardId === spec.id && i.kind === 'extreme-filter' && i.moveId === c.move && i.rowKind === 'base')
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

  it('현재 성격 두 극단이 같아도 상승 성격 높은 극단이 다르면 통과해 H 행·D 행이 생긴다', () => {
    const { plan, view } = run('example', top(EXAMPLE_SET), 'defense')
    // F3.plusOnly(문포스)는 같은 카드의 파멸의빛이 더 세서 행·요약 어디에도 없다(2026-11-11 가장 센 기술 하나)
    const weaker = cardBySpread(plan, view, F3.plusOnly.opponent, 'special')
    expect(rowsFor(view, F3.plusOnly.opponent.id).some((r) => r.moveId === F3.plusOnly.move)).toBe(false)
    expect(view.noChange.items.some((i) => i.cardId === weaker.spec.id && i.moveId === F3.plusOnly.move)).toBe(false)
    const c = F3.plusOnlyStrongest
    const { spec, card } = cardBySpread(plan, view, c.opponent, 'special')
    expect(view.noChange.items.some((i) => i.cardId === spec.id && i.kind === 'extreme-filter' && i.moveId === c.move && i.rowKind === 'base')).toBe(false)
    // 필터를 통과했으니 H 행·D 행이 각각 표시되거나 행 단위 변화 없음(각 행 스윕 기준)으로 간다
    const shown = (card?.rows ?? []).filter((r) => r.moveId === c.move && r.kind === 'base').map((r) => r.sweepStat)
    const hidden = view.noChange.items.filter((i) => i.cardId === spec.id && i.kind === 'row' && i.moveId === c.move && i.rowKind === 'base').map((i) => i.sweepStat)
    expect([...shown, ...hidden].sort()).toEqual(['hp', 'spd'])
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

  it('현재·무보정·상승 모두 같은 래더 행은 변화 없음 요약으로 간다(F1 대도각참)', () => {
    const { plan, view } = run('F1-full', top(F1.full), 'attack')
    const { spec, card } = cardBySpread(plan, view, F1.bothSame.opponent, 'physical')
    expect(card).toBeUndefined()
    expect(view.noChange.items.filter((i) => i.cardId === spec.id).map((i) => [i.kind, i.moveId, i.fixed])).toEqual([['row', F1.move, F1.bothSame.fixed]])
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

  it('판정 행·요약 항목의 상대 기술은 변화기를 뺀 상위 5 안이다', () => {
    const { view } = run('example', top(EXAMPLE_SET), 'defense')
    const used = [
      ...view.cards.filter((c) => c.opponent.source === 'ladder').flatMap((c) => c.rows.map((r) => [c.opponent.id, r.moveId] as const)),
      ...view.noChange.items.map((i) => [i.opponent.id, i.moveId] as const),
    ]
    expect(used.length).toBeGreaterThan(0)
    for (const [id, move] of used) expect(topAttackMoves(entryOf(bo1, id)), id).toContain(move)
  })

  it('요약·표시 카드·표시 행 칸 = 코어 재판정(극단 필터 1건 = 1행)', () => {
    const { plan, view } = run('example', top(EXAMPLE_SET), 'defense')
    expect(expectMatchesCore(plan, view).items).toBeGreaterThan(0)
  })
})

// ---------- AC 6 변화 없음 요약 ----------

const kingambitFoul = (moves: string[]): PokemonSet => ({ ...F5.defiant.mySet, moves })

describe('AC6 변화 없음 요약', () => {
  it.each(TABS)('예시 세트 %s 탭: 요약 행 수·카드 수 = 코어 재판정', (tab) => {
    const { plan, view } = run('example', top(EXAMPLE_SET), tab)
    expectMatchesCore(plan, view)
  })

  it('내 SP 무관(속임수) 1건 = 1행, 처음부터 행이 없는 래더 카드도 M에 센다', () => {
    const { plan, view } = run('foul-only', top(kingambitFoul(['foulplay'])), 'attack')
    const ok = plan.cards.filter((c) => c.opponent.source === 'ladder' && c.state === 'ok')
    expect(ok.every((c) => c.rowIds.length === 0 && c.fixedIds.length === 1)).toBe(true)
    const n = expectMatchesCore(plan, view)
    // 모든 카드가 변화 없음이라 어느 상대도 표시되지 않는다(변화 없음 선택지로 올라갈 카드가 없다).
    expect(n).toEqual({ items: ok.length, cards: ok.length, promoted: 0 })
    expect(view.noChange.items.every((i) => i.kind === 'sp-independent')).toBe(true)
  })

  it('속임수 + 일반 기술: 속임수가 가장 세면 고정 판정 1건만 요약에, 아니면 속임수는 어디에도 없다', () => {
    const { plan, view } = run('foul-mixed', top(kingambitFoul(['foulplay', 'kowtowcleave']), { filters: { topN: 12, selected: [] } }), 'attack')
    expectMatchesCore(plan, view)
    const itemsOf = (id: string) => view.noChange.items.filter((i) => i.cardId === id).map((i) => [i.kind, i.moveId])
    // 실데이터: 포푸니크 adamant:2/32/0/0/0/32는 속임수(최대 60.5%)가 도각참(55.4%)보다 세고, 키키링 quiet:10/0/13/30/13/0은 도각참이 확정1타
    const foul = cardBySpread(plan, view, { id: 'sneasler', spread: 'adamant:2/32/0/0/0/32' }, 'physical')
    expect(foul.card).toBeUndefined()
    expect(itemsOf(foul.spec.id)).toEqual([['sp-independent', 'foulplay']])
    const cleave = cardBySpread(plan, view, { id: 'farigiraf', spread: 'quiet:10/0/13/30/13/0' }, 'physical')
    expect(cleave.card?.rows.map((r) => r.moveId)).toEqual(['kowtowcleave'])
    expect(itemsOf(cleave.spec.id)).toEqual([])
  })

  it('목록 밖 커스텀 카드는 변화 없음 행도 카드 안에 남고 요약에 세지 않는다', () => {
    const target = { rosterId: F10.rosterId, moves: [...F10.moves], edits: {} }
    const { view } = run('custom-rotom', top(EXAMPLE_SET, { customTargets: [target] }), 'attack')
    const custom = view.cards.filter((c) => c.opponent.source === 'custom')
    expect(custom).toHaveLength(3)
    expect(custom.flatMap((c) => c.rows).some((r) => r.noChange)).toBe(true)
    expect(view.noChange.items.some((i) => i.opponent.source === 'custom')).toBe(false)
    for (const c of custom) expect(c.hiddenNoChangeRows).toBe(0)
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
    const item = view.noChange.items.find((i) => i.cardId === spec.id && i.rowKind === 'scarf')
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

/** 스피드 탭 기본 행의 현재 판정(표시 행이면 current, 요약으로 갔으면 고정 판정). */
function shownOrHidden(plan: TabPlan, view: TabView, ref: OpponentRef): string | undefined {
  const { spec, card } = cardBySpread(plan, view, ref, null)
  const row = card?.rows.find((r) => r.kind === 'base')
  if (row) return row.current.category
  return view.noChange.items.find((i) => i.cardId === spec.id && i.rowKind === 'base')?.fixed
}

// ---------- AC 8 랭크 행(F5) ----------

describe('AC8 랭크 행(F5)', () => {
  const intimidateRows = (view: TabView, id: string) =>
    rowsFor(view, id).filter((r) => r.basis?.kind === 'rank' && r.basis.means.id === F5.threat.ability && r.basis.owner === 'opponent')

  it('위협 ≥ 10% 상대 카드에 랭크 행, 수단·점유율 표시, 오기면 A+1·아니면 A−1', () => {
    for (const [label, s] of [
      ['defiant', F5.defiant],
      ['non-defiant', F5.nonDefiant],
    ] as const) {
      const { plan, view } = run(`F5-${label}`, only(s.mySet, [F5.threat.opponent]), 'attack')
      const rows = intimidateRows(view, F5.threat.opponent)
      expect(rows.length, label).toBeGreaterThan(0)
      for (const r of rows) {
        const basis = r.basis as RankBasis
        expect(basis.share).toBe(F5.threat.share)
        expect(basis.myBoosts).toEqual(s.myBoosts)
        expect(basis.reactions).toEqual(label === 'defiant' ? ['defiant'] : [])
      }
      // 표시된 랭크 행 칸 = 같은 랭크를 넣은 코어 스윕
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
    }
  })

  it('위협 < 10% 상대(선택 필터)에는 위협 랭크 행이 없다', () => {
    const { view } = run('F5-below', only(F5.defiant.mySet, [F5.threatBelow.opponent]), 'attack')
    expect(rowsFor(view, F5.threatBelow.opponent).length).toBeGreaterThan(0)
    expect(intimidateRows(view, F5.threatBelow.opponent)).toEqual([])
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
    new Set([...view.cards, ...view.noChange.items].filter((c) => c.opponent.source === 'ladder').map((c) => c.opponent.id))

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

  it('방어 탭: 계획은 분류마다 프리셋 3장이지만 가장 센 기술은 분류를 가로질러 고른다 — 하이드로펌프가 폴터가이스트보다 세 물리 카드는 빠지고 특수 카드만 하이드로펌프 행(사용자 피드백 2026-11-11)', () => {
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
    const cards = customCards(view)
    expect(cards.map((c) => [c.category, c.bundle.presetIndex])).toEqual([
      ['special', 0],
      ['special', 1],
      ['special', 2],
    ])
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

  it('스피드 탭: 타겟 기술의 랭크 수단(일렉트릭네트)이 사용자 지정 랭크 행(점유율 없음)이 되고 판정 = 코어', () => {
    const { plan, view } = run('custom-rotom', top(EXAMPLE_SET, { customTargets: [target] }), 'speed')
    const cards = customCards(view)
    expect(cards).toHaveLength(3)
    for (const c of cards) {
      const rank = c.rows.filter((r) => r.kind === 'rank')
      expect(rank).toHaveLength(1)
      const b = rank[0].basis as RankBasis
      expect(b).toMatchObject({ means: { kind: 'move', id: F10.rankMeans }, owner: 'opponent', myBoosts: { spe: -1 } })
      expect(b.share).toBeUndefined()
      const spec = plan.cards.find((x) => x.id === c.id) as CardSpec
      const direct = sweepSpeed(game, { ...EXAMPLE_SET, boosts: b.myBoosts }, { ...spec.opponentSet, boosts: b.opponentBoosts }, undefined, OVER)
      expect(rank[0].cells.map((x) => x.category)).toEqual(categoriesOf(direct))
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
  it('내 셸암즈 → 탭 안내, 그 기술 행·요약 없음', () => {
    const { view } = run('F8-me', top(F8.myShellSideArm), 'attack')
    expect(view.notices).toEqual([{ kind: 'category-varies', moveId: 'shellsidearm', owner: 'me' }])
    expect(view.cards.flatMap((c) => c.rows).some((r) => r.moveId === 'shellsidearm')).toBe(false)
    expect(view.noChange.items.some((i) => i.moveId === 'shellsidearm')).toBe(false)
  })

  it('상대 셸암즈 → 그 상대 항목의 안내로 보이고 행·요약·상위 5 자리를 차지하지 않는다', () => {
    const synthetic = shellSideArmEntry(entryOf(bo1, 'farigiraf'))
    const view = syntheticView(game, bo1.meta, [...bo1.ranking, synthetic])
    const { plan, view: tv } = run('F8-opp', only(EXAMPLE_SET, [F8.opponentShellSideArm], { view }), 'defense')
    const cards = plan.cards.filter((c) => c.opponent.id === F8.opponentShellSideArm)
    expect(cards.length).toBeGreaterThan(0)
    for (const c of cards) {
      expect(c.notices).toEqual([{ kind: 'category-varies', moveId: 'shellsidearm', owner: 'opponent' }])
      expect(c.rowIds.some((id) => plan.rows[id].moveId === 'shellsidearm')).toBe(false)
    }
    expect(tv.noChange.items.some((i) => i.moveId === 'shellsidearm')).toBe(false)
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

  it('공격 탭: 탭 안내만, 목숨걸기 행·요약 없음', () => {
    const { view } = run('finalgambit-me', top(lucario), 'attack')
    expect(view.notices).toEqual([{ kind: 'attacker-hp-dependent', moveId: 'finalgambit', owner: 'me' }])
    expect(view.cards.flatMap((c) => c.rows).some((r) => r.moveId === 'finalgambit')).toBe(false)
    expect(view.noChange.items.some((i) => i.moveId === 'finalgambit')).toBe(false)
  })
})

// ---------- AC 12 오류 격리(F7·F8) ----------

describe('AC12 오류 격리', () => {
  it('방어 탭 행 오류: 그 행만 계산 불가, 같은 카드의 다른 행은 정상', () => {
    const { plan, view } = run('F7-row', only(EXAMPLE_SET, [F7.rowError.opponent]), 'defense')
    expect(view.status).toEqual({ kind: 'ok' })
    const cards = view.cards.filter((c) => c.opponent.id === F7.rowError.opponent)
    expect(cards.length).toBeGreaterThan(0)
    for (const c of cards) {
      const bad = c.rows.filter((r) => r.moveId === F7.rowError.move)
      expect(bad.length).toBeGreaterThan(0)
      for (const r of bad) expect(r.error).toMatchObject({ code: F7.rowError.code, field: F7.rowError.field })
      expect(c.state).toBe('ok')
    }
    expectMatchesCore(plan, view)
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
    const others = [...view.cards, ...view.noChange.items].filter((c) => c.opponent.id === 'sneasler')
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
    const ok = [...tv.cards, ...tv.noChange.items].filter((c) => c.opponent.id === 'sneasler')
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
    expect(disguise('attack').cards.length + disguise('attack').noChange.items.length).toBeGreaterThan(0)
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

  it('상대 하양허브 + 껍질깨기(합성): 방어 탭 그 랭크 행의 연속기만 계산 불가로 표시', () => {
    const w = F8.opponentWhiteHerb
    const view = syntheticView(game, bo1.meta, [...bo1.ranking, whiteHerbShellSmashEntry(entryOf(bo1, 'sneasler'))])
    const { view: tv } = run('F8-wh-opp', only(EXAMPLE_SET, [w.opponent], { view }), 'defense')
    const rows = tv.cards.filter((c) => c.opponent.id === w.opponent).flatMap((c) => c.rows)
    const bad = rows.filter((r) => r.basis?.kind === 'rank' && r.basis.means.id === w.means && r.moveId === w.multihit)
    expect(bad.length).toBeGreaterThan(0)
    for (const r of bad) expect(r).toMatchObject({ status: 'error', error: { code: 'WHITE_HERB_MULTIHIT' } })
    expect(rows.filter((r) => r.status === 'error').every((r) => r.moveId === w.multihit && r.basis?.kind === 'rank')).toBe(true)
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
    const heads = [...view.cards, ...view.noChange.items].map((c) => c.opponent)
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

  it('랭크 기준: 위협 점유율보다 높이면 위협 랭크 행이 사라진다', () => {
    const { view } = run('rank-1', only(F5.defiant.mySet, [F5.threat.opponent], { criteria: criteria({ rankShareMin: 1 }) }), 'attack')
    expect(rowsFor(view, F5.threat.opponent).length).toBeGreaterThan(0)
    expect(rowsFor(view, F5.threat.opponent).some((r) => r.basis?.kind === 'rank' && r.basis.owner === 'opponent')).toBe(false)
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
