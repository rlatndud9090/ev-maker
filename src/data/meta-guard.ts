// 메타 로더(브라우저)와 테스트용 동기 로더가 공유하는 선택 규칙 해석·정합 검사(순수 함수).
import { MATCH_TYPES, META_MONTH_PATTERN, META_SCHEMA_VERSION } from './meta-schema'
import type { MatchType, MetaIndex, MetaIndexItem, MetaSnapshot } from './meta-schema'
import type { RegulationIndex } from './schema'
import { SnapshotLoadError, resolveRegulationId } from './snapshot-guard'

export class MetaLoadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MetaLoadError'
  }
}

export interface MetaRequest {
  regulation?: string
  match?: MatchType
  month?: string
}

export interface MetaSelection {
  regulation: string
  match: MatchType
  month: string
  item: MetaIndexItem
}

export interface GameDataRef {
  regulation: string
  match: MatchType
  month: string
  gameDataSha256: string
}

const isMatchType = (x: unknown): x is MatchType => MATCH_TYPES.includes(x as MatchType)
const isMonth = (x: unknown): x is string => typeof x === 'string' && META_MONTH_PATTERN.test(x)

function assertMonth(month: unknown): asserts month is string {
  if (!isMonth(month)) throw new MetaLoadError(`알 수 없는 월 형식: ${String(month)} (YYYY-MM)`)
}

function assertMatch(match: unknown): asserts match is MatchType {
  if (!isMatchType(match)) {
    throw new MetaLoadError(`알 수 없는 매치 방식: ${String(match)} (사용 가능: ${MATCH_TYPES.join(', ')})`)
  }
}

/** 예: metaFileName('2026-10', 'bo1') → "2026-10-bo1.json" */
export function metaFileName(month: string, match: MatchType): string {
  assertMonth(month)
  assertMatch(match)
  return `${month}-${match}.json`
}

/** 레귤레이션에 메타 스냅샷이 없으면 빈 배열. */
export function listMetaSnapshots(index: MetaIndex, regulation: string): MetaIndexItem[] {
  return Object.hasOwn(index.regulations, regulation) ? index.regulations[regulation] : []
}

/** 그 월 후보 중 판수(battles)가 가장 큰 항목. 동률이면 MATCH_TYPES 순(bo1 먼저). */
function mostBattles(items: MetaIndexItem[], month: string): MetaIndexItem | undefined {
  let best: MetaIndexItem | undefined
  for (const m of MATCH_TYPES) {
    const it = items.find((x) => x.match === m && x.month === month)
    if (it && (!best || it.battles > best.battles)) best = it
  }
  return best
}

const latestMonth = (items: MetaIndexItem[]): string | undefined =>
  items.reduce<string | undefined>((acc, it) => (acc === undefined || it.month > acc ? it.month : acc), undefined)

/**
 * 생략한 레귤레이션은 gameIndex.default, 생략한 월은 가장 최근 월(매치를 주면 그 매치의 최근 월).
 * 생략한 매치 방식은 정한 월 안에서 판수가 더 많은 쪽(동률 Bo1)이다. 예전 월 판수는 비교하지 않는다.
 */
export function resolveMetaSelection(index: MetaIndex, gameIndex: RegulationIndex, req?: MetaRequest): MetaSelection {
  if (req !== undefined && (typeof req !== 'object' || req === null)) {
    throw new MetaLoadError(`메타 요청은 객체여야 한다: ${String(req)}`)
  }
  const { regulation: reqReg, match, month } = req ?? {}
  let regulation: string
  try {
    regulation = resolveRegulationId(gameIndex, reqReg)
  } catch (e) {
    if (e instanceof SnapshotLoadError) throw new MetaLoadError(e.message)
    throw e
  }
  if (match !== undefined) assertMatch(match)
  if (month !== undefined) assertMonth(month)

  const items = listMetaSnapshots(index, regulation)
  const candidates = match === undefined ? items : items.filter((it) => it.match === match)
  const targetMonth = month ?? latestMonth(candidates)
  const item = targetMonth === undefined ? undefined : mostBattles(candidates, targetMonth)
  if (!item) {
    const available = items.map((it) => `${it.match} ${it.month}`).join(', ') || '없음'
    const wanted = `${match ?? '(판수 많은 쪽)'} ${month ?? '(최근 월)'}`
    throw new MetaLoadError(`레귤레이션 ${regulation}에 메타 스냅샷 ${wanted}이 없다 (사용 가능: ${available})`)
  }
  return { regulation, match: item.match, month: item.month, item }
}

/** schemaVersion과 항목 형식(매치 방식·월·파일 위치·판수)을 검사한다. */
export function assertMetaIndex(index: MetaIndex): void {
  if (index?.schemaVersion !== META_SCHEMA_VERSION) {
    throw new MetaLoadError(
      `메타 인덱스의 schemaVersion ${index?.schemaVersion}을 읽을 수 없다(앱 ${META_SCHEMA_VERSION})`,
    )
  }
  if (typeof index.regulations !== 'object' || index.regulations === null) {
    throw new MetaLoadError('메타 인덱스에 regulations 객체가 없다')
  }
  for (const [reg, items] of Object.entries(index.regulations)) {
    if (!Array.isArray(items)) throw new MetaLoadError(`메타 인덱스 ${reg} 항목이 배열이 아니다`)
    for (const it of items) {
      const expected = `${reg}/${metaFileName(it.month, it.match)}`
      if (it.file !== expected) {
        throw new MetaLoadError(`메타 인덱스 ${reg}의 파일 위치 ${it.file}이 ${expected}과 다르다`)
      }
      if (!Number.isSafeInteger(it.battles) || it.battles <= 0) {
        throw new MetaLoadError(`메타 인덱스 ${it.file}의 판수 battles ${String(it.battles)}가 양의 정수가 아니다`)
      }
    }
  }
}

/** schemaVersion과 (레귤레이션, 월, 매치 방식)이 선택과 같은지 검사한다. */
export function assertMetaSnapshot(
  sel: Pick<MetaSelection, 'regulation' | 'match' | 'month'>,
  meta: MetaSnapshot,
): void {
  const m = meta?.manifest
  const label = `${sel.regulation}/${sel.month}-${sel.match}`
  if (m?.schemaVersion !== META_SCHEMA_VERSION) {
    throw new MetaLoadError(
      `메타 스냅샷 ${label}의 schemaVersion ${m?.schemaVersion}을 읽을 수 없다(앱 ${META_SCHEMA_VERSION})`,
    )
  }
  if (m.regulation !== sel.regulation || m.month !== sel.month || m.match !== sel.match) {
    throw new MetaLoadError(`메타 스냅샷 ${label}의 매니페스트가 ${m.regulation}/${m.month}-${m.match}이다`)
  }
}

/** 동결 안 된 레귤레이션의 매치 방식별 최근 월 불일치는 mismatchLatest, 그 밖의 불일치는 staleArchived. */
export function classifyGameDataRefs(
  refs: GameDataRef[],
  current: Record<string, { sha256: string; frozen: boolean }>,
): { mismatchLatest: GameDataRef[]; staleArchived: GameDataRef[] } {
  const latestMonth = new Map<string, string>()
  for (const r of refs) {
    if (!Object.hasOwn(current, r.regulation)) {
      throw new MetaLoadError(`게임 데이터에 없는 레귤레이션의 메타 스냅샷: ${r.regulation}`)
    }
    const key = `${r.regulation}\u0000${r.match}`
    const prev = latestMonth.get(key)
    if (prev === undefined || r.month > prev) latestMonth.set(key, r.month)
  }
  const mismatchLatest: GameDataRef[] = []
  const staleArchived: GameDataRef[] = []
  for (const r of refs) {
    const cur = current[r.regulation]
    if (r.gameDataSha256 === cur.sha256) continue
    const isLatest = latestMonth.get(`${r.regulation}\u0000${r.match}`) === r.month
    if (!cur.frozen && isLatest) mismatchLatest.push(r)
    else staleArchived.push(r)
  }
  return { mismatchLatest, staleArchived }
}
