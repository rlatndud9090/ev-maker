// 판정 행 기술 선택 항목(PRD R2·R3·R4·R5, damage-tabs-row-revamp). 기본 항목 규칙은 항목 상태를 직접 넣어, 목록·선택은 실데이터로 확인한다.
import { describe, expect, it } from 'vitest'
import { compareSpeed, type PokemonSet, type SpTable } from '../core'
import { EXAMPLE_SET } from './__fixtures__/acceptance'
import { assembleTab } from './assemble'
import { buildTabView } from './batch'
import { computeRowTask } from './rowTask'
import { BASE_CONDITION_ID, cardItems, compareItems, compareStrength, itemKey, mainMoves, resolveDefault, type ItemState, type ItemVariability } from './items'
import { defaultOption, groupCards, groupItems } from './groups'
import { outspeedsAtMax, planTab } from './plan'
import { cardExplore, nextStage, opponentKey, pendingTasks, taskCardId, taskKey } from './schedule'
import { cardInput, realData } from './testing'
import type { CardInput, CardSpec, CardView, CompactCell, RowTaskResult, Tab, TabPlan } from './types'

const RANK = JSON.stringify(['rank', 'opponent', 'move', 'swordsdance'])
const RANK2 = JSON.stringify(['rank', 'opponent', 'move', 'dragondance'])
const cell = (ohkoChance: number, maxPercent: number): CompactCell => ({ sp: 0, category: 'x', ohkoChance, maxPercent })
const VAR: ItemVariability = { kind: 'variable' }
const fixed = (category: string): ItemVariability => ({ kind: 'fixed', category })
const OHKO = fixed('guaranteed-ohko')
const SURVIVE = fixed('guaranteed-survive')
const MID = fixed('mid-roll-ohko')

let order = 0
function item(moveId: string, rankBefore: boolean, probe: ItemState['probe'], variability: ItemVariability, patch: Partial<ItemState> = {}): ItemState {
  const conditionId = rankBefore ? BASE_CONDITION_ID : RANK
  // 기본은 모든 기술이 주력(채용률 0): 주력 선정과 무관한 표·선공기 규칙 검사용
  return { key: itemKey(moveId, conditionId), moveId, rankBefore, priority: false, share: 0, main: true, probe, variability, moveOrder: order++, conditionOrder: rankBefore ? 0 : 1, ...patch }
}
const ok = (p: number, m: number) => ({ kind: 'ok' as const, cell: cell(p, m) })
const immune = { kind: 'immune' as const, cell: { sp: 0, category: 'guaranteed-survive', immune: true as const } }
const error = { kind: 'error' as const, reason: { code: 'WHITE_HERB_MULTIHIT' as const, message: 'x' } }
/** 기준 기술 m의 랭크 전 P(약함) · 랭크 후 Q(셈) + 더 약한 주력 아닌 다른 기술(P/Q 표 검사용) */
function pq(p: ItemVariability, q: ItemVariability, pProbe: ItemState['probe'] = ok(0.2, 80), qProbe: ItemState['probe'] = ok(0.9, 120)) {
  const P = item('m', true, pProbe, p)
  const Q = item('m', false, qProbe, q)
  const other = item('o', true, ok(0, 20), VAR, { main: false })
  return { P, Q, items: [Q, other, P] }
}
const pick = (items: readonly ItemState[], priorityRule = false, variableFirst = true) => resolveDefault(items, { priorityRule, variableFirst })

describe('resolveDefault: 랭크 전 P·후 Q 표(R4-3, 위에서부터 첫 일치)', () => {
  it('1. P 정상·Q 무효/계산 불가 → P', () => {
    for (const qProbe of [immune, error]) {
      const { P, items } = pq(MID, VAR, ok(0.2, 80), qProbe)
      expect(pick(items)).toMatchObject({ kind: 'ready', key: P.key })
    }
  })
  it('2. P 무효/계산 불가·Q 정상 → Q', () => {
    // 정상 랭크 전 항목이 없으면 정렬 첫 항목(정상인 Q)이 기본이다.
    const P = item('m', true, error, { kind: 'error', reason: error.reason })
    const Q = item('m', false, ok(0.9, 120), SURVIVE)
    expect(pick([P, Q])).toMatchObject({ kind: 'ready', key: Q.key })
    // 반대로 Q가 무효면(1번 줄) 판정 전이어도 기다리지 않고 P.
    const P2 = item('n', true, ok(0.1, 50), MID)
    const Q2 = item('n', false, immune, { kind: 'pending' })
    expect(pick([P2, Q2])).toMatchObject({ kind: 'ready', key: P2.key })
  })
  it('3. P 변동·Q 고정 → P', () => {
    const { P, items } = pq(VAR, OHKO)
    expect(pick(items)).toMatchObject({ kind: 'ready', key: P.key })
  })
  it('4. P 고정·Q 변동 → Q', () => {
    const { Q, items } = pq(SURVIVE, VAR)
    expect(pick(items)).toMatchObject({ kind: 'ready', key: Q.key })
  })
  it('5. 둘 다 변동 → P(사용자 결정 2026-11-13)', () => {
    const { P, items } = pq(VAR, VAR)
    expect(pick(items)).toMatchObject({ kind: 'ready', key: P.key })
  })
  it('6. P 확정1타 고정 → P(랭크업 없이도 1타)', () => {
    const { P, items } = pq(OHKO, OHKO)
    expect(pick(items)).toMatchObject({ kind: 'ready', key: P.key })
  })
  it('7. P 고정(확정1타 아님)·Q 확정견딤 고정 → Q(랭크업해도 버팀)', () => {
    const { Q, items } = pq(SURVIVE, SURVIVE)
    expect(pick(items)).toMatchObject({ kind: 'ready', key: Q.key })
  })
  it('8. 그 밖(P 확정견딤·Q 확정1타 등) → P', () => {
    const { P, items } = pq(SURVIVE, OHKO)
    expect(pick(items)).toMatchObject({ kind: 'ready', key: P.key })
    const mid = pq(MID, MID)
    expect(pick(mid.items)).toMatchObject({ kind: 'ready', key: mid.P.key })
  })
  it('랭크 후 항목이 둘이면 Q = 변동인 것 중 가장 센 것(더 약해도 변동이면 그쪽)', () => {
    const P = item('m', true, ok(0, 60), SURVIVE)
    const strong = item('m', false, ok(0.5, 110), OHKO)
    const weakVar = item('m', false, ok(0.1, 90), VAR, { key: itemKey('m', RANK2), conditionOrder: 2 })
    expect(pick([strong, weakVar, P])).toMatchObject({ kind: 'ready', key: weakVar.key })
    const weakFixed = { ...weakVar, variability: SURVIVE }
    // 변동인 Q가 없으면 가장 센 Q(확정1타) → 8번 줄 → P
    expect(pick([strong, weakFixed, P])).toMatchObject({ kind: 'ready', key: P.key })
  })
  it('랭크 후 항목이 없으면 기준 기술의 랭크 전 항목', () => {
    const P = item('m', true, ok(0, 60), SURVIVE)
    expect(pick([P, item('o', true, ok(0, 10), VAR, { main: false })])).toMatchObject({ kind: 'ready', key: P.key, viaPriority: false, basis: P.key })
  })
})

describe('resolveDefault: 사용자 요구 사례(방어 탭 도각참, PRD AC7)', () => {
  const cleave = (p: ItemVariability, q: ItemVariability) => pq(p, q, ok(0, 56), ok(0.56, 101))
  it('+2는 늘 확정1타, 칼춤 전은 변동 → 칼춤 전 도각참', () => {
    const { P, items } = cleave(VAR, OHKO)
    expect(pick(items)).toMatchObject({ key: P.key })
  })
  it('칼춤 전은 늘 확정견딤, +2가 변동 → +2 도각참', () => {
    const { Q, items } = cleave(SURVIVE, VAR)
    expect(pick(items)).toMatchObject({ key: Q.key })
  })
  it('칼춤 전도 확정1타 → 칼춤 전, +2도 확정견딤 → +2', () => {
    expect(pick(cleave(OHKO, OHKO).items)).toMatchObject({ key: cleave(OHKO, OHKO).P.key })
    expect(pick(cleave(SURVIVE, SURVIVE).items)).toMatchObject({ key: cleave(SURVIVE, SURVIVE).Q.key })
  })
})

describe('resolveDefault: 결정에 필요한 판정(need)', () => {
  it('단건 판정이 남았으면 pending(need 없음, 단건 판정은 늘 1단계)', () => {
    const { items } = pq(VAR, VAR, { kind: 'pending' })
    expect(pick(items)).toEqual({ kind: 'pending', need: [] })
  })
  it('P 변동 판정 전 → need [P]. P가 변동이면 Q 판정 없이 정해진다', () => {
    const { P, items } = pq({ kind: 'pending' }, { kind: 'pending' })
    expect(pick(items)).toEqual({ kind: 'pending', need: [P.key] })
    const v = pq(VAR, { kind: 'pending' })
    expect(pick(v.items)).toMatchObject({ kind: 'ready', key: v.P.key })
  })
  it('P 고정(확정1타 아님)이면 Q들의 판정이 필요하다', () => {
    const { Q, items } = pq(SURVIVE, { kind: 'pending' })
    expect(pick(items)).toEqual({ kind: 'pending', need: [Q.key] })
  })
})

describe('resolveDefault: 방어 탭 선공기 우선(R4-2, PRD AC8)', () => {
  const build = (priorityVar: ItemVariability, priorityQ?: ItemVariability) => {
    const cleave = item('kowtowcleave', true, ok(0.5, 101), VAR)
    const sucker = item('suckerpunch', true, ok(0, 60), priorityVar, { priority: true })
    const out = [cleave, sucker]
    if (priorityQ !== undefined) out.push(item('suckerpunch', false, ok(0.1, 90), priorityQ, { priority: true }))
    return { cleave, sucker, items: out }
  }
  it('(a) 내가 확실히 빠르고(priorityRule) 선공기가 변동 → 선공기가 기준 기술', () => {
    const { sucker, items } = build(VAR)
    expect(pick(items, true)).toMatchObject({ kind: 'ready', key: sucker.key, viaPriority: true, basis: sucker.key })
  })
  it('(a) 선공기 랭크 후 항목만 변동이어도 우선 → 그 기술의 P·Q 표(P 확정견딤·Q 변동 → Q)', () => {
    const { items } = build(SURVIVE, VAR)
    expect(pick(items, true)).toMatchObject({ kind: 'ready', key: itemKey('suckerpunch', RANK), viaPriority: true })
  })
  it('(b)(c) 내가 확실히 빠르지 않으면(priorityRule 거짓: 동속·상대가 빠름) 우선하지 않는다', () => {
    const { cleave, items } = build(VAR)
    expect(pick(items, false)).toMatchObject({ key: cleave.key, viaPriority: false })
  })
  it('(d) 선공기가 고정이면 우선하지 않는다', () => {
    const { cleave, items } = build(SURVIVE)
    expect(pick(items, true)).toMatchObject({ key: cleave.key, viaPriority: false })
  })
  it('선공기 변동 판정 전이면 결정을 미룬다(need)', () => {
    const { sucker, items } = build({ kind: 'pending' })
    expect(pick(items, true)).toEqual({ kind: 'pending', need: [sucker.key] })
  })
})

describe('resolveDefault: 성묘 위력 항목(R15) — 성묘(100) = P, 성묘(150)·(200)·랭크 후 = Q 후보', () => {
  const faint = (n: number) => JSON.stringify(['faint', n])
  const lr = (cond: string, rankBefore: boolean, probe: ItemState['probe'], variability: ItemVariability, conditionOrder: number) => ({
    ...item('lastrespects', rankBefore, probe, variability, { conditionOrder }),
    key: itemKey('lastrespects', cond),
  })
  function set(p: ItemVariability, q2: ItemVariability, q3: ItemVariability, rank?: ItemVariability) {
    const P = lr(faint(1), true, ok(0.3, 90), p, 1)
    const Q2 = lr(faint(2), false, ok(0.8, 130), q2, 2)
    const Q3 = lr(faint(3), false, ok(1, 170), q3, 3)
    const out = [Q3, item('phantomforce', true, ok(0.1, 80), VAR, { main: false }), Q2, P]
    if (rank !== undefined) out.push(lr(RANK, false, ok(0.9, 150), rank, 4))
    return { P, Q2, Q3, items: out }
  }

  it('성묘(100)이 기준 기술 P: 변동이면 Q와 무관하게 성묘(100)', () => {
    const s = set(VAR, VAR, VAR)
    expect(pick(s.items)).toMatchObject({ kind: 'ready', key: s.P.key, basis: s.P.key })
  })

  it('P 확정견딤 고정 → 변동 우선: 성묘(150)만 변동이면 성묘(150), 셋 다 확정견딤이면 가장 센 성묘(200)', () => {
    const a = set(SURVIVE, VAR, OHKO)
    expect(pick(a.items)).toMatchObject({ kind: 'ready', key: a.Q2.key })
    const b = set(SURVIVE, SURVIVE, SURVIVE)
    expect(pick(b.items)).toMatchObject({ kind: 'ready', key: b.Q3.key })
    // Q가 확정1타 고정이면 P(표 8번 줄)
    const c = set(SURVIVE, OHKO, OHKO)
    expect(pick(c.items)).toMatchObject({ kind: 'ready', key: c.P.key })
  })

  it('랭크 후 항목(성묘(100) 기준 칼춤)도 같은 Q 후보: 그것만 변동이면 그 항목', () => {
    const s = set(SURVIVE, OHKO, OHKO, VAR)
    expect(pick(s.items)).toMatchObject({ kind: 'ready', key: itemKey('lastrespects', RANK) })
  })
})

describe('compareStrength: 가장 세게 치는 순(기준 기술·Q 비교, R4)', () => {
  it('1타 확률 → 최대 대미지 비율 → 같은 기술 랭크 전 먼저 → 기술 순 / 계산 불가는 정상 뒤·무효 앞, 무효는 맨 뒤', () => {
    const a = item('a', true, ok(0.5, 100), VAR, { moveOrder: 0 })
    const b = item('b', true, ok(0.75, 90), VAR, { moveOrder: 1 })
    const c = item('c', true, ok(0.5, 120), VAR, { moveOrder: 2 })
    const cRank = item('c', false, ok(0.5, 120), VAR, { moveOrder: 2 })
    const err = item('e', true, error, { kind: 'error', reason: error.reason }, { moveOrder: 3 })
    const imm = item('i', true, immune, SURVIVE, { moveOrder: 4 })
    const sorted = [imm, err, a, cRank, b, c].sort(compareStrength).map((i) => i.key)
    expect(sorted).toEqual([b.key, c.key, cRank.key, a.key, err.key, imm.key])
  })
})

describe('compareItems: 목록 = 기술 채용률 순, 같은 기술 안은 강한 순, 계산 불가 → 무효 맨 뒤(R16, PRD AC38)', () => {
  it('채용률 높은 기술이 더 약해도 앞, 같은 기술 항목은 강한 순(판정 전은 그 기술 안 뒤), 채용률 동률은 기존 기술 순서', () => {
    const weakTop = item('top', true, ok(0, 30), VAR, { share: 0.9, moveOrder: 2 })
    const topRank = item('top', false, ok(0.5, 90), VAR, { share: 0.9, moveOrder: 2 })
    const topPending = { ...item('top', false, { kind: 'pending' }, { kind: 'pending' }, { share: 0.9, moveOrder: 2 }), key: itemKey('top', RANK2) }
    const strongLow = item('low', true, ok(1, 200), VAR, { share: 0.1, moveOrder: 0 })
    const tieA = item('tieA', true, ok(0, 10), VAR, { share: 0.5, moveOrder: 3 })
    const tieB = item('tieB', true, ok(1, 150), VAR, { share: 0.5, moveOrder: 1 })
    // 계산 불가·무효는 채용률과 무관하게 맨 뒤(계산 불가 → 무효)
    const err = item('e', true, error, { kind: 'error', reason: error.reason }, { share: 1, moveOrder: 4 })
    const imm = item('i', true, immune, SURVIVE, { share: 1, moveOrder: 5 })
    const sorted = [imm, strongLow, err, tieA, weakTop, topPending, tieB, topRank].sort(compareItems).map((i) => i.key)
    expect(sorted).toEqual([topRank.key, weakTop.key, topPending.key, tieB.key, tieA.key, strongLow.key, err.key, imm.key])
  })
  it('정상 항목이 하나도 없으면 정렬 첫 항목(계산 불가)이 기본', () => {
    const err = item('e', true, error, { kind: 'error', reason: error.reason })
    const imm = item('i', true, immune, SURVIVE)
    expect(pick([imm, err])).toMatchObject({ kind: 'ready', key: err.key, fallback: true })
  })
})

describe('mainMoves: 방어 탭 주력 기술 = 선공기 제외 채용률 ≥ 20%(R4-1 재개정, PRD AC38)', () => {
  const m = (moveId: string, share: number, priority = false) => ({ moveId, share, priority })
  it('경계 0.20 포함·0.199 제외, 선공기는 채용률이 높아도 제외(고릴타 그래스슬라이더)', () => {
    expect(mainMoves([m('grassyglide', 0.99, true), m('woodhammer', 0.87), m('a', 0.2), m('b', 0.199)], true)).toEqual(new Set(['woodhammer', 'a']))
  })
  it('20% 이상이 없으면 선공기 아닌 채용률 1위 하나(동률 입력 순 앞), 선공기뿐이면 채용률 1위', () => {
    expect(mainMoves([m('p', 0.9, true), m('a', 0.1), m('b', 0.15), m('c', 0.15)], true)).toEqual(new Set(['b']))
    expect(mainMoves([m('p', 0.3, true), m('q', 0.9, true)], true)).toEqual(new Set(['q']))
    expect(mainMoves([], true)).toEqual(new Set())
  })
  it('목록 밖 타겟(채용률 없음): 선공기 아닌 지정 기술 전부, 선공기뿐이면 첫 기술', () => {
    expect(mainMoves([m('p', 0, true), m('a', 0), m('b', 0)], false)).toEqual(new Set(['a', 'b']))
    expect(mainMoves([m('p', 0, true), m('q', 0, true)], false)).toEqual(new Set(['p']))
  })
})

describe('resolveDefault: 기준 기술 = 주력 중 변동 기술의 채용률 1위, 모두 고정이면 채용률 1위(R4-1 재개정, PRD AC38)', () => {
  const main = (moveId: string, probe: ItemState['probe'], v: ItemVariability, share = 0.5) => item(moveId, true, probe, v, { share })
  const side = (moveId: string, probe: ItemState['probe'], v: ItemVariability, share = 0.1) => item(moveId, true, probe, v, { share, main: false })
  it('메가플라엣테 예(매지컬샤인 93.7%·문포스 79.8%·파멸의빛 26.4%): 변동인 기술 중 채용률 최고 — 센 순과 무관', () => {
    const lor = main('lightofruin', ok(1, 266), OHKO, 0.264)
    const mb = main('moonblast', ok(1, 180), OHKO, 0.798)
    const dg = main('dazzlinggleam', ok(0.7, 113), VAR, 0.937)
    expect(pick([dg, mb, lor])).toMatchObject({ kind: 'ready', key: dg.key, basis: dg.key, fallback: false })
    // 같은 변동끼리는 채용률 높은 쪽(더 센 문포스가 변동이어도 매지컬샤인)
    const mbVar = { ...mb, variability: VAR }
    expect(pick([dg, mbVar, lor])).toMatchObject({ kind: 'ready', key: dg.key })
    // 매지컬샤인이 고정이면 변동인 것 중 채용률 다음인 문포스, 그것도 고정이면 변동인 파멸의빛
    const dgFixed = { ...dg, variability: SURVIVE }
    expect(pick([dgFixed, mbVar, lor])).toMatchObject({ kind: 'ready', key: mb.key })
    expect(pick([dgFixed, mb, { ...lor, variability: VAR }])).toMatchObject({ kind: 'ready', key: lor.key })
  })
  it('채용률 동률이면 기존 기술 순서(moveOrder)가 앞선 것', () => {
    const a = main('a', ok(0, 40), VAR, 0.5)
    const b = main('b', ok(1, 200), VAR, 0.5)
    expect(pick([b, a])).toMatchObject({ kind: 'ready', key: a.key })
  })
  it('공격 탭(variableFirst 아님)은 변동 우선 없이 가장 센 주력, 주력이 하나면 변동 판정을 기다리지 않는다', () => {
    const strong = main('a', ok(1, 200), OHKO)
    const weakVar = main('b', ok(0.5, 110), VAR)
    expect(pick([weakVar, strong], false, false)).toMatchObject({ kind: 'ready', key: strong.key })
    expect(pick([weakVar, { ...strong, variability: { kind: 'pending' } }], false, false)).toMatchObject({ kind: 'ready', key: strong.key })
    expect(pick([{ ...strong, variability: { kind: 'pending' } }, side('c', ok(0, 10), VAR)])).toMatchObject({ kind: 'ready', key: strong.key })
  })
  it('주력이 모두 고정이면 채용률 1위 주력(가장 센 것 아님), 채용률 20% 미만 강한 기술은 기준이 아니다(메가보만다 이판사판태클)', () => {
    const hv = main('hypervoice', ok(0, 50), SURVIVE, 0.96)
    const dm = main('dracometeor', ok(0.2, 150), MID, 0.64)
    const de = side('doubleedge', ok(1, 200), VAR, 0.177)
    expect(pick([hv, de, dm])).toMatchObject({ kind: 'ready', key: hv.key, basis: hv.key })
  })
  it('메가눈여아 예: 주력이 모두 고정이면 급소 확정으로 더 센 얼음숨결(37.7%)보다 채용률 99.9% 눈보라', () => {
    const fb = main('frostbreath', ok(1, 242), OHKO, 0.377)
    const bz = main('blizzard', ok(1, 216), OHKO, 0.999)
    const sb = main('shadowball', ok(0, 53), SURVIVE, 0.993)
    expect(pick([fb, bz, sb])).toMatchObject({ kind: 'ready', key: bz.key, basis: bz.key })
  })
  it('조기 확정은 채용률 순: 채용률 1위가 변동이면 더 센 기술 판정을 기다리지 않고, 1위 판정 전이면 1위만 기다린다', () => {
    const top = main('top', ok(0, 40), VAR, 0.9)
    const strongPending = main('strong', ok(1, 200), { kind: 'pending' }, 0.3)
    expect(pick([strongPending, top])).toMatchObject({ kind: 'ready', key: top.key })
    expect(pick([strongPending, { ...top, variability: { kind: 'pending' } }])).toEqual({ kind: 'pending', need: [top.key] })
  })
  it('랭크 후·성묘 위력 항목만 변동인 기술도 변동으로 본다: 랭크 전은 고정이어도 그 기술이 기준, P/Q 표로 Q', () => {
    const strong = main('a', ok(0, 95), SURVIVE)
    const lr = main('lastrespects', ok(0, 75), SURVIVE)
    const lrQ = item('lastrespects', false, ok(1, 150), VAR, { share: 0.5 })
    expect(pick([strong, lr, lrQ])).toMatchObject({ kind: 'ready', key: lrQ.key, basis: lr.key })
  })
  it('조기 확정: 앞 기술이 변동이면 뒤 기술 변동 판정을 기다리지 않고, 앞 기술 변동 판정 전이면 그 항목만 기다린다', () => {
    const first = main('a', ok(0.5, 120), VAR)
    const later = main('b', ok(0, 60), { kind: 'pending' })
    expect(pick([later, first])).toMatchObject({ kind: 'ready', key: first.key })
    const firstPending = { ...first, variability: { kind: 'pending' } as const }
    expect(pick([later, firstPending])).toEqual({ kind: 'pending', need: [first.key] })
    // 앞 기술 랭크 전이 고정이면 그 기술 랭크 후 항목의 변동 판정을 기다린다(뒤 기술은 아직 아님)
    const fixedFirst = { ...first, variability: MID }
    const firstQ = item('a', false, ok(0.9, 150), { kind: 'pending' }, { share: 0.5 })
    expect(pick([later, fixedFirst, firstQ])).toEqual({ kind: 'pending', need: [firstQ.key] })
    // 앞 기술이 모두 고정이면 다음 기술을 기다린다
    expect(pick([later, fixedFirst])).toEqual({ kind: 'pending', need: [later.key] })
    expect(pick([{ ...later, variability: VAR }, fixedFirst])).toMatchObject({ kind: 'ready', key: later.key })
  })
  it('무효·계산 불가 주력은 빠지고, 정상 주력이 없으면 목록(채용률 순) 첫 정상 항목(대체)', () => {
    const immMain = main('earthquake', immune, SURVIVE, 0.9)
    const weak = main('rockslide', ok(0, 30), MID, 0.5)
    const de = side('doubleedge', ok(1, 160), VAR)
    expect(pick([immMain, de, weak])).toMatchObject({ kind: 'ready', key: weak.key, fallback: false })
    const errMain = { ...main('m', error, { kind: 'error', reason: error.reason }, 0.9), probe: error }
    const a = side('a', ok(1, 200), VAR, 0.2)
    const b = side('b', ok(0, 10), VAR, 0.6)
    // 대체: 목록(채용률 순)에서 선공기 아닌 첫 정상 랭크 전 항목 = 채용률 높은 b(a보다 약해도, 랭크 후 bQ가 더 세도), 이후 단계(P/Q·선공기)는 건너뛴다
    const bQ = item('b', false, ok(0.5, 90), VAR, { share: 0.6, main: false })
    expect(pick([a, errMain, b, bQ], true)).toMatchObject({ kind: 'ready', key: b.key, fallback: true, viaPriority: false })
    // 주력이 모두 무효여도 채용률 높은 선공기는 대체로 고르지 않는다(선공기는 주력이 아님)
    const sp = item('suckerpunch', true, ok(1, 120), VAR, { share: 0.99, main: false, priority: true })
    expect(pick([errMain, sp, a], true)).toMatchObject({ kind: 'ready', key: a.key, fallback: true })
  })
  it('주력 랭크 전 항목 단건 판정만 기다린다: 주력 아닌 기술의 판정 전은 결정을 막지 않고, 정해진 값은 그 판정이 나와도 같다', () => {
    const hv = main('hypervoice', ok(0.2, 80), VAR, 0.95)
    const pending = side('doubleedge', { kind: 'pending' }, { kind: 'pending' })
    expect(pick([hv, pending])).toMatchObject({ kind: 'ready', key: hv.key })
    expect(pick([hv, { ...pending, probe: ok(1, 200), variability: VAR }])).toMatchObject({ kind: 'ready', key: hv.key })
    expect(pick([{ ...hv, probe: { kind: 'pending' } }, { ...pending, probe: ok(1, 200) }])).toEqual({ kind: 'pending', need: [] })
    // 기준 기술의 랭크 후 항목 판정 전이면 기다린다
    const hvQ = item('hypervoice', false, { kind: 'pending' }, { kind: 'pending' }, { share: 0.95 })
    expect(pick([hv, hvQ])).toEqual({ kind: 'pending', need: [] })
  })
  it('선공기 우선(R4-2)은 주력이 아니어도 그대로: 변동인 선공기가 기준, 선공기 판정 전이면 기다린다', () => {
    const hv = main('hypervoice', ok(0.2, 80), VAR, 0.95)
    const pri = { ...side('extremespeed', ok(0, 40), VAR, 0.05), priority: true }
    expect(pick([hv, pri], true)).toMatchObject({ kind: 'ready', key: pri.key, viaPriority: true })
    expect(pick([hv, { ...pri, probe: { kind: 'pending' } }], true)).toEqual({ kind: 'pending', need: [] })
  })
})

const sp = (patch: Partial<SpTable>): SpTable => ({ hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...patch })
const mon = (s: Omit<PokemonSet, 'regulation' | 'sp'> & { sp: Partial<SpTable> }): PokemonSet => ({ regulation: 'm-c', ...s, sp: sp(s.sp) })

describe('outspeedsAtMax: 선공기 우선의 스피드 조건(R4-2, PRD AC8)', () => {
  const { game } = realData()
  const jollyChomp = mon({ species: 'garchomp', ability: 'roughskin', nature: 'jolly', sp: { spe: 32 }, moves: ['earthquake'] })
  it('(a) 상대가 S 최대·상승 성격이어도 내가 더 빠르면 참', () => {
    const slow = mon({ species: 'kingambit', ability: 'defiant', nature: 'adamant', sp: { atk: 32 }, moves: ['kowtowcleave'] })
    expect(outspeedsAtMax(game, EXAMPLE_SET, slow)).toBe(true)
  })
  it('(b) 동속(같은 종 S 최대·상승)이면 거짓', () => {
    const other = mon({ species: 'garchomp', ability: 'roughskin', nature: 'adamant', sp: { atk: 32 }, moves: ['earthquake'] })
    expect(outspeedsAtMax(game, jollyChomp, other)).toBe(false)
  })
  it('(c) 상대가 더 빠를 수 있으면 거짓', () => {
    const slowMe = mon({ species: 'kingambit', ability: 'defiant', nature: 'adamant', sp: { atk: 32 }, moves: ['kowtowcleave'] })
    expect(outspeedsAtMax(game, slowMe, jollyChomp)).toBe(false)
  })
  it('(e) 상대 구애스카프는 빼고 비교한다', () => {
    const scarfed = mon({ species: 'incineroar', ability: 'intimidate', item: 'choicescarf', nature: 'adamant', sp: { atk: 32 }, moves: ['fakeout'] })
    const fastest = { ...scarfed, nature: 'jolly', sp: sp({ atk: 32, spe: 32 }) }
    // 스카프를 지닌 채 비교하면 상대가 더 빠르다(이 사례의 전제)
    expect(compareSpeed(game, EXAMPLE_SET, fastest, undefined, { ignoreSpTotal: true }).order).toBe('second')
    expect(outspeedsAtMax(game, EXAMPLE_SET, scarfed)).toBe(true)
  })
  it('(f) 판정 조건(공격측 상대 특성 날씨)의 날씨로 양쪽 스피드를 비교하고, 어느 쪽이든 구름보기면 날씨 없음(R12, PRD AC34)', () => {
    const venu = mon({ species: 'venusaur', ability: 'chlorophyll', nature: 'timid', sp: { spa: 32, spe: 32 }, moves: ['gigadrain'] })
    const nine = mon({ species: 'ninetales', ability: 'drought', nature: 'modest', sp: { spa: 32 }, moves: ['heatwave'] })
    const sun = { attacker: { tailwind: false }, defender: { tailwind: false }, weather: 'Sun' as const }
    expect(outspeedsAtMax(game, venu, nine)).toBe(false)
    expect(outspeedsAtMax(game, venu, nine, sun)).toBe(true)
    const altaria = mon({ species: 'altaria', ability: 'cloudnine', nature: 'modest', sp: { spa: 32 }, moves: ['dracometeor'] })
    expect(outspeedsAtMax(game, venu, altaria, sun)).toBe(false)
    expect(outspeedsAtMax(game, venu, { ...altaria, ability: 'naturalcure' }, sun)).toBe(true)
  })
})

describe('실데이터: 목록·기본 항목·직접 선택', () => {
  const floette = mon({ species: 'floetteeternal', ability: 'flowerveil', nature: 'modest', sp: { hp: 2, spa: 32, spe: 32 }, moves: ['moonblast', 'dazzlinggleam', 'calmmind', 'protect'] })
  const only = (id: string) => ({ topN: 30, selected: [id] })

  it('공격 탭 명상 플라엣테: 목록 = 문포스·매지컬샤인·+1 문포스·+1 매지컬샤인(변화기 없음, PRD AC1)', () => {
    const v = buildTabView(cardInput({ mySet: floette, filters: only('kingambit') }), 'attack')
    const card = v.cards.find((c) => c.opponent.id === 'kingambit')
    expect(card).toBeDefined()
    const rank = JSON.stringify(['rank', 'me', 'move', 'calmmind'])
    expect(new Set(card?.items.map((i) => i.key))).toEqual(
      new Set([itemKey('moonblast', BASE_CONDITION_ID), itemKey('dazzlinggleam', BASE_CONDITION_ID), itemKey('moonblast', rank), itemKey('dazzlinggleam', rank)]),
    )
    expect(card?.items.find((i) => i.key === itemKey('moonblast', rank))?.basis?.myBoosts.spa).toBe(1)
  })

  it('방어 탭 대도각참: 상대 칼춤 랭크 후 항목이 있고 내 방어 랭크업 항목은 없다, 도각참 확정견딤·+2 변동 → 기본 +2 도각참(PRD AC3·AC5)', () => {
    const v = buildTabView(cardInput({ mySet: EXAMPLE_SET, filters: only('kingambit') }), 'defense')
    const card = v.cards.find((c) => c.opponent.id === 'kingambit' && c.category === 'physical')
    expect(card).toBeDefined()
    const sd = JSON.stringify(['rank', 'opponent', 'move', 'swordsdance'])
    expect(card?.items.some((i) => i.key === itemKey('kowtowcleave', sd))).toBe(true)
    expect(card?.items.every((i) => i.basis === undefined || i.basis.owner === 'opponent')).toBe(true)
    expect(card?.defaultItem?.key).toBe(itemKey('kowtowcleave', sd))
    expect(card?.shownItem).toBe(itemKey('kowtowcleave', sd))
    expect(card?.selected).toBe(false)
    expect(card?.variable).toBe(true)
    // 보이는 항목 하나의 H 행·B 행(랭크 행·선공기 행은 따로 없다, PRD AC15)
    expect(card?.rows.map((r) => [r.moveId, r.kind, r.sweepStat])).toEqual([
      ['kowtowcleave', 'rank', 'hp'],
      ['kowtowcleave', 'rank', 'def'],
    ])
  })

  it('직접 고른 항목이 보이는 항목이 되고(selected), 기본 항목은 그대로 남는다(PRD R5)', () => {
    const chosen = itemKey('kowtowcleave', BASE_CONDITION_ID)
    const sel = new Map([[opponentKey({ source: 'ladder', id: 'kingambit' }), chosen]])
    const v = buildTabView(cardInput({ mySet: EXAMPLE_SET, filters: only('kingambit') }), 'defense', undefined, sel)
    const card = v.cards.find((c) => c.opponent.id === 'kingambit' && c.category === 'physical')
    expect(card?.shownItem).toBe(chosen)
    expect(card?.selected).toBe(true)
    expect(card?.defaultItem?.key).toBe(itemKey('kowtowcleave', JSON.stringify(['rank', 'opponent', 'move', 'swordsdance'])))
    expect(card?.rows.every((r) => r.moveId === 'kowtowcleave' && r.kind !== 'rank')).toBe(true)
  })

  it('공격 탭 내 성묘(R15): 성묘(100)·(150)·(200) + 성묘(100) 기준 +1(멀리짖음), 위력 50 항목 없음, 성묘(100)만 랭크 전', () => {
    const houndstone = mon({ species: 'houndstone', ability: 'fluffy', nature: 'adamant', sp: { hp: 32, atk: 32 }, moves: ['lastrespects', 'howl', 'bodypress', 'protect'] })
    const input = cardInput({ mySet: houndstone, filters: only('kingambit') })
    const v = buildTabView(input, 'attack')
    const card = v.cards.find((c) => c.opponent.id === 'kingambit' && c.category === 'physical')
    expect(card).toBeDefined()
    const howl = JSON.stringify(['rank', 'me', 'move', 'howl'])
    const lr = (cond: string) => itemKey('lastrespects', cond)
    const faint = (n: number) => JSON.stringify(['faint', n])
    expect(new Set(card?.items.map((i) => i.key))).toEqual(new Set([lr(faint(1)), lr(faint(2)), lr(faint(3)), lr(howl), itemKey('bodypress', BASE_CONDITION_ID)]))
    const power = (key: string) => card?.items.find((i) => i.key === key)?.power
    expect([power(lr(faint(1))), power(lr(faint(2))), power(lr(faint(3))), power(lr(howl))]).toEqual([100, 150, 200, 100])
    expect(power(itemKey('bodypress', BASE_CONDITION_ID))).toBeUndefined()
    const plan = planTab(input, 'attack')
    const spec = plan.cards.find((c) => c.id === card?.id) as CardSpec
    const refs = cardItems(plan, spec)
    expect(refs.filter((r) => r.rankBefore).map((r) => r.key).sort()).toEqual([itemKey('bodypress', BASE_CONDITION_ID), lr(faint(1))].sort())
    // 랭크 후 행은 1기절 조건
    const rankRef = refs.find((r) => r.key === lr(howl))
    expect(rankRef?.candidate.target).toBe('row')
    expect(plan.rows[rankRef?.candidate.id as string].conditions.lastRespectsFainted).toBe(1)
    expect(plan.rows[refs.find((r) => r.key === itemKey('bodypress', BASE_CONDITION_ID))?.candidate.id as string].conditions.lastRespectsFainted).toBeUndefined()
  })

  it('방어 탭 목록 밖 타겟의 성묘(R15): 세 위력 항목 + 성묘(100) 기준 +1, 위력 50 항목 없음', () => {
    const v = buildTabView(cardInput({ mySet: EXAMPLE_SET, filters: only('kingambit'), customTargets: [{ rosterId: 'houndstone', moves: ['lastrespects', 'howl'], edits: {} }] }), 'defense')
    const card = v.cards.find((c) => c.opponent.id === 'houndstone' && c.opponent.source === 'custom' && c.category === 'physical')
    expect(card).toBeDefined()
    const keys = card?.items.map((i) => i.key) ?? []
    const faintKeys = [1, 2, 3].map((n) => itemKey('lastrespects', JSON.stringify(['faint', n])))
    expect(new Set(keys)).toEqual(new Set([...faintKeys, itemKey('lastrespects', JSON.stringify(['rank', 'opponent', 'move', 'howl']))]))
    expect(keys).not.toContain(itemKey('lastrespects', BASE_CONDITION_ID))
    expect(card?.defaultItem?.key.startsWith(JSON.stringify(['lastrespects']).slice(0, -1))).toBe(true)
  })

  it('그 카드에 없는 항목 키는 무시하고 기본 항목을 보인다(다른 분류 항목 선택은 그 분류 배분에서만)', () => {
    const sel = new Map([[opponentKey({ source: 'ladder', id: 'kingambit' }), itemKey('nonexistent', BASE_CONDITION_ID)]])
    const v = buildTabView(cardInput({ mySet: EXAMPLE_SET, filters: only('kingambit') }), 'defense', undefined, sel)
    const card = v.cards.find((c) => c.opponent.id === 'kingambit' && c.category === 'physical')
    expect(card?.selected).toBe(false)
    expect(card?.shownItem).toBe(card?.defaultItem?.key)
  })
})

describe('실데이터: 채용률·주력 기술·목록 순(R16·R4-1 재개정, PRD AC38)', () => {
  const { bo1 } = realData()
  const only = (id: string) => ({ topN: 30, selected: [id] })
  const groupOf = (v: ReturnType<typeof buildTabView>, id: string) => groupCards(v.cards.filter((c) => c.opponent.id === id && c.berry === undefined), v.tab)[0]
  const shares = (id: string) => bo1.entry(id)?.moves.shares ?? {}

  it('방어 탭 메가망나뇽: 후보 채용률 = 그 상대 기술 사용률, 채용률 20% 미만 용성군·선공기 신속은 주력이 아님 — 더 센 용성군이 아니라 용의파동이 기준', () => {
    const input = cardInput({ mySet: EXAMPLE_SET, filters: only('dragonitemega') })
    const plan = planTab(input, 'defense')
    const s = shares('dragonitemega')
    expect(s.dragonpulse).toBeGreaterThanOrEqual(0.2)
    expect(s.dracometeor).toBeLessThan(0.2)
    for (const card of plan.cards.filter((c) => c.opponent.id === 'dragonitemega'))
      for (const g of card.conditions)
        for (const c of g.candidates) {
          expect(c.share, c.moveId).toBe(s[c.moveId] ?? 0)
          if (c.moveId === 'dragonpulse') expect(c.main).toBe(true)
          if (c.moveId === 'dracometeor' || c.moveId === 'extremespeed') expect(c.main, c.moveId).toBe(false)
        }
    const v = buildTabView(input, 'defense')
    const special = defaultOption(groupOf(v, 'dragonitemega'))
    expect(special.defaultItem?.key).toBe(itemKey('dragonpulse', BASE_CONDITION_ID))
    const max = (m: string) => special.items.find((i) => i.key === itemKey(m, BASE_CONDITION_ID))?.cell?.maxPercent ?? 0
    expect(max('dracometeor')).toBeGreaterThan(max('dragonpulse'))
  })

  it('예시 세트 방어 탭: 고릴타 그래스슬라이더(그래스메이커 → 선공기)는 주력 아님 → 우드해머, 메가보만다 이판사판태클(20% 미만) 주력 아님 → 모두 고정이면 채용률 1위 하이퍼보이스, 메가플라엣테는 채용률 1위 매지컬샤인이 변동이면 더 센 기술 판정 없이 매지컬샤인', () => {
    const v = buildTabView(cardInput({ mySet: EXAMPLE_SET, filters: { topN: 30, selected: [] } }), 'defense')
    const plan = planTab(cardInput({ mySet: EXAMPLE_SET, filters: { topN: 30, selected: [] } }), 'defense')
    const cand = (id: string, m: string) => plan.cards.filter((c) => c.opponent.id === id).flatMap((c) => c.conditions.flatMap((g) => g.candidates)).find((c) => c.moveId === m)
    expect(cand('rillaboom', 'grassyglide')).toMatchObject({ priority: true, main: false })
    expect(cand('rillaboom', 'woodhammer')).toMatchObject({ priority: false, main: true })
    expect(defaultOption(groupOf(v, 'rillaboom')).defaultItem?.key).toBe(itemKey('woodhammer', BASE_CONDITION_ID))
    expect(cand('salamencemega', 'doubleedge')?.main).toBe(false)
    const s = shares('salamencemega')
    expect(s.hypervoice).toBeGreaterThan(s.dracometeor)
    let allFixed = 0
    for (const c of v.cards.filter((x) => x.opponent.id === 'salamencemega' && x.category === 'special')) {
      const sAt = (m: string) => c.items.find((i) => i.key === itemKey(m, BASE_CONDITION_ID))
      if (sAt('hypervoice')?.variable !== false || sAt('dracometeor')?.variable !== false) continue
      // 더 센 용성군이 아니라 채용률 1위 하이퍼보이스
      expect(sAt('dracometeor')?.cell?.maxPercent ?? 0, c.id).toBeGreaterThan(sAt('hypervoice')?.cell?.maxPercent ?? 0)
      expect(c.defaultItem?.key, c.id).toBe(itemKey('hypervoice', BASE_CONDITION_ID))
      allFixed++
    }
    expect(allFixed).toBeGreaterThan(0)
    const f = shares('floettemega')
    expect(f.dazzlinggleam).toBeGreaterThan(f.moonblast)
    expect(f.moonblast).toBeGreaterThan(f.lightofruin)
    const floette = defaultOption(groupOf(v, 'floettemega'))
    const at = (m: string) => floette.items.find((i) => i.key === itemKey(m, BASE_CONDITION_ID))
    // 채용률 1위가 변동이면 뒤 기술 변동 판정을 하지 않는다(조기 확정)
    expect([at('lightofruin')?.variable, at('moonblast')?.variable, at('dazzlinggleam')?.variable]).toEqual([undefined, undefined, true])
    expect(floette.defaultItem?.key).toBe(itemKey('dazzlinggleam', BASE_CONDITION_ID))
  })

  it('예시 세트(한카리아스) 방어 탭 메가눈여아: 주력이 모두 고정이면 급소 확정으로 더 센 얼음숨결이 아니라 채용률 99.9% 눈보라가 기준', () => {
    const s = shares('froslassmega')
    expect(s.blizzard).toBeGreaterThan(0.99)
    expect(s.frostbreath).toBeGreaterThanOrEqual(0.2)
    const v = buildTabView(cardInput({ mySet: EXAMPLE_SET, filters: only('froslassmega') }), 'defense')
    const cards = v.cards.filter((c) => c.opponent.id === 'froslassmega' && c.category === 'special')
    expect(cards.length).toBeGreaterThan(0)
    for (const c of cards) {
      const at = (m: string) => c.items.find((i) => i.key === itemKey(m, BASE_CONDITION_ID))
      expect([at('blizzard')?.variable, at('frostbreath')?.variable], c.id).toEqual([false, false])
      expect(at('frostbreath')?.cell?.maxPercent ?? 0, c.id).toBeGreaterThan(at('blizzard')?.cell?.maxPercent ?? 0)
      expect(c.defaultItem?.key, c.id).toBe(itemKey('blizzard', BASE_CONDITION_ID))
    }
  })

  it('채용률 20% 이상이면 같은 타입이어도 각자 주력(R13 판정 타입은 표시에만): 타부자고 vs 메가리자몽Y 열풍·웨더볼, 하나만 변동이면 그것, 같이 고정·변동이면 채용률 높은 쪽', () => {
    const gholdengo = bo1.entry('gholdengo')?.representative.set as PokemonSet
    const input = cardInput({ mySet: gholdengo, filters: only('charizardmegay') })
    const plan = planTab(input, 'defense')
    const cand = (m: string) => plan.cards.flatMap((c) => c.conditions.flatMap((g) => g.candidates)).find((c) => c.moveId === m)
    expect(shares('charizardmegay').weatherball).toBeGreaterThanOrEqual(0.2)
    expect(cand('heatwave')?.main).toBe(true)
    expect(cand('weatherball')?.main).toBe(true)
    const v = buildTabView(input, 'defense')
    const g = groupOf(v, 'charizardmegay')
    expect(groupItems(g).find((x) => x.item.moveId === 'weatherball')?.item.moveType).toBe('Fire')
    const seen = new Set<string>()
    for (const c of g.options) {
      const at = (m: string) => c.items.find((i) => i.key === itemKey(m, BASE_CONDITION_ID))
      const hw = at('heatwave')?.variable
      const wb = at('weatherball')?.variable
      const higher = shares('charizardmegay').heatwave >= shares('charizardmegay').weatherball ? 'heatwave' : 'weatherball'
      const lower = higher === 'heatwave' ? 'weatherball' : 'heatwave'
      const hv = higher === 'heatwave' ? hw : wb
      const lv = higher === 'heatwave' ? wb : hw
      // 채용률 높은 쪽이 변동이면 낮은 쪽 판정과 무관, 높은 쪽 고정·낮은 쪽 변동이면 낮은 쪽, 둘 다 고정이면 높은 쪽
      const expected = hv === true ? higher : hv === false && lv === true ? lower : hv === false && lv === false ? higher : undefined
      if (expected === undefined) continue
      expect(c.defaultItem?.key, c.id).toBe(itemKey(expected, BASE_CONDITION_ID))
      seen.add(expected)
    }
    expect(seen.size).toBeGreaterThan(0)
  })

  it('공격 탭은 채용률을 쓰지 않는다(share 0 → 내 기술 칸 순서, 사용자 결정 2026-11-14), 메뉴 목록은 기술 채용률 순 · 같은 기술 안 강한 순 · 계산 불가/무효 맨 뒤', () => {
    const mega = bo1.entry('floettemega')?.representative.set as PokemonSet
    const plan = planTab(cardInput({ mySet: mega, filters: only('kingambit') }), 'attack')
    const cands = plan.cards.flatMap((c) => c.conditions.flatMap((g) => g.candidates))
    expect(cands.length).toBeGreaterThan(0)
    for (const c of cands) expect(c.share, c.moveId).toBe(0)
    const v = buildTabView(cardInput({ mySet: EXAMPLE_SET, filters: { topN: 30, selected: [] } }), 'defense')
    let checked = 0
    for (const g of groupCards(v.cards, 'defense')) {
      const items = groupItems(g).map((x) => x.item)
      const tail = (st: string) => (st === 'error' ? 1 : st === 'immune' ? 2 : 0)
      for (let i = 1; i < items.length; i++) {
        const [a, b] = [items[i - 1], items[i]]
        expect(tail(a.status) <= tail(b.status), g.key).toBe(true)
        if (tail(a.status) !== tail(b.status) || tail(a.status) !== 0) continue
        if (a.moveId !== b.moveId) expect(a.share >= b.share, `${g.key} ${a.key} ${b.key}`).toBe(true)
        else if (a.status === 'ok' && b.status === 'ok') {
          const pa = a.cell?.ohkoChance ?? 0
          const pb = b.cell?.ohkoChance ?? 0
          expect(pa > pb || (pa === pb && (a.cell?.maxPercent ?? 0) >= (b.cell?.maxPercent ?? 0)), `${g.key} ${a.key} ${b.key}`).toBe(true)
        }
        checked++
      }
      // 같은 기술 항목은 이어진다
      const seen: string[] = []
      for (const it of items.filter((x) => tail(x.status) === 0)) if (seen[seen.length - 1] !== it.moveId) {
        expect(seen, g.key).not.toContain(it.moveId)
        seen.push(it.moveId)
      }
    }
    expect(checked).toBeGreaterThan(30)
  })

  it('정상 대표가 없는 분류 카드(대체)는 대표로 정해진 분류 카드에 진다(분류 사이 비교)', () => {
    const special = { defaultItem: { key: 's', viaPriority: false, fallback: true as const, basisCell: cell(1, 200) } }
    const physical = { defaultItem: { key: 'p', viaPriority: false, basisCell: cell(0, 30) } }
    const mk = (category: 'physical' | 'special', d: object, order: number) =>
      ({ id: category, order, category, opponent: { id: 'x', source: 'ladder' }, bundle: { key: category, stats: [], share: 1, minority: false }, items: [], ...d }) as unknown as CardView
    const g = groupCards([mk('special', special, 0), mk('physical', physical, 1)])[0]
    expect(defaultOption(g).id).toBe('physical')
  })
})

describe('기술 선택 메뉴 항목의 변동 판정(PRD R3 변동 배지, AC36)', () => {
  const only = (id: string) => ({ topN: 30, selected: [id] })
  /** 실행기 수요 없이(기본 항목 결정 집합만) 끝까지 계산한 계획·결과 */
  function settled(input: CardInput, tab: Tab) {
    const plan = planTab(input, tab)
    const results = new Map<string, RowTaskResult>()
    for (;;) {
      const stage = nextStage(pendingTasks(plan, results))
      if (stage.length === 0) return { plan, results }
      for (const t of stage) results.set(taskKey(t), computeRowTask(plan, t))
    }
  }
  /** 연 카드의 메뉴 작업을 끝까지 계산한다(그 카드 작업만, 반환 = 계산한 작업 수) */
  function explore(plan: TabPlan, results: Map<string, RowTaskResult>, cardId: string): number {
    const card = plan.cards.find((c) => c.id === cardId) as CardSpec
    let n = 0
    for (;;) {
      const stage = nextStage(cardExplore(plan, card, results))
      if (stage.length === 0) return n
      for (const t of stage) {
        expect(taskCardId(plan, t)).toBe(cardId)
        results.set(taskKey(t), computeRowTask(plan, t))
        n++
      }
    }
  }
  const withoutVariable = (c: CardView) =>
    ({
      ...c,
      items: c.items.map((i) => {
        const rest = { ...i }
        delete rest.variable
        return rest
      }),
    })

  it('방어 탭 대도각참: 기본 결정만으로는 변동 판정이 없는 항목이 있고, 메뉴 작업을 돌리면 그 카드 모든 정상 항목이 변동/고정으로 정해진다(보이는 항목·기본 항목·행은 그대로)', () => {
    const { plan, results } = settled(cardInput({ mySet: EXAMPLE_SET, filters: only('kingambit') }), 'defense')
    const before = assembleTab(plan, results)
    const card = before.cards.find((c) => c.opponent.id === 'kingambit' && c.category === 'physical' && c.berry === undefined) as CardView
    expect(card).toBeDefined()
    expect(card.items.some((i) => i.status === 'ok' && i.variable === undefined)).toBe(true)
    // 이미 정해진 보이는 항목은 카드 "변동 가능"과 같다
    expect(card.items.find((i) => i.key === card.shownItem)?.variable).toBe(card.variable)
    const others = before.cards.filter((c) => c.id !== card.id)

    expect(explore(plan, results, card.id)).toBeGreaterThan(0)
    const after = assembleTab(plan, results)
    const opened = after.cards.find((c) => c.id === card.id) as CardView
    for (const i of opened.items) {
      if (i.status === 'ok' || i.status === 'immune') expect(typeof i.variable, i.key).toBe('boolean')
      else expect(i.variable, i.key).toBeUndefined()
    }
    expect(opened.items.filter((i) => i.variable === true).length).toBeGreaterThan(0)
    expect(opened.items.filter((i) => i.variable === false).length).toBeGreaterThan(0)
    expect(withoutVariable(opened)).toEqual(withoutVariable(card))
    // 메뉴를 열지 않은 카드는 그대로다
    expect(after.cards.filter((c) => c.id !== card.id)).toEqual(others)
    // 다 계산한 뒤에는 남은 메뉴 작업이 없고, 기본 남은 작업(pendingTasks)도 새로 생기지 않는다
    expect(nextStage(cardExplore(plan, plan.cards.find((c) => c.id === card.id) as CardSpec, results))).toEqual([])
    expect(nextStage(pendingTasks(plan, results))).toEqual([])
  })

  it('후보 없는 카드(스피드 탭)는 메뉴 작업이 없다', () => {
    const plan = planTab(cardInput({ mySet: EXAMPLE_SET, filters: only('kingambit') }), 'speed')
    expect(plan.cards.length).toBeGreaterThan(0)
    for (const c of plan.cards) expect(cardExplore(plan, c, new Map())).toEqual({ stage1: [], stage2: [], stage3: [], stage4: [], stage5: [] })
  })
})
