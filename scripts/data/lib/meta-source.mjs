// 메타 원천(Smogon chaos JSON): 설정 검증, 기록(받기·해시·공개 시각), 캐시 읽기·해시 대조, 형식 검증.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { MATCH_TYPES, META_MONTH_PATTERN } from '../../../src/data/meta-schema.ts'
import { PipelineError, cmp, isIsoInstant, sha256, toID } from './util.mjs'

export const META_CUTOFF = 1760
const URL_PREFIX = 'https://www.smogon.com/stats/'
const ID_RE = /^[a-z0-9-]+$/
const FORMAT_RE = /^[a-z0-9]+$/
const SHA_RE = /^[0-9a-f]{64}$/
export const SPREAD_KEY_RE = /^[A-Za-z]+:\d+\/\d+\/\d+\/\d+\/\d+\/\d+$/
const SOURCE_KEYS = ['regulation', 'month', 'match', 'format', 'cutoff', 'url', 'sha256', 'publishedAt']
const DIST_FIELDS = ['Abilities', 'Items', 'Spreads', 'Moves', 'Teammates']

export class MetaPipelineError extends PipelineError {
  constructor(message) {
    super(message)
    this.name = 'MetaPipelineError'
  }
}

const fail = (message) => {
  throw new MetaPipelineError(message)
}
const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v)

export function assertMonth(month) {
  if (typeof month !== 'string' || !META_MONTH_PATTERN.test(month)) fail(`월 형식이 YYYY-MM이 아니다: ${String(month)}`)
}

export const sourceUrl = (config, month, format) =>
  config.urlTemplate.replace('{month}', month).replace('{format}', format).replace('{cutoff}', String(config.cutoff))

/** <cacheDir>/smogon/<월>/chaos/<포맷>-<컷>.json */
export const cachePath = (cacheDir, month, format, cutoff) =>
  join(cacheDir, 'smogon', month, 'chaos', `${format}-${cutoff}.json`)

export const sourceKey = (s) => `${s.regulation}\u0000${s.month}\u0000${s.match}`
export const sortSources = (sources) => [...sources].sort((a, b) => cmp(sourceKey(a), sourceKey(b)))

/** 메타 설정 allowlist 검증. gameConfig는 sources.config.json. */
export function validateMetaConfig(config, gameConfig) {
  if (!isObject(config)) fail('메타 설정이 객체가 아니다')
  if (config.cutoff !== META_CUTOFF) fail(`cutoff는 ${META_CUTOFF}이어야 한다(받은 값: ${config.cutoff})`)
  const t = config.urlTemplate
  if (typeof t !== 'string' || !t.startsWith(URL_PREFIX) || !['{month}', '{format}', '{cutoff}'].every((p) => t.includes(p))) {
    fail(`urlTemplate은 ${URL_PREFIX}로 시작하고 {month}·{format}·{cutoff}를 포함해야 한다(받은 값: ${t})`)
  }
  const p = config.params
  if (!isObject(p)) fail('params가 객체가 아니다')
  const inRange = (k, ok) => {
    if (typeof p[k] !== 'number' || !ok(p[k])) fail(`params.${k} 범위 밖: ${p[k]}`)
  }
  inRange('minUsage', (v) => v > 0 && v < 1)
  inRange('spreadTarget', (v) => v > 0 && v <= 1)
  inRange('spreadMax', (v) => Number.isInteger(v) && v > 0)
  inRange('itemMin', (v) => v >= 0 && v < 1)
  inRange('moveMin', (v) => v >= 0 && v < 1)
  inRange('teammatesTop', (v) => Number.isInteger(v) && v > 0)
  const extra = Object.keys(p).filter((k) => !['minUsage', 'spreadTarget', 'spreadMax', 'itemMin', 'moveMin', 'teammatesTop'].includes(k))
  if (extra.length) fail(`params에 알 수 없는 키: ${extra.join(', ')}`)

  if (!isObject(config.regulations)) fail('regulations가 객체가 아니다')
  const gameRegs = new Set(gameConfig.regulations.map((r) => r.id))
  const formats = new Set()
  for (const [reg, mapping] of Object.entries(config.regulations)) {
    if (!ID_RE.test(reg) || !gameRegs.has(reg)) fail(`레귤레이션 ${reg}이 sources.config.json에 없다`)
    if (!isObject(mapping) || !Object.keys(mapping).length) fail(`레귤레이션 ${reg} 대응이 비어 있다`)
    for (const [match, format] of Object.entries(mapping)) {
      if (!MATCH_TYPES.includes(match)) fail(`레귤레이션 ${reg}: 알 수 없는 매치 방식 ${match}`)
      if (typeof format !== 'string' || !FORMAT_RE.test(format)) fail(`레귤레이션 ${reg}/${match}: 포맷 형식 ${format}`)
      if (formats.has(format)) fail(`포맷 ${format}이 두 번 대응됐다`)
      formats.add(format)
    }
  }

  if (!Array.isArray(config.sources)) fail('sources가 배열이 아니다')
  const seen = new Set()
  for (const s of config.sources) {
    const w = `기록 ${s?.regulation}/${s?.month}-${s?.match}`
    if (!isObject(s)) fail('sources 항목이 객체가 아니다')
    const unknown = Object.keys(s).filter((k) => !SOURCE_KEYS.includes(k))
    if (unknown.length) fail(`${w}: 알 수 없는 키 ${unknown.join(', ')}`)
    const mapping = Object.hasOwn(config.regulations, s.regulation) ? config.regulations[s.regulation] : null
    if (!mapping) fail(`${w}: 레귤레이션 대응에 없다`)
    assertMonth(s.month)
    if (!Object.hasOwn(mapping, s.match)) fail(`${w}: 매치 방식 ${s.match}이 대응에 없다`)
    if (s.format !== mapping[s.match]) fail(`${w}: 포맷 기대 ${mapping[s.match]}, 실제 ${s.format}`)
    if (s.cutoff !== META_CUTOFF) fail(`${w}: cutoff 기대 ${META_CUTOFF}, 실제 ${s.cutoff}`)
    const url = sourceUrl(config, s.month, s.format)
    if (s.url !== url) fail(`${w}: url 기대 ${url}, 실제 ${s.url}`)
    if (typeof s.sha256 !== 'string' || !SHA_RE.test(s.sha256)) fail(`${w}: sha256은 64자 hex`)
    if (!isIsoInstant(s.publishedAt)) fail(`${w}: publishedAt 형식 ${s.publishedAt}`)
    if (seen.has(sourceKey(s))) fail(`${w}: 기록 중복`)
    seen.add(sourceKey(s))
  }
}

/** 원천 월 구간 [월초, 다음 달 1일)과 레귤레이션 rules.start~end가 겹치는지. */
export function assertMonthInPeriod(reg, month) {
  const [y, m] = month.split('-').map(Number)
  const from = Date.UTC(y, m - 1, 1)
  const to = Date.UTC(y, m, 1)
  const start = Date.parse(reg.rules.start)
  const end = Date.parse(reg.rules.end)
  if (!(from <= end && to > start)) {
    fail(`원천 월 ${month}이 레귤레이션 ${reg.id} 기간(${reg.rules.start} ~ ${reg.rules.end})과 겹치지 않는다`)
  }
}

/** Last-Modified(HTTP 날짜) → YYYY-MM-DDTHH:MM:SSZ */
export function httpDateToIso(value) {
  const t = Date.parse(value)
  if (Number.isNaN(t)) fail(`Last-Modified를 해석할 수 없다: ${value}`)
  return new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z')
}

/** 원천을 받아 본문 바이트와 공개 시각을 돌려준다. 200·Last-Modified가 아니면 실패한다. */
export async function fetchSource(fetchFn, url) {
  const res = await fetchFn(url)
  if (res.status !== 200) fail(`${url}: HTTP ${res.status}`)
  const lm = res.headers.get('last-modified')
  if (!lm) fail(`${url}: Last-Modified 헤더 없음(공개 시각을 기록할 수 없다)`)
  const body = Buffer.from(await res.arrayBuffer())
  return { body, publishedAt: httpDateToIso(lm) }
}

/** 생성 모드 받기: 200이면 본문 바이트를 돌려준다. */
async function fetchBody(fetchFn, url) {
  const res = await fetchFn(url)
  if (res.status !== 200) fail(`${url}: HTTP ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

/** 생성 모드 원천: 캐시가 있으면 쓰고 없으면 받는다. 기록 해시와 같을 때만 쓰고, 받은 본문은 그때만 캐시에 저장한다. */
export async function readRecordedSource(record, cacheDir, fetchFn, log) {
  const p = cachePath(cacheDir, record.month, record.format, record.cutoff)
  const cached = existsSync(p)
  if (!cached) log(`원천 받기: ${record.url}`)
  const body = cached ? readFileSync(p) : await fetchBody(fetchFn, record.url)
  const actual = sha256(body)
  if (actual !== record.sha256) {
    const where = `원천 해시 불일치 ${record.regulation}/${record.month}-${record.match}: 기록 ${record.sha256}, 실제 ${actual}`
    fail(cached ? `${where} (캐시 ${p}). 캐시 파일을 지우고 다시 받으라` : `${where} (받은 본문, 캐시에 쓰지 않음: ${record.url})`)
  }
  if (!cached) {
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, body)
  }
  try {
    return JSON.parse(body.toString('utf8'))
  } catch (e) {
    return fail(`원천 JSON 해석 실패 ${p}: ${e.message}`)
  }
}

const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0)

/** 원천 형식 검증. 읽지 않는 필드(Checks and Counters 등)는 검사하지 않는다. */
export function validateSourceFormat(raw, record) {
  const errors = []
  const err = (where, field, expected, actual) =>
    errors.push(`${where} ${field}: 기대 ${expected}, 실제 ${JSON.stringify(actual)}`)
  const info = raw?.info
  if (!isObject(info)) err('info', '(객체)', '객체', info)
  else {
    if (info.metagame !== record.format) err('info', 'metagame', record.format, info.metagame)
    if (info.cutoff !== META_CUTOFF) err('info', 'cutoff', META_CUTOFF, info.cutoff)
    if (info['cutoff deviation'] !== 0) err('info', 'cutoff deviation', 0, info['cutoff deviation'])
    const b = info['number of battles']
    if (!Number.isInteger(b) || b < 0) err('info', 'number of battles', '0 이상 정수', b)
  }
  const data = raw?.data
  if (!isObject(data)) {
    err('data', '(객체)', '객체', typeof data)
    fail(`원천 형식 오류(${record.format} ${record.month}):\n- ${errors.join('\n- ')}`)
  }
  const ids = new Map()
  for (const [key, e] of Object.entries(data)) {
    const w = `종 ${key}`
    if (!isObject(e)) {
      err(w, '(객체)', '객체', typeof e)
      continue
    }
    if (typeof e.usage !== 'number' || !Number.isFinite(e.usage)) err(w, 'usage', '유한수', e.usage)
    if (!Number.isInteger(e['Raw count']) || e['Raw count'] < 0) err(w, 'Raw count', '0 이상 정수', e['Raw count'])
    let distOk = true
    for (const f of DIST_FIELDS) {
      const d = e[f]
      if (!isObject(d)) {
        err(w, f, '수 객체', d === undefined ? '(없음)' : typeof d)
        distOk = false
        continue
      }
      for (const [k, v] of Object.entries(d)) {
        if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
          err(w, `${f}[${k}]`, '0 이상 유한수', v)
          distOk = false
        }
      }
    }
    if (isObject(e.Spreads)) {
      for (const k of Object.keys(e.Spreads)) if (!SPREAD_KEY_RE.test(k)) err(w, `Spreads 키 ${k}`, '성격:H/A/B/C/D/S', k)
    }
    if (distOk) {
      const W = sum(e.Abilities)
      if (!(W > 0)) err(w, 'Σ Abilities', '> 0', W)
      else {
        for (const f of ['Items', 'Spreads']) {
          const s = sum(e[f])
          if (Math.abs(s - W) / W > 1e-6) err(w, `Σ ${f}`, `Σ Abilities ${W}(상대 오차 1e-6 이하)`, s)
        }
      }
    }
    const id = toID(key)
    if (ids.has(id)) err(w, '정규화 id', `고유(${ids.get(id)}와 충돌)`, id)
    ids.set(id, key)
  }
  if (errors.length) fail(`원천 형식 오류(${record.format} ${record.month}):\n- ${errors.join('\n- ')}`)
}

/** 기록 모드: 받아서 해시·공개 시각을 기록 목록에 반영하고 캐시에 저장한다. */
export async function recordSources({ config, regulation, month, matches, cacheDir, fetchFn, force, log }) {
  const sources = [...config.sources]
  const recorded = []
  const bodies = []
  for (const match of matches) {
    const format = config.regulations[regulation][match]
    const url = sourceUrl(config, month, format)
    log(`원천 받기(기록): ${url}`)
    const { body, publishedAt } = await fetchSource(fetchFn, url)
    const rec = { regulation, month, match, format, cutoff: config.cutoff, url, sha256: sha256(body), publishedAt }
    const i = sources.findIndex((s) => sourceKey(s) === sourceKey(rec))
    if (i >= 0) {
      const prev = sources[i]
      if ((prev.sha256 !== rec.sha256 || prev.publishedAt !== rec.publishedAt) && !force) {
        fail(
          `${regulation}/${month}-${match}: 기존 기록과 다르다(해시 ${prev.sha256} → ${rec.sha256}, 공개 ${prev.publishedAt} → ${rec.publishedAt}). --force로 다시 기록한다`,
        )
      }
      sources[i] = rec
    } else sources.push(rec)
    recorded.push({ regulation, month, match, sha256: rec.sha256, publishedAt: rec.publishedAt })
    bodies.push([cachePath(cacheDir, month, format, config.cutoff), body])
  }
  return { sources: sortSources(sources), recorded, bodies }
}
