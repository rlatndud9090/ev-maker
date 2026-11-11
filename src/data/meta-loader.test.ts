import { describe, expect, it, vi } from 'vitest'
import {
  MetaLoadError,
  assertMetaIndex,
  assertMetaSnapshot,
  classifyGameDataRefs,
  listMetaSnapshots,
  metaFileName,
  resolveMetaSelection,
} from './meta-guard'
import type { GameDataRef } from './meta-guard'
import { createMetaLoader, loadMetaIndex, loadMetaSnapshot } from './meta-loader'
import type { MetaImporters } from './meta-loader'
import { META_SCHEMA_VERSION } from './meta-schema'
import type { MatchType, MetaIndex, MetaIndexItem, MetaSnapshot } from './meta-schema'
import type { RegulationIndex } from './schema'
import { loadMetaIndexSync, loadMetaSnapshotSync } from './testing'

const gameIndex: RegulationIndex = {
  schemaVersion: 1,
  default: 'm-c',
  regulations: [
    { id: 'm-b', name: 'B', mode: 'championsregmb', frozen: true },
    { id: 'm-c', name: 'C', mode: 'champions', frozen: false },
    { id: 'm-d', name: 'D', mode: 'champions', frozen: false },
  ],
}

const item = (reg: string, month: string, match: MatchType, battles = 100): MetaIndexItem => ({
  match,
  month,
  file: `${reg}/${month}-${match}.json`,
  format: `fmt${reg.replace('-', '')}${match}`,
  url: `https://example.test/${month}/${match}.json`,
  publishedAt: `${month}-28T00:00:00Z`,
  battles,
})

const index: MetaIndex = {
  schemaVersion: META_SCHEMA_VERSION,
  regulations: {
    'm-b': [item('m-b', '2026-08', 'bo3'), item('m-b', '2026-09', 'bo3')],
    // 예전 월(2026-09)의 Bo3 판수가 가장 크지만 기본 선택은 최근 월(2026-10) 안에서만 비교한다.
    'm-c': [
      item('m-c', '2026-08', 'bo3', 40),
      item('m-c', '2026-09', 'bo1', 100),
      item('m-c', '2026-09', 'bo3', 500),
      item('m-c', '2026-10', 'bo1', 300),
      item('m-c', '2026-10', 'bo3', 200),
    ],
  },
}

const snapshot = (reg: string, month: string, match: MatchType, schemaVersion = META_SCHEMA_VERSION): MetaSnapshot => ({
  manifest: {
    schemaVersion,
    regulation: reg,
    month,
    match,
    source: { format: 'f', cutoff: 1760, url: 'u', sha256: '0'.repeat(64), publishedAt: '2026-11-01T00:00:00Z', battles: 1 },
    params: { minUsage: 0.005, spreadTarget: 0.8, spreadMax: 30, itemMin: 0.001, moveMin: 0.005, teammatesTop: 10 },
    gameData: { regulation: reg, schemaVersion: 1, sha256: 'a'.repeat(64) },
    sample: { weightedBattles: 1 },
  },
  entries: [],
})

function fakeImporters(): { importers: MetaImporters; calls: Map<string, number> } {
  const calls = new Map<string, number>()
  const importers: MetaImporters = {}
  for (const [reg, items] of Object.entries(index.regulations)) {
    for (const it of items) {
      const key = `./meta/${reg}/${it.month}-${it.match}.json`
      importers[key] = async () => {
        calls.set(key, (calls.get(key) ?? 0) + 1)
        return snapshot(reg, it.month, it.match)
      }
    }
  }
  return { importers, calls }
}

const pick = (req?: Parameters<typeof resolveMetaSelection>[2]) => {
  const s = resolveMetaSelection(index, gameIndex, req)
  return `${s.regulation}/${s.month}-${s.match}`
}

describe('메타 선택 규칙', () => {
  it('모두 생략하면 기본 레귤레이션의 최근 월에서 판수가 더 많은 쪽을 고른다(예전 월 판수는 보지 않는다)', () => {
    expect(pick()).toBe('m-c/2026-10-bo1')
    expect(pick({})).toBe('m-c/2026-10-bo1')
    expect(resolveMetaSelection(index, gameIndex).item).toEqual(item('m-c', '2026-10', 'bo1', 300))
  })

  it('Bo1이 없는 레귤레이션은 Bo3 최신 월을 고른다', () => {
    expect(pick({ regulation: 'm-b' })).toBe('m-b/2026-09-bo3')
  })

  it('매치 방식만 주면 판수와 무관하게 그 매치 방식의 최신 월이다', () => {
    expect(pick({ match: 'bo3' })).toBe('m-c/2026-10-bo3')
    expect(pick({ match: 'bo1' })).toBe('m-c/2026-10-bo1')
  })

  it('월만 주면 그 월에서 판수가 더 많은 쪽, 한쪽만 있으면 그쪽이다', () => {
    expect(pick({ month: '2026-09' })).toBe('m-c/2026-09-bo3')
    expect(pick({ month: '2026-10' })).toBe('m-c/2026-10-bo1')
    expect(pick({ month: '2026-08' })).toBe('m-c/2026-08-bo3')
  })

  it('둘 다 주면 판수와 무관하게 정확히 그 조합이다', () => {
    expect(pick({ month: '2026-09', match: 'bo3' })).toBe('m-c/2026-09-bo3')
    expect(pick({ month: '2026-09', match: 'bo1' })).toBe('m-c/2026-09-bo1')
  })

  describe('판수 기준 기본 매치 방식(합성 인덱스)', () => {
    const only = (...items: MetaIndexItem[]): MetaIndex => ({ schemaVersion: META_SCHEMA_VERSION, regulations: { 'm-c': items } })
    const sel = (idx: MetaIndex, req?: Parameters<typeof resolveMetaSelection>[2]) => {
      const s = resolveMetaSelection(idx, gameIndex, req)
      return `${s.month}-${s.match}`
    }

    it('최근 월에서 Bo3 판수가 더 크면 Bo3다', () => {
      expect(sel(only(item('m-c', '2026-10', 'bo1', 10), item('m-c', '2026-10', 'bo3', 11)))).toBe('2026-10-bo3')
    })

    it('판수가 같으면 Bo1이다(인덱스 순서와 무관)', () => {
      expect(sel(only(item('m-c', '2026-10', 'bo3', 7), item('m-c', '2026-10', 'bo1', 7)))).toBe('2026-10-bo1')
      expect(sel(only(item('m-c', '2026-10', 'bo1', 7), item('m-c', '2026-10', 'bo3', 7)))).toBe('2026-10-bo1')
    })

    it('최근 월에 한 매치 방식만 있으면 예전 월의 다른 매치 방식 판수가 커도 그쪽이다', () => {
      const idx = only(item('m-c', '2026-09', 'bo1', 9_999), item('m-c', '2026-09', 'bo3', 1), item('m-c', '2026-10', 'bo3', 1))
      expect(sel(idx)).toBe('2026-10-bo3')
    })

    it('매치 방식을 주면 판수가 더 적어도 그 매치 방식이고, 월을 생략하면 그 매치 방식의 최근 월이다', () => {
      const idx = only(item('m-c', '2026-09', 'bo1', 5), item('m-c', '2026-10', 'bo3', 50))
      expect(sel(idx, { match: 'bo1' })).toBe('2026-09-bo1')
      expect(sel(idx)).toBe('2026-10-bo3')
    })

    it('월을 주면 그 월 안에서만 판수를 비교한다', () => {
      const idx = only(
        item('m-c', '2026-09', 'bo1', 1),
        item('m-c', '2026-09', 'bo3', 2),
        item('m-c', '2026-10', 'bo1', 9),
        item('m-c', '2026-10', 'bo3', 3),
      )
      expect(sel(idx, { month: '2026-09' })).toBe('2026-09-bo3')
      expect(sel(idx, { month: '2026-10' })).toBe('2026-10-bo1')
    })
  })

  it.each([
    [{ month: '2026-11', match: 'bo1' as const }],
    [{ month: '2026-07' }],
    [{ regulation: 'm-b', match: 'bo1' as const }],
    [{ regulation: 'm-d' }],
  ])('없는 조합 %j는 사용 가능 목록과 함께 거부한다', (req) => {
    expect(() => resolveMetaSelection(index, gameIndex, req)).toThrow(MetaLoadError)
    expect(() => resolveMetaSelection(index, gameIndex, req)).toThrow(/사용 가능/)
  })

  it('거부 메시지에 사용 가능한 (매치 방식, 월)을 담는다', () => {
    expect(() => resolveMetaSelection(index, gameIndex, { regulation: 'm-b', match: 'bo1' })).toThrow(
      /bo3 2026-08, bo3 2026-09/,
    )
    expect(() => resolveMetaSelection(index, gameIndex, { regulation: 'm-d' })).toThrow(/없음/)
  })

  it.each([
    { regulation: 'm-z' },
    { regulation: '__proto__' },
    { regulation: 'M-C' },
    { regulation: 42 },
    { match: 'bo2' },
    { match: 'BO1' },
    { month: '2026-1' },
    { month: '2026-13' },
    { month: '../x' },
    { month: 202610 },
  ])('잘못된 입력 %j는 거부한다', (req) => {
    expect(() => resolveMetaSelection(index, gameIndex, req as never)).toThrow(MetaLoadError)
  })

  it('객체가 아닌 요청은 거부한다', () => {
    expect(() => resolveMetaSelection(index, gameIndex, null as never)).toThrow(MetaLoadError)
    expect(() => resolveMetaSelection(index, gameIndex, 'm-c' as never)).toThrow(MetaLoadError)
  })

  it('파일 이름과 목록 규칙', () => {
    expect(metaFileName('2026-10', 'bo1')).toBe('2026-10-bo1.json')
    expect(() => metaFileName('../x', 'bo1')).toThrow(MetaLoadError)
    expect(() => metaFileName('2026-10', 'bo2' as never)).toThrow(MetaLoadError)
    expect(listMetaSnapshots(index, 'm-b')).toHaveLength(2)
    expect(listMetaSnapshots(index, 'm-d')).toEqual([])
    expect(listMetaSnapshots(index, '__proto__')).toEqual([])
  })
})

describe('메타 정합 검사', () => {
  it('인덱스 schemaVersion과 파일 위치를 검사한다', () => {
    expect(() => assertMetaIndex(index)).not.toThrow()
    expect(() => assertMetaIndex({ ...index, schemaVersion: 0 })).toThrow(/schemaVersion 0/)
    const wrongFile = { ...item('m-c', '2026-10', 'bo1'), file: 'm-c/../x.json' }
    expect(() => assertMetaIndex({ schemaVersion: 1, regulations: { 'm-c': [wrongFile] } })).toThrow(MetaLoadError)
  })

  it.each([0, -1, 1.5, Number.NaN, '100', null, undefined])('인덱스 판수 battles %j는 양의 정수가 아니라 거부한다', (battles) => {
    const bad = { ...item('m-c', '2026-10', 'bo1'), battles } as unknown as MetaIndexItem
    expect(() => assertMetaIndex({ schemaVersion: 1, regulations: { 'm-c': [bad] } })).toThrow(/판수 battles/)
  })

  it('schemaVersion이 다른 스냅샷을 명확한 오류로 거부한다', () => {
    const sel = { regulation: 'm-c', month: '2026-10', match: 'bo1' as const }
    expect(() => assertMetaSnapshot(sel, snapshot('m-c', '2026-10', 'bo1'))).not.toThrow()
    expect(() => assertMetaSnapshot(sel, snapshot('m-c', '2026-10', 'bo1', 0))).toThrow(
      /schemaVersion 0을 읽을 수 없다\(앱 1\)/,
    )
  })

  it.each([
    ['m-b', '2026-10', 'bo1'],
    ['m-c', '2026-09', 'bo1'],
    ['m-c', '2026-10', 'bo3'],
  ] as const)('선택과 다른 (%s, %s, %s) 매니페스트를 거부한다', (reg, month, match) => {
    const sel = { regulation: 'm-c', month: '2026-10', match: 'bo1' as const }
    expect(() => assertMetaSnapshot(sel, snapshot(reg, month, match))).toThrow(MetaLoadError)
  })
})

describe('createMetaLoader', () => {
  it('지정한 파일의 importer만 1번 부르고 다시 부르면 캐시를 쓴다', async () => {
    const { importers, calls } = fakeImporters()
    const loader = createMetaLoader(index, gameIndex, importers)
    const a = await loader.load({ month: '2026-09', match: 'bo3' })
    expect(a.manifest.month).toBe('2026-09')
    expect(a.manifest.match).toBe('bo3')
    expect([...calls]).toEqual([['./meta/m-c/2026-09-bo3.json', 1]])
    const b = await loader.load({ regulation: 'm-c', month: '2026-09', match: 'bo3' })
    expect(b).toBe(a)
    expect([...calls]).toEqual([['./meta/m-c/2026-09-bo3.json', 1]])
    await loader.load()
    expect(calls.get('./meta/m-c/2026-10-bo1.json')).toBe(1)
    expect(calls.size).toBe(2)
  })

  it('schemaVersion 0 스냅샷은 거부하고 캐시에 남기지 않는다', async () => {
    const importer = vi
      .fn<() => Promise<MetaSnapshot>>()
      .mockResolvedValueOnce(snapshot('m-c', '2026-10', 'bo1', 0))
      .mockResolvedValueOnce(snapshot('m-c', '2026-10', 'bo1'))
    const loader = createMetaLoader(index, gameIndex, { './meta/m-c/2026-10-bo1.json': importer })
    await expect(loader.load()).rejects.toThrow(/schemaVersion 0/)
    await expect(loader.load()).resolves.toEqual(snapshot('m-c', '2026-10', 'bo1'))
    expect(importer).toHaveBeenCalledTimes(2)
  })

  it('다른 month 스냅샷은 거부한다', async () => {
    const loader = createMetaLoader(index, gameIndex, {
      './meta/m-c/2026-10-bo1.json': async () => snapshot('m-c', '2026-09', 'bo1'),
    })
    await expect(loader.load()).rejects.toThrow(MetaLoadError)
  })

  it('importer 실패는 캐시하지 않는다', async () => {
    const importer = vi
      .fn<() => Promise<MetaSnapshot>>()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(snapshot('m-c', '2026-10', 'bo1'))
    const loader = createMetaLoader(index, gameIndex, { './meta/m-c/2026-10-bo1.json': importer })
    await expect(loader.load()).rejects.toThrow('network')
    await expect(loader.load()).resolves.toBeDefined()
    expect(importer).toHaveBeenCalledTimes(2)
  })

  it('파일이 없거나 입력이 잘못되면 MetaLoadError로 거절한다', async () => {
    const { importers, calls } = fakeImporters()
    const loader = createMetaLoader(index, gameIndex, importers)
    await expect(loader.load({ regulation: '../m-c' })).rejects.toBeInstanceOf(MetaLoadError)
    await expect(loader.load({ month: '2026-07' })).rejects.toBeInstanceOf(MetaLoadError)
    const missing = createMetaLoader(index, gameIndex, {})
    await expect(missing.load()).rejects.toThrow(/파일이 없다/)
    expect(calls.size).toBe(0)
  })

  it('schemaVersion이 다른 인덱스는 index()·select()에서 거부한다', () => {
    const loader = createMetaLoader({ ...index, schemaVersion: 2 }, gameIndex, {})
    expect(() => loader.index()).toThrow(MetaLoadError)
    expect(() => loader.select()).toThrow(MetaLoadError)
  })
})

describe('classifyGameDataRefs', () => {
  const ref = (regulation: string, month: string, match: MatchType, gameDataSha256: string): GameDataRef => ({
    regulation,
    month,
    match,
    gameDataSha256,
  })
  const current = { 'm-b': { sha256: 'B', frozen: true }, 'm-c': { sha256: 'C', frozen: false } }

  it('동결 안 된 레귤레이션의 매치 방식별 최신 월 불일치는 mismatchLatest다', () => {
    const refs = [
      ref('m-c', '2026-09', 'bo1', 'old'),
      ref('m-c', '2026-10', 'bo1', 'old'),
      ref('m-c', '2026-10', 'bo3', 'C'),
      ref('m-c', '2026-09', 'bo3', 'old'),
      ref('m-b', '2026-09', 'bo3', 'old'),
    ]
    const { mismatchLatest, staleArchived } = classifyGameDataRefs(refs, current)
    expect(mismatchLatest).toEqual([ref('m-c', '2026-10', 'bo1', 'old')])
    expect(staleArchived).toEqual([
      ref('m-c', '2026-09', 'bo1', 'old'),
      ref('m-c', '2026-09', 'bo3', 'old'),
      ref('m-b', '2026-09', 'bo3', 'old'),
    ])
  })

  it('해시가 모두 같으면 둘 다 비고, 게임 데이터에 없는 레귤레이션은 거부한다', () => {
    expect(classifyGameDataRefs([ref('m-c', '2026-10', 'bo1', 'C')], current)).toEqual({
      mismatchLatest: [],
      staleArchived: [],
    })
    expect(() => classifyGameDataRefs([ref('m-z', '2026-10', 'bo1', 'C')], current)).toThrow(MetaLoadError)
  })
})

describe('커밋된 메타 인덱스', () => {
  it('loadMetaIndex는 동기 로더와 같은 현재 스키마 인덱스를 준다', async () => {
    const real = await loadMetaIndex()
    expect(real.schemaVersion).toBe(META_SCHEMA_VERSION)
    expect(real).toEqual(loadMetaIndexSync())
  })

  it('인덱스의 모든 항목을 비동기·동기 로더가 같은 내용으로 읽는다', async () => {
    const real = loadMetaIndexSync()
    for (const [regulation, items] of Object.entries(real.regulations)) {
      for (const { match, month } of items) {
        const req = { regulation, match, month }
        expect(await loadMetaSnapshot(req)).toEqual(loadMetaSnapshotSync(req))
      }
    }
  })

  it('메타 스냅샷이 없는 레귤레이션은 MetaLoadError로 거절한다', async () => {
    await expect(loadMetaSnapshot({ regulation: 'm-b' })).rejects.toBeInstanceOf(MetaLoadError)
    expect(() => loadMetaSnapshotSync({ regulation: 'm-b' })).toThrow(MetaLoadError)
  })
})
