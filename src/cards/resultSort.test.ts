import { describe, expect, it } from 'vitest'
import type { PokemonSet } from '../core'
import { tierRank } from '../core'
import { assembleTab } from './assemble'
import { buildTabView } from './batch'
import { planTab } from './plan'
import { bucketKey, resultBucket, sortByResult, type ResultBucket } from './resultSort'
import { computeRowTask } from './rowTask'
import { nextStage, pendingTasks, rowJudgements, taskKey } from './schedule'
import { cardInput, realData } from './testing'
import { TABS } from './types'
import type { CardView, Headline, RowTaskResult, RowView, Tab } from './types'

let seq = 0
type Kind = { tier: string } | 'no-change' | 'error' | 'pending' | 'stale-headline'

/** 결과 그룹만 정하는 최소 카드: tier면 변동 가능한 대표 행(best = tier), 그 밖은 그 상태의 대표·태그 */
function card(opp: string, kind: Kind, opts: { usage?: number; custom?: boolean } = {}): CardView {
  const order = seq++
  const row: RowView = {
    id: `r${order}`,
    kind: 'base',
    order: 0,
    status: 'ok',
    noChange: true,
    cells: [],
    current: { sp: 0 },
    boundaries: [],
    nearest: {},
  }
  let headline: Headline = { kind: 'row', rowId: row.id }
  let variable = false
  let state: CardView['state'] = 'ok'
  if (typeof kind === 'object') {
    row.noChange = false
    row.best = kind.tier
    row.cells = [{ sp: 0, category: kind.tier, overBudget: false, need: 0 }]
    variable = true
  } else if (kind === 'pending') {
    // 판정 전 행이 남음
    row.status = 'pending'
    headline = { kind: 'updating' }
  }
  else if (kind === 'error') state = 'error'
  else if (kind === 'stale-headline') {
    // 변동 가능하지만 대표 행 최선 판정이 아직 없음(성격 변형 대기)
    row.noChange = false
    row.cells = [{ sp: 0, category: 'guaranteed-survive', overBudget: false, need: 0 }]
    variable = true
  }
  return {
    id: `c${order}`,
    order,
    state,
    ...(state === 'error' ? { error: { code: 'INPUT', message: 'x' } } : {}),
    notices: [],
    opponent: opts.custom ? { id: opp, source: 'custom' } : { id: opp, source: 'ladder', usage: opts.usage ?? 0 },
    category: 'physical',
    bundle: { key: `k${order}`, stats: [], minority: false },
    rows: [row],
    headline: state === 'error' ? { kind: 'error', reason: { code: 'INPUT', message: 'x' } } : headline,
    variable,
    moreRows: 0,
  }
}

const layout = (tab: Tab, cards: CardView[]) => sortByResult(cards, tab, (c) => c).map((s) => [s.key, s.items.map((c) => c.opponent.id)])

describe('sortByResult: 그룹 순서', () => {
  it('공격 탭: 확정1타 → 고난수 → 중난수 → 저난수 → 변동 없음 → 계산 불가 → 계산 중, 빈 그룹은 없음', () => {
    const cards = [
      card('pend', 'pending', { usage: 0.9 }),
      card('none', 'no-change', { usage: 0.8 }),
      card('low', { tier: 'low-roll-ohko' }, { usage: 0.7 }),
      card('err', 'error', { usage: 0.65 }),
      card('high', { tier: 'high-roll-ohko' }, { usage: 0.6 }),
      card('ko', { tier: 'guaranteed-ohko' }, { usage: 0.5 }),
      card('mid', { tier: 'mid-roll-ohko' }, { usage: 0.4 }),
    ]
    expect(layout('attack', cards)).toEqual([
      ['tier:guaranteed-ohko', ['ko']],
      ['tier:high-roll-ohko', ['high']],
      ['tier:mid-roll-ohko', ['mid']],
      ['tier:low-roll-ohko', ['low']],
      ['no-change', ['none']],
      ['error', ['err']],
      ['pending', ['pend']],
    ])
  })

  it('방어 탭은 확정견딤이 가장 유리하다(공격과 반대 순서)', () => {
    const cards = [
      card('ko', { tier: 'guaranteed-ohko' }, { usage: 0.9 }),
      card('surv', { tier: 'guaranteed-survive' }, { usage: 0.1 }),
      card('low', { tier: 'low-roll-ohko' }, { usage: 0.5 }),
      card('high', { tier: 'high-roll-ohko' }, { usage: 0.6 }),
    ]
    expect(layout('defense', cards).map((s) => s[0])).toEqual(['tier:guaranteed-survive', 'tier:low-roll-ohko', 'tier:high-roll-ohko', 'tier:guaranteed-ohko'])
  })

  it('스피드 탭: 선공 → 동속 → 후공', () => {
    const cards = [card('tie', { tier: 'tie' }, { usage: 0.9 }), card('second', { tier: 'second' }, { usage: 0.8 }), card('first', { tier: 'first' }, { usage: 0.1 })]
    expect(layout('speed', cards)).toEqual([
      ['tier:first', ['first']],
      ['tier:tie', ['tie']],
      ['tier:second', ['second']],
    ])
  })
})

describe('sortByResult: 그룹 안 순서', () => {
  it('사용률 내림차순, 동률은 입력 순', () => {
    const cards = [
      card('b', { tier: 'guaranteed-ohko' }, { usage: 0.2 }),
      card('tieA', { tier: 'guaranteed-ohko' }, { usage: 0.3 }),
      card('a', { tier: 'guaranteed-ohko' }, { usage: 0.5 }),
      card('tieB', { tier: 'guaranteed-ohko' }, { usage: 0.3 }),
    ]
    expect(layout('attack', cards)).toEqual([['tier:guaranteed-ohko', ['a', 'tieA', 'tieB', 'b']]])
  })

  it('목록 밖 타겟은 그 그룹 맨 앞(추가 순), 다른 그룹으로는 넘어가지 않는다', () => {
    const cards = [
      card('ladder', { tier: 'high-roll-ohko' }, { usage: 0.9 }),
      card('custom1', { tier: 'high-roll-ohko' }, { custom: true }),
      card('custom2', 'no-change', { custom: true }),
      card('custom3', { tier: 'high-roll-ohko' }, { custom: true }),
      card('ladder2', 'no-change', { usage: 0.5 }),
    ]
    expect(layout('attack', cards)).toEqual([
      ['tier:high-roll-ohko', ['custom1', 'custom3', 'ladder']],
      ['no-change', ['custom2', 'ladder2']],
    ])
  })

  it('입력 항목을 그대로 돌려준다(카드를 꺼내는 함수로 감싼 항목)', () => {
    const items = [{ c: card('x', 'no-change', { usage: 0.1 }) }, { c: card('y', { tier: 'first' }, { usage: 0.1 }) }]
    const out = sortByResult(items, 'speed', (i) => i.c)
    expect(out.map((s) => s.items)).toEqual([[items[1]], [items[0]]])
  })
})

describe('resultBucket', () => {
  it('변동 가능이어도 변화 있는 행 최선 판정이 없으면 계산 중', () => {
    expect(resultBucket(card('x', 'stale-headline'), 'attack')).toEqual({ kind: 'pending' })
  })
  it('판정 전 행이 있으면 계산 중, 오류 카드는 계산 불가, 변동 없음은 변동 없음', () => {
    expect(resultBucket(card('x', 'pending'), 'attack')).toEqual({ kind: 'pending' })
    expect(resultBucket(card('x', 'error'), 'attack')).toEqual({ kind: 'error' })
    expect(resultBucket(card('x', 'no-change'), 'attack')).toEqual({ kind: 'no-change' })
  })

  /** 변화 있는 행 하나(best 지정, 상태 지정) */
  const changed = (id: string, best: string | undefined, status: RowView['status'] = 'ok'): RowView => ({
    id,
    kind: 'base',
    order: 0,
    status,
    noChange: false,
    cells: [{ sp: 0, category: best ?? 'guaranteed-survive', overBudget: false, need: 0 }],
    current: { sp: 0 },
    boundaries: [],
    nearest: {},
    ...(best === undefined ? {} : { best }),
  })
  const withRows = (rows: RowView[], headline: Headline): CardView => ({ ...card('x', { tier: 'guaranteed-ohko' }), rows, headline, variable: true })

  it('내 SP 드래그 중(행이 stale, 대표 updating)에도 직전 확정 그룹 그대로', () => {
    const settled = withRows([changed('a', 'high-roll-ohko'), changed('b', 'mid-roll-ohko')], { kind: 'row', rowId: 'b' })
    const dragging = withRows([changed('a', 'high-roll-ohko', 'stale'), changed('b', 'mid-roll-ohko', 'stale')], { kind: 'updating' })
    expect(resultBucket(settled, 'attack')).toEqual({ kind: 'tier', tier: 'high-roll-ohko' })
    expect(resultBucket(dragging, 'attack')).toEqual({ kind: 'tier', tier: 'high-roll-ohko' })
  })

  it('대표 행이 바뀌어도 그룹은 같다(변화 있는 행들 best 중 탭 관점 최선)', () => {
    const rows = [changed('a', 'low-roll-ohko'), changed('b', 'guaranteed-survive')]
    for (const rowId of ['a', 'b']) {
      expect(resultBucket(withRows(rows, { kind: 'row', rowId }), 'attack')).toEqual({ kind: 'tier', tier: 'low-roll-ohko' })
      expect(resultBucket(withRows(rows, { kind: 'row', rowId }), 'defense')).toEqual({ kind: 'tier', tier: 'guaranteed-survive' })
    }
  })

  it('변화 있는 행 중 best 미확정·판정 전 행·잠정 변화 없음 행이 있으면 계산 중', () => {
    expect(resultBucket(withRows([changed('a', 'guaranteed-ohko'), changed('b', undefined)], { kind: 'row', rowId: 'a' }), 'attack')).toEqual({ kind: 'pending' })
    const pendingRow: RowView = { ...changed('p', undefined, 'pending'), noChange: true, cells: [] }
    expect(resultBucket(withRows([changed('a', 'guaranteed-ohko'), pendingRow], { kind: 'row', rowId: 'a' }), 'attack')).toEqual({ kind: 'pending' })
    const provisional: RowView = { ...changed('q', undefined), noChange: true, provisional: true }
    expect(resultBucket(withRows([changed('a', 'guaranteed-ohko'), provisional], { kind: 'row', rowId: 'a' }), 'attack')).toEqual({ kind: 'pending' })
    // 계산 불가 행·변화 없는 확정 행은 최선 판정에 들지 않는다
    const err: RowView = { ...changed('e', undefined, 'error'), cells: [] }
    const fixed: RowView = { ...changed('f', undefined), noChange: true }
    expect(resultBucket(withRows([changed('a', 'tie'), err, fixed], { kind: 'row', rowId: 'a' }), 'speed')).toEqual({ kind: 'tier', tier: 'tie' })
  })
  it('bucketKey', () => {
    const b: ResultBucket = { kind: 'tier', tier: 'first' }
    expect(bucketKey(b)).toBe('tier:first')
    expect(bucketKey({ kind: 'pending' })).toBe('pending')
  })
})

// ---------- 실데이터: 조립이 싣는 RowView.best ----------

const { game } = realData()
const reg = game.manifest.regulation.id
const garchomp: PokemonSet = {
  regulation: reg,
  species: 'garchomp',
  ability: 'roughskin',
  nature: 'jolly',
  sp: { hp: 2, atk: 32, def: 0, spa: 0, spd: 0, spe: 32 },
  moves: ['earthquake', 'dragonclaw', 'rockslide', 'protect'],
}
const input = cardInput({ mySet: garchomp, filters: { topN: 12, selected: [] } })

describe('조립 RowView.best(실데이터)', () => {
  for (const tab of TABS) {
    it(`${tab}: 변화 있는 ok 행만 best가 있고, 그 행 칸 어느 것보다 나쁘지 않다`, () => {
      const view = buildTabView(input, tab)
      let variableRows = 0
      for (const c of view.cards) {
        for (const r of c.rows) {
          if (r.noChange) {
            expect(r.best).toBeUndefined()
            continue
          }
          if (r.status !== 'ok') continue
          variableRows++
          expect(r.best, `${c.id} ${r.id}`).toBeDefined()
          const best = tierRank(tab, r.best as string)
          for (const cell of r.cells) expect(best).toBeGreaterThanOrEqual(tierRank(tab, cell.category))
        }
        // 다 계산된 뷰에는 계산 중 그룹이 없다
        const bucket = resultBucket(c, tab)
        expect(bucket.kind).not.toBe('pending')
        if (bucket.kind === 'tier') expect(c.variable).toBe(true)
        if (bucket.kind === 'no-change') expect(c.variable).toBe(false)
      }
      expect(variableRows).toBeGreaterThan(0)
    })
  }

  it('공격 탭 best = 그 행 무보정·상승 33칸 + 범위 끝 중 최선(현재 성격 칸만으로 정하지 않는다)', () => {
    const view = buildTabView(input, 'attack')
    const rows = view.cards.flatMap((c) => c.rows).filter((r) => !r.noChange && r.status === 'ok')
    // 대미지는 SP·상승 보정에 단조라 최선은 최소한 현재 성격 최대 칸 이상
    for (const r of rows) expect(tierRank('attack', r.best as string)).toBeGreaterThanOrEqual(tierRank('attack', r.cells[r.cells.length - 1].category))
  })

  it('방어 쌍 행 best = 극단 필터 높은 극단 범주', () => {
    const plan = planTab(input, 'defense')
    const results = new Map<string, RowTaskResult>()
    for (;;) {
      const stage = nextStage(pendingTasks(plan, results))
      if (stage.length === 0) break
      for (const t of stage) results.set(taskKey(t), computeRowTask(plan, t))
    }
    const view = assembleTab(plan, results)
    let checked = 0
    for (const c of view.cards) {
      for (const r of c.rows) {
        if (r.noChange || r.status !== 'ok') continue
        const spec = plan.rows[r.id]
        if (spec?.gate === undefined) continue
        const ex = results.get(taskKey({ kind: 'extreme', filterId: spec.gate }))
        if (ex?.kind !== 'extreme') throw new Error('극단 결과 없음')
        expect(r.best).toBe(ex.high.category)
        checked++
      }
    }
    expect(checked).toBeGreaterThan(0)
  })

  it('성격 변형 스윕 전에는 쌍 아닌 변화 있는 행에 best가 없고 그 카드는 계산 중 그룹', () => {
    const plan = planTab(input, 'attack')
    const results = new Map<string, RowTaskResult>()
    // 1~3단계만(성격 변형 스윕 = 4단계 전까지)
    for (;;) {
      const pending = pendingTasks(plan, results)
      if (pending.stage1.length + pending.stage2.length + pending.stage3.length === 0) break
      for (const t of nextStage(pending)) results.set(taskKey(t), computeRowTask(plan, t))
    }
    expect(pendingTasks(plan, results).stage4.length).toBeGreaterThan(0)
    const view = assembleTab(plan, results)
    let checked = 0
    for (const c of view.cards) {
      for (const r of c.rows) {
        const spec = plan.rows[r.id]
        if (r.noChange || r.status !== 'ok' || spec === undefined || spec.gate !== undefined) continue
        if (rowJudgements(plan, results, r.id).variantsDone) continue
        // 변형 스윕이 남은 변화 있는 행: 최선 판정 미확정
        expect(r.best).toBeUndefined()
        const h = c.headline
        if (h.kind === 'row' && h.rowId === r.id) expect(resultBucket(c, 'attack')).toEqual({ kind: 'pending' })
        // 대표가 아니어도 best 미확정 행이 있는 카드는 계산 중
        expect(resultBucket(c, 'attack')).toEqual({ kind: 'pending' })
        checked++
      }
    }
    expect(checked).toBeGreaterThan(0)
  })
})
