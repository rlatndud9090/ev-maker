// 컷 고정 화면 문구(순수 함수). 갈래·예산·상태 값은 cards 파생 결과를 그대로 받아 글자로만 바꾼다.
import { BASE_CONDITION_ID, bundleLabel, bundleSpoken, minSumWithFloors, type CutLock, type LockCheck, type LockDerivation } from '../../cards'
import type { AdjustAllocation, AdjustNature, AdjustOption, AdjustResult, AdjustStat, LockCandidate, LockResolution, LockStage, LockStatus, SpeedBranchLine, SpeedBranchOption, SpeedLockCandidate, Tab } from '../../cards'
import type { Snapshot, StatId } from '../../data/schema'
import { STAT_SHORT, bundleText, categoryBadge, judgementText, type BundleStatLike, type KoBadge } from '../../ui/format'
import { namesOf } from '../../ui/names'
import type { LockTrim } from '../state'
import type { LockCheckView } from '../lockContext'

type Slot = SpeedBranchOption | null | 'omitted'

export const LOCK_NAME = '컷 고정'
export const DROP_WARNING_TEXT = '하락 위치에 따라 달라질 수 있음'
export const NO_DROP_SLOT_TEXT = '이 갈래는 하락 자리 없음'
export const OUTSIDE_FILTER_TEXT = '이 컷의 상대는 지금 표시 필터 밖입니다'
/** 고정 능력치 SP 줄 표지(읽기 설명·툴팁) */
export const LOCKED_SP_TEXT = '고정됨'
export const LOCKED_MINUS_TEXT = '고정 능력치에는 하락을 둘 수 없음'
/** 고정 줄 ▲ 비활성 사유: 켤 갈래("상승이 그 능력치") 없음 · 끌 갈래("상승이 고정 밖") 없음 */
export const NO_PLUS_BRANCH_TEXT = '상승으로 닿는 선택지 없음'
export const NO_NEUTRAL_BRANCH_TEXT = '상승 없이 닿는 선택지 없음'
/** 고정 밖 줄 ▲ 비활성 사유("상승이 고정 밖" 갈래 없음) */
export const NO_OUT_PLUS_TEXT = '고정에 상승이 필요해 고정 밖 상승 불가'
export const BASE_MARK_TEXT = '표 기준'
export const NATURE_CONFLICT_DETAIL = '상승이 필요한 고정이 겹침'

const PLUS_MARK = '+'

/** "S12+" · "S20" · "H4" */
const spText = (stat: StatId, sp: number, plus: boolean): string => `${STAT_SHORT[stat]}${sp}${plus ? PLUS_MARK : ''}`
const spSpoken = (stat: StatId, sp: number, plus: boolean): string => `${STAT_SHORT[stat]} ${sp}${plus ? ' 상승' : ''}`

/** 고정 해석의 선택지 SP(상승안 먼저) "S12+ / S20" · "H2 B8+ / H4 B16"(쌍은 H 0부터 최소 합 점). 닿는 선택지·해석이 없으면 undefined */
export function lockOptionText(resolution: LockResolution | undefined): string | undefined {
  if (resolution?.kind !== 'ok') return undefined
  const o = resolution.options
  const parts: (string | undefined)[] = []
  if (o.shape === 'single') {
    parts.push(o.plus === null ? undefined : spText(o.stat, o.plus, o.stat !== 'hp'), o.neutral === null ? undefined : spText(o.stat, o.neutral, false))
  } else {
    const point = (stairs: typeof o.neutral, plus: boolean): string | undefined => {
      const p = stairs === null ? null : minSumWithFloors(stairs, { hp: 0, defense: 0 })
      return p === null ? undefined : `${spText('hp', p.hp, false)} ${spText(o.defense, p.defense, plus)}`
    }
    parts.push(point(o.plus, true), point(o.neutral, false))
  }
  const shown = parts.filter((p): p is string => p !== undefined)
  return shown.length === 0 ? undefined : shown.join(' / ')
}

/** 갈래마다 다른 고정 능력치 값(상승 갈래 먼저, 같은 값은 한 번). 내 세트 고정 줄의 읽기 설명 "S12+ / S20" */
export function lockedStatText(derivation: LockDerivation, stat: StatId): string {
  const seen = new Set<string>()
  const parts: string[] = []
  const ordered = [...derivation.branches].sort((a, b) => Number(b.plus === stat) - Number(a.plus === stat))
  for (const b of ordered) {
    const t = spText(stat, b.lockedSp[stat] ?? 0, b.plus === stat)
    if (seen.has(t)) continue
    seen.add(t)
    parts.push(t)
  }
  return parts.length === 0 ? STAT_SHORT[stat] : parts.join(' / ')
}

/** 줄 앞 고정 조건 "S12+일 때:" · "A20 · S12+일 때:" */
export function branchConditionText(line: Pick<SpeedBranchLine, 'condition'>): string {
  return `${line.condition.map((c) => spText(c.stat, c.sp, c.plus)).join(' · ')}일 때:`
}

export function branchConditionSpoken(line: Pick<SpeedBranchLine, 'condition'>): string {
  return `${line.condition.map((c) => spSpoken(c.stat, c.sp, c.plus)).join(', ')}일 때`
}

/** 갈래 줄 선택지의 예산 표지. fits는 없음 */
export function budgetText(budget: SpeedBranchOption['budget']): string | undefined {
  switch (budget.kind) {
    case 'fits':
      return undefined
    case 'need':
      return `(다른 능력치에서 ${budget.n} 필요)`
    case 'short':
      return spShortText(budget.m)
  }
}

export const spShortText = (over: number): string => `SP 부족(${over})`

const defaultLabel = (tab: Tab): string | undefined => (tab === 'speed' ? 'first' : undefined)

/** 상승 선택지는 H가 아닌 능력치에 '+'(방어 쌍 "H2 B8+") */
function optionText(o: SpeedBranchOption, plus: boolean): string {
  const sps = o.stats.map((s) => spText(s.stat, s.sp, plus && s.stat !== 'hp')).join(' ')
  const notes = [o.byLock === true ? '(고정으로 충족)' : undefined, budgetText(o.budget)].filter((n): n is string => n !== undefined)
  return [plus ? sps : `최소 ${sps}`, ...notes].join(' ')
}

function omittedPlusText(line: SpeedBranchLine): string {
  return line.omittedPlusStat === undefined ? '상승은 고정 밖' : `상승은 ${STAT_SHORT[line.omittedPlusStat]}에`
}

function slotText(line: SpeedBranchLine, slot: Slot, plus: boolean): string | undefined {
  if (slot === 'omitted') return plus ? omittedPlusText(line) : undefined
  if (slot === null) return plus ? '상승 불가' : '무보정 불가'
  return optionText(slot, plus)
}

/** 선택지 부분 "확정견딤 최소 H4 B16 / H2 B8+" · "확정견딤 최소 H4 B12 / 상승은 S에" */
export function branchTargetText(line: SpeedBranchLine, tab: Tab): string {
  if (line.status === 'no-drop-slot') return NO_DROP_SLOT_TEXT
  if (line.status === 'pending') return '계산 중…'
  const { neutral, plus } = line
  const label = line.label ?? (typeof neutral === 'object' && neutral !== null ? neutral.label : typeof plus === 'object' && plus !== null ? plus.label : defaultLabel(tab))
  const options = [slotText(line, neutral, false), slotText(line, plus, true)].filter((t): t is string => t !== undefined).join(' / ')
  return label === undefined ? options : `${judgementText(label)} ${options}`
}

/** 갈래 줄 전체 "S12+일 때: 확정견딤 최소 H4 B12 / 상승은 S에" */
export function branchLineText(line: SpeedBranchLine, tab: Tab): string {
  return `${branchConditionText(line)} ${branchTargetText(line, tab)}`
}

function optionSpoken(o: SpeedBranchOption, plus: boolean): string {
  const sps = o.stats.map((s) => spSpoken(s.stat, s.sp, plus && s.stat !== 'hp')).join(' ')
  const notes = [o.byLock === true ? '고정으로 충족' : undefined, budgetText(o.budget)].filter((n): n is string => n !== undefined)
  return [plus ? `상승 ${sps}` : `무보정 최소 ${sps}`, ...notes].join(', ')
}

/** 갈래 줄 읽기 이름(기준 갈래면 "표 기준" 포함) */
export function branchLineSpoken(line: SpeedBranchLine, tab: Tab): string {
  const head = branchConditionSpoken(line)
  const tail = line.isBase ? `, ${BASE_MARK_TEXT}` : ''
  if (line.status !== 'ok') return `${head}, ${branchTargetText(line, tab)}${tail}`
  const { neutral, plus } = line
  const label = line.label ?? (typeof neutral === 'object' && neutral !== null ? neutral.label : typeof plus === 'object' && plus !== null ? plus.label : defaultLabel(tab))
  const spoken = (slot: Slot, isPlus: boolean): string | undefined =>
    slot === 'omitted' || slot === null ? slotText(line, slot, isPlus) : optionSpoken(slot, isPlus)
  const parts = [spoken(neutral, false), spoken(plus, true)].filter((t): t is string => t !== undefined)
  return [head, ...(label === undefined ? [] : [judgementText(label)]), ...parts].join(', ') + tail
}

export interface StatusText {
  text: string
  /** 읽기 설명·툴팁용 보충 */
  detail?: string
}

const UNREACHABLE_REASON: Readonly<Record<string, string>> = {
  'non-monotonic': '판정이 SP를 따라 고르게 바뀌지 않음',
  'speed-unsupported': '내 스피드 계산 불가',
}

/** 고정 상태 칩. active는 없음. 사유가 붙은 도달 불가는 "계산 불가" */
export function lockStatusText(status: LockStatus): StatusText | undefined {
  switch (status.kind) {
    case 'active':
      return undefined
    case 'set-error':
      return { text: '계산 불가', detail: '내 세트 오류' }
    case 'missing':
      return { text: '대상 없음' }
    case 'unreachable':
      return status.reason === undefined ? { text: '도달 불가' } : { text: '계산 불가', detail: UNREACHABLE_REASON[status.reason] ?? status.reason }
    case 'nature-conflict':
      return { text: '성격 충돌', detail: NATURE_CONFLICT_DETAIL }
    case 'sp-short':
      return { text: spShortText(status.over) }
  }
}

export const statusSpoken = (s: StatusText): string => (s.detail === undefined ? s.text : `${s.text}: ${s.detail}`)

/** 고정 조작 비활성 사유(ok는 없음). computing은 비활성이 아니라 "계산 중" */
export function lockCheckText(check: LockCheckView | LockCheck): StatusText | undefined {
  switch (check.kind) {
    case 'ok':
      return undefined
    case 'computing':
      return { text: '계산 중' }
    case 'sp-short':
      return { text: spShortText(check.over) }
    case 'nature-conflict':
      return { text: '성격 충돌', detail: NATURE_CONFLICT_DETAIL }
    case 'unreachable':
      return { text: '도달 불가' }
  }
}

const BLOCKED_TEXT: Readonly<Record<'depends-other-stat' | 'fixed-value' | 'unreachable-stage' | 'no-target' | SpeedBlocked, string>> = {
  'depends-other-stat': '다른 능력치에도 의존해 고정 불가',
  'fixed-value': 'SP와 무관한 판정이라 고정 불가',
  'unreachable-stage': '고정할 단계에 닿지 않아 고정 불가',
  'no-target': '고정할 판정이 없음',
  'set-error': '내 세트 오류로 고정 불가',
  'speed-unsupported': '내 스피드 계산 불가로 고정 불가',
}
type SpeedBlocked = Extract<SpeedLockCandidate, { kind: 'blocked' }>['reason']

/** 고정할 수 없는 컷의 짧은 이유 */
export const blockedText = (reason: keyof typeof BLOCKED_TEXT): string => BLOCKED_TEXT[reason]

/** 후보 해석의 선택지 SP "최소 C20 / C12+" · "최소 H4 B16 / H2 B8+"(쌍은 H 0부터 최소 합 점). 닿는 선택지가 없으면 undefined */
export function candidateOptionsText(resolution: LockResolution): string | undefined {
  if (resolution.kind !== 'ok') return undefined
  const o = resolution.options
  const parts: string[] = []
  if (o.shape === 'single') {
    if (o.neutral !== null) parts.push(`최소 ${spText(o.stat, o.neutral, false)}`)
    if (o.plus !== null) parts.push(spText(o.stat, o.plus, o.stat !== 'hp'))
  } else {
    const point = (stairs: typeof o.neutral, plus: boolean): string | undefined => {
      const p = stairs === null ? null : minSumWithFloors(stairs, { hp: 0, defense: 0 })
      return p === null ? undefined : `${spText('hp', p.hp, false)} ${spText(o.defense, p.defense, plus)}`
    }
    const neutral = point(o.neutral, false)
    const plus = point(o.plus, true)
    if (neutral !== undefined) parts.push(`최소 ${neutral}`)
    if (plus !== undefined) parts.push(plus)
  }
  return parts.length === 0 ? undefined : parts.join(' / ')
}

export interface PinStageView {
  stage: LockStage
  label: string
  /** 선택지 SP 또는 고를 수 없는 이유 */
  detail: string
  /** 있으면 고를 수 있고, 고르면 이 고정을 더한다 */
  lock?: Omit<CutLock, 'seq'>
}

/** 핀 단계 메뉴 항목 하나: 후보를 지금 고정에 더해 본 결과(check). 계산 중 후보는 "계산 중" */
export function pinStageView(stage: LockStage, candidate: LockCandidate | SpeedLockCandidate, check: (c: LockCandidate) => LockCheckView): PinStageView {
  const label = judgementText(stage)
  if (candidate.kind === 'blocked') return { stage, label, detail: blockedText(candidate.reason) }
  const c = check(candidate)
  if (c.kind === 'ok' && candidate.kind === 'ready') return { stage, label, detail: candidateOptionsText(candidate.resolution) ?? '', lock: candidate.lock }
  return { stage, label, detail: lockCheckText(c)?.text ?? '' }
}

/** 카드 줄 핀의 읽기 이름 "컷 고정: 한카리아스" · "컷 고정 해제: 한카리아스" */
export const pinLabel = (subject: string, locked: boolean): string => `${LOCK_NAME}${locked ? ' 해제' : ''}: ${subject}`

/** "S 32 → 20(합계 66 초과로 줄임)" */
export const trimText = (trim: LockTrim, spTotal: number): string => `${STAT_SHORT[trim.stat]} ${trim.from} → ${trim.to}(합계 ${spTotal} 초과로 줄임)`

export const trimsText = (trims: readonly LockTrim[], spTotal: number): string => trims.map((t) => trimText(t, spTotal)).join(', ')

export const overTotalText = (over: number, spTotal: number): string => `SP 합계 ${spTotal}을 ${over} 넘음`

function speedConditionText(game: Snapshot, condition: string): string | undefined {
  if (condition === 'none') return undefined
  if (condition === 'scarf') return '스카프'
  if (condition === 'tailwind') return '순풍'
  if (condition.startsWith('rank:')) return `+${condition.slice('rank:'.length)}`
  if (condition.startsWith('field:')) return namesOf(game).abilities.label(condition.slice('field:'.length))
  return condition
}

function damageConditionText(game: Snapshot, itemKey: string): { move?: string; condition?: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(itemKey)
  } catch {
    return {}
  }
  if (!Array.isArray(parsed) || typeof parsed[0] !== 'string') return {}
  const names = namesOf(game)
  const move = names.moves.label(parsed[0])
  const conditionId = typeof parsed[1] === 'string' ? parsed[1] : BASE_CONDITION_ID
  if (conditionId === BASE_CONDITION_ID) return { move }
  let c: unknown
  try {
    c = JSON.parse(conditionId)
  } catch {
    return { move }
  }
  if (!Array.isArray(c)) return { move }
  if (c[0] === 'faint' && typeof c[1] === 'number') return { move, condition: `${c[1]}기절` }
  if (c[0] === 'rank' && typeof c[3] === 'string') return { move, condition: `${c[2] === 'ability' ? names.abilities.label(c[3]) : names.moves.label(c[3])} 후` }
  return { move }
}

/** 고정 목록 항목 설명 "한카리아스 S32↑ 스카프" · "한카리아스 · 지진 · 확정견딤". 스피드 컷은 선공뿐이라 단계 라벨을 붙이지 않는다 */
export function lockDescription(game: Snapshot, lock: Pick<CutLock, 'target' | 'stage'>): string {
  const names = namesOf(game)
  const t = lock.target
  if (t.kind === 'speed') {
    const bundle = 'preset' in t.bundle ? `프리셋 ${t.bundle.preset + 1}` : bundleLabel(t.bundle.sp, t.bundle.nature)
    const cond = speedConditionText(game, t.condition)
    return [names.species.label(t.opponentId), bundle, cond].filter((p) => p !== undefined).join(' ')
  }
  const stage = judgementText(lock.stage)
  const { move, condition } = damageConditionText(game, t.itemKey)
  const item = t.item === null ? undefined : `${names.items.label(t.item)} 지님`
  return [names.species.label(t.opponentId), item, [move, condition].filter((p) => p !== undefined).join(' ') || undefined, stage]
    .filter((p) => p !== undefined)
    .join(' · ')
}

/** 구애스카프(스피드 조건 'scarf'의 도구) */
const SCARF_ITEM = 'choicescarf'

export interface LockSubjectView {
  speciesId: string
  /** 툴팁·읽기용 상대 이름 */
  speciesName: string
  /** 배분 표기 "S32↑" · "A32↑ S4" · "프리셋 1"(관련 SP가 없으면 없음) */
  bundle?: string
  /** 판정에 관여한 도구(공·방 도구 변형 줄의 도구, 스피드 스카프 조건) */
  item?: { id: string; name: string }
  /** 공·방 기술·조건 "지진" · "인파이트 1기절", 스피드 조건 "순풍" · "+1"(스카프는 도구 이미지라 없음) */
  note?: string
  /** 공·방 단계의 결과 배지(카드 결과 배지와 같은 문구·색). 스피드는 없음 */
  badge?: KoBadge
}

function parseBundleStats(key: string): readonly BundleStatLike[] | undefined {
  try {
    const v = JSON.parse(key) as unknown
    return Array.isArray(v) ? (v as BundleStatLike[]) : undefined
  } catch {
    return undefined
  }
}

/** 고정 목록 항목의 보이는 부분: 상대 이미지 · 배분 · 관여 도구 이미지 · 기술/조건 · 단계 배지 */
export function lockSubjectView(game: Snapshot, lock: Pick<CutLock, 'target' | 'stage'>): LockSubjectView {
  const names = namesOf(game)
  const t = lock.target
  const base = { speciesId: t.opponentId, speciesName: names.species.label(t.opponentId) }
  const itemOf = (id: string | null) => (id === null ? undefined : { id, name: names.items.label(id) })
  if (t.kind === 'speed') {
    const bundle = 'preset' in t.bundle ? `프리셋 ${t.bundle.preset + 1}` : bundleLabel(t.bundle.sp, t.bundle.nature)
    const scarf = t.condition === 'scarf'
    return { ...base, bundle, item: itemOf(scarf ? SCARF_ITEM : null), note: scarf ? undefined : speedConditionText(game, t.condition) }
  }
  const stats = 'preset' in t.bundle ? undefined : parseBundleStats('ladder' in t.bundle ? t.bundle.ladder : t.bundle.added)
  const bundle = 'preset' in t.bundle ? `프리셋 ${t.bundle.preset + 1}` : stats === undefined || stats.length === 0 ? undefined : bundleText(stats)
  const { move, condition } = damageConditionText(game, t.itemKey)
  const note = [move, condition].filter((p) => p !== undefined).join(' ') || undefined
  return { ...base, bundle, item: itemOf(t.item), note, badge: categoryBadge(lock.stage) }
}

/** 고정 목록 항목 읽기 이름(배분 성격 보정은 말로) */
export function lockDescriptionSpoken(game: Snapshot, lock: Pick<CutLock, 'target' | 'stage'>): string {
  return `${LOCK_NAME}: ${lockSubjectSpoken(game, lock)}`
}

/** 고정 대상·단계의 읽기 문구(이름 접두 없음, 해제 버튼 읽기 이름용) */
export function lockSubjectSpoken(game: Snapshot, lock: Pick<CutLock, 'target' | 'stage'>): string {
  const t = lock.target
  if (t.kind !== 'speed' || 'preset' in t.bundle) return lockDescription(game, lock)
  const names = namesOf(game)
  const cond = speedConditionText(game, t.condition)
  return [names.species.label(t.opponentId), bundleSpoken(t.bundle.sp, t.bundle.nature), cond].filter((p) => p !== undefined).join(' ')
}

// ---------- 변동 팝오버 ----------

export const ADJUST_NAME = '변동'
export const ADJUST_RESULTS_TITLE = '변동할 결과'
export const ADJUST_NATURE_TITLE = '성격 선택'
export const ADJUST_BACK_TEXT = '뒤로'
export const ADJUST_COMPUTING_TEXT = '계산 중…'
export const ADJUST_EMPTY_TEXT = '예산 안에서 닿는 결과 없음'
export const ADJUST_LOCKED_TEXT = '고정된 능력치라 변동할 수 없음'
/** 방어 쌍 성격 선택지 안의 두 배분 이름(H 최대가 합 최소와 같으면 이름 없이 하나만) */
export const ADJUST_ALLOCATION_TEXT: Readonly<Record<AdjustAllocation, string>> = { 'min-sum': '합 최소', 'h-max': 'H 최대' }
/** 고정 능력치 SP 뒤 읽기 표지("S 29 고정") */
export const ADJUST_LOCKED_STAT_TEXT = '고정'

/** 변동 버튼 읽기 이름 "변동: 한카리아스" */
export const adjustLabel = (subject: string): string => `${ADJUST_NAME}: ${subject}`

type AdjustOff = Extract<AdjustOption, { kind: 'off' }>

const ADJUST_OFF_TEXT: Readonly<Record<AdjustOff['reason'], string>> = {
  budget: 'SP 부족',
  unreachable: '닿지 않음',
  'no-branch': '고정과 겹침',
}

/** 고를 수 없는 성격 선택지의 짧은 이유 */
export const adjustOffText = (option: AdjustOff): string => ADJUST_OFF_TEXT[option.reason]

/** 성격 선택지 이름: "무보정" · "C 상승" · 방어 3방향(반대쪽 상승 선택지가 있음)은 "B 보정"/"D 보정" */
export function adjustNatureName(natures: readonly AdjustNature[], nature: AdjustNature): string {
  if (nature.plus === null) return '무보정'
  const threeWay = natures.some((n) => n.id === 'other-plus')
  return `${STAT_SHORT[nature.plus]} ${threeWay ? '보정' : '상승'}`
}

/** 능력치 SP 하나 "C20+" · "H20"(고정 표지는 화면이 붙인다) */
export const adjustStatText = (s: AdjustStat): string => spText(s.stat, s.sp, s.plus)

/** 선택지 SP 한 줄 "H20 B12 D16" */
export const adjustStatsText = (stats: readonly AdjustStat[]): string => stats.map(adjustStatText).join(' ')

/** 선택지 SP 읽기 "C 20 상승, S 29 고정" */
export const adjustStatsSpoken = (stats: readonly AdjustStat[]): string =>
  stats.map((s) => `${spSpoken(s.stat, s.sp, s.plus)}${s.locked ? ` ${ADJUST_LOCKED_STAT_TEXT}` : ''}`).join(', ')

/** 결과 항목의 SP 표기에 쓰는 선택지(lead)의 능력치. lead가 고를 수 없으면 빈 목록 */
export function leadStats(result: AdjustResult): readonly AdjustStat[] {
  const o = result.options[result.lead]
  // 방어 쌍은 H 최대 배분이 있으면 그것을 대표로 보인다(같은 내구면 H에 몰아 양내구, 사용자 결정 2026-11-20)
  return o?.kind === 'ok' ? (o.hMax ?? o.stats) : []
}

/** 1단 메뉴 이름 "변동할 결과: 한카리아스" */
export const adjustResultsLabel = (subject: string): string => `${ADJUST_RESULTS_TITLE}: ${subject}`

/** 2단 메뉴 이름 "성격 선택: 확정1타 C 28" */
export const adjustNaturesLabel = (resultLabel: string, stats: readonly AdjustStat[]): string =>
  `${ADJUST_NATURE_TITLE}: ${[resultLabel, adjustStatsSpoken(stats)].filter((p) => p !== '').join(' ')}`
