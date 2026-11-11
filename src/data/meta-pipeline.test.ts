/// <reference types="node" />
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { PROJECT_ROOT, buildMeta } from '../../scripts/data/lib/meta-pipeline.mjs'
import type { MetaBuildOptions } from '../../scripts/data/lib/meta-pipeline.mjs'
import { validateSet } from '../core/set'
import { resolveMetaSelection } from './meta-guard'
import type { MatchType, MetaEntry, MetaIndex, MetaSnapshot } from './meta-schema'
import type { StatId } from './schema'
import { loadRegulationIndexSync, loadSnapshotSync } from './testing'

const FIXTURE = join(PROJECT_ROOT, 'src/data/__fixtures__/meta/gen9championsvgc2026regmc-1760.2026-10.partial.json')
const BO1 = 'gen9championsvgc2026regmc'
const MB_BO3 = 'gen9championsvgc2026regmbbo3'
const STATS: StatId[] = ['hp', 'atk', 'def', 'spa', 'spd', 'spe']
const TIMEOUT = 60_000

interface RawSpecies {
  'Raw count': number
  usage: number | string
  Abilities: Record<string, number>
  Items: Record<string, number>
  Spreads?: Record<string, number>
  Moves: Record<string, number>
  Teammates: Record<string, number>
  'Checks and Counters'?: unknown
}
interface RawSource {
  info: Record<string, unknown>
  data: Record<string, RawSpecies>
}
interface SourceRecord {
  regulation: string
  month: string
  match: MatchType
  format: string
  cutoff: number
  url: string
  sha256: string
  publishedAt: string
}
interface MetaConfig {
  cutoff: number
  urlTemplate: string
  params: Record<string, number>
  regulations: Record<string, Partial<Record<MatchType, string>>>
  sources: SourceRecord[]
}
interface Report {
  size: number
  violations: Record<string, { count: number; weight: number }>
  violationDetails: Array<{ kind: string; species: string; value: string; weight: number; share?: number }>
  unlinkedAboveMin: string[]
  blankMoves: { species: number; weight: number }
  mega: {
    checked: number
    listed: number
    stoneNotTop: Array<{ species: string; top: string | null; stone: string }>
    abilityOutsideForm: Array<{ species: string; ability: string }>
  }
  species: { source: number; listed: number }
  retention: { reachedTarget: number; hitMax: number; exhausted: number; exhaustedSpecies: string[] }
}

const fixture = (): RawSource => JSON.parse(readFileSync(FIXTURE, 'utf8')) as RawSource
const baseConfig = (): MetaConfig => ({
  ...(JSON.parse(readFileSync(join(PROJECT_ROOT, 'scripts/data/meta.config.json'), 'utf8')) as MetaConfig),
  sources: [],
})
const sha = (b: string | Buffer) => createHash('sha256').update(b).digest('hex')
const round4 = (x: number) => Math.round(x * 1e4) / 1e4
const sumOf = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0)
const noFetch = async (): Promise<Response> => {
  throw new Error('네트워크 사용 금지')
}

const tmpDirs: string[] = []
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'evm-meta-'))
  tmpDirs.push(d)
  return d
}
afterAll(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true })
})

function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n)
      if (statSync(p).isDirectory()) walk(p)
      else out.push(relative(dir, p))
    }
  }
  walk(dir)
  return out.sort()
}

const urlOf = (month: string, format: string) => `https://www.smogon.com/stats/${month}/chaos/${format}-1760.json`

interface SourceSpec {
  raw?: RawSource
  regulation?: string
  month?: string
  match?: MatchType
  format?: string
}

/** 원천을 캐시에 두고 그 해시를 기록한 설정을 만든다. */
function addSource(cacheDir: string, config: MetaConfig, spec: SourceSpec = {}): SourceRecord {
  const { regulation = 'm-c', month = '2026-10', match = 'bo1', format = BO1 } = spec
  const body = JSON.stringify(spec.raw ?? fixture())
  const p = join(cacheDir, 'smogon', month, 'chaos', `${format}-1760.json`)
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, body)
  const rec: SourceRecord = {
    regulation,
    month,
    match,
    format,
    cutoff: 1760,
    url: urlOf(month, format),
    sha256: sha(body),
    publishedAt: '2026-11-01T13:27:17Z',
  }
  config.sources.push(rec)
  return rec
}

function setup(spec: SourceSpec = {}, params: Record<string, number> = {}) {
  const outRoot = tmp()
  const cacheDir = tmp()
  const config = baseConfig()
  config.params = { ...config.params, ...params }
  addSource(cacheDir, config, spec)
  const logs: string[] = []
  const run = (extra: Partial<MetaBuildOptions> = {}) =>
    buildMeta({
      regulation: spec.regulation ?? 'm-c',
      month: spec.month ?? '2026-10',
      match: [spec.match ?? 'bo1'],
      config,
      outRoot,
      cacheDir,
      fetch: noFetch,
      log: (m) => logs.push(m),
      ...extra,
    })
  const read = <T>(rel: string) => JSON.parse(readFileSync(join(outRoot, rel), 'utf8')) as T
  const meta = (month = spec.month ?? '2026-10', match = spec.match ?? 'bo1', reg = spec.regulation ?? 'm-c') =>
    read<MetaSnapshot>(`src/data/meta/${reg}/${month}-${match}.json`)
  const report = (month = spec.month ?? '2026-10', match = spec.match ?? 'bo1', reg = spec.regulation ?? 'm-c') =>
    read<Report>(`data/reports/meta/${reg}/${month}-${match}/report.json`)
  return { outRoot, cacheDir, config, logs, run, read, meta, report }
}

const entryOf = (meta: MetaSnapshot, id: string): MetaEntry => {
  const e = meta.entries.find((x) => x.id === id)
  if (!e) throw new Error(`항목 ${id} 없음`)
  return e
}

describe('메타 생성 재현성·보존', () => {
  it('같은 캐시로 두 번 생성하면 바이트가 같고 네트워크·PokeAPI·고지 파일을 쓰지 않는다', async () => {
    const a = setup()
    const b = setup()
    const ra = await a.run()
    await b.run()
    expect(ra.generated).toEqual(['m-c/2026-10-bo1'])
    expect(ra.noticeUpdateRequired).toBe(true)
    expect(a.logs).toContain('출처 고지 갱신 필요: npm run gen:snapshot 실행')
    const files = listFiles(a.outRoot)
    expect(files).toEqual([
      'data/reports/meta/m-c/2026-10-bo1/report.json',
      'data/reports/meta/m-c/2026-10-bo1/report.md',
      'src/data/meta/index.json',
      'src/data/meta/m-c/2026-10-bo1.json',
    ])
    expect(listFiles(b.outRoot)).toEqual(files)
    for (const f of files) expect(readFileSync(join(b.outRoot, f)).equals(readFileSync(join(a.outRoot, f))), f).toBe(true)
    for (const root of [a.outRoot, a.cacheDir]) {
      expect(listFiles(root).filter((f) => /pokeapi|licenses\.json|THIRD_PARTY_NOTICES/.test(f))).toEqual([])
    }
  }, TIMEOUT)

  it('매니페스트는 원천 기록과 data.json 바이트 해시를 담고 생성 시각을 담지 않는다', async () => {
    const s = setup()
    await s.run()
    const m = s.meta().manifest
    const rec = s.config.sources[0]
    expect(m.gameData).toEqual({
      regulation: 'm-c',
      schemaVersion: 1,
      sha256: sha(readFileSync(join(PROJECT_ROOT, 'src/data/regulations/m-c/data.json'))),
    })
    expect(m.source).toEqual({
      format: BO1,
      cutoff: 1760,
      url: rec.url,
      sha256: rec.sha256,
      publishedAt: rec.publishedAt,
      battles: fixture().info['number of battles'],
    })
    expect(m.params).toEqual(s.config.params)
    expect(Object.keys(m).sort()).toEqual(['gameData', 'match', 'month', 'params', 'regulation', 'sample', 'schemaVersion', 'source'])
  }, TIMEOUT)

  it('캐시가 1바이트 바뀌면 해시 불일치로 실패하고 아무것도 쓰지 않는다', async () => {
    const s = setup()
    const p = join(s.cacheDir, 'smogon/2026-10/chaos', `${BO1}-1760.json`)
    const text = readFileSync(p, 'utf8')
    writeFileSync(p, text.replace('"cutoff":1760', '"cutoff":1761'))
    await expect(s.run()).rejects.toThrow(/원천 해시 불일치 m-c\/2026-10-bo1.*캐시 파일을 지우고 다시 받으라/s)
    expect(listFiles(s.outRoot)).toEqual([])
  }, TIMEOUT)

  it('캐시가 없으면 받은 본문 해시가 기록과 같을 때만 캐시에 쓰고, Last-Modified 없이 200이면 된다', async () => {
    const s = setup()
    const p = join(s.cacheDir, 'smogon/2026-10/chaos', `${BO1}-1760.json`)
    const body = readFileSync(p)
    rmSync(p)
    const serve = (b: Buffer, status = 200) => async () => new Response(new Uint8Array(b), { status })

    await expect(s.run({ fetch: serve(Buffer.concat([body, Buffer.from(' ')])) })).rejects.toThrow(/원천 해시 불일치 m-c\/2026-10-bo1/)
    expect(existsSync(p)).toBe(false)
    expect(listFiles(s.outRoot)).toEqual([])
    await expect(s.run({ fetch: serve(body, 404) })).rejects.toThrow(/HTTP 404/)
    expect(existsSync(p)).toBe(false)

    const r = await s.run({ fetch: serve(body) })
    expect(r.generated).toEqual(['m-c/2026-10-bo1'])
    expect(readFileSync(p).equals(body)).toBe(true)
  }, TIMEOUT)

  it('해시를 기록하지 않은 원천으로는 생성하지 않는다', async () => {
    const s = setup()
    s.config.sources = []
    await expect(s.run()).rejects.toThrow(/해시 미기록: --record 먼저/)
    expect(listFiles(s.outRoot)).toEqual([])
  }, TIMEOUT)

  it('이미 있는 스냅샷은 --force 없이 건너뛰고 바이트를 그대로 두며, --force면 다시 만든다', async () => {
    const s = setup()
    await s.run()
    const file = join(s.outRoot, 'src/data/meta/m-c/2026-10-bo1.json')
    const before = readFileSync(file)
    const r2 = await s.run()
    expect(r2.skipped).toEqual(['m-c/2026-10-bo1'])
    expect(r2.generated).toEqual([])
    expect(r2.noticeUpdateRequired).toBe(false)
    expect(readFileSync(file).equals(before)).toBe(true)
    writeFileSync(file, before.toString('utf8').replace('"rank": 1', '"rank": 1 '))
    const r3 = await s.run({ force: true })
    expect(r3.generated).toEqual(['m-c/2026-10-bo1'])
    expect(readFileSync(file).equals(before)).toBe(true)
  }, TIMEOUT)

  it('기록 모드는 200·Last-Modified 응답의 본문 해시와 공개 시각을 설정에 쓰고, 다른 원천은 --force 없이 거부한다', async () => {
    const root = tmp()
    const cacheDir = tmp()
    const configPath = join(root, 'meta.config.json')
    writeFileSync(configPath, JSON.stringify(baseConfig()))
    const body = readFileSync(FIXTURE)
    const urls: string[] = []
    const fetchOk = (b: Buffer, headers: Record<string, string> = { 'last-modified': 'Sun, 01 Nov 2026 13:27:17 GMT' }) =>
      async (url: string) => {
        urls.push(url)
        return new Response(new Uint8Array(b), { status: 200, headers })
      }
    const opts = { regulation: 'm-c', month: '2026-10', match: ['bo1' as MatchType], configPath, cacheDir }
    const r = await buildMeta({ ...opts, record: true, fetch: fetchOk(body) })
    expect(urls).toEqual([urlOf('2026-10', BO1)])
    expect(r.recorded).toEqual([{ regulation: 'm-c', month: '2026-10', match: 'bo1', sha256: sha(body), publishedAt: '2026-11-01T13:27:17Z' }])
    expect(r.generated).toEqual([])
    const saved = JSON.parse(readFileSync(configPath, 'utf8')) as MetaConfig
    expect(saved.sources).toEqual([
      { regulation: 'm-c', month: '2026-10', match: 'bo1', format: BO1, cutoff: 1760, url: urlOf('2026-10', BO1), sha256: sha(body), publishedAt: '2026-11-01T13:27:17Z' },
    ])
    expect(readFileSync(join(cacheDir, 'smogon/2026-10/chaos', `${BO1}-1760.json`)).equals(body)).toBe(true)

    const outRoot = tmp()
    const gen = await buildMeta({ ...opts, outRoot, fetch: noFetch })
    expect(gen.generated).toEqual(['m-c/2026-10-bo1'])

    const changed = Buffer.concat([body, Buffer.from(' ')])
    await expect(buildMeta({ ...opts, record: true, fetch: fetchOk(changed) })).rejects.toThrow(/기존 기록과 다르다/)
    await buildMeta({ ...opts, record: true, force: true, fetch: fetchOk(changed) })
    expect((JSON.parse(readFileSync(configPath, 'utf8')) as MetaConfig).sources[0].sha256).toBe(sha(changed))
    await expect(buildMeta({ ...opts, record: true, force: true, fetch: fetchOk(body, {}) })).rejects.toThrow(/Last-Modified 헤더 없음/)
  }, TIMEOUT)
})

describe('메타 변환 규칙(픽스처)', () => {
  it('기본 최소값에서는 최소값 이상 종만 순위대로 담는다', async () => {
    const s = setup()
    await s.run()
    const meta = s.meta()
    expect(meta.entries.map((e) => [e.rank, e.id])).toEqual([
      [1, 'lycanrocdusk'],
      [2, 'aerodactyl'],
    ])
    expect(meta.entries.some((e) => e.id === 'meowsticfmega')).toBe(false)
    expect(s.report().violationDetails.some((d) => d.value === 'nothing')).toBe(false)
  }, TIMEOUT)

  it('도구 nothing은 정상 값이고 빈 칸 기술은 분포에서 빼고 개수만 리포트한다', async () => {
    const s = setup({}, { itemMin: 0 })
    await s.run()
    const src = fixture().data['Lycanroc-Dusk']
    const lyc = entryOf(s.meta(), 'lycanrocdusk')
    expect(src.Items.nothing).toBeGreaterThan(0)
    expect(lyc.items.shares.nothing).toBe(round4(src.Items.nothing / sumOf(src.Abilities)))
    expect(lyc.representative.set.item).toBe('focussash')
    expect(Object.hasOwn(src.Moves, '')).toBe(true)
    expect(Object.keys(lyc.moves.shares)).not.toContain('')
    expect(lyc.representative.set.moves).not.toContain('')
    const blanks = Object.values(fixture().data).filter((e) => Object.hasOwn(e.Moves, ''))
    expect(s.report().blankMoves).toEqual({
      species: blanks.length,
      weight: round4(blanks.reduce((a, e) => a + e.Moves[''], 0)),
    })
  }, TIMEOUT)

  it('최소값을 낮추면 원종·메가가 별도 항목이고, 메가 대표 세트는 원종+스톤+mega로 메가 폼에 해석된다', async () => {
    const s = setup({}, { minUsage: 0.0001 })
    await s.run()
    const meta = s.meta()
    const game = loadSnapshotSync('m-c')
    const charizard = entryOf(meta, 'charizard')
    expect(charizard.mega).toBeUndefined()
    expect(charizard.representative.set.mega).toBeUndefined()
    expect(validateSet(game, charizard.representative.set).species.id).toBe('charizard')

    for (const [id, base] of [
      ['meowsticmmega', 'meowstic'],
      ['meowsticfmega', 'meowsticf'],
    ]) {
      const e = entryOf(meta, id)
      expect(e.mega).toEqual({ base, stone: 'meowsticite' })
      expect(e.representative.set).toMatchObject({ species: base, item: 'meowsticite', mega: true, regulation: 'm-c' })
      expect(validateSet(game, e.representative.set).species.id).toBe(id)
    }

    const medicham = entryOf(meta, 'medichammega')
    expect(medicham.representative.abilityBasis).toBe('source-top')
    expect(medicham.representative.set.ability).toBe('purepower')
    const pidgeot = entryOf(meta, 'pidgeotmega')
    expect(pidgeot.abilities).toHaveProperty('noguard')
    expect(pidgeot.representative.abilityBasis).toBe('base-first-slot')
    expect(pidgeot.representative.set.ability).toBe('keeneye')
    expect(validateSet(game, pidgeot.representative.set).ability).toBe('noguard')

    const tox = entryOf(meta, 'toxtricity')
    expect(tox.abilities).not.toHaveProperty('minus')
    expect(tox.moves.shares).not.toHaveProperty('paraboliccharge')
    expect(tox.moves.shares).not.toHaveProperty('magneticflux')
    const details = s.report().violationDetails.filter((d) => d.species === 'toxtricity')
    expect(details.map((d) => [d.kind, d.value])).toEqual([
      ['illegal-ability', 'minus'],
      ['illegal-move', 'magneticflux'],
      ['illegal-move', 'paraboliccharge'],
    ])

    const pinsir = entryOf(meta, 'pinsirmega')
    const quaquaval = entryOf(meta, 'quaquaval')
    expect(pinsir.usage).toBe(quaquaval.usage)
    expect(quaquaval.rank).toBe(pinsir.rank + 1)
    for (const e of meta.entries) expect(() => validateSet(game, e.representative.set), e.id).not.toThrow()
  }, TIMEOUT)

  it('사용률이 같으면 원천 키 순서와 상관없이 식별자 순으로 순위를 매긴다', async () => {
    const raw = fixture()
    const { 'Pinsir-Mega': pinsir, ...rest } = raw.data
    raw.data = { ...rest, 'pinsir-mega': pinsir }
    expect(Object.keys(raw.data).sort().indexOf('Quaquaval')).toBeLessThan(Object.keys(raw.data).sort().indexOf('pinsir-mega'))
    expect(raw.data['pinsir-mega'].usage).toBe(raw.data.Quaquaval.usage)
    const s = setup({ raw }, { minUsage: 0.0001 })
    await s.run()
    const meta = s.meta()
    const p = entryOf(meta, 'pinsirmega')
    const q = entryOf(meta, 'quaquaval')
    expect(q.rank).toBe(p.rank + 1)
    expect(meta.entries.indexOf(q)).toBe(meta.entries.indexOf(p) + 1)
  }, TIMEOUT)

  it('대표 세트는 1위 spread + 최다 도구·특성 + 빈 칸 제외 상위 4 기술(동률은 id 순)이다', async () => {
    const game = loadSnapshotSync('m-c')
    const { spMaxPerStat, spTotal } = game.manifest.rules
    const toId = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, '')
    const ranked = (pairs: Array<[string, number]>, keep: (id: string) => boolean) => {
      const acc: Record<string, number> = {}
      for (const [k, v] of pairs) if (v > 0 && keep(k)) acc[k] = (acc[k] ?? 0) + v
      return Object.entries(acc).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    }
    const legalMoves = (src: RawSpecies, learnset: string[]) =>
      ranked(
        Object.entries(src.Moves).filter(([k]) => k !== '').map(([k, v]) => [toId(k), v]),
        (m) => learnset.includes(m),
      )

    const raw = fixture()
    const lycSrc = raw.data['Lycanroc-Dusk']
    const lycMoves = legalMoves(lycSrc, game.data.species.lycanrocdusk.learnset)
    const [lo, hi] = [lycMoves[3][0], lycMoves[4][0]].sort()
    const tieValue = lycMoves[3][1]
    const rebuilt: Record<string, number> = {}
    for (const [k, v] of Object.entries(lycSrc.Moves)) if (toId(k) !== lo && toId(k) !== hi) rebuilt[k] = v
    rebuilt[hi] = tieValue
    rebuilt[lo] = tieValue
    lycSrc.Moves = rebuilt
    const aeroItems = raw.data.Aerodactyl.Items
    const [aeroTop] = Object.entries(aeroItems).sort((a, b) => b[1] - a[1])[0]
    aeroItems.nothing = (aeroItems.nothing ?? 0) + aeroItems[aeroTop]
    delete aeroItems[aeroTop]

    const s = setup({ raw }, { minUsage: 0.0001 })
    await s.run()
    const meta = s.meta()
    const keyOf: Record<string, string> = Object.fromEntries(Object.keys(raw.data).map((k) => [toId(k), k]))
    expect(meta.entries.length).toBe(Object.keys(raw.data).length)
    for (const e of meta.entries) {
      const src = raw.data[keyOf[e.id]]
      const forme = game.data.species[e.id]
      const base = forme.isMega ? game.data.species[forme.baseSpecies as string] : forme
      const spreads = ranked(
        Object.entries(src.Spreads ?? {}).map(([k, v]) => {
          const [n, nums] = k.split(':')
          return [`${toId(n)}:${nums}`, v]
        }),
        (k) => {
          const [n, nums] = k.split(':')
          const sp = nums.split('/').map(Number)
          return Object.hasOwn(game.data.natures, n) && sp.every((x) => x <= spMaxPerStat) && sp.reduce((a, b) => a + b, 0) <= spTotal
        },
      )
      const [nature, nums] = spreads[0][0].split(':')
      const spv = nums.split('/').map(Number)
      const topAbility = ranked(
        Object.entries(src.Abilities).map(([k, v]) => [toId(k), v]),
        (a) => forme.abilities.includes(a),
      )[0][0]
      const expected: Record<string, unknown> = {
        regulation: 'm-c',
        species: base.id,
        ability: topAbility,
        nature,
        sp: Object.fromEntries(STATS.map((st, i) => [st, spv[i]])),
        moves: legalMoves(src, base.learnset).slice(0, 4).map(([m]) => m),
      }
      if (forme.isMega) {
        expected.item = forme.requiredItem
        expected.mega = true
        expected.ability = base.abilities.includes(topAbility) ? topAbility : base.abilities[0]
      } else {
        const topItem = ranked(
          Object.entries(src.Items).map(([k, v]) => [toId(k), v]),
          (it) => it === 'nothing' || Object.hasOwn(game.data.items, it),
        )[0]?.[0]
        if (topItem !== undefined && topItem !== 'nothing') expected.item = topItem
      }
      expect(e.representative.set, e.id).toEqual(expected)
      expect(e.representative.basis, e.id).toBe('modal-combination')
      if (forme.isMega) {
        expect(e.representative.abilityBasis, e.id).toBe(base.abilities.includes(topAbility) ? 'source-top' : 'base-first-slot')
      } else expect(e.representative, e.id).not.toHaveProperty('abilityBasis')
      expect(e.spreads.kept[0][0], e.id).toBe(spreads[0][0])
    }
    const lycSet = entryOf(meta, 'lycanrocdusk').representative.set
    expect(lycSet.moves[3]).toBe(lo)
    expect(lycSet.moves).not.toContain(hi)
    expect(entryOf(meta, 'aerodactyl').items.shares).toHaveProperty('nothing')
    expect(entryOf(meta, 'aerodactyl').representative.set).not.toHaveProperty('item')
  }, TIMEOUT)

  it('spreadMax를 줄여도 보존 규칙이 성립하고 성격·SP 주변분포는 전체 spread 기준이다', async () => {
    const s = setup({}, { minUsage: 0.0001, spreadMax: 3 })
    await s.run()
    const meta = s.meta()
    const raw = fixture()
    const ids: Record<string, string> = {
      'Lycanroc-Dusk': 'lycanrocdusk',
      Aerodactyl: 'aerodactyl',
      'Meowstic-F-Mega': 'meowsticfmega',
      'Meowstic-M-Mega': 'meowsticmmega',
      Charizard: 'charizard',
      'Medicham-Mega': 'medichammega',
      'Pidgeot-Mega': 'pidgeotmega',
      Toxtricity: 'toxtricity',
      'Pinsir-Mega': 'pinsirmega',
      Quaquaval: 'quaquaval',
    }
    expect(meta.entries.map((e) => e.id).sort()).toEqual(Object.values(ids).sort())
    for (const [key, id] of Object.entries(ids)) {
      const src = raw.data[key]
      const W = sumOf(src.Abilities)
      const e = entryOf(meta, id)
      const spreads = Object.entries(src.Spreads ?? {})
        .filter(([, v]) => v > 0)
        .map(([k, v]) => [k.replace(/^[A-Za-z]+/, (n) => n.toLowerCase()), v / W] as [string, number])
        .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      let cum = 0
      let n = 0
      while (n < spreads.length && n < 3 && cum < 0.8) cum += spreads[n++][1]
      expect(e.spreads.kept, id).toEqual(spreads.slice(0, n).map(([k, v]) => [k, round4(v)]))
      expect(e.spreads.kept.length === 3 || cum >= 0.8, id).toBe(true)
      expect(e.spreads.keptShare).toBe(round4(cum))
      expect(e.spreads.excludedShare).toBe(0)

      const natures: Record<string, number> = {}
      const marginal = Object.fromEntries(STATS.map((st) => [st, {} as Record<string, number>]))
      for (const [k, v] of Object.entries(src.Spreads ?? {})) {
        if (!(v > 0)) continue
        const [nature, nums] = k.split(':')
        natures[nature.toLowerCase()] = (natures[nature.toLowerCase()] ?? 0) + v
        nums.split('/').forEach((x, i) => {
          marginal[STATS[i]][x] = (marginal[STATS[i]][x] ?? 0) + v
        })
      }
      const toShares = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, round4(v / W)]))
      expect(e.natures, id).toEqual(toShares(natures))
      for (const st of STATS) expect(e.spMarginal[st], `${id} ${st}`).toEqual(toShares(marginal[st]))
    }
  }, TIMEOUT)

  it('위반을 빼고 남은 spread를 다 담아도 목표 미달이면 소진으로 분류하고 WARNING을 남긴 채 생성한다', async () => {
    const raw = fixture()
    const lyc = raw.data['Lycanroc-Dusk']
    const W = sumOf(lyc.Abilities)
    lyc.Spreads = { 'Adamant:2/32/0/0/0/32': W * 0.2, 'Jolly:2/32/0/0/0/32': W * 0.1, 'Adamant:33/32/0/0/0/1': W * 0.7 }

    const s = setup({ raw })
    const r = await s.run()
    expect(r.generated).toEqual(['m-c/2026-10-bo1'])
    expect(entryOf(s.meta(), 'lycanrocdusk').spreads.kept).toHaveLength(2)
    const report = s.report()
    expect(report.retention).toMatchObject({ reachedTarget: 1, hitMax: 0, exhausted: 1, exhaustedSpecies: ['lycanrocdusk'] })
    expect(report.species.listed).toBe(2)
    expect(s.logs).toContain('WARNING m-c/2026-10-bo1: 보존 spread 소진(목표 미달) lycanrocdusk')
    const md = readFileSync(join(s.outRoot, 'data/reports/meta/m-c/2026-10-bo1/report.md'), 'utf8')
    expect(md).toContain('남은 spread를 모두 담고도 목표 미달(소진): 1종 — lycanrocdusk')

    const capped = setup({ raw }, { spreadMax: 2 })
    await capped.run()
    expect(capped.report().retention).toMatchObject({ hitMax: 1, exhausted: 0, exhaustedSpecies: [] })
    expect(capped.logs.filter((m) => m.includes('소진'))).toEqual([])
  }, TIMEOUT)

  it('표본 지표는 정의식(Σ특성, Raw count, 전체 종 Σ특성 ÷ 12)과 같다', async () => {
    const s = setup({}, { minUsage: 0.0001 })
    await s.run()
    const meta = s.meta()
    const raw = fixture()
    let total = 0
    for (const src of Object.values(raw.data)) total += sumOf(src.Abilities)
    expect(meta.manifest.sample.weightedBattles).toBe(Math.round((total / 12) * 10) / 10)
    expect(meta.manifest.source.battles).toBe(raw.info['number of battles'])
    const lyc = raw.data['Lycanroc-Dusk']
    expect(entryOf(meta, 'lycanrocdusk').sample).toEqual({
      weighted: Math.round(sumOf(lyc.Abilities) * 100) / 100,
      raw: lyc['Raw count'],
    })
    const pinsir = raw.data['Pinsir-Mega']
    expect(entryOf(meta, 'pinsirmega').sample.raw).toBe(pinsir['Raw count'])
    expect(entryOf(meta, 'lycanrocdusk').usage).toBe(lyc.usage)
  }, TIMEOUT)

  it('위반 값을 섞은 원천은 위반 값만 빼고 재정규화하지 않으며 리포트에 종류별로 남긴다', async () => {
    const raw = fixture()
    const lyc = raw.data['Lycanroc-Dusk']
    const W = sumOf(lyc.Abilities)
    lyc.Abilities.toughclaws -= 1
    lyc.Abilities.levitate = 1
    lyc.Items.focussash -= 1
    lyc.Items.choiceband = 0.5
    lyc.Items.zzfakeitem = 0.5
    const spreads = lyc.Spreads as Record<string, number>
    spreads['Adamant:2/32/0/0/0/32'] -= 0.9
    spreads['Adamant:33/32/0/0/0/1'] = 0.3
    spreads['Adamant:32/32/32/0/0/0'] = 0.3
    spreads['Fakenature:2/32/0/0/0/32'] = 0.3
    lyc.Moves.spore = 0.2
    lyc.Moves.zzfakemove = 0.1
    lyc.Teammates.Fakemon = 0.4
    lyc.Teammates.Mewtwo = 0.3
    raw.data.Fakemon = { ...structuredClone(raw.data.Aerodactyl), usage: 0.02 }
    raw.data.Mewtwo = { ...structuredClone(raw.data.Aerodactyl), usage: 0.01 }

    const s = setup({ raw })
    await s.run()
    const meta = s.meta()
    expect(meta.entries.map((e) => e.id)).toEqual(['lycanrocdusk', 'aerodactyl'])
    const e = entryOf(meta, 'lycanrocdusk')
    expect(e.abilities).toEqual({ toughclaws: round4(lyc.Abilities.toughclaws / W) })
    expect(e.items.shares).not.toHaveProperty('choiceband')
    expect(e.items.shares).not.toHaveProperty('zzfakeitem')
    expect(e.items.shares.focussash).toBe(round4(lyc.Items.focussash / W))
    expect(e.items.shares.lifeorb).toBe(round4(lyc.Items.lifeorb / W))
    expect(e.items.excludedShare).toBe(round4(1 / W))
    expect(e.moves.shares).not.toHaveProperty('spore')
    expect(e.moves.shares).not.toHaveProperty('zzfakemove')
    expect(e.moves.shares.accelerock).toBe(round4(lyc.Moves.accelerock / W))
    expect(e.moves.excludedShare).toBe(round4(0.3 / W))
    expect(e.spreads.kept.map(([k]) => k)).not.toEqual(expect.arrayContaining(['adamant:33/32/0/0/0/1']))
    expect(e.spreads.kept).toContainEqual(['adamant:2/32/0/0/0/32', round4(spreads['Adamant:2/32/0/0/0/32'] / W)])
    expect(e.spreads.excludedShare).toBe(round4(0.9 / W))
    expect(e.natures).not.toHaveProperty('fakenature')
    expect(e.teammates).not.toHaveProperty('fakemon')
    expect(e.teammates).not.toHaveProperty('mewtwo')
    expect(e.sample.weighted).toBe(Math.round(W * 100) / 100)

    const report = s.report()
    const counts = Object.fromEntries(Object.entries(report.violations).map(([k, v]) => [k, v.count]))
    expect(counts).toEqual({
      'unlinked-species': 1,
      'species-not-in-roster': 1,
      'unlinked-item': 1,
      'item-not-in-roster': 1,
      'unlinked-ability': 0,
      'illegal-ability': 2,
      'unlinked-move': 1,
      'illegal-move': 3,
      'unknown-nature': 1,
      'sp-over-max': 1,
      'sp-over-total': 1,
      'unlinked-teammate': 1,
      'teammate-not-in-roster': 1,
    })
    const mine = report.violationDetails.filter((d) => d.species === 'lycanrocdusk').map((d) => [d.kind, d.value, d.share])
    expect(mine).toEqual([
      ['illegal-ability', 'levitate', round4(1 / W)],
      ['illegal-move', 'spore', round4(0.2 / W)],
      ['item-not-in-roster', 'choiceband', round4(0.5 / W)],
      ['sp-over-max', 'adamant:33/32/0/0/0/1', round4(0.3 / W)],
      ['sp-over-total', 'adamant:32/32/32/0/0/0', round4(0.3 / W)],
      ['teammate-not-in-roster', 'mewtwo', round4(0.3 / W)],
      ['unknown-nature', 'fakenature:2/32/0/0/0/32', round4(0.3 / W)],
      ['unlinked-item', 'zzfakeitem', round4(0.5 / W)],
      ['unlinked-move', 'zzfakemove', round4(0.1 / W)],
      ['unlinked-teammate', 'fakemon', round4(0.4 / W)],
    ])
    expect(report.violationDetails.filter((d) => d.kind.includes('species')).map((d) => [d.kind, d.species, d.value])).toEqual([
      ['species-not-in-roster', 'mewtwo', 'Mewtwo'],
      ['unlinked-species', 'fakemon', 'Fakemon'],
    ])
    expect(report.unlinkedAboveMin).toEqual(['Fakemon'])
    expect(s.logs).toContain('WARNING m-c/2026-10-bo1: 사용률 최소값 이상 종 미연결 Fakemon')
  }, TIMEOUT)

  it('메가 점검: 최다 도구가 스톤이 아니거나 특성이 메가 폼 밖이면 리포트에 남기고 폼 밖 특성은 위반으로 뺀다', async () => {
    const raw = fixture()
    const meowF = raw.data['Meowstic-F-Mega']
    const stone = meowF.Items.meowsticite
    meowF.Items = { meowsticite: stone * 0.4, sitrusberry: stone * 0.6 }
    const pidgeot = raw.data['Pidgeot-Mega']
    const PW = sumOf(pidgeot.Abilities)
    pidgeot.Abilities = { noguard: PW * 0.7, keeneye: PW * 0.3 }

    const s = setup({ raw }, { minUsage: 0.0001 })
    await s.run()
    const report = s.report()
    expect(report.mega).toEqual({
      checked: 5,
      listed: 5,
      stoneNotTop: [{ species: 'meowsticfmega', top: 'sitrusberry', stone: 'meowsticite' }],
      abilityOutsideForm: [{ species: 'pidgeotmega', ability: 'keeneye' }],
    })
    const pidgeotDetails = report.violationDetails.filter((d) => d.species === 'pidgeotmega').map((d) => [d.kind, d.value, d.share])
    expect(pidgeotDetails).toEqual([['illegal-ability', 'keeneye', round4(0.3)]])

    const meta = s.meta()
    const game = loadSnapshotSync('m-c')
    const p = entryOf(meta, 'pidgeotmega')
    expect(p.abilities).toEqual({ noguard: round4(0.7) })
    expect(validateSet(game, p.representative.set).ability).toBe('noguard')
    const m = entryOf(meta, 'meowsticfmega')
    expect(m.items.shares.sitrusberry).toBe(round4((stone * 0.6) / sumOf(meowF.Abilities)))
    expect(m.representative.set).toMatchObject({ species: 'meowsticf', item: 'meowsticite', mega: true })
    expect(validateSet(game, m.representative.set).species.id).toBe('meowsticfmega')
  }, TIMEOUT)
})

describe('메타 원천 형식 검증', () => {
  const mutate = (fn: (raw: RawSource) => void) => {
    const raw = fixture()
    fn(raw)
    return raw
  }
  const cases: Array<[string, () => ReturnType<typeof setup>, RegExp]> = [
    ['Spreads 누락', () => setup({ raw: mutate((r) => delete r.data['Lycanroc-Dusk'].Spreads) }), /종 Lycanroc-Dusk Spreads: 기대 수 객체, 실제 "\(없음\)"/],
    ['cutoff 1630', () => setup({ raw: mutate((r) => (r.info.cutoff = 1630)) }), /info cutoff: 기대 1760, 실제 1630/],
    ['cutoff deviation 0.5', () => setup({ raw: mutate((r) => (r.info['cutoff deviation'] = 0.5)) }), /info cutoff deviation: 기대 0, 실제 0.5/],
    ['metagame 불일치', () => setup({ raw: mutate((r) => (r.info.metagame = 'gen9vgc2026regf')) }), /info metagame: 기대 gen9championsvgc2026regmc, 실제 "gen9vgc2026regf"/],
    [
      '다른 레귤레이션 포맷 기록',
      () => {
        const s = setup()
        s.config.regulations['m-b'] = { bo3: MB_BO3 }
        s.config.sources[0].format = MB_BO3
        s.config.sources[0].url = urlOf('2026-10', MB_BO3)
        return s
      },
      /기록 m-c\/2026-10-bo1: 포맷 기대 gen9championsvgc2026regmc, 실제 gen9championsvgc2026regmbbo3/,
    ],
    ['레귤레이션 기간 밖 월', () => setup({ month: '2026-06' }), /원천 월 2026-06이 레귤레이션 m-c 기간/],
    [
      'spread 키 형식',
      () =>
        setup({
          raw: mutate((r) => {
            const sp = r.data['Lycanroc-Dusk'].Spreads as Record<string, number>
            sp['Adamant:2/32/0'] = sp['Adamant:2/32/0/0/0/32']
            delete sp['Adamant:2/32/0/0/0/32']
          }),
        }),
      /종 Lycanroc-Dusk Spreads 키 Adamant:2\/32\/0: 기대 성격:H\/A\/B\/C\/D\/S/,
    ],
    [
      'Σ도구 ≠ Σ특성',
      () =>
        setup({
          raw: mutate((r) => {
            const it = r.data.Aerodactyl.Items
            for (const k of Object.keys(it)) it[k] *= 1.01
          }),
        }),
      /종 Aerodactyl Σ Items: 기대 Σ Abilities/,
    ],
    ['usage 문자열', () => setup({ raw: mutate((r) => (r.data.Aerodactyl.usage = String(r.data.Aerodactyl.usage))) }), /종 Aerodactyl usage: 기대 유한수, 실제 "0\.0065/],
  ]
  for (const [name, make, pattern] of cases) {
    it(`${name}이면 원인을 담아 실패하고 아무것도 쓰지 않는다`, async () => {
      const s = make()
      await expect(s.run()).rejects.toThrow(pattern)
      expect(listFiles(s.outRoot)).toEqual([])
    }, TIMEOUT)
  }

  for (const cc of [{}, []]) {
    it(`Checks and Counters가 ${JSON.stringify(cc)}여도 정상 생성한다`, async () => {
      const raw = fixture()
      for (const e of Object.values(raw.data)) e['Checks and Counters'] = cc
      const s = setup({ raw })
      const r = await s.run()
      expect(r.generated).toEqual(['m-c/2026-10-bo1'])
    }, TIMEOUT)
  }
})

describe('메타 인덱스·설정 확장', () => {
  it('설정에만 m-b Bo3 대응을 넣으면 생성되고 m-b 기본 선택이 Bo3가 된다', async () => {
    const raw = fixture()
    raw.info.metagame = MB_BO3
    const outRoot = tmp()
    const cacheDir = tmp()
    const config = baseConfig()
    config.regulations['m-b'] = { bo3: MB_BO3 }
    addSource(cacheDir, config, { raw, regulation: 'm-b', month: '2026-09', match: 'bo3', format: MB_BO3 })
    const r = await buildMeta({ regulation: 'm-b', month: '2026-09', config, outRoot, cacheDir, fetch: noFetch })
    expect(r.generated).toEqual(['m-b/2026-09-bo3'])
    const index = JSON.parse(readFileSync(join(outRoot, 'src/data/meta/index.json'), 'utf8')) as MetaIndex
    const sel = resolveMetaSelection(index, loadRegulationIndexSync(), { regulation: 'm-b' })
    expect([sel.match, sel.month, sel.item.file]).toEqual(['bo3', '2026-09', 'm-b/2026-09-bo3.json'])
    const meta = JSON.parse(readFileSync(join(outRoot, 'src/data/meta/m-b/2026-09-bo3.json'), 'utf8')) as MetaSnapshot
    expect(meta.manifest.gameData.regulation).toBe('m-b')
    const game = loadSnapshotSync('m-b')
    for (const e of meta.entries) expect(validateSet(game, e.representative.set).set.regulation).toBe('m-b')
    const report = JSON.parse(readFileSync(join(outRoot, 'data/reports/meta/m-b/2026-09-bo3/report.json'), 'utf8')) as Report
    expect(report.violationDetails).toContainEqual(expect.objectContaining({ kind: 'species-not-in-roster', species: 'toxtricity' }))
  }, TIMEOUT)

  it('디스크에 다른 schemaVersion 파일이 있으면 목록을 담아 실패하고 아무것도 쓰지 않는다', async () => {
    const s = setup()
    const stale = join(s.outRoot, 'src/data/meta/m-c/2026-09-bo1.json')
    mkdirSync(dirname(stale), { recursive: true })
    writeFileSync(stale, JSON.stringify({ manifest: { schemaVersion: 0 }, entries: [] }))
    await expect(s.run()).rejects.toThrow(/다른 schemaVersion\(현재 1\) 메타 파일: m-c\/2026-09-bo1\.json\(schemaVersion 0\)/)
    expect(listFiles(s.outRoot)).toEqual(['src/data/meta/m-c/2026-09-bo1.json'])
  }, TIMEOUT)

  it('형식 밖 파일 이름이 있으면 실패한다', async () => {
    const s = setup()
    const odd = join(s.outRoot, 'src/data/meta/m-c/latest.json')
    mkdirSync(dirname(odd), { recursive: true })
    writeFileSync(odd, '{}')
    await expect(s.run()).rejects.toThrow(/메타 파일 이름 형식/)
  }, TIMEOUT)

  it('지난 월 스냅샷이 있는 채로 다른 월을 만들면 인덱스에 둘 다 남는다', async () => {
    const s = setup({ month: '2026-09' })
    await s.run()
    addSource(s.cacheDir, s.config, { month: '2026-10' })
    const r = await s.run({ month: '2026-10' })
    expect(r.generated).toEqual(['m-c/2026-10-bo1'])
    const index = s.read<MetaIndex>('src/data/meta/index.json')
    const battles = fixture().info['number of battles']
    expect(index.regulations['m-c'].map((it) => [it.month, it.match, it.file, it.url, it.battles])).toEqual([
      ['2026-09', 'bo1', 'm-c/2026-09-bo1.json', urlOf('2026-09', BO1), battles],
      ['2026-10', 'bo1', 'm-c/2026-10-bo1.json', urlOf('2026-10', BO1), battles],
    ])
  }, TIMEOUT)
})
