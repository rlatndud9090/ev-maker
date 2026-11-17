// 스피드 차트 배지 모델: 상대 × 배분 묶음 × 조건 → 실수치. 내 세트는 특성(날씨 무효 판정)만 입력으로 받는다.
import {
  CoreError,
  CoreInputError,
  SPEED_FIELD_ABILITIES,
  WEATHER_NEGATING_ABILITIES,
  finalSpeed,
  speedItemApplies,
  speedSupport,
  validateSet,
  type BattleConditions,
  type PokemonSet,
  type ResolvedSet,
  type SpTable,
  type SpeedFieldCondition,
  type SpeedRejection,
} from '../core'
import { NO_ITEM, type MetaEntry } from '../data/meta-schema'
import type { Snapshot } from '../data/schema'
import { observedSpreadAssumption, type MetaView } from '../meta'
import { bundlesOf, natureSign } from './bundles'
import { presetKey } from './ids'
import { natureVariants } from './natures'
import { presetAssumption } from './presets'
import { ladderMeans, setMeansCandidates, type MeansCandidate } from './rank'
import { applyMeans, type MeansRef } from './rankMeans'
import { trimSp } from './spTrim'
import type { BundleStat, CardFilters, CustomTarget, DisplayCriteria, PresetIndex, SpeedAddedBundle, SpeedConditionKind } from './types'

export type NatureSign = BundleStat['nature']
/** preset = 목록 밖 타겟 전체(타겟 하나당 프리셋 3종 배지) */
export type SpeedBadgeOrigin = 'ladder' | 'added' | 'preset'

export type SpeedCondition =
  | { kind: 'none' }
  /** 같은 S 랭크 값의 수단은 하나로 합친다. share 없음 = 목록 밖 타겟 */
  | { kind: 'rank'; stage: number; means: readonly { means: MeansRef; share?: number }[] }
  /** 도구 = 구애스카프(메가 아닌 래더 상대, 점유율 기준 이상) */
  | { kind: 'scarf'; share: number }
  | { kind: 'tailwind' }
  /** share 없음 = 목록 밖 타겟 */
  | { kind: 'field'; ability: string; field: SpeedFieldCondition; share?: number }

export interface SpeedBadge {
  /** JSON [origin, opponentId, presetIndex | null, sp, nature, conditionKey] */
  id: string
  origin: SpeedBadgeOrigin
  /** 래더·추가 = 메타 항목 id, 프리셋 = rosterId */
  opponentId: string
  /** 이미지·이름용 계산 폼(메가면 메가 폼) */
  speciesId: string
  mega: boolean
  /** share null = 직접 입력(added) 또는 프리셋 */
  bundle: { sp: number; nature: NatureSign; share: number | null }
  /** 래더 배지와 묶음 목록에 있는 추가 배분 */
  listed: boolean
  /** origin = preset일 때만. 표지 "프리셋 n"의 n = presetIndex + 1 */
  presetIndex?: PresetIndex
  condition: SpeedCondition
  /** null = 기본·추가 배지(조건 필터 무관) */
  filterKind: SpeedConditionKind | null
  /** 그 배지 세트의 finalSpeed 단독 계산 결과 */
  speed: number
  /** 실수치에 배수를 건 지닌 도구(구애스카프·검은철구 등, 도구 무효 특성이면 null). 화면은 이 도구만 표시한다 */
  item: string | null
  set: PokemonSet
  /** 래더 순위(1부터). 프리셋은 0 */
  usageRank: number
  /** added = SpeedChartInput.added 순번, preset = customTargets 순번 */
  addedOrder?: number
}

export interface SpeedUnsupported {
  opponentId: string
  speciesId: string
  origin: 'ladder' | 'preset'
  presetIndex?: PresetIndex
  rejection: SpeedRejection
  /** 거부 원인이 도구면 그 도구, 특성이면 null */
  item: string | null
}

export interface SpeedBundleOption {
  sp: number
  nature: NatureSign
  share: number
  speed: number
  onChart: boolean
}

export interface SpeedChartModel {
  /** 상위 N·선택 필터 적용 후, 조건 필터 적용 전 전부 */
  badges: readonly SpeedBadge[]
  unsupported: readonly SpeedUnsupported[]
  /** 표시 중인 래더 상대 id → 스냅숏 전 S 묶음(점유율 내림차순, bundleShareMin 무관) */
  options: ReadonlyMap<string, readonly SpeedBundleOption[]>
}

export interface SpeedChartInput {
  game: Snapshot
  view: MetaView
  /** 내 계산 특성(메가면 메가 폼). null = 해석 불가, 날씨 무효 없음으로 본다 */
  myAbility: string | null
  criteria: Pick<DisplayCriteria, 'rankShareMin' | 'scarfShareMin' | 'weatherShareMin'>
  filters: CardFilters
  customTargets: readonly CustomTarget[]
  added: readonly SpeedAddedBundle[]
}

const SCARF = 'choicescarf'
const SPE_KEY: readonly ['spe'] = ['spe']
const PRESETS: readonly PresetIndex[] = [0, 1, 2]
const NATURE_SIGNS: readonly NatureSign[] = ['plus', 'neutral', 'minus']
const byString = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

const isCoreError = (e: unknown): boolean => e instanceof CoreError || e instanceof CoreInputError

function resolve(game: Snapshot, set: PokemonSet): ResolvedSet | null {
  try {
    return validateSet(game, set)
  } catch (e) {
    if (isCoreError(e)) return null
    throw e
  }
}

type Computed = { kind: 'ok'; resolved: ResolvedSet; speed: number } | { kind: 'rejected'; rejection: SpeedRejection } | { kind: 'invalid' }

/** 세트 하나의 스피드 지원 확인 + 단독 실수치. 세트 자체 오류는 invalid */
function compute(game: Snapshot, set: PokemonSet, conditions?: BattleConditions): Computed {
  const resolved = resolve(game, set)
  if (resolved === null) return { kind: 'invalid' }
  const rejection = speedSupport(game, set)
  if (rejection !== null) return { kind: 'rejected', rejection }
  return { kind: 'ok', resolved, speed: finalSpeed(game, set, conditions) }
}

const speedItem = (set: PokemonSet, resolved: ResolvedSet): SpeedBadge['item'] => (speedItemApplies(set.item, resolved.ability) ? set.item : null)

const rejectedItem = (r: SpeedRejection): string | null => (r.field === 'item' ? r.id : null)

function withItem(set: PokemonSet, item: string | null): PokemonSet {
  const out = { ...set }
  if (item === null || item === NO_ITEM) delete out.item
  else out.item = item
  return out
}

function withSpeBoost(set: PokemonSet, stage: number): PokemonSet {
  return { ...set, boosts: { spe: stage } }
}

/** 래더 가정 세트의 스카프 없는 판: 도구가 구애스카프면 스카프 밖 최다 도구(동률 id 순, 없으면 도구 없음)로 바꾼다 */
export function scarfFreeSet(entry: MetaEntry, set: PokemonSet): PokemonSet {
  if (set.item !== SCARF) return set
  const other = Object.entries(entry.items.shares)
    .filter(([id]) => id !== SCARF)
    .sort((a, b) => b[1] - a[1] || byString(a[0], b[0]))[0]
  return withItem(set, other?.[0] ?? null)
}

/** 래더 기본 배지의 가정 세트(1위 묶음 적용 전 대표 세트, 스카프 없는 판)와 계산 폼 */
export function ladderBaseSet(game: Snapshot, entry: MetaEntry): { set: PokemonSet; speciesId: string; mega: boolean } {
  const set = scarfFreeSet(entry, structuredClone(entry.representative.set))
  return { set, speciesId: resolve(game, set)?.species.id ?? entry.id, mega: entry.mega !== undefined }
}

/** 스카프 조건: 메가 아닌 래더 상대의 구애스카프 점유율이 기준 이상이면 스카프(대표 도구와 무관) */
export function scarfConditionOf(entry: MetaEntry, scarfShareMin: number): Extract<SpeedCondition, { kind: 'scarf' }> | null {
  if (entry.mega !== undefined) return null
  const share = entry.items.shares[SCARF] ?? 0
  return share >= scarfShareMin ? { kind: 'scarf', share } : null
}

/** S 보정 부호만 sign으로 맞춘 성격(이미 맞으면 그대로) */
function natureWithSign(game: Snapshot, current: string, sign: NatureSign): string {
  if (natureSign(game, current, 'spe') === sign) return current
  const v = natureVariants(game, current, 'spe', [])
  if (sign === 'neutral') return v.neutral
  if (sign === 'plus') return v.plus
  const natures = game.data.natures
  const cur = Object.hasOwn(natures, current) ? natures[current] : undefined
  const ids = Object.keys(natures).sort()
  return (
    ids.find((id) => natures[id].minus === 'spe' && natures[id].plus === cur?.plus) ??
    ids.find((id) => natures[id].minus === 'spe' && natures[id].plus !== 'spe') ??
    current
  )
}

/** 기본 배지 세트에서 S SP와 S 보정 부호만 바꾼다. SP 합 초과는 S 밖에서 덜어 낸다 */
function withSpeBundle(game: Snapshot, base: PokemonSet, sp: number, nature: NatureSign): PokemonSet {
  const table = { ...base.sp, spe: sp } as SpTable
  trimSp(table, new Set(SPE_KEY), game.manifest.rules.spTotal)
  return { ...base, nature: natureWithSign(game, base.nature, nature), sp: table }
}

function conditionKey(c: SpeedCondition): string {
  switch (c.kind) {
    case 'none':
    case 'scarf':
    case 'tailwind':
      return c.kind
    case 'rank':
      return `rank:${c.stage}`
    case 'field':
      return `field:${c.ability}`
  }
}

const FILTER_KIND: Readonly<Record<SpeedCondition['kind'], SpeedConditionKind | null>> = {
  none: null,
  rank: 'rank',
  scarf: 'scarf',
  tailwind: 'tailwind',
  field: 'field',
}

const fieldConditions = (f: SpeedFieldCondition): BattleConditions => (f.kind === 'weather' ? { weather: f.weather } : { terrain: f.terrain })

interface Subject {
  origin: SpeedBadgeOrigin
  opponentId: string
  speciesId: string
  mega: boolean
  presetIndex?: PresetIndex
  usageRank: number
  addedOrder?: number
  listed: boolean
}

function makeBadge(s: Subject, bundle: SpeedBadge['bundle'], condition: SpeedCondition, set: PokemonSet, resolved: ResolvedSet, speed: number): SpeedBadge {
  const badge: SpeedBadge = {
    id: JSON.stringify([s.origin, s.opponentId, s.presetIndex ?? null, bundle.sp, bundle.nature, conditionKey(condition)]),
    origin: s.origin,
    opponentId: s.opponentId,
    speciesId: s.speciesId,
    mega: s.mega,
    bundle,
    listed: s.listed,
    condition,
    filterKind: FILTER_KIND[condition.kind],
    speed,
    item: speedItem(set, resolved),
    set,
    usageRank: s.usageRank,
  }
  if (s.presetIndex !== undefined) badge.presetIndex = s.presetIndex
  if (s.addedOrder !== undefined) badge.addedOrder = s.addedOrder
  return badge
}

/** 조건 하나를 건 세트들. 세트가 거부·무효이거나 실수치가 기본 배지와 같으면 그 조건 배지만 뺀다 */
function conditionBadges(
  game: Snapshot,
  subject: Subject,
  base: SpeedBadge,
  baseResolved: ResolvedSet,
  means: readonly MeansCandidate[],
  scarf: Extract<SpeedCondition, { kind: 'scarf' }> | null,
  fields: readonly { ability: string; field: SpeedFieldCondition; share?: number }[],
): SpeedBadge[] {
  const out: SpeedBadge[] = []
  const add = (condition: SpeedCondition, set: PokemonSet, conditions?: BattleConditions) => {
    const c = compute(game, set, conditions)
    if (c.kind !== 'ok' || c.speed === base.speed) return
    out.push(makeBadge(subject, base.bundle, condition, set, c.resolved, c.speed))
  }

  const byStage = new Map<number, { means: MeansRef; share?: number }[]>()
  for (const m of means) {
    const stage = applyMeans(game, m.means, baseResolved, baseResolved)?.userBoosts.spe ?? 0
    if (stage <= 0) continue
    const list = byStage.get(stage) ?? []
    list.push(m.share === undefined ? { means: m.means } : { means: m.means, share: m.share })
    byStage.set(stage, list)
  }
  for (const stage of [...byStage.keys()].sort((a, b) => a - b)) {
    add({ kind: 'rank', stage, means: byStage.get(stage) ?? [] }, withSpeBoost(base.set, stage))
  }

  if (scarf !== null) add(scarf, withItem(base.set, SCARF))

  add({ kind: 'tailwind' }, base.set, { attacker: { tailwind: true } })

  for (const f of fields) {
    const set = baseResolved.ability === f.ability ? base.set : { ...base.set, ability: f.ability }
    const condition: SpeedCondition = f.share === undefined ? { kind: 'field', ability: f.ability, field: f.field } : { kind: 'field', ability: f.ability, field: f.field, share: f.share }
    add(condition, set, fieldConditions(f.field))
  }
  return out
}

const fieldAbilityIds = Object.keys(SPEED_FIELD_ABILITIES)

/** 내 특성이 날씨를 지우면 날씨 조건만 뺀다(필드는 남는다) */
function fieldAllowed(field: SpeedFieldCondition, myAbility: string | null): boolean {
  return field.kind !== 'weather' || myAbility === null || !WEATHER_NEGATING_ABILITIES.includes(myAbility)
}

/** 상위 N 또는 선택 종(사용률 순) + 목록 밖 타겟(추가 순, 메타 목록 안 종·기술 없음·중복 제외) */
function opponentsOf(view: MetaView, filters: CardFilters, customTargets: readonly CustomTarget[]): { ladder: MetaEntry[]; custom: { target: CustomTarget; order: number }[] } {
  const selected = new Set(filters.selected)
  const ladder = selected.size > 0 ? view.ranking.filter((e) => selected.has(e.id)) : view.ranking.slice(0, filters.topN)
  const custom: { target: CustomTarget; order: number }[] = []
  const seen = new Set<string>()
  customTargets.forEach((t, order) => {
    if (view.entry(t.rosterId) || t.moves.length === 0 || seen.has(t.rosterId)) return
    seen.add(t.rosterId)
    custom.push({ target: t, order })
  })
  return { ladder, custom }
}

interface LadderBundle {
  sp: number
  nature: NatureSign
  share: number
  set: PokemonSet
}

/** 스냅숏의 전 S 묶음(점유율 내림차순, 세트는 스카프 없는 판). 보존 배분이 없으면 대표 세트 하나를 점유율 0으로 낸다 */
function ladderBundles(game: Snapshot, view: MetaView, entry: MetaEntry, baseSet: PokemonSet): LadderBundle[] {
  const bundles = bundlesOf(game, entry, SPE_KEY, { bundleShareMin: 0 })
  if (bundles.length === 0) {
    return [{ sp: baseSet.sp.spe, nature: natureSign(game, baseSet.nature, 'spe'), share: 0, set: baseSet }]
  }
  return bundles.map((b) => {
    const set = scarfFreeSet(entry, observedSpreadAssumption(view, entry.id, entry.spreads.kept.findIndex(([key]) => key === b.representativeSpread)).set)
    return { sp: b.stats[0].sp, nature: b.stats[0].nature, share: b.share ?? 0, set }
  })
}

export function buildSpeedChart(input: SpeedChartInput): SpeedChartModel {
  const { game, view, criteria, myAbility } = input
  const { ladder, custom } = opponentsOf(view, input.filters, input.customTargets)
  const badges: SpeedBadge[] = []
  const unsupported: SpeedUnsupported[] = []
  const options = new Map<string, SpeedBundleOption[]>()

  for (const entry of ladder) {
    const { set: repSet, speciesId, mega } = ladderBaseSet(game, entry)
    const subject: Subject = { origin: 'ladder', opponentId: entry.id, speciesId, mega, usageRank: entry.rank, listed: true }
    const computed = ladderBundles(game, view, entry, repSet).map((b) => ({ ...b, c: compute(game, b.set) }))
    const rejected = computed.find((b) => b.c.kind === 'rejected')
    const ok = computed.flatMap((b) => (b.c.kind === 'ok' ? [{ ...b, resolved: b.c.resolved, speed: b.c.speed }] : []))
    if (ok.length === 0) {
      if (rejected?.c.kind === 'rejected') unsupported.push({ opponentId: entry.id, speciesId, origin: 'ladder', rejection: rejected.c.rejection, item: rejectedItem(rejected.c.rejection) })
      continue
    }
    const topShare = ok[0].share
    const top = ok.filter((b) => b.share === topShare).reduce((best, b) => (b.speed > best.speed ? b : best))
    const base = makeBadge(subject, { sp: top.sp, nature: top.nature, share: top.share }, { kind: 'none' }, top.set, top.resolved, top.speed)
    badges.push(base)

    const means = ladderMeans(entry, criteria.rankShareMin)
    const scarf = scarfConditionOf(entry, criteria.scarfShareMin)
    const fields = fieldAbilityIds
      .filter((ab) => (entry.abilities[ab] ?? 0) >= criteria.weatherShareMin && fieldAllowed(SPEED_FIELD_ABILITIES[ab], myAbility))
      .map((ab) => ({ ability: ab, field: SPEED_FIELD_ABILITIES[ab], share: entry.abilities[ab] }))
    badges.push(...conditionBadges(game, subject, base, top.resolved, means, scarf, fields))

    const onChart = new Set([JSON.stringify([top.sp, top.nature])])
    const listedShare = new Map(ok.map((b) => [JSON.stringify([b.sp, b.nature]), b.share]))
    input.added.forEach((a, addedOrder) => {
      if (a.opponentId !== entry.id || !validBundle(a.sp, a.nature, game.manifest.rules.spMaxPerStat)) return
      const key = JSON.stringify([a.sp, a.nature])
      if (onChart.has(key)) return
      const set = withSpeBundle(game, top.set, a.sp, a.nature)
      const c = compute(game, set)
      if (c.kind !== 'ok') return
      onChart.add(key)
      const share = listedShare.get(key)
      const s: Subject = { ...subject, origin: 'added', addedOrder, listed: share !== undefined }
      badges.push(makeBadge(s, { sp: a.sp, nature: a.nature, share: share ?? null }, { kind: 'none' }, set, c.resolved, c.speed))
    })
    options.set(
      entry.id,
      ok.map((b) => ({ sp: b.sp, nature: b.nature, share: b.share, speed: b.speed, onChart: onChart.has(JSON.stringify([b.sp, b.nature])) })),
    )
  }

  for (const { target, order } of custom) {
    for (const presetIndex of PRESETS) {
      const edit = target.edits[presetKey('speed', null, presetIndex)]
      const set = presetAssumption(game, target.rosterId, target.moves, 'speed', null, presetIndex, edit).set
      const c = compute(game, set)
      const speciesId = c.kind === 'ok' ? c.resolved.species.id : target.rosterId
      if (c.kind === 'rejected') {
        unsupported.push({ opponentId: target.rosterId, speciesId, origin: 'preset', presetIndex, rejection: c.rejection, item: rejectedItem(c.rejection) })
        continue
      }
      if (c.kind !== 'ok') continue
      const subject: Subject = { origin: 'preset', opponentId: target.rosterId, speciesId, mega: set.mega === true, presetIndex, usageRank: 0, addedOrder: order, listed: false }
      const bundle = { sp: set.sp.spe, nature: natureSign(game, set.nature, 'spe'), share: null }
      const base = makeBadge(subject, bundle, { kind: 'none' }, set, c.resolved, c.speed)
      badges.push(base)
      const field = Object.hasOwn(SPEED_FIELD_ABILITIES, c.resolved.ability) ? SPEED_FIELD_ABILITIES[c.resolved.ability] : undefined
      const fields = field !== undefined && fieldAllowed(field, myAbility) ? [{ ability: c.resolved.ability, field }] : []
      badges.push(...conditionBadges(game, subject, base, c.resolved, setMeansCandidates(c.resolved, 'opponent'), null, fields))
    }
  }

  return { badges, unsupported, options }
}

const validBundle = (sp: number, nature: NatureSign, spMax: number): boolean =>
  Number.isInteger(sp) && sp >= 0 && sp <= spMax && NATURE_SIGNS.includes(nature)

export type AddCheck = { kind: 'ok'; listed: boolean } | { kind: 'duplicate' } | { kind: 'invalid' }

/** 차트에 배분을 더할 수 있는가. 표시 중인 래더 상대만 받고, 기본·추가 배지와 같은 (SP, 부호)면 duplicate */
export function checkSpeedAddition(model: SpeedChartModel, opponentId: string, sp: number, nature: NatureSign, spMax: number): AddCheck {
  const options = model.options.get(opponentId)
  if (options === undefined || !validBundle(sp, nature, spMax)) return { kind: 'invalid' }
  const same = (b: { sp: number; nature: NatureSign }) => b.sp === sp && b.nature === nature
  const onChart = model.badges.some((b) => b.opponentId === opponentId && b.origin !== 'preset' && b.condition.kind === 'none' && same(b.bundle))
  if (onChart) return { kind: 'duplicate' }
  return { kind: 'ok', listed: options.some(same) }
}
