import type { KeyboardEvent } from 'react'
import { bundleSpoken, type MinSp, type SpeedBadge as Badge, type SpeedCondition, type SpeedStatus } from '../../cards'
import type { SpeedConditionKind } from '../../cards'
import type { SpeedRejection } from '../../core'
import type { Snapshot } from '../../data/schema'
import { TERRAIN_LABEL, WEATHER_LABEL } from '../../ui/labels'
import { namesOf } from '../../ui/names'

// 스피드 차트 화면 글자 조립(순수 함수)
export const CONDITION_FILTER_LABEL: Readonly<Record<SpeedConditionKind, string>> = { rank: '랭크업', scarf: '스카프', tailwind: '순풍', field: '날씨/필드' }

export const STATUS_LABEL: Readonly<Record<SpeedStatus, string>> = { outspeeds: '추월', tie: '동속', outsped: '추월당함' }
/** 상태별 클래스(색 토큰) */
export const STATUS_CLASS: Readonly<Record<SpeedStatus, string>> = { outspeeds: 'win', tie: 'tie', outsped: 'lose' }

/**
 * 조건 태그 글자. 기본 배지는 undefined. 스카프 배지는 도구 아이콘이 그 조건을 보이므로 태그가 없다.
 */
export function conditionTag(c: SpeedCondition): string | undefined {
  switch (c.kind) {
    case 'none':
      return undefined
    case 'rank':
      return `+${c.stage}`
    case 'scarf':
      return undefined
    case 'tailwind':
      return '순풍'
    case 'field':
      return c.field.kind === 'weather' ? WEATHER_LABEL[c.field.weather] : TERRAIN_LABEL[c.field.terrain]
  }
}

/** 내 세트 거부 안내: "내 스피드 계산 불가 · 슬로스타트" */
export function rejectionText(game: Snapshot, r: SpeedRejection, who: 'mine' | 'opponent'): { reason: string; cause: string } {
  const names = namesOf(game)
  const cause = r.field === 'ability' ? names.abilities.label(r.id) : names.items.label(r.id)
  const reason = r.kind === 'unsupported' ? '계산 불가' : '행동 순서 변경'
  return { reason: who === 'mine' ? (r.kind === 'unsupported' ? '내 스피드 계산 불가' : '내 행동 순서 변경') : reason, cause }
}

export const presetMark = (b: Pick<Badge, 'presetIndex'>): string | undefined => (b.presetIndex === undefined ? undefined : `프리셋 ${b.presetIndex + 1}`)

/** 배지 접근 이름: 이름 배분(성격 보정 글자) 조건, 실수치, 상태, 지닌 도구, 표지 */
export function badgeLabel(game: Snapshot, b: Badge, status: SpeedStatus | null): string {
  const names = namesOf(game)
  const tag = conditionTag(b.condition)
  const parts = [`${names.species.label(b.speciesId)} ${bundleSpoken(b.bundle.sp, b.bundle.nature)}${tag === undefined ? '' : ` ${tag}`}`, `실수치 ${b.speed}`]
  if (status !== null) parts.push(STATUS_LABEL[status])
  if (b.item !== null) parts.push(`${names.items.label(b.item)} 지님`)
  if (b.mega) parts.push('메가진화 폼')
  if (b.origin === 'added') parts.push('추가한 배분')
  const preset = presetMark(b)
  if (preset !== undefined) parts.push(preset)
  return parts.join(', ')
}

function minSpPart(r: MinSp, plus: boolean): string {
  switch (r.kind) {
    case 'ok':
      return plus ? `S${r.sp}↑` : `최소 S${r.sp}`
    case 'over-budget':
      return `${plus ? `S${r.sp}↑` : `최소 S${r.sp}`}(예산 초과 · 남은 SP ${r.remaining})`
    case 'impossible':
      return plus ? '상승 불가' : '무보정 불가'
  }
}

/** "추월: 최소 S20 / S12↑" · "추월: 무보정 불가 / S30↑" */
export function minSpText(r: { neutral: MinSp; plus: MinSp }): string {
  return `추월: ${minSpPart(r.neutral, false)} / ${minSpPart(r.plus, true)}`
}

/** 배지 클릭 뒤 열린 상세: 같은 배지면 닫고, 아니면 그 배지로 연다 */
export const toggleDetail = (open: string | null, clicked: string): string | null => (open === clicked ? null : clicked)

export interface SpeedBadgeHandlers {
  /** 배지 클릭(마우스·터치·Enter·Space)으로 여닫는다 */
  onToggle(id: string): void
  onKey(id: string, e: KeyboardEvent<HTMLButtonElement>): void
}
