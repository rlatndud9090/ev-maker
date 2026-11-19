// 탭 계획: 상대 순서·묶음·카드 골격·행 명세. 코어 판정은 부르지 않는다(검증·가정 해석·참조 조회만).
import {
  CoreError,
  CoreInputError,
  HELD_ITEM_POWER_MOVES,
  STAT_IDS,
  compareSpeed,
  effectivenessAgainst,
  moveStatRefs,
  normalizeRollSteps,
  validateSet,
  withAttackerField,
  fieldPriority,
  abilityTerrain,
  abilityWeather,
  type BattleConditions,
  type BoostTable,
  type EffectivenessDefender,
  type MoveStatRefs,
  type PokemonSet,
  type ResolvedSet,
  type SpTable,
} from '../core'
import type { MetaEntry } from '../data/meta-schema'
import type { Snapshot, StatId } from '../data/schema'
import { observedSpreadAssumption, representativeAssumption, resolveAssumption, type Assumption } from '../meta'
import { berryActivates, resistBerriesOf } from './berries'
import { powerItemBoosts, powerItemsOf } from './powerItems'
import { bundleStats, bundlesOf } from './bundles'
import { LAST_RESPECTS, LAST_RESPECTS_FAINTS, addedBundleKey, addedCardId, faintConditionId, cardId as makeCardId, presetKey, rowId } from './ids'
import { presetAssumption } from './presets'
import { isInRange, ladderOpponents, type LadderOpponent } from './range'
import { isSpValue } from './spValue'
import { trimSp } from './spTrim'
import { TAB_MEANS_OWNERS, ladderMeans, rankMoveAllowed, rankVariants, setMeansCandidates, type CardRefStats, type MeansCandidate } from './rank'
import type { BoostStat } from './rankMeans'
import { mainMoves } from './items'
import { natureForSigns, signOf, validKeySigns } from './keySigns'
import { natureVariants } from './natures'
import { myDependsOn, relevantStats } from './relevance'
import {
  CATEGORY_ORDER,
  type BundleSpec,
  type CardInput,
  type BerryVariant,
  type CardSpec,
  type Category,
  type ConditionGroup,
  type CustomTarget,
  type ErrorReason,
  type ExtremeSpec,
  type FixedSpec,
  type MoveCandidate,
  type MoveNotice,
  type NatureVariants,
  type OpponentHeader,
  type PresetIndex,
  type RankBasis,
  type RowSpec,
  type DamageTab,
  type TabPlan,
  type TargetSource,
} from './types'

/** 방어 탭 래더 상대 기본 후보의 사용률 하한 */
export const DEFENSE_MOVE_SHARE_MIN = 0.05
const PRESETS: readonly PresetIndex[] = [0, 1, 2]
const SCARF = 'choicescarf'

const byString = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)
const defenseStatOf = (c: Category): 'def' | 'spd' => (c === 'physical' ? 'def' : 'spd')
const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** CoreError는 detail마다, CoreInputError는 INPUT 1건. 그 밖 예외는 버그라 다시 던진다. */
export function errorReasons(e: unknown): ErrorReason[] {
  if (e instanceof CoreError) {
    return e.details.map((d) => (d.field === undefined ? { code: d.code, message: d.message } : { code: d.code, field: d.field, message: d.message }))
  }
  if (e instanceof CoreInputError) {
    return [{ code: e.field === 'target' ? 'TARGET_MISMATCH' : 'INPUT', field: e.field, message: e.message }]
  }
  throw e
}

function withBoosts(set: PokemonSet, boosts: BoostTable): PokemonSet {
  const out = { ...set }
  delete out.boosts
  if (Object.keys(boosts).length > 0) out.boosts = { ...boosts }
  return out
}

const hasMove = (game: Snapshot, moveId: string): boolean => Object.prototype.hasOwnProperty.call(game.data.moves, moveId)
const isMultihit = (game: Snapshot, moveId: string): boolean => hasMove(game, moveId) && game.data.moves[moveId].multihit !== undefined
const BASE_CONDITION = JSON.stringify(['base'])
const rankCondition = (b: RankBasis): string => JSON.stringify(['rank', ...meansParts(b)])
const isLastRespects = (slot: MoveSlot): boolean => slot.moveId === LAST_RESPECTS
/** 성묘 판정 조건: 쓰러진 아군 수 지정(그 밖의 기술은 그대로). 랭크 후 항목은 1기절 */
const faintConditions = (c: BattleConditions, moveId: string, fainted = 1): BattleConditions =>
  moveId === LAST_RESPECTS ? { ...c, lastRespectsFainted: fainted } : c

const WHITE_HERB_MULTIHIT: ErrorReason = {
  code: 'WHITE_HERB_MULTIHIT',
  field: 'move',
  message: '하양허브를 소비한 랭크 변화 뒤의 연속기는 계산하지 않는다',
}

interface MoveSlot {
  moveId: string
  refs?: MoveStatRefs
  error?: ErrorReason
}

/** 상대 한 마리의 카드 골격(분류 × 묶음/프리셋). */
interface CardSeed {
  category: Category | null
  bundle: BundleSpec
  assumption: Assumption
  resolved?: ResolvedSet
  error?: ErrorReason
}

interface MoveMeta {
  shares: Readonly<Record<string, number>> | undefined
  order: ReadonlyMap<string, number>
  /** 주력 기술(MoveCandidate.main) */
  mains: ReadonlySet<string>
}

interface Opponent {
  header: OpponentHeader
  entry?: MetaEntry
  custom?: CustomTarget
}

class PlanBuilder {
  readonly cards: CardSpec[] = []
  readonly rows: Record<string, RowSpec> = {}
  readonly filters: Record<string, ExtremeSpec> = {}
  readonly fixed: Record<string, FixedSpec> = {}

  readonly input: CardInput
  readonly tab: DamageTab
  readonly me: ResolvedSet
  readonly mySet: PokemonSet
  readonly conditions: BattleConditions
  readonly myMeans: readonly MeansCandidate[]

  constructor(input: CardInput, tab: DamageTab, me: ResolvedSet, mySet: PokemonSet, conditions: BattleConditions, myMeans: readonly MeansCandidate[]) {
    this.input = input
    this.tab = tab
    this.me = me
    this.mySet = mySet
    this.conditions = conditions
    this.myMeans = myMeans
  }

  get game(): Snapshot {
    return this.input.game
  }

  /** 대미지 판정 조건: 탭 조건 + 공격측 계산 특성(메가면 메가 폼 특성)이 까는 날씨·필드(R12). 맞는 쪽 특성은 보지 않는다. */
  damageConditions(attackerAbility: string): BattleConditions {
    return withAttackerField(this.conditions, attackerAbility)
  }

  /** 공격 탭: 내 기술 슬롯. 분류 가변 기술·내 HP 의존 기술은 tabNotices로, 변화기는 건너뛴다. */
  myAttackSlots(tabNotices: MoveNotice[]): MoveSlot[] {
    const out: MoveSlot[] = []
    for (const moveId of this.me.set.moves) {
      const refs = moveStatRefs(this.game, moveId)
      if (!refs.offense || !refs.defense) continue
      if (refs.categoryVaries) {
        tabNotices.push({ kind: 'category-varies', moveId, owner: 'me' })
        continue
      }
      if (refs.offense.owner === 'self' && refs.attackerStats.includes('hp')) {
        tabNotices.push({ kind: 'attacker-hp-dependent', moveId, owner: 'me' })
        continue
      }
      out.push({ moveId, refs })
    }
    return out
  }

  /** 방어 탭: 상대 기술 슬롯. 스냅샷에 없는 기술은 오류 슬롯, 분류 가변 기술은 안내(자리는 채우지 않는다). */
  opponentSlots(moveIds: readonly string[], notices: MoveNotice[]): MoveSlot[] {
    const out: MoveSlot[] = []
    for (const moveId of moveIds) {
      let refs: MoveStatRefs
      try {
        refs = moveStatRefs(this.game, moveId)
      } catch (e) {
        out.push({ moveId, error: errorReasons(e)[0] })
        continue
      }
      if (!refs.offense || !refs.defense) continue
      if (refs.categoryVaries) {
        notices.push({ kind: 'category-varies', moveId, owner: 'opponent' })
        continue
      }
      out.push({ moveId, refs })
    }
    return out
  }

  /** 래더 관측 씨앗(점유율 기준 이상 묶음, 없으면 대표 가정 하나). 범위 밖 상대도 사용자 추가의 기준 가정으로 쓴다 */
  ladderObserved(entry: MetaEntry, category: Category | null, keyStats: readonly StatId[]): CardSeed[] {
    const { game, input } = this
    const bundles = bundlesOf(game, entry, keyStats, input.criteria)
    let observed: CardSeed[]
    if (bundles.length === 0) {
      const a = representativeAssumption(input.view, entry.id)
      const stats = bundleStats(game, keyStats, a.set.nature, a.set.sp)
      const bundle: BundleSpec = { key: JSON.stringify(stats), stats, share: 0, retention: entry.spreads.keptShare, minority: true }
      observed = [this.seed(category, bundle, a)]
    } else {
      observed = bundles.map((bundle) => {
        const idx = entry.spreads.kept.findIndex(([key]) => key === bundle.representativeSpread)
        return this.seed(category, bundle, observedSpreadAssumption(input.view, entry.id, idx))
      })
    }
    return observed
  }

  /**
   * 사용자 추가 배분(이 탭·출처·상대·분류, 추가 순). 가정 세트 = base(래더 = 최고 점유율 묶음 가정, 목록 밖 = 프리셋 1 편집 반영)에서 키 능력치 SP만 바꾸고,
   * 성격은 키 능력치 부호를 정확히 만족하도록 맞춘다(natureForSigns). SP 합이 상한을 넘으면 키가 아닌 능력치(큰 것부터)에서 덜어 낸다.
   * 키 능력치 집합이 다르거나 SP가 0~최대 정수가 아니거나 부호 규칙을 어기면(또는 만족하는 성격이 없으면) 받지 않고,
   * seen(이미 표시하는 묶음 키)·앞선 추가와 키가 같으면 새 카드를 만들지 않는다.
   */
  userSeeds(opp: Opponent, category: Category | null, keyStats: readonly StatId[], base: Assumption | undefined, seen: Set<string>): CardSeed[] {
    const { game, input } = this
    if (base === undefined) return []
    const { spTotal, spMaxPerStat } = game.manifest.rules
    const keys = new Set(keyStats)
    const out: CardSeed[] = []
    ;(input.addedBundles ?? []).forEach((added, index) => {
      if (added.tab !== this.tab || added.source !== opp.header.source || added.opponentId !== opp.header.id || added.category !== category) return
      const given = Object.keys(added.sp) as StatId[]
      if (given.length !== keys.size || !given.every((s) => keys.has(s))) return
      if (!given.every((s) => isSpValue(added.sp[s], spMaxPerStat))) return
      if (!validKeySigns(keyStats, added.nature)) return
      const nature = natureForSigns(game, base.set.nature, keyStats, added.nature)
      if (nature === undefined) return
      const stats = STAT_IDS.filter((s) => keys.has(s)).map((stat) => ({ stat, sp: added.sp[stat] as number, nature: signOf(added.nature, stat) }))
      const key = addedBundleKey(stats)
      if (seen.has(key)) return
      seen.add(key)
      const sp = { ...base.set.sp } as SpTable
      for (const st of stats) sp[st.stat] = st.sp
      trimSp(sp, keys, spTotal)
      const assumption: Assumption = { ...base, set: { ...base.set, nature, sp } }
      delete assumption.share
      out.push(this.seed(category, { key, stats, minority: false, userAdded: index }, assumption))
    })
    return out
  }

  customSeeds(target: CustomTarget, category: Category | null, keyStats: readonly StatId[]): CardSeed[] {
    return PRESETS.map((p) => {
      const edit = target.edits[presetKey(this.tab, category, p)]
      const a = presetAssumption(this.game, target.rosterId, target.moves, this.tab, category, p, edit)
      const stats = bundleStats(this.game, keyStats, a.set.nature, a.set.sp)
      return this.seed(category, { key: JSON.stringify(stats), stats, minority: false, presetIndex: p }, a)
    })
  }

  /** 가정 세트의 도구만 바꾼 씨앗(undefined = 도구 없음). 다시 해석한다 */
  withItem(seed: CardSeed, item: string | undefined): CardSeed {
    const set = { ...seed.assumption.set }
    if (item === undefined) delete set.item
    else set.item = item
    return this.seed(seed.category, seed.bundle, { ...seed.assumption, set })
  }

  /**
   * 공격 탭 래더 상대의 반감열매 변형: 도구 분포에서 점유율 berryShareMin 이상인 반감열매마다, 내 공격기 중 그 열매가 발동하는 기술(triggers).
   * 발동할 기술이 하나도 없으면 변형을 만들지 않는다(그 열매는 판정에 관여하지 않는다). 메가 항목(메가스톤 고정)·목록 밖 타겟은 없다.
   * 대상 타입·특성(서투름이면 열매 무효)은 해석된 씨앗(관측 배분 대표 세트) 기준.
   */
  berryVariants(opp: Opponent, seeds: readonly CardSeed[], slots: readonly MoveSlot[]): (BerryVariant & { triggers: string[] })[] {
    const entry = opp.entry
    if (entry === undefined || entry.mega !== undefined) return []
    const resolved = seeds.find((s) => s.resolved !== undefined)?.resolved
    if (resolved === undefined) return []
    const user = { types: this.me.species.types, ability: this.me.ability }
    const out: (BerryVariant & { triggers: string[] })[] = []
    for (const b of resistBerriesOf(entry.items.shares, this.input.criteria.berryShareMin)) {
      const triggers = slots.filter((s) => berryActivates(this.game, s.moveId, b.item, user, { types: resolved.species.types, ability: resolved.ability })).map((s) => s.moveId)
      if (triggers.length > 0) out.push({ ...b, triggers })
    }
    return out
  }

  /**
   * 방어 탭 래더 상대의 화력 도구 변형(R14): 도구 분포에서 점유율 powerItemShareMin 이상인 화력 도구마다, 상대 후보 기술 중 그 도구가 보정을 주는 기술(triggers).
   * 보정할 기술이 하나도 없으면 변형을 만들지 않는다. 메가 항목(메가스톤 고정)·목록 밖 타겟은 없다. 상대 타입·특성은 해석된 씨앗 기준.
   */
  powerItemVariants(opp: Opponent, seeds: readonly CardSeed[], slots: readonly MoveSlot[]): (BerryVariant & { triggers: string[] })[] {
    const entry = opp.entry
    if (entry === undefined || entry.mega !== undefined) return []
    const resolved = seeds.find((s) => s.resolved !== undefined)?.resolved
    if (resolved === undefined) return []
    const user = { types: resolved.species.types, ability: resolved.ability }
    const target: EffectivenessDefender = { types: this.me.species.types, ability: this.me.ability, item: this.me.item }
    const out: (BerryVariant & { triggers: string[] })[] = []
    for (const p of powerItemsOf(entry.items.shares, this.input.criteria.powerItemShareMin)) {
      const triggers = slots.filter((s) => powerItemBoosts(this.game, s.moveId, p.item, user, target)).map((s) => s.moveId)
      if (triggers.length > 0) out.push({ ...p, triggers })
    }
    return out
  }

  /**
   * 기본 카드 씨앗(도구 변형 전). observed = 래더 관측 씨앗·목록 밖 프리셋 3개, cards = 카드를 만드는 씨앗.
   * 래더 = 관측 + 사용자 추가(addedOnly면 사용자 추가만), 목록 밖 = 프리셋 + 사용자 추가.
   */
  seedSets(opp: Opponent, category: Category | null, keyStats: readonly StatId[]): { observed: CardSeed[]; cards: CardSeed[] } {
    let observed: CardSeed[]
    if (opp.custom) observed = this.customSeeds(opp.custom, category, keyStats)
    else if (opp.entry !== undefined) observed = this.ladderObserved(opp.entry, category, keyStats)
    else return { observed: [], cards: [] }
    const addedOnly = opp.header.addedOnly === true
    // 추가분만 상대는 관측 키로 시작하지 않는다: 1위·관측 묶음과 같은 SP의 추가도 카드가 된다
    const seen = new Set(addedOnly ? [] : observed.map((s) => s.bundle.key))
    const user = this.userSeeds(opp, category, keyStats, observed[0]?.assumption, seen)
    return { observed, cards: addedOnly ? user : [...observed, ...user] }
  }

  seedsOf(opp: Opponent, category: Category | null, keyStats: readonly StatId[]): CardSeed[] {
    return this.seedSets(opp, category, keyStats).cards
  }

  seed(category: Category | null, bundle: BundleSpec, assumption: Assumption): CardSeed {
    const r = resolveAssumption(this.game, assumption)
    if (!r.usable) return { category, bundle, assumption, error: errorReasons(r.error)[0] }
    return { category, bundle, assumption, resolved: r.resolved }
  }

  opponentMeans(opp: Opponent, resolved: ResolvedSet): MeansCandidate[] {
    if (opp.entry) return ladderMeans(opp.entry, this.input.criteria.rankShareMin)
    return setMeansCandidates(resolved, 'opponent')
  }

  /** 카드를 만들고 rows/filters/fixed를 채울 수 있게 빈 목록을 돌려준다. */
  openCard(opp: Opponent, seed: CardSeed, notices: readonly MoveNotice[], berry?: BerryVariant & { triggers: readonly string[] }): CardSpec {
    const bundlePart = seed.bundle.presetIndex ?? seed.bundle.key
    const parts = [this.tab, opp.header.source, opp.header.id, seed.category, bundlePart]
    // 사용자 추가 배분은 'user' 표지를 붙여 같은 키의 관측 묶음 카드와 id가 겹치지 않게 한다. 도구 변형(반감열매·화력 도구)은 'berry' + 도구 id를 붙인다.
    const card: CardSpec = {
      id:
        seed.bundle.userAdded === undefined
          ? makeCardId(berry === undefined ? parts : [...parts, 'berry', berry.item])
          : addedCardId(this.tab, opp.header.source, opp.header.id, seed.category, seed.bundle.key, berry?.item),
      order: this.cards.length,
      opponent: opp.header,
      category: seed.category,
      bundle: seed.bundle,
      opponentSet: seed.assumption.set,
      state: seed.error ? 'error' : 'ok',
      notices: [...notices],
      rowIds: [],
      filterIds: [],
      fixedIds: [],
      conditions: [],
    }
    if (seed.error) card.error = seed.error
    if (berry !== undefined) card.berry = { item: berry.item, share: berry.share, triggers: [...berry.triggers] }
    this.cards.push(card)
    return card
  }

  addRow(card: CardSpec, parts: readonly (string | number | null)[], spec: Omit<RowSpec, 'id' | 'cardId' | 'order'>): RowSpec {
    const row: RowSpec = { id: rowId(card.id, parts), cardId: card.id, order: card.rowIds.length, ...spec }
    this.rows[row.id] = row
    const ids = card.rowIds as string[]
    ids.push(row.id)
    return row
  }

  addFilter(card: CardSpec, parts: readonly (string | number | null)[], spec: Omit<ExtremeSpec, 'id' | 'cardId' | 'order'>): ExtremeSpec {
    const f: ExtremeSpec = { id: rowId(card.id, parts), cardId: card.id, order: card.filterIds.length, ...spec }
    this.filters[f.id] = f
    const ids = card.filterIds as string[]
    ids.push(f.id)
    return f
  }

  /**
   * priority = 공격측 필드를 넣은 우선도 > 0(fieldPriority: 그래스필드 그래스슬라이더, 스냅샷에 없는 기술은 false).
   * attacker = 그 판정의 공격측 해결 세트. meta = 그 카드 상대의 채용률·주력 기술(moveMeta). added = 사용자가 추가한 상대 기술
   */
  candidate(target: MoveCandidate['target'], id: string, moveId: string, attacker: ResolvedSet, meta: MoveMeta, added?: ReadonlySet<string>): MoveCandidate {
    const priority = this.isPriority(moveId, attacker)
    const c: MoveCandidate = { target, id, moveId, priority, share: meta.shares?.[moveId] ?? 0, order: meta.order.get(moveId) ?? meta.order.size, main: meta.mains.has(moveId) }
    if (added?.has(moveId) === true) c.added = true
    return c
  }

  /** 공격측 필드를 넣은 우선도 > 0(fieldPriority: 그래스필드 그래스슬라이더). 스냅샷에 없는 기술은 false */
  isPriority(moveId: string, attacker: ResolvedSet): boolean {
    return (
      hasMove(this.game, moveId) &&
      fieldPriority(moveId, this.game.data.moves[moveId].priority, this.damageConditions(attacker.ability).terrain, {
        types: attacker.species.types,
        ability: attacker.ability,
        item: attacker.item,
      }) > 0
    )
  }

  /**
   * 채용률(PRD R16)·주력 기술(R4-1). moveIds = 그 상대의 모든 분류 후보 기술(기존 순서). 주력은 분류 카드를 가로질러 정한다.
   * attacker 없음 = 공격 탭(내 기술 전부가 주력). 있으면 방어 탭: 그 공격측 기준 선공기를 빼고 정한다(items.mainMoves).
   */
  moveMeta(moveIds: readonly string[], shares: Readonly<Record<string, number>> | undefined, attacker?: ResolvedSet): MoveMeta {
    const order = new Map(moveIds.map((id, i) => [id, i]))
    if (attacker === undefined) return { shares, order, mains: new Set(moveIds) }
    const moves = moveIds.map((moveId) => ({ moveId, share: shares?.[moveId] ?? 0, priority: this.isPriority(moveId, attacker) }))
    return { shares, order, mains: mainMoves(moves, shares !== undefined) }
  }

  /** 후보가 없으면 조건을 두지 않는다. */
  addCondition(card: CardSpec, id: string, candidates: readonly MoveCandidate[]): void {
    if (candidates.length === 0) return
    const groups = card.conditions as ConditionGroup[]
    groups.push({ id, candidates })
  }

  /** 방어 탭 판정의 공격측(상대) 계산 특성 날씨·필드 기준 스피드 비교(R12) */
  speedEdge(opponentSet: PokemonSet, opponentAbility: string): boolean {
    return outspeedsAtMax(this.game, this.mySet, opponentSet, this.damageConditions(opponentAbility))
  }

  addFixed(card: CardSpec, moveId: string, opponentSet: PokemonSet): string {
    const f: FixedSpec = {
      id: rowId(card.id, ['fixed', moveId]),
      cardId: card.id,
      moveId,
      attacker: this.mySet,
      defender: opponentSet,
      conditions: this.damageConditions(this.me.ability),
    }
    this.fixed[f.id] = f
    const ids = card.fixedIds as string[]
    ids.push(f.id)
    return f.id
  }

  /** 내 쪽 세트(nature 공통)의 stat 성격 변형. 하락은 이 판정의 내 관여 능력치 밖에 둔다. */
  natures(stat: NatureVariants['stat'], refs: MoveStatRefs | undefined, attackerAbility: string): NatureVariants {
    const rel = relevantStats(refs, attackerAbility)
    return natureVariants(this.game, this.mySet.nature, stat, this.tab === 'defense' ? rel.defender : rel.attacker)
  }

  /** 이 탭이 보는 주인의 능동 수단만(TAB_MEANS_OWNERS) 랭크 변형으로 만든다. */
  variants(opp: Opponent, resolved: ResolvedSet, refs: CardRefStats) {
    const owners = TAB_MEANS_OWNERS[this.tab]
    const candidates = [...(owners.includes('opponent') ? this.opponentMeans(opp, resolved) : []), ...this.myMeans].filter((c) => owners.includes(c.owner))
    return rankVariants(this.game, candidates, this.me, resolved, refs)
  }

  /** 랭크 조건의 판정 후보 기술인가(첫 턴 전용 규칙·래더 상대 수단 동시채용 하한, rankMoveAllowed). */
  rankMoveAllowed(opp: Opponent, basis: RankBasis, attackerOwner: MeansCandidate['owner'], moveId: string): boolean {
    return rankMoveAllowed(basis, attackerOwner, moveId, opp.entry, this.input.criteria.rankShareMin)
  }

  // ---------- 탭별 행 ----------

  /** all = 내 공격기 전부(슬롯 순). 이 카드 분류의 기술만 후보(항목)다 — 다른 분류 기술은 그 분류 카드의 항목이다. */
  attackCard(opp: Opponent, seed: CardSeed, all: readonly MoveSlot[], berry?: BerryVariant & { triggers: readonly string[] }): void {
    const card = this.openCard(opp, seed, [], berry)
    const resolved = seed.resolved
    if (!resolved) return
    const oppSet = seed.assumption.set
    // 공격 탭은 채용률을 쓰지 않는다: 목록은 내 기술 칸 순서, 기준 기술은 내 기술 전부 중 가장 센 것(PRD R16, 사용자 결정 2026-11-14)
    const meta = this.moveMeta(all.map((s) => s.moveId), undefined)
    const inCategory = (slot: MoveSlot) => slot.refs?.defense === defenseStatOf(seed.category as Category)
    const slots = all.filter(inCategory)
    const base: MoveSlot[] = []
    const fixedOf = new Map<string, string>()
    for (const slot of slots) {
      const refs = slot.refs as MoveStatRefs
      if (refs.offense?.owner === 'target') fixedOf.set(slot.moveId, this.addFixed(card, slot.moveId, oppSet))
      else base.push(slot)
    }
    const row = (slot: MoveSlot, attacker: PokemonSet, defender: PokemonSet, extra: Partial<RowSpec>, parts: (string | null)[]): RowSpec => {
      const refs = slot.refs as MoveStatRefs
      const sweep = { side: 'attacker' as const, stat: refs.offense?.stat as StatId }
      const spec: Omit<RowSpec, 'id' | 'cardId' | 'order'> = {
        kind: 'base',
        judge: 'damage',
        moveId: slot.moveId,
        attacker,
        defender,
        conditions: this.damageConditions(this.me.ability),
        refs,
        dependsOn: extra.error ? [] : myDependsOn({ refs, sweep }, 'attacker', [], this.me.ability),
        ...extra,
      }
      if (!extra.error) {
        spec.sweep = sweep
        spec.natures = this.natures(sweep.stat as NatureVariants['stat'], refs, this.me.ability)
      }
      return this.addRow(card, parts, spec)
    }
    const baseRows = new Map(base.filter((slot) => !isLastRespects(slot)).map((slot) => [slot.moveId, row(slot, this.mySet, oppSet, {}, ['base', slot.moveId]).id]))
    this.addCondition(
      card,
      BASE_CONDITION,
      slots.filter((slot) => !isLastRespects(slot)).map((slot) => {
        const fixedId = fixedOf.get(slot.moveId)
        return fixedId === undefined ? this.candidate('row', baseRows.get(slot.moveId) as string, slot.moveId, this.me, meta) : this.candidate('fixed', fixedId, slot.moveId, this.me, meta)
      }),
    )
    const lastRespects = base.find(isLastRespects)
    if (lastRespects !== undefined) {
      for (const n of LAST_RESPECTS_FAINTS) {
        const conditions = faintConditions(this.damageConditions(this.me.ability), LAST_RESPECTS, n)
        const r = row(lastRespects, this.mySet, oppSet, { conditions }, ['faint', LAST_RESPECTS, String(n)])
        this.addCondition(card, faintConditionId(n), [this.candidate('row', r.id, LAST_RESPECTS, this.me, meta)])
      }
    }
    if (base.length === 0) return
    const refs: CardRefStats = {
      my: unique(base.map((s) => s.refs?.offense?.stat as BoostStat)),
      opponent: [defenseStatOf(seed.category as Category)],
    }
    for (const v of this.variants(opp, resolved, refs)) {
      const attacker = withBoosts(this.mySet, v.basis.myBoosts)
      const defender = withBoosts(oppSet, v.basis.opponentBoosts)
      const candidates: MoveCandidate[] = []
      for (const slot of base) {
        if (!this.rankMoveAllowed(opp, v.basis, 'me', slot.moveId)) continue
        // 랭크 변화가 그 기술의 판정 능력치(내 공격 능력치)에 들 때만 랭크 후 항목이다(명상은 물리기에 항목을 만들지 않는다).
        if (!v.basis.myBoosts[slot.refs?.offense?.stat as BoostStat]) continue
        const extra: Partial<RowSpec> = { kind: 'rank', basis: v.basis, conditions: faintConditions(this.damageConditions(this.me.ability), slot.moveId) }
        if (v.whiteHerbConsumed && isMultihit(this.game, slot.moveId)) extra.error = WHITE_HERB_MULTIHIT
        const r = row(slot, attacker, defender, extra, ['rank', slot.moveId, ...meansParts(v.basis)])
        candidates.push(this.candidate('row', r.id, slot.moveId, this.me, meta))
      }
      this.addCondition(card, rankCondition(v.basis), candidates)
    }
  }

  /** all = 상대 후보 공격기 전부(사용률 순). 이 카드 분류 기술과 스냅샷에 없는 기술(계산 불가 항목)이 후보다. */
  defenseCard(
    opp: Opponent,
    seed: CardSeed,
    all: readonly MoveSlot[],
    errors: readonly MoveSlot[],
    notices: readonly MoveNotice[],
    added: ReadonlySet<string>,
    power?: BerryVariant & { triggers: readonly string[] },
  ): void {
    const card = this.openCard(opp, seed, notices, power)
    const resolved = seed.resolved
    if (!resolved) return
    const oppSet = seed.assumption.set
    card.speedEdge = this.speedEdge(oppSet, resolved.ability)
    const baseConditions = this.damageConditions(resolved.ability)
    const meta = this.moveMeta([...all, ...errors].map((s) => s.moveId), opp.entry?.moves.shares, resolved)
    const def = defenseStatOf(seed.category as Category)
    const inCategory = (slot: MoveSlot) => slot.refs?.defense === def
    const slots = all.filter(inCategory)
    /** 후보: 극단 필터, 계획 단계 계산 불가면 그 오류 행 */
    const pair = (
      slot: MoveSlot,
      attacker: PokemonSet,
      defender: PokemonSet,
      basis: RankBasis | undefined,
      error: ErrorReason | undefined,
      parts: (string | null)[],
      fainted?: number,
    ): MoveCandidate => {
      const conditions = faintConditions(baseConditions, slot.moveId, fainted)
      const refs = slot.refs as MoveStatRefs
      const ability = resolved.ability
      if (error) {
        const spec: Omit<RowSpec, 'id' | 'cardId' | 'order'> = {
          kind: basis ? 'rank' : 'base',
          judge: 'damage',
          moveId: slot.moveId,
          attacker,
          defender,
          conditions,
          refs,
          dependsOn: [],
          error,
        }
        if (basis) spec.basis = basis
        return this.candidate('row', this.addRow(card, parts, spec).id, slot.moveId, resolved, meta, added)
      }
      const natures = this.natures(def, refs, ability)
      const f = this.addFilter(card, ['extreme', ...parts], {
        moveId: slot.moveId,
        attacker,
        defender,
        conditions,
        stats: ['hp', def],
        natures,
        dependsOn: myDependsOn({ refs, sweep: undefined }, 'defender', ['hp', def], ability),
        ...(basis ? { basis } : {}),
      })
      for (const stat of ['hp', def] as const) {
        const sweep = { side: 'defender' as const, stat }
        const spec: Omit<RowSpec, 'id' | 'cardId' | 'order'> = {
          kind: basis ? 'rank' : 'base',
          judge: 'damage',
          moveId: slot.moveId,
          sweep,
          attacker,
          defender,
          conditions,
          refs,
          dependsOn: myDependsOn({ refs, sweep }, 'defender', [], ability),
          gate: f.id,
          natures,
        }
        if (basis) spec.basis = basis
        this.addRow(card, [...parts, stat], spec)
      }
      return this.candidate('filter', f.id, slot.moveId, resolved, meta, added)
    }
    const group = (id: string, attacker: PokemonSet, defender: PokemonSet, basis: RankBasis | undefined, herbConsumed: boolean) => {
      const candidates: MoveCandidate[] = []
      for (const slot of slots) {
        if (basis === undefined && isLastRespects(slot)) continue
        if (basis) {
          if (!this.rankMoveAllowed(opp, basis, 'opponent', slot.moveId)) continue
          // 랭크 변화가 그 기술의 판정 능력치(상대 공격 능력치)에 들 때만 랭크 후 항목이다(상대 속임수는 내 능력치라 없다).
          const offense = slot.refs?.offense
          if (offense?.owner !== 'self' || !basis.opponentBoosts[offense.stat as BoostStat]) continue
        }
        const error = herbConsumed && isMultihit(this.game, slot.moveId) ? WHITE_HERB_MULTIHIT : undefined
        const parts = basis ? ['rank', slot.moveId, ...meansParts(basis)] : ['base', slot.moveId]
        candidates.push(pair(slot, attacker, defender, basis, error, parts))
      }
      if (basis === undefined) {
        for (const slot of errors) {
          const r = this.addRow(card, ['base', slot.moveId], {
            kind: 'base',
            judge: 'damage',
            moveId: slot.moveId,
            attacker: oppSet,
            defender: this.mySet,
            conditions: baseConditions,
            dependsOn: [],
            error: slot.error,
          })
          candidates.push(this.candidate('row', r.id, slot.moveId, resolved, meta, added))
        }
      }
      this.addCondition(card, id, candidates)
    }
    group(BASE_CONDITION, oppSet, this.mySet, undefined, false)
    const lastRespects = slots.find(isLastRespects)
    if (lastRespects !== undefined) {
      for (const n of LAST_RESPECTS_FAINTS) {
        this.addCondition(card, faintConditionId(n), [pair(lastRespects, oppSet, this.mySet, undefined, undefined, ['faint', LAST_RESPECTS, String(n)], n)])
      }
    }
    if (slots.length === 0) return
    const refs: CardRefStats = {
      opponent: unique(slots.filter((s) => s.refs?.offense?.owner === 'self').map((s) => s.refs?.offense?.stat as BoostStat)),
      my: [],
    }
    for (const v of this.variants(opp, resolved, refs)) {
      const attacker = withBoosts(oppSet, v.basis.opponentBoosts)
      const defender = withBoosts(this.mySet, v.basis.myBoosts)
      group(rankCondition(v.basis), attacker, defender, v.basis, v.whiteHerbConsumed)
    }
  }
}

/**
 * 방어 탭 선공기 우선 조건: 상대 세트를 스피드 SP 최대·스피드 상승 성격으로 바꾸고 구애스카프를 빼도(다른 도구·특성·폼 유지,
 * 랭크·순풍 없음, SP 합계 상한 무시) 내 현재 스피드(도구·특성 포함)보다 엄격히 느리다. 스피드 비교를 지원하지 않는 세트면 false.
 * conditions = 그 판정의 조건(공격측 특성 날씨·필드: 쓸쓸이·엽록소 등). 구름보기·에어록은 compareSpeed가 반영한다.
 */
export function outspeedsAtMax(game: Snapshot, mySet: PokemonSet, opponentSet: PokemonSet, conditions?: BattleConditions): boolean {
  const fastest: PokemonSet = {
    ...opponentSet,
    sp: { ...opponentSet.sp, spe: game.manifest.rules.spMaxPerStat },
    nature: natureVariants(game, opponentSet.nature, 'spe', []).plus,
  }
  if (fastest.item === SCARF) delete fastest.item
  try {
    const r = compareSpeed(game, mySet, fastest, conditions, { ignoreSpTotal: true })
    return r.defenderSpeed < r.attackerSpeed
  } catch (e) {
    errorReasons(e)
    return false
  }
}

const unique = <T>(xs: readonly T[]): T[] => [...new Set(xs)]

/** 기본 후보 + 추가 기술(이미 있으면 그대로), 사용률 순(동률 id 순, 통계에 없는 기술은 0) */
function withAdded(base: readonly string[], added: ReadonlySet<string>, entry: MetaEntry): string[] {
  const share = (id: string): number => entry.moves.shares[id] ?? 0
  return unique([...base, ...added]).sort((a, b) => share(b) - share(a) || byString(a, b))
}

const meansParts = (b: RankBasis): string[] => [b.owner, b.means.kind, b.means.id]

function emptyPlan(input: CardInput, tab: DamageTab, mySp: SpTable, status: TabPlan['status'], conflicts: string[]): TabPlan {
  return { ...planHead(input, tab, mySp), status, cards: [], rows: {}, filters: {}, fixed: {}, customTargetConflicts: conflicts, notices: [] }
}

function planHead(input: CardInput, tab: DamageTab, mySp: SpTable) {
  const { manifest } = input.view.meta
  const { rules } = input.game.manifest
  return {
    tab,
    game: input.game,
    source: { match: manifest.match, month: manifest.month, cutoff: manifest.source.cutoff, format: manifest.source.format },
    mySp,
    mySide: tab === 'defense' ? ('defender' as const) : ('attacker' as const),
    rollSteps: normalizeRollSteps(input.rollSteps),
    spTotal: rules.spTotal,
    spMaxPerStat: rules.spMaxPerStat,
  }
}

/** 공격·방어 판정은 순풍 없음(자이로볼 등 스피드 의존 위력도 순풍 없음 가정). 나머지 조건은 코어 기본값 */
const DAMAGE_CONDITIONS: BattleConditions = { attacker: { tailwind: false }, defender: { tailwind: false } }

/** 래더 상대(사용률 순: 범위 안 + 그 탭에 래더 추가 배분이 있는 범위 밖) + 목록 밖 타겟(추가 순). 목록 안 종 타겟은 충돌로 돌린다. */
function opponentsOf(input: CardInput, tab: DamageTab): { ladder: LadderOpponent[]; custom: CustomTarget[]; conflicts: string[] } {
  const added = input.addedBundles ?? []
  const hasAdded = (id: string) => added.some((a) => a.tab === tab && a.source === 'ladder' && a.opponentId === id)
  return { ladder: ladderOpponents(input.view, input.filters, hasAdded), ...customTargetsOf(input) }
}

const ladderOpponent = (entry: MetaEntry, addedOnly: boolean): Opponent => {
  const header: OpponentHeader = { id: entry.id, source: 'ladder', rank: entry.rank, usage: entry.usage }
  if (addedOnly) header.addedOnly = true
  return { header, entry }
}

/** 목록 밖 타겟(추가 순): 메타 목록 안 종은 충돌, 기술 없음·같은 rosterId 반복은 뺀다 */
function customTargetsOf(input: CardInput): { custom: CustomTarget[]; conflicts: string[] } {
  const { view, customTargets } = input
  const custom: CustomTarget[] = []
  const conflicts: string[] = []
  const seen = new Set<string>()
  for (const t of customTargets) {
    if (view.entry(t.rosterId)) {
      conflicts.push(t.rosterId)
      continue
    }
    if (t.moves.length === 0 || seen.has(t.rosterId)) continue
    seen.add(t.rosterId)
    custom.push(t)
  }
  return { custom, conflicts }
}

const isStatus = (game: Snapshot, moveId: string): boolean => hasMove(game, moveId) && game.data.moves[moveId].category === 'Status'

/**
 * 방어 탭 래더 상대 기본 후보(사용률 순, 동률 id 순): 변화기를 뺀 기술 중 사용률 ≥ DEFENSE_MOVE_SHARE_MIN이고 나에게 배율 ≥ 1
 * (effectivenessAgainst: 상대 특성 타입 변화·상대 특성 날씨·필드의 웨더볼·대지의파동 타입·사이코필드 접지 선공기 무효·기술 특례 × 내 특성 보정).
 * 하나도 없으면 변화기를 뺀 사용률 1위 하나. 지닌 도구로 위력이 정해지는 기술(내던지기)은 도구 없는 기본 줄에서 실패하므로 뺀다. me = 내 계산 폼 타입·특성·도구(접지), opponentAbility = 상대 대표 세트의 계산 특성. 스냅샷에 없거나 배율을 낼 수 없는 기술은 배율 조건 없이 남긴다(계산 불가 항목).
 */
export function defenseMoveIds(game: Snapshot, entry: MetaEntry, me: EffectivenessDefender, opponentAbility: string): string[] {
  const ranked = Object.entries(entry.moves.shares)
    .filter(([id]) => !isStatus(game, id) && !HELD_ITEM_POWER_MOVES.includes(id))
    .sort((a, b) => b[1] - a[1] || byString(a[0], b[0]))
  const hits = (id: string): boolean => {
    if (!hasMove(game, id)) return true
    try {
      return effectivenessAgainst(game, id, { ability: opponentAbility, weather: abilityWeather(opponentAbility), terrain: abilityTerrain(opponentAbility) }, me) >= 1
    } catch (e) {
      errorReasons(e)
      return true
    }
  }
  const out = ranked.filter(([id, share]) => share >= DEFENSE_MOVE_SHARE_MIN && hits(id)).map(([id]) => id)
  return out.length > 0 ? out : ranked.slice(0, 1).map(([id]) => id)
}

/** 그 상대에 사용자가 추가한 기술(추가 순, 중복 제거). 스냅샷에 없는 기술·변화기·내던지기(HELD_ITEM_POWER_MOVES)는 뺀다 */
function addedMoveIds(input: CardInput, opponentId: string): string[] {
  const out: string[] = []
  for (const a of input.addedMoves ?? []) {
    if (a.opponentId !== opponentId || !hasMove(input.game, a.moveId) || isStatus(input.game, a.moveId) || HELD_ITEM_POWER_MOVES.includes(a.moveId) || out.includes(a.moveId)) continue
    out.push(a.moveId)
  }
  return out
}

/** 상대 대표 세트의 계산 특성(메가면 메가 폼 특성). 해석할 수 없으면 대표 세트 특성 그대로 */
function representativeAbility(input: CardInput, entry: MetaEntry): string {
  const a = representativeAssumption(input.view, entry.id)
  const r = resolveAssumption(input.game, a)
  return r.usable ? r.resolved.ability : a.set.ability
}

interface CategoryKey {
  category: Category
  keyStats: readonly StatId[]
}

/** 내 세트 검증(boosts는 0으로)과 계획 빌더 생성 */
function startPlan(input: CardInput, tab: DamageTab): { kind: 'ok'; b: PlanBuilder } | { kind: 'my-set-error'; reasons: ErrorReason[] } {
  const raw = input.mySet as unknown
  const mySet = isPlainObject(raw) ? withBoosts(input.mySet, {}) : input.mySet
  let me: ResolvedSet
  try {
    me = validateSet(input.game, mySet)
  } catch (e) {
    return { kind: 'my-set-error', reasons: errorReasons(e) }
  }
  return { kind: 'ok', b: new PlanBuilder(input, tab, me, mySet, DAMAGE_CONDITIONS, setMeansCandidates(me, 'me')) }
}

/** 공격 탭 분류: 내 공격기가 있는 분류(CATEGORY_ORDER 순), 키 능력치 = H + 그 분류 방어 능력치 */
function attackCategories(slots: readonly MoveSlot[]): CategoryKey[] {
  return CATEGORY_ORDER.filter((c) => slots.some((s) => s.refs?.defense === defenseStatOf(c))).map((category) => ({ category, keyStats: ['hp', defenseStatOf(category)] }))
}

/** 방어 탭 상대 후보 기술(사용률 순)과 사용자 추가 표시 대상(기본 후보에 없는 추가 기술) */
function defenseMoves(b: PlanBuilder, opp: Opponent): { moveIds: readonly string[]; added: Set<string> } {
  const entry = opp.entry
  if (opp.custom || entry === undefined) return { moveIds: opp.custom?.moves ?? [], added: new Set<string>() }
  const { input, me } = b
  const myDefender: EffectivenessDefender = { types: me.species.types, ability: me.ability, item: me.item }
  const base = defenseMoveIds(input.game, entry, myDefender, representativeAbility(input, entry))
  // 기본 후보에 이미 있는 기술은 추가 표시(×)를 달지 않는다: 지워도 후보에서 빠지지 않으므로
  const added = new Set(addedMoveIds(input, entry.id).filter((id) => !base.includes(id)))
  return { moveIds: withAdded(base, added, entry), added }
}

/** 방어 탭 분류: 상대 기술이 있는 분류(CATEGORY_ORDER 순). 계산 가능한 기술 없이 오류 기술만 있으면 물리 하나 */
function defenseCategories(ok: readonly MoveSlot[], errors: readonly MoveSlot[]): CategoryKey[] {
  let categories = CATEGORY_ORDER.filter((c) => ok.some((s) => s.refs?.defense === defenseStatOf(c)))
  if (categories.length === 0 && errors.length > 0) categories = ['physical']
  return categories.map((category) => {
    const inCategory = ok.filter((s) => s.refs?.defense === defenseStatOf(category))
    // 스피드 의존 기술의 S는 묶음 대표 S로 계산하고 키에 넣지 않는다(목숨걸기 H 같은 나머지 의존은 넣는다).
    const used = new Set<StatId>(
      inCategory.filter((s) => s.refs?.offense?.owner === 'self').flatMap((s) => (s.refs as MoveStatRefs).attackerStats.filter((stat) => stat !== 'spe')),
    )
    // 키 능력치는 STAT_IDS 순: 묶음 키·카드 id·입력 칸 순서가 기술 순서에 따라 달라지지 않는다
    const keyStats = STAT_IDS.filter((stat) => used.has(stat))
    return { category, keyStats }
  })
}

const stripItem = (b: PlanBuilder, opp: Opponent, seeds: CardSeed[]): CardSeed[] => {
  const strip = opp.entry !== undefined && opp.entry.mega === undefined
  return strip ? seeds.map((s) => (s.assumption.set.item === undefined ? s : b.withItem(s, undefined))) : seeds
}

export function planTab(input: CardInput, tab: DamageTab): TabPlan {
  const raw = input.mySet as unknown
  const mySp = (isPlainObject(raw) && isPlainObject(raw.sp) ? { ...raw.sp } : {}) as SpTable
  const { ladder, custom, conflicts } = opponentsOf(input, tab)

  const started = startPlan(input, tab)
  if (started.kind === 'my-set-error') return emptyPlan(input, tab, mySp, { kind: 'my-set-error', reasons: started.reasons }, conflicts)
  const { b } = started
  const tabNotices: MoveNotice[] = []
  const opponents: Opponent[] = [
    ...custom.map((t): Opponent => ({ header: { id: t.rosterId, source: 'custom' }, custom: t })),
    ...ladder.map((l) => ladderOpponent(l.entry, l.addedOnly)),
  ]

  if (tab === 'attack') {
    const slots = b.myAttackSlots(tabNotices)
    const categories = attackCategories(slots)
    for (const opp of opponents) {
      // 상대(맞는 쪽) 도구 중 내 대미지·1타 판정에 관여하는 건 반감열매·기합의띠뿐이고 기합의띠는 고려하지 않는다:
      // 래더 기본 카드는 도구 없음(메가 항목은 메가스톤 유지), 반감열매는 점유율 기준을 넘는 것마다 별도 변형 카드(원래 카드 바로 뒤).
      // 목록 밖 타겟은 사용자가 고른 프리셋 도구 그대로다.
      const seeds = categories.map(({ category, keyStats }) => stripItem(b, opp, b.seedsOf(opp, category, keyStats)))
      seeds.forEach((list) => list.forEach((seed) => b.attackCard(opp, seed, slots)))
      for (const berry of b.berryVariants(opp, seeds.flat(), slots)) {
        seeds.forEach((list) => list.forEach((seed) => b.attackCard(opp, b.withItem(seed, berry.item), slots, berry)))
      }
    }
  } else {
    for (const opp of opponents) {
      const notices: MoveNotice[] = []
      const { moveIds, added } = defenseMoves(b, opp)
      const all = b.opponentSlots(moveIds, notices)
      const ok = all.filter((s) => s.refs)
      const errors = all.filter((s) => s.error)
      // 래더 기본 카드는 상대 도구 없음(메가 항목은 메가스톤 유지), 화력 도구는 점유율 기준 이상마다 별도 변형 카드(원래 카드 바로 뒤, R14).
      // 목록 밖 타겟은 사용자가 고른 프리셋 도구 그대로다.
      const seeds = defenseCategories(ok, errors).map(({ category, keyStats }) => stripItem(b, opp, b.seedsOf(opp, category, keyStats)))
      seeds.forEach((list) => list.forEach((seed) => b.defenseCard(opp, seed, ok, errors, notices, added)))
      for (const power of b.powerItemVariants(opp, seeds.flat(), ok)) {
        seeds.forEach((list) => list.forEach((seed) => b.defenseCard(opp, b.withItem(seed, power.item), ok, errors, notices, added, power)))
      }
    }
  }

  return {
    ...planHead(input, tab, mySp),
    status: { kind: 'ok' },
    cards: b.cards,
    rows: b.rows,
    filters: b.filters,
    fixed: b.fixed,
    customTargetConflicts: conflicts,
    notices: tabNotices,
  }
}

export interface OpponentCategorySeeds {
  category: Category
  keyStats: readonly StatId[]
  /** 관측 묶음: 래더 = 점유율 기준 이상(minority 아님)만(추가분만 상대도 같다), 목록 밖 = 프리셋 3개 */
  observed: readonly BundleSpec[]
  /** planTab이 이 상대·분류에서 만드는 기본 카드(도구 변형 제외)의 묶음 전부(minority·대표 가정·사용자 추가 포함) */
  cards: readonly BundleSpec[]
  /** 입력 기본값 원천: 래더 = 첫 관측 씨앗 가정 SP, 목록 밖 = 프리셋 1(편집 반영) SP */
  baseSp: SpTable
}

export type OpponentSeedsResult = { kind: 'ok'; categories: readonly OpponentCategorySeeds[] } | { kind: 'my-set-error' } | { kind: 'not-found' }

/** 상대 한 마리의 분류별 씨앗. planTab과 같은 분류·키 능력치·씨앗 규칙을 쓰고 카드는 만들지 않는다. 범위 밖 래더 상대는 추가분만 규칙을 따른다 */
export function opponentSeeds(input: CardInput, tab: DamageTab, target: { source: TargetSource; id: string }): OpponentSeedsResult {
  const opp = targetOpponent(input, target)
  if (opp === undefined) return { kind: 'not-found' }
  const started = startPlan(input, tab)
  if (started.kind === 'my-set-error') return { kind: 'my-set-error' }
  const { b } = started
  let categories: CategoryKey[]
  if (tab === 'attack') categories = attackCategories(b.myAttackSlots([]))
  else {
    const all = b.opponentSlots(defenseMoves(b, opp).moveIds, [])
    categories = defenseCategories(
      all.filter((s) => s.refs),
      all.filter((s) => s.error),
    )
  }
  const out: OpponentCategorySeeds[] = []
  for (const { category, keyStats } of categories) {
    const seeds = b.seedSets(opp, category, keyStats)
    const first = seeds.observed[0]
    if (first === undefined) continue
    const observed = seeds.observed.filter((s) => opp.custom !== undefined || !s.bundle.minority).map((s) => s.bundle)
    out.push({ category, keyStats, observed, cards: seeds.cards.map((s) => s.bundle), baseSp: { ...first.assumption.set.sp } })
  }
  return { kind: 'ok', categories: out }
}

function targetOpponent(input: CardInput, target: { source: TargetSource; id: string }): Opponent | undefined {
  if (target.source === 'ladder') {
    const e = input.view.entry(target.id)
    return e === undefined ? undefined : ladderOpponent(e, !isInRange(input.view, input.filters, e.id))
  }
  const t = customTargetsOf(input).custom.find((c) => c.rosterId === target.id)
  return t === undefined ? undefined : { header: { id: t.rosterId, source: 'custom' }, custom: t }
}
