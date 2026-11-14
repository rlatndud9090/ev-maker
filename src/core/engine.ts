// @smogon/calc 0.12.0 래퍼. 엔진에는 대미지 공식만 맡기고, SP→EV 칸 변환과 스냅샷 수치 주입은 여기 한 곳에서만 한다.
import { Field, Generations, Move, Pokemon, calculate, toID } from '@smogon/calc'
import type { MoveEntry, Snapshot, SpeciesEntry, StatTable } from '../data/schema'
import aliasesJson from '../../scripts/data/aliases.json'
import type { ResolvedSet } from './set'
import type { Terrain, Weather } from './types'
import type { NormalizedConditions, NormalizedSide } from './conditions'
import { coreError } from './errors'
import { STAT_IDS, statTable } from './stats'
import { speedOf, withEffectiveWeather } from './speed'

const gen = Generations.get(0)
type EngineKind = 'species' | 'moves' | 'items' | 'abilities' | 'natures'
type EnginePokemonOptions = NonNullable<ConstructorParameters<typeof Pokemon>[2]>
type EngineMoveOverrides = NonNullable<NonNullable<ConstructorParameters<typeof Move>[2]>['overrides']>
type EngineTypes = Pokemon['types']

const ENGINE_ALIASES = aliasesJson.engine as Record<string, Record<string, string> | undefined>
const SPREAD_TARGETS = ['allAdjacent', 'allAdjacentFoes']
/** 엔진 대미지 경로가 엔진 자체 스피드(gen 0에 999 상한)로 위력·순서를 정하는 기술과 특성 */
export const SPEED_DEPENDENT_MOVES: readonly string[] = ['electroball', 'gyroball', 'payback']
export const SPEED_DEPENDENT_ATTACKER_ABILITIES: readonly string[] = ['analytic']

/** 스냅샷 id → 엔진 표시명. 엔진에 없으면 ENGINE_UNSUPPORTED(매니페스트 기록이 빠진 경우의 방어선). */
function engineName(kind: EngineKind, id: string): string {
  const eid = ENGINE_ALIASES[kind]?.[id] ?? id
  const entry = gen[kind].get(toID(eid))
  if (!entry) throw coreError('ENGINE_UNSUPPORTED', kind, `${id}은 계산 엔진 데이터에 없다`)
  return entry.name
}

/** 엔진 기술 데이터의 능력치 대체 표시(바디프레스 offensiveStat 'def', 속임수 offensivePokemon 'target', 사이코쇼크 defensiveStat 'def'). */
export function engineMoveOverrides(moveId: string): { defensiveStat?: string; offensiveStat?: string; offensivePokemon?: string } {
  const m = gen.moves.get(toID(engineName('moves', moveId)))
  const out: { defensiveStat?: string; offensiveStat?: string; offensivePokemon?: string } = {}
  if (m?.overrideDefensiveStat) out.defensiveStat = m.overrideDefensiveStat
  if (m?.overrideOffensiveStat) out.offensiveStat = m.overrideOffensiveStat
  if (m?.overrideOffensivePokemon) out.offensivePokemon = m.overrideOffensivePokemon
  return out
}

/**
 * 기본 타입 상성 배율(엔진 타입표): 기술 타입 → 방어측 타입들의 곱(0·0.25·0.5·1·2·4).
 * 특성·도구·날씨·테라 등에 따른 타입·상성 변화는 넣지 않는다. 엔진 타입표에 없는 타입은 CoreError(ENGINE_UNSUPPORTED).
 */
export function typeEffectiveness(moveType: string, defenderTypes: readonly string[]): number {
  const t = gen.types.get(toID(moveType))
  if (!t) throw coreError('ENGINE_UNSUPPORTED', 'move', `${moveType} 타입은 계산 엔진 데이터에 없다`)
  const table = t.effectiveness as Readonly<Record<string, number | undefined>>
  return defenderTypes.reduce((m, d) => {
    const e = table[d]
    if (e === undefined) throw coreError('ENGINE_UNSUPPORTED', 'defender', `${d} 타입은 계산 엔진 데이터에 없다`)
    return m * e
  }, 1)
}

/** 스킨 계열 특성: 노말 기술 → 그 타입(엔진 gen789 대미지 경로와 같은 규칙) */
const ATE_ABILITIES: Readonly<Record<string, string>> = { aerilate: 'Flying', galvanize: 'Electric', pixilate: 'Fairy', refrigerate: 'Ice', dragonize: 'Dragon' }
/** 엔진이 특성 타입 변화를 넣지 않는 기술 */
const NO_TYPE_CHANGE_MOVES: readonly string[] = ['revelationdance', 'judgment', 'naturepower', 'technoblast', 'multiattack', 'naturalgift', 'weatherball', 'terrainpulse', 'struggle']
/** 노말·격투 기술이 고스트에 맞는 특성(배짱·심안) */
const GHOST_REVEALING_ABILITIES: readonly string[] = ['scrappy', 'mindseye']

const abilityKey = (ability: string): string => toID(ENGINE_ALIASES.abilities?.[ability] ?? ability)

const WEATHER_BALL_TYPE: Readonly<Record<string, string>> = { Sun: 'Fire', Rain: 'Water', Sand: 'Rock', Snow: 'Ice' }
const TERRAIN_PULSE_TYPE: Readonly<Record<string, string>> = { Electric: 'Electric', Grassy: 'Grass', Psychic: 'Psychic', Misty: 'Fairy' }

/** 기술 타입을 정하는 날씨·필드(유효 날씨: 구름보기 등은 호출 측이 반영) */
export interface MoveTypeField {
  weather?: Weather
  terrain?: Terrain
}

/**
 * 공격측 특성에 따른 기술 타입(엔진 대미지 경로와 같은 규칙): 스킨 특성(노말 → 비행·전기·페어리·얼음·드래곤), 촉촉보이스(소리 기술 → 물),
 * 노말스킨(모든 기술 → 노말). field를 주면 웨더볼·대지의파동 타입도 바꾼다(대지의파동의 공격측 접지 여부는 보지 않는다).
 * 도구·테라 등에 따른 변화는 넣지 않는다. 엔진에 없는 기술은 기본 타입 그대로.
 */
export function attackMoveType(moveId: string, baseType: string, ability: string, field?: MoveTypeField): string {
  // 메가솔라는 날씨와 무관하게 쾌청 취급(엔진 규칙)
  if (moveId === 'weatherball') return abilityKey(ability) === 'megasol' ? 'Fire' : (WEATHER_BALL_TYPE[field?.weather ?? 'none'] ?? baseType)
  if (moveId === 'terrainpulse') return TERRAIN_PULSE_TYPE[field?.terrain ?? 'none'] ?? baseType
  if (NO_TYPE_CHANGE_MOVES.includes(moveId)) return baseType
  const key = abilityKey(ability)
  const ate = ATE_ABILITIES[key]
  if (ate !== undefined) return baseType === 'Normal' ? ate : baseType
  if (key === 'liquidvoice') {
    const m = gen.moves.get(toID(ENGINE_ALIASES.moves?.[moveId] ?? moveId))
    return m?.flags?.sound ? 'Water' : baseType
  }
  if (key === 'normalize') return 'Normal'
  return baseType
}

/**
 * 공격측 특성을 넣은 상성 배율(엔진 getMoveEffectiveness와 같은 타입별 곱): attackMoveType으로 바꾼 타입의 기본 상성, 배짱·심안이면
 * 노말·격투 기술의 고스트 무효를 등배로. moveId를 주면 기술별 특례도 넣는다(프리즈드라이: 물에 2배, 플라잉프레스: 비행 상성을 곱함,
 * 니힐라이트: 페어리에 등배). 방어측 특성(부유 등)·도구·필드는 넣지 않는다. 엔진 타입표에 없는 타입은 CoreError(ENGINE_UNSUPPORTED).
 */
export function attackEffectiveness(moveType: string, defenderTypes: readonly string[], ability: string, moveId?: string): number {
  const revealed = GHOST_REVEALING_ABILITIES.includes(abilityKey(ability)) && (moveType === 'Normal' || moveType === 'Fighting')
  const move = moveId === undefined ? '' : toID(ENGINE_ALIASES.moves?.[moveId] ?? moveId)
  return defenderTypes.reduce((m, d) => {
    if (revealed && d === 'Ghost') return m
    if (move === 'freezedry' && d === 'Water') return m * 2
    if (move === 'nihillight' && d === 'Fairy') return m
    const e = typeEffectiveness(moveType, [d])
    return m * (move === 'flyingpress' ? e * typeEffectiveness('Flying', [d]) : e)
  }, 1)
}

/** 엔진은 overrides.types를 배열 깊은 병합하고 clone()마다 재병합하므로, 인스턴스와 그 사본에 타입을 다시 고정한다. */
function pinTypes(p: Pokemon, types: EngineTypes): Pokemon {
  p.types = types
  const clone = p.clone.bind(p)
  p.clone = () => pinTypes(clone() as Pokemon, types)
  return p
}

function makePokemon(
  snapshot: Snapshot,
  species: SpeciesEntry,
  opts: { ability: string; item?: string; nature: string; sp: StatTable } & Partial<EnginePokemonOptions>,
): Pokemon {
  const { ability, item, nature, sp, ...rest } = opts
  const p = new Pokemon(gen, engineName('species', species.id), {
    ...rest,
    level: snapshot.manifest.rules.level,
    ability: engineName('abilities', ability),
    item: item === undefined ? undefined : engineName('items', item),
    nature: engineName('natures', nature),
    evs: { ...sp },
    overrides: { baseStats: { ...species.baseStats } } as EnginePokemonOptions['overrides'],
  })
  return pinTypes(p, [...species.types] as EngineTypes)
}

export function buildEnginePokemon(snapshot: Snapshot, r: ResolvedSet, side: NormalizedSide): Pokemon {
  return makePokemon(snapshot, r.species, {
    ability: r.ability,
    item: r.item,
    nature: r.nature.id,
    sp: r.set.sp,
    boosts: { ...r.boosts },
    status: r.status === 'none' ? '' : r.status,
    curHP: r.curHp,
    alliesFainted: side.alliesFainted,
  })
}

/** 성묘: 엔진이 쓰러진 아군 수 위력 규칙을 넣지 않아 위력을 직접 덮어쓴다(50 × (1 + n)) */
const LAST_RESPECTS = 'lastrespects'
const LAST_RESPECTS_STEP = 50

/** 판정 조건이 위력을 덮어쓰는 기술의 위력(성묘에 lastRespectsFainted가 있을 때만). 그 밖은 undefined */
export function conditionMovePower(moveId: string, c: { lastRespectsFainted?: number } | undefined): number | undefined {
  if (moveId !== LAST_RESPECTS || c?.lastRespectsFainted === undefined) return undefined
  return LAST_RESPECTS_STEP * (1 + c.lastRespectsFainted)
}

function buildMove(attacker: ResolvedSet, move: MoveEntry, c: NormalizedConditions): Move {
  const spreadToSingle = c.gameType === 'Doubles' && c.spreadTargets === 1 && SPREAD_TARGETS.includes(move.target)
  const overrides = {
    basePower: conditionMovePower(move.id, c) ?? move.basePower,
    type: move.type,
    category: move.category,
    // 단타면 1을 명시해 엔진 데이터의 타수를 덮는다.
    multihit: move.multihit ?? 1,
    target: spreadToSingle ? 'normal' : move.target,
    priority: move.priority,
  } as EngineMoveOverrides
  return new Move(gen, engineName('moves', move.id), {
    // Skill Link 등 타수에 영향을 주는 특성은 Move 쪽에도 넘겨야 엔진이 반영한다.
    ability: engineName('abilities', attacker.ability),
    item: attacker.item === undefined ? undefined : engineName('items', attacker.item),
    isCrit: c.critical,
    hits: c.hits,
    overrides,
  })
}

function buildField(c: NormalizedConditions): Field {
  const side = (s: NormalizedSide) => ({
    isTailwind: s.tailwind,
    isHelpingHand: s.helpingHand,
    isFriendGuard: s.friendGuard,
    isReflect: s.reflect,
    isLightScreen: s.lightScreen,
  })
  return new Field({
    gameType: c.gameType,
    weather: c.weather === 'none' ? undefined : c.weather,
    terrain: c.terrain === 'none' ? undefined : c.terrain,
    attackerSide: side(c.attacker),
    defenderSide: side(c.defender),
  })
}

/** 엔진 대미지 출력(단일 값, 16배열, 타별 2차원, 부모의 사랑 [본타, 자식타])을 타수 × 16으로 정규화한다. */
export function normalizeRolls(damage: number | number[] | number[][]): number[][] {
  const fill = (n: number) => Array.from({ length: 16 }, () => n)
  if (typeof damage === 'number') return [fill(damage)]
  if (damage.length === 16 && damage.every((d) => typeof d === 'number')) return [[...(damage as number[])]]
  return (damage as Array<number | number[]>).map((d) => {
    if (typeof d === 'number') return fill(d)
    if (d.length !== 16) throw new Error(`엔진 대미지 배열 길이가 16이 아니다: ${d.length}`)
    return [...d]
  })
}

/** 스피드가 대미지에 들어가는 계산은 엔진 스피드가 앱 스피드와 같을 때만 받아들인다(다르면 위력·순서가 틀린다). */
function assertEngineSpeedMatches(engineAtk: number, appAtk: number, engineDef: number, appDef: number, moveId: string): void {
  if (engineAtk === appAtk && engineDef === appDef) return
  throw coreError(
    'ENGINE_UNSUPPORTED',
    'move',
    `${moveId}: 계산 엔진 스피드(공격 ${engineAtk}, 방어 ${engineDef})가 앱 스피드(공격 ${appAtk}, 방어 ${appDef})와 달라 계산할 수 없다`,
  )
}

export function engineDamage(
  snapshot: Snapshot,
  attacker: ResolvedSet,
  defender: ResolvedSet,
  move: MoveEntry,
  c: NormalizedConditions,
): number[][] {
  const result = calculate(
    gen,
    buildEnginePokemon(snapshot, attacker, c.attacker),
    buildEnginePokemon(snapshot, defender, c.defender),
    buildMove(attacker, move, c),
    buildField(c),
  )
  if (SPEED_DEPENDENT_MOVES.includes(move.id) || SPEED_DEPENDENT_ATTACKER_ABILITIES.includes(attacker.ability)) {
    const sc = withEffectiveWeather(c, attacker, defender)
    assertEngineSpeedMatches(result.attacker.stats.spe, speedOf(attacker, sc, 'attacker'), result.defender.stats.spe, speedOf(defender, sc, 'defender'), move.id)
  }
  return normalizeRolls(result.damage)
}

/** 테스트용: 엔진이 내부에서 계산한 실능치가 앱 공식과 같은지 단언한다. */
export function assertEngineStatParity(snapshot: Snapshot, species: SpeciesEntry, natureId: string, sp: StatTable): void {
  const nature = snapshot.data.natures[natureId]
  const app = statTable(species.baseStats, nature, sp)
  const unsupported = snapshot.manifest.engineUnsupported.abilities
  const ability = species.abilities.find((a) => !unsupported.includes(a)) ?? species.abilities[0]
  const p = makePokemon(snapshot, species, { ability, nature: natureId, sp })
  const diff = STAT_IDS.filter((s) => p.rawStats[s] !== app[s])
  if (diff.length) {
    const detail = diff.map((s) => `${s} 앱 ${app[s]} / 엔진 ${p.rawStats[s]}`).join(', ')
    throw new Error(`${species.id} ${natureId} 실능치 불일치: ${detail}`)
  }
}
