// PRD 수용 기준: 실능치·SP, 입력 검증·메가
import { describe, expect, it } from 'vitest'
import { MB, MC, mkSet } from '../core/testing'
import { CoreError, calcDamage, computeStats, spNoGainCells, statValue, validateSet, type PokemonSet } from '../core/index'
import { oracleStat } from './oracle'

const errorsOf = (fn: () => unknown) => {
  try {
    fn()
  } catch (e) {
    if (!(e instanceof CoreError)) throw e
    return e.details.map(({ code, field }) => ({ code, field }))
  }
  throw new Error('CoreError가 나지 않았다')
}
const reasonOf = (fn: () => unknown) => {
  try {
    fn()
  } catch (e) {
    expect(e).toBeInstanceOf(CoreError)
    return (e as CoreError).details
  }
  throw new Error('CoreError가 나지 않았다')
}

const mamo = (sp: Partial<PokemonSet['sp']>) => mkSet({ species: 'mamoswine', ability: 'oblivious', nature: 'adamant', sp })
const kingambit = (over: Partial<PokemonSet> = {}) =>
  ({ ...mkSet({ species: 'kingambit', ability: 'defiant', moves: ['suckerpunch'] }), ...over }) as PokemonSet

describe('수용 기준: 실능치·SP', () => {
  it('AC-S1 고집 맘모꾸리 공격 SP32 = 200, 겁쟁이 플라엣테(영원의 꽃) 스피드 SP32 = 158, 맘모꾸리 HP SP0 = 185·SP32 = 217', () => {
    expect(computeStats(MC, mamo({ atk: 32 })).atk).toBe(200)
    expect(computeStats(MC, mamo({})).hp).toBe(185)
    expect(computeStats(MC, mamo({ hp: 32 })).hp).toBe(217)
    const floette = mkSet({ species: 'floetteeternal', ability: 'flowerveil', nature: 'timid', sp: { spe: 32 } })
    expect(computeStats(MC, floette).spe).toBe(158)
    // 독립 산술과도 같다
    const b = MC.data.species.mamoswine.baseStats
    expect(oracleStat('other', b.atk, 32, 11)).toBe(200)
    expect(oracleStat('hp', b.hp, 0)).toBe(185)
    expect(oracleStat('other', MC.data.species.floetteeternal.baseStats.spe, 32, 11)).toBe(158)
  })

  it('AC-S2 하락 성격·종족값 100 능력치는 SP0과 SP1이 모두 108이고 "올라가지 않는 칸"으로 판별된다', () => {
    const s = Object.values(MC.data.species).find((x) => !x.isMega && x.baseStats.def === 100)
    expect(s, '방어 종족값 100인 종').toBeDefined()
    // lonely = 공격↑ 방어↓
    expect(MC.data.natures.lonely).toMatchObject({ plus: 'atk', minus: 'def' })
    const set = (def: number) => mkSet({ species: s!.id, ability: s!.abilities[0], nature: 'lonely', sp: { def } })
    expect(computeStats(MC, set(0)).def).toBe(108)
    expect(computeStats(MC, set(1)).def).toBe(108)
    expect(spNoGainCells(MC, set(0)).def).toContain(1)
    expect(spNoGainCells(MC, set(0)).hp).not.toContain(1)
  })

  it('AC-S3 종족값 HP 1이면 SP와 상관없이 HP 실능치 1(공식 단위)', () => {
    for (let sp = 0; sp <= 32; sp++) expect(statValue('hp', 1, sp)).toBe(1)
  })

  it('AC-S4 SP 33·음수·소수·합계 67 이상은 거부되고 위반한 능력치가 오류에 나온다', () => {
    const sp = (p: Partial<PokemonSet['sp']>) => kingambit({ sp: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...p } })
    expect(errorsOf(() => validateSet(MC, sp({ atk: 33 })))).toEqual([{ code: 'INVALID_SP', field: 'sp.atk' }])
    expect(errorsOf(() => validateSet(MC, sp({ spe: -1 })))).toEqual([{ code: 'INVALID_SP', field: 'sp.spe' }])
    expect(errorsOf(() => validateSet(MC, sp({ def: 1.5 })))).toEqual([{ code: 'INVALID_SP', field: 'sp.def' }])
    expect(errorsOf(() => validateSet(MC, sp({ hp: Number.NaN })))).toEqual([{ code: 'INVALID_SP', field: 'sp.hp' }])
    expect(errorsOf(() => validateSet(MC, sp({ hp: 32, atk: 32, def: 3 })))).toEqual([{ code: 'SP_TOTAL_EXCEEDED', field: 'sp' }])
    expect(() => validateSet(MC, sp({ hp: 32, atk: 32, def: 2 }))).not.toThrow()
    expect(() => calcDamage(MC, sp({ atk: 33 }), kingambit(), 'suckerpunch')).toThrow(CoreError)
  })
})

describe('수용 기준: 입력 검증·메가', () => {
  it('AC-V1 M-C 세트에 구애머리띠·구애안경·돌격조끼·부스트에너지를 지정하면 계산이 거부된다', () => {
    for (const item of ['choiceband', 'choicespecs', 'assaultvest', 'boosterenergy']) {
      expect(errorsOf(() => calcDamage(MC, kingambit({ item }), kingambit(), 'suckerpunch')), item).toEqual([{ code: 'UNKNOWN_ITEM', field: 'item' }])
    }
  })

  it('AC-V2 없는 종·없는 기술·대도각참 위협·배울 수 없는 기술은 이유가 담긴 오류(프로그램 예외 아님)', () => {
    const cases: [PokemonSet, string, string][] = [
      [kingambit({ species: 'notapokemon' }), 'UNKNOWN_SPECIES', 'species'],
      [kingambit({ moves: ['notamove'] }), 'UNKNOWN_MOVE', 'moves[0]'],
      [kingambit({ ability: 'intimidate' }), 'ILLEGAL_ABILITY', 'ability'],
      [kingambit({ moves: ['flamethrower'] }), 'ILLEGAL_MOVE', 'moves[0]'],
    ]
    for (const [set, code, field] of cases) {
      const details = reasonOf(() => calcDamage(MC, set, kingambit(), 'suckerpunch'))
      expect(details.map((d) => d.code)).toContain(code)
      const d = details.find((x) => x.code === code)!
      expect(d.field).toBe(field)
      expect(d.message.length).toBeGreaterThan(0)
    }
    // 계산 대상 기술 자체가 없거나 배울 수 없어도 같은 종류의 오류
    expect(reasonOf(() => calcDamage(MC, kingambit(), kingambit(), 'notamove')).map((d) => d.code)).toEqual(['UNKNOWN_MOVE'])
    expect(reasonOf(() => calcDamage(MC, kingambit(), kingambit(), 'flamethrower')).map((d) => d.code)).toEqual(['ILLEGAL_MOVE'])
  })

  it('AC-V3 메가 해석: 한카리아스+나이트Z = 메가한카리아스Z, 한카리아스+나이트 = 메가한카리아스, 리자몽+나이트Y = 메가리자몽Y', () => {
    const forme = (species: string, ability: string, item: string) => validateSet(MC, mkSet({ species, ability, item, mega: true })).species
    expect(forme('garchomp', 'roughskin', 'garchompitez').name.ko).toBe('메가한카리아스Z')
    expect(forme('garchomp', 'roughskin', 'garchompite').name.ko).toBe('메가한카리아스')
    expect(forme('charizard', 'blaze', 'charizarditey').name.ko).toBe('메가리자몽Y')
  })

  it('AC-V4 리자몽+한카리아스나이트, 스톤 없이 메가진화를 지정하면 이유가 담긴 오류', () => {
    for (const item of ['garchompite', undefined]) {
      const set = mkSet({ species: 'charizard', ability: 'blaze', item, mega: true })
      const details = reasonOf(() => validateSet(MC, set))
      expect(details).toEqual([expect.objectContaining({ code: 'INVALID_MEGA', field: 'item' })])
      expect(details[0].message.length).toBeGreaterThan(0)
    }
  })

  it('AC-V5(과제 지정) 세트와 스냅샷의 레귤레이션이 다르면 REGULATION_MISMATCH 하나만 나온다', () => {
    expect(errorsOf(() => validateSet(MC, kingambit({ regulation: 'm-b', ability: 'intimidate' })))).toEqual([
      { code: 'REGULATION_MISMATCH', field: 'regulation' },
    ])
    expect(errorsOf(() => calcDamage(MB, kingambit(), mkSet({ species: 'kingambit', ability: 'defiant' }, MB), 'suckerpunch'))).toEqual([
      { code: 'REGULATION_MISMATCH', field: 'regulation' },
    ])
  })
})
