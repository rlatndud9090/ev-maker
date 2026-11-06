import { describe, expect, it } from 'vitest'
import { Dex } from '@pkmn/dex'
import type { MoveEntry } from '../data/schema'
import { loadSnapshotSync } from '../data/testing'
import { GOLDEN_SOURCE, MC, cloneSnapshot, goldenCase, goldenSet, mkSet } from './testing'
import {
  CoreInputError,
  calcDamage,
  type BattleConditions,
  type DamageResult,
  type DamageResultOk,
  type PokemonSet,
} from './index'
import { koChance } from './damage'

const ok = (r: DamageResult): DamageResultOk => {
  if (r.kind !== 'damage') throw new Error(`대미지 결과가 아니다: ${r.kind}`)
  return r
}
/** 엔진 표시(소수 첫째 자리 내림) */
const floor1 = (x: number) => Math.floor(x * 10) / 10
const round1 = (x: number) => Math.round(x * 10) / 10

const kingambit = mkSet({ species: 'kingambit', ability: 'defiant', sp: { atk: 32 } })
const delphoxMega = mkSet({ species: 'delphox', ability: 'blaze', item: 'delphoxite', mega: true, sp: { hp: 2 } })
const mamoswine = mkSet({ species: 'mamoswine', ability: 'oblivious', nature: 'adamant', sp: { atk: 32 } })
const incineroar = mkSet({ species: 'incineroar', ability: 'blaze', nature: 'careful', sp: { hp: 32, def: 2 } })

describe('독립 기준값 대조(출처: 독립 산술 scripts/golden/compute-independent.mjs)', () => {
  it('출처 문자열이 기록돼 있다', () => {
    expect(GOLDEN_SOURCE).toContain('독립 산술')
  })

  it('a) 대도각참 기습 → 메가마폭시: 칸마다 16개 값·개수·구간', () => {
    const g = goldenCase<{ cells: { sp: number; rolls: number[]; koCount: number; ohkoChance: number; attackBand: string }[]; defenderHp: number }>(
      'a-kingambit-sucker-punch-atk-sweep',
    )
    const def = goldenSet(g.defender)
    for (const cell of g.cells) {
      const atk = goldenSet({ ...g.attacker, sp: { ...g.attacker.sp, atk: cell.sp } })
      const r = ok(calcDamage(MC, atk, def, 'suckerpunch'))
      expect(r.rolls).toEqual([cell.rolls])
      expect(r.defenderHp).toBe(g.defenderHp)
      expect(r.ohkoChance).toBe(cell.ohkoChance)
      expect(r.ohkoChance).toBe(cell.koCount / 16)
      expect(r.attackBand).toBe(cell.attackBand)
    }
  })

  it('d) 보만다 더블윙(고정 2타) → 고릴타: 타별 배열·256 조합 계수', () => {
    const g = goldenCase<{ rollsPerHit: number[][]; hits: number; min: number; max: number; minPercent: number; maxPercent: number; koCount: number; koTotal: number; ohkoChance: number; attackBand: string; defenseBand: string }>(
      'd-salamence-dual-wingbeat-vs-rillaboom-multihit',
    )
    const r = ok(calcDamage(MC, goldenSet(g.attacker), goldenSet(g.defender), 'dualwingbeat'))
    expect(r.hits).toBe(g.hits)
    expect(r.rolls).toEqual(g.rollsPerHit)
    expect([r.min, r.max]).toEqual([g.min, g.max])
    expect([round1(r.minPercent), round1(r.maxPercent)]).toEqual([g.minPercent, g.maxPercent])
    expect(g.koTotal).toBe(256)
    expect(r.ohkoChance).toBe(g.koCount / g.koTotal)
    expect([r.attackBand, r.defenseBand]).toEqual([g.attackBand, g.defenseBand])
  })

  it('e) 맘모꾸리 지진 + 도우미 → 어흥염(더블 범위기), 도우미 끔·싱글 참고값', () => {
    const g = goldenCase<{ rolls: number[]; min: number; max: number; minPercent: number; maxPercent: number; ohkoChance: number; attackBand: string; defenseBand: string; reference: { helpingHandOff: { rolls: number[] }; singles: { rolls: number[] } } }>(
      'e-mamoswine-earthquake-helping-hand-vs-incineroar',
    )
    const atk = goldenSet(g.attacker)
    const def = goldenSet(g.defender)
    const r = ok(calcDamage(MC, atk, def, 'earthquake', { attacker: { helpingHand: true }, spreadTargets: 2 }))
    expect(r.rolls).toEqual([g.rolls])
    expect([round1(r.minPercent), round1(r.maxPercent)]).toEqual([g.minPercent, g.maxPercent])
    expect([r.ohkoChance, r.attackBand, r.defenseBand]).toEqual([g.ohkoChance, g.attackBand, g.defenseBand])
    expect(ok(calcDamage(MC, atk, def, 'earthquake')).rolls).toEqual([g.reference.helpingHandOff.rolls])
    expect(ok(calcDamage(MC, atk, def, 'earthquake', { gameType: 'Singles' })).rolls).toEqual([g.reference.singles.rolls])
  })

  it('f) 멀티스케일 망나뇽(HP 가득)은 특성 없을 때의 반감 분포', () => {
    const g = goldenCase<{ multiscale: { rolls: number[]; ohkoChance: number; attackBand: string; defenseBand: string }; withoutMultiscale: { ability: string; rolls: number[]; ohkoChance: number } }>(
      'f-mamoswine-icicle-crash-vs-multiscale-dragonite',
    )
    const atk = goldenSet(g.attacker)
    const ms = ok(calcDamage(MC, atk, goldenSet(g.defender), 'iciclecrash'))
    expect(ms.rolls).toEqual([g.multiscale.rolls])
    expect([ms.ohkoChance, ms.attackBand, ms.defenseBand]).toEqual([g.multiscale.ohkoChance, g.multiscale.attackBand, g.multiscale.defenseBand])
    const plain = ok(calcDamage(MC, atk, goldenSet({ ...g.defender, ability: g.withoutMultiscale.ability }), 'iciclecrash'))
    expect(plain.rolls).toEqual([g.withoutMultiscale.rolls])
    expect(plain.ohkoChance).toBe(g.withoutMultiscale.ohkoChance)
    // HP가 가득이 아니면 반감되지 않는다
    const hurt = ok(calcDamage(MC, atk, { ...goldenSet(g.defender), curHp: 197 }, 'iciclecrash'))
    expect(hurt.rolls).toEqual(plain.rolls)
  })
})

describe('대미지 PRD 수용 기준', () => {
  it('대도각참 기습 → 메가마폭시: 16개 값, 106.5~126.3%, 확정 1타 / 중난수 이상', () => {
    const r = ok(calcDamage(MC, kingambit, delphoxMega, 'suckerpunch'))
    expect(r.rolls).toEqual([[162, 164, 164, 168, 168, 170, 174, 174, 176, 180, 180, 182, 186, 186, 188, 192]])
    expect([floor1(r.minPercent), floor1(r.maxPercent)]).toEqual([106.5, 126.3])
    expect(r.ohkoChance).toBe(1)
    expect([r.attackBand, r.defenseBand]).toEqual(['guaranteed-ohko', 'mid-or-higher'])
    expect([r.attackerSpecies, r.defenderSpecies, r.defenderSetAbility, r.defenderAbility]).toEqual([
      'kingambit',
      'delphoxmega',
      'blaze',
      'levitate',
    ])
  })

  it('지진: 싱글 204~240 확정 1타, 더블 152~180 0%, 더블 대상 1 = 싱글', () => {
    const s = ok(calcDamage(MC, mamoswine, incineroar, 'earthquake', { gameType: 'Singles' }))
    const d = ok(calcDamage(MC, mamoswine, incineroar, 'earthquake'))
    const one = ok(calcDamage(MC, mamoswine, incineroar, 'earthquake', { spreadTargets: 1 }))
    expect([s.min, s.max, s.ohkoChance, s.attackBand]).toEqual([204, 240, 1, 'guaranteed-ohko'])
    expect([d.min, d.max, d.ohkoChance, d.attackBand, d.defenseBand]).toEqual([152, 180, 0, 'mid-or-lower', 'guaranteed-survive'])
    expect(one.rolls).toEqual(s.rolls)
  })

  it('범위기 대상 1 + 도우미 = 싱글 + 도우미', () => {
    const hh = { attacker: { helpingHand: true } }
    const one = ok(calcDamage(MC, mamoswine, incineroar, 'earthquake', { ...hh, spreadTargets: 1 }))
    const single = ok(calcDamage(MC, mamoswine, incineroar, 'earthquake', { ...hh, gameType: 'Singles' }))
    expect(one.rolls).toEqual(single.rolls)
  })

  it('1타 확률 = HP 이상 난수 개수 ÷ 16(독립 계수)', () => {
    const atks = [0, 5, 10, 13, 16, 19, 32]
    for (const sp of atks) {
      const r = ok(calcDamage(MC, { ...kingambit, sp: { ...kingambit.sp, atk: sp } }, delphoxMega, 'suckerpunch'))
      const count = r.rolls[0].filter((d) => d >= r.defenderHp).length
      expect(r.ohkoChance).toBe(count / 16)
    }
  })

  it('연속기 합계 분포는 16×16 전수 계수와 같다', () => {
    const rolls = [
      [84, 86, 86, 86, 90, 90, 90, 92, 92, 92, 96, 96, 96, 98, 98, 102],
      [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25],
    ]
    for (const hp of [90, 100, 110, 120, 127]) {
      let count = 0
      for (const a of rolls[0]) for (const b of rolls[1]) if (a + b >= hp) count++
      expect(koChance(rolls, hp)).toBe(count / 256)
    }
  })

  it('방어측 먹다남은음식도 도구 없음과 같은 순수 대미지 판정', () => {
    const iceShard = mkSet({ ...mamoswine, moves: [] })
    const plain = ok(calcDamage(MC, iceShard, incineroar, 'iceshard'))
    const lefties = ok(calcDamage(MC, iceShard, { ...incineroar, item: 'leftovers' }, 'iceshard'))
    expect(lefties).toEqual(plain)
    expect(lefties.ohkoChance).toBe(0)
  })

  it('변화기·면역·정상 대미지는 다른 종류이고 예외로 끝나지 않는다', () => {
    expect(calcDamage(MC, kingambit, delphoxMega, 'swordsdance')).toEqual({ kind: 'status' })
    // 메가마폭시는 메가 폼 특성 부유로 땅 기술에 면역(원종 특성 맹화로는 면역이 아니다)
    expect(calcDamage(MC, mamoswine, delphoxMega, 'earthquake')).toEqual({ kind: 'immune' })
    expect(calcDamage(MC, mamoswine, { ...delphoxMega, mega: false, item: undefined }, 'earthquake').kind).toBe('damage')
    const gengar = Object.values(MC.data.species).find((s) => s.id === 'gengar')!
    expect(calcDamage(MC, kingambit, mkSet({ species: 'gengar', ability: gengar.abilities[0] }), 'facade')).toEqual({ kind: 'immune' })
    expect(calcDamage(MC, kingambit, delphoxMega, 'suckerpunch').kind).toBe('damage')
  })

  it('총대장은 쓰러진 아군 수에 따라 달라지고 0명이면 176~210', () => {
    const so = { ...kingambit, ability: 'supremeoverlord', nature: 'adamant' }
    const r0 = ok(calcDamage(MC, so, delphoxMega, 'suckerpunch'))
    expect(r0.rolls).toEqual([[176, 180, 180, 182, 186, 188, 188, 192, 194, 194, 198, 200, 200, 204, 206, 210]])
    const maxes = [1, 3, 5].map((n) => ok(calcDamage(MC, so, delphoxMega, 'suckerpunch', { attacker: { alliesFainted: n } })).max)
    expect(maxes).toEqual([...maxes].sort((a, b) => a - b))
    expect(maxes[0]).toBeGreaterThan(210)
    expect(() => calcDamage(MC, so, delphoxMega, 'suckerpunch', { attacker: { alliesFainted: 6 } })).toThrow(CoreInputError)
  })

  it('레귤레이션·대전 형식을 생략하면 M-C·더블로 계산된다', () => {
    const def = loadSnapshotSync()
    expect(def.manifest.regulation.id).toBe('m-c')
    const implicit = calcDamage(def, mamoswine, incineroar, 'earthquake')
    expect(implicit).toEqual(calcDamage(MC, mamoswine, incineroar, 'earthquake', { gameType: 'Doubles' }))
  })
})

describe('조건 배율(끈 값 × 배율 ±1)', () => {
  // 자속·상성 배율이 반올림 오차를 키우지 않도록 비자속·등배 단일 대상 기술로 고정한다(반감열매만 효과가 굉장함).
  const garchomp = mkSet({ species: 'garchomp', ability: 'roughskin', nature: 'adamant', sp: { atk: 32 } })
  const absol = mkSet({ species: 'absol', ability: 'pressure', nature: 'modest', sp: { spa: 32 } })
  const dragonite = mkSet({ species: 'dragonite', ability: 'innerfocus', sp: { hp: 32 } })
  const ampharos = mkSet({ species: 'ampharos', ability: 'static', sp: { hp: 32 } })
  const kingambitDef = mkSet({ species: 'kingambit', ability: 'defiant', sp: { hp: 32 } })

  const within1 = (r0: DamageResultOk, r1: DamageResultOk, factor: number) => {
    expect(Math.abs(r1.min - r0.min * factor)).toBeLessThanOrEqual(1)
    expect(Math.abs(r1.max - r0.max * factor)).toBeLessThanOrEqual(1)
  }

  const cases: [string, PokemonSet, PokemonSet, string, number, BattleConditions][] = [
    ['프렌드가드 0.75', garchomp, dragonite, 'ironhead', 0.75, { defender: { friendGuard: true } }],
    ['더블 리플렉터(물리) 2732/4096', garchomp, dragonite, 'ironhead', 2732 / 4096, { defender: { reflect: true } }],
    ['더블 빛의장막(특수) 2732/4096', absol, dragonite, 'shadowball', 2732 / 4096, { defender: { lightScreen: true } }],
    ['급소 1.5', garchomp, dragonite, 'ironhead', 1.5, { critical: true }],
    ['쾌청 불꽃 1.5', absol, ampharos, 'flamethrower', 1.5, { weather: 'Sun' }],
    ['일렉트릭필드 접지 공격자 전기 1.3', absol, kingambitDef, 'thunderbolt', 1.3, { terrain: 'Electric' }],
  ]
  it.each(cases)('%s', (_, a, d, move, factor, on) => {
    within1(ok(calcDamage(MC, a, d, move)), ok(calcDamage(MC, a, d, move, on)), factor)
  })

  const setCases: [string, PokemonSet, PokemonSet, string, number, Partial<PokemonSet>, Partial<PokemonSet>][] = [
    ['공격측 화상(물리) 0.5', garchomp, dragonite, 'ironhead', 0.5, { status: 'brn' }, {}],
    ['방어 랭크 +1 2/3', garchomp, dragonite, 'ironhead', 2 / 3, {}, { boosts: { def: 1 } }],
    ['공격측 생명의구슬 5324/4096', garchomp, dragonite, 'ironhead', 5324 / 4096, { item: 'lifeorb' }, {}],
    ['방어측 효과가 굉장한 타입의 반감열매 0.5', absol, kingambitDef, 'flamethrower', 0.5, {}, { item: 'occaberry' }],
  ]
  it.each(setCases)('%s', (_, a, d, move, factor, aOn, dOn) => {
    within1(ok(calcDamage(MC, a, d, move)), ok(calcDamage(MC, { ...a, ...aOn }, { ...d, ...dOn }, move)), factor)
  })

  // 위력·공격 단계 보정은 기본 대미지 식의 +2가 배율을 받지 않아 최대 1.5까지 벗어난다(PRD ±1 기준 충돌, 보고 사항).
  // 그래서 같은 효과를 위력·실능치로 옮긴 합성 스냅샷과 정확히 같은지로 확인하고, 배율은 ±2로 본다.
  it('도우미 1.5 = 위력 pokeRound(×6144/4096)로 바꾼 기술', () => {
    const off = ok(calcDamage(MC, garchomp, dragonite, 'ironhead'))
    const on = ok(calcDamage(MC, garchomp, dragonite, 'ironhead', { attacker: { helpingHand: true } }))
    const snap = cloneSnapshot(MC)
    snap.data.moves.ironhead.basePower = Math.round((MC.data.moves.ironhead.basePower * 6144) / 4096)
    expect(on.rolls).toEqual(ok(calcDamage(snap, garchomp, dragonite, 'ironhead')).rolls)
    expect(Math.abs(on.max - off.max * 1.5)).toBeLessThanOrEqual(2)
  })

  it('공격 랭크 +1 1.5 = 공격 실능 ⌊×3/2⌋인 세트', () => {
    const hardy = { ...garchomp, nature: 'hardy' }
    const off = ok(calcDamage(MC, hardy, dragonite, 'ironhead'))
    const on = ok(calcDamage(MC, { ...hardy, boosts: { atk: 1 } }, dragonite, 'ironhead'))
    const atk = MC.data.species.garchomp.baseStats.atk + 32 + 20
    const snap = cloneSnapshot(MC)
    snap.data.species.garchomp.baseStats.atk = Math.floor((atk * 3) / 2) - 32 - 20
    expect(on.rolls).toEqual(ok(calcDamage(snap, hardy, dragonite, 'ironhead')).rolls)
    expect(Math.abs(on.max - off.max * 1.5)).toBeLessThanOrEqual(2)
  })
})

describe('연속기 타수(ADR 결정 3)', () => {
  const lucario = mkSet({ species: 'lucario', ability: 'innerfocus', nature: 'adamant', sp: { atk: 32 } })
  const target = mkSet({ species: 'incineroar', ability: 'blaze', sp: { hp: 32 } })

  it('2~5회 기술 기본 3타, conditions.hits로 지정, 범위 밖·비가변 기술 지정은 거부', () => {
    const r3 = ok(calcDamage(MC, lucario, target, 'bonerush'))
    expect(r3.hits).toBe(3)
    expect(r3.rolls).toHaveLength(3)
    expect(ok(calcDamage(MC, lucario, target, 'bonerush', { hits: 5 })).hits).toBe(5)
    expect(() => calcDamage(MC, lucario, target, 'bonerush', { hits: 6 })).toThrow(CoreInputError)
    expect(() => calcDamage(MC, lucario, target, 'bonerush', { hits: 1 })).toThrow(CoreInputError)
    expect(() => calcDamage(MC, lucario, target, 'closecombat', { hits: 2 })).toThrow(CoreInputError)
    expect(() => calcDamage(MC, lucario, target, 'bonerush', { hits: 2.5 })).toThrow(CoreInputError)
  })

  it('Skill Link는 5타, Population Bomb은 10타, 부모의 사랑은 2타로 결과에 나온다', () => {
    const toucannon = mkSet({ species: 'toucannon', ability: 'skilllink', sp: { atk: 32 } })
    expect(ok(calcDamage(MC, toucannon, target, 'bulletseed')).hits).toBe(5)
    expect(ok(calcDamage(MC, { ...toucannon, ability: 'keeneye' }, target, 'bulletseed')).hits).toBe(3)
    const maushold = mkSet({ species: 'maushold', ability: 'friendguard', sp: { atk: 32 } })
    const pb = ok(calcDamage(MC, maushold, target, 'populationbomb'))
    expect(pb.hits).toBe(10)
    expect(pb.min).toBe(pb.rolls.reduce((a, h) => a + h[0], 0))
    const kanga = mkSet({ species: 'kangaskhan', ability: 'scrappy', item: 'kangaskhanite', mega: true, sp: { atk: 32 } })
    const pbond = ok(calcDamage(MC, kanga, target, 'facade'))
    expect(pbond.hits).toBe(2)
    expect(pbond.attackerAbility).toBe('parentalbond')
  })
})

describe('스냅샷 수치 주입(PRD F6, ADR 결정 2)', () => {
  const lucario = mkSet({ species: 'lucario', ability: 'innerfocus', nature: 'adamant', sp: { atk: 32 } })
  const target = mkSet({ species: 'incineroar', ability: 'blaze', sp: { hp: 32 } })

  it('챔피언스 기술 수치: 본러시 30, 대단한 첫걸음 100이 스냅샷과 계산 모두에 쓰인다', () => {
    expect(MC.data.moves.bonerush.basePower).toBe(30)
    expect(MC.data.moves.firstimpression.basePower).toBe(100)
    const at25 = cloneSnapshot(MC)
    at25.data.moves.bonerush.basePower = 25
    const real = ok(calcDamage(MC, lucario, target, 'bonerush'))
    const old = ok(calcDamage(at25, lucario, target, 'bonerush'))
    expect(real.max).toBeGreaterThan(old.max)
    const fi = ok(calcDamage(MC, mkSet({ species: 'golisopod', ability: 'emergencyexit', sp: { atk: 32 } }), target, 'firstimpression'))
    const at90 = cloneSnapshot(MC)
    at90.data.moves.firstimpression.basePower = 90
    const fi90 = ok(calcDamage(at90, mkSet({ species: 'golisopod', ability: 'emergencyexit', sp: { atk: 32 } }, at90), target, 'firstimpression'))
    expect(fi.max).toBeGreaterThan(fi90.max)
  })

  it('종족값·타입을 바꾼 합성 스냅샷의 값이 계산에 쓰인다(엔진 내부 clone 이후에도 유지)', () => {
    const snap = cloneSnapshot(MC)
    snap.data.species.incineroar.types = ['Water']
    // 불꽃/악 → 물 단타입: 지진 2배 → 1배
    const real = ok(calcDamage(MC, mamoswine, incineroar, 'earthquake', { gameType: 'Singles' }))
    const water = ok(calcDamage(snap, mamoswine, incineroar, 'earthquake', { gameType: 'Singles' }))
    expect(water.max).toBe(Math.floor(real.max / 2))
    snap.data.species.mamoswine.baseStats = { ...snap.data.species.mamoswine.baseStats, atk: 30 }
    expect(ok(calcDamage(snap, mamoswine, incineroar, 'earthquake', { gameType: 'Singles' })).max).toBeLessThan(water.max)
  })

  it('엔진 데이터가 깨진 기술 11개도 스냅샷 수치(타입·분류·위력·타수)로 대미지가 나온다', () => {
    const broken = ['anchorshot', 'astralbarrage', 'bloodmoon', 'boltbeak', 'dragonhammer', 'fishiousrend', 'geargrind', 'hyperdrill', 'metalclaw', 'revelationdance', 'tripledive']
    // 0.10.13 champions에서 Past라 M-C 스냅샷에 없다. 9세대 수치를 넣은 합성 스냅샷으로 래퍼의 주입 경로를 확인한다.
    const snap = cloneSnapshot(MC)
    const dex = Dex.forGen(9)
    for (const id of broken) {
      expect(MC.data.moves[id]).toBeUndefined()
      const m = dex.moves.get(id)
      const entry: MoveEntry = {
        id,
        name: { en: m.name, ko: m.name, koSource: 'fallback' },
        type: m.type,
        category: m.category,
        basePower: m.basePower,
        accuracy: m.accuracy,
        priority: m.priority,
        target: m.target,
        flags: Object.keys(m.flags).sort(),
      }
      if (m.multihit !== undefined) entry.multihit = m.multihit as MoveEntry['multihit']
      snap.data.moves[id] = entry
      snap.data.species.kingambit.learnset.push(id)
    }
    const def = mkSet({ species: 'kingambit', ability: 'defiant', sp: { hp: 32 } })
    for (const id of broken) {
      const r = ok(calcDamage(snap, kingambit, def, id))
      expect(r.max, id).toBeGreaterThan(0)
      expect(r.hits, id).toBe(typeof snap.data.moves[id].multihit === 'number' ? snap.data.moves[id].multihit : 1)
    }
    // 앵커샷(강철·물리·80) = 같은 수치로 덮어쓴 아이언헤드
    const asIronHead = cloneSnapshot(snap)
    Object.assign(asIronHead.data.moves.ironhead, { basePower: 80, type: 'Steel', category: 'Physical' })
    expect(ok(calcDamage(snap, kingambit, def, 'anchorshot')).rolls).toEqual(ok(calcDamage(asIronHead, kingambit, def, 'ironhead')).rolls)
  })
})

describe('메가 폼 특성 반영(ADR 결정 2)', () => {
  const target = mkSet({ species: 'dragonite', ability: 'innerfocus', sp: { hp: 32 } })
  /** 메가 폼 특성을 효과 없는 특성으로 바꾸고, 필요하면 기술 위력을 위력 보정만큼 올린 합성 스냅샷 */
  const neutralized = (forme: string, ability: string, move?: string, bpMod?: number) => {
    const s = cloneSnapshot(MC)
    s.data.species[forme].abilities = [ability]
    if (move && bpMod) {
      const bp = (MC.data.moves[move].basePower * bpMod) / 4096
      s.data.moves[move].basePower = bp % 1 > 0.5 ? Math.ceil(bp) : Math.floor(bp)
    }
    return s
  }

  it('단단한발톱(메가갑주무사)은 접촉기에만 위력 5325/4096', () => {
    const golisopod = mkSet({ species: 'golisopod', ability: 'emergencyexit', item: 'golisopite', mega: true, sp: { atk: 32 } })
    const tc = ok(calcDamage(MC, golisopod, target, 'liquidation'))
    expect([tc.attackerAbility, tc.attackerSetAbility]).toEqual(['toughclaws', 'emergencyexit'])
    const boosted = neutralized('golisopodmega', 'emergencyexit', 'liquidation', 5325)
    expect(tc.rolls).toEqual(ok(calcDamage(boosted, golisopod, target, 'liquidation')).rolls)
    expect(tc.max).toBeGreaterThan(ok(calcDamage(neutralized('golisopodmega', 'emergencyexit'), golisopod, target, 'liquidation')).max)
    const plain = neutralized('golisopodmega', 'emergencyexit')
    expect(ok(calcDamage(MC, golisopod, target, 'rockslide')).rolls).toEqual(ok(calcDamage(plain, golisopod, target, 'rockslide')).rolls)
  })

  it('예리함(메가앱솔Z)은 베기 기술에만 위력 1.5배', () => {
    const absol = mkSet({ species: 'absol', ability: 'pressure', item: 'absolitez', mega: true, sp: { atk: 32 } })
    const sh = ok(calcDamage(MC, absol, target, 'psychocut'))
    expect(sh.attackerAbility).toBe('sharpness')
    expect(sh.rolls).toEqual(ok(calcDamage(neutralized('absolmegaz', 'pressure', 'psychocut', 6144), absol, target, 'psychocut')).rolls)
    const plain = neutralized('absolmegaz', 'pressure')
    expect(sh.max).toBeGreaterThan(ok(calcDamage(plain, absol, target, 'psychocut')).max)
    expect(ok(calcDamage(MC, absol, target, 'knockoff')).rolls).toEqual(ok(calcDamage(plain, absol, target, 'knockoff')).rolls)
  })
})

describe('입력 경계', () => {
  it('대전 조건의 알 수 없는 키·값·타입은 CoreInputError', () => {
    const bad: unknown[] = [
      { gameType: 'Triples' },
      { weather: 'Hail' },
      { terrain: 'Grass' },
      { spreadTargets: 3 },
      { critical: 'yes' },
      { attacker: { tailwnd: true } },
      { attacker: { alliesFainted: Number.NaN } },
      { trickRoom: true },
      { hits: Number.POSITIVE_INFINITY },
    ]
    for (const c of bad) expect(() => calcDamage(MC, mamoswine, incineroar, 'earthquake', c as BattleConditions)).toThrow(CoreInputError)
  })

  it('계산 대상 기술도 공격 세트의 learnset으로 검증한다', () => {
    expect(() => calcDamage(MC, mamoswine, incineroar, 'flamethrower')).toThrow()
    expect(() => calcDamage(MC, mamoswine, incineroar, 'nope')).toThrow()
  })

  it('입력 객체를 바꾸지 않는다', () => {
    const a = structuredClone(mamoswine)
    const d = structuredClone(incineroar)
    const c: BattleConditions = { attacker: { helpingHand: true } }
    calcDamage(MC, a, d, 'earthquake', c)
    expect([a, d, c]).toEqual([mamoswine, incineroar, { attacker: { helpingHand: true } }])
  })
})
