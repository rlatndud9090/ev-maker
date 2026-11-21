import { describe, expect, it } from 'vitest'
import type { PokemonSet } from '../core'
import type { MetaEntry } from '../data/meta-schema'
import type { StatId } from '../data/schema'
import type { MetaView } from '../meta'
import {
  additionTargetOf,
  damageAdditionQuery,
  judgeDamageAddition,
  judgeSpeedAddition,
  observedState,
  speedAdditionQuery,
  targetStatus,
  type AdditionTarget,
  type DamageCategoryQuery,
} from './addition'
import { addedBundleCardId, addedBundleKey, presetKey } from './ids'
import { opponentSeeds, planTab } from './plan'
import { buildSpeedChart, customSpeedOpponent, ladderSpeedOpponent, speedKey, type SpeedChartInput } from './speedChart'
import { cardInput, realData, syntheticEntry, syntheticView } from './testing'
import { DEFAULT_CRITERIA, type AddedBundle, type CardInput, type CustomTarget, type SpeedAddedBundle } from './types'

const { game, bo1 } = realData()
const SP_MAX = game.manifest.rules.spMaxPerStat
const ZERO = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }
const mk = (moves: string[]): PokemonSet => ({ regulation: 'm-c', species: 'garchomp', ability: 'roughskin', nature: 'jolly', sp: { ...ZERO, hp: 2, atk: 32, spe: 32 }, moves })
/** 물리 2·특수 1·변화기 1 */
const GARCHOMP = mk(['earthquake', 'dragonclaw', 'swordsdance', 'flamethrower'])

const entryOf = (id: string): MetaEntry => {
  const e = bo1.entry(id)
  if (e === undefined) throw new Error(`no entry ${id}`)
  return e
}
const spreads = (kept: [string, number][]): MetaEntry['spreads'] => ({ kept, keptShare: kept.reduce((a, [, s]) => a + s, 0), excludedShare: 0 })
const viewWith = (...entries: MetaEntry[]): MetaView => syntheticView(game, bo1.meta, entries)
const ROTOM: CustomTarget = { rosterId: 'rotomwash', moves: ['hydropump', 'thief'], edits: { [presetKey('speed', null, 1)]: { sp: { spe: 5 } } } }

const speedInput = (partial: Partial<SpeedChartInput> = {}): SpeedChartInput => ({
  game,
  view: bo1,
  myAbility: 'roughskin',
  criteria: { ...DEFAULT_CRITERIA },
  filters: { topN: 30, selected: [] },
  customTargets: [],
  added: [],
  ...partial,
})

/** 한카리아스 S 묶음: S32↑ 50%, S20 30%, S0 2%(기준 미달) */
const SPEED_CHOMP = syntheticEntry(entryOf('garchomp'), {
  spreads: spreads([
    ['jolly:2/32/0/0/0/32', 0.5],
    ['adamant:2/32/0/0/0/20', 0.3],
    ['adamant:2/32/0/0/0/0', 0.02],
  ]),
})
/** 한카리아스 H·B 묶음: impish H32 B32↑ 50%, jolly H2 B0 30%, careful H20 B4 2%(기준 미달) */
const DAMAGE_CHOMP = syntheticEntry(entryOf('garchomp'), {
  spreads: spreads([
    ['impish:32/0/32/0/2/0', 0.5],
    ['jolly:2/32/0/0/0/32', 0.3],
    ['careful:20/0/4/0/0/0', 0.02],
  ]),
})

describe('targetStatus·additionTargetOf', () => {
  it('범위 안 메타·범위 밖 메타·목록 밖 추가됨·새 포켓몬', () => {
    const filters = { topN: 3, selected: [] }
    const inRange = bo1.ranking[0].id
    const outOfRange = bo1.ranking[10].id
    expect(targetStatus(bo1, filters, [ROTOM], inRange)).toBe('meta')
    expect(targetStatus(bo1, filters, [ROTOM], outOfRange)).toBe('out-of-range')
    expect(targetStatus(bo1, filters, [ROTOM], 'rotomwash')).toBe('added')
    expect(targetStatus(bo1, filters, [], 'rotomwash')).toBe('new')
    expect(targetStatus(bo1, { topN: 3, selected: [outOfRange] }, [], outOfRange)).toBe('meta')
    expect(targetStatus(bo1, { topN: 3, selected: [outOfRange] }, [], inRange)).toBe('out-of-range')
  })

  it('메타 항목이면 래더, 아니면 목록 밖', () => {
    expect(additionTargetOf(bo1, bo1.ranking[0].id)).toEqual({ source: 'ladder', id: bo1.ranking[0].id })
    expect(additionTargetOf(bo1, 'rotomwash')).toEqual({ source: 'custom', id: 'rotomwash' })
  })
})

describe('스피드 판정', () => {
  const view = viewWith(SPEED_CHOMP)
  const inp = (partial: Partial<SpeedChartInput> = {}) => speedInput({ view, filters: { topN: 30, selected: ['garchomp'] }, ...partial })
  const target: AdditionTarget = { source: 'ladder', id: 'garchomp' }

  it('AC8: 범위 안 SP 배분 기준 이상 묶음(1위·2위 기본 배지)은 duplicate, 기준 미만 묶음과 관측에 없는 배분은 ok', () => {
    const q = speedAdditionQuery(inp(), DEFAULT_CRITERIA.bundleShareMin, target)
    if (q.kind !== 'ok') throw new Error(q.kind)
    expect(q.defaultValue).toEqual({ sp: 32, nature: 'plus' })
    expect(judgeSpeedAddition(q, 32, 'plus', SP_MAX)).toEqual({ kind: 'duplicate' })
    expect(judgeSpeedAddition(q, 20, 'neutral', SP_MAX)).toEqual({ kind: 'duplicate' })
    expect(judgeSpeedAddition(q, 0, 'neutral', SP_MAX)).toEqual({ kind: 'ok' })
    expect(judgeSpeedAddition(q, 32, 'neutral', SP_MAX)).toEqual({ kind: 'ok' })
    // 기준을 올려 2위가 기본 배지에서 빠지면 다시 추가할 수 있다
    const high = speedAdditionQuery(inp(), 0.4, target)
    if (high.kind !== 'ok') throw new Error(high.kind)
    expect(judgeSpeedAddition(high, 20, 'neutral', SP_MAX)).toEqual({ kind: 'ok' })
  })

  it('조건 배지는 비교 대상이 아니다: shownKeys = 기본 배지 키뿐', () => {
    const r = ladderSpeedOpponent(inp(), view.ranking[0])
    if (r.kind !== 'ok') throw new Error(r.kind)
    expect(r.conditions.length).toBeGreaterThan(0)
    const q = speedAdditionQuery(inp(), DEFAULT_CRITERIA.bundleShareMin, target)
    if (q.kind !== 'ok') throw new Error(q.kind)
    expect([...q.shownKeys]).toEqual([speedKey(32, 'plus'), speedKey(20, 'neutral')])
    const base = r.bases[0]
    for (const c of r.conditions) expect(c.speed).not.toBe(base.speed)
  })

  it('관측 줄: 점유율 기준 이상만 점유율 내림차순, 표시 중이면 shown 아니면 addable', () => {
    const q = speedAdditionQuery(inp(), DEFAULT_CRITERIA.bundleShareMin, target)
    if (q.kind !== 'ok') throw new Error(q.kind)
    expect(q.observed.map((o) => [o.sp, o.nature, o.share, o.state])).toEqual([
      [32, 'plus', 0.5, 'shown'],
      [20, 'neutral', 0.3, 'shown'],
    ])
    const high = speedAdditionQuery(inp(), 0.9, target)
    if (high.kind !== 'ok') throw new Error(high.kind)
    expect(high.observed).toEqual([])
    expect(high.shownKeys.has(speedKey(32, 'plus'))).toBe(true)
  })

  it('계산 중 합집합: input.added에 방금 넣은 배분은 shownKeys에 있다', () => {
    const added: SpeedAddedBundle[] = [{ source: 'ladder', opponentId: 'garchomp', sp: 20, nature: 'neutral' }]
    const q = speedAdditionQuery(inp({ added }), DEFAULT_CRITERIA.bundleShareMin, target)
    if (q.kind !== 'ok') throw new Error(q.kind)
    expect(judgeSpeedAddition(q, 20, 'neutral', SP_MAX)).toEqual({ kind: 'duplicate' })
    expect(q.observed.find((o) => o.sp === 20)?.state).toBe('shown')
  })

  it('기준 미만 묶음은 judge ok이고, 그대로 추가하면 차트에 점유율 있는 추가 배지가 생겨 duplicate가 된다', () => {
    const q = speedAdditionQuery(inp(), DEFAULT_CRITERIA.bundleShareMin, target)
    if (q.kind !== 'ok') throw new Error(q.kind)
    expect(judgeSpeedAddition(q, 0, 'neutral', SP_MAX)).toEqual({ kind: 'ok' })
    const added: SpeedAddedBundle[] = [{ source: 'ladder', opponentId: 'garchomp', sp: 0, nature: 'neutral' }]
    const chart = buildSpeedChart(inp({ added }))
    const badge = chart.badges.find((b) => b.origin === 'added' && b.opponentId === 'garchomp')
    expect(badge?.bundle).toEqual({ sp: 0, nature: 'neutral', share: 0.02 })
    const after = speedAdditionQuery(inp({ added }), DEFAULT_CRITERIA.bundleShareMin, target)
    if (after.kind !== 'ok') throw new Error(after.kind)
    expect(judgeSpeedAddition(after, 0, 'neutral', SP_MAX)).toEqual({ kind: 'duplicate' })
  })

  it('범위 밖이면 1위 값도 ok(shownKeys 빈 집합)이고, 그대로 추가하면 추가 배지만 생겨 duplicate가 된다', () => {
    const out = (partial: Partial<SpeedChartInput> = {}) =>
      speedInput({ view: viewWith(SPEED_CHOMP, entryOf('incineroar')), filters: { topN: 30, selected: ['incineroar'] }, ...partial })
    const q = speedAdditionQuery(out(), DEFAULT_CRITERIA.bundleShareMin, target)
    if (q.kind !== 'ok') throw new Error(q.kind)
    expect([...q.shownKeys]).toEqual([])
    expect(q.defaultValue).toEqual({ sp: 32, nature: 'plus' })
    expect(q.observed.map((o) => o.state)).toEqual(['addable', 'addable'])
    expect(judgeSpeedAddition(q, 32, 'plus', SP_MAX)).toEqual({ kind: 'ok' })
    const added: SpeedAddedBundle[] = [{ source: 'ladder', opponentId: 'garchomp', sp: 32, nature: 'plus' }]
    const chart = buildSpeedChart(out({ added }))
    expect(chart.badges.filter((b) => b.opponentId === 'garchomp').map((b) => [b.origin, b.condition.kind, b.bundle.sp, b.bundle.nature])).toEqual([['added', 'none', 32, 'plus']])
    const after = speedAdditionQuery(out({ added }), DEFAULT_CRITERIA.bundleShareMin, target)
    if (after.kind !== 'ok') throw new Error(after.kind)
    expect([...after.shownKeys]).toEqual([speedKey(32, 'plus')])
    expect(judgeSpeedAddition(after, 32, 'plus', SP_MAX)).toEqual({ kind: 'duplicate' })
  })

  it('목록 밖 추가 배분은 shownKeys에 들어 다시 넣으면 duplicate다', () => {
    const added: SpeedAddedBundle[] = [{ source: 'custom', opponentId: 'rotomwash', sp: 9, nature: 'minus' }]
    const q = speedAdditionQuery(speedInput({ customTargets: [ROTOM], added }), DEFAULT_CRITERIA.bundleShareMin, { source: 'custom', id: 'rotomwash' })
    if (q.kind !== 'ok') throw new Error(q.kind)
    expect(judgeSpeedAddition(q, 9, 'minus', SP_MAX)).toEqual({ kind: 'duplicate' })
    expect(judgeSpeedAddition(q, 9, 'plus', SP_MAX)).toEqual({ kind: 'ok' })
  })

  it('목록 밖: 프리셋과 같은 (SP, 부호)는 duplicate, observed는 비고 기본값은 프리셋 1', () => {
    const i = speedInput({ customTargets: [ROTOM] })
    const q = speedAdditionQuery(i, DEFAULT_CRITERIA.bundleShareMin, { source: 'custom', id: 'rotomwash' })
    if (q.kind !== 'ok') throw new Error(q.kind)
    const presets = customSpeedOpponent(i, ROTOM, 0).badges.filter((b) => b.condition.kind === 'none')
    expect(presets).toHaveLength(3)
    for (const b of presets) expect(judgeSpeedAddition(q, b.bundle.sp, b.bundle.nature, SP_MAX)).toEqual({ kind: 'duplicate' })
    expect(presets[1].bundle.sp).toBe(5)
    expect(q.observed).toEqual([])
    expect(q.defaultValue).toEqual({ sp: presets[0].bundle.sp, nature: presets[0].bundle.nature })
  })

  it('SP 33·-1·1.5·NaN은 invalid(중복보다 먼저)', () => {
    const q = speedAdditionQuery(inp(), DEFAULT_CRITERIA.bundleShareMin, target)
    for (const sp of [SP_MAX + 1, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) expect(judgeSpeedAddition(q, sp, 'plus', SP_MAX), String(sp)).toEqual({ kind: 'invalid' })
    expect(judgeSpeedAddition(q, 0, 'minus', SP_MAX)).toEqual({ kind: 'ok' })
    expect(judgeSpeedAddition(q, SP_MAX, 'neutral', SP_MAX)).toEqual({ kind: 'ok' })
  })

  it('더할 배분 없음: 대상 없음·스피드 계산 불가는 invalid보다 먼저', () => {
    const none = speedAdditionQuery(inp(), DEFAULT_CRITERIA.bundleShareMin, { source: 'ladder', id: 'nosuchmon' })
    expect(none).toEqual({ kind: 'unavailable', reason: 'not-found' })
    expect(judgeSpeedAddition(none, -1, 'plus', SP_MAX)).toEqual({ kind: 'unavailable', reason: 'not-found' })
    expect(speedAdditionQuery(speedInput(), DEFAULT_CRITERIA.bundleShareMin, { source: 'custom', id: 'rotomwash' })).toEqual({ kind: 'unavailable', reason: 'not-found' })
    const claw = syntheticEntry(SPEED_CHOMP, {
      representative: { ...SPEED_CHOMP.representative, set: { ...SPEED_CHOMP.representative.set, item: 'quickclaw' } },
      items: { shares: { quickclaw: 1 }, keptShare: 1, excludedShare: 0 },
    })
    const rejected = speedAdditionQuery(speedInput({ view: viewWith(claw) }), DEFAULT_CRITERIA.bundleShareMin, target)
    expect(rejected).toEqual({ kind: 'unavailable', reason: 'speed-unsupported' })
    const clawTarget: CustomTarget = { ...ROTOM, edits: { [presetKey('speed', null, 0)]: { item: 'quickclaw' } } }
    expect(speedAdditionQuery(speedInput({ customTargets: [clawTarget] }), DEFAULT_CRITERIA.bundleShareMin, { source: 'custom', id: 'rotomwash' })).toEqual({
      kind: 'unavailable',
      reason: 'speed-unsupported',
    })
  })
})

describe('공·방 판정', () => {
  const view = viewWith(DAMAGE_CHOMP)
  const inp = (partial: Partial<CardInput> = {}): CardInput => ({ ...cardInput({ mySet: GARCHOMP, filters: { topN: 30, selected: ['garchomp'] } }), view, ...partial })
  const target: AdditionTarget = { source: 'ladder', id: 'garchomp' }
  const physicalOf = (i: CardInput): DamageCategoryQuery => {
    const q = damageAdditionQuery(i, 'attack', target)
    if (q.kind !== 'ok') throw new Error(q.kind)
    const c = q.categories.find((x) => x.category === 'physical')
    if (c === undefined) throw new Error('no physical')
    return c
  }

  it('분류·키 능력치·기본 SP는 opponentSeeds와 같다', () => {
    const q = damageAdditionQuery(inp(), 'attack', target)
    const seeds = opponentSeeds(inp(), 'attack', target)
    if (q.kind !== 'ok' || seeds.kind !== 'ok') throw new Error('not ok')
    expect(q.categories.map((c) => [c.category, c.keyStats])).toEqual(seeds.categories.map((c) => [c.category, c.keyStats]))
    const physical = physicalOf(inp())
    expect(physical.keyStats).toEqual(['hp', 'def'])
    expect(physical.defaultSp).toEqual({ hp: 32, def: 32 })
  })

  it('무보정 관측과 같은 SP는 duplicate', () => {
    expect(judgeDamageAddition(physicalOf(inp()), { hp: 2, def: 0 }, SP_MAX)).toEqual({ kind: 'duplicate' })
  })

  it('보정 관측만 있는 SP는 ok(같은 SP라도 부호가 다르면 다른 배분), 같은 SP·부호면 duplicate', () => {
    const c = physicalOf(inp())
    expect(judgeDamageAddition(c, { hp: 32, def: 32 }, SP_MAX)).toEqual({ kind: 'ok' })
    expect(judgeDamageAddition(c, { hp: 32, def: 32 }, SP_MAX, { def: 'minus' })).toEqual({ kind: 'ok' })
    expect(judgeDamageAddition(c, { hp: 32, def: 32 }, SP_MAX, { def: 'plus' })).toEqual({ kind: 'duplicate' })
    expect(judgeDamageAddition(c, { hp: 32, def: 32 }, SP_MAX, { hp: 'neutral', def: 'plus' })).toEqual({ kind: 'duplicate' })
    expect(judgeDamageAddition(c, { hp: 2, def: 0 }, SP_MAX, { def: 'plus' })).toEqual({ kind: 'ok' })
  })

  it('부호 규칙 위반은 invalid: H에 부호, 키 능력치 밖 부호, 알 수 없는 값', () => {
    const c = physicalOf(inp())
    expect(judgeDamageAddition(c, { hp: 20, def: 4 }, SP_MAX, { hp: 'plus' })).toEqual({ kind: 'invalid' })
    expect(judgeDamageAddition(c, { hp: 20, def: 4 }, SP_MAX, { hp: 'minus', def: 'plus' })).toEqual({ kind: 'invalid' })
    expect(judgeDamageAddition(c, { hp: 20, def: 4 }, SP_MAX, { spd: 'plus' })).toEqual({ kind: 'invalid' })
    expect(judgeDamageAddition(c, { hp: 20, def: 4 }, SP_MAX, JSON.parse('{"def":"up"}'))).toEqual({ kind: 'invalid' })
  })

  it('보정 붙은 관측 줄을 그 부호 그대로 추가하면 사용자 카드가 그 키로 생기고 다시 질의하면 duplicate', () => {
    const out = (partial: Partial<CardInput> = {}): CardInput => ({
      ...cardInput({ mySet: GARCHOMP, filters: { topN: 30, selected: ['incineroar'] } }),
      view: viewWith(DAMAGE_CHOMP, entryOf('incineroar')),
      ...partial,
    })
    const c = physicalOf(out())
    const row = c.observed.find((o) => o.stats.some((s) => s.nature !== 'neutral'))
    if (row === undefined) throw new Error('no boosted row')
    expect(row.state).toBe('addable')
    const sp = Object.fromEntries(row.stats.map((s) => [s.stat, s.sp]))
    const nature = Object.fromEntries(row.stats.map((s) => [s.stat, s.nature]))
    expect(judgeDamageAddition(c, sp, SP_MAX, nature)).toEqual({ kind: 'ok' })
    const added: AddedBundle = { tab: 'attack', source: 'ladder', opponentId: 'garchomp', category: 'physical', sp, nature: { def: 'plus' } }
    const cards = planTab(out({ addedBundles: [added] }), 'attack').cards.filter((x) => x.opponent.id === 'garchomp')
    expect(cards.map((x) => [x.bundle.key, x.bundle.userAdded])).toEqual([[JSON.stringify(row.stats), 0]])
    expect(cards[0].id).toBe(addedBundleCardId(added, row.stats))
    expect(judgeDamageAddition(physicalOf(out({ addedBundles: [added] })), sp, SP_MAX, nature)).toEqual({ kind: 'duplicate' })
    expect(judgeDamageAddition(physicalOf(out({ addedBundles: [added] })), sp, SP_MAX)).toEqual({ kind: 'ok' })
  })

  it('기준 미달 관측은 ok(bundleShareMin을 올리면 30% 묶음도 ok)', () => {
    expect(judgeDamageAddition(physicalOf(inp()), { hp: 20, def: 4 }, SP_MAX)).toEqual({ kind: 'ok' })
    const raised = physicalOf(inp({ criteria: { ...DEFAULT_CRITERIA, bundleShareMin: 0.4 } }))
    expect(judgeDamageAddition(raised, { hp: 2, def: 0 }, SP_MAX)).toEqual({ kind: 'ok' })
  })

  it('관측 줄: 범위 안 보정 관측 줄은 표시 중이라 shown', () => {
    const c = physicalOf(inp())
    expect(c.observed.map((o) => [o.stats.map((s) => [s.stat, s.sp, s.nature]), o.share, o.state])).toEqual([
      [
        [
          ['hp', 32, 'neutral'],
          ['def', 32, 'plus'],
        ],
        0.5,
        'shown',
      ],
      [
        [
          ['hp', 2, 'neutral'],
          ['def', 0, 'neutral'],
        ],
        0.3,
        'shown',
      ],
    ])
  })

  it('기준 이상이 없으면 observed는 비고 shownKeys에는 minority 키가 있다', () => {
    const c = physicalOf(inp({ criteria: { ...DEFAULT_CRITERIA, bundleShareMin: 0.9 } }))
    expect(c.observed).toEqual([])
    expect(c.shownKeys.has(JSON.stringify([{ stat: 'hp', sp: 32, nature: 'neutral' }, { stat: 'def', sp: 32, nature: 'plus' }]))).toBe(true)
  })

  it('judge ok인 값은 AddedBundle로 넣어 planTab을 돌리면 그 분류에 사용자 카드가 생기고 다시 질의하면 duplicate', () => {
    const sp = { hp: 20, def: 4 }
    expect(judgeDamageAddition(physicalOf(inp()), sp, SP_MAX)).toEqual({ kind: 'ok' })
    const added: AddedBundle = { tab: 'attack', source: 'ladder', opponentId: 'garchomp', category: 'physical', sp }
    const key = addedBundleKey([{ stat: 'hp', sp: 20 }, { stat: 'def', sp: 4 }])
    const cards = planTab(inp({ addedBundles: [added] }), 'attack').cards.filter((c) => c.opponent.source === 'ladder' && c.opponent.id === 'garchomp' && c.category === 'physical')
    expect(cards.filter((c) => c.bundle.userAdded === 0).map((c) => c.bundle.key)).toContain(key)
    expect(judgeDamageAddition(physicalOf(inp({ addedBundles: [added] })), sp, SP_MAX)).toEqual({ kind: 'duplicate' })
  })

  it('범위 밖이면 무보정 관측과 같은 SP도 ok이고, 추가하면 사용자 카드만 생겨 duplicate가 된다', () => {
    const out = (partial: Partial<CardInput> = {}): CardInput => ({
      ...cardInput({ mySet: GARCHOMP, filters: { topN: 30, selected: ['incineroar'] } }),
      view: viewWith(DAMAGE_CHOMP, entryOf('incineroar')),
      ...partial,
    })
    const c = physicalOf(out())
    expect(c.shownKeys.size).toBe(0)
    expect(c.defaultSp).toEqual({ hp: 32, def: 32 })
    expect(c.observed.map((o) => o.state)).toEqual(['addable', 'addable'])
    expect(judgeDamageAddition(c, { hp: 2, def: 0 }, SP_MAX)).toEqual({ kind: 'ok' })
    const added: AddedBundle = { tab: 'attack', source: 'ladder', opponentId: 'garchomp', category: 'physical', sp: { hp: 2, def: 0 } }
    const cards = planTab(out({ addedBundles: [added] }), 'attack').cards.filter((x) => x.opponent.id === 'garchomp')
    expect(cards.map((x) => [x.category, x.bundle.key, x.bundle.userAdded, x.opponent.addedOnly])).toEqual([['physical', addedBundleKey([{ stat: 'hp', sp: 2 }, { stat: 'def', sp: 0 }]), 0, true]])
    expect(judgeDamageAddition(physicalOf(out({ addedBundles: [added] })), { hp: 2, def: 0 }, SP_MAX)).toEqual({ kind: 'duplicate' })
  })

  it('observedState: 표시 중이면 shown, 아니면 보정이 붙어도 addable', () => {
    expect(observedState({ key: 'b' }, new Set(['b']))).toBe('shown')
    expect(observedState({ key: 'b' }, new Set())).toBe('addable')
  })

  it('목록 밖: 무보정 프리셋과 같으면 duplicate, observed는 빈 배열', () => {
    const i = cardInput({ mySet: GARCHOMP, customTargets: [ROTOM] })
    const q = damageAdditionQuery(i, 'attack', { source: 'custom', id: 'rotomwash' })
    const seeds = opponentSeeds(i, 'attack', { source: 'custom', id: 'rotomwash' })
    if (q.kind !== 'ok' || seeds.kind !== 'ok') throw new Error('not ok')
    let checked = 0
    for (const c of q.categories) {
      expect(c.observed).toEqual([])
      const presets = seeds.categories.find((s) => s.category === c.category)?.observed ?? []
      for (const p of presets.filter((b) => b.stats.every((s) => s.nature === 'neutral'))) {
        expect(judgeDamageAddition(c, Object.fromEntries(p.stats.map((s) => [s.stat, s.sp])), SP_MAX)).toEqual({ kind: 'duplicate' })
        checked += 1
      }
    }
    expect(checked).toBeGreaterThan(0)
  })

  it('계산 중 합집합: input.addedBundles에 방금 넣은 배분은 planTab 없이 shownKeys에 있다', () => {
    const added: AddedBundle = { tab: 'attack', source: 'ladder', opponentId: 'garchomp', category: 'physical', sp: { hp: 32, def: 32 } }
    const c = physicalOf(inp({ addedBundles: [added] }))
    expect(c.shownKeys.has(addedBundleKey([{ stat: 'hp', sp: 32 }, { stat: 'def', sp: 32 }]))).toBe(true)
    expect(judgeDamageAddition(c, { hp: 32, def: 32 }, SP_MAX)).toEqual({ kind: 'duplicate' })
  })

  it('잘못된 값: 키 누락·초과·범위 밖·소수·NaN은 invalid(중복보다 먼저)', () => {
    const c = physicalOf(inp())
    expect(judgeDamageAddition(c, { hp: 2 }, SP_MAX)).toEqual({ kind: 'invalid' })
    expect(judgeDamageAddition(c, { hp: 2, def: 0, spd: 0 }, SP_MAX)).toEqual({ kind: 'invalid' })
    expect(judgeDamageAddition(c, { hp: 2, spd: 0 }, SP_MAX)).toEqual({ kind: 'invalid' })
    expect(judgeDamageAddition(c, { hp: 2, def: undefined }, SP_MAX)).toEqual({ kind: 'invalid' })
    for (const v of [SP_MAX + 1, -1, 1.5, Number.NaN]) expect(judgeDamageAddition(c, { hp: 2, def: v }, SP_MAX), String(v)).toEqual({ kind: 'invalid' })
    expect(judgeDamageAddition(c, { def: 0, hp: SP_MAX }, SP_MAX)).toEqual({ kind: 'ok' })
  })

  it('더할 배분 없음: 내 공격기 없음·상대 공격기 없음·키 능력치 없음·내 세트 오류·대상 없음', () => {
    expect(damageAdditionQuery(inp({ mySet: mk(['swordsdance', 'protect']) }), 'attack', target)).toEqual({ kind: 'unavailable', reason: 'no-my-attack-moves' })
    const status: CustomTarget = { rosterId: 'rotomwash', moves: ['protect'], edits: {} }
    expect(damageAdditionQuery(cardInput({ mySet: GARCHOMP, customTargets: [status] }), 'defense', { source: 'custom', id: 'rotomwash' })).toEqual({
      kind: 'unavailable',
      reason: 'no-opponent-moves',
    })
    const foul: CustomTarget = { rosterId: 'rotomwash', moves: ['foulplay'], edits: {} }
    expect(damageAdditionQuery(cardInput({ mySet: GARCHOMP, customTargets: [foul] }), 'defense', { source: 'custom', id: 'rotomwash' })).toEqual({
      kind: 'unavailable',
      reason: 'no-key-stats',
    })
    expect(damageAdditionQuery(inp({ mySet: { ...GARCHOMP, species: 'nosuchmon' } }), 'attack', target)).toEqual({ kind: 'unavailable', reason: 'my-set-error' })
    expect(damageAdditionQuery(inp(), 'attack', { source: 'ladder', id: 'nosuchmon' })).toEqual({ kind: 'unavailable', reason: 'not-found' })
  })
})

describe('방어 탭 키 능력치 순서', () => {
  // 기술 순서상 특공(10만볼트)이 HP(목숨걸기)보다 먼저 나와도 키 능력치는 STAT_IDS 순이다
  const gambit: CustomTarget = { rosterId: 'rotomwash', moves: ['thunderbolt', 'finalgambit'], edits: {} }
  const target: AdditionTarget = { source: 'custom', id: 'rotomwash' }

  it('패널 경로(질의 keyStats 순 stats)로 만든 카드 id가 계획 카드 id와 같다', () => {
    const q = damageAdditionQuery(cardInput({ mySet: GARCHOMP, customTargets: [gambit] }), 'defense', target)
    if (q.kind !== 'ok') throw new Error(q.reason)
    const c = q.categories.find((x) => x.category === 'special')
    if (c === undefined) throw new Error('no special category')
    expect(c.keyStats).toEqual(['hp', 'spa'])
    const sp: Partial<Record<StatId, number>> = { hp: 7, spa: 9 }
    expect(judgeDamageAddition(c, sp, SP_MAX)).toEqual({ kind: 'ok' })
    const added: AddedBundle = { tab: 'defense', source: 'custom', opponentId: 'rotomwash', category: 'special', sp }
    const panelId = addedBundleCardId(added, c.keyStats.map((stat) => ({ stat, sp: sp[stat] ?? NaN })))
    const plan = planTab(cardInput({ mySet: GARCHOMP, customTargets: [gambit], addedBundles: [added] }), 'defense')
    const user = plan.cards.filter((x) => x.bundle.userAdded !== undefined && x.berry === undefined)
    expect(user.map((x) => x.id)).toEqual([panelId])
  })

  it('addedBundleKey는 입력 stats 순서와 무관하다', () => {
    expect(addedBundleKey([{ stat: 'spa', sp: 9 }, { stat: 'hp', sp: 7 }])).toBe(addedBundleKey([{ stat: 'hp', sp: 7 }, { stat: 'spa', sp: 9 }]))
  })
})
