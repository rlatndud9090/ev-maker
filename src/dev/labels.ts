// 코어 값 → 한국어 표시 라벨. Record 타입으로 코어 유니언을 빠짐없이 덮는다.
import type { StatId } from '../data/schema'
import type { AttackBand, DefenseBand, GameType, SpeedOrder, Status, Terrain, Weather } from '../core'
import { CoreError, CoreInputError } from '../core'

export const STAT_LABEL: Record<StatId, string> = {
  hp: 'HP',
  atk: '공격',
  def: '방어',
  spa: '특공',
  spd: '특방',
  spe: '스피드',
}

export const ATTACK_BAND_LABEL: Record<AttackBand, string> = {
  'mid-or-lower': '중난수 이하',
  'high-roll-ohko': '고난수 1타',
  'guaranteed-ohko': '확정 1타',
}

export const DEFENSE_BAND_LABEL: Record<DefenseBand, string> = {
  'mid-or-higher': '중난수 이상',
  'low-roll-ohko': '저난수 1타',
  'guaranteed-survive': '확정 버팀',
}

/** 스윕 칸 범주(구간 또는 행동 순서) 라벨 */
export const CATEGORY_LABEL: Record<string, string> = { ...ATTACK_BAND_LABEL, ...DEFENSE_BAND_LABEL }

/** 공격측 관점 */
export const ORDER_LABEL: Record<SpeedOrder, string> = { first: '선공', tie: '동속', second: '후공' }

export const GAME_TYPE_LABEL: Record<GameType, string> = { Doubles: '더블', Singles: '싱글' }

export const WEATHER_LABEL: Record<Weather, string> = {
  none: '없음',
  Sun: '쾌청',
  Rain: '비',
  Sand: '모래바람',
  Snow: '설경',
}

export const TERRAIN_LABEL: Record<Terrain, string> = {
  none: '없음',
  Electric: '일렉트릭필드',
  Grassy: '그래스필드',
  Psychic: '사이코필드',
  Misty: '미스트필드',
}

export const STATUS_LABEL: Record<Status, string> = {
  none: '없음',
  par: '마비',
  brn: '화상',
  psn: '독',
  tox: '맹독',
  slp: '잠듦',
  frz: '얼음',
}

export const keysOf = <K extends string>(r: Record<K, string>): K[] => Object.keys(r) as K[]

/** 오류를 줄 단위 문장으로. 코어 오류는 코드·필드를 함께 보인다. */
export function errorLines(e: unknown): string[] {
  if (e instanceof CoreError) return e.details.map((d) => `[${d.code}] ${d.field ? `${d.field}: ` : ''}${d.message}`)
  if (e instanceof CoreInputError) return [`[입력 오류] ${e.message}`]
  if (e instanceof Error) return [`[${e.name}] ${e.message}`]
  return [String(e)]
}

export type Outcome<T> = { ok: true; value: T } | { ok: false; errors: string[] }

export function attempt<T>(fn: () => T): Outcome<T> {
  try {
    return { ok: true, value: fn() }
  } catch (e) {
    return { ok: false, errors: errorLines(e) }
  }
}

export const percent = (v: number, digits = 1) => `${v.toFixed(digits)}%`

/** 대미지 비율은 커뮤니티 계산기와 같게 소수 첫째 자리 내림으로 표시한다. */
export const damagePercent = (v: number) => `${(Math.floor(v * 10 + 1e-9) / 10).toFixed(1)}%`
