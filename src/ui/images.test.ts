/// <reference types="node" />
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  HAND_POKEAPI_IDS,
  ITEM_ICON_IDS,
  KNOWN_SAME_IMAGE,
  bagSpriteFile,
  bulbaImageInfoUrl,
  needsDownload,
  parseBulbaImageInfo,
  resolvePokeapiIds,
  rosterOf,
  sameImageGroups,
} from '../../scripts/data/lib/images.mjs'
import { PROJECT_ROOT, readProjectJson } from '../../scripts/data/lib/pipeline.mjs'
import { RESIST_BERRIES } from '../cards/berries'
import { POWER_ITEMS } from '../cards/powerItems'
import { indexByFileId, itemIconUrl, pokemonIconUrl } from './images'

const sha256 = (buf: Buffer) => createHash('sha256').update(buf).digest('hex')
const POKEMON_DIR = join(PROJECT_ROOT, 'src/assets/pokemon-icons')
const ITEM_DIR = join(PROJECT_ROOT, 'src/assets/item-icons')

interface Manifest {
  entries: Record<
    string,
    { sha256: string; width: number; height: number; pokeapiId?: number; src?: string; via?: string; file?: string; sha1?: string; uploadedAt?: string }
  >
  missing: { id: string; reason: string }[]
  sameImage?: string[][]
}
const pokemonManifest = readProjectJson('src/assets/pokemon-icons/manifest.json') as Manifest
const itemManifest = readProjectJson('src/assets/item-icons/manifest.json') as Manifest
const pngIds = (dir: string) =>
  readdirSync(dir)
    .filter((f) => f.endsWith('.png'))
    .map((f) => f.replace(/\.png$/, ''))
    .sort()

const regulations = (readProjectJson('src/data/regulations/index.json') as { regulations: { id: string }[] }).regulations
const snapshots = regulations.map((r) => readProjectJson(`src/data/regulations/${r.id}/data.json`) as Parameters<typeof rosterOf>[0][number])
// gen:images와 같은 방식으로 메타(사용률) 등장 종 id를 모은다
const metaIndex = readProjectJson('src/data/meta/index.json') as { regulations: Record<string, { file: string }[]> }
const metaIds = Object.values(metaIndex.regulations).flatMap((items) =>
  items.flatMap((it) => (readProjectJson(`src/data/meta/${it.file}`) as { entries: { id: string }[] }).entries.map((e) => e.id)),
)

describe('resolvePokeapiIds 매핑 규칙', () => {
  const forms = [
    { identifier: 'garchomp', pokemon_id: '445' },
    { identifier: 'garchomp-mega-z', pokemon_id: '10309' },
    { identifier: 'meowstic-male', pokemon_id: '678' },
    { identifier: 'meowstic-female', pokemon_id: '10025' },
    { identifier: 'dup-a', pokemon_id: '1' },
    { identifier: 'dupa', pokemon_id: '2' },
  ]
  it('폼 identifier(toID) 일치 → 그 pokemon_id, 원종은 도감 번호, 손 매핑이 우선', () => {
    const { resolved, unresolved } = resolvePokeapiIds(
      [
        { id: 'garchompmegaz', num: 445, name: 'Garchomp-Mega-Z', baseSpecies: 'garchomp', isMega: true },
        { id: 'aegislash', num: 681, name: 'Aegislash', isMega: false },
        { id: 'meowsticf', num: 678, name: 'Meowstic-F', isMega: false },
      ],
      forms,
      { meowsticf: 10025 },
    )
    expect(resolved).toEqual({
      garchompmegaz: { pokeapiId: 10309, src: '10309', via: 'form' },
      aegislash: { pokeapiId: 681, src: '681', via: 'num' },
      meowsticf: { pokeapiId: 10025, src: '10025', via: 'hand' },
    })
    expect(unresolved).toEqual([])
  })

  it('이름에 폼 꼬리가 있는 원종·메가·다의 identifier는 도감 번호로 풀지 않고 실패 목록에 남긴다', () => {
    const { resolved, unresolved } = resolvePokeapiIds(
      [
        { id: 'meowsticf', num: 678, name: 'Meowstic-F', isMega: false },
        { id: 'foomega', num: 9, name: 'Foo-Mega', baseSpecies: 'foo', isMega: true },
        { id: 'dupa', num: 3, name: 'Dup-A', baseSpecies: 'dup', isMega: false },
      ],
      forms,
      {},
    )
    expect(resolved).toEqual({})
    expect(unresolved.map((u) => u.id)).toEqual(['dupa', 'foomega', 'meowsticf'])
    expect(unresolved[0].reason).toContain('다의')
  })

  it('기본 폼이 아닌 겉모습 폼(is_default=0)은 같은 pokemon id라도 폼 전용 원천 파일을 쓴다(기본 폼 그림으로 대신하지 않음)', () => {
    const { resolved } = resolvePokeapiIds(
      [
        { id: 'vivillon', num: 666, name: 'Vivillon', isMega: false },
        { id: 'vivillonfancy', num: 666, name: 'Vivillon-Fancy', baseSpecies: 'vivillon', isMega: false },
        { id: 'vivillonpokeball', num: 666, name: 'Vivillon-Pokeball', baseSpecies: 'vivillon', isMega: false },
        { id: 'charizardmegax', num: 6, name: 'Charizard-Mega-X', baseSpecies: 'charizard', isMega: true },
      ],
      [
        { identifier: 'vivillon-meadow', form_identifier: 'meadow', pokemon_id: '666', is_default: '1' },
        { identifier: 'vivillon-fancy', form_identifier: 'fancy', pokemon_id: '666', is_default: '0' },
        { identifier: 'vivillon-poke-ball', form_identifier: 'poke-ball', pokemon_id: '666', is_default: '0' },
        { identifier: 'charizard-mega-x', form_identifier: 'mega-x', pokemon_id: '10034', is_default: '1' },
      ],
      {},
    )
    expect(resolved).toEqual({
      vivillon: { pokeapiId: 666, src: '666', via: 'num' },
      vivillonfancy: { pokeapiId: 666, src: '666-fancy', via: 'form' },
      vivillonpokeball: { pokeapiId: 666, src: '666-poke-ball', via: 'form' },
      charizardmegax: { pokeapiId: 10034, src: '10034', via: 'form' },
    })
  })

  it('needsDownload: 파일 없음·매니페스트 없음·원천 변경·내용 불일치·--force면 다시 받는다', () => {
    const prev = { src: '666', sha256: 'aaa' }
    const base = { force: false, prev, want: '666', wantKey: 'src', sha: 'aaa' }
    expect(needsDownload(base)).toBe(false)
    expect(needsDownload({ ...base, force: true })).toBe(true)
    expect(needsDownload({ ...base, sha: undefined })).toBe(true)
    expect(needsDownload({ ...base, prev: undefined })).toBe(true)
    expect(needsDownload({ ...base, want: '666-fancy' })).toBe(true)
    expect(needsDownload({ ...base, sha: 'bbb' })).toBe(true)
  })

  it('sameImageGroups: sha256이 같은 항목 묶음을 알려진 것·뜻밖의 것으로 나눈다', () => {
    const r = sameImageGroups(
      { b: { sha256: '1' }, a: { sha256: '1' }, c: { sha256: '2' }, d: { sha256: '3' }, e: { sha256: '3' } },
      [['a', 'b']],
    )
    expect(r).toEqual({ known: [['a', 'b']], unexpected: [['d', 'e']] })
  })

  it('Bulbagarden imageinfo 응답 → 밑줄 파일 이름별 판(올린 시각·sha1), 없는 파일은 빠진다', () => {
    const r = parseBulbaImageInfo({
      query: {
        pages: [
          { title: 'File:Bag Occa Berry Champs Sprite.png', imageinfo: [{ timestamp: '2026-04-08T04:27:34Z', sha1: 'abc', url: 'https://x/y.png' }] },
          { title: 'File:Bag Nope Champs Sprite.png', missing: true },
        ],
      },
    })
    expect(r).toEqual({ 'Bag_Occa_Berry_Champs_Sprite.png': { timestamp: '2026-04-08T04:27:34Z', sha1: 'abc', url: 'https://x/y.png' } })
    expect(bulbaImageInfoUrl(['Bag_Occa_Berry_Champs_Sprite.png'])).toContain('titles=File%3ABag_Occa_Berry_Champs_Sprite.png')
  })

  it('반감열매 Bag 스프라이트 파일 이름', () => {
    expect(bagSpriteFile('Occa Berry')).toBe('Bag_Occa_Berry_Champs_Sprite.png')
  })
})

describe('생성 매니페스트·번들 이미지', () => {
  it('로스터(모든 스냅샷 종 + 메타 등장 종) 전부 아이콘이 있거나 매니페스트 실패 목록에 있다', () => {
    expect(metaIds.length).toBeGreaterThan(0)
    const { species, missingMeta } = rosterOf(snapshots, metaIds)
    expect(missingMeta).toEqual([])
    for (const id of new Set(metaIds)) expect(pokemonIconUrl(id), id).toBeTypeOf('string')
    expect(species.length).toBeGreaterThan(300)
    const missing = new Set(pokemonManifest.missing.map((m) => m.id))
    for (const s of species) expect(pokemonIconUrl(s.id) !== undefined || missing.has(s.id), s.id).toBe(true)
    // 이번 스냅샷은 실패 없이 전부 받았다
    expect(pokemonManifest.missing).toEqual([])
  })

  it('매니페스트 항목 = 디스크 PNG = 앱 해석 가능 id, 가로 128·세로 128 이하, sha256이 디스크 파일과 같다', () => {
    expect(Object.keys(pokemonManifest.entries).sort()).toEqual(pngIds(POKEMON_DIR))
    for (const [id, e] of Object.entries(pokemonManifest.entries)) {
      expect(pokemonIconUrl(id), id).toBeTypeOf('string')
      expect(e.width, id).toBe(128)
      expect(e.height, id).toBeGreaterThanOrEqual(112)
      expect(e.height, id).toBeLessThanOrEqual(128)
      expect(sha256(readFileSync(join(POKEMON_DIR, `${id}.png`))), id).toBe(e.sha256)
    }
  })

  it('포켓몬 아이콘 합계 5 MiB 이하(128px 원본 유지 근거는 README)', () => {
    const total = pngIds(POKEMON_DIR).reduce((a, id) => a + statSync(join(POKEMON_DIR, `${id}.png`)).size, 0)
    expect(total).toBeLessThanOrEqual(5 * 1024 * 1024)
  })

  it('겉모습 폼은 폼 전용 그림(비비용 팬시·몬스터볼 ≠ 기본 꽃밭 무늬), 같은 그림 묶음은 알려진 상류 한계뿐', () => {
    const e = pokemonManifest.entries
    expect(e.vivillonfancy).toMatchObject({ pokeapiId: 666, src: '666-fancy' })
    expect(e.vivillonpokeball).toMatchObject({ pokeapiId: 666, src: '666-poke-ball' })
    expect(new Set([e.vivillon.sha256, e.vivillonfancy.sha256, e.vivillonpokeball.sha256]).size).toBe(3)
    expect(sameImageGroups(e).unexpected).toEqual([])
    expect(pokemonManifest.sameImage).toEqual(KNOWN_SAME_IMAGE.map((g) => [...g]))
  })

  it('Champions 새 메가·지역 폼·성별 폼이 PokeAPI 폼 id로 매핑된다', () => {
    const id = (s: string) => pokemonManifest.entries[s]?.pokeapiId
    expect(id('garchompmegaz')).toBe(10309)
    expect(id('absolmegaz')).toBe(10307)
    expect(id('charizardmegay')).toBe(10035)
    expect(id('ninetalesalola')).toBe(10104)
    expect(id('meowsticf')).toBe(10025)
    expect(id('meowsticfmega')).toBe(10326)
    expect(id('maushold')).toBe(10257)
    expect(id('garchomp')).toBe(445)
    for (const k of Object.keys(HAND_POKEAPI_IDS)) expect(pokemonManifest.entries[k]?.via, k).toBe('hand')
  })

  it('도구 아이콘 대상 = 반감열매 18종 + 화력 도구 22종(R14), 전부 받았고 앱에서 해석된다', () => {
    expect([...ITEM_ICON_IDS].sort()).toEqual([...Object.keys(RESIST_BERRIES), ...POWER_ITEMS].sort())
    expect(itemManifest.missing).toEqual([])
    expect(Object.keys(itemManifest.entries).sort()).toEqual(pngIds(ITEM_DIR))
    for (const id of ITEM_ICON_IDS) {
      expect(itemIconUrl(id), id).toBeTypeOf('string')
      const e = itemManifest.entries[id]
      expect(e.file).toMatch(/^Bag_.+_Champs_Sprite\.png$/)
      // 판 고정: 받은 시점 원천 판의 올린 시각·sha1이 기록되고 디스크 파일과 같다
      expect(e.uploadedAt, id).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
      const png = readFileSync(join(ITEM_DIR, `${id}.png`))
      expect(createHash('sha1').update(png).digest('hex'), id).toBe(e.sha1)
      expect(sha256(png), id).toBe(e.sha256)
    }
  })

  it('없는 id·undefined는 undefined(화면은 빈 자리·텍스트 배지 폴백)', () => {
    expect(pokemonIconUrl('notapokemon')).toBeUndefined()
    expect(pokemonIconUrl(undefined)).toBeUndefined()
    expect(itemIconUrl('leftovers')).toBeUndefined()
    expect(itemIconUrl(undefined)).toBeUndefined()
  })

  it('indexByFileId: 파일 이름(확장자 뺀 id) → URL, 형식 밖 경로는 무시', () => {
    const m = indexByFileId({ '../assets/x/garchomp.png': '/a.png', '../assets/x/Bad-Name.png': '/b.png' })
    expect([...m]).toEqual([['garchomp', '/a.png']])
  })

  it('자산 폴더마다 출처·고지 파일이 있다', () => {
    for (const f of ['pokemon-icons/LICENSE', 'pokemon-icons/README.md', 'item-icons/LICENSE', 'item-icons/README.md']) {
      expect(existsSync(join(PROJECT_ROOT, 'src/assets', f)), f).toBe(true)
    }
    expect(readFileSync(join(POKEMON_DIR, 'README.md'), 'utf8')).toContain('ba403973fdf9d0ac59175813861e6a1f8ed5020c')
  })
})
