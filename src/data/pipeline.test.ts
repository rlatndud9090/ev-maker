/// <reference types="node" />
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  PROJECT_ROOT,
  buildAll,
  compareWithEngine,
  diffSnapshots,
  loadEngine,
  readProjectJson,
} from '../../scripts/data/lib/pipeline.mjs'
import type { Snapshot, SnapshotData } from './schema'
import { loadSnapshotSync, seedFrozenSnapshots } from './testing'

const tmpDirs: string[] = []
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'evm-snap-'))
  tmpDirs.push(d)
  return d
}
afterAll(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true })
})

function listFiles(dir: string): string[] {
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

const readOut = <T>(root: string, rel: string) => JSON.parse(readFileSync(join(root, rel), 'utf8')) as T
const clone = <T>(v: T): T => structuredClone(v)

describe('스냅샷 생성 재현성', () => {
  it('동결 스냅샷을 둔 채 같은 원천으로 두 번 생성하면 바이트가 같고, 커밋된 생성물과도 같다(동결분은 건드리지 않는다)', async () => {
    const a = tmp()
    const b = tmp()
    const frozenFiles = seedFrozenSnapshots(a)
    seedFrozenSnapshots(b)
    expect(frozenFiles).toEqual(['src/data/regulations/m-b/manifest.json', 'src/data/regulations/m-b/data.json'])
    const ra = await buildAll({ outRoot: a })
    await buildAll({ outRoot: b })
    expect(ra.generated).toEqual(['m-c'])
    expect(ra.skipped).toEqual(['m-b'])
    const files = listFiles(a)
    expect(listFiles(b)).toEqual(files)
    expect(files).toEqual([...ra.files.map((f) => relative(a, f)), ...frozenFiles].sort())
    for (const f of files) {
      const bytes = readFileSync(join(a, f))
      expect(readFileSync(join(b, f)).equals(bytes), f).toBe(true)
      expect(readFileSync(join(PROJECT_ROOT, f)).equals(bytes), `커밋본 ${f}`).toBe(true)
    }
  }, 60_000)

  it('frozen 레귤레이션은 기본적으로 재생성하지 않고 --force면 다시 만든다', async () => {
    const out = tmp()
    await buildAll({ outRoot: out })
    const again = await buildAll({ outRoot: out })
    expect(again.skipped).toEqual(['m-b'])
    expect(again.generated).toEqual(['m-c'])
    expect(again.files.some((f) => f.includes('/m-b/'))).toBe(false)
    const forced = await buildAll({ outRoot: out, force: true })
    expect(forced.generated).toEqual(['m-b', 'm-c'])
  }, 60_000)
})

describe('동결 스냅샷 검사', () => {
  const frozenCase = (mutate: (dir: string) => void) => {
    const out = tmp()
    seedFrozenSnapshots(out)
    mutate(out)
    return buildAll({ outRoot: out })
  }
  const manifestPath = (out: string) => join(out, 'src/data/regulations/m-b/manifest.json')
  const editManifest = (out: string, f: (m: Record<string, unknown>) => void) => {
    const m = readOut<Record<string, unknown>>(out, 'src/data/regulations/m-b/manifest.json')
    f(m)
    writeFileSync(manifestPath(out), JSON.stringify(m))
  }

  it('schemaVersion이 앱과 다르면 경고로 넘기지 않고 실패한다', async () => {
    await expect(frozenCase((out) => editManifest(out, (m) => (m.schemaVersion = 0)))).rejects.toThrow(/m-b.*schemaVersion/)
  }, 60_000)

  it('매니페스트 레귤레이션 id·규칙값이 설정과 다르면 실패한다', async () => {
    await expect(frozenCase((out) => editManifest(out, (m) => (m.regulation = { id: 'm-c', name: 'x' })))).rejects.toThrow(/m-b.*레귤레이션/)
    await expect(
      frozenCase((out) => editManifest(out, (m) => (m.rules = { ...(m.rules as object), spTotal: 70 }))),
    ).rejects.toThrow(/m-b.*rules/)
  }, 60_000)

  it('동결 data가 스냅샷 검증을 통과하지 못하면 실패한다', async () => {
    await expect(
      frozenCase((out) => {
        const d = readOut<SnapshotData>(out, 'src/data/regulations/m-b/data.json')
        d.species.kingambit.abilities.push('nosuchability')
        writeFileSync(join(out, 'src/data/regulations/m-b/data.json'), JSON.stringify(d))
      }),
    ).rejects.toThrow(/kingambit/)
  }, 60_000)

  it('manifest·data 중 하나만 있으면 덮어쓰지 않고 실패한다(--force 필요)', async () => {
    const out = tmp()
    seedFrozenSnapshots(out)
    unlinkSync(join(out, 'src/data/regulations/m-b/data.json'))
    const before = readFileSync(manifestPath(out))
    await expect(buildAll({ outRoot: out })).rejects.toThrow(/m-b.*--force/)
    expect(readFileSync(manifestPath(out)).equals(before)).toBe(true)
  }, 60_000)
})

describe('보정표', () => {
  it('보정값이 원천보다 우선하고, 적용·충돌 내역이 리포트에 남는다', async () => {
    const out = tmp()
    const ko = clone(readProjectJson<Record<string, Record<string, unknown>>>('scripts/data/overrides/ko.json'))
    const meta = { source: 'test: 합성 보정', checked: '2026-11-04' }
    ko.natures = {
      adamant: { ko: '고집', ...meta }, // 원천과 같음 → 제거 권고
      hardy: { ko: '테스트노력', ...meta }, // 원천과 다름 → 경고, 보정 우선
    }
    const game = {
      entries: [
        { regulations: ['m-c'], kind: 'moves', id: 'bonerush', set: { basePower: 31 }, ...meta },
        { regulations: ['m-c'], kind: 'items', id: 'leftovers', allowed: false, ...meta },
        { regulations: ['m-c'], kind: 'species', id: 'kingambit', set: { abilities: ['defiant', 'pressure'] }, ...meta },
      ],
    }
    const logs: string[] = []
    await buildAll({ outRoot: out, koOverrides: ko, gameOverrides: game, log: (m) => logs.push(m) })
    const data = readOut<SnapshotData>(out, 'src/data/regulations/m-c/data.json')
    const mbData = readOut<SnapshotData>(out, 'src/data/regulations/m-b/data.json')
    expect(data.natures.hardy.name).toMatchObject({ ko: '테스트노력', koSource: 'override' })
    expect(data.natures.adamant.name).toMatchObject({ ko: '고집', koSource: 'override' })
    expect(data.moves.bonerush.basePower).toBe(31)
    expect(mbData.moves.bonerush.basePower).toBe(30)
    expect(data.items.leftovers).toBeUndefined()
    expect(data.species.kingambit.abilities).toEqual(['defiant', 'pressure'])
    expect(data.abilities.supremeoverlord).toBeUndefined()

    const report = readOut<{
      game: Array<{ kind: string; id: string; field: string; before: unknown; after: unknown }>
      koSourceConflicts: Array<{ kind: string; id: string; action: string; source: string }>
    }>(out, 'data/reports/m-c/overrides-applied.json')
    expect(report.game).toContainEqual(expect.objectContaining({ kind: 'moves', id: 'bonerush', field: 'basePower', before: 30, after: 31 }))
    expect(report.game).toContainEqual(expect.objectContaining({ kind: 'items', id: 'leftovers', field: 'allowed', before: true, after: false }))
    expect(report.koSourceConflicts).toContainEqual(expect.objectContaining({ kind: 'natures', id: 'adamant', action: 'remove-override' }))
    expect(report.koSourceConflicts).toContainEqual(expect.objectContaining({ kind: 'natures', id: 'hardy', action: 'warning', source: '노력' }))
    const manifest = readOut<Snapshot['manifest']>(out, 'src/data/regulations/m-c/manifest.json')
    expect(manifest.overridesApplied).toBeGreaterThanOrEqual(5)
    expect(logs.some((l) => l.includes('WARNING ko 보정 natures/hardy'))).toBe(true)
  }, 60_000)

  it.each([
    ['출처 없음', { regulations: ['m-c'], kind: 'moves', id: 'bonerush', set: { basePower: 31 }, checked: '2026-11-04' }],
    ['NaN 위력', { regulations: ['m-c'], kind: 'moves', id: 'bonerush', set: { basePower: Number.NaN }, source: 's', checked: '2026-11-04' }],
    ['보정 대상 아닌 필드', { regulations: ['m-c'], kind: 'moves', id: 'bonerush', set: { pp: 5 }, source: 's', checked: '2026-11-04' }],
    ['없는 레귤레이션', { regulations: ['m-z'], kind: 'moves', id: 'bonerush', set: { basePower: 31 }, source: 's', checked: '2026-11-04' }],
    ['없는 항목', { regulations: ['m-c'], kind: 'moves', id: 'nosuchmove', set: { basePower: 31 }, source: 's', checked: '2026-11-04' }],
    ['합법 기술이 아닌 learnset', { regulations: ['m-c'], kind: 'species', id: 'kingambit', set: { learnset: ['anchorshot'] }, source: 's', checked: '2026-11-04' }],
    ['메가 폼 learnset(원종에서 파생)', { regulations: ['m-c'], kind: 'species', id: 'garchompmegaz', set: { learnset: ['protect'] }, source: 's', checked: '2026-11-04' }],
  ])('잘못된 게임 보정(%s)은 조용히 무시하지 않고 실패한다', async (_name, entry) => {
    await expect(buildAll({ outRoot: tmp(), gameOverrides: { entries: [entry] } })).rejects.toThrow()
  }, 60_000)

  it('원종 learnset 보정은 그 메가 폼에도 그대로 파생된다', async () => {
    const out = tmp()
    const meta = { source: 'test: 합성 보정', checked: '2026-11-04' }
    const base = loadSnapshotSync('m-c').data.species.garchomp.learnset.filter((m) => m !== 'earthquake')
    await buildAll({ outRoot: out, gameOverrides: { entries: [{ regulations: ['m-c'], kind: 'species', id: 'garchomp', set: { learnset: base }, ...meta }] } })
    const data = readOut<SnapshotData>(out, 'src/data/regulations/m-c/data.json')
    expect(data.species.garchomp.learnset).not.toContain('earthquake')
    for (const m of data.megas.filter((x) => x.base === 'garchomp')) expect(data.species[m.forme].learnset).toEqual(data.species.garchomp.learnset)
  }, 60_000)

  it('어느 스냅샷에도 없는 한국어 보정 항목은 실패한다', async () => {
    const ko = { abilities: { nosuchability: { ko: '없는특성', source: 's', checked: '2026-11-04' } } }
    await expect(buildAll({ outRoot: tmp(), koOverrides: ko })).rejects.toThrow(/nosuchability/)
  }, 60_000)
})

describe('레귤레이션 간 diff', () => {
  it('수치를 바꾼 합성 이전 스냅샷과 비교하면 수치 차이 경고가 나온다', () => {
    const cur = loadSnapshotSync('m-c').data
    const prev = clone(cur)
    prev.moves.bonerush.basePower = 25
    prev.species.kingambit.baseStats = { ...prev.species.kingambit.baseStats, atk: 130 }
    delete prev.species.garchompmegaz
    const d = diffSnapshots(prev, cur)
    expect(d.warnings).toContainEqual({ kind: 'moves', id: 'bonerush', field: 'basePower', prev: 25, cur: 30 })
    expect(d.warnings.some((w) => w.kind === 'species' && w.id === 'kingambit' && w.field === 'baseStats')).toBe(true)
    expect(d.species.added).toEqual(['garchompmegaz'])
    expect(d.megas.added).toEqual(['garchompmegaz'])
  })

  it('키 순서만 다른 같은 값은 경고가 아니다', () => {
    const cur = loadSnapshotSync('m-c').data
    const prev = JSON.parse(JSON.stringify(cur)) as SnapshotData
    const s = prev.species.kingambit
    s.baseStats = { spe: s.baseStats.spe, spd: s.baseStats.spd, spa: s.baseStats.spa, def: s.baseStats.def, atk: s.baseStats.atk, hp: s.baseStats.hp }
    expect(diffSnapshots(prev, cur).warnings).toEqual([])
  })
})

describe('엔진 대조', () => {
  it('종 체중과 기술 flag 차이가 엔진 차이 목록에 잡힌다', () => {
    const data = clone(loadSnapshotSync('m-c').data)
    data.species.kingambit.weightkg = 999
    data.moves.suckerpunch.flags = data.moves.suckerpunch.flags.filter((f) => f !== 'contact')
    const aliases = readProjectJson('scripts/data/aliases.json')
    const { report, unsupported } = compareWithEngine(data, loadEngine(0), aliases)
    expect(report.species).toContainEqual(expect.objectContaining({ id: 'kingambit', field: 'weightkg', snapshot: 999 }))
    expect(report.moves).toContainEqual(expect.objectContaining({ id: 'suckerpunch', field: 'flags' }))
    expect(unsupported.species).toEqual([])
  })

  it('엔진에 없는 합법 항목은 미지원으로 기록된다', () => {
    const data = clone(loadSnapshotSync('m-c').data)
    data.species.fakemon = { ...data.species.kingambit, id: 'fakemon' }
    const { unsupported } = compareWithEngine(data, loadEngine(0), { engine: {} })
    expect(unsupported.species).toEqual(expect.arrayContaining(['fakemon', 'aegislash']))
  })
})
