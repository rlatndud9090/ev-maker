// 대미지 판정. 엔진의 몇 타 판정은 쓰지 않고, 타별 난수 분포를 합성해 1타 확률을 직접 낸다.
import type { MoveEntry, Snapshot } from '../data/schema'
import type { BandThresholds, BattleConditions, DamageResult, PokemonSet } from './types'
import { normalizeConditions, type NormalizedConditions } from './conditions'
import { CoreInputError, coreError } from './errors'
import { assertMoveUsable, validateSet, type ResolvedSet } from './set'
import { engineDamage } from './engine'
import { attackBand, defenseBand, normalizeThresholds } from './bands'

/** 16^타수가 안전 정수 범위를 넘지 않는 최대 타수 */
const MAX_EXACT_HITS = 13
/** 방어측 특성을 무시하는 공격측 특성 */
const ABILITY_IGNORING = ['moldbreaker', 'teravolt', 'turboblaze']
/** HP 가득일 때 한 번의 타격으로는 쓰러지지 않게 하는 특성·도구 */
const FULL_HP_SURVIVAL_ABILITY = 'sturdy'
const FULL_HP_SURVIVAL_ITEM = 'focussash'
const ITEM_BLOCKING_ABILITY = 'klutz'
/** 첫 타를 무효화하는 특성. 상태(발동 전·후)를 입력으로 받지 않으므로 계산을 거부한다. */
const FIRST_HIT_NULLIFYING_ABILITIES = ['disguise', 'iceface']

/** 합계 대미지 → 조합 수. 각 타의 16개 난수는 등확률이다. */
export function sumDistribution(rolls: number[][]): Map<number, number> {
  if (rolls.length === 0 || rolls.length > MAX_EXACT_HITS) throw new Error(`타수 ${rolls.length}는 정확 합성 범위 밖이다`)
  let dist = new Map<number, number>([[0, 1]])
  for (const hit of rolls) {
    const next = new Map<number, number>()
    for (const [sum, count] of dist) {
      for (const d of hit) next.set(sum + d, (next.get(sum + d) ?? 0) + count)
    }
    dist = next
  }
  return dist
}

/**
 * 합계 ≥ hp인 조합 비율. surviveFirstHit이면 첫 타는 HP를 1 남기고 멈춘다(옹골참·기합의띠).
 * 이후 타는 HP 가득이 아니므로 그대로 들어간다.
 */
export function koChance(rolls: number[][], hp: number, surviveFirstHit = false): number {
  const effective = surviveFirstHit ? [rolls[0].map((d) => Math.min(d, hp - 1)), ...rolls.slice(1)] : rolls
  let ko = 0
  for (const [sum, count] of sumDistribution(effective)) if (sum >= hp) ko += count
  return ko / 16 ** rolls.length
}

function survivesFirstHitAtFullHp(atk: ResolvedSet, def: ResolvedSet): boolean {
  if (def.curHp !== def.stats.hp) return false
  const sturdy = def.ability === FULL_HP_SURVIVAL_ABILITY && !ABILITY_IGNORING.includes(atk.ability)
  const sash = def.item === FULL_HP_SURVIVAL_ITEM && def.ability !== ITEM_BLOCKING_ABILITY
  return sturdy || sash
}

function checkHits(move: MoveEntry, c: NormalizedConditions): void {
  if (c.hits === undefined) return
  if (!Array.isArray(move.multihit)) {
    throw new CoreInputError('conditions.hits', `${move.id}은 타수를 지정할 수 있는 가변 타수 기술이 아니다`)
  }
  const [min, max] = move.multihit
  if (c.hits < min || c.hits > max) {
    throw new CoreInputError('conditions.hits', `${move.id}의 타수는 ${min}~${max}다(받은 값: ${c.hits})`)
  }
}

/**
 * 공격 세트가 기술을 방어 세트에 1회 쓸 때의 대미지와 1타 판정.
 * 1타 확률은 방어측 현재 HP(생략 시 가득) 기준이며 급소는 conditions.critical일 때만 적용된다.
 */
export function calcDamage(
  snapshot: Snapshot,
  attacker: PokemonSet,
  defender: PokemonSet,
  moveId: string,
  conditions?: BattleConditions,
  thresholds?: Partial<BandThresholds>,
): DamageResult {
  const atk = validateSet(snapshot, attacker)
  const def = validateSet(snapshot, defender)
  const move = snapshot.data.moves[assertMoveUsable(snapshot, atk, moveId)]
  const c = normalizeConditions(conditions)
  const t = normalizeThresholds(thresholds)
  checkHits(move, c)
  if (move.category === 'Status') return { kind: 'status' }

  const rolls = engineDamage(snapshot, atk, def, move, c)
  if (rolls.every((hit) => hit.every((d) => d === 0))) return { kind: 'immune' }
  if (FIRST_HIT_NULLIFYING_ABILITIES.includes(def.ability) && !ABILITY_IGNORING.includes(atk.ability)) {
    throw coreError('ENGINE_UNSUPPORTED', 'defender.ability', `방어측 ${def.ability}이 첫 타를 막는 규칙은 계산하지 않는다`)
  }

  const min = rolls.reduce((acc, hit) => acc + Math.min(...hit), 0)
  const max = rolls.reduce((acc, hit) => acc + Math.max(...hit), 0)
  const hp = def.stats.hp
  const ohkoChance = koChance(rolls, def.curHp, survivesFirstHitAtFullHp(atk, def))
  return {
    kind: 'damage',
    rolls,
    hits: rolls.length,
    min,
    max,
    defenderHp: hp,
    minPercent: (min / hp) * 100,
    maxPercent: (max / hp) * 100,
    ohkoChance,
    attackBand: attackBand(ohkoChance, t),
    defenseBand: defenseBand(ohkoChance, t),
    attackerSpecies: atk.species.id,
    defenderSpecies: def.species.id,
    attackerSetAbility: atk.setAbility,
    defenderSetAbility: def.setAbility,
    attackerAbility: atk.ability,
    defenderAbility: def.ability,
  }
}
