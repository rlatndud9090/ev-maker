// 탭 계획: 상대 순서·묶음·카드 골격·행 명세. 코어 판정은 부르지 않는다(검증·가정 해석·참조 조회만).
import {
  CoreError,
  CoreInputError,
  STAT_IDS,
  checkSpeedSupport,
  moveStatRefs,
  normalizeRollSteps,
  validateSet,
  type BattleConditions,
  type BoostTable,
  type MoveStatRefs,
  type PokemonSet,
  type ResolvedSet,
  type SpTable,
} from '../core'
import type { MetaEntry } from '../data/meta-schema'
import { NO_ITEM } from '../data/meta-schema'
import type { Snapshot, StatId } from '../data/schema'
import { observedSpreadAssumption, representativeAssumption, resolveAssumption, type Assumption } from '../meta'
import { bundleStats, bundlesOf, natureSign } from './bundles'
import { addedBundleKey, addedCardId, cardId as makeCardId, presetKey, rowId } from './ids'
import { presetAssumption } from './presets'
import { ladderMeans, rankVariants, setMeansCandidates, type CardRefStats, type MeansCandidate } from './rank'
import type { BoostStat } from './rankMeans'
import { natureVariants } from './natures'
import { myDependsOn, relevantStats } from './relevance'
import {
  CATEGORY_ORDER,
  type BundleSpec,
  type CardInput,
  type CardSpec,
  type Category,
  type ConditionGroup,
  type CustomTarget,
  type ErrorReason,
  type ExtremeSpec,
  type FixedSpec,
  type ProbeSpec,
  type MoveCandidate,
  type MoveNotice,
  type NatureVariants,
  type OpponentHeader,
  type PresetIndex,
  type RankBasis,
  type RowSpec,
  type ScarfBasis,
  type Tab,
  type TabPlan,
} from './types'

/** 방어 탭 상대 기술 수(변화기 제외 점유율 상위) */
export const DEFENSE_MOVES = 5
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
const isPriority = (game: Snapshot, moveId: string): boolean => hasMove(game, moveId) && game.data.moves[moveId].priority > 0
const BASE_CONDITION = JSON.stringify(['base'])
const rankCondition = (b: RankBasis): string => JSON.stringify(['rank', ...meansParts(b)])

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
  readonly probes: Record<string, ProbeSpec> = {}

  readonly input: CardInput
  readonly tab: Tab
  readonly me: ResolvedSet
  readonly mySet: PokemonSet
  readonly conditions: BattleConditions
  readonly myMeans: readonly MeansCandidate[]

  constructor(input: CardInput, tab: Tab, me: ResolvedSet, mySet: PokemonSet, conditions: BattleConditions, myMeans: readonly MeansCandidate[]) {
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

  ladderSeeds(entry: MetaEntry, category: Category | null, keyStats: readonly StatId[]): CardSeed[] {
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
    return [...observed, ...this.userSeeds(entry, category, keyStats, observed)]
  }

  /**
   * 사용자 추가 배분(이 탭·상대·분류, 추가 순). 가정 세트 = 대표(최고 점유율) 묶음 가정에서 키 능력치 SP만 바꾸고,
   * 대표 성격이 키 능력치에 보정을 주면 무보정 성격으로 바꾼다. SP 합이 상한을 넘으면 키가 아닌 능력치(큰 것부터)에서 덜어 낸다.
   * 키 능력치 집합이 다르거나 SP가 0~최대 정수가 아니면 받지 않고, 관측 묶음·앞선 추가와 키가 같으면 새 카드를 만들지 않는다.
   */
  userSeeds(entry: MetaEntry, category: Category | null, keyStats: readonly StatId[], observed: readonly CardSeed[]): CardSeed[] {
    const { game, input } = this
    const base = observed[0]?.assumption
    if (base === undefined) return []
    const { spTotal, spMaxPerStat } = game.manifest.rules
    const keys = new Set(keyStats)
    const seen = new Set(observed.map((s) => s.bundle.key))
    const out: CardSeed[] = []
    ;(input.addedBundles ?? []).forEach((added, index) => {
      if (added.tab !== this.tab || added.opponentId !== entry.id || added.category !== category) return
      const given = Object.keys(added.sp) as StatId[]
      if (given.length !== keys.size || !given.every((s) => keys.has(s))) return
      if (!given.every((s) => isSp(added.sp[s], spMaxPerStat))) return
      const stats = STAT_IDS.filter((s) => keys.has(s)).map((stat) => ({ stat, sp: added.sp[stat] as number, nature: 'neutral' as const }))
      const key = addedBundleKey(stats)
      if (seen.has(key)) return
      seen.add(key)
      const touchesKey = keyStats.some((s) => natureSign(game, base.set.nature, s) !== 'neutral')
      const nature = touchesKey ? neutralNature(game, base.set.nature) : base.set.nature
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

  seed(category: Category | null, bundle: BundleSpec, assumption: Assumption): CardSeed {
    const r = resolveAssumption(this.game, assumption)
    if (!r.usable) return { category, bundle, assumption, error: errorReasons(r.error)[0] }
    if (this.tab === 'speed') {
      try {
        checkSpeedSupport(this.game, assumption.set)
      } catch (e) {
        return { category, bundle, assumption, error: errorReasons(e)[0] }
      }
    }
    return { category, bundle, assumption, resolved: r.resolved }
  }

  opponentMeans(opp: Opponent, resolved: ResolvedSet): MeansCandidate[] {
    if (opp.entry) return ladderMeans(opp.entry, this.input.criteria.rankShareMin)
    return setMeansCandidates(resolved, 'opponent')
  }

  /** 카드를 만들고 rows/filters/fixed를 채울 수 있게 빈 목록을 돌려준다. */
  openCard(opp: Opponent, seed: CardSeed, notices: readonly MoveNotice[]): CardSpec {
    const bundlePart = seed.bundle.presetIndex ?? seed.bundle.key
    // 사용자 추가 배분은 'user' 표지를 붙여 같은 키의 관측 묶음 카드와 id가 겹치지 않게 한다.
    const card: CardSpec = {
      id:
        seed.bundle.userAdded === undefined
          ? makeCardId([this.tab, opp.header.source, opp.header.id, seed.category, bundlePart])
          : addedCardId(this.tab, opp.header.id, seed.category, seed.bundle.key),
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

  candidate(target: MoveCandidate['target'], id: string, moveId: string): MoveCandidate {
    return { target, id, moveId, priority: isPriority(this.game, moveId) }
  }

  /** 이 카드에 행이 있는 후보가 없으면(비교 전용 후보뿐) 조건을 두지 않는다. */
  addCondition(card: CardSpec, id: string, candidates: readonly MoveCandidate[]): void {
    if (!candidates.some((c) => c.target !== 'probe')) return
    const groups = card.conditions as ConditionGroup[]
    groups.push({ id, candidates })
  }

  /** 다른 분류 기술의 비교 전용 후보(행 없음). 이 카드 대표 세트·같은 조건으로 단건 판정만 한다. */
  crossProbe(
    card: CardSpec,
    parts: readonly (string | null)[],
    moveId: string,
    side: ProbeSpec['side'],
    attacker: PokemonSet,
    defender: PokemonSet,
  ): MoveCandidate {
    const p: ProbeSpec = { id: rowId(card.id, ['cross', ...parts]), cardId: card.id, moveId, side, attacker, defender, conditions: this.conditions }
    this.probes[p.id] = p
    return this.candidate('probe', p.id, moveId)
  }

  addFixed(card: CardSpec, moveId: string, opponentSet: PokemonSet): string {
    const f: FixedSpec = {
      id: rowId(card.id, ['fixed', moveId]),
      cardId: card.id,
      moveId,
      attacker: this.mySet,
      defender: opponentSet,
      conditions: this.conditions,
    }
    this.fixed[f.id] = f
    const ids = card.fixedIds as string[]
    ids.push(f.id)
    return f.id
  }

  /** 내 쪽 세트(nature 공통)의 stat 성격 변형. 하락은 이 판정의 내 관여 능력치 밖에 둔다. */
  natures(stat: NatureVariants['stat'], judge: 'damage' | 'speed', refs: MoveStatRefs | undefined, attackerAbility: string): NatureVariants {
    const rel = relevantStats(judge, refs, attackerAbility)
    return natureVariants(this.game, this.mySet.nature, stat, this.tab === 'defense' ? rel.defender : rel.attacker)
  }

  variants(opp: Opponent, resolved: ResolvedSet, refs: CardRefStats) {
    return rankVariants(this.game, [...this.opponentMeans(opp, resolved), ...this.myMeans], this.me, resolved, refs)
  }

  // ---------- 탭별 행 ----------

  /**
   * all = 내 공격기 전부(슬롯 순). 이 카드 분류의 기술만 행을 만들고, 다른 분류 기술은 비교 전용 후보로만 넣어
   * 조건마다 4개 기술 전부에서 가장 센 기술을 고른다(사용자 피드백 2026-11-11).
   */
  attackCard(opp: Opponent, seed: CardSeed, all: readonly MoveSlot[]): void {
    const card = this.openCard(opp, seed, [])
    const resolved = seed.resolved
    if (!resolved) return
    const oppSet = seed.assumption.set
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
        conditions: this.conditions,
        refs,
        dependsOn: extra.error ? [] : myDependsOn({ judge: 'damage', refs, sweep }, 'attacker', [], this.me.ability),
        ...extra,
      }
      if (!extra.error) {
        spec.sweep = sweep
        spec.natures = this.natures(sweep.stat as NatureVariants['stat'], 'damage', refs, this.me.ability)
      }
      return this.addRow(card, parts, spec)
    }
    const baseRows = new Map(base.map((slot) => [slot.moveId, row(slot, this.mySet, oppSet, {}, ['base', slot.moveId]).id]))
    this.addCondition(
      card,
      BASE_CONDITION,
      all.map((slot) => {
        if (!inCategory(slot)) return this.crossProbe(card, ['base', slot.moveId], slot.moveId, 'attacker', this.mySet, oppSet)
        const fixedId = fixedOf.get(slot.moveId)
        return fixedId === undefined ? this.candidate('row', baseRows.get(slot.moveId) as string, slot.moveId) : this.candidate('fixed', fixedId, slot.moveId)
      }),
    )
    if (base.length === 0) return
    const refs: CardRefStats = {
      my: unique(base.map((s) => s.refs?.offense?.stat as BoostStat)),
      opponent: [defenseStatOf(seed.category as Category)],
    }
    for (const v of this.variants(opp, resolved, refs)) {
      const attacker = withBoosts(this.mySet, v.basis.myBoosts)
      const defender = withBoosts(oppSet, v.basis.opponentBoosts)
      const candidates: MoveCandidate[] = []
      for (const slot of all) {
        // 상대 능력치를 쓰는 기술(SP 무관 판정)은 기본 조건에서만 고른다.
        if (slot.refs?.offense?.owner === 'target') continue
        const herbError = v.whiteHerbConsumed && isMultihit(this.game, slot.moveId)
        const parts = ['rank', slot.moveId, ...meansParts(v.basis)]
        if (!inCategory(slot)) {
          if (!herbError) candidates.push(this.crossProbe(card, parts, slot.moveId, 'attacker', attacker, defender))
          continue
        }
        const extra: Partial<RowSpec> = { kind: 'rank', basis: v.basis }
        if (herbError) extra.error = WHITE_HERB_MULTIHIT
        const r = row(slot, attacker, defender, extra, parts)
        if (r.error === undefined) candidates.push(this.candidate('row', r.id, slot.moveId))
      }
      this.addCondition(card, rankCondition(v.basis), candidates)
    }
  }

  /** all = 상대 후보 공격기 전부(사용률 순). 공격 탭과 같이 다른 분류 기술은 비교 전용 후보로만 넣는다. */
  defenseCard(opp: Opponent, seed: CardSeed, all: readonly MoveSlot[], errors: readonly MoveSlot[], notices: readonly MoveNotice[]): void {
    const card = this.openCard(opp, seed, notices)
    const resolved = seed.resolved
    if (!resolved) return
    const oppSet = seed.assumption.set
    const def = defenseStatOf(seed.category as Category)
    const inCategory = (slot: MoveSlot) => slot.refs?.defense === def
    const slots = all.filter(inCategory)
    /** 극단 필터 id(계획 단계 계산 불가면 undefined) */
    const pair = (
      slot: MoveSlot,
      attacker: PokemonSet,
      defender: PokemonSet,
      basis: RankBasis | undefined,
      error: ErrorReason | undefined,
      parts: (string | null)[],
    ): string | undefined => {
      const refs = slot.refs as MoveStatRefs
      const ability = resolved.ability
      if (error) {
        const spec: Omit<RowSpec, 'id' | 'cardId' | 'order'> = {
          kind: basis ? 'rank' : 'base',
          judge: 'damage',
          moveId: slot.moveId,
          attacker,
          defender,
          conditions: this.conditions,
          refs,
          dependsOn: [],
          error,
        }
        if (basis) spec.basis = basis
        this.addRow(card, parts, spec)
        return undefined
      }
      const natures = this.natures(def, 'damage', refs, ability)
      const f = this.addFilter(card, ['extreme', ...parts], {
        moveId: slot.moveId,
        attacker,
        defender,
        conditions: this.conditions,
        stats: ['hp', def],
        natures,
        dependsOn: myDependsOn({ judge: 'damage', refs, sweep: undefined }, 'defender', ['hp', def], ability),
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
          conditions: this.conditions,
          refs,
          dependsOn: myDependsOn({ judge: 'damage', refs, sweep }, 'defender', [], ability),
          gate: f.id,
          natures,
        }
        if (basis) spec.basis = basis
        this.addRow(card, [...parts, stat], spec)
      }
      return f.id
    }
    /** 행을 만들거나(이 분류) 비교 전용 후보를 넣는다(다른 분류). 계산 불가는 후보가 아니다. */
    const group = (id: string, attacker: PokemonSet, defender: PokemonSet, basis: RankBasis | undefined, herbConsumed: boolean) => {
      const candidates: MoveCandidate[] = []
      for (const slot of all) {
        const error = herbConsumed && isMultihit(this.game, slot.moveId) ? WHITE_HERB_MULTIHIT : undefined
        const parts = basis ? ['rank', slot.moveId, ...meansParts(basis)] : ['base', slot.moveId]
        if (!inCategory(slot)) {
          if (!error) candidates.push(this.crossProbe(card, parts, slot.moveId, 'defender', attacker, defender))
          continue
        }
        const filterId = pair(slot, attacker, defender, basis, error, parts)
        if (filterId !== undefined) candidates.push(this.candidate('filter', filterId, slot.moveId))
      }
      this.addCondition(card, id, candidates)
    }
    group(BASE_CONDITION, oppSet, this.mySet, undefined, false)
    for (const slot of errors) {
      this.addRow(card, ['base', slot.moveId], {
        kind: 'base',
        judge: 'damage',
        moveId: slot.moveId,
        attacker: oppSet,
        defender: this.mySet,
        conditions: this.conditions,
        dependsOn: [],
        error: slot.error,
      })
    }
    if (slots.length === 0) return
    const refs: CardRefStats = {
      opponent: unique(slots.filter((s) => s.refs?.offense?.owner === 'self').map((s) => s.refs?.offense?.stat as BoostStat)),
      my: unique([def, ...(slots.some((s) => s.refs?.offense?.owner === 'target') ? (['atk'] as const) : [])]),
    }
    for (const v of this.variants(opp, resolved, refs)) {
      const attacker = withBoosts(oppSet, v.basis.opponentBoosts)
      const defender = withBoosts(this.mySet, v.basis.myBoosts)
      group(rankCondition(v.basis), attacker, defender, v.basis, v.whiteHerbConsumed)
    }
  }

  speedCard(opp: Opponent, seed: CardSeed, scarf: boolean): void {
    const card = this.openCard(opp, seed, [])
    const resolved = seed.resolved
    if (!resolved) return
    const oppSet = seed.assumption.set
    const sweep = { side: 'attacker' as const, stat: 'spe' as const }
    const row = (kind: RowSpec['kind'], attacker: PokemonSet, defender: PokemonSet, parts: (string | null)[], basis?: RankBasis | ScarfBasis) => {
      const spec: Omit<RowSpec, 'id' | 'cardId' | 'order'> = {
        kind,
        judge: 'speed',
        sweep,
        attacker,
        defender,
        conditions: this.conditions,
        dependsOn: myDependsOn({ judge: 'speed', refs: undefined, sweep }, 'attacker'),
        natures: this.natures('spe', 'speed', undefined, this.me.ability),
      }
      if (basis) spec.basis = basis
      this.addRow(card, parts, spec)
    }
    row('base', this.mySet, oppSet, ['base'])
    for (const v of this.variants(opp, resolved, { my: ['spe'], opponent: ['spe'] })) {
      row('rank', withBoosts(this.mySet, v.basis.myBoosts), withBoosts(oppSet, v.basis.opponentBoosts), ['rank', ...meansParts(v.basis)], v.basis)
    }
    if (!scarf || !opp.entry) return
    const shares = opp.entry.items.shares
    if (oppSet.item === SCARF) {
      const other = Object.entries(shares)
        .filter(([id]) => id !== SCARF)
        .sort((a, b) => b[1] - a[1] || byString(a[0], b[0]))[0]
      if (!other) return
      const [item, share] = other
      const set = { ...oppSet }
      if (item === NO_ITEM) delete set.item
      else set.item = item
      row('non-scarf', this.mySet, set, ['non-scarf', item], { kind: 'non-scarf', item, share })
    } else if ((shares[SCARF] ?? 0) >= this.input.criteria.scarfShareMin) {
      row('scarf', this.mySet, { ...oppSet, item: SCARF }, ['scarf', SCARF], { kind: 'scarf', item: SCARF, share: shares[SCARF] })
    }
  }
}

const unique = <T>(xs: readonly T[]): T[] => [...new Set(xs)]
const isSp = (v: unknown, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max

/** 보정 없는 성격(스냅샷 성격 id 정렬 순 첫 번째). 없으면 원래 성격. */
function neutralNature(game: Snapshot, fallback: string): string {
  const natures = game.data.natures
  return Object.keys(natures).sort().find((id) => natures[id].plus === undefined || natures[id].plus === natures[id].minus) ?? fallback
}

/** SP 합이 total을 넘으면 키 밖 능력치에서 큰 것부터(동률 STAT_IDS 순) 덜어 낸다(제자리 수정). */
function trimSp(sp: SpTable, keys: ReadonlySet<StatId>, total: number): void {
  let over = STAT_IDS.reduce((a, s) => a + sp[s], 0) - total
  const others = STAT_IDS.filter((s) => !keys.has(s))
  while (over > 0) {
    const s = others.reduce<StatId | undefined>((best, x) => (sp[x] > 0 && (best === undefined || sp[x] > sp[best]) ? x : best), undefined)
    if (s === undefined) return
    const cut = Math.min(over, sp[s])
    sp[s] -= cut
    over -= cut
  }
}
const meansParts = (b: RankBasis): string[] => [b.owner, b.means.kind, b.means.id]

function emptyPlan(input: CardInput, tab: Tab, mySp: SpTable, status: TabPlan['status'], conflicts: string[]): TabPlan {
  return { ...planHead(input, tab, mySp), status, cards: [], rows: {}, filters: {}, fixed: {}, probes: {}, customTargetConflicts: conflicts, notices: [] }
}

function planHead(input: CardInput, tab: Tab, mySp: SpTable) {
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

/** 공격측이 나면 attacker 순풍 = 내 순풍. 나머지 조건은 코어 기본값. */
function conditionsFor(input: CardInput, tab: Tab): BattleConditions {
  const meAttacking = tab !== 'defense'
  const { myTailwind, opponentTailwind } = input.conditions
  return {
    attacker: { tailwind: meAttacking ? myTailwind : opponentTailwind },
    defender: { tailwind: meAttacking ? opponentTailwind : myTailwind },
  }
}

/** 상위 N 또는 선택 종(사용률 순) + 목록 밖 타겟(추가 순). 목록 안 종 타겟은 충돌로 돌린다. */
function opponentsOf(input: CardInput): { ladder: MetaEntry[]; custom: CustomTarget[]; conflicts: string[] } {
  const { view, filters, customTargets } = input
  const selected = new Set(filters.selected)
  const ladder = selected.size > 0 ? view.ranking.filter((e) => selected.has(e.id)) : view.ranking.slice(0, filters.topN)
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
  return { ladder, custom, conflicts }
}

/** 방어 탭 래더 상대 기술: 변화기를 뺀 점유율 상위(동률 id 순). 스냅샷에 없는 기술도 자리를 차지한다. */
export function defenseMoveIds(game: Snapshot, entry: MetaEntry): string[] {
  return Object.entries(entry.moves.shares)
    .filter(([id]) => !Object.prototype.hasOwnProperty.call(game.data.moves, id) || game.data.moves[id].category !== 'Status')
    .sort((a, b) => b[1] - a[1] || byString(a[0], b[0]))
    .slice(0, DEFENSE_MOVES)
    .map(([id]) => id)
}

export function planTab(input: CardInput, tab: Tab): TabPlan {
  const { game } = input
  const raw = input.mySet as unknown
  const mySp = (isPlainObject(raw) && isPlainObject(raw.sp) ? { ...raw.sp } : {}) as SpTable
  const { ladder, custom, conflicts } = opponentsOf(input)

  const mySet = isPlainObject(raw) ? withBoosts(input.mySet, {}) : input.mySet
  let me: ResolvedSet
  try {
    me = validateSet(game, mySet)
    if (tab === 'speed') checkSpeedSupport(game, mySet)
  } catch (e) {
    return emptyPlan(input, tab, mySp, { kind: 'my-set-error', reasons: errorReasons(e) }, conflicts)
  }

  const b = new PlanBuilder(input, tab, me, mySet, conditionsFor(input, tab), setMeansCandidates(me, 'me'))
  const tabNotices: MoveNotice[] = []
  const opponents: Opponent[] = [
    ...custom.map((t): Opponent => ({ header: { id: t.rosterId, source: 'custom' }, custom: t })),
    ...ladder.map((e): Opponent => ({ header: { id: e.id, source: 'ladder', rank: e.rank, usage: e.usage }, entry: e })),
  ]
  const seedsOf = (opp: Opponent, category: Category | null, keyStats: readonly StatId[]) =>
    opp.custom ? b.customSeeds(opp.custom, category, keyStats) : b.ladderSeeds(opp.entry as MetaEntry, category, keyStats)

  if (tab === 'attack') {
    const slots = b.myAttackSlots(tabNotices)
    const categories = CATEGORY_ORDER.filter((c) => slots.some((s) => s.refs?.defense === defenseStatOf(c)))
    for (const opp of opponents) {
      for (const category of categories) {
        for (const seed of seedsOf(opp, category, ['hp', defenseStatOf(category)])) b.attackCard(opp, seed, slots)
      }
    }
  } else if (tab === 'defense') {
    for (const opp of opponents) {
      const notices: MoveNotice[] = []
      const moveIds = opp.custom ? opp.custom.moves : defenseMoveIds(game, opp.entry as MetaEntry)
      const all = b.opponentSlots(moveIds, notices)
      const ok = all.filter((s) => s.refs)
      const errors = all.filter((s) => s.error)
      let categories = CATEGORY_ORDER.filter((c) => ok.some((s) => s.refs?.defense === defenseStatOf(c)))
      if (categories.length === 0 && errors.length > 0) categories = ['physical']
      for (const category of categories) {
        const inCategory = ok.filter((s) => s.refs?.defense === defenseStatOf(category))
        // 스피드 의존 기술의 S는 묶음 대표 S로 계산하고 키에 넣지 않는다(목숨걸기 H 같은 나머지 의존은 넣는다).
        const keyStats = unique(
          inCategory
            .filter((s) => s.refs?.offense?.owner === 'self')
            .flatMap((s) => (s.refs as MoveStatRefs).attackerStats.filter((stat) => stat !== 'spe')),
        )
        for (const seed of seedsOf(opp, category, keyStats)) b.defenseCard(opp, seed, ok, errors, notices)
      }
    }
  } else {
    for (const opp of opponents) {
      const seeds = seedsOf(opp, null, ['spe'])
      const scarfEligible = opp.entry !== undefined && opp.entry.mega === undefined
      seeds.forEach((seed, i) => b.speedCard(opp, seed, scarfEligible && i === 0))
    }
  }

  return {
    ...planHead(input, tab, mySp),
    status: { kind: 'ok' },
    cards: b.cards,
    rows: b.rows,
    filters: b.filters,
    fixed: b.fixed,
    probes: b.probes,
    customTargetConflicts: conflicts,
    notices: tabNotices,
  }
}
