import { describe, expect, it } from 'vitest'
import { MC, ZERO_SP, goldenSet, mkSet } from './testing'
import golden from './__golden__/independent.json'
import { CoreInputError, STAT_IDS, computeStats, spNoGainCells, statValue } from './index'
import { assertEngineStatParity } from './engine'

describe('실능치 공식(PRD F2)', () => {
  it('골든값: 고집 맘모꾸리 공격 32 = 200, 겁쟁이 플라엣테(영원의 꽃) 스피드 32 = 158, 맘모꾸리 HP 185/217', () => {
    // 출처: PRD 수용 기준(커뮤니티 공식 + 엔진 실측 재현, notes "조사 결과")
    const mamo = (sp: Partial<typeof ZERO_SP>) => computeStats(MC, mkSet({ species: 'mamoswine', ability: 'oblivious', nature: 'adamant', sp }))
    expect(mamo({ atk: 32 }).atk).toBe(200)
    expect(mamo({}).hp).toBe(185)
    expect(mamo({ hp: 32 }).hp).toBe(217)
    const floette = computeStats(MC, mkSet({ species: 'floetteeternal', ability: 'flowerveil', nature: 'timid', sp: { spe: 32 } }))
    expect(floette.spe).toBe(158)
  })

  it('독립 기준값 6건의 양측 실능치(출처: 독립 산술 scripts/golden/compute-independent.mjs)', () => {
    for (const c of golden.cases) {
      for (const side of [c.attacker, c.defender]) {
        expect(computeStats(MC, goldenSet(side)), `${c.id} ${side.species}`).toEqual(side.stats)
      }
    }
  })

  it('종족값 HP 1이면 SP와 무관하게 HP 1', () => {
    for (const sp of [0, 1, 32]) expect(statValue('hp', 1, sp)).toBe(1)
  })

  it('하락 성격·종족값 100은 SP 0과 1이 모두 108이고, SP 1이 오르지 않는 칸으로 판별된다', () => {
    expect(statValue('atk', 100, 0, 0.9)).toBe(108)
    expect(statValue('atk', 100, 1, 0.9)).toBe(108)
    // 종족값 공격 100 + 공격 하락 성격(겸손)
    const species = Object.values(MC.data.species).find((s) => !s.isMega && s.baseStats.atk === 100)!
    const cells = spNoGainCells(MC, mkSet({ species: species.id, ability: species.abilities[0], nature: 'modest' }))
    expect(cells.atk).toContain(1)
    for (const sp of cells.atk) expect(statValue('atk', 100, sp, 0.9)).toBe(statValue('atk', 100, sp - 1, 0.9))
    // 무보정 능력치는 오르지 않는 칸이 없다
    expect(cells.hp).toEqual([])
    expect(cells.def).toEqual([])
  })

  it('정수 비율 내림이 부동소수 오차 없이 맞다(1.1·0.9 전 범위)', () => {
    for (let x = 21; x <= 300; x++) {
      expect(statValue('atk', x - 20, 0, 1.1)).toBe(Math.floor((x * 11) / 10))
      expect(statValue('atk', x - 20, 0, 0.9)).toBe(Math.floor((x * 9) / 10))
    }
  })

  it('공식 입력이 정수가 아니거나 보정이 허용값이 아니면 거부한다', () => {
    expect(() => statValue('atk', 100, 1.5)).toThrow(CoreInputError)
    expect(() => statValue('atk', 100, Number.NaN)).toThrow(CoreInputError)
    expect(() => statValue('atk', 100, 0, 1.2 as never)).toThrow(CoreInputError)
  })

  it('메가 세트는 메가 폼 종족값으로 계산된다', () => {
    const base = computeStats(MC, mkSet({ species: 'delphox', ability: 'blaze', sp: { hp: 2 } }))
    const mega = computeStats(MC, mkSet({ species: 'delphox', ability: 'blaze', item: 'delphoxite', mega: true, sp: { hp: 2 } }))
    expect(mega.hp).toBe(152)
    expect(mega.def).toBe(92)
    expect(mega.spa).toBeGreaterThan(base.spa)
  })
})

describe('앱 실능치 = 엔진 내부 실능치(ADR 결정 1)', () => {
  it('전 합법 종 × SP 0·32 × 성격 25종(보정 1.1/1.0/0.9 전부)', () => {
    const all32 = Object.fromEntries(STAT_IDS.map((s) => [s, 32])) as typeof ZERO_SP
    const species = Object.values(MC.data.species)
    expect(species.length).toBeGreaterThan(300)
    let checked = 0
    for (const s of species) {
      for (const nature of Object.keys(MC.data.natures)) {
        for (const sp of [ZERO_SP, all32]) {
          assertEngineStatParity(MC, s, nature, sp)
          checked++
        }
      }
    }
    expect(checked).toBe(species.length * 25 * 2)
  })
})
