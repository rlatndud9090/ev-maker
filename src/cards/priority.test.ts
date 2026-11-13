import { describe, expect, it } from 'vitest'
import { typeEffectiveness, type PokemonSet } from '../core'
import type { Snapshot } from '../data/schema'
import { planTab } from './plan'
import { keepsPriorityRow } from './priority'
import { cardInput, realData } from './testing'
import type { TabPlan } from './types'

const { game } = realData()
const KINGAMBIT = { types: ['Dark', 'Steel'], ability: 'supremeoverlord' }
const GARCHOMP = { types: ['Dragon', 'Ground'], ability: 'roughskin' }
const DRAGONITE = { types: ['Dragon', 'Flying'], ability: 'multiscale' }

describe('keepsPriorityRow(선공기 행 조건)', () => {
  it('대상 약점이면 비자속이어도 남는다: 얼음뭉치(얼음) → 한카리아스 4배', () => {
    expect(keepsPriorityRow(game, 'iceshard', KINGAMBIT, GARCHOMP.types)).toBe(true)
  })

  it('자속 등배면 남는다: 대도각참 기습(악) → 한카리아스 1배', () => {
    expect(keepsPriorityRow(game, 'suckerpunch', KINGAMBIT, GARCHOMP.types)).toBe(true)
  })

  it('자속이어도 반감이면 남지 않는다: 대도각참 불릿펀치(강철) → 대도각참(강철 반감)', () => {
    expect(keepsPriorityRow(game, 'bulletpunch', KINGAMBIT, KINGAMBIT.types)).toBe(false)
  })

  it('비자속 등배면 남지 않는다: 대도각참 속이기(노말) → 한카리아스 1배', () => {
    expect(keepsPriorityRow(game, 'fakeout', KINGAMBIT, GARCHOMP.types)).toBe(false)
  })

  it('무효면 자속이어도 남지 않는다: 노말 사용자 신속(노말) → 팬텀(고스트 무효)', () => {
    expect(keepsPriorityRow(game, 'extremespeed', { types: ['Normal'], ability: 'innerfocus' }, ['Ghost', 'Poison'])).toBe(false)
  })

  it('사용자·대상이 뒤바뀌면 결과도 바뀐다(방어 탭 = 상대 → 나): 기습은 대도각참이 쓰면 남고 한카리아스가 쓰면 남지 않는다', () => {
    expect(keepsPriorityRow(game, 'suckerpunch', KINGAMBIT, GARCHOMP.types)).toBe(true)
    expect(keepsPriorityRow(game, 'suckerpunch', GARCHOMP, KINGAMBIT.types)).toBe(false)
    expect(keepsPriorityRow(game, 'iceshard', DRAGONITE, DRAGONITE.types)).toBe(true)
  })

  it('특성으로 바뀐 기술 타입 기준: 스킨(메가쁘사이저 전광석화 = 비행 자속) 등배·약점은 남고, 비행 반감 대상에게는 남지 않는다', () => {
    const pinsir = { types: ['Bug', 'Flying'], ability: 'aerilate' }
    expect(keepsPriorityRow(game, 'quickattack', pinsir, ['Grass'])).toBe(true)
    expect(keepsPriorityRow(game, 'quickattack', pinsir, ['Water'])).toBe(true)
    expect(keepsPriorityRow(game, 'quickattack', pinsir, ['Steel'])).toBe(false)
    // 같은 타입·특성 없음이면 노말 비자속이라 남지 않는다.
    expect(keepsPriorityRow(game, 'quickattack', { types: ['Bug', 'Flying'], ability: 'moxie' }, ['Grass'])).toBe(false)
  })

  it('배짱이면 노말 자속 선공기가 고스트에게 무효가 아니다', () => {
    const kangaskhan = { types: ['Normal'], ability: 'scrappy' }
    expect(keepsPriorityRow(game, 'fakeout', kangaskhan, ['Ghost', 'Poison'])).toBe(true)
    expect(keepsPriorityRow(game, 'fakeout', { types: ['Normal'], ability: 'earlybird' }, ['Ghost', 'Poison'])).toBe(false)
  })

  it('선공기가 아니거나 스냅샷에 없는 기술은 false', () => {
    expect(keepsPriorityRow(game, 'kowtowcleave', KINGAMBIT, GARCHOMP.types)).toBe(false)
    expect(keepsPriorityRow(game, 'not-a-move', KINGAMBIT, GARCHOMP.types)).toBe(false)
  })

  it('엔진 타입표에 없는 타입이면 던지지 않고 false(그 행만 없다)', () => {
    const odd: Snapshot = { ...game, data: { ...game.data, moves: { ...game.data.moves, iceshard: { ...game.data.moves.iceshard, type: 'Nope' } } } }
    expect(keepsPriorityRow(odd, 'iceshard', KINGAMBIT, GARCHOMP.types)).toBe(false)
    expect(keepsPriorityRow(game, 'iceshard', KINGAMBIT, ['Nope'])).toBe(false)
  })
})

describe('계획의 선공기 후보 표지(사용자·대상 연결)', () => {
  // 메가쁘사이저(벌레·비행, 스카이스킨): 전광석화는 비행 자속이라 비행이 반감 이하가 아닌 상대에게만 남는다(기본 폼 쁘사이저였다면 노말 비자속이라 어디에도 없다).
  const PINSIR: PokemonSet = {
    regulation: 'm-c',
    species: 'pinsir',
    ability: 'moxie',
    item: 'pinsirite',
    mega: true,
    nature: 'adamant',
    sp: { hp: 2, atk: 32, def: 0, spa: 0, spd: 0, spe: 32 },
    moves: ['closecombat', 'xscissor', 'quickattack', 'bodyslam'],
  }
  const typesOf = (id: string): readonly string[] => game.data.species[id].types
  const priorityFlags = (p: TabPlan, moveId: string) =>
    p.cards.flatMap((c) => c.conditions.flatMap((g) => g.candidates.filter((x) => x.moveId === moveId).map((x) => ({ opp: c.opponent.id, priority: x.priority }))))

  it('공격 탭: 사용자 = 나(메가 폼 타입·특성), 대상 = 상대', () => {
    const p = planTab(cardInput({ mySet: PINSIR }), 'attack')
    const flags = priorityFlags(p, 'quickattack')
    expect(flags.length).toBeGreaterThan(5)
    for (const f of flags) expect([f.opp, f.priority]).toEqual([f.opp, typeEffectiveness('Flying', typesOf(f.opp)) >= 1])
    expect(flags.some((f) => f.priority)).toBe(true)
    expect(flags.some((f) => !f.priority)).toBe(true)
  })

  it('방어 탭: 사용자 = 상대, 대상 = 나(메가쁘사이저 벌레·비행)', () => {
    const p = planTab(cardInput({ mySet: PINSIR }), 'defense')
    // 대도각참 기습(악 자속, 벌레·비행에 등배)은 남는다. 내가 사용자였다면 비자속이라 남지 않는다.
    const sucker = priorityFlags(p, 'suckerpunch').filter((f) => f.opp === 'kingambit')
    expect(sucker.length).toBeGreaterThan(0)
    expect(sucker.every((f) => f.priority)).toBe(true)
    // 상대 기술의 표지는 모두 상대 타입·나의 타입 기준 규칙과 같다(특성 타입 변화가 없는 상대에 한해 기본 타입으로 대조).
    const me = typesOf('pinsirmega')
    for (const c of p.cards) {
      const opp = game.data.species[c.opponent.id]
      if (opp.abilities.some((a) => ['aerilate', 'pixilate', 'refrigerate', 'galvanize', 'dragonize', 'normalize', 'liquidvoice', 'scrappy', 'mindseye'].includes(a))) continue
      for (const g of c.conditions) {
        for (const x of g.candidates) {
          const m = game.data.moves[x.moveId]
          if (m === undefined || m.priority <= 0) continue
          const eff = typeEffectiveness(m.type, me)
          expect([c.opponent.id, x.moveId, x.priority]).toEqual([c.opponent.id, x.moveId, eff > 1 || (opp.types.includes(m.type) && eff >= 1)])
        }
      }
    }
  })
})
