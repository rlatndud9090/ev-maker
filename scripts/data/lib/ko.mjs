// 한국어 명칭: PokeAPI CSV(커밋 고정, sha256 검증 캐시) 조인 + 메가 조립 규칙 + 보정표.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PipelineError, cmp, parseCsv, sha256, toID } from './util.mjs'
import { KO_KINDS } from './overrides.mjs'

/** 캐시에 없을 때만 받는다. 해시가 기록돼 있으면 반드시 일치해야 한다. */
export async function ensurePokeapiFile(koConfig, cacheDir, relPath, expectedSha, { recordHashes = false } = {}) {
  const dir = join(cacheDir, 'pokeapi', koConfig.commit)
  const name = relPath.split('/').pop()
  const file = join(dir, name)
  let buf
  if (existsSync(file)) {
    buf = readFileSync(file)
  } else {
    const url = koConfig.baseUrl.replace('{commit}', koConfig.commit) + relPath
    const res = await fetch(url)
    if (!res.ok) throw new PipelineError(`PokeAPI 다운로드 실패 ${res.status}: ${url}`)
    buf = Buffer.from(await res.arrayBuffer())
    const got = sha256(buf)
    if (expectedSha && got !== expectedSha) throw new PipelineError(`${name} sha256 불일치(다운로드): ${got} ≠ ${expectedSha}`)
    if (!expectedSha && !recordHashes) throw new PipelineError(`${name} 해시 미기록: --record-hashes로 처음 받아 기록`)
    mkdirSync(dir, { recursive: true })
    writeFileSync(file, buf)
  }
  const got = sha256(buf)
  if (expectedSha && got !== expectedSha) {
    throw new PipelineError(`${file} sha256 불일치: ${got} ≠ ${expectedSha} (캐시를 지우고 다시 받거나 원천 고정을 확인)`)
  }
  if (!expectedSha && !recordHashes) throw new PipelineError(`${name} 해시 미기록: --record-hashes로 기록`)
  return { buf, sha: got }
}

export async function loadPokeapi(koConfig, cacheDir, opts) {
  const tables = {}
  const hashes = {}
  for (const [file, sha] of Object.entries(koConfig.files)) {
    const { buf, sha: got } = await ensurePokeapiFile(koConfig, cacheDir, koConfig.csvDir + file, sha, opts)
    hashes[file] = got
    tables[file.replace(/\.csv$/, '')] = parseCsv(buf.toString('utf8'))
  }
  const lic = await ensurePokeapiFile(koConfig, cacheDir, koConfig.license.path, koConfig.license.sha256, opts)
  return { tables, hashes, license: { text: lic.buf.toString('utf8'), sha: lic.sha } }
}

function koLanguageId(tables) {
  const rows = tables.languages.filter((r) => r.identifier === 'ko')
  if (rows.length !== 1) throw new PipelineError('languages.csv: ko 언어 행을 하나로 특정할 수 없음')
  return rows[0].id
}

/** 조인 테이블: norm(identifier) → [{identifier, ko}] */
function joinTable(master, names, fk, langId, nameField = 'name') {
  const ko = new Map()
  for (const r of names) if (r.local_language_id === langId && r[nameField]) ko.set(r[fk], r[nameField])
  const byNorm = new Map()
  const byIdentifier = new Map()
  for (const r of master) {
    const v = { identifier: r.identifier, ko: ko.get(r.id) ?? null }
    byIdentifier.set(r.identifier, v)
    const k = toID(r.identifier)
    if (!byNorm.has(k)) byNorm.set(k, [])
    byNorm.get(k).push(v)
  }
  return { byNorm, byIdentifier }
}

export function buildKoIndex(tables, aliases) {
  const lang = koLanguageId(tables)
  const t = {
    species: joinTable(tables.pokemon_species, tables.pokemon_species_names, 'pokemon_species_id', lang),
    forms: joinTable(tables.pokemon_forms, tables.pokemon_form_names, 'pokemon_form_id', lang, 'form_name'),
    moves: joinTable(tables.moves, tables.move_names, 'move_id', lang),
    items: joinTable(tables.items, tables.item_names, 'item_id', lang),
    abilities: joinTable(tables.abilities, tables.ability_names, 'ability_id', lang),
    natures: joinTable(tables.natures, tables.nature_names, 'nature_id', lang),
  }
  const ids = aliases.pokeapi?.identifiers ?? {}
  const dups = aliases.pokeapi?.duplicates ?? {}
  const used = new Set()

  function pick(kind, table, id, cands) {
    if (!cands || cands.length === 0) return null
    if (cands.length === 1) return cands[0]
    if (dups[kind]?.[id] !== 'prefer-ko') {
      throw new PipelineError(`PokeAPI ${kind} ${id}: identifier 중복 ${cands.map((c) => c.identifier).join(',')} (별칭표 duplicates 필요)`)
    }
    used.add(`dup:${kind}:${id}`)
    const withKo = [...new Set(cands.filter((c) => c.ko).map((c) => c.ko))]
    if (withKo.length !== 1) throw new PipelineError(`PokeAPI ${kind} ${id}: 중복 중 ko 값이 하나가 아님 ${withKo}`)
    return cands.find((c) => c.ko === withKo[0])
  }

  /** 단순 분류(기술·도구·특성·성격) */
  function simple(kind, id) {
    const table = t[kind]
    const alias = ids[kind]?.[id]
    if (alias !== undefined) {
      used.add(`id:${kind}:${id}`)
      const hit = table.byIdentifier.get(alias)
      if (!hit) throw new PipelineError(`별칭 ${kind}/${id} → ${alias}가 PokeAPI에 없음`)
      return hit.ko
    }
    return pick(kind, table, id, table.byNorm.get(id))?.ko ?? null
  }

  function speciesBase(id) {
    return pick('species', t.species, id, t.species.byNorm.get(id))?.ko ?? null
  }

  /** 폼 행의 form_name(ko). 별칭이 있으면 그 테이블·identifier를 쓴다. */
  function formName(id) {
    const alias = ids.species?.[id]
    if (alias) {
      used.add(`id:species:${id}`)
      const table = alias.table === 'pokemon_forms' ? t.forms : alias.table === 'pokemon_species' ? t.species : null
      if (!table) throw new PipelineError(`별칭 species/${id}: table ${alias.table} 미지원`)
      const hit = table.byIdentifier.get(alias.identifier)
      if (!hit) throw new PipelineError(`별칭 species/${id} → ${alias.identifier}가 PokeAPI에 없음`)
      return hit.ko
    }
    return pick('forms', t.forms, id, t.forms.byNorm.get(id))?.ko ?? null
  }

  function unusedAliases() {
    const out = []
    for (const kind of Object.keys(ids)) for (const id of Object.keys(ids[kind])) if (!used.has(`id:${kind}:${id}`)) out.push(`${kind}/${id}`)
    for (const kind of Object.keys(dups)) for (const id of Object.keys(dups[kind])) if (!used.has(`dup:${kind}:${id}`)) out.push(`duplicates:${kind}/${id}`)
    return out.sort(cmp)
  }

  return { simple, speciesBase, formName, unusedAliases }
}

const MEGA_SUFFIX = /Mega-([XYZ])$/

/** 원천(PokeAPI·메가 규칙)에서 정해지는 한국어 이름. 없으면 null. */
function autoKo(index, kind, entry, source) {
  if (kind !== 'species') {
    const ko = index.simple(kind, entry.id)
    return ko ? { ko, koSource: 'pokeapi' } : null
  }
  const rec = source.getSpecies(entry.id)
  const rootId = toID(rec.baseSpecies)
  if (!rec.forme) {
    const ko = index.speciesBase(entry.id)
    return ko ? { ko, koSource: 'pokeapi' } : null
  }
  const rootKo = index.speciesBase(rootId)
  const form = index.formName(entry.id)
  if (entry.isMega) {
    if (form) return { ko: form, koSource: 'pokeapi' }
    if (!rootKo) return null
    const m = MEGA_SUFFIX.exec(rec.forme)
    return { ko: `메가${rootKo}${m ? m[1] : ''}`, koSource: 'mega-rule' }
  }
  if (!form || !rootKo) return null
  // form_name이 완성형(예: 히트로토무)이면 그대로, 접미(예: 알로라의 모습)면 종명(접미)로 조립한다.
  return { ko: form.includes(rootKo) ? form : `${rootKo}(${form})`, koSource: 'pokeapi' }
}

/**
 * 영문 단계 데이터에 LocalizedName을 붙인다. 우선순위: 보정 > 원천 > 영문 대체.
 * 반환: { fallback[], applied[], conflicts[] }
 */
export function localize(data, source, index, koOverrides) {
  const fallback = []
  const applied = []
  const conflicts = []
  for (const kind of KO_KINDS) {
    for (const entry of Object.values(data[kind])) {
      const en = entry.name
      const auto = autoKo(index, kind, entry, source)
      const ov = koOverrides[kind]?.[entry.id]
      const name = { en, ko: en, koSource: 'fallback' }
      if (ov?.ko !== undefined) {
        name.ko = ov.ko
        name.koSource = 'override'
        applied.push({ kind, id: entry.id, field: 'ko', value: ov.ko, source: ov.source, checked: ov.checked })
        if (auto) {
          conflicts.push({
            kind,
            id: entry.id,
            override: ov.ko,
            source: auto.ko,
            sourceKind: auto.koSource,
            action: auto.ko === ov.ko ? 'remove-override' : 'warning',
          })
        }
      } else if (auto) {
        name.ko = auto.ko
        name.koSource = auto.koSource
      }
      if (ov?.koLabel !== undefined) {
        name.koLabel = ov.koLabel
        applied.push({ kind, id: entry.id, field: 'koLabel', value: ov.koLabel, source: ov.source, checked: ov.checked })
      }
      if (name.koSource === 'fallback') fallback.push({ kind, id: entry.id, en })
      entry.name = name
    }
  }
  const byKey = (a, b) => cmp(`${a.kind}|${a.id}|${a.field ?? ''}`, `${b.kind}|${b.id}|${b.field ?? ''}`)
  return { fallback: fallback.sort(byKey), applied: applied.sort(byKey), conflicts: conflicts.sort(byKey) }
}
