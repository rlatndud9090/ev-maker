// 추출기: GameDataSource → 영문 이름 단계의 스냅샷 데이터(name은 en 문자열).
import { PipelineError, cmp, sortedUnique, toID } from './util.mjs'

const STAT_IDS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe']
const CATEGORIES = new Set(['Physical', 'Special', 'Status'])

export const isMegaRecord = (s) => s.forme.includes('Mega')

/** 합법 종: 비표준 표시 없음 + 외형 전용 아님 + (배틀 전용 아님 또는 메가). */
export function isLegalSpecies(s) {
  return s.isNonstandard == null && !s.isCosmeticForme && (!s.battleOnly || isMegaRecord(s))
}

const isLegal = (r) => r.isNonstandard == null

function normMultihit(m) {
  if (m == null) return undefined
  if (typeof m === 'number') return m
  if (Array.isArray(m) && m.length === 2) return m[0] === m[1] ? m[0] : [m[0], m[1]]
  throw new PipelineError(`multihit 형식 불명: ${JSON.stringify(m)}`)
}

export function moveEntryFrom(r) {
  return {
    id: r.id,
    name: r.name,
    type: r.type,
    category: r.category,
    basePower: r.basePower,
    accuracy: r.accuracy,
    priority: r.priority,
    multihit: normMultihit(r.multihit),
    target: r.target,
    flags: [...r.flags].sort(cmp),
  }
}

/** 학습 기술 해석: 자신 → changesFrom → baseSpecies. 사용한 원천 id를 함께 돌려준다. */
async function resolveLearnset(source, rec) {
  const candidates = [rec.id]
  if (rec.changesFrom) candidates.push(toID(rec.changesFrom))
  if (rec.baseSpecies && toID(rec.baseSpecies) !== rec.id) candidates.push(toID(rec.baseSpecies))
  for (const id of candidates) {
    const ls = await source.learnset(id)
    if (ls) return { moves: ls, from: id }
  }
  throw new PipelineError(`${rec.name}: learnset을 찾지 못함 (${candidates.join(' → ')})`)
}

export async function speciesEntryFrom(source, rec) {
  const isMega = isMegaRecord(rec)
  // 메가는 원종(changesFrom) learnset을 쓴다.
  const lsRec = isMega ? source.getSpecies(rec.changesFrom ?? rec.baseSpecies) : rec
  if (!lsRec) throw new PipelineError(`${rec.name}: 원종 ${rec.changesFrom ?? rec.baseSpecies} 없음`)
  const ls = await resolveLearnset(source, lsRec)
  const entry = {
    id: rec.id,
    name: rec.name,
    num: rec.num,
    types: [...rec.types],
    baseStats: Object.fromEntries(STAT_IDS.map((k) => [k, rec.baseStats[k]])),
    weightkg: rec.weightkg,
    abilities: rec.abilities.map(toID),
    learnset: sortedUnique(ls.moves),
    isMega,
  }
  if (isMega) {
    entry.baseSpecies = toID(rec.changesFrom ?? rec.baseSpecies)
    if (!rec.requiredItem) throw new PipelineError(`${rec.name}: 메가인데 requiredItem 없음`)
    entry.requiredItem = toID(rec.requiredItem)
  }
  return { entry, learnsetFrom: ls.from }
}

export async function extractGameData(source) {
  const species = {}
  const learnsetFrom = {}
  for (const rec of source.species().filter(isLegalSpecies)) {
    if (species[rec.id]) throw new PipelineError(`종 id 중복: ${rec.id}`)
    const { entry, learnsetFrom: from } = await speciesEntryFrom(source, rec)
    species[rec.id] = entry
    if (from !== (entry.baseSpecies ?? entry.id)) learnsetFrom[rec.id] = from
  }
  const moves = {}
  for (const r of source.moves().filter(isLegal)) moves[r.id] = moveEntryFrom(r)
  const items = {}
  for (const r of source.items().filter(isLegal)) items[r.id] = { id: r.id, name: r.name }
  const natures = {}
  for (const r of source.natures()) {
    const n = { id: r.id, name: r.name }
    if (r.plus && r.minus && r.plus !== r.minus) {
      n.plus = r.plus
      n.minus = r.minus
    }
    natures[r.id] = n
  }
  return { data: { species, moves, items, abilities: {}, natures, megas: [] }, learnsetFrom }
}

/** 특성 표와 메가 표를 종 목록에서 파생하고 참조 무결성을 검사한다. 보정 적용 뒤에 호출한다. */
export function finalizeGameData(source, data) {
  const abilityIds = sortedUnique(Object.values(data.species).flatMap((s) => s.abilities))
  data.abilities = {}
  for (const id of abilityIds) {
    const r = source.getAbility(id)
    if (!r) throw new PipelineError(`특성 ${id}가 원천에 없음`)
    if (!isLegal(r)) throw new PipelineError(`특성 ${id}가 비표준(${r.isNonstandard})`)
    data.abilities[id] = { id, name: r.name }
  }
  const megas = []
  for (const s of Object.values(data.species)) {
    if (!s.isMega) continue
    const base = data.species[s.baseSpecies]
    if (!base) throw new PipelineError(`메가 ${s.id}의 원종 ${s.baseSpecies}가 스냅샷에 없음`)
    // 메가 learnset은 원종 값의 사본이다(원종 보정이 그대로 반영되도록 여기서 다시 파생).
    s.learnset = [...base.learnset]
    if (!data.items[s.requiredItem]) throw new PipelineError(`메가 ${s.id}의 스톤 ${s.requiredItem}가 스냅샷에 없음`)
    const stone = source.getItem(s.requiredItem)
    const mapped = stone?.megaStone?.[base.name]
    if (toID(mapped) !== s.id) {
      throw new PipelineError(`스톤 ${s.requiredItem} × ${base.name} → ${mapped} ≠ ${s.id}`)
    }
    megas.push({ base: s.baseSpecies, stone: s.requiredItem, forme: s.id })
  }
  const seen = new Set()
  for (const m of megas) {
    const k = `${m.stone}|${m.base}`
    if (seen.has(k)) throw new PipelineError(`메가 표 중복: ${k}`)
    seen.add(k)
  }
  data.megas = megas.sort((a, b) => cmp(a.forme, b.forme))
  validateGameData(data)
  return data
}

export function validateGameData(data) {
  for (const s of Object.values(data.species)) {
    if (!Number.isInteger(s.num) || s.num <= 0) throw new PipelineError(`${s.id}: num ${s.num}`)
    if (!Array.isArray(s.types) || s.types.length < 1 || s.types.length > 2) {
      throw new PipelineError(`${s.id}: types ${JSON.stringify(s.types)}`)
    }
    for (const k of STAT_IDS) {
      const v = s.baseStats[k]
      if (!Number.isInteger(v) || v < 1 || v > 255) throw new PipelineError(`${s.id}: baseStats.${k}=${v}`)
    }
    if (!(Number.isFinite(s.weightkg) && s.weightkg > 0)) throw new PipelineError(`${s.id}: weightkg ${s.weightkg}`)
    if (s.abilities.length === 0) throw new PipelineError(`${s.id}: 특성 없음`)
    for (const a of s.abilities) if (!data.abilities[a]) throw new PipelineError(`${s.id}: 특성 ${a} 없음`)
    if (s.learnset.length === 0) throw new PipelineError(`${s.id}: learnset 비어 있음`)
    for (const m of s.learnset) if (!data.moves[m]) throw new PipelineError(`${s.id}: learnset 기술 ${m}가 합법 기술에 없음`)
  }
  for (const m of Object.values(data.moves)) {
    if (!CATEGORIES.has(m.category)) throw new PipelineError(`${m.id}: category ${m.category}`)
    if (typeof m.type !== 'string' || !m.type) throw new PipelineError(`${m.id}: type 없음`)
    if (!Number.isInteger(m.basePower) || m.basePower < 0) throw new PipelineError(`${m.id}: basePower ${m.basePower}`)
    if (!(m.accuracy === true || (Number.isInteger(m.accuracy) && m.accuracy >= 1 && m.accuracy <= 100))) {
      throw new PipelineError(`${m.id}: accuracy ${m.accuracy}`)
    }
    if (!Number.isInteger(m.priority)) throw new PipelineError(`${m.id}: priority ${m.priority}`)
    if (m.multihit !== undefined) {
      const ok = Array.isArray(m.multihit)
        ? m.multihit.every((n) => Number.isInteger(n) && n >= 1) && m.multihit[0] < m.multihit[1]
        : Number.isInteger(m.multihit) && m.multihit >= 2
      if (!ok) throw new PipelineError(`${m.id}: multihit ${JSON.stringify(m.multihit)}`)
    }
  }
}
