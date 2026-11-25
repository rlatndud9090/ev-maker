// 스피드 차트 응용 로직: 기준선·상태, 조건 필터, 같은 줄 순서, 사다리 줄, 최소 S, 키보드 탐색, 배분 표기. 화면 없는 순수 함수다.
import { CoreError, CoreInputError, finalSpeed, minSpToOutspeed, speedSupport, validateSet, type EvalOptions, type OutspeedResult, type PokemonSet, type SpeedRejection } from '../core'
import type { Snapshot } from '../data/schema'
import { natureSign } from './bundles'
import { natureVariants } from './natures'
import { SCARF_ITEM, type NatureSign, type SpeedBadge, type SpeedChartModel } from './speedChart'
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

/**
 * 기준 실수치(배경색 구간의 경계): 내 세트에서 S SP만 S 최대치로, 성격만 S 무보정·상승 변형(최소 S와 같은
 * natureVariants 규칙)으로 바꾼 실수치(neutral·plus)와, S SP를 0으로·성격을 같은 무보정 변형으로 둔 실수치(floor, 하락 성격은 넣지 않는다).
 * scarf = 같은 세트의 도구만 구애스카프로 바꾼 S32 무보정·상승 최대(2026-11-24 세 번째 개정). 지금 도구가 이미 구애스카프이거나
 * 스카프 세트가 무효·거부면 null(보라 구간이 이미 스카프를 포함한다).
 * 기준선과 같은 경로(랭크 제거·세트 검사·스피드 지원 검사·내 순풍만)이고 SP 합계 검사는 늘 끈다. 무효·거부면 null.
 * plusSign = 상승 변형 성격의 실제 S 보정(규칙에 S 상승 성격이 없어 무보정으로 대체되면 'neutral').
 */
export interface SpeedCeilings {
  floor: number
  neutral: number
  plus: number
  plusSign: NatureSign
  scarf: { neutral: number; plus: number } | null
}

export function speedCeilings(game: Snapshot, mySet: PokemonSet, myTailwind: boolean): SpeedCeilings | null {
  const maxed: PokemonSet = { ...mySet, sp: { ...mySet.sp, spe: game.manifest.rules.spMaxPerStat } }
  const checked = checkedMySet(game, maxed, { ignoreSpTotal: true })
  if (checked === null || 'rejection' in checked) return null
  const { set } = checked
  const v = natureVariants(game, set.nature, 'spe', [])
  const speedOf = (base: PokemonSet, nature: string, spe: number): number =>
    finalSpeed(game, { ...base, nature, sp: { ...base.sp, spe } }, { attacker: { tailwind: myTailwind } }, 'attacker', { ignoreSpTotal: true })
  const max = set.sp.spe
  let scarf: SpeedCeilings['scarf'] = null
  if (set.item !== SCARF_ITEM) {
    const scarfChecked = checkedMySet(game, { ...set, item: SCARF_ITEM }, { ignoreSpTotal: true })
    if (scarfChecked !== null && !('rejection' in scarfChecked)) scarf = { neutral: speedOf(scarfChecked.set, v.neutral, max), plus: speedOf(scarfChecked.set, v.plus, max) }
  }
  return { floor: speedOf(set, v.neutral, 0), neutral: speedOf(set, v.neutral, max), plus: speedOf(set, v.plus, max), plusSign: natureSign(game, v.plus, 'spe'), scarf }
}

/**
 * 배경색 구간(2026-11-24 세 번째 개정, 아래에서 위로): base = S0 무보정 최소 이상 S32 무보정 최대 이하(연한 초록) ·
 * basePlus = S32 최대 초과 S32↑ 최대 이하(진한 초록) · scarf = 그 위 구애스카프 S32 무보정 최대 이하(연한 파랑) ·
 * scarfPlus = 그 위 구애스카프 S32↑ 최대 이하(진한 파랑). 위 끝이 아래 구간 위 끝 이하인 구간은 비어 있어 빠진다.
 */
export type ZoneKind = 'base' | 'basePlus' | 'scarf' | 'scarfPlus'

/** 구간 경계 표지: S0 최소 · S32 최대 · S32↑ 최대 · 구애스카프 S32 최대 · 구애스카프 S32↑ 최대 */
export type MarkKind = 'floor' | 'max' | 'maxPlus' | 'scarfMax' | 'scarfMaxPlus'

export interface SpeedZone {
  kind: ZoneKind
  /** 구간 위 끝(포함). 아래 끝은 바로 아래 구간 위 끝(제외), 맨 아래 구간은 S0 최소(포함) */
  top: number
  mark: MarkKind
}

/**
 * 비지 않은 구간(아래에서 위로). 두 경계가 같으면(무보정 = 상승) 구간 하나에 위쪽 표기(상승 변형의 실제 S 보정)를 붙인다.
 */
export function speedZones(c: SpeedCeilings): SpeedZone[] {
  const up = c.plusSign === 'plus'
  const zones: SpeedZone[] = [{ kind: 'base', top: c.neutral, mark: c.neutral === c.plus && up ? 'maxPlus' : 'max' }]
  const push = (kind: ZoneKind, top: number, mark: MarkKind) => {
    if (top > zones[zones.length - 1].top) zones.push({ kind, top, mark })
  }
  push('basePlus', c.plus, up ? 'maxPlus' : 'max')
  if (c.scarf !== null) {
    push('scarf', c.scarf.neutral, c.scarf.neutral === c.scarf.plus && up ? 'scarfMaxPlus' : 'scarfMax')
    push('scarfPlus', c.scarf.plus, up ? 'scarfMaxPlus' : 'scarfMax')
  }
  return zones
}

function zoneOf(speed: number, floor: number, zones: readonly SpeedZone[]): ZoneKind | undefined {
  if (speed < floor) return undefined
  return zones.find((z) => speed <= z.top)?.kind
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

/**
 * baseline = 내 실수치 줄(배지가 없으면 badgeIds가 빈 줄).
 * mark = 그 실수치가 구간 경계(S0 최소·S32 최대·S32↑ 최대·스카프 S32 최대·스카프 S32↑ 최대)인 줄의 표지. 경계가 아니면 없다.
 * zone = 그 실수치가 속한 배경색 구간. 구간 밖이거나 기준선 줄이면 없다(띠는 띠 모습 그대로).
 */
export interface LadderRow {
  speed: number
  badgeIds: readonly string[]
  baseline: boolean
  mark?: MarkKind
  zone?: ZoneKind
}

/**
 * 실수치 내림차순 줄. baselineSpeed null(내 세트 거부·무효)이면 기준선 줄이 없고 경계 줄·구간도 없다.
 * ceilings가 있으면 경계 실수치 자리에 줄을 더하거나(같은 실수치 줄·기준선 줄이 있으면 그 줄에 표지) 구간을 단다.
 */
export function ladderRows(
  badges: readonly SpeedBadge[],
  baselineSpeed: number | null,
  cmp: (a: SpeedBadge, b: SpeedBadge) => number,
  ceilings: SpeedCeilings | null = null,
): LadderRow[] {
  const bySpeed = new Map<number, SpeedBadge[]>()
  for (const b of badges) {
    const list = bySpeed.get(b.speed) ?? []
    list.push(b)
    bySpeed.set(b.speed, list)
  }
  if (baselineSpeed !== null && !bySpeed.has(baselineSpeed)) bySpeed.set(baselineSpeed, [])
  const ceil = baselineSpeed === null ? null : ceilings
  const zones = ceil === null ? [] : speedZones(ceil)
  const marks = new Map<number, MarkKind>()
  if (ceil !== null) {
    marks.set(ceil.floor, 'floor')
    for (const z of zones) marks.set(z.top, z.mark)
    for (const s of marks.keys()) if (!bySpeed.has(s)) bySpeed.set(s, [])
  }
  const speeds = [...bySpeed.keys()].sort((a, b) => b - a)
  return speeds.map((speed) => {
    const row: LadderRow = {
      speed,
      badgeIds: [...(bySpeed.get(speed) ?? [])].sort(cmp).map((b) => b.id),
      baseline: speed === baselineSpeed,
    }
    if (ceil === null) return row
    const mark = marks.get(speed)
    if (mark !== undefined) row.mark = mark
    const zone = row.baseline ? undefined : zoneOf(speed, ceil.floor, zones)
    if (zone !== undefined) row.zone = zone
    return row
  })
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

const MARK_SIGN: Readonly<Record<MarkKind, NatureSign>> = { floor: 'neutral', max: 'neutral', maxPlus: 'plus', scarfMax: 'neutral', scarfMaxPlus: 'plus' }

/** 경계 표지에 구애스카프 아이콘을 붙이는가 */
export function markHasScarf(kind: MarkKind): boolean {
  return kind === 'scarfMax' || kind === 'scarfMaxPlus'
}

/** 경계 표지 글자(줄 오른쪽 끝): "S0" · "S32" · "S32↑"(스카프 표지는 이 글자 뒤에 구애스카프 아이콘) */
export function markLabel(spMax: number, kind: MarkKind): string {
  return bundleLabel(kind === 'floor' ? 0 : spMax, MARK_SIGN[kind])
}

/** 경계 읽기: "S0 성격 무보정 최소" · "S32 성격 상승 최대" · "구애스카프 S32 성격 무보정 최대" */
export function markSpoken(spMax: number, kind: MarkKind, scarfName: string): string {
  if (kind === 'floor') return `${bundleSpoken(0, 'neutral')} 최소`
  return `${markHasScarf(kind) ? `${scarfName} ` : ''}${bundleSpoken(spMax, MARK_SIGN[kind])} 최대`
}

/** 구간 읽기 설명(배지 있는 줄): "S0~S32 무보정 구간" · "S32 성격 상승 구간" · "구애스카프 S32 무보정 구간" · "구애스카프 S32 성격 상승 구간" */
export function zoneSpoken(spMax: number, kind: ZoneKind, scarfName: string): string {
  switch (kind) {
    case 'base':
      return `S0~S${spMax} 무보정 구간`
    case 'basePlus':
      return `S${spMax} 성격 상승 구간`
    case 'scarf':
      return `${scarfName} S${spMax} 무보정 구간`
    case 'scarfPlus':
      return `${scarfName} S${spMax} 성격 상승 구간`
  }
}

/** 배분 읽기 이름(접근 이름용): "S32 성격 상승" · "S20 성격 무보정" · "S0 성격 하락" */
export function bundleSpoken(sp: number, nature: NatureSign): string {
  return `S${sp} ${NATURE_SPOKEN[nature]}`
}
