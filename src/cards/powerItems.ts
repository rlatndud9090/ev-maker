// 화력 도구(방어 탭 상대 도구 변형, PRD R14). 판정은 코어 타입표·특성 타입 변화 규칙만 조회한다.
import { WEATHER_NEGATING_ABILITIES, abilityTerrain, abilityWeather, attackEffectiveness, attackMoveType, effectivenessAgainst, type EffectivenessDefender } from '../core'
import type { Snapshot } from '../data/schema'
import type { MoveUser } from './berries'

/** 타입 강화 도구 → 강화하는 기술 타입(구애머리띠·구애안경은 규정 데이터에 없다) */
export const TYPE_BOOST_ITEMS: Readonly<Record<string, string>> = Object.freeze({
  blackbelt: 'Fighting',
  blackglasses: 'Dark',
  charcoal: 'Fire',
  dragonfang: 'Dragon',
  fairyfeather: 'Fairy',
  hardstone: 'Rock',
  magnet: 'Electric',
  metalcoat: 'Steel',
  miracleseed: 'Grass',
  mysticwater: 'Water',
  nevermeltice: 'Ice',
  poisonbarb: 'Poison',
  sharpbeak: 'Flying',
  twistedspoon: 'Psychic',
  silverpowder: 'Bug',
  silkscarf: 'Normal',
  spelltag: 'Ghost',
  softsand: 'Ground',
})

/** 화력 도구 id(생명의구슬·달인의띠·힘의머리띠·박식안경·타입 강화 도구) */
export const POWER_ITEMS: readonly string[] = Object.freeze(['lifeorb', 'expertbelt', 'muscleband', 'wiseglasses', ...Object.keys(TYPE_BOOST_ITEMS)])

/** 지닌 도구를 무효로 하는 특성(엔진 checkItem: 서투름) */
const ITEM_DISABLING_ABILITIES: readonly string[] = ['klutz']

/** 대미지가 위력과 무관하게 정해져 도구 보정이 없는 기술(고정 대미지·일격필살·받은 대미지 반사) */
const UNBOOSTED_MOVES: readonly string[] = [
  'seismictoss',
  'nightshade',
  'superfang',
  'finalgambit',
  'endeavor',
  'fissure',
  'guillotine',
  'horndrill',
  'sheercold',
  'counter',
  'mirrorcoat',
  'metalburst',
  'comeuppance',
]

/** 도구를 지니면 위력이 줄어 화력 도구 줄의 비교 대상이 아닌 기술(애크러뱃: 도구 없을 때 위력 2배) */
const ITEM_WEAKENED_MOVES: readonly string[] = ['acrobatics']

const own = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k)

export const isPowerItem = (item: string): boolean => POWER_ITEMS.includes(item)

/**
 * user가 item을 지니고 moveId로 target(나)을 칠 때 그 도구가 대미지 보정을 주는지. 기술 타입은 공격측 특성·공격측 특성 날씨·필드로 바뀐 타입
 * (R13, 어느 쪽이든 구름보기·에어록이면 날씨 없음). 생명의구슬 = 위력으로 대미지가 정해지는 기술이면 항상(고정 대미지·일격필살·반사 기술 제외), 달인의띠 = 바뀐 타입 상성 > 1(방어측 특성 반감과 무관, 엔진 규칙),
 * 힘의머리띠 = 물리, 박식안경 = 특수, 타입 강화 = 바뀐 타입 일치. 나에게 무효(effectivenessAgainst = 0)거나, 화력 도구가 아니거나, user가 서투름이거나,
 * 스냅샷에 없는 기술·변화기·엔진 타입표에 없는 타입이면 false.
 */
export function powerItemBoosts(game: Snapshot, moveId: string, item: string, user: MoveUser, target: EffectivenessDefender): boolean {
  if (!isPowerItem(item) || ITEM_DISABLING_ABILITIES.includes(user.ability) || !own(game.data.moves, moveId)) return false
  const move = game.data.moves[moveId]
  if (move.category === 'Status' || UNBOOSTED_MOVES.includes(moveId) || ITEM_WEAKENED_MOVES.includes(moveId)) return false
  const negated = WEATHER_NEGATING_ABILITIES.some((a) => a === user.ability || a === target.ability)
  const field = { weather: negated ? 'none' : abilityWeather(user.ability), terrain: abilityTerrain(user.ability) } as const
  try {
    // 나에게 무효(타입·특성·사이코필드)면 대미지가 없어 보정도 없다
    if (effectivenessAgainst(game, moveId, { ability: user.ability, ...field }, target) === 0) return false
    if (item === 'lifeorb') return true
    if (item === 'muscleband') return move.category === 'Physical'
    if (item === 'wiseglasses') return move.category === 'Special'
    const type = attackMoveType(moveId, move.type, user.ability, field)
    if (item === 'expertbelt') return attackEffectiveness(type, target.types, user.ability, moveId) > 1
    return type === TYPE_BOOST_ITEMS[item]
  } catch {
    return false
  }
}

/** 메타 도구 분포에서 점유율 min 이상인 화력 도구(점유율 내림차순, 동률 id 순) */
export function powerItemsOf(shares: Readonly<Record<string, number>>, min: number): { item: string; share: number }[] {
  return Object.entries(shares)
    .filter(([item, share]) => isPowerItem(item) && share >= min)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([item, share]) => ({ item, share }))
}
