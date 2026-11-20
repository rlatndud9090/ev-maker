import { describe, expect, it } from 'vitest'
import { STAT_IDS, type PokemonSet, type SpTable } from '../core'
import type { StatId } from '../data/schema'
import { bundleStats } from './bundles'
import { cardItems, itemKey, BASE_CONDITION_ID } from './items'
import type { LockTargetKey } from './lock'
import { findLockTarget, lockTargetKeyOf, type LockTargetRef } from './lockTarget'
import { planTab } from './plan'
import { cardInput, realData, syntheticEntry, syntheticView } from './testing'
import type { AddedBundle, CardInput, CardSpec, CustomTarget, DamageTab, TabPlan } from './types'

const { game, bo1 } = realData()
const reg = game.manifest.regulation.id
const mySet: PokemonSet = {
  regulation: reg,
  species: 'raichu',
  ability: 'static',
  item: 'raichunitey',
  mega: true,
  nature: 'hardy',
  sp: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
  moves: ['thunderbolt', 'focusblast', 'grassknot', 'voltswitch'],
}
const ROTOM: CustomTarget = { rosterId: 'rotomwash', moves: ['hydropump', 'poltergeist', 'electroweb'], edits: {} }
const first = bo1.ranking[0]
const added: AddedBundle[] = [{ tab: 'attack', source: 'ladder', opponentId: first.id, category: 'special', sp: { hp: 4, spd: 8 } }]
const input = (patch: Partial<CardInput> = {}): CardInput => cardInput({ mySet, filters: { topN: 15, selected: [] }, customTargets: [ROTOM], addedBundles: added, ...patch })

function expected(plan: TabPlan, card: CardSpec): { key: string; ref: LockTargetRef }[] {
  return cardItems(plan, card).flatMap((r): { key: string; ref: LockTargetRef }[] => {
    const c = r.candidate
    if (c.target === 'filter') return [{ key: r.key, ref: { filterId: c.id } }]
    if (c.target === 'row' && plan.rows[c.id].error === undefined) return [{ key: r.key, ref: { rowId: c.id } }]
    return []
  })
}

describe('lockTargetKeyOf → findLockTarget', () => {
  it.each(['attack', 'defense'] as const)('%s: 모든 카드·항목의 키가 같은 계획에서 그 행·필터로 돌아온다(래더·프리셋·직접 추가·도구 변형)', (tab: DamageTab) => {
    const plan = planTab(input(), tab)
    const sources = new Set<string>()
    let n = 0
    for (const card of plan.cards) {
      if (card.state !== 'ok') continue
      for (const { key, ref } of expected(plan, card)) {
        const lockKey = lockTargetKeyOf(tab, card, key)
        sources.add(Object.keys(lockKey.bundle)[0])
        expect(findLockTarget(plan, { target: lockKey }), `${card.id} ${key}`).toEqual(ref)
        n++
      }
    }
    expect(n).toBeGreaterThan(0)
    expect(sources).toContain('ladder')
    expect(sources).toContain('preset')
    if (tab === 'attack') expect(sources).toContain('added')
  })

  it('다른 표시 필터의 계획에서도 같은 키는 같은 행을 찾고, 다른 탭·스피드 키는 찾지 않는다', () => {
    const plan = planTab(input(), 'attack')
    const card = plan.cards.find((c) => c.state === 'ok' && c.opponent.source === 'ladder' && c.bundle.userAdded === undefined) as CardSpec
    const [{ key, ref }] = expected(plan, card)
    const lockKey = lockTargetKeyOf('attack', card, key)
    const only = planTab(input({ filters: { topN: 1, selected: [card.opponent.id] } }), 'attack')
    expect(findLockTarget(only, { target: lockKey })).toEqual(ref)
    expect(findLockTarget(planTab(input(), 'defense'), { target: { ...lockKey, kind: 'defense' } })).toBeNull()
    const speed: LockTargetKey = { kind: 'speed', origin: 'ladder', opponentId: card.opponent.id, bundle: { sp: 32, nature: 'plus' }, condition: 'none', filterKind: null }
    expect(findLockTarget(plan, { target: speed })).toBeNull()
  })

  it('일치 선택지: 그 카드에 같은 항목(기술·조건)이 없으면 null', () => {
    const plan = planTab(input(), 'attack')
    const card = plan.cards.find((c) => c.state === 'ok') as CardSpec
    expect(findLockTarget(plan, { target: lockTargetKeyOf('attack', card, itemKey('surf', BASE_CONDITION_ID)) })).toBeNull()
  })

  it('통계가 바뀌어 배분이 사라지면 null, 되돌리면 다시 찾는다(공격)', () => {
    const plan = planTab(input(), 'attack')
    const card = plan.cards.find((c) => c.state === 'ok' && c.opponent.source === 'ladder' && c.bundle.userAdded === undefined && c.berry === undefined) as CardSpec
    const [{ key, ref }] = expected(plan, card)
    const lockKey = lockTargetKeyOf('attack', card, key)
    const keyStats = card.bundle.stats.map((s) => s.stat) as StatId[]
    const entry = bo1.ranking.find((e) => e.id === card.opponent.id)
    if (entry === undefined) throw new Error('상대 항목 없음')
    const kept = entry.spreads.kept.filter(([spread]) => {
      const [nature, sps] = spread.split(':')
      const nums = sps.split('/').map(Number)
      const table = Object.fromEntries(STAT_IDS.map((s, i) => [s, nums[i]])) as SpTable
      return JSON.stringify(bundleStats(game, keyStats, nature, table)) !== card.bundle.key
    })
    expect(kept.length).toBeLessThan(entry.spreads.kept.length)
    const changed = syntheticView(game, bo1.meta, [syntheticEntry(entry, { spreads: { ...entry.spreads, kept } })])
    const gone = planTab(input({ view: changed, customTargets: [], addedBundles: [] }), 'attack')
    expect(gone.cards.some((c) => c.opponent.id === card.opponent.id)).toBe(true)
    expect(findLockTarget(gone, { target: lockKey })).toBeNull()
    expect(findLockTarget(planTab(input(), 'attack'), { target: lockKey })).toEqual(ref)
  })

  it('방어: 배분이 사라지면 그 기술의 상대 공격 능력치 사영이 같은 배분으로 옮기고, 여럿이면 점유율 높은 쪽', () => {
    const plan = planTab(input({ filters: { topN: 40, selected: [] }, customTargets: [], addedBundles: [] }), 'defense')
    const cards = plan.cards.filter((c) => c.state === 'ok' && c.opponent.id === 'metagrossmega' && c.category === 'physical' && c.berry === undefined)
    const bodypress = itemKey('bodypress', BASE_CONDITION_ID)
    const matching = cards.filter((c) => c.bundle.stats.some((s) => s.stat === 'def' && s.sp === 0 && s.nature === 'neutral') && expected(plan, c).some((e) => e.key === bodypress))
    expect(matching.length).toBeGreaterThan(1)
    const top = [...matching].sort((a, b) => (b.bundle.share ?? 0) - (a.bundle.share ?? 0))[0]
    const forged = lockTargetKeyOf('defense', top, bodypress)
    const ghost: LockTargetKey = {
      ...forged,
      bundle: { ladder: JSON.stringify([{ stat: 'atk', sp: 7, nature: 'minus' }, { stat: 'def', sp: 0, nature: 'neutral' }]) },
    }
    expect(cards.some((c) => c.bundle.key === (ghost as { bundle: { ladder: string } }).bundle.ladder)).toBe(false)
    const want = expected(plan, top).find((e) => e.key === bodypress)?.ref
    expect(findLockTarget(plan, { target: ghost })).toEqual(want)
    const noMatch: LockTargetKey = { ...forged, bundle: { ladder: JSON.stringify([{ stat: 'def', sp: 31, nature: 'minus' }]) } }
    expect(findLockTarget(plan, { target: noMatch })).toBeNull()
  })
})
