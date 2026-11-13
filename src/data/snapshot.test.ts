/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SNAPSHOT_SCHEMA_VERSION } from './schema'
import type { SnapshotData } from './schema'
import { loadMetaIndexSync, loadRegulationIndexSync, loadSnapshotSync } from './testing'

const ROOT = new URL('../../', import.meta.url)
const readText = (rel: string) => readFileSync(new URL(rel, ROOT), 'utf8')
const readJson = <T>(rel: string) => JSON.parse(readText(rel)) as T
const toID = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '')
const HANGUL = /[가-힣]/

const mc = loadSnapshotSync('m-c')
const mb = loadSnapshotSync('m-b')
const KINDS = ['species', 'moves', 'items', 'abilities', 'natures'] as const

// 출처: Serebii M-C 신규 목록, notes.md "레귤레이션 로스터 진실원"
const NEW_MEGAS = ['absolmegaz', 'baxcaliburmega', 'garchompmegaz', 'golisopodmega', 'lucariomegaz', 'salamencemega']
const NEW_ITEMS = [
  'leek',
  'rockyhelmet',
  'airballoon',
  'redcard',
  'bindingband',
  'ejectbutton',
  'normalgem',
  'terrainextender',
  'electricseed',
  'psychicseed',
  'mistyseed',
  'grassyseed',
]

describe('M-C 스냅샷 로스터', () => {
  it('신규 메가 6종과 신규 도구 12종이 있고 M-B에는 없다', () => {
    for (const id of NEW_MEGAS) {
      expect(mc.data.species[id]?.isMega, id).toBe(true)
      expect(mb.data.species[id], id).toBeUndefined()
    }
    for (const id of NEW_ITEMS) {
      expect(mc.data.items[id], id).toBeDefined()
      expect(mb.data.items[id], id).toBeUndefined()
    }
  })

  it('아직 쓸 수 없는 메가·사용 불가 도구·배틀/외형 전용 폼은 빠진다', () => {
    const futureBases = ['heatran', 'darkrai', 'zygarde', 'magearna', 'zeraora', 'tatsugiri']
    const megas = Object.values(mc.data.species).filter((s) => s.isMega)
    for (const s of megas) expect(futureBases.some((b) => s.id.startsWith(b)), s.id).toBe(false)
    for (const id of ['heatranmega', 'darkraimega', 'zeraoramega']) expect(mc.data.species[id]).toBeUndefined()
    for (const id of ['choiceband', 'choicespecs', 'assaultvest', 'boosterenergy']) expect(mc.data.items[id], id).toBeUndefined()
    for (const id of ['aegislashblade', 'mimikyubusted', 'castformsunny', 'palafinhero', 'vivillonmarine', 'alcremierubycream']) {
      expect(mc.data.species[id], id).toBeUndefined()
    }
  })

  it('Smogon 커뮤니티 밴 종도 공식 로스터대로 들어 있다', () => {
    for (const id of ['archaludon', 'sneasler', 'baxcalibur']) expect(mc.data.species[id], id).toBeDefined()
  })

  it('챔피언스 기술 수치와 대도각참 특성·학습 기술(원천 기준)', () => {
    expect(mc.data.moves.bonerush.basePower).toBe(30)
    expect(mc.data.moves.firstimpression.basePower).toBe(100)
    expect(mc.data.species.kingambit.abilities).toEqual(['defiant', 'supremeoverlord', 'pressure'])
    expect(mc.data.species.kingambit.learnset).toContain('suckerpunch')
    expect(mc.data.species.kingambit.learnset).not.toContain('falseswipe')
  })

  it('메가 표가 종·도구와 정합하고 X/Y/Z를 구분한다', () => {
    const megaSpecies = Object.values(mc.data.species).filter((s) => s.isMega)
    expect(mc.data.megas).toHaveLength(megaSpecies.length)
    for (const m of mc.data.megas) {
      const forme = mc.data.species[m.forme]
      expect(forme?.isMega, m.forme).toBe(true)
      expect(forme.baseSpecies).toBe(m.base)
      expect(forme.requiredItem).toBe(m.stone)
      expect(mc.data.species[m.base]?.isMega, m.base).toBe(false)
      expect(mc.data.items[m.stone], m.stone).toBeDefined()
      expect(forme.learnset).toEqual(mc.data.species[m.base].learnset)
    }
    const find = (stone: string, base: string) => mc.data.megas.find((m) => m.stone === stone && m.base === base)?.forme
    expect(find('garchompitez', 'garchomp')).toBe('garchompmegaz')
    expect(find('garchompite', 'garchomp')).toBe('garchompmega')
    expect(find('charizarditey', 'charizard')).toBe('charizardmegay')
    expect(find('meowsticite', 'meowsticf')).toBe('meowsticfmega')
  })

  it.each([
    ['m-c', mc.data],
    ['m-b', mb.data],
  ])('%s 참조 무결성(학습 기술·특성)', (_id, data: SnapshotData) => {
    for (const s of Object.values(data.species)) {
      for (const a of s.abilities) expect(data.abilities[a], `${s.id}.${a}`).toBeDefined()
      for (const m of s.learnset) expect(data.moves[m], `${s.id}.${m}`).toBeDefined()
      expect([...s.learnset].sort()).toEqual(s.learnset)
    }
    for (const kind of KINDS) for (const [k, v] of Object.entries(data[kind])) expect(v.id).toBe(k)
  })
})

describe('스냅샷 메타', () => {
  it('schemaVersion과 원천 개정·시각이 기록돼 있다', () => {
    const config = readJson<{
      gameData: { packages: Record<string, { publishedAt: string; version: string }>; showdownCommitRef: { sha: string } }
      ko: { commit: string; committedAt: string; files: Record<string, string> }
    }>('scripts/data/sources.config.json')
    expect(loadRegulationIndexSync().schemaVersion).toBe(SNAPSHOT_SCHEMA_VERSION)
    for (const s of [mc, mb]) {
      expect(s.manifest.schemaVersion).toBe(SNAPSHOT_SCHEMA_VERSION)
      const latest = Object.values(config.gameData.packages).map((p) => p.publishedAt).sort().at(-1)
      expect(s.manifest.source.gameData.sourceTime).toBe(latest)
      expect(s.manifest.source.gameData.showdownCommitRef).toBe(config.gameData.showdownCommitRef.sha)
      expect(s.manifest.source.ko.pokeapiCommit).toBe(config.ko.commit)
      expect(s.manifest.source.ko.sourceTime).toBe(config.ko.committedAt)
      expect(s.manifest.source.ko.files).toEqual(config.ko.files)
      for (const [p, v] of Object.entries(s.manifest.source.gameData.packages)) expect(v).toBe(config.gameData.packages[p].version)
    }
    expect(mc.manifest.rules).toMatchObject({ level: 50, spMaxPerStat: 32, spTotal: 66, start: '2026-09-09T02:00:00Z', end: '2026-12-02T01:59:00Z' })
    expect(mc.manifest.source.gameData.mode).toBe('champions')
    expect(mb.manifest.source.gameData.mode).toBe('championsregmb')
  })

  it('기본 레귤레이션은 M-C이고 M-B는 동결 대상이다', () => {
    const index = loadRegulationIndexSync()
    expect(index.default).toBe('m-c')
    expect(index.regulations.find((r) => r.id === 'm-b')?.frozen).toBe(true)
  })

  it('M-B와 M-C 공통 종은 같은 id·같은 항목이다', () => {
    const common = Object.keys(mb.data.species).filter((id) => mc.data.species[id])
    expect(common).toHaveLength(Object.keys(mb.data.species).length)
    for (const id of common) {
      expect(mc.data.species[id].id).toBe(mb.data.species[id].id)
      expect(mc.data.species[id].num).toBe(mb.data.species[id].num)
      expect(mc.data.species[id].name.en).toBe(mb.data.species[id].name.en)
    }
  })
})

describe('한국어 명칭', () => {
  const tsv = readText('docs/raw/feature/champions-calc-data-core/mega-ko-official.tsv')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => l.split('\t'))

  it('M-C 메가 82항목이 공식 도감 대조표와 전수 일치한다', () => {
    expect(tsv).toHaveLength(82)
    const megaIds = Object.values(mc.data.species).filter((s) => s.isMega).map((s) => s.id).sort()
    expect(tsv.map(([en]) => toID(en)).sort()).toEqual(megaIds)
    for (const [en, ko] of tsv) expect(mc.data.species[toID(en)].name.ko, en).toBe(ko)
  })

  it('메가냐오닉스 수컷·암컷은 구분 라벨이 다르다', () => {
    const m = mc.data.species.meowsticmmega.name
    const f = mc.data.species.meowsticfmega.name
    expect(m.ko).toBe(f.ko)
    expect(m.koLabel).toBeTruthy()
    expect(f.koLabel).toBeTruthy()
    expect(m.koLabel).not.toBe(f.koLabel)
  })

  it.each(['m-c', 'm-b'])('%s 대체 목록이 빠짐없다', (id) => {
    const snap = id === 'm-c' ? mc : mb
    const report = readJson<{ count: number; items: Array<{ kind: string; id: string; en: string }> }>(
      `data/reports/${id}/ko-fallback.json`,
    )
    const listed = new Set(report.items.map((f) => `${f.kind}/${f.id}`))
    expect(report.count).toBe(report.items.length)
    for (const kind of KINDS) {
      for (const e of Object.values(snap.data[kind])) {
        const key = `${kind}/${e.id}`
        if (!HANGUL.test(e.name.ko)) expect(listed.has(key), key).toBe(true)
        expect(e.name.koSource === 'fallback', key).toBe(listed.has(key))
      }
    }
    for (const key of listed) {
      const [kind, eid] = key.split('/') as [(typeof KINDS)[number], string]
      expect(snap.data[kind][eid], key).toBeDefined()
    }
  })

  it('종·메가·성격·신규 도구 12종에는 영문 대체가 없다', () => {
    for (const s of Object.values(mc.data.species)) expect(s.name.koSource, s.id).not.toBe('fallback')
    for (const n of Object.values(mc.data.natures)) expect(n.name.koSource, n.id).not.toBe('fallback')
    for (const id of NEW_ITEMS) expect(mc.data.items[id].name.koSource, id).not.toBe('fallback')
  })
})

describe('생성 리포트(커밋된 산출물)', () => {
  it('M-B → M-C diff 수치', () => {
    const { diff, previous } = readJson<{
      previous: string
      diff: Record<'species' | 'megas' | 'items', { added: string[]; removed: string[] }>
    }>('data/reports/m-c/diff.json')
    expect(previous).toBe('m-b')
    expect(diff.species.added).toHaveLength(35)
    expect(diff.species.removed).toHaveLength(0)
    expect(diff.megas.added).toEqual(NEW_MEGAS)
    expect(diff.megas.removed).toHaveLength(0)
    expect(diff.items.added).toHaveLength(18)
    expect(diff.items.removed).toHaveLength(0)
    const stones = NEW_MEGAS.map((id) => mc.data.species[id].requiredItem)
    expect(diff.items.added.sort()).toEqual([...NEW_ITEMS, ...stones].sort())
    expect(readText('data/reports/m-c/diff.md')).toContain('| species | 35 | 0 |')
  })

  it('엔진 대조 리포트가 flag 비교 키와 미지원 목록을 담고, 모든 합법 종이 엔진에 있다', () => {
    const r = readJson<{ comparedMoveFlags: string[]; unsupported: { species: string[] } }>('data/reports/m-c/engine-diff.json')
    expect(r.comparedMoveFlags).toContain('contact')
    expect(r.unsupported).toEqual(mc.manifest.engineUnsupported)
    expect(mc.manifest.engineUnsupported.species).toEqual([])
    expect(mc.data.species.aegislash).toBeDefined()
  })

  it('M-B 상속 리포트에 learnset·특성 오버라이드 여부가 있다', () => {
    const md = readText('data/reports/m-b/inheritance.md')
    expect(md).toContain('Learnsets 오버라이드')
    expect(md).toContain('Abilities 오버라이드')
  })

  it('라이선스 목록에 불명확 항목이 없다', () => {
    const lic = readJson<{ entries: Array<{ license: string; id: string; attributionOnly?: boolean }> }>('src/data/licenses.json')
    const ids = lic.entries.map((e) => e.id)
    expect(ids).toEqual(expect.arrayContaining(['npm:@smogon/calc', 'data:showdown-pkmn', 'data:pokeapi']))
    for (const e of lic.entries.filter((x) => !x.attributionOnly)) {
      expect(['MIT', 'BSD-3-Clause', 'ISC', 'Apache-2.0', '0BSD', 'BSD-2-Clause', 'CC0-1.0'], e.id).toContain(e.license)
    }
    const notices = readText('THIRD_PARTY_NOTICES.md')
    const metaItems = Object.values(loadMetaIndexSync().regulations).flat()
    expect(metaItems.length).toBeGreaterThan(0)
    expect(ids).toContain('data:smogon-stats')
    expect(notices).toContain('https://www.smogon.com/stats/')
    expect(notices).toContain('2026-10')
    for (const it of metaItems) {
      expect(notices).toContain(it.publishedAt)
      expect(notices).toContain(it.url)
    }
    expect(notices).toContain('Nintendo')
    expect(notices).toContain('Redistribution and use in source and binary forms')
    expect(notices).toContain('mega-ko-official.tsv')
    // LICENSE 파일이 없어 표준 문안으로 채운 항목은 원문이 아님을 본문에 밝힌다.
    const synthesized = notices.split('\n### ').slice(1).filter((sec) => /Copyright \(c\) \S+ contributors \(/.test(sec))
    expect(synthesized.length).toBeGreaterThan(0)
    for (const sec of synthesized) expect(sec, sec.split('\n')[0]).toContain('원문 아님')
  })
})
