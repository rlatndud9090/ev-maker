// 보정표: 게임 보정(game.json)과 한국어 보정(ko.json)의 형식 검증과 게임 보정 적용.
import { HANGUL, PipelineError, cmp, deepEqual, isIsoDate, sortedUnique, toID } from './util.mjs'
import { isLegalSpecies, moveEntryFrom, speciesEntryFrom } from './extract.mjs'

const STAT_IDS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe']
const GAME_KINDS = new Set(['species', 'moves', 'items', 'abilities'])
const GAME_FIELDS = {
  species: new Set(['baseStats', 'types', 'abilities', 'learnset']),
  moves: new Set(['basePower', 'type', 'category', 'accuracy', 'priority', 'multihit', 'target']),
  items: new Set(),
  abilities: new Set(),
}
export const KO_KINDS = ['species', 'moves', 'items', 'abilities', 'natures']

function requireMeta(where, e) {
  if (typeof e.source !== 'string' || !e.source.trim()) throw new PipelineError(`${where}: source 필요`)
  if (!isIsoDate(e.checked)) throw new PipelineError(`${where}: checked(YYYY-MM-DD) 필요`)
}

const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi

function validateFieldValue(where, field, v, ctx) {
  const bad = () => new PipelineError(`${where}: ${field} 값 ${JSON.stringify(v)} 거부`)
  switch (field) {
    case 'baseStats':
      if (!v || typeof v !== 'object' || Object.keys(v).sort(cmp).join() !== [...STAT_IDS].sort(cmp).join()) throw bad()
      for (const k of STAT_IDS) if (!isInt(v[k], 1, 255)) throw bad()
      return
    case 'types':
      if (!Array.isArray(v) || v.length < 1 || v.length > 2 || new Set(v).size !== v.length) throw bad()
      for (const t of v) if (!ctx.types.has(t)) throw bad()
      return
    case 'abilities':
      if (!Array.isArray(v) || v.length < 1 || new Set(v).size !== v.length) throw bad()
      for (const a of v) if (typeof a !== 'string' || a !== toID(a) || !ctx.source.getAbility(a)) throw bad()
      return
    case 'learnset':
      if (!Array.isArray(v) || v.length < 1 || new Set(v).size !== v.length) throw bad()
      for (const m of v) if (typeof m !== 'string' || m !== toID(m)) throw bad()
      return
    case 'basePower':
      if (!isInt(v, 0, 1000)) throw bad()
      return
    case 'type':
      if (!ctx.types.has(v)) throw bad()
      return
    case 'category':
      if (!['Physical', 'Special', 'Status'].includes(v)) throw bad()
      return
    case 'accuracy':
      if (!(v === true || isInt(v, 1, 100))) throw bad()
      return
    case 'priority':
      if (!isInt(v, -7, 5)) throw bad()
      return
    case 'multihit':
      if (v === null) return
      if (Array.isArray(v) ? !(v.length === 2 && isInt(v[0], 1, 10) && isInt(v[1], 2, 10) && v[0] < v[1]) : !isInt(v, 2, 10)) throw bad()
      return
    case 'target':
      if (!ctx.targets.has(v)) throw bad()
      return
    default:
      throw bad()
  }
}

/** game.json 형식 검증(적용 전, 레귤레이션 무관). */
export function validateGameOverrides(doc, regulationIds) {
  if (!doc || !Array.isArray(doc.entries)) throw new PipelineError('game 보정표: entries 배열 필요')
  const seen = new Set()
  doc.entries.forEach((e, i) => {
    const where = `game 보정표 #${i}`
    const allowedKeys = new Set(['regulations', 'kind', 'id', 'set', 'allowed', 'source', 'checked', 'note'])
    for (const k of Object.keys(e)) if (!allowedKeys.has(k)) throw new PipelineError(`${where}: 알 수 없는 키 ${k}`)
    if (!GAME_KINDS.has(e.kind)) throw new PipelineError(`${where}: kind ${e.kind}`)
    if (typeof e.id !== 'string' || e.id !== toID(e.id) || !e.id) throw new PipelineError(`${where}: id는 Showdown id`)
    if (!Array.isArray(e.regulations) || e.regulations.length === 0) throw new PipelineError(`${where}: regulations 필요`)
    for (const r of e.regulations) if (!regulationIds.includes(r)) throw new PipelineError(`${where}: 레귤레이션 ${r} 없음`)
    if (e.allowed !== undefined && typeof e.allowed !== 'boolean') throw new PipelineError(`${where}: allowed는 boolean`)
    if (e.set !== undefined) {
      if (!e.set || typeof e.set !== 'object' || Array.isArray(e.set) || !Object.keys(e.set).length) {
        throw new PipelineError(`${where}: set은 비지 않은 객체`)
      }
      for (const f of Object.keys(e.set)) if (!GAME_FIELDS[e.kind].has(f)) throw new PipelineError(`${where}: ${e.kind}.${f}는 보정 대상 아님`)
      if (e.allowed === false) throw new PipelineError(`${where}: allowed=false와 set을 함께 쓸 수 없음`)
    }
    if (e.set === undefined && e.allowed === undefined) throw new PipelineError(`${where}: set 또는 allowed 필요`)
    requireMeta(where, e)
    for (const r of e.regulations) {
      const k = `${r}|${e.kind}|${e.id}`
      if (seen.has(k)) throw new PipelineError(`${where}: ${k} 중복`)
      seen.add(k)
    }
  })
}


/** 추출 단계에서 보정을 적용한다. 우선순위: 보정 > 원천. 적용 내역을 돌려준다. */
export async function applyGameOverrides(source, data, doc, regulationId) {
  const ctx = {
    source,
    types: new Set(source.moves().map((m) => m.type).concat(source.species().flatMap((s) => s.types))),
    targets: new Set(source.moves().map((m) => m.target)),
  }
  const applied = []
  const entries = doc.entries.filter((e) => e.regulations.includes(regulationId))
  // 허용 여부를 먼저 적용해 필드 보정이 추가된 항목에도 걸리게 한다.
  const ordered = [...entries].sort((a, b) => Number(b.allowed !== undefined) - Number(a.allowed !== undefined))
  for (const e of ordered) {
    const where = `game 보정 ${regulationId}/${e.kind}/${e.id}`
    const table = data[e.kind]
    const log = (field, before, after) =>
      applied.push({
        regulation: regulationId,
        kind: e.kind,
        id: e.id,
        field,
        before: before ?? null,
        after: after ?? null,
        noop: deepEqual(before, after),
        source: e.source,
        checked: e.checked,
      })
    if (e.allowed === false) {
      if (!table[e.id]) throw new PipelineError(`${where}: 제외할 항목이 스냅샷에 없음`)
      delete table[e.id]
      log('allowed', true, false)
    } else if (e.allowed === true && !table[e.id]) {
      const getter = { species: 'getSpecies', moves: 'getMove', items: 'getItem', abilities: 'getAbility' }[e.kind]
      const rec = source[getter](e.id)
      if (!rec) throw new PipelineError(`${where}: 원천에 없는 항목은 허용할 수 없음`)
      if (e.kind === 'species') {
        if (!isLegalSpecies({ ...rec, isNonstandard: null })) throw new PipelineError(`${where}: 배틀/외형 전용 폼`)
        table[e.id] = (await speciesEntryFrom(source, rec)).entry
      } else if (e.kind === 'moves') table[e.id] = moveEntryFrom(rec)
      else if (e.kind === 'items') table[e.id] = { id: rec.id, name: rec.name }
      else throw new PipelineError(`${where}: 특성은 종의 특성 목록으로만 들어온다(species.abilities 보정 사용)`)
      log('allowed', false, true)
    } else if (e.allowed === true) {
      log('allowed', true, true)
    }
    if (e.set) {
      const target = table[e.id]
      if (!target) throw new PipelineError(`${where}: 보정할 항목이 스냅샷에 없음`)
      for (const [field, value] of Object.entries(e.set)) {
        validateFieldValue(where, field, value, ctx)
        if (e.kind === 'species' && field === 'learnset' && target.isMega) {
          throw new PipelineError(`${where}: 메가 폼 learnset은 원종 ${target.baseSpecies}에서 파생된다(원종을 보정한다)`)
        }
        const before = target[field]
        let after = value
        if (field === 'learnset') after = sortedUnique(value)
        if (field === 'multihit' && value === null) after = undefined
        if (after === undefined) delete target[field]
        else target[field] = Array.isArray(after) ? [...after] : typeof after === 'object' ? { ...after } : after
        log(field, before, after)
      }
    }
  }
  return applied.sort((a, b) => cmp(`${a.kind}|${a.id}|${a.field}`, `${b.kind}|${b.id}|${b.field}`))
}

/** ko.json 형식 검증. */
export function validateKoOverrides(doc) {
  if (!doc || typeof doc !== 'object') throw new PipelineError('ko 보정표 형식 오류')
  for (const k of Object.keys(doc)) if (!KO_KINDS.includes(k)) throw new PipelineError(`ko 보정표: 알 수 없는 분류 ${k}`)
  for (const kind of KO_KINDS) {
    for (const [id, e] of Object.entries(doc[kind] ?? {})) {
      const where = `ko 보정표 ${kind}/${id}`
      if (id !== toID(id) || !id) throw new PipelineError(`${where}: id는 Showdown id`)
      for (const k of Object.keys(e)) {
        if (!['ko', 'koLabel', 'source', 'checked', 'note'].includes(k)) throw new PipelineError(`${where}: 알 수 없는 키 ${k}`)
      }
      if (e.ko === undefined && e.koLabel === undefined) throw new PipelineError(`${where}: ko 또는 koLabel 필요`)
      if (e.ko !== undefined && (typeof e.ko !== 'string' || !HANGUL.test(e.ko) || e.ko !== e.ko.trim())) {
        throw new PipelineError(`${where}: ko는 한글을 포함한 문자열`)
      }
      if (e.koLabel !== undefined && (typeof e.koLabel !== 'string' || !e.koLabel.trim())) {
        throw new PipelineError(`${where}: koLabel은 비지 않은 문자열`)
      }
      requireMeta(where, e)
    }
  }
}
