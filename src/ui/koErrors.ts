// 카드 모델 오류 이유(코드·field) → 한국어 안내. id는 이름 색인으로 한국어 이름으로 바꾼다.
import type { PokemonSet } from '../core'
import type { Snapshot, StatId } from '../data/schema'
import { STAT_LABEL } from './labels'
import { namesOf } from './names'

/** 카드 모델 ErrorReason과 같은 모양(ui는 cards를 몰라도 되게 구조만 받는다). */
export interface ReasonLike {
  code: string
  field?: string
  message: string
}

const hasBatchim = (word: string): boolean => {
  const last = word.trim().slice(-1)
  const code = last.charCodeAt(0)
  if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28 !== 0
  // 숫자는 한자어 읽기(영·일·삼·육·칠·팔에 받침), 그 밖(괄호 라벨·영문)은 받침 없음으로 본다.
  if (/[0-9]/.test(last)) return '013678'.includes(last)
  return false
}

/** 조사: josa('한카리아스', '은', '는') → '한카리아스는' */
export const josa = (word: string, withBatchim: string, without: string): string => `${word}${hasBatchim(word) ? withBatchim : without}`

/** 'attacker.'·'defender.' 접두를 뗀 세트 필드. */
export function setFieldOf(field: string | undefined): string | undefined {
  if (field === undefined) return undefined
  return field.replace(/^(attacker|defender)\./, '')
}

const MOVE_FIELD = /^moves\[(\d+)\]$/

function speciesLabel(game: Snapshot, set: PokemonSet | undefined): string {
  if (set === undefined) return '이 포켓몬'
  const names = namesOf(game)
  return typeof set.species === 'string' ? names.species.label(set.species) : '이 포켓몬'
}

function moveOf(game: Snapshot, set: PokemonSet | undefined, field: string | undefined): string | undefined {
  const m = field === undefined ? null : MOVE_FIELD.exec(field)
  if (m === null || set === undefined || !Array.isArray(set.moves)) return undefined
  const id = set.moves[Number(m[1])]
  return typeof id === 'string' ? namesOf(game).moves.label(id) : undefined
}

function idLabel(game: Snapshot, field: string | undefined, set: PokemonSet | undefined): string | undefined {
  const names = namesOf(game)
  if (set === undefined) return undefined
  if (field === 'species') return speciesLabel(game, set)
  if (field === 'ability' && typeof set.ability === 'string') return names.abilities.label(set.ability)
  if (field === 'item' && typeof set.item === 'string') return names.items.label(set.item)
  return moveOf(game, set, field)
}

function spTotalOf(set: PokemonSet | undefined): number | undefined {
  if (set === undefined || typeof set.sp !== 'object' || set.sp === null) return undefined
  const values = Object.values(set.sp)
  return values.every((v) => typeof v === 'number' && Number.isFinite(v)) ? values.reduce((a, b) => a + b, 0) : undefined
}

/**
 * 오류 이유를 한국어 문장으로. set은 그 이유를 낸 세트(내 세트 오류면 내 세트, 카드 오류면 상대 세트)이고,
 * field로 원인 칸을 찾아 이름을 채운다. 모르는 코드는 코어 메시지를 그대로 덧붙인다.
 */
export function koReason(game: Snapshot, reason: ReasonLike, set?: PokemonSet): string {
  const field = setFieldOf(reason.field)
  const names = namesOf(game)
  const { spTotal, spMaxPerStat } = game.manifest.rules
  const who = speciesLabel(game, set)
  switch (reason.code) {
    case 'SP_TOTAL_EXCEEDED': {
      const total = spTotalOf(set)
      return total === undefined ? `SP 합계가 상한 ${josa(String(spTotal), '을', '를')} 넘습니다` : `SP 합계 ${josa(String(total), '이', '가')} 상한 ${josa(String(spTotal), '을', '를')} 넘습니다`
    }
    case 'INVALID_SP': {
      const stat = field?.startsWith('sp.') ? (field.slice(3) as StatId) : undefined
      const label = stat !== undefined && Object.prototype.hasOwnProperty.call(STAT_LABEL, stat) ? STAT_LABEL[stat] : undefined
      return label === undefined ? `SP 입력이 올바르지 않습니다` : `${josa(`SP ${label}`, '은', '는')} 0~${spMaxPerStat} 사이 정수여야 합니다`
    }
    case 'ILLEGAL_MOVE': {
      if (field === 'moves') return '기술은 최대 4개까지 넣을 수 있습니다'
      const move = moveOf(game, set, field)
      if (move === undefined) return `${josa(who, '은', '는')} 그 기술을 배울 수 없습니다`
      if (reason.message.includes('중복')) return `${josa(move, '이', '가')} 두 번 들어 있습니다`
      return `${josa(who, '은', '는')} ${josa(move, '을', '를')} 배울 수 없습니다`
    }
    case 'UNKNOWN_MOVE': {
      const raw = field !== undefined && MOVE_FIELD.test(field) && set ? set.moves[Number(MOVE_FIELD.exec(field)![1])] : undefined
      return raw === undefined ? '이 레귤레이션에 없는 기술입니다' : `기술 "${String(raw)}"을(를) 찾을 수 없습니다`
    }
    case 'UNKNOWN_SPECIES':
      return set ? `포켓몬 "${String(set.species)}"을(를) 찾을 수 없습니다` : '포켓몬을 찾을 수 없습니다'
    case 'UNKNOWN_ITEM':
      return set?.item !== undefined ? `도구 "${String(set.item)}"을(를) 찾을 수 없습니다` : '도구를 찾을 수 없습니다'
    case 'UNKNOWN_ABILITY':
      return '특성을 찾을 수 없습니다'
    case 'UNKNOWN_NATURE':
      return '성격을 찾을 수 없습니다'
    case 'ILLEGAL_ABILITY': {
      const ability = set && typeof set.ability === 'string' ? names.abilities.label(set.ability) : '그 특성'
      return `${josa(who, '은', '는')} 특성 ${josa(ability, '을', '를')} 가질 수 없습니다`
    }
    case 'INVALID_MEGA': {
      if (field === 'item' && set?.item === undefined) return `${who}의 메가진화에는 메가스톤이 필요합니다`
      if (field === 'item' && set?.item !== undefined) return `${josa(names.items.label(set.item), '은', '는')} ${who}의 메가스톤이 아닙니다`
      return '메가진화 설정이 올바르지 않습니다'
    }
    case 'ENGINE_UNSUPPORTED': {
      const label = idLabel(game, field, set)
      if (reason.message.includes('첫 타')) return `${label ?? '상대 특성'}의 첫 타 방어 효과는 계산하지 않습니다`
      return `${josa(label ?? '이 항목', '은', '는')} 계산 엔진이 지원하지 않습니다`
    }
    case 'REGULATION_MISMATCH':
      return '세트의 레귤레이션이 현재 데이터와 다릅니다'
    case 'WHITE_HERB_MULTIHIT':
      return '하양허브를 소비한 랭크 변화 뒤의 연속기는 계산하지 않습니다'
    case 'TARGET_MISMATCH':
      return `계산할 수 없는 대상입니다 (${reason.message})`
    default:
      return `계산할 수 없습니다 (${reason.message})`
  }
}

/** 내 세트 편집 칸 이름(원인 칸 옆 안내 위치). 칸을 정할 수 없으면 'other'. */
export type DraftField = 'species' | 'ability' | 'item' | 'nature' | 'mega' | 'sp' | `sp.${StatId}` | `moves[${number}]` | 'moves' | 'other'

export function draftFieldOf(reason: ReasonLike): DraftField {
  const f = setFieldOf(reason.field)
  if (f === undefined) return reason.code === 'SP_TOTAL_EXCEEDED' ? 'sp' : 'other'
  if (f === 'species' || f === 'ability' || f === 'item' || f === 'nature' || f === 'mega' || f === 'sp' || f === 'moves') return f
  if (/^sp\.(hp|atk|def|spa|spd|spe)$/.test(f)) return f as DraftField
  if (MOVE_FIELD.test(f)) return f as DraftField
  return 'other'
}
