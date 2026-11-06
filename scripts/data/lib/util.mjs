import { createHash } from 'node:crypto'

export class PipelineError extends Error {
  constructor(message) {
    super(message)
    this.name = 'PipelineError'
  }
}

/** Showdown id 규칙: 소문자 영숫자만 남긴다. */
export function toID(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
}

/** 로캘에 의존하지 않는 코드 유닛 비교(결정적 정렬). */
export function cmp(a, b) {
  return a < b ? -1 : a > b ? 1 : 0
}

export function sortedUnique(values) {
  return [...new Set(values)].sort(cmp)
}

export function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex')
}

function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep)
  if (value && typeof value === 'object') {
    const out = {}
    for (const k of Object.keys(value).sort(cmp)) {
      if (value[k] === undefined) continue
      out[k] = sortKeysDeep(value[k])
    }
    return out
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new PipelineError(`직렬화할 수 없는 수치: ${value}`)
  }
  return value
}

/** 키 정렬·2칸 들여쓰기·끝 줄바꿈. 배열 순서는 호출자가 정한다. */
export function stableStringify(value) {
  return JSON.stringify(sortKeysDeep(value), null, 2) + '\n'
}

/** RFC 4180 CSV(따옴표·이스케이프·CRLF) → 헤더 키 객체 배열. */
export function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let i = 0
  let quoted = false
  if (text.charCodeAt(0) === 0xfeff) i = 1
  for (; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += c
  }
  if (quoted) throw new PipelineError('CSV: 닫히지 않은 따옴표')
  if (field !== '' || row.length) {
    row.push(field)
    rows.push(row)
  }
  const [header, ...body] = rows.filter((r) => !(r.length === 1 && r[0] === ''))
  if (!header) throw new PipelineError('CSV: 헤더 없음')
  return body.map((r, n) => {
    if (r.length !== header.length) {
      throw new PipelineError(`CSV: ${n + 2}행 열 수 ${r.length} ≠ 헤더 ${header.length}`)
    }
    return Object.fromEntries(header.map((h, k) => [h, r[k]]))
  })
}

/** 키 순서와 무관한 구조 비교. */
export function deepEqual(a, b) {
  return stableStringify(a ?? null) === stableStringify(b ?? null)
}

export const HANGUL =/[가-힣]/

export function isIsoDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s))
}

export function isIsoInstant(s) {
  return (
    typeof s === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?Z$/.test(s) &&
    !Number.isNaN(Date.parse(s))
  )
}
