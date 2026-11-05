// 세트 검증·메가 해석·실능치. 엔진의 조용한 무시에 기대지 않고 스냅샷 기준으로 전부 판정한다.
import type { NatureEntry, Snapshot, SpeciesEntry, StatId, StatTable } from '../data/schema'
import { CoreError, type CoreErrorDetail, type PokemonSet, type Status } from './types'
import { CoreInputError, assertKnownKeys, hasOwn, integerInRange, isPlainObject, oneOf } from './errors'
import { STAT_IDS, statTable, statValue, natureMultiplier } from './stats'

export const MAX_MOVES = 4
const FIXED_LEVEL = 50
const STATUSES: readonly Status[] = ['none', 'par', 'brn', 'psn', 'tox', 'slp', 'frz']
const BOOST_STATS = ['atk', 'def', 'spa', 'spd', 'spe'] as const
const SET_KEYS = ['regulation', 'species', 'ability', 'item', 'nature', 'sp', 'moves', 'mega', 'status', 'boosts', 'curHp']

/** 검증을 통과한 세트와 그 해석 결과. */
export interface ResolvedSet {
  set: PokemonSet
  /** 계산에 쓰는 종(메가면 메가 폼) */
  species: SpeciesEntry
  baseSpecies: SpeciesEntry
  /** 계산에 쓰는 특성(메가면 메가 폼 특성) */
  ability: string
  setAbility: string
  item?: string
  nature: NatureEntry
  stats: StatTable
  status: Status
  boosts: Record<(typeof BOOST_STATS)[number], number>
  curHp: number
}

const lookup = <T>(table: Record<string, T>, id: unknown): T | undefined =>
  typeof id === 'string' && hasOwn(table, id) ? table[id] : undefined

/** 레귤레이션 불일치는 다른 검사보다 먼저 단독으로 거부한다(다른 스냅샷 기준 판정은 무의미). */
export function assertRegulation(snapshot: Snapshot, set: PokemonSet): void {
  const id = snapshot.manifest.regulation.id
  if (!isPlainObject(set)) throw new CoreInputError('set', `세트가 객체가 아니다(받은 값: ${String(set)})`)
  if (set.regulation !== id) {
    throw new CoreError([
      { code: 'REGULATION_MISMATCH', field: 'regulation', message: `세트 레귤레이션 ${String(set.regulation)}이 스냅샷 ${id}과 다르다` },
    ])
  }
}

function checkSp(snapshot: Snapshot, sp: unknown, errors: CoreErrorDetail[]): void {
  const { spMaxPerStat, spTotal } = snapshot.manifest.rules
  if (!isPlainObject(sp)) {
    errors.push({ code: 'INVALID_SP', field: 'sp', message: 'SP 표가 객체가 아니다' })
    return
  }
  for (const k of Object.keys(sp)) {
    if (!(STAT_IDS as readonly string[]).includes(k)) {
      errors.push({ code: 'INVALID_SP', field: `sp.${k}`, message: `알 수 없는 능력치 ${k}` })
    }
  }
  let total = 0
  let allValid = true
  for (const s of STAT_IDS) {
    const v = sp[s]
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > spMaxPerStat) {
      errors.push({ code: 'INVALID_SP', field: `sp.${s}`, message: `SP ${s}는 0~${spMaxPerStat} 정수여야 한다(받은 값: ${String(v)})` })
      allValid = false
    } else {
      total += v
    }
  }
  if (allValid && total > spTotal) {
    errors.push({ code: 'SP_TOTAL_EXCEEDED', field: 'sp', message: `SP 합계 ${total}이 상한 ${spTotal}을 넘는다` })
  }
}

function resolveMega(
  snapshot: Snapshot,
  base: SpeciesEntry,
  item: string | undefined,
  errors: CoreErrorDetail[],
): SpeciesEntry | undefined {
  if (item === undefined) {
    errors.push({ code: 'INVALID_MEGA', field: 'item', message: `${base.id}의 메가진화에 메가스톤이 없다` })
    return undefined
  }
  const forStone = snapshot.data.megas.filter((m) => m.stone === item)
  if (forStone.length === 0) {
    errors.push({ code: 'INVALID_MEGA', field: 'item', message: `${item}은 메가스톤이 아니다` })
    return undefined
  }
  const entry = forStone.find((m) => m.base === base.id)
  if (!entry) {
    const owners = forStone.map((m) => m.base).join(', ')
    errors.push({ code: 'INVALID_MEGA', field: 'item', message: `${item}은 ${owners}의 메가스톤이다(${base.id} 아님)` })
    return undefined
  }
  const forme = lookup(snapshot.data.species, entry.forme)
  if (!forme) {
    errors.push({ code: 'INVALID_MEGA', field: 'item', message: `메가 폼 ${entry.forme}이 스냅샷에 없다` })
    return undefined
  }
  return forme
}

/** 세트 기술 목록의 미지원 기술은 그 기술을 계산할 때(assertMoveUsable)만 거부한다. */
function checkEngineSupport(snapshot: Snapshot, r: Omit<ResolvedSet, 'stats' | 'status' | 'boosts' | 'curHp'>, errors: CoreErrorDetail[]): void {
  const u = snapshot.manifest.engineUnsupported
  const push = (field: string, id: string) =>
    errors.push({ code: 'ENGINE_UNSUPPORTED', field, message: `${id}은 계산 엔진이 지원하지 않는다` })
  for (const id of new Set([r.baseSpecies.id, r.species.id])) if (u.species.includes(id)) push('species', id)
  if (u.abilities.includes(r.ability)) push('ability', r.ability)
  if (r.item !== undefined && u.items.includes(r.item)) push('item', r.item)
}

function checkMoves(snapshot: Snapshot, base: SpeciesEntry, moves: unknown, errors: CoreErrorDetail[]): string[] {
  if (!Array.isArray(moves)) {
    errors.push({ code: 'ILLEGAL_MOVE', field: 'moves', message: '기술 목록이 배열이 아니다' })
    return []
  }
  if (moves.length > MAX_MOVES) {
    errors.push({ code: 'ILLEGAL_MOVE', field: 'moves', message: `기술은 최대 ${MAX_MOVES}개다(받은 개수: ${moves.length})` })
  }
  const ok: string[] = []
  moves.forEach((m, i) => {
    const field = `moves[${i}]`
    if (!lookup(snapshot.data.moves, m)) {
      errors.push({ code: 'UNKNOWN_MOVE', field, message: `기술 ${String(m)}이 레귤레이션에 없다` })
    } else if (!base.learnset.includes(m as string)) {
      errors.push({ code: 'ILLEGAL_MOVE', field, message: `${base.id}은 ${String(m)}을 배울 수 없다` })
    } else if (ok.includes(m as string)) {
      errors.push({ code: 'ILLEGAL_MOVE', field, message: `기술 ${String(m)}이 중복이다` })
    } else {
      ok.push(m as string)
    }
  })
  return ok
}

/** 기술 하나가 그 종에게 합법인지(세트 기술 목록과 별개로 계산 대상 기술 검증에 쓴다). */
export function assertMoveUsable(snapshot: Snapshot, r: ResolvedSet, moveId: unknown, field = 'move'): string {
  const errors: CoreErrorDetail[] = []
  const [ok] = checkMoves(snapshot, r.baseSpecies, [moveId], errors)
  if (ok !== undefined && snapshot.manifest.engineUnsupported.moves.includes(ok)) {
    errors.push({ code: 'ENGINE_UNSUPPORTED', field, message: `${ok}은 계산 엔진이 지원하지 않는다` })
  }
  if (errors.length) throw new CoreError(errors.map((e) => ({ ...e, field })))
  return ok
}

/**
 * 세트를 스냅샷 기준으로 검증하고 해석한다. 세트 필드 위반은 모아서 CoreError 하나로,
 * 그다음 상태이상·랭크·현재 HP 위반은 CoreInputError로 던진다.
 */
export function validateSet(snapshot: Snapshot, set: PokemonSet): ResolvedSet {
  assertRegulation(snapshot, set)
  // 실능치 공식과 엔진 모두 레벨 50 고정이다.
  if (snapshot.manifest.rules.level !== FIXED_LEVEL) {
    throw new CoreInputError('rules.level', `레벨 ${FIXED_LEVEL}만 계산할 수 있다(스냅샷: ${snapshot.manifest.rules.level})`)
  }
  const raw = set as unknown as Record<string, unknown>
  const errors: CoreErrorDetail[] = []
  const { data } = snapshot

  for (const k of Object.keys(raw)) {
    if (!SET_KEYS.includes(k)) throw new CoreInputError(k, '알 수 없는 세트 필드다')
  }

  const speciesEntry = lookup(data.species, raw.species)
  let base: SpeciesEntry | undefined
  if (!speciesEntry) {
    errors.push({ code: 'UNKNOWN_SPECIES', field: 'species', message: `종 ${String(raw.species)}이 레귤레이션에 없다` })
  } else if (speciesEntry.isMega) {
    errors.push({ code: 'INVALID_MEGA', field: 'species', message: `${speciesEntry.id}은 메가 폼이다. 원종과 mega: true로 지정한다` })
  } else {
    base = speciesEntry
  }

  const abilityId = raw.ability
  if (!lookup(data.abilities, abilityId)) {
    errors.push({ code: 'UNKNOWN_ABILITY', field: 'ability', message: `특성 ${String(abilityId)}이 레귤레이션에 없다` })
  } else if (base && !base.abilities.includes(abilityId as string)) {
    errors.push({ code: 'ILLEGAL_ABILITY', field: 'ability', message: `${base.id}은 특성 ${String(abilityId)}을 가질 수 없다` })
  }

  let item: string | undefined
  if (raw.item !== undefined) {
    if (!lookup(data.items, raw.item)) {
      errors.push({ code: 'UNKNOWN_ITEM', field: 'item', message: `도구 ${String(raw.item)}이 레귤레이션에 없다` })
    } else {
      item = raw.item as string
    }
  }

  const nature = lookup(data.natures, raw.nature)
  if (!nature) errors.push({ code: 'UNKNOWN_NATURE', field: 'nature', message: `성격 ${String(raw.nature)}이 없다` })

  checkSp(snapshot, raw.sp, errors)
  if (base) checkMoves(snapshot, base, raw.moves, errors)

  if (raw.mega !== undefined && typeof raw.mega !== 'boolean') {
    errors.push({ code: 'INVALID_MEGA', field: 'mega', message: `mega는 boolean이어야 한다(받은 값: ${String(raw.mega)})` })
  }
  let forme = base
  if (base && raw.mega === true) {
    // 도구가 알 수 없는 값이면 UNKNOWN_ITEM만 낸다(같은 원인을 두 번 보고하지 않는다).
    forme = raw.item !== undefined && item === undefined ? undefined : resolveMega(snapshot, base, item, errors)
  }

  if (errors.length || !base || !forme || !nature) throw new CoreError(errors)

  const ability = forme.isMega ? forme.abilities[0] : (abilityId as string)
  const partial = { set, species: forme, baseSpecies: base, ability, setAbility: abilityId as string, item, nature }
  checkEngineSupport(snapshot, partial, errors)
  if (errors.length) throw new CoreError(errors)

  const stats = statTable(forme.baseStats, nature, raw.sp as StatTable)
  const status = raw.status === undefined ? 'none' : oneOf(raw.status, STATUSES, 'status')
  const boosts = { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }
  if (raw.boosts !== undefined) {
    if (!isPlainObject(raw.boosts)) throw new CoreInputError('boosts', '객체여야 한다')
    assertKnownKeys(raw.boosts, BOOST_STATS, 'boosts')
    for (const s of BOOST_STATS) {
      if (raw.boosts[s] !== undefined) boosts[s] = integerInRange(raw.boosts[s], -6, 6, `boosts.${s}`)
    }
  }
  const curHp = raw.curHp === undefined ? stats.hp : integerInRange(raw.curHp, 1, stats.hp, 'curHp')
  return { ...partial, stats, status, boosts, curHp }
}

/** 메가 해석을 거친 6개 실능치. */
export function computeStats(snapshot: Snapshot, set: PokemonSet): StatTable {
  return validateSet(snapshot, set).stats
}

/** 능력치별로, SP를 s−1에서 s로 올려도 실능치가 오르지 않는 s(1~최대) 목록. */
export function spNoGainCells(snapshot: Snapshot, set: PokemonSet): Record<StatId, number[]> {
  const r = validateSet(snapshot, set)
  const max = snapshot.manifest.rules.spMaxPerStat
  const out = {} as Record<StatId, number[]>
  for (const s of STAT_IDS) {
    const base = r.species.baseStats[s]
    const mult = natureMultiplier(r.nature, s)
    out[s] = []
    for (let sp = 1; sp <= max; sp++) {
      if (statValue(s, base, sp, mult) === statValue(s, base, sp - 1, mult)) out[s].push(sp)
    }
  }
  return out
}

/** 한 능력치의 SP만 바꾼 세트 사본. */
export function withSp(set: PokemonSet, stat: StatId, sp: number): PokemonSet {
  return { ...set, sp: { ...set.sp, [stat]: sp } }
}

/** 그 능력치를 뺀 나머지 SP로 남는 예산. */
export function remainingBudget(snapshot: Snapshot, set: PokemonSet, stat: StatId): number {
  const others = STAT_IDS.filter((s) => s !== stat).reduce((acc, s) => acc + set.sp[s], 0)
  return snapshot.manifest.rules.spTotal - others
}
