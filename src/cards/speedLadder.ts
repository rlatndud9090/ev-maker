// 스피드 차트 응용 로직: 기준선·상태, 조건 필터, 같은 줄 순서, 사다리 줄, 최소 S, 키보드 탐색, 배분 표기. 화면 없는 순수 함수다.
import { CoreError, CoreInputError, finalSpeed, minSpToOutspeed, speedSupport, validateSet, type EvalOptions, type OutspeedResult, type PokemonSet, type SpeedRejection } from '../core'
import type { Snapshot } from '../data/schema'
import { natureSign } from './bundles'
import { natureVariants } from './natures'
import type { NatureSign, SpeedBadge, SpeedChartModel } from './speedChart'
import type { SpeedConditionFilters } from './types'

export type SpeedStatus = 'outspeeds' | 'tie' | 'outsped'

export type SpeedBaseline =
  | { kind: 'ok'; speed: number; sp: number; nature: NatureSign; tailwind: boolean }
  | { kind: 'rejected'; rejection: SpeedRejection }
  /** 세트 자체 오류(내 세트 패널이 안내) */
  | { kind: 'invalid' }

/** 랭크를 지운 내 세트. 세트 자체 오류면 null, 스피드 거부면 원인 */
export function checkedMySet(game: Snapshot, mySet: PokemonSet, options?: EvalOptions): { set: PokemonSet } | { rejection: SpeedRejection } | null {
  const set = { ...mySet }
  delete set.boosts
  try {
    validateSet(game, set, options)
    const rejection = speedSupport(game, set, options)
    return rejection === null ? { set } : { rejection }
  } catch (e) {
    if (e instanceof CoreError || e instanceof CoreInputError) return null
    throw e
  }
}

/** 내 현재 배분의 실수치(날씨·필드 없음, 내 순풍만 반영) */
export function speedBaseline(game: Snapshot, mySet: PokemonSet, myTailwind: boolean, options?: EvalOptions): SpeedBaseline {
  const checked = checkedMySet(game, mySet, options)
  if (checked === null) return { kind: 'invalid' }
  if ('rejection' in checked) return { kind: 'rejected', rejection: checked.rejection }
  const { set } = checked
  return {
    kind: 'ok',
    speed: finalSpeed(game, set, { attacker: { tailwind: myTailwind } }, 'attacker', options),
    sp: set.sp.spe,
    nature: natureSign(game, set.nature, 'spe'),
    tailwind: myTailwind,
  }
}

/** 기준선이 ok가 아니면 null(중립) */
export function statusOf(badgeSpeed: number, baseline: SpeedBaseline): SpeedStatus | null {
  if (baseline.kind !== 'ok') return null
  return badgeSpeed < baseline.speed ? 'outspeeds' : badgeSpeed === baseline.speed ? 'tie' : 'outsped'
}

/** 기본·추가 배지는 늘 보이고, 조건 배지는 그 종류 필터가 켜졌을 때만 */
export function visibleBadges(model: SpeedChartModel, filters: SpeedConditionFilters): SpeedBadge[] {
  return model.badges.filter((b) => b.filterKind === null || filters[b.filterKind])
}

/** 0 = 래더 상대 배지(기본·조건·묶음 추가·직접 입력), 1 = 목록 밖 타겟 추가 배지, 2 = 목록 밖 타겟 프리셋 배지 */
const rowTier = (b: SpeedBadge): number => (b.source === 'ladder' ? 0 : b.origin === 'preset' ? 2 : 1)

/**
 * 같은 실수치 줄 안 순서: 래더 상대 배지(사용률 순위 오름 → 점유율 있는 배지 먼저·점유율 내림 → 기본 먼저 → 직접 입력은 추가 순)
 * → 목록 밖 타겟 추가 배지(추가 순) → 목록 밖 타겟 프리셋(추가 순 → 프리셋 순 → 기본 먼저). 마지막은 id 순.
 */
export function compareInRow(): (a: SpeedBadge, b: SpeedBadge) => number {
  const conditional = (b: SpeedBadge): number => (b.condition.kind === 'none' ? 0 : 1)
  const byId = (a: SpeedBadge, b: SpeedBadge): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  const shareOf = (b: SpeedBadge): number => b.bundle.share ?? -1
  return (a, b) => {
    const ta = rowTier(a)
    const tb = rowTier(b)
    if (ta !== tb) return ta - tb
    if (ta === 0) {
      return (
        a.usageRank - b.usageRank ||
        shareOf(b) - shareOf(a) ||
        conditional(a) - conditional(b) ||
        (a.addedOrder ?? 0) - (b.addedOrder ?? 0) ||
        byId(a, b)
      )
    }
    if (ta === 1) return (a.addedOrder ?? 0) - (b.addedOrder ?? 0) || byId(a, b)
    return (a.addedOrder ?? 0) - (b.addedOrder ?? 0) || (a.presetIndex ?? 0) - (b.presetIndex ?? 0) || conditional(a) - conditional(b) || byId(a, b)
  }
}

/** baseline = 내 실수치 줄(배지가 없으면 badgeIds가 빈 줄) */
export interface LadderRow {
  speed: number
  badgeIds: readonly string[]
  baseline: boolean
}

/** 실수치 내림차순 줄. baselineSpeed null(내 세트 거부·무효)이면 기준선 줄이 없다 */
export function ladderRows(badges: readonly SpeedBadge[], baselineSpeed: number | null, cmp: (a: SpeedBadge, b: SpeedBadge) => number): LadderRow[] {
  const bySpeed = new Map<number, SpeedBadge[]>()
  for (const b of badges) {
    const list = bySpeed.get(b.speed) ?? []
    list.push(b)
    bySpeed.set(b.speed, list)
  }
  if (baselineSpeed !== null && !bySpeed.has(baselineSpeed)) bySpeed.set(baselineSpeed, [])
  const speeds = [...bySpeed.keys()].sort((a, b) => b - a)
  return speeds.map((speed) => ({
    speed,
    badgeIds: [...(bySpeed.get(speed) ?? [])].sort(cmp).map((b) => b.id),
    baseline: speed === baselineSpeed,
  }))
}

export type MinSp = OutspeedResult

export interface MinSpOptions extends EvalOptions {
  /** 두 변형 성격 id. plus null = 상승 변형 없음(결과 plus도 null) */
  natures?: { neutral: string; plus: string | null }
}

/**
 * 배지 실수치(target)를 엄격히 앞지르는 내 최소 S SP. 성격은 S 무보정·상승 두 변형(natures가 있으면 그 성격), 도구·특성·내 순풍은 기준선과 같고 날씨·필드는 없다.
 * 내 세트가 무효이거나 스피드 거부면 null.
 */
export function minSpToPass(game: Snapshot, mySet: PokemonSet, target: number, myTailwind: boolean): { neutral: MinSp; plus: MinSp } | null
export function minSpToPass(game: Snapshot, mySet: PokemonSet, target: number, myTailwind: boolean, options: MinSpOptions): { neutral: MinSp; plus: MinSp | null } | null
export function minSpToPass(game: Snapshot, mySet: PokemonSet, target: number, myTailwind: boolean, options?: MinSpOptions): { neutral: MinSp; plus: MinSp | null } | null {
  const evalOptions: EvalOptions | undefined = options?.ignoreSpTotal === undefined ? undefined : { ignoreSpTotal: options.ignoreSpTotal }
  const checked = checkedMySet(game, mySet, evalOptions)
  if (checked === null || 'rejection' in checked) return null
  const { set } = checked
  const v = options?.natures ?? natureVariants(game, set.nature, 'spe', [])
  const conditions = { attacker: { tailwind: myTailwind } }
  return {
    neutral: minSpToOutspeed(game, { ...set, nature: v.neutral }, target, conditions, evalOptions),
    plus: v.plus === null ? null : minSpToOutspeed(game, { ...set, nature: v.plus }, target, conditions, evalOptions),
  }
}

export type NavKey = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End'

function locate(rows: readonly (readonly string[])[], id: string): { r: number; i: number } | null {
  for (let r = 0; r < rows.length; r++) {
    const i = rows[r].indexOf(id)
    if (i >= 0) return { r, i }
  }
  return null
}

const badgeRows = (rows: readonly LadderRow[]): (readonly string[])[] => rows.map((r) => r.badgeIds).filter((ids) => ids.length > 0)

/**
 * 다음 포커스 배지 id. 위아래 = 이웃 배지 줄의 같은 순번(없으면 그 줄 마지막), 좌우 = 같은 줄 이웃, Home/End = 첫 줄 첫 배지·마지막 줄 마지막 배지.
 * 배지 없는 기준선 줄은 건너뛴다. 끝에서는 제자리, currentId가 없으면 첫 배지.
 */
export function navigate(rows: readonly LadderRow[], currentId: string, key: NavKey): string {
  const list = badgeRows(rows)
  if (list.length === 0) return currentId
  const first = list[0][0]
  const lastRow = list[list.length - 1]
  if (key === 'Home') return first
  if (key === 'End') return lastRow[lastRow.length - 1]
  const at = locate(list, currentId)
  if (at === null) return first
  const row = list[at.r]
  switch (key) {
    case 'ArrowLeft':
      return row[Math.max(0, at.i - 1)]
    case 'ArrowRight':
      return row[Math.min(row.length - 1, at.i + 1)]
    case 'ArrowUp':
    case 'ArrowDown': {
      const next = list[at.r + (key === 'ArrowUp' ? -1 : 1)]
      return next === undefined ? currentId : next[Math.min(at.i, next.length - 1)]
    }
  }
}

/** 지운 배지(지우기 전 rows 기준) 다음 포커스: 같은 줄 다음 → 같은 줄 앞 → 아랫줄 → 윗줄(같은 순번, 없으면 그 줄 마지막). 없으면 null */
export function focusAfterRemove(rows: readonly LadderRow[], removedId: string): string | null {
  const list = badgeRows(rows)
  const at = locate(list, removedId)
  if (at === null) return null
  const row = list[at.r]
  if (row.length > 1) return at.i + 1 < row.length ? row[at.i + 1] : row[at.i - 1]
  const neighbor = list[at.r + 1] ?? list[at.r - 1]
  return neighbor === undefined ? null : neighbor[Math.min(at.i, neighbor.length - 1)]
}

// 성격 보정 표기는 공격·방어 탭 배분 표기(ui/format bundleText)와 같은 화살표만 쓴다. 무보정은 기호 없음
const NATURE_MARK: Readonly<Record<NatureSign, string>> = { plus: '↑', neutral: '', minus: '↓' }
const NATURE_SPOKEN: Readonly<Record<NatureSign, string>> = { plus: '성격 상승', neutral: '성격 무보정', minus: '성격 하락' }

/** 배분 표기: "S32↑" · "S20" · "S0↓" */
export function bundleLabel(sp: number, nature: NatureSign): string {
  return `S${sp}${NATURE_MARK[nature]}`
}

/** 배분 읽기 이름(접근 이름용): "S32 성격 상승" · "S20 성격 무보정" · "S0 성격 하락" */
export function bundleSpoken(sp: number, nature: NatureSign): string {
  return `S${sp} ${NATURE_SPOKEN[nature]}`
}
