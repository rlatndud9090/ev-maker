/// <reference types="node" />
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { calcDamage, validateSet, type PokemonSet } from '../core'
import {
  createMetaView,
  lookupOpponent,
  representativeAssumption,
  topAssumptions,
  type AssumptionOverlay,
} from '../meta'
import { classifyGameDataRefs, resolveMetaSelection, type GameDataRef } from './meta-guard'
import { loadMetaSnapshot } from './meta-loader'
import { META_SCHEMA_VERSION, type MatchType, type MetaEntry, type MetaSnapshot } from './meta-schema'
import { loadMetaIndexSync, loadMetaSnapshotSync, loadRegulationIndexSync, loadSnapshotSync } from './testing'

const ROOT = new URL('../../', import.meta.url)
const readBytes = (rel: string) => readFileSync(new URL(rel, ROOT))
const readJson = <T>(rel: string) => JSON.parse(readBytes(rel).toString('utf8')) as T
const sha256 = (buf: Buffer) => createHash('sha256').update(buf).digest('hex')
const pct = (x: number) => x * 100

const SIZE_LIMIT = 1_000_000
const metaIndex = loadMetaIndexSync()
const gameIndex = loadRegulationIndexSync()
const game = loadSnapshotSync('m-c')
const bo1 = loadMetaSnapshotSync({ regulation: 'm-c', match: 'bo1', month: '2026-10' })
const bo3 = loadMetaSnapshotSync({ regulation: 'm-c', match: 'bo3', month: '2026-10' })
const view = createMetaView(bo1, game)
const currentMcSha = sha256(readBytes('src/data/regulations/m-c/data.json'))
const latestMonth = (match: MatchType) =>
  metaIndex.regulations['m-c'].filter((x) => x.match === match).map((x) => x.month).sort().at(-1)

/** 현재 게임 데이터 기준 스냅샷이면 true. 아니면 그 매치의 최신 월이 아님(지난 월 보존)을 단언하고 false. */
const onCurrentGameData = (meta: MetaSnapshot): boolean => {
  const { month, match, gameData } = meta.manifest
  if (gameData.sha256 === currentMcSha) return true
  expect(month, `${month}-${match}: 최신 월은 현재 게임 데이터 해시와 같아야 한다`).not.toBe(latestMonth(match))
  console.log(`[meta] ${month}-${match}는 다른 게임 데이터 기준이라 현재 게임 데이터 검증을 건너뛴다`)
  return false
}

const entryOf = (meta: MetaSnapshot, id: string): MetaEntry => {
  const e = meta.entries.find((x) => x.id === id)
  if (!e) throw new Error(`${id} 항목 없음`)
  return e
}
const topKey = (shares: Record<string, number>): [string, number] =>
  Object.entries(shares).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]

interface MetaConfigSource {
  regulation: string
  month: string
  match: string
  sha256: string
  publishedAt: string
  url: string
  format: string
}
interface MetaReport {
  size: number
  violations: Record<string, { count: number; weight: number }>
  violationDetails: Array<{ kind: string; species: string; value: string }>
}

describe('커밋된 메타 스냅샷 선택', () => {
  it('m-c 인덱스에 2026-10 bo1·bo3가 있고 기본 선택은 bo1 최신 월이다', () => {
    const items = metaIndex.regulations['m-c'].map((x) => `${x.month}/${x.match}`)
    expect(items).toEqual(expect.arrayContaining(['2026-10/bo1', '2026-10/bo3']))
    const sel = resolveMetaSelection(metaIndex, gameIndex)
    expect([sel.regulation, sel.match, sel.month]).toEqual(['m-c', 'bo1', latestMonth('bo1')])
    expect(loadMetaSnapshotSync().manifest).toEqual(loadMetaSnapshotSync({ regulation: 'm-c', match: 'bo1', month: latestMonth('bo1') }).manifest)
  })

  it('브라우저 로더 loadMetaSnapshot()은 동기 로더와 같은 스냅샷을 낸다', async () => {
    expect(await loadMetaSnapshot()).toEqual(loadMetaSnapshotSync())
    expect(await loadMetaSnapshot({ month: '2026-10' })).toEqual(bo1)
    expect(await loadMetaSnapshot({ match: 'bo3', month: '2026-10' })).toEqual(bo3)
  })
})

describe('Bo1 2026-10 원천 값 대조', () => {
  it('사용률 상위 5의 id·순위·사용률(소수 첫째 자리 %)', () => {
    const top = bo1.entries.slice(0, 5)
    expect(top.map((e) => [e.id, e.rank])).toEqual([
      ['sneasler', 1],
      ['kingambit', 2],
      ['basculegion', 3],
      ['charizardmegay', 4],
      ['rillaboom', 5],
    ])
    ;[49.9, 42.2, 34.4, 32.3, 27.4].forEach((v, i) => expect(pct(top[i].usage)).toBeCloseTo(v, 1))
  })

  it('포푸니크 1위 spread·S32·고집·최다 도구·최다 동료', () => {
    const s = entryOf(bo1, 'sneasler')
    expect(s.spreads.kept[0][0]).toBe('adamant:2/32/0/0/0/32')
    expect(pct(s.spreads.kept[0][1])).toBeCloseTo(13.15, 1)
    expect(pct(s.spMarginal.spe['32'])).toBeCloseTo(46.65, 1)
    expect(pct(s.natures.adamant)).toBeCloseTo(54.44, 1)
    const [item, itemShare] = topKey(s.items.shares)
    expect(item).toBe('whiteherb')
    expect(pct(itemShare)).toBeCloseTo(33.43, 1)
    const [mate, mateShare] = topKey(s.teammates)
    expect(mate).toBe('kingambit')
    expect(pct(mateShare)).toBeCloseTo(59.81, 1)
  })

  it('보존 규칙: 모든 항목이 누적 ≥ 목표에서 멈추거나 최대 개수에 닿는다', () => {
    for (const meta of [bo1, bo3]) {
      const { spreadTarget, spreadMax } = meta.manifest.params
      for (const e of meta.entries) {
        const { kept, keptShare } = e.spreads
        const sum = kept.reduce((a, [, v]) => a + v, 0)
        expect(keptShare, e.id).toBeCloseTo(sum, 2)
        expect(kept.length, e.id).toBeLessThanOrEqual(spreadMax)
        if (kept.length < spreadMax) {
          expect(keptShare, e.id).toBeGreaterThanOrEqual(spreadTarget - 1e-4)
          expect(sum - kept[kept.length - 1][1], `${e.id} 마지막 하나 전에는 목표 미달`).toBeLessThan(spreadTarget + 2e-3)
        }
        for (let i = 1; i < kept.length; i++) expect(kept[i - 1][1], e.id).toBeGreaterThanOrEqual(kept[i][1])
      }
      const { month, match } = meta.manifest
      const report = readJson<{ species: { listed: number }; retention: Record<string, unknown> }>(
        `data/reports/meta/m-c/${month}-${match}/report.json`,
      )
      const { reachedTarget, hitMax, exhausted, exhaustedSpecies } = report.retention
      expect(exhausted, `${month}-${match}`).toBe(0)
      expect(exhaustedSpecies).toEqual([])
      expect(Number(reachedTarget) + Number(hitMax)).toBe(report.species.listed)
    }
  })

  it('고릴타는 최대 개수에서 멈추지만 성격 주변분포는 전체 spread 기준이다', () => {
    const r = entryOf(bo1, 'rillaboom')
    expect(r.spreads.kept).toHaveLength(bo1.manifest.params.spreadMax)
    expect(r.spreads.keptShare).toBeCloseTo(0.439, 2)
    const naturesSum = Object.values(r.natures).reduce((a, b) => a + b, 0)
    expect(naturesSum).toBeCloseTo(1 - r.spreads.excludedShare, 2)
    expect(naturesSum).toBeGreaterThan(r.spreads.keptShare + 0.5)
    for (const stat of ['hp', 'atk', 'def', 'spa', 'spd', 'spe'] as const) {
      const sum = Object.values(r.spMarginal[stat]).reduce((a, b) => a + b, 0)
      expect(sum, stat).toBeCloseTo(1 - r.spreads.excludedShare, 2)
    }
  })

  it('표본 지표: 상위 5 가중·비가중 출현 수, 가중 배틀 수, 배틀 수', () => {
    const cases: Array<[MetaSnapshot, Array<[string, number, number]>, number, number]> = [
      [
        bo1,
        [
          ['sneasler', 6309.7, 1077841],
          ['kingambit', 5293.7, 625098],
          ['basculegion', 4311.8, 431738],
          ['charizardmegay', 4069.8, 464830],
          ['rillaboom', 3502.5, 1173979],
        ],
        6357.6,
        1649648,
      ],
      [
        bo3,
        [
          ['sneasler', 6111.0, 205184],
          ['rillaboom', 5079.1, 237825],
          ['incineroar', 4745.8, 223847],
          ['kingambit', 4149.1, 148590],
          ['basculegion', 2965.6, 96626],
        ],
        6592.7,
        262609,
      ],
    ]
    for (const [meta, rows, weightedBattles, battles] of cases) {
      expect(meta.entries.slice(0, 5).map((e) => e.id)).toEqual(rows.map((r) => r[0]))
      for (const [id, weighted, raw] of rows) {
        const e = entryOf(meta, id)
        expect(e.sample.weighted, id).toBeCloseTo(weighted, 1)
        expect(e.sample.raw, id).toBe(raw)
      }
      expect(meta.manifest.sample.weightedBattles).toBeCloseTo(weightedBattles, 1)
      expect(meta.manifest.source.battles).toBe(battles)
    }
  })
})

describe('메가 항목', () => {
  it('한카리아스·메가한카리아스·메가한카리아스Z는 별도 항목이고 리자몽은 목록 밖이다', () => {
    const ids = new Set(bo1.entries.map((e) => e.id))
    for (const id of ['garchomp', 'garchompmega', 'garchompmegaz', 'charizardmegay']) expect(ids.has(id), id).toBe(true)
    expect(ids.has('charizard')).toBe(false)
    expect(entryOf(bo1, 'garchomp').mega).toBeUndefined()
  })

  it('메가 항목은 원종·스톤을 가리키고 대표 세트가 메가 폼으로 해석된다', () => {
    const cases: Array<[string, string, string]> = [
      ['charizardmegay', 'charizard', 'charizarditey'],
      ['garchompmegaz', 'garchomp', 'garchompitez'],
    ]
    for (const [id, base, stone] of cases) {
      const e = entryOf(bo1, id)
      expect(e.mega).toEqual({ base, stone })
      const set = e.representative.set
      expect([set.species, set.item, set.mega]).toEqual([base, stone, true])
      if (onCurrentGameData(bo1)) expect(validateSet(game, set).species.id).toBe(id)
    }
  })
})

describe('상위 30 대표 세트', () => {
  const top = topAssumptions(view, 30)

  it('30개 모두 코어 세트 검증을 통과하고 이름이 기존 한국어 매핑과 같다', () => {
    expect(top).toHaveLength(30)
    if (!onCurrentGameData(bo1)) return
    for (const { entry, result, names } of top) {
      expect(result.usable, entry.id).toBe(true)
      if (!result.usable || !names) continue
      const set = result.assumption.set
      expect(result.resolved.species.id).toBe(entry.id)
      expect(names.species).toEqual({ id: entry.id, ko: game.data.species[entry.id].name.ko, en: game.data.species[entry.id].name.en, missing: false })
      expect(names.ability.ko).toBe(game.data.abilities[set.ability].name.ko)
      expect(names.nature.ko).toBe(game.data.natures[set.nature].name.ko)
      expect(names.moves.map((m) => m.ko)).toEqual(set.moves.map((m) => game.data.moves[m].name.ko))
      if (set.item !== undefined) expect(names.item?.ko).toBe(game.data.items[set.item].name.ko)
      const all = [names.species, names.ability, names.nature, ...names.moves, ...(names.item ? [names.item] : [])]
      expect(all.filter((n) => n.missing), entry.id).toEqual([])
    }
    const megas = top.filter((t) => t.entry.mega)
    expect(megas.length).toBeGreaterThan(0)
    expect(megas.every((t) => t.result.usable)).toBe(true)
    const mega = top.find((t) => t.entry.id === 'charizardmegay')
    expect(mega?.names?.species.ko).toBe('메가리자몽Y')
  })

  it('대도각참 대표 세트의 기습이 포푸니크 대표 세트에 대미지를 낸다', () => {
    const atk = representativeAssumption(view, 'kingambit').set
    const def = representativeAssumption(view, 'sneasler').set
    expect(atk.moves).toContain('suckerpunch')
    if (!onCurrentGameData(bo1)) return
    const r = calcDamage(game, atk, def, 'suckerpunch')
    expect(r.kind).toBe('damage')
    if (r.kind === 'damage') {
      expect(r.min).toBeGreaterThan(0)
      expect(r.max).toBeGreaterThanOrEqual(r.min)
      expect(r.defenderSpecies).toBe('sneasler')
    }
  })
})

describe('목록 밖 로스터 종', () => {
  it('최소값 바로 아래 rotomwash와 원천에 없는 absol은 no-ladder·가정 0개다', () => {
    for (const id of ['rotomwash', 'absol']) {
      expect(game.data.species[id], id).toBeDefined()
      expect(view.entry(id), id).toBeUndefined()
      expect(lookupOpponent(view, id)).toEqual({ status: 'no-ladder', assumptions: [] })
    }
  })

  it('커스텀 오버레이 1개는 같은 경로로 계산 결과를 내고 메타 파일은 바뀌지 않는다', () => {
    const files = metaIndex.regulations['m-c'].map((x) => `src/data/meta/${x.file}`)
    const before = files.map(readBytes)
    const set: PokemonSet = {
      regulation: 'm-c',
      species: 'rotomwash',
      ability: 'levitate',
      nature: 'modest',
      sp: { hp: 32, atk: 0, def: 0, spa: 32, spd: 2, spe: 0 },
      moves: ['hydropump'],
    }
    const overlay: AssumptionOverlay = {
      regulation: 'm-c',
      assumptions: [{ target: 'rotomwash', set, source: { kind: 'custom', memo: '테스트' }, basis: 'as-published', intent: '포푸니크 견제 특수 배분' }],
    }
    const found = lookupOpponent(view, 'rotomwash', overlay)
    expect(found.status).toBe('no-ladder')
    expect(found.assumptions).toHaveLength(1)
    const [a] = found.assumptions
    expect(a.usable).toBe(true)
    expect(a.assumption.intent).toBe('포푸니크 견제 특수 배분')
    if (onCurrentGameData(bo1)) {
      const r = calcDamage(game, a.assumption.set, representativeAssumption(view, 'sneasler').set, 'hydropump')
      expect(r.kind).toBe('damage')
      if (r.kind === 'damage') expect(r.min).toBeGreaterThan(0)
    }
    files.forEach((f, i) => expect(readBytes(f).equals(before[i]), f).toBe(true))
  })
})

describe('무결성', () => {
  const items = Object.entries(metaIndex.regulations).flatMap(([reg, xs]) => xs.map((x) => ({ reg, ...x })))

  it('스냅샷은 1,000,000바이트 이하이고 리포트 size가 실제 바이트와 같다', () => {
    expect(items.length).toBeGreaterThan(0)
    for (const x of items) {
      const size = statSync(new URL(`src/data/meta/${x.file}`, ROOT)).size
      expect(size, x.file).toBeLessThanOrEqual(SIZE_LIMIT)
      const report = readJson<MetaReport>(`data/reports/meta/${x.reg}/${x.month}-${x.match}/report.json`)
      expect(report.size, x.file).toBe(size)
    }
  })

  it('매치별 최신 월 스냅샷은 현재 게임 데이터 해시와 같고 지난 월 불일치는 보고만 한다', () => {
    const current = Object.fromEntries(
      gameIndex.regulations.map((r) => [r.id, { sha256: sha256(readBytes(`src/data/regulations/${r.id}/data.json`)), frozen: r.frozen }]),
    )
    const refs: GameDataRef[] = items.map((x) => {
      const meta = readJson<MetaSnapshot>(`src/data/meta/${x.file}`)
      expect(meta.manifest.schemaVersion).toBe(META_SCHEMA_VERSION)
      expect(meta.manifest.gameData.regulation).toBe(x.reg)
      return { regulation: x.reg, match: x.match, month: x.month, gameDataSha256: meta.manifest.gameData.sha256 }
    })
    const { mismatchLatest, staleArchived } = classifyGameDataRefs(refs, current)
    if (staleArchived.length) console.log('[meta] 게임 데이터 해시가 다른 지난 스냅샷:', staleArchived)
    expect(mismatchLatest).toEqual([])
  })

  it('디렉터리의 스냅샷 파일 목록이 인덱스 항목과 같다', () => {
    const metaDir = new URL('src/data/meta/', ROOT)
    const onDisk = readdirSync(metaDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .flatMap((d) => readdirSync(new URL(`${d.name}/`, metaDir)).map((f) => `${d.name}/${f}`))
      .sort()
    expect(onDisk).toEqual(items.map((x) => x.file).sort())
  })

  it('manifest.source의 sha256·publishedAt·url이 meta.config.json 기록과 같고 인덱스 판수가 manifest와 같다', () => {
    const { sources } = readJson<{ sources: MetaConfigSource[] }>('scripts/data/meta.config.json')
    for (const x of items) {
      const meta = readJson<MetaSnapshot>(`src/data/meta/${x.file}`)
      const rec = sources.find((s) => s.regulation === x.reg && s.month === x.month && s.match === x.match)
      expect(rec, x.file).toBeDefined()
      expect(meta.manifest.source.sha256).toBe(rec?.sha256)
      expect(meta.manifest.source.publishedAt).toBe(rec?.publishedAt)
      expect(meta.manifest.source.url).toBe(rec?.url)
      expect(meta.manifest.source.format).toBe(rec?.format)
      expect(x.publishedAt).toBe(rec?.publishedAt)
      expect(x.battles, x.file).toBe(meta.manifest.source.battles)
    }
  })

  it('Bo1 리포트 위반이 실측과 같다: 특성 3(toxtricity·meowstic·squawkabilly), learnset 밖 기술 3', () => {
    const report = readJson<MetaReport>('data/reports/meta/m-c/2026-10-bo1/report.json')
    expect(report.violations['illegal-ability'].count).toBe(3)
    expect(report.violations['illegal-move'].count).toBe(3)
    const others = Object.entries(report.violations).filter(([k, v]) => k !== 'illegal-ability' && k !== 'illegal-move' && v.count > 0)
    expect(others).toEqual([])
    const abilitySpecies = report.violationDetails.filter((d) => d.kind === 'illegal-ability').map((d) => d.species).sort()
    expect(abilitySpecies).toEqual(['meowstic', 'squawkabilly', 'toxtricity'])
    const minus = report.violationDetails.find((d) => d.kind === 'illegal-ability' && d.species === 'toxtricity')
    expect(minus?.value).toBe('minus')
    const tox = bo1.entries.find((e) => e.id === 'toxtricity')
    if (tox) expect(tox.abilities.minus).toBeUndefined()
  })
})
