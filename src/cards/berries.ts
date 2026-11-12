// 반감열매(공격 탭 상대 도구 변형). 판정은 코어 타입표·특성 타입 변화 규칙만 조회한다.
import { attackEffectiveness, attackMoveType } from '../core'
import type { Snapshot } from '../data/schema'
import type { PriorityUser } from './priority'

/**
 * 반감열매 → 반감하는 기술 타입(엔진 @smogon/calc getBerryResistType과 같은 표). 스냅샷 도구 데이터에는 열매 효과가 없어 순수 상수로 둔다.
 * 카리열매(노말)만 상성과 무관하게 노말 기술에 발동하고, 나머지는 효과가 굉장한(상성 > 1) 그 타입 기술에만 발동한다.
 */
export const RESIST_BERRIES: Readonly<Record<string, string>> = Object.freeze({
  chilanberry: 'Normal',
  occaberry: 'Fire',
  passhoberry: 'Water',
  wacanberry: 'Electric',
  rindoberry: 'Grass',
  yacheberry: 'Ice',
  chopleberry: 'Fighting',
  kebiaberry: 'Poison',
  shucaberry: 'Ground',
  cobaberry: 'Flying',
  payapaberry: 'Psychic',
  tangaberry: 'Bug',
  chartiberry: 'Rock',
  kasibberry: 'Ghost',
  habanberry: 'Dragon',
  colburberry: 'Dark',
  babiriberry: 'Steel',
  roseliberry: 'Fairy',
})

/** 상대 열매를 쓰지 못하게 하는 공격측 특성(엔진 gen789와 같은 규칙: 긴장감·인마일체) */
const BERRY_BLOCKING_ABILITIES: readonly string[] = ['unnerve', 'asoneglastrier', 'asonespectrier']
/** 지닌 도구를 무효로 하는 맞는 쪽 특성(엔진 checkItem: 서투름) */
const ITEM_DISABLING_ABILITIES: readonly string[] = ['klutz']

/** 열매를 지닌 쪽: 계산에 쓰는 폼 타입과 특성 */
export interface BerryHolder {
  types: readonly string[]
  ability: string
}

export const resistBerryType = (item: string): string | undefined =>
  Object.prototype.hasOwnProperty.call(RESIST_BERRIES, item) ? RESIST_BERRIES[item] : undefined

/**
 * 공격측(user)이 moveId로 target을 칠 때 target이 지닌 berry가 발동하는지. 기술 타입은 코어가 대미지 계산에서 바꾸는 타입
 * (스킨 특성 등, attackMoveType), 상성은 배짱·심안·기술별 특례(프리즈드라이·플라잉프레스)까지(attackEffectiveness). 반감열매가 아니거나,
 * 공격측이 긴장감·인마일체거나, 맞는 쪽이 서투름(도구 무효)이거나, 스냅샷에 없는 기술·엔진 타입표에 없는 타입이면 false.
 */
export function berryActivates(game: Snapshot, moveId: string, berry: string, user: PriorityUser, target: BerryHolder): boolean {
  const berryType = resistBerryType(berry)
  if (berryType === undefined || BERRY_BLOCKING_ABILITIES.includes(user.ability) || ITEM_DISABLING_ABILITIES.includes(target.ability)) return false
  if (!Object.prototype.hasOwnProperty.call(game.data.moves, moveId)) return false
  const move = game.data.moves[moveId]
  if (move.category === 'Status') return false
  try {
    const type = attackMoveType(moveId, move.type, user.ability)
    if (type !== berryType) return false
    return berryType === 'Normal' || attackEffectiveness(type, target.types, user.ability, moveId) > 1
  } catch {
    return false
  }
}

/** 메타 도구 분포에서 점유율 min 이상인 반감열매(점유율 내림차순, 동률 id 순) */
export function resistBerriesOf(shares: Readonly<Record<string, number>>, min: number): { item: string; share: number }[] {
  return Object.entries(shares)
    .filter(([item, share]) => resistBerryType(item) !== undefined && share >= min)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([item, share]) => ({ item, share }))
}
