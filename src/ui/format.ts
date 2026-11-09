// 탭 뷰 값 → 표시 문구. 판정·경계·n은 계산하지 않고 받은 값을 문장으로만 만든다.
import type { StatId } from '../data/schema'
import { CATEGORY_LABEL, ORDER_LABEL } from './labels'

export const STAT_SHORT: Record<StatId, string> = { hp: 'H', atk: 'A', def: 'B', spa: 'C', spd: 'D', spe: 'S' }

export const CARD_CATEGORY_LABEL: Record<'physical' | 'special', string> = { physical: '물리', special: '특수' }

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

/** 원천 사용률(0~1) → "12.34%" */
export const usageText = (usage: number): string => shareText(usage, 2)

const signed = (delta: number): string => (delta > 0 ? `+${delta}` : delta < 0 ? `${MINUS}${-delta}` : '±0')

export interface BoundaryLike {
  sp: number
  to: string
  delta: number
  need: number
}

/** 위쪽 경계 "A28부터 확정 1타(+8)", 아래쪽 경계 "H12까지 줄여도 확정 버팀(−4)". n이 있으면 "다른 능력치에서 n 필요"를 붙인다. */
export function boundaryText(stat: StatId, b: BoundaryLike): string {
  const need = b.need > 0 ? `, 다른 능력치에서 ${b.need} 필요` : ''
  const label = categoryLabel(b.to)
  const head = b.delta > 0 ? `${STAT_SHORT[stat]}${b.sp}부터 ${label}` : `${STAT_SHORT[stat]}${b.sp}까지 줄여도 ${label}`
  return `${head}(${signed(b.delta)}${need})`
}

/** "현재 A32 확정 1타" */
export function currentText(stat: StatId, sp: number, category: string | undefined): string {
  return category === undefined ? `현재 ${STAT_SHORT[stat]}${sp}` : `현재 ${STAT_SHORT[stat]}${sp} ${categoryLabel(category)}`
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

export function noChangeTitle(rows: number, cards: number): string {
  return `변화 없음 — 행 ${rows}개(카드 ${cards}장)`
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
