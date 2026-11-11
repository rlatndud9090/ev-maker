// 탭 뷰 값 → 표시 문구. 판정·경계·n은 계산하지 않고 받은 값을 문장으로만 만든다.
import type { StatId } from '../data/schema'
import { koLabel, type BandThresholds, type KoLabel, type KoSide } from '../core'
import { CATEGORY_LABEL, ORDER_LABEL } from './labels'

export const STAT_SHORT: Record<StatId, string> = { hp: 'H', atk: 'A', def: 'B', spa: 'C', spd: 'D', spe: 'S' }

const MINUS = '−'

/** 범주 id → 한국어 라벨(구간·행동 순서). 모르는 값은 원문. */
export function categoryLabel(category: string): string {
  if (Object.prototype.hasOwnProperty.call(CATEGORY_LABEL, category)) return CATEGORY_LABEL[category]
  if (Object.prototype.hasOwnProperty.call(ORDER_LABEL, category)) return ORDER_LABEL[category as keyof typeof ORDER_LABEL]
  return category
}

export type Tone = 'good' | 'mid' | 'bad'

/** 내 쪽에서 본 좋음/중간/나쁨. 색과 함께 기호·텍스트로도 구분한다. */
const TONE: Record<string, Tone> = {
  'guaranteed-ohko': 'good',
  'high-roll-ohko': 'mid',
  'mid-or-lower': 'bad',
  'guaranteed-survive': 'good',
  'low-roll-ohko': 'mid',
  'mid-or-higher': 'bad',
  first: 'good',
  tie: 'mid',
  second: 'bad',
}
export const TONE_SYMBOL: Record<Tone, string> = { good: '◎', mid: '△', bad: '×' }

export function categoryTone(category: string): Tone {
  return Object.prototype.hasOwnProperty.call(TONE, category) ? TONE[category] : 'mid'
}

export const categorySymbol = (category: string): string => TONE_SYMBOL[categoryTone(category)]

/** 0~1 비율 → "12.3%" */
export function shareText(share: number, digits = 1): string {
  return `${(share * 100).toFixed(digits)}%`
}

const signed = (delta: number): string => (delta > 0 ? `+${delta}` : delta < 0 ? `${MINUS}${-delta}` : '±0')

/** 랭크 변화 "+2"·"−1" */
export const rankText = (stage: number): string => signed(stage)

/** 판정 라벨(공격·방어 KoLabel은 결과 배지 문구, 스피드는 행동 순서) → 한국어 */
export function judgementText(label: string): string {
  if (Object.prototype.hasOwnProperty.call(KO_BADGE, label)) return KO_BADGE[label as KoLabel].label
  return categoryLabel(label)
}

export interface TargetLike {
  label: string
  stats: readonly { stat: StatId; sp: number }[]
  need: number
}

/** 목표 문구 "확정1타: 최소 A30 필요", "확정견딤: 최소 H4 B12 필요 (다른 능력치에서 4 필요)" */
export function targetText(t: TargetLike): string {
  const main = `${judgementText(t.label)}: 최소 ${t.stats.map((s) => `${STAT_SHORT[s.stat]}${s.sp}`).join(' ')} 필요`
  return t.need > 0 ? `${main} (다른 능력치에서 ${t.need} 필요)` : main
}

/** "현재 A32 확정1타". label은 목표 문구와 같은 판정 라벨(공격·방어 KoLabel, 스피드 행동 순서) — 한 줄에 같은 어휘만 쓴다. */
export function currentText(stat: StatId, sp: number, label: string | undefined): string {
  return label === undefined ? `현재 ${STAT_SHORT[stat]}${sp}` : `현재 ${STAT_SHORT[stat]}${sp} ${judgementText(label)}`
}

export const fixedText = (category: string): string => `항상 ${categoryLabel(category)}`

export interface BundleStatLike {
  stat: StatId
  sp: number
  nature: 'plus' | 'neutral' | 'minus'
}

const NATURE_MARK = { plus: '↑', neutral: '', minus: '↓' } as const

/** 묶음 관련 SP "H4 B12↑" (성격 보정은 ↑↓) */
export function bundleText(stats: readonly BundleStatLike[]): string {
  return stats.map((s) => `${STAT_SHORT[s.stat]}${s.sp}${NATURE_MARK[s.nature]}`).join(' ')
}

export interface SpanLike {
  sp: number
  category: string
  overBudget: boolean
}

export interface Span {
  from: number
  to: number
  category: string
  /** 이 구간에 예산 밖 칸이 섞여 있는지 */
  overBudget: boolean
}

/** 연속한 같은 범주 칸을 구간으로 묶는다(띠 범례). */
export function spansOf(cells: readonly SpanLike[]): Span[] {
  const out: Span[] = []
  for (const c of cells) {
    const last = out[out.length - 1]
    if (last !== undefined && last.category === c.category && last.to === c.sp - 1) {
      last.to = c.sp
      last.overBudget ||= c.overBudget
    } else {
      out.push({ from: c.sp, to: c.sp, category: c.category, overBudget: c.overBudget })
    }
  }
  return out
}

export const spanText = (s: Span): string => `${s.from === s.to ? s.from : `${s.from}~${s.to}`} ${categoryLabel(s.category)}`

export type KoBadgeTone = 'red' | 'orange' | 'yellow' | 'green' | 'gray'

export interface KoBadge {
  label: string
  tone: KoBadgeTone
}

const KO_BADGE: Record<KoLabel, KoBadge> = {
  'guaranteed-ohko': { label: '확정1타', tone: 'red' },
  'high-roll-ohko': { label: '고난수1타', tone: 'orange' },
  'mid-high-roll-ohko': { label: '중고난수1타', tone: 'orange' },
  'mid-low-roll-ohko': { label: '중저난수1타', tone: 'yellow' },
  'low-roll-ohko': { label: '저난수1타', tone: 'yellow' },
  'guaranteed-survive': { label: '확정견딤', tone: 'green' },
}

export interface KoCellLike {
  immune?: true
  ohkoChance?: number
}

/** 0<p<1 1타 확률 → "12.8%". 소수 첫째 자리 반올림 뒤 0.1%~99.9%로 고정해 확정(0·1)과 같은 숫자로 보이지 않게 한다. */
export function rollChanceText(p: number): string {
  const v = Math.min(99.9, Math.max(0.1, Math.round(p * 1000) / 10))
  return `${v.toFixed(1)}%`
}

/**
 * 대표 칸 → 카드 결과 배지. 문구는 p=1 "확정1타", p=0 "확정견딤", 그 사이 "난수1타: 12.8%", 무효 칸은 "무효".
 * 색은 코어 koLabel(thresholds) 단계를 따른다. 1타 확률이 없는 칸(스피드)은 배지 없음.
 */
export function koBadge(side: KoSide, cell: KoCellLike | undefined, thresholds: BandThresholds): KoBadge | undefined {
  if (cell === undefined) return undefined
  if (cell.immune) return { label: '무효', tone: 'gray' }
  const p = cell.ohkoChance
  if (p === undefined) return undefined
  const { tone } = KO_BADGE[koLabel(side, p, thresholds)]
  if (p >= 1) return { label: '확정1타', tone }
  if (p <= 0) return { label: '확정견딤', tone }
  return { label: `난수1타: ${rollChanceText(p)}`, tone }
}

/** 판정 기준 비율(n/steps) → 화면 입력 칸의 정수 n */
export const rollStepsOf = (ratio: number, steps: number): number => Math.round(ratio * steps)

/** 기준 입력 문자열 → 1~steps−1 정수, 그 밖(빈칸·소수·범위 밖·숫자 아님)은 undefined */
export function parseRollSteps(text: string, steps: number): number | undefined {
  const t = text.trim()
  if (!/^\d+$/.test(t)) return undefined
  const n = Number(t)
  return n >= 1 && n <= steps - 1 ? n : undefined
}

const ORDER_TONE: Record<keyof typeof ORDER_LABEL, KoBadgeTone> = { first: 'green', tie: 'yellow', second: 'red' }

/** 스피드 탭 대표 칸 → 행동 순서 배지("선공"·"동속"·"후공"). 결과 배지가 없는 탭에서 현재 판정을 글자로 보인다. 그 밖 범주·칸 없음은 배지 없음. */
export function orderBadge(cell: { category: string } | undefined): KoBadge | undefined {
  if (cell === undefined || !Object.prototype.hasOwnProperty.call(ORDER_TONE, cell.category)) return undefined
  const order = cell.category as keyof typeof ORDER_LABEL
  return { label: ORDER_LABEL[order], tone: ORDER_TONE[order] }
}

export function progressText(done: number, total: number, complete: boolean): string {
  return complete ? `계산 완료 ${done}/${total}` : `계산 중 ${done}/${total}`
}

/** 0~1 비율 → 화면 % 숫자(소수 첫째 자리까지) */
export const toPercentInput = (ratio: number): string => String(Math.round(ratio * 1000) / 10)

/** 화면 % 문자열 → 0~1 비율. 빈칸·숫자 아님은 NaN(리듀서가 무시한다). */
export function fromPercentInput(text: string): number {
  if (text.trim() === '') return NaN
  return Number(text) / 100
}

export interface RefsLike {
  offense: { owner: 'self' | 'target'; stat: 'atk' | 'spa' | 'def' } | null
  defense: 'def' | 'spd' | null
}

/** 기술 분류와 실제 참조 능력치가 다를 때만 붙이는 메모(예: 사이코쇼크 "상대 B 참조"). user는 그 기술을 쓰는 쪽. */
export function refsNote(category: 'Physical' | 'Special' | 'Status', refs: RefsLike, user: 'me' | 'opponent'): string | undefined {
  if (category === 'Status') return undefined
  const [self, other] = user === 'me' ? ['내', '상대'] : ['상대', '내']
  const notes: string[] = []
  const offense = category === 'Physical' ? 'atk' : 'spa'
  const defense = category === 'Physical' ? 'def' : 'spd'
  if (refs.offense?.owner === 'target') notes.push(`${other} ${STAT_SHORT[refs.offense.stat]}로 공격`)
  else if (refs.offense && refs.offense.stat !== offense) notes.push(`${self} ${STAT_SHORT[refs.offense.stat]}로 공격`)
  if (refs.defense && refs.defense !== defense) notes.push(`${other} ${STAT_SHORT[refs.defense]} 참조`)
  return notes.length > 0 ? notes.join(', ') : undefined
}
