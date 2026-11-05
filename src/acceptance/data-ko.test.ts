/// <reference types="node" />
// PRD 수용 기준: 게임 데이터·레귤레이션, 한국어, 배포 산출물(라이선스·생성 명령).
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { Dex } from '@pkmn/dex'
import { PROJECT_ROOT, buildAll, compareWithEngine, diffSnapshots, loadEngine, readProjectJson } from '../../scripts/data/lib/pipeline.mjs'
import { MB, MC, mkSet } from '../core/testing'
import { CoreError, calcDamage, computeStats, validateSet, type PokemonSet } from '../core/index'
import { SNAPSHOT_SCHEMA_VERSION, type Snapshot, type SnapshotData } from '../data/schema'
import { seedFrozenSnapshots } from '../data/testing'
import { oracleRolls } from './oracle'

const readText = (rel: string) => readFileSync(join(PROJECT_ROOT, rel), 'utf8')
const readJson = <T>(rel: string) => JSON.parse(readText(rel)) as T
const toId = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
const HANGUL = /[가-힣]/
const KINDS = ['species', 'moves', 'items', 'abilities', 'natures'] as const

const tmpDirs: string[] = []
afterAll(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true })
})
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'evm-acc-'))
  tmpDirs.push(d)
  return d
}
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

// 출처: PRD 수용 기준 / notes "레귤레이션 로스터 진실원"(Serebii M-C 신규 목록)
const NEW_MEGAS: Record<string, string> = {
  absolmegaz: '메가앱솔Z',
  salamencemega: '메가보만다',
  garchompmegaz: '메가한카리아스Z',
  lucariomegaz: '메가루카리오Z',
  golisopodmega: '메가갑주무사',
  baxcaliburmega: '메가드닐레이브',
}
const NEW_ITEMS = ['Leek', 'Rocky Helmet', 'Air Balloon', 'Red Card', 'Binding Band', 'Eject Button', 'Normal Gem', 'Terrain Extender', 'Electric Seed', 'Psychic Seed', 'Misty Seed', 'Grassy Seed'].map(toId)
// Serebii regulationm-c "Newly Useable Pokémon"(2026-11-04 조회) 표기를 id로 옮겼다.
// 같은 이름이 두 번 나온 Persian·Toxtricity·Indeedee는 폼 2개, Squawkabilly는 깃털색 4폼이다.
const SEREBII_NEW_SPECIES = [
  'wigglytuff', 'persian', 'persianalola', 'farfetchd', 'mrmime', 'swalot', 'absolmegaz', 'salamence', 'salamencemega',
  'garchompmegaz', 'lucariomegaz', 'gogoat', 'golisopod', 'golisopodmega', 'rillaboom', 'cinderace', 'inteleon', 'thievul',
  'toxtricity', 'toxtricitylowkey', 'grapploct', 'perrserker', 'sirfetchd', 'pincurchin', 'indeedee', 'indeedeef', 'pawmot',
  'arboliva', 'squawkabilly', 'squawkabillyblue', 'squawkabillywhite', 'squawkabillyyellow', 'mabosstiff', 'baxcalibur',
  'baxcaliburmega',
].sort()

describe('수용 기준: 게임 데이터·레귤레이션', () => {
  it('AC-G1 M-C 스냅샷에 신규 메가 6종과 신규 도구 12종이 있다', () => {
    for (const [id, ko] of Object.entries(NEW_MEGAS)) {
      expect(MC.data.species[id]?.isMega, id).toBe(true)
      expect(MC.data.species[id].name.ko).toBe(ko)
      expect(MC.data.megas.some((m) => m.forme === id), id).toBe(true)
    }
    for (const id of NEW_ITEMS) expect(MC.data.items[id], id).toBeDefined()
  })

  it('AC-G2 아직 쓸 수 없는 메가, 구애머리띠·구애안경·돌격조끼·부스트에너지, 배틀 중 폼·외형 전용 폼이 없다', () => {
    const futureBases = ['heatran', 'darkrai', 'zygarde', 'magearna', 'zeraora', 'tatsugiri']
    for (const m of MC.data.megas) expect(futureBases.includes(m.base), m.forme).toBe(false)
    for (const s of Object.values(MC.data.species)) {
      if (s.isMega) expect(futureBases.includes(s.baseSpecies!), s.id).toBe(false)
    }
    for (const id of ['choiceband', 'choicespecs', 'assaultvest', 'boosterenergy']) expect(MC.data.items[id], id).toBeUndefined()
    expect(MC.data.species.aegislashblade).toBeUndefined()
    // 독립 대조: @pkmn/dex 9세대 폼 정보로 배틀 중 폼·외형 전용 폼을 판정한다
    const dex = Dex.forGen(9)
    for (const s of Object.values(MC.data.species)) {
      const d = dex.species.get(s.id)
      if (!d.exists) continue
      if (!s.isMega) expect(d.battleOnly, `${s.id} 배틀 중 폼`).toBeFalsy()
      const base = dex.species.get(d.baseSpecies)
      expect((base.cosmeticFormes ?? []).map(toId).includes(s.id), `${s.id} 외형 폼`).toBe(false)
    }
  })

  it('AC-G3 Smogon 커뮤니티 밴 대상 Archaludon·Sneasler·Baxcalibur가 허용 종으로 들어 있고 계산된다', () => {
    for (const id of ['archaludon', 'sneasler', 'baxcalibur']) {
      const s = MC.data.species[id]
      expect(s, id).toBeDefined()
      expect(() => validateSet(MC, mkSet({ species: id, ability: s.abilities[0] }))).not.toThrow()
    }
  })

  it('AC-G4 챔피언스 기술 수치(본러시 30·9세대 25, 대단한 첫걸음 100)가 스냅샷과 대미지 계산 모두에 쓰인다', () => {
    const gen9 = Dex.forGen(9).moves
    expect([MC.data.moves.bonerush.basePower, gen9.get('bonerush').basePower]).toEqual([30, 25])
    expect(MC.data.moves.firstimpression.basePower).toBe(100)
    expect(gen9.get('firstimpression').basePower).not.toBe(100)
    const absol = mkSet({ species: 'absol', ability: 'pressure' })
    const absolDef = computeStats(MC, absol).def
    // 루카리오(비자속) 본러시 → 앱솔(등배): 타당 분포가 위력 30의 독립 산술과 같다
    const lucario = mkSet({ species: 'lucario', ability: 'innerfocus', sp: { atk: 32 } })
    const br = calcDamage(MC, lucario, absol, 'bonerush', { hits: 2 })
    if (br.kind !== 'damage') throw new Error(br.kind)
    const perHit = oracleRolls({ power: 30, attack: computeStats(MC, lucario).atk, defense: absolDef, effectiveness: 1 })
    expect(br.rolls).toEqual([perHit, perHit])
    expect(perHit).not.toEqual(oracleRolls({ power: 25, attack: computeStats(MC, lucario).atk, defense: absolDef, effectiveness: 1 }))
    // 갑주무사(자속) 대단한 첫걸음 → 앱솔(벌레 → 악 2배)
    const golisopod = mkSet({ species: 'golisopod', ability: 'emergencyexit', sp: { atk: 32 } })
    const fi = calcDamage(MC, golisopod, absol, 'firstimpression')
    if (fi.kind !== 'damage') throw new Error(fi.kind)
    expect(fi.rolls[0]).toEqual(oracleRolls({ power: 100, attack: computeStats(MC, golisopod).atk, defense: absolDef, stab: true, effectiveness: 2 }))
  })

  it('AC-G5(부분: 원천 제약) 엔진 데이터가 깨진 기술 11개는 M-C 원천에 합법 기술로 없어 이유 있는 오류로 거부되고, 스냅샷의 모든 공격기는 대미지 0이 아니다', () => {
    const broken = ['anchorshot', 'astralbarrage', 'bloodmoon', 'boltbeak', 'dragonhammer', 'fishiousrend', 'geargrind', 'hyperdrill', 'metalclaw', 'revelationdance', 'tripledive']
    const kingambit = mkSet({ species: 'kingambit', ability: 'defiant' })
    for (const id of broken) {
      expect(MC.data.moves[id], id).toBeUndefined()
      expect(() => calcDamage(MC, kingambit, kingambit, id)).toThrow(CoreError)
    }
    // 스냅샷의 위력 있는 모든 공격기는 대미지 0이 아니다. 대상은 악 단일(무효는 에스퍼뿐), 도구를 지녀 폴터가이스트도 성립한다.
    const target = mkSet({ species: 'absol', ability: 'pressure', item: 'leftovers' })
    const learner = new Map<string, string>()
    for (const s of Object.values(MC.data.species)) if (!s.isMega) for (const m of s.learnset) if (!learner.has(m)) learner.set(m, s.id)
    let checked = 0
    const immune: string[] = []
    for (const m of Object.values(MC.data.moves)) {
      if (m.category === 'Status' || m.basePower === 0 || MC.manifest.engineUnsupported.moves.includes(m.id)) continue
      const sid = learner.get(m.id)
      if (!sid) continue
      const r = calcDamage(MC, mkSet({ species: sid, ability: MC.data.species[sid].abilities[0] }), target, m.id)
      if (r.kind === 'immune') immune.push(m.id)
      else expect(r.kind === 'damage' && r.max > 0, m.id).toBe(true)
      checked++
    }
    expect(checked).toBeGreaterThan(300)
    // 무효는 악 타입에 듣지 않는 에스퍼 기술과 필드가 있어야 성립하는 강철롤러뿐이다
    expect(immune.filter((id) => MC.data.moves[id].type !== 'Psychic')).toEqual(['steelroller'])
  })

  it('AC-G6 대도각참 특성은 정확히 오기·총대장·프레셔, 기습을 배우고 배울 수 없는 기술(화염방사)은 거부', () => {
    expect([...MC.data.species.kingambit.abilities].sort()).toEqual(['defiant', 'pressure', 'supremeoverlord'])
    expect(MC.data.species.kingambit.learnset).toContain('suckerpunch')
    expect(MC.data.species.kingambit.learnset).not.toContain('flamethrower')
    const set = mkSet({ species: 'kingambit', ability: 'defiant', moves: ['flamethrower'] })
    expect(() => validateSet(MC, set)).toThrow(CoreError)
  })

  it('AC-G7 M-B → M-C 리포트: 종·폼 +35/−0(Serebii 목록과 같음), 메가 +6, 도구 신규 12종 + 신규 메가스톤/−0, 수치 차이 경고', () => {
    const diff = diffSnapshots(MB.data, MC.data)
    expect(diff.species.added.slice().sort()).toEqual(SEREBII_NEW_SPECIES)
    expect(diff.species.removed).toEqual([])
    expect(diff.megas.added.slice().sort()).toEqual(Object.keys(NEW_MEGAS).sort())
    expect(diff.megas.removed).toEqual([])
    const newStones = MC.data.megas.filter((m) => m.forme in NEW_MEGAS).map((m) => m.stone)
    expect(diff.items.added.slice().sort()).toEqual([...NEW_ITEMS, ...newStones].sort())
    expect(diff.items.removed).toEqual([])
    expect(diff.warnings.length).toBeGreaterThan(0)
    // 커밋된 리포트가 같은 diff다
    const committed = readJson<{ diff: unknown; previous: string; regulation: string }>('data/reports/m-c/diff.json')
    expect(committed).toMatchObject({ previous: 'm-b', regulation: 'm-c' })
    expect(JSON.parse(JSON.stringify(committed.diff))).toEqual(JSON.parse(JSON.stringify(diff)))
    // 수치 차이가 생기면 경고로 잡힌다(합성 이전 스냅샷)
    const prev = structuredClone(MB.data) as SnapshotData
    prev.moves.earthquake.basePower = 90
    expect(diffSnapshots(prev, MC.data).warnings).toContainEqual(expect.objectContaining({ kind: 'moves', id: 'earthquake', field: 'basePower' }))
  })

  it('AC-G8 M-B로 고르면 메가한카리아스Z 세트는 거부되고 M-C로 고르면 계산된다(확인 페이지 쪽은 e2e)', () => {
    const set = (s: Snapshot): PokemonSet =>
      mkSet({ species: 'garchomp', ability: 'roughskin', item: 'garchompitez', mega: true, nature: 'adamant', sp: { atk: 32 } }, s)
    const target = (s: Snapshot) => mkSet({ species: 'incineroar', ability: 'blaze' }, s)
    expect(() => calcDamage(MB, set(MB), target(MB), 'earthquake')).toThrow(CoreError)
    expect(calcDamage(MC, set(MC), target(MC), 'earthquake').kind).toBe('damage')
  })

  it('AC-G9 M-B·M-C 공통 종의 id가 같고, 스냅샷에 스키마 버전이 기록돼 있다', () => {
    const common = Object.keys(MB.data.species).filter((id) => id in MC.data.species)
    expect(common.length).toBe(Object.keys(MB.data.species).length)
    for (const id of common) {
      expect(MC.data.species[id].id).toBe(id)
      expect(MB.data.species[id].id).toBe(id)
      expect(MC.data.species[id].name.en).toBe(MB.data.species[id].name.en)
    }
    for (const s of [MB, MC]) expect(s.manifest.schemaVersion).toBe(SNAPSHOT_SCHEMA_VERSION)
  })

  it('AC-G10 원천 기준 시각·개정 식별자(게임 데이터·한국어)가 있고, 같은 원천으로 다시 생성하면 커밋된 결과와 바이트가 같다', async () => {
    for (const s of [MB, MC]) {
      const src = s.manifest.source
      expect(Number.isNaN(Date.parse(src.gameData.sourceTime))).toBe(false)
      expect(Object.keys(src.gameData.packages).sort()).toEqual(['@pkmn/dex', '@pkmn/mods'])
      for (const v of Object.values(src.gameData.integrity)) expect(v).toMatch(/^sha512-/)
      expect(src.ko.pokeapiCommit).toMatch(/^[0-9a-f]{40}$/)
      expect(Number.isNaN(Date.parse(src.ko.sourceTime))).toBe(false)
      expect(Object.keys(src.ko.files).length).toBeGreaterThan(0)
    }
    // 재현성은 현재 원천으로 만드는 스냅샷에만 적용한다(ADR 결정 6). 동결 스냅샷은 그대로 두고 재생성되지 않음을 본다.
    const out = tmp()
    const frozen = seedFrozenSnapshots(out)
    const r = await buildAll({ outRoot: out })
    expect(r.generated).toEqual(['m-c'])
    expect(r.skipped).toEqual(['m-b'])
    expect(r.files.some((f) => frozen.some((x) => f.endsWith(x)))).toBe(false)
    const files = listFiles(out)
    expect(files).toContain('src/data/regulations/m-c/data.json')
    for (const f of files) expect(readFileSync(join(out, f)).equals(readFileSync(join(PROJECT_ROOT, f))), f).toBe(true)
  }, 120_000)

  it('AC-G11 계산 도구 내장 수치 ↔ 스냅샷 대조 리포트가 생성되고, 스냅샷의 모든 합법 종을 계산 도구로 계산할 수 있다', () => {
    const { report, unsupported } = compareWithEngine(MC.data, loadEngine(0), readProjectJson('scripts/data/aliases.json'))
    expect(Array.isArray(report.species) && Array.isArray(report.moves)).toBe(true)
    // 종족값·타입 차이 0, 허용 도구 집합 동일
    expect(report.species.filter((e) => e.field === 'baseStats' || e.field === 'types')).toEqual([])
    expect(report.items).toEqual({ onlySnapshot: [], onlyEngine: [] })
    expect(unsupported).toEqual(MC.manifest.engineUnsupported)
    expect(unsupported.species).toEqual([])
    const attacker = mkSet({ species: 'garchomp', ability: 'roughskin', sp: { atk: 32 } })
    // 탈(Disguise) 방어측은 코어가 거부하므로(첫 타 무효화 미지원) 특성을 무시하는 틀깨기 공격자로 계산 가능 여부를 본다.
    const moldBreaker = mkSet({ species: 'excadrill', ability: 'moldbreaker', sp: { atk: 32 } })
    let n = 0
    for (const s of Object.values(MC.data.species)) {
      const set = s.isMega
        ? mkSet({ species: s.baseSpecies!, ability: MC.data.species[s.baseSpecies!].abilities[0], item: s.requiredItem, mega: true })
        : mkSet({ species: s.id, ability: s.abilities.find((a) => !MC.manifest.engineUnsupported.abilities.includes(a))! })
      const r = calcDamage(MC, set.ability === 'disguise' ? moldBreaker : attacker, set, 'ironhead')
      expect(['damage', 'immune'], s.id).toContain(r.kind)
      if (r.kind === 'damage') expect(r.defenderSpecies).toBe(s.id)
      n++
    }
    expect(n).toBe(Object.keys(MC.data.species).length)
  })
})

describe('수용 기준: 한국어', () => {
  it('AC-K1 M-C 허용 메가 82항목의 한국어 이름이 공식 도감 대조표(mega-ko-official.tsv)와 전부 일치', () => {
    const rows = readText('docs/raw/feature/champions-calc-data-core/mega-ko-official.tsv')
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => l.split('\t'))
    expect(rows).toHaveLength(82)
    const megas = Object.values(MC.data.species).filter((s) => s.isMega)
    expect(megas).toHaveLength(82)
    expect(rows.map(([en]) => toId(en)).sort()).toEqual(megas.map((s) => s.id).sort())
    for (const [en, ko] of rows) expect(MC.data.species[toId(en)].name.ko, en).toBe(ko)
  })

  it('AC-K2 메가냐오닉스 수컷·암컷은 구분 라벨로 서로 다르게 보인다', () => {
    const m = MC.data.species.meowsticmmega.name
    const f = MC.data.species.meowsticfmega.name
    expect(m.ko).toBe('메가냐오닉스')
    expect(f.ko).toBe('메가냐오닉스')
    expect(`${m.ko}(${m.koLabel})`).not.toBe(`${f.ko}(${f.koLabel})`)
    expect([m.koLabel, f.koLabel]).toEqual(['수컷', '암컷'])
  })

  it('AC-K3 영문 대체 목록이 산출물로 남고, M-C의 종·메가·성격·신규 도구 12종에는 대체가 0개', () => {
    for (const id of ['m-b', 'm-c']) {
      const r = readJson<{ count: number; items: Array<{ kind: string; id: string }>; regulation: string }>(`data/reports/${id}/ko-fallback.json`)
      expect(r.regulation).toBe(id)
      expect(r.count).toBe(r.items.length)
    }
    const mc = readJson<{ items: Array<{ kind: string; id: string }> }>('data/reports/m-c/ko-fallback.json').items
    expect(mc.filter((x) => x.kind === 'species' || x.kind === 'natures')).toEqual([])
    expect(mc.filter((x) => x.kind === 'items' && NEW_ITEMS.includes(x.id))).toEqual([])
    for (const s of Object.values(MC.data.species)) expect(s.name.koSource, s.id).not.toBe('fallback')
    for (const id of NEW_ITEMS) expect(MC.data.items[id].name.koSource, id).not.toBe('fallback')
  })

  it.each(['m-b', 'm-c'])('AC-K4 %s 대체 목록은 빠짐없다: 모든 항목이 한국어 이름을 갖거나 대체 목록에 있다', (id) => {
    const snap = id === 'm-c' ? MC : MB
    const listed = new Set(
      readJson<{ items: Array<{ kind: string; id: string }> }>(`data/reports/${id}/ko-fallback.json`).items.map((x) => `${x.kind}/${x.id}`),
    )
    let total = 0
    for (const kind of KINDS) {
      for (const e of Object.values(snap.data[kind])) {
        total++
        const key = `${kind}/${e.id}`
        expect(HANGUL.test(e.name.ko) || listed.has(key), key).toBe(true)
        if (listed.has(key)) expect(e.name.koSource, key).toBe('fallback')
      }
    }
    expect(total).toBeGreaterThan(1000)
  })

  it('AC-K5 개발자 보정값이 공개 데이터보다 우선 적용된다(실데이터 사례 + 원천과 충돌하는 합성 보정)', async () => {
    const ko = readProjectJson<Record<string, Record<string, { ko: string }>>>('scripts/data/overrides/ko.json')
    // 실데이터: PokeAPI에 없는 특성 한국어명을 보정표 값으로 쓴다
    expect(MC.data.abilities.eelevate.name).toMatchObject({ ko: ko.abilities.eelevate.ko, koSource: 'override' })
    // 원천(PokeAPI)에 값이 있는 성격을 다른 값으로 보정하면 보정값이 이긴다
    expect(MC.data.natures.hardy.name).toMatchObject({ ko: '노력', koSource: 'pokeapi' })
    const out = tmp()
    const patched = structuredClone(ko) as Record<string, Record<string, unknown>>
    patched.natures = { ...patched.natures, hardy: { ko: '보정노력', source: 'test: 수용 테스트 합성 보정', checked: '2026-11-04' } }
    await buildAll({ outRoot: out, force: true, koOverrides: patched, log: () => {} })
    const data = JSON.parse(readFileSync(join(out, 'src/data/regulations/m-c/data.json'), 'utf8')) as SnapshotData
    expect(data.natures.hardy.name).toMatchObject({ ko: '보정노력', koSource: 'override' })
  }, 120_000)
})

describe('수용 기준: 배포 산출물(자동 확인 가능한 부분)', () => {
  it('AC-U4 스냅샷 생성 명령이 package.json·THIRD_PARTY_NOTICES에 있고 생성 스크립트를 가리킨다(재생성 결과는 AC-G10)', () => {
    const pkg = readJson<{ scripts: Record<string, string> }>('package.json')
    expect(pkg.scripts['gen:snapshot']).toBe('node scripts/data/build-snapshot.mjs')
    expect(readText('THIRD_PARTY_NOTICES.md')).toContain('npm run gen:snapshot')
  })

  it('AC-U5 번들한 데이터·코드의 라이선스·출처 목록이 있고 불명확 항목이 0개', () => {
    const lic = readJson<{ entries: Array<{ id: string; license: string; source: string; version?: string }> }>('src/data/licenses.json')
    expect(lic.entries.length).toBeGreaterThan(0)
    for (const e of lic.entries) {
      expect(['MIT', 'BSD-3-Clause', 'ISC', 'Apache-2.0'], e.id).toContain(e.license)
      expect(e.source, e.id).toMatch(/^(https?:\/\/|github:|npm:)\S+/)
    }
    const ids = lic.entries.map((e) => e.id)
    expect(ids).toEqual(expect.arrayContaining(['npm:@smogon/calc', 'data:pokeapi']))
    expect(readText('THIRD_PARTY_NOTICES.md').length).toBeGreaterThan(0)
  })
})
