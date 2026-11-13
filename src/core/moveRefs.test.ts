import { describe, expect, it } from 'vitest'
import { Generations, toID } from '@smogon/calc'
import { MC, ZERO_SP, mkSet } from './testing'
import { CoreError, STAT_IDS, SPEED_DEPENDENT_ATTACKER_ABILITIES, calcDamage, engineMoveOverrides, moveStatRefs, type BattleConditions, type PokemonSet } from './index'
import type { StatId } from '../data/schema'
import { OFFENSE_BY_NAME } from './moveRefs'

describe('엔진 기술 표시와 참조 표의 대조', () => {
  const gen = Generations.get(0)

  it('공격 능력치·주체를 바꾸는 엔진 기술은 모두 OFFENSE_BY_NAME에 있고, 방어 주체를 바꾸는 기술은 없다', () => {
    const offense = [...gen.moves].filter((m) => m.overrideOffensiveStat || m.overrideOffensivePokemon).map((m) => toID(m.name))
    expect(offense.length).toBeGreaterThan(0)
    for (const id of offense) expect(OFFENSE_BY_NAME, id).toHaveProperty(id)
    expect([...gen.moves].filter((m) => m.overrideDefensivePokemon).map((m) => m.name)).toEqual([])
  })

  it('엔진 방어 능력치 대체 기술은 참조 표 방어가 def다', () => {
    const ids = [...gen.moves].filter((m) => m.overrideDefensiveStat).map((m) => toID(m.name)).filter((id) => id in MC.data.moves)
    expect(ids).toContain('psyshock')
    for (const id of ids) {
      expect(engineMoveOverrides(id).defensiveStat).toBe('def')
      expect(moveStatRefs(MC, id).defense).toBe('def')
    }
  })
})

describe('moveStatRefs 사례', () => {
  it.each<[string, Partial<ReturnType<typeof moveStatRefs>>]>([
    ['suckerpunch', { offense: { owner: 'self', stat: 'atk' }, defense: 'def', attackerStats: ['atk'], defenderStats: ['hp', 'def'] }],
    ['dazzlinggleam', { offense: { owner: 'self', stat: 'spa' }, defense: 'spd', attackerStats: ['spa'], defenderStats: ['hp', 'spd'] }],
    ['bodypress', { offense: { owner: 'self', stat: 'def' }, defense: 'def', attackerStats: ['def'], defenderStats: ['hp', 'def'] }],
    ['foulplay', { offense: { owner: 'target', stat: 'atk' }, defense: 'def', attackerStats: [], defenderStats: ['hp', 'def', 'atk'] }],
    ['psyshock', { offense: { owner: 'self', stat: 'spa' }, defense: 'def', attackerStats: ['spa'], defenderStats: ['hp', 'def'] }],
    ['finalgambit', { attackerStats: ['spa', 'hp'], defenderStats: ['hp', 'spd'] }],
    ['gyroball', { speedDependent: true, attackerStats: ['atk', 'spe'], defenderStats: ['hp', 'def', 'spe'] }],
    ['shellsidearm', { categoryVaries: true, attackerStats: ['spa', 'atk', 'def', 'spd'], defenderStats: ['hp', 'spd', 'atk', 'spa', 'def'] }],
    ['swordsdance', { category: 'Status', offense: null, defense: null, attackerStats: [], defenderStats: ['hp'] }],
  ])('%s', (id, expected) => {
    expect(moveStatRefs(MC, id)).toMatchObject({ moveId: id, ...expected })
  })

  it('스냅샷에 없는 기술은 CoreError UNKNOWN_MOVE', () => {
    for (const id of ['notamove', '__proto__', 'constructor']) {
      let err: unknown
      try {
        moveStatRefs(MC, id)
      } catch (e) {
        err = e
      }
      expect(err).toBeInstanceOf(CoreError)
      expect((err as CoreError).details[0].code).toBe('UNKNOWN_MOVE')
    }
  })
})

/**
 * 섭동: 공격기마다 배울 수 있는 종 1쌍에서, 참조 능력치 밖 능력치의 SP를 0 ↔ 32로 바꿔도 대미지 난수 배열이 같아야 한다.
 * 특성 쪽 스피드 의존(SPEED_DEPENDENT_ATTACKER_ABILITIES)은 카드 모델 관여 능력치 규칙이 따로 다루므로 공격측 특성 후보에서 뺀다.
 */
describe('참조 능력치 섭동(엔진 버전업 어긋남 탐지)', () => {
  const unsupported = MC.manifest.engineUnsupported
  const species = Object.values(MC.data.species).filter((s) => !s.isMega)
  const abilityOf = (abilities: string[]) =>
    abilities.find((a) => !unsupported.abilities.includes(a) && !SPEED_DEPENDENT_ATTACKER_ABILITIES.includes(a) && a !== 'disguise' && a !== 'iceface')
  /** 면역이 겹치지 않는 방어측 후보(노말 / 땅·드래곤 / 강철·물) */
  const defenders = ['snorlax', 'garchomp', 'empoleon'].filter((id) => id in MC.data.species).map((id) => mkSet({ species: id, ability: MC.data.species[id].abilities[0] }))

  /** 도구·필드가 있어야 대미지가 나는 기술(내던지기는 사용자 도구, 폴터가이스트는 대상 도구, 아이언롤러는 필드) */
  const PREREQUISITE: Record<string, { attackerItem?: string; defenderItem?: string; conditions?: BattleConditions }> = {
    fling: { attackerItem: 'leftovers' },
    poltergeist: { defenderItem: 'leftovers' },
    steelroller: { conditions: { terrain: 'Electric' } },
  }
  const rolls = (a: PokemonSet, d: PokemonSet, id: string) => {
    const p = PREREQUISITE[id] ?? {}
    const r = calcDamage(MC, p.attackerItem ? { ...a, item: p.attackerItem } : a, p.defenderItem ? { ...d, item: p.defenderItem } : d, id, p.conditions)
    return r.kind === 'damage' ? r.rolls : r.kind
  }
  const at = (set: PokemonSet, stat: StatId): PokemonSet => ({ ...set, sp: { ...ZERO_SP, [stat]: 32 } })

  it('스냅샷 전 공격기', () => {
    const moves = Object.values(MC.data.moves).filter((m) => m.category !== 'Status' && !unsupported.moves.includes(m.id))
    const failures: string[] = []
    let checked = 0
    for (const move of moves) {
      const learnerSpecies = species.find((s) => s.learnset.includes(move.id) && abilityOf(s.abilities))
      if (!learnerSpecies) continue
      const attacker = mkSet({ species: learnerSpecies.id, ability: abilityOf(learnerSpecies.abilities)!, moves: [move.id] })
      const defender = defenders.find((d) => Array.isArray(rolls(attacker, d, move.id)))
      if (!defender) {
        failures.push(`${move.id}: 대미지가 나는 방어측 후보가 없다`)
        continue
      }
      checked++
      const refs = moveStatRefs(MC, move.id)
      const base = JSON.stringify(rolls(attacker, defender, move.id))
      for (const stat of STAT_IDS) {
        if (!refs.attackerStats.includes(stat) && JSON.stringify(rolls(at(attacker, stat), defender, move.id)) !== base) {
          failures.push(`${move.id}: 사용자 ${stat}이 대미지를 바꾼다(${learnerSpecies.id})`)
        }
        if (!refs.defenderStats.includes(stat) && JSON.stringify(rolls(attacker, at(defender, stat), move.id)) !== base) {
          failures.push(`${move.id}: 대상 ${stat}이 대미지를 바꾼다(${defender.species})`)
        }
      }
    }
    expect(failures).toEqual([])
    expect(checked).toBeGreaterThan(moves.length * 0.9)
  })
})
