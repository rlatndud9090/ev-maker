// PRD 수용 기준: 대미지. 기대값은 PRD 문구·notes 손계산과 oracle.ts 독립 산술에서 온다.
import { describe, expect, it } from 'vitest'
import { MC, mkSet } from '../core/testing'
import { loadSnapshotSync } from '../data/testing'
import { loadSnapshot } from '../data/loader'
import {
  attackBand,
  calcDamage,
  computeStats,
  defenseBand,
  type BattleConditions,
  type DamageResult,
  type DamageResultOk,
  type PokemonSet,
} from '../core/index'
import { oracleOhko, oracleRolls } from './oracle'

const ok = (r: DamageResult): DamageResultOk => {
  if (r.kind !== 'damage') throw new Error(`대미지 결과가 아니다: ${r.kind}`)
  return r
}

const kingambit = mkSet({ species: 'kingambit', ability: 'defiant', sp: { atk: 32 } })
const delphoxMega = mkSet({ species: 'delphox', ability: 'blaze', item: 'delphoxite', mega: true, sp: { hp: 2 } })
const mamoswine = mkSet({ species: 'mamoswine', ability: 'oblivious', nature: 'adamant', sp: { atk: 32 } })
const incineroar = mkSet({ species: 'incineroar', ability: 'blaze', nature: 'careful', sp: { hp: 32, def: 2 } })

describe('수용 기준: 대미지', () => {
  it('AC-D1 대도각참 기습 → 메가마폭시: 16개 값, 106.5~126.3%, 1타 100%, 확정 1타 / 중난수 이상, 손계산과 일치', () => {
    const r = ok(calcDamage(MC, kingambit, delphoxMega, 'suckerpunch'))
    const prd = [162, 164, 164, 168, 168, 170, 174, 174, 176, 180, 180, 182, 186, 186, 188, 192]
    expect(r.rolls).toEqual([prd])
    expect(r.defenderHp).toBe(152)
    // PRD 비율은 엔진식 소수 첫째 자리 내림
    expect(Math.floor(r.minPercent * 10) / 10).toBe(106.5)
    expect(Math.floor(r.maxPercent * 10) / 10).toBe(126.3)
    expect(r.ohkoChance).toBe(1)
    expect(r.attackBand).toBe('guaranteed-ohko')
    expect(r.defenseBand).toBe('mid-or-higher')
    // 독립 출처: notes "조사 결과" 손계산(기본 64 → 162~192). 실능치도 독립 산술로 구한다.
    const atk = computeStats(MC, kingambit).atk
    const def = computeStats(MC, delphoxMega).def
    expect([atk, def]).toEqual([187, 92])
    expect(oracleRolls({ power: 70, attack: atk, defense: def, stab: true, effectiveness: 2 })).toEqual(prd)
  })

  it('AC-D2 지진: 싱글 204~240 확정 1타, 더블 152~180 1타 0%(중난수 이하 / 확정 버팀), 더블 대상 수 1 = 싱글', () => {
    const single = ok(calcDamage(MC, mamoswine, incineroar, 'earthquake', { gameType: 'Singles' }))
    const double = ok(calcDamage(MC, mamoswine, incineroar, 'earthquake', { gameType: 'Doubles' }))
    const one = ok(calcDamage(MC, mamoswine, incineroar, 'earthquake', { gameType: 'Doubles', spreadTargets: 1 }))
    expect([single.min, single.max, single.ohkoChance, single.attackBand]).toEqual([204, 240, 1, 'guaranteed-ohko'])
    expect([double.min, double.max, double.ohkoChance]).toEqual([152, 180, 0])
    expect([double.attackBand, double.defenseBand]).toEqual(['mid-or-lower', 'guaranteed-survive'])
    expect(one.rolls).toEqual(single.rolls)
    const io = { power: 100, attack: 200, defense: computeStats(MC, incineroar).def, stab: true, effectiveness: 2 }
    expect(single.rolls[0]).toEqual(oracleRolls(io))
    expect(double.rolls[0]).toEqual(oracleRolls({ ...io, spread: true }))
  })

  it('AC-D3 1타 확률 = 16개 난수 중 방어측 HP 이상 개수 ÷ 16(독립 계수)', () => {
    const pairs: [PokemonSet, PokemonSet, string][] = []
    for (let atk = 0; atk <= 32; atk += 4) pairs.push([{ ...kingambit, sp: { ...kingambit.sp, atk } }, delphoxMega, 'suckerpunch'])
    for (let hp = 0; hp <= 32; hp += 4) pairs.push([mamoswine, { ...incineroar, sp: { ...incineroar.sp, hp } }, 'earthquake'])
    const seen = new Set<number>()
    for (const [a, d, m] of pairs) {
      for (const gameType of ['Singles', 'Doubles'] as const) {
        const r = ok(calcDamage(MC, a, d, m, { gameType }))
        expect(r.hits).toBe(1)
        expect(r.ohkoChance).toBe(oracleOhko(r.rolls[0], r.defenderHp))
        seen.add(r.ohkoChance)
      }
    }
    // 0·1만이 아니라 중간 확률도 대조했다
    expect([...seen].some((p) => p > 0 && p < 1)).toBe(true)
  })

  describe('AC-D4 구간 판정 사례표', () => {
    const table: [number, string, string][] = [
      [0, 'mid-or-lower', 'guaranteed-survive'],
      [2 / 16, 'mid-or-lower', 'low-roll-ohko'],
      [3 / 16, 'mid-or-lower', 'low-roll-ohko'],
      [4 / 16, 'mid-or-lower', 'mid-or-higher'],
      [11 / 16, 'mid-or-lower', 'mid-or-higher'],
      [12 / 16, 'high-roll-ohko', 'mid-or-higher'],
      [15 / 16, 'high-roll-ohko', 'mid-or-higher'],
      [1, 'guaranteed-ohko', 'mid-or-higher'],
    ]
    it.each(table)('1타 확률 %s → 공격 %s / 방어 %s', (p, a, d) => {
      expect(attackBand(p)).toBe(a)
      expect(defenseBand(p)).toBe(d)
    })

    it('실제 대면 결과의 구간도 같은 표를 따른다(대도각참 공격 SP 0·10·13·19)', () => {
      const at = (atk: number) => ok(calcDamage(MC, { ...kingambit, sp: { ...kingambit.sp, atk } }, delphoxMega, 'suckerpunch'))
      // notes 독립 기준값 a): SP0 4/16, SP10 11/16, SP13 13/16, SP19 16/16
      expect([at(0).ohkoChance, at(0).attackBand, at(0).defenseBand]).toEqual([4 / 16, 'mid-or-lower', 'mid-or-higher'])
      expect([at(10).ohkoChance, at(10).attackBand]).toEqual([11 / 16, 'mid-or-lower'])
      expect([at(13).ohkoChance, at(13).attackBand]).toEqual([13 / 16, 'high-roll-ohko'])
      expect([at(19).ohkoChance, at(19).attackBand]).toEqual([1, 'guaranteed-ohko'])
    })

    it('구간 경계값을 바꾸면(고난수 62.5%) 판정이 바뀐 기준을 따른다', () => {
      expect(attackBand(11 / 16, { highRoll: 0.625 })).toBe('high-roll-ohko')
      expect(attackBand(9 / 16, { highRoll: 0.625 })).toBe('mid-or-lower')
      expect(defenseBand(4 / 16, { lowRoll: 0.25 })).toBe('low-roll-ohko')
      const sp10 = { ...kingambit, sp: { ...kingambit.sp, atk: 10 } }
      expect(ok(calcDamage(MC, sp10, delphoxMega, 'suckerpunch')).attackBand).toBe('mid-or-lower')
      expect(ok(calcDamage(MC, sp10, delphoxMega, 'suckerpunch', undefined, { highRoll: 0.625 })).attackBand).toBe('high-roll-ohko')
    })
  })

  it('AC-D5 멀티스케일 망나뇽(HP 가득)은 특성이 없을 때의 절반 분포이고 1타 확률도 그에 따른다', () => {
    const dragonite = (ability: string) => mkSet({ species: 'dragonite', ability, sp: { hp: 32 } })
    const plain = ok(calcDamage(MC, mamoswine, dragonite('innerfocus'), 'iciclecrash'))
    const ms = ok(calcDamage(MC, mamoswine, dragonite('multiscale'), 'iciclecrash'))
    const io = { power: 85, attack: 200, defense: computeStats(MC, dragonite('innerfocus')).def, stab: true, effectiveness: 4 }
    expect(plain.rolls[0]).toEqual(oracleRolls(io))
    expect(ms.rolls[0]).toEqual(oracleRolls({ ...io, finalMod: 2048 }))
    expect(ms.ohkoChance).toBe(oracleOhko(ms.rolls[0], 198))
    expect([plain.ohkoChance, ms.ohkoChance]).toEqual([1, 2 / 16])
    // HP가 가득이 아니면 반감되지 않는다
    const hurt = ok(calcDamage(MC, mamoswine, { ...dragonite('multiscale'), curHp: 197 }, 'iciclecrash'))
    expect(hurt.rolls).toEqual(plain.rolls)
  })

  it('AC-D6 연속기는 몇 회로 계산했는지 결과에 나온다', () => {
    const salamence = mkSet({ species: 'salamence', ability: 'intimidate', nature: 'adamant', sp: { atk: 32 } })
    const rillaboom = mkSet({ species: 'rillaboom', ability: 'overgrow', sp: { hp: 2 } })
    const dual = ok(calcDamage(MC, salamence, rillaboom, 'dualwingbeat'))
    expect(dual.hits).toBe(2)
    expect(dual.rolls).toHaveLength(2)
    const lucario = mkSet({ species: 'lucario', ability: 'innerfocus', sp: { atk: 32 } })
    const absol = mkSet({ species: 'absol', ability: 'pressure' })
    for (const hits of [2, 3, 4, 5]) {
      const r = ok(calcDamage(MC, lucario, absol, 'bonerush', { hits }))
      expect([r.hits, r.rolls.length]).toEqual([hits, hits])
    }
    expect(ok(calcDamage(MC, lucario, absol, 'bonerush')).hits).toBeGreaterThanOrEqual(2)
  })

  it('AC-D7 방어측 먹다남은음식 세트도 판정이 비지 않고 도구 없음과 같은 순수 대미지 판정', () => {
    const none = ok(calcDamage(MC, mamoswine, incineroar, 'iceshard'))
    const lefties = ok(calcDamage(MC, mamoswine, { ...incineroar, item: 'leftovers' }, 'iceshard'))
    expect(lefties).toEqual(none)
    expect(typeof lefties.ohkoChance).toBe('number')
    expect(lefties.attackBand).toBeTruthy()
    expect(lefties.defenseBand).toBeTruthy()
  })

  it('AC-D8 변화기·면역 대면·정상 대미지는 서로 다른 종류의 결과이고 예외로 끝나지 않는다', () => {
    const garchomp = mkSet({ species: 'garchomp', ability: 'roughskin', sp: { atk: 32 } })
    expect(calcDamage(MC, garchomp, incineroar, 'protect')).toEqual({ kind: 'status' })
    // 메가마폭시는 부유라 지진이 듣지 않는다
    expect(calcDamage(MC, garchomp, delphoxMega, 'earthquake')).toEqual({ kind: 'immune' })
    expect(calcDamage(MC, garchomp, incineroar, 'earthquake').kind).toBe('damage')
  })

  describe('AC-D9 대전 조건 배율: 최소·최대가 각각 "끈 값 × 배율" ±1 이내', () => {
    // 고정 대면: 비자속·등배(강철 → 악) 물리, 비자속·등배(불꽃·전기 → 악) 특수. 반감열매만 효과가 굉장한 대면.
    const garchomp = mkSet({ species: 'garchomp', ability: 'roughskin', nature: 'adamant', sp: { atk: 32 } })
    const absolAtk = mkSet({ species: 'absol', ability: 'pressure', nature: 'modest', sp: { spa: 32 } })
    const absolDef = mkSet({ species: 'absol', ability: 'pressure', sp: { hp: 32 } })
    const kingambitDef = mkSet({ species: 'kingambit', ability: 'defiant', sp: { hp: 32 } })
    type Case = [string, PokemonSet, PokemonSet, string, number, BattleConditions, Partial<PokemonSet>, Partial<PokemonSet>]
    const cases: Case[] = [
      ['도우미 1.5', garchomp, absolDef, 'ironhead', 1.5, { attacker: { helpingHand: true } }, {}, {}],
      ['프렌드가드 0.75', garchomp, absolDef, 'ironhead', 0.75, { defender: { friendGuard: true } }, {}, {}],
      ['더블 리플렉터(물리) 2732/4096', garchomp, absolDef, 'ironhead', 2732 / 4096, { defender: { reflect: true } }, {}, {}],
      ['더블 빛의장막(특수) 2732/4096', absolAtk, absolDef, 'thunderbolt', 2732 / 4096, { defender: { lightScreen: true } }, {}, {}],
      ['급소 1.5', garchomp, absolDef, 'ironhead', 1.5, { critical: true }, {}, {}],
      ['공격측 화상(물리) 0.5', garchomp, absolDef, 'ironhead', 0.5, {}, { status: 'brn' }, {}],
      ['쾌청 불꽃 기술 1.5', absolAtk, absolDef, 'flamethrower', 1.5, { weather: 'Sun' }, {}, {}],
      ['일렉트릭필드 땅에 있는 공격자의 전기 기술 1.3', absolAtk, absolDef, 'thunderbolt', 1.3, { terrain: 'Electric' }, {}, {}],
      ['공격 랭크 +1 1.5', garchomp, absolDef, 'ironhead', 1.5, {}, { boosts: { atk: 1 } }, {}],
      ['방어 랭크 +1 2/3', garchomp, absolDef, 'ironhead', 2 / 3, {}, {}, { boosts: { def: 1 } }],
      ['공격측 생명의구슬 5324/4096', garchomp, absolDef, 'ironhead', 5324 / 4096, {}, { item: 'lifeorb' }, {}],
      ['방어측 효과가 굉장한 타입의 반감열매 0.5', absolAtk, kingambitDef, 'flamethrower', 0.5, {}, {}, { item: 'occaberry' }],
    ]
    it.each(cases)('%s', (_, a, d, move, factor, on, aOn, dOn) => {
      const off = ok(calcDamage(MC, a, d, move))
      const r = ok(calcDamage(MC, { ...a, ...aOn }, { ...d, ...dOn }, move, on))
      expect(r.min).not.toBe(off.min)
      expect(Math.abs(r.min - off.min * factor)).toBeLessThanOrEqual(1)
      expect(Math.abs(r.max - off.max * factor)).toBeLessThanOrEqual(1)
    })
  })

  it('AC-D10 총대장은 쓰러진 아군 수에 따라 달라지고 0명이면 176~210(고집, 공격 SP32, 기습 → 메가마폭시)', () => {
    const so = mkSet({ species: 'kingambit', ability: 'supremeoverlord', nature: 'adamant', sp: { atk: 32 } })
    const at = (n: number) => ok(calcDamage(MC, so, delphoxMega, 'suckerpunch', { attacker: { alliesFainted: n } }))
    const zero = at(0)
    expect([zero.min, zero.max]).toEqual([176, 210])
    expect(zero.rolls[0]).toEqual([176, 180, 180, 182, 186, 188, 188, 192, 194, 194, 198, 200, 200, 204, 206, 210])
    expect(ok(calcDamage(MC, so, delphoxMega, 'suckerpunch')).rolls).toEqual(zero.rolls)
    let prev = zero.max
    for (const n of [1, 2, 3, 4, 5]) {
      const r = at(n)
      expect(r.max, `${n}명`).toBeGreaterThan(prev)
      prev = r.max
    }
  })

  it('AC-D11 레귤레이션·대전 형식을 지정하지 않으면 M-C·더블로 계산된다(직접 지정과 같다)', async () => {
    const def = loadSnapshotSync()
    expect(def.manifest.regulation.id).toBe('m-c')
    const lazy = await loadSnapshot()
    expect(lazy.manifest.regulation.id).toBe('m-c')
    const implicit = calcDamage(lazy, mamoswine, incineroar, 'earthquake')
    expect(implicit).toEqual(calcDamage(MC, mamoswine, incineroar, 'earthquake', { gameType: 'Doubles' }))
    expect(implicit).not.toEqual(calcDamage(MC, mamoswine, incineroar, 'earthquake', { gameType: 'Singles' }))
  })
})
