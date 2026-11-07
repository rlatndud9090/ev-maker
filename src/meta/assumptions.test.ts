import { describe, expect, it } from 'vitest'
import { calcDamage, type PokemonSet } from '../core'
import { META_SCHEMA_VERSION, type MetaEntry, type MetaSnapshot } from '../data/meta-schema'
import { loadSnapshotSync } from '../data/testing'
import {
  createMetaView,
  lookupOpponent,
  observedSpreadAssumption,
  representativeAssumption,
  resolveAssumption,
  setDisplayNames,
  topAssumptions,
  validateOverlay,
  type Assumption,
  type AssumptionOverlay,
} from './index'

const game = loadSnapshotSync('m-c')

const sp = (hp: number, atk: number, def: number, spa: number, spd: number, spe: number) => ({ hp, atk, def, spa, spd, spe })
const mkSet = (over: Partial<PokemonSet> & Pick<PokemonSet, 'species' | 'ability' | 'nature' | 'sp' | 'moves'>): PokemonSet => ({
  regulation: 'm-c',
  ...over,
})
const zeroMarginal = () => ({ hp: {}, atk: {}, def: {}, spa: {}, spd: {}, spe: {} })

function mkEntry(id: string, rank: number, usage: number, set: PokemonSet, over: Partial<MetaEntry> = {}): MetaEntry {
  return {
    id,
    rank,
    usage,
    sample: { weighted: 1000, raw: 2000 },
    abilities: { [set.ability]: 0.9 },
    items: { shares: set.item ? { [set.item]: 0.5 } : {}, keptShare: 0.5, excludedShare: 0 },
    moves: { shares: Object.fromEntries(set.moves.map((m) => [m, 0.8])), keptShare: 3.2, excludedShare: 0 },
    spreads: { kept: [[`${set.nature}:${Object.values(set.sp).join('/')}`, 0.4]], keptShare: 0.4, excludedShare: 0 },
    natures: { [set.nature]: 0.6 },
    spMarginal: zeroMarginal(),
    teammates: {},
    representative: { set, basis: 'modal-combination' },
    ...over,
  }
}

const kingambitSet = mkSet({
  species: 'kingambit',
  ability: 'defiant',
  item: 'chopleberry',
  nature: 'brave',
  sp: sp(32, 32, 0, 0, 2, 0),
  moves: ['kowtowcleave', 'suckerpunch', 'ironhead', 'lowkick'],
})
const sneaslerSet = mkSet({
  species: 'sneasler',
  ability: 'unburden',
  item: 'whiteherb',
  nature: 'adamant',
  sp: sp(2, 32, 0, 0, 0, 32),
  moves: ['closecombat', 'direclaw', 'fakeout', 'protect'],
})
const charizardMegaYSet = mkSet({
  species: 'charizard',
  ability: 'blaze',
  item: 'charizarditey',
  mega: true,
  nature: 'modest',
  sp: sp(2, 0, 0, 32, 0, 32),
  moves: ['heatwave', 'solarbeam', 'airslash', 'protect'],
})
const rillaboomSet = mkSet({
  species: 'rillaboom',
  ability: 'grassysurge',
  nature: 'adamant',
  sp: sp(32, 32, 0, 0, 2, 0),
  moves: ['fakeout', 'grassyglide', 'woodhammer', 'uturn'],
})

function mkMeta(entries: MetaEntry[]): MetaSnapshot {
  return {
    manifest: {
      schemaVersion: META_SCHEMA_VERSION,
      regulation: 'm-c',
      month: '2026-10',
      match: 'bo1',
      source: {
        format: 'gen9championsvgc2026regmc',
        cutoff: 1760,
        url: 'https://www.smogon.com/stats/2026-10/chaos/gen9championsvgc2026regmc-1760.json',
        sha256: '0'.repeat(64),
        publishedAt: '2026-11-01T13:27:17Z',
        battles: 1000,
      },
      params: { minUsage: 0.005, spreadTarget: 0.8, spreadMax: 30, itemMin: 0.001, moveMin: 0.005, teammatesTop: 10 },
      gameData: { regulation: 'm-c', schemaVersion: 1, sha256: '1'.repeat(64) },
      sample: { weightedBattles: 500 },
    },
    entries,
  }
}

// 배열 순서를 일부러 섞는다. charizardmegay·rillaboom은 사용률 동률이라 id 순으로 순위가 정해진 상태다.
const baseMeta = (): MetaSnapshot =>
  mkMeta([
    mkEntry('rillaboom', 4, 0.3, rillaboomSet),
    mkEntry('kingambit', 2, 0.42, kingambitSet, {
      items: { shares: { chopleberry: 0.3, zzunknownitem: 0.01 }, keptShare: 0.31, excludedShare: 0 },
      spreads: {
        kept: [
          ['brave:32/32/0/0/2/0', 0.3],
          ['adamant:2/32/0/0/0/32', 0.2],
        ],
        keptShare: 0.5,
        excludedShare: 0,
      },
    }),
    mkEntry('charizardmegay', 3, 0.3, charizardMegaYSet, {
      mega: { base: 'charizard', stone: 'charizarditey' },
      abilities: { drought: 0.99 },
      representative: { set: charizardMegaYSet, basis: 'modal-combination', abilityBasis: 'base-first-slot' },
    }),
    mkEntry('sneasler', 1, 0.5, sneaslerSet),
  ])

const customRotom: Assumption = {
  target: 'rotomwash',
  set: mkSet({ species: 'rotomwash', ability: 'levitate', nature: 'modest', sp: sp(32, 0, 0, 32, 2, 0), moves: ['hydropump', 'protect'] }),
  source: { kind: 'custom', author: '테스터', memo: '테스트 입력' },
  basis: 'as-published',
  intent: '포푸니크를 물 기술로 견제',
}
const overlay = (assumptions: Assumption[] = [customRotom], regulation = 'm-c'): AssumptionOverlay => ({ regulation, assumptions })

describe('메타 뷰 순위·조회', () => {
  it('ranking은 rank 순이고 사용률 동률은 id 순이다', () => {
    const view = createMetaView(baseMeta(), game)
    expect(view.ranking.map((e) => e.id)).toEqual(['sneasler', 'kingambit', 'charizardmegay', 'rillaboom'])
    expect(view.entry('kingambit')?.rank).toBe(2)
    expect(view.entry('absol')).toBeUndefined()
  })

  it('레귤레이션이 다른 메타 스냅샷은 거부한다', () => {
    const meta = baseMeta()
    meta.manifest.regulation = 'm-b'
    expect(() => createMetaView(meta, game)).toThrow(/레귤레이션/)
  })
})

describe('대표 가정과 메가 해석', () => {
  it('메가 대표 세트는 메가 폼으로 해석되고 표시 이름은 게임 데이터의 메가 폼 이름이다', () => {
    const view = createMetaView(baseMeta(), game)
    const a = representativeAssumption(view, 'charizardmegay')
    expect(a).toMatchObject({ target: 'charizardmegay', basis: 'modal-combination', abilityBasis: 'base-first-slot', share: 0.4 })
    expect(a.source).toEqual({
      kind: 'ladder',
      origin: 'smogon-chaos',
      format: 'gen9championsvgc2026regmc',
      match: 'bo1',
      month: '2026-10',
      cutoff: 1760,
      url: 'https://www.smogon.com/stats/2026-10/chaos/gen9championsvgc2026regmc-1760.json',
    })
    const r = resolveAssumption(game, a)
    if (!r.usable) throw r.error
    expect(r.resolved.species.id).toBe('charizardmegay')
    const names = setDisplayNames(view, r)
    expect(names.species.ko).toBe(game.data.species.charizardmegay.name.ko)
    expect(names.species.ko).toBe('메가리자몽Y')
    expect(names.item).toEqual({ id: 'charizarditey', ...pick(game.data.items.charizarditey.name), missing: false })
  })

  it('대표 가정 kingambit → sneasler 기습 계산 결과가 나온다', () => {
    const view = createMetaView(baseMeta(), game)
    const atk = representativeAssumption(view, 'kingambit')
    const def = representativeAssumption(view, 'sneasler')
    expect(atk.set.moves).toContain('suckerpunch')
    expect(calcDamage(game, atk.set, def.set, 'suckerpunch').kind).toBe('damage')
  })

  it('observedSpreadAssumption은 kept[i]의 성격·SP만 바꾼다', () => {
    const view = createMetaView(baseMeta(), game)
    const a = observedSpreadAssumption(view, 'kingambit', 1)
    expect(a.basis).toBe('observed-spread')
    expect(a.share).toBe(0.2)
    expect(a.set).toEqual({ ...kingambitSet, nature: 'adamant', sp: sp(2, 32, 0, 0, 0, 32) })
    expect(resolveAssumption(game, a).usable).toBe(true)
    expect(() => observedSpreadAssumption(view, 'kingambit', 2)).toThrow(RangeError)
  })

  it('topAssumptions는 순위대로 대표 가정을 검증하고 한국어 이름을 게임 데이터에서 붙인다', () => {
    const view = createMetaView(baseMeta(), game)
    const top = topAssumptions(view)
    expect(top.map((t) => t.entry.id)).toEqual(['sneasler', 'kingambit', 'charizardmegay', 'rillaboom'])
    for (const t of top) {
      expect(t.result.usable).toBe(true)
      const set = t.result.assumption.set
      expect(t.names.ability.ko).toBe(game.data.abilities[set.ability].name.ko)
      expect(t.names.nature.ko).toBe(game.data.natures[set.nature].name.ko)
      expect(t.names.moves.map((m) => m.ko)).toEqual(set.moves.map((m) => game.data.moves[m].name.ko))
      expect([t.names.species, t.names.ability, t.names.nature, ...t.names.moves].some((n) => n.missing)).toBe(false)
    }
    expect(top.find((t) => t.entry.id === 'rillaboom')?.names.item).toBeUndefined()
    expect(topAssumptions(view, 2)).toHaveLength(2)
  })
})

describe('해시가 다른 스냅샷의 런타임 처리', () => {
  it('게임 데이터에 없는 id는 missing과 원문 id로 표시한다', () => {
    const view = createMetaView(baseMeta(), game)
    expect(view.name('items', 'zzunknownitem')).toEqual({ id: 'zzunknownitem', ko: 'zzunknownitem', en: 'zzunknownitem', missing: true })
    expect(view.name('items', 'nothing')).toMatchObject({ ko: '도구 없음', missing: false })
    expect(view.name('items', 'chopleberry')).toEqual({ id: 'chopleberry', ko: '로플열매', en: 'Chople Berry', missing: false })
  })

  it('검증에 실패한 대표 세트 항목만 usable: false이고 나머지는 정상이다', () => {
    const meta = baseMeta()
    const broken = meta.entries.find((e) => e.id === 'kingambit') as MetaEntry
    broken.representative.set = { ...broken.representative.set, ability: 'nosuchability' }
    const top = topAssumptions(createMetaView(meta, game))
    const bad = top.find((t) => t.entry.id === 'kingambit')
    expect(bad?.result.usable).toBe(false)
    if (bad && !bad.result.usable) expect(bad.result.error.name).toBe('CoreError')
    expect(bad?.names.ability).toMatchObject({ id: 'nosuchability', missing: true })
    expect(bad?.names.species.ko).toBe('대도각참')
    expect(top.filter((t) => t.entry.id !== 'kingambit').every((t) => t.result.usable)).toBe(true)
  })

  it('검증을 통과해도 해석된 종이 target과 다르면 대상 불일치로 usable: false다', () => {
    const absolSet = mkSet({ species: 'absol', ability: 'pressure', nature: 'adamant', sp: sp(2, 32, 0, 0, 0, 32), moves: ['suckerpunch'] })
    const wrong: Assumption = { ...customRotom, set: absolSet }
    const res = lookupOpponent(createMetaView(baseMeta(), game), 'rotomwash', overlay([wrong]))
    expect(res.assumptions).toHaveLength(1)
    const [r] = res.assumptions
    expect(r.usable).toBe(false)
    if (!r.usable) {
      expect(r.error.name).toBe('CoreInputError')
      expect(r.error.message).toMatch(/대상 불일치/)
    }

    const meta = baseMeta()
    const zard = meta.entries.find((e) => e.id === 'charizardmegay') as MetaEntry
    const noMega = structuredClone(charizardMegaYSet)
    delete noMega.mega
    zard.representative = { ...zard.representative, set: noMega }
    const ladder = lookupOpponent(createMetaView(meta, game), 'charizardmegay')
    expect(ladder.assumptions).toHaveLength(1)
    const [z] = ladder.assumptions
    expect(z.usable).toBe(false)
    if (!z.usable) expect(z.error.message).toMatch(/대상 불일치/)
  })

  it('코어 검증 오류가 아닌 예외는 삼키지 않는다', () => {
    const set = Object.defineProperty({ ...customRotom.set }, 'regulation', {
      enumerable: true,
      get() {
        throw new TypeError('세트 읽기 실패')
      },
    })
    expect(() => resolveAssumption(game, { ...customRotom, set })).toThrow(TypeError)
  })
})

describe('목록 밖 종과 오버레이', () => {
  it('로스터에 있지만 메타에 없는 종은 no-ladder이고 가정이 없다', () => {
    const view = createMetaView(baseMeta(), game)
    for (const id of ['rotomwash', 'absol']) {
      expect(game.data.species[id]).toBeDefined()
      expect(lookupOpponent(view, id)).toEqual({ status: 'no-ladder', assumptions: [] })
    }
  })

  it('로스터 밖 id 조회는 거부한다', () => {
    const view = createMetaView(baseMeta(), game)
    expect(() => lookupOpponent(view, 'zzmissing')).toThrow(/로스터/)
    expect(() => lookupOpponent(view, '__proto__')).toThrow(/로스터/)
  })

  it('커스텀 오버레이 가정은 같은 경로로 해석되어 계산 결과를 낸다', () => {
    const view = createMetaView(baseMeta(), game)
    const res = lookupOpponent(view, 'rotomwash', overlay())
    expect(res.status).toBe('no-ladder')
    expect(res.assumptions).toHaveLength(1)
    const [r] = res.assumptions
    expect(r.usable).toBe(true)
    expect(r.assumption.intent).toBe('포푸니크를 물 기술로 견제')
    const def = representativeAssumption(view, 'sneasler')
    expect(calcDamage(game, r.assumption.set, def.set, 'hydropump').kind).toBe('damage')
  })

  it('메타 항목이 있는 종은 대표 가정 뒤에 같은 target 오버레이 가정이 붙는다', () => {
    const view = createMetaView(baseMeta(), game)
    const extra: Assumption = { ...customRotom, target: 'kingambit', set: { ...kingambitSet, item: 'focussash' }, source: { kind: 'article', link: 'https://example.com/a' } }
    const res = lookupOpponent(view, 'kingambit', overlay([customRotom, extra]))
    expect(res.status).toBe('ladder')
    expect(res.assumptions.map((r) => r.assumption.source.kind)).toEqual(['ladder', 'article'])
    expect(res.assumptions.every((r) => r.usable)).toBe(true)
  })

  it.each([
    ['래더 출처', overlay([{ ...customRotom, source: { kind: 'ladder' } as unknown as Assumption['source'] }]), /source\.kind/],
    ['다른 레귤레이션', overlay([customRotom], 'm-b'), /레귤레이션/],
    ['로스터 밖 target', overlay([{ ...customRotom, target: 'zzmissing' }]), /target/],
    ['세트 레귤레이션 불일치', overlay([{ ...customRotom, set: { ...customRotom.set, regulation: 'm-b' } }]), /set\.regulation/],
  ])('validateOverlay는 %s를 거부한다', (_, o, msg) => {
    expect(() => validateOverlay(game, o)).toThrow(msg)
    expect(() => lookupOpponent(createMetaView(baseMeta(), game), 'rotomwash', o)).toThrow(msg)
  })
})

describe('불변성', () => {
  it('뷰 생성·조회·가정 구성이 메타 스냅샷 객체를 바꾸지 않는다', () => {
    const meta = baseMeta()
    const before = structuredClone(meta)
    const view = createMetaView(meta, game)
    topAssumptions(view)
    observedSpreadAssumption(view, 'kingambit', 1).set.moves.push('protect')
    representativeAssumption(view, 'sneasler').set.sp.hp = 0
    lookupOpponent(view, 'rotomwash', overlay())
    lookupOpponent(view, 'kingambit', overlay())
    expect(meta).toEqual(before)
  })
})

function pick(n: { ko: string; en: string }) {
  return { ko: n.ko, en: n.en }
}
