// 계산 엔진(@smogon/calc) 내장 데이터와 스냅샷 대조. 엔진 데이터는 합법 판정·수치에 쓰지 않는다.
import { Field, Generations, Move, Pokemon, calculate } from '@smogon/calc'
import { PipelineError, cmp, deepEqual, sortedUnique, toID } from './util.mjs'

const STAT_IDS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe']
// 위력 0 공격기 실측용 고정 입력. 특성은 대미지에 관여하지 않는 것으로, 도구는 내던지기 위력이 생기는 것으로 둔다.
const PROBE_ABILITY = 'Pressure'
const PROBE_ITEM = 'Leftovers'
const PROBE_LEVEL = 50
const idsOf = (iterable) => [...iterable].map((x) => x.id)

export function loadEngine(gen) {
  const g = Generations.get(gen)
  return {
    species: (id) => g.species.get(id) ?? null,
    move: (id) => g.moves.get(id) ?? null,
    item: (id) => g.items.get(id) ?? null,
    ability: (id) => g.abilities.get(id) ?? null,
    itemIds: () => idsOf(g.items),
    /** 타입 상성 배율(0이면 면역) */
    effectiveness: (moveType, defTypes) => defTypes.reduce((acc, t) => acc * (g.types.get(toID(moveType))?.effectiveness[t] ?? 1), 1),
    /** 앱 래퍼처럼 위력·타입·분류를 덮어 1회 계산했을 때 대미지가 0보다 큰가 */
    damagesAtZeroPower: (moveId, m, attackerId, defenderId) => {
      const mk = (id) => new Pokemon(g, g.species.get(id).name, { level: PROBE_LEVEL, ability: PROBE_ABILITY, item: PROBE_ITEM })
      const move = new Move(g, g.moves.get(moveId).name, { overrides: { basePower: m.basePower, type: m.type, category: m.category } })
      const dmg = calculate(g, mk(attackerId), mk(defenderId), move, new Field({ gameType: 'Doubles' })).damage
      return [dmg].flat(2).some((d) => d > 0)
    },
    moveFlagKeys: () => sortedUnique([...g.moves].flatMap((m) => Object.keys(m.flags ?? {}))),
  }
}

export function engineId(aliases, kind, id) {
  return aliases.engine?.[kind]?.[id] ?? id
}

function normMultihit(m) {
  if (m == null) return null
  if (Array.isArray(m)) return m[0] === m[1] ? m[0] : [m[0], m[1]]
  return m
}

/** 반환: { report, unsupported } */
export function compareWithEngine(data, engine, aliases) {
  const unsupported = { species: [], items: [], abilities: [], moves: [] }
  const species = []
  const abilitySlot = []
  for (const s of Object.values(data.species)) {
    const eid = engineId(aliases, 'species', s.id)
    const e = engine.species(eid)
    if (!e) {
      unsupported.species.push(s.id)
      continue
    }
    const push = (field, snap, eng) => species.push({ id: s.id, engineId: eid, field, snapshot: snap, engine: eng })
    for (const k of STAT_IDS) if (s.baseStats[k] !== e.baseStats[k]) push(`baseStats.${k}`, s.baseStats[k], e.baseStats[k])
    if (!deepEqual(s.types, [...e.types])) push('types', s.types, [...e.types])
    if (s.weightkg !== e.weightkg) push('weightkg', s.weightkg, e.weightkg ?? null)
    const eAbilities = Object.values(e.abilities ?? {}).map(toID)
    const missing = eAbilities.filter((a) => !s.abilities.includes(a))
    if (missing.length) abilitySlot.push({ id: s.id, engineAbilities: eAbilities, snapshotAbilities: s.abilities })
  }
  const flagKeys = engine.moveFlagKeys()
  const moves = []
  const zeroPowerUnimplemented = []
  // 위력 0 공격기(고정·비례 대미지, 일격기 등)는 엔진이 계산을 구현하지 않으면 대미지 0을 내 면역과 구별되지 않는다.
  const probeSpecies = Object.values(data.species)
    .filter((s) => !s.isMega && engine.species(engineId(aliases, 'species', s.id)))
    .sort((a, b) => cmp(a.id, b.id))
  for (const m of Object.values(data.moves)) {
    const e = engine.move(engineId(aliases, 'moves', m.id))
    if (!e) {
      unsupported.moves.push(m.id)
      continue
    }
    if (m.category !== 'Status' && m.basePower === 0 && probeSpecies.length) {
      const target = probeSpecies.find((s) => engine.effectiveness(m.type, s.types) > 0)
      if (!target) throw new PipelineError(`${m.id}: 위력 0 실측에 쓸 비면역 대상이 없음`)
      const attacker = engineId(aliases, 'species', probeSpecies[0].id)
      if (!engine.damagesAtZeroPower(engineId(aliases, 'moves', m.id), m, attacker, engineId(aliases, 'species', target.id))) {
        zeroPowerUnimplemented.push(m.id)
        unsupported.moves.push(m.id)
      }
    }
    const push = (field, snap, eng) => moves.push({ id: m.id, field, snapshot: snap, engine: eng })
    if (m.basePower !== e.basePower) push('basePower', m.basePower, e.basePower ?? null)
    if (m.type !== e.type) push('type', m.type, e.type ?? null)
    // 엔진 Move는 gen0에서 category가 비면 Status로 해석한다(dist/move.js).
    const engCategory = e.category || 'Status'
    if (m.category !== engCategory) push('category', m.category, engCategory)
    if (!deepEqual(m.multihit ?? null, normMultihit(e.multihit))) push('multihit', m.multihit ?? null, normMultihit(e.multihit))
    // 엔진은 계산에 쓰는 flag만 가진다. 그 키 집합 안에서만 비교한다.
    const snapFlags = m.flags.filter((f) => flagKeys.includes(f))
    const engFlags = Object.keys(e.flags ?? {}).filter((f) => e.flags[f]).sort(cmp)
    if (!deepEqual(snapFlags, engFlags)) push('flags', snapFlags, engFlags)
  }
  for (const id of Object.keys(data.items)) if (!engine.item(engineId(aliases, 'items', id))) unsupported.items.push(id)
  for (const id of Object.keys(data.abilities)) if (!engine.ability(engineId(aliases, 'abilities', id))) unsupported.abilities.push(id)
  const snapItems = new Set(Object.keys(data.items).map((id) => engineId(aliases, 'items', id)))
  const engItems = engine.itemIds()
  const byIdField = (a, b) => cmp(`${a.id}|${a.field}`, `${b.id}|${b.field}`)
  for (const k of Object.keys(unsupported)) unsupported[k].sort(cmp)
  return {
    unsupported,
    report: {
      comparedMoveFlags: flagKeys,
      species: species.sort(byIdField),
      moves: moves.sort(byIdField),
      abilitySlots: abilitySlot.sort((a, b) => cmp(a.id, b.id)),
      zeroPowerUnimplemented: zeroPowerUnimplemented.sort(cmp),
      items: {
        onlySnapshot: [...snapItems].filter((id) => !engine.item(id)).sort(cmp),
        onlyEngine: engItems.filter((id) => !snapItems.has(id)).sort(cmp),
      },
      unsupported,
    },
  }
}
