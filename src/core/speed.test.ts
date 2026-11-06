import { describe, expect, it } from 'vitest'
import { Field, Generations } from '@smogon/calc'
// 엔진 비공개 스피드 함수는 대조 테스트에서만 쓴다(ADR 결정 4).
import { checkAirLock, checkItem, getFinalSpeed } from '@smogon/calc/dist/mechanics/util'
import { MC, cloneSnapshot, goldenCase, goldenSet, mkSet } from './testing'
import { CoreInputError, calcDamage, compareSpeed, finalSpeed, minSpToOutspeed, sweepSpeed, validateSet, type BattleConditions, type PokemonSet } from './index'
import { buildEnginePokemon } from './engine'
import { normalizeConditions } from './conditions'

/** 엔진 calculate와 같은 전처리(서투름 도구 무효·날씨부정)를 거친 뒤의 엔진 스피드 */
function engineSpeed(gen: ReturnType<typeof Generations.get>, p: ReturnType<typeof buildEnginePokemon>, field: Field): number {
  checkAirLock(p, field)
  checkItem(p, field.isMagicRoom)
  return getFinalSpeed(gen, p, field, field.attackerSide)
}

const floette = mkSet({ species: 'floetteeternal', ability: 'flowerveil', nature: 'timid', sp: { spe: 32 } })

describe('최종 스피드(PRD F4)', () => {
  it('스피드 158: 순풍 316, 스카프 237, 스카프+순풍 474, +1 237, −1 105, 마비 79', () => {
    expect(finalSpeed(MC, floette)).toBe(158)
    const tw: BattleConditions = { attacker: { tailwind: true } }
    expect(finalSpeed(MC, floette, tw)).toBe(316)
    const scarf = { ...floette, item: 'choicescarf' }
    expect(finalSpeed(MC, scarf)).toBe(237)
    expect(finalSpeed(MC, scarf, tw)).toBe(474)
    expect(finalSpeed(MC, { ...floette, boosts: { spe: 1 } })).toBe(237)
    expect(finalSpeed(MC, { ...floette, boosts: { spe: -1 } })).toBe(105)
    expect(finalSpeed(MC, { ...floette, status: 'par' })).toBe(79)
    // 순풍은 지정한 쪽에만 걸린다
    expect(finalSpeed(MC, floette, tw, 'defender')).toBe(158)
  })

  it('999 상한이 없다(랭크 +2 + 스카프 + 순풍)', () => {
    const fast = Object.values(MC.data.species).find((s) => !s.isMega && s.baseStats.spe === 130)!
    const set = mkSet({ species: fast.id, ability: fast.abilities[0], nature: 'timid', item: 'choicescarf', sp: { spe: 32 }, boosts: { spe: 2 } })
    const raw = validateSet(MC, set).stats.spe
    expect(raw).toBe(200)
    expect(finalSpeed(MC, set, { attacker: { tailwind: true } })).toBe(1200)
    expect(finalSpeed(MC, set, { attacker: { tailwind: true } })).toBeGreaterThan(999)
  })

  it.each([
    ['basculegion', 'swiftswim', 'Rain'],
    ['venusaur', 'chlorophyll', 'Sun'],
    ['excadrill', 'sandrush', 'Sand'],
    ['beartic', 'slushrush', 'Snow'],
  ] as const)('%s %s: %s에서만 2배', (species, ability, weather) => {
    expect(MC.data.species[species].abilities).toContain(ability)
    const set = mkSet({ species, ability, sp: { spe: 20 } })
    const base = finalSpeed(MC, set)
    for (const w of ['Sun', 'Rain', 'Sand', 'Snow'] as const) {
      expect(finalSpeed(MC, set, { weather: w })).toBe(w === weather ? base * 2 : base)
    }
  })

  it('최종 스피드는 메가 폼 종족값·특성으로 계산한다', () => {
    const swampert = mkSet({ species: 'swampert', ability: 'torrent', item: 'swampertite', mega: true })
    expect(validateSet(MC, swampert).ability).toBe('swiftswim')
    expect(finalSpeed(MC, swampert, { weather: 'Rain' })).toBe(finalSpeed(MC, swampert) * 2)
  })
})

describe('행동 순서 비교(PRD F4)', () => {
  it('같은 스피드는 동속, 우선도 기술은 순서에 넣지 않고 별도 정보', () => {
    expect(compareSpeed(MC, floette, floette).order).toBe('tie')
    const kingambit = mkSet({ species: 'kingambit', ability: 'defiant', moves: ['suckerpunch'] })
    const r = compareSpeed(MC, kingambit, floette)
    expect(r).toEqual({ attackerSpeed: 70, defenderSpeed: 158, order: 'second', attackerPriority: 1 })
    expect(compareSpeed(MC, floette, kingambit)).toMatchObject({ order: 'first', defenderPriority: 1 })
  })

  it('순풍을 켜면 판정이 바뀐다', () => {
    const garchomp = mkSet({ species: 'garchomp', ability: 'roughskin', nature: 'jolly', sp: { spe: 32 } })
    const slow = mkSet({ species: 'incineroar', ability: 'blaze', sp: { spe: 32 } })
    expect(compareSpeed(MC, slow, garchomp).order).toBe('second')
    expect(compareSpeed(MC, slow, garchomp, { attacker: { tailwind: true } }).order).toBe('first')
  })
})

describe('추월 역산(PRD F4)', () => {
  const g = goldenCase<{ cells: { sp: number; order: string }[] }>('c-floette-eternal-timid-vs-garchomp-jolly-speed-sweep')
  const base = goldenSet(g.attacker)
  const target = goldenSet(g.defender)
  const outspeeds = (sp: number) => compareSpeed(MC, { ...base, sp: { ...base.sp, spe: sp } }, target).order === 'first'

  it('독립 기준값: 겁쟁이 플라엣테가 명랑 한카리아스(134)를 넘는 최소 SP는 11(10은 동속)', () => {
    const r = minSpToOutspeed(MC, base, target)
    expect(r).toEqual({ kind: 'ok', sp: 11 })
    expect(minSpToOutspeed(MC, base, 134)).toEqual(r)
    expect(outspeeds(11)).toBe(true)
    expect(outspeeds(10)).toBe(false)
    expect(compareSpeed(MC, { ...base, sp: { ...base.sp, spe: 10 } }, target).order).toBe('tie')
  })

  it('결과 SP에서는 추월하고 결과 − 1에서는 못 한다(여러 목표)', () => {
    for (const t of [120, 125, 133, 140, 150, 157]) {
      const r = minSpToOutspeed(MC, base, t)
      expect(r.kind).toBe('ok')
      if (r.kind !== 'ok') continue
      expect(finalSpeed(MC, { ...base, sp: { ...base.sp, spe: r.sp } })).toBeGreaterThan(t)
      if (r.sp > 0) expect(finalSpeed(MC, { ...base, sp: { ...base.sp, spe: r.sp - 1 } })).toBeLessThanOrEqual(t)
    }
  })

  it('32 SP로 못 넘으면 불가, 남은 예산을 넘으면 예산 초과', () => {
    expect(minSpToOutspeed(MC, base, 158)).toEqual({ kind: 'impossible' })
    const tight = { ...base, sp: { ...base.sp, hp: 32, spa: 30 } }
    expect(minSpToOutspeed(MC, tight, target)).toEqual({ kind: 'over-budget', sp: 11, remaining: 4 })
    // 조건(순풍)은 고정 조건으로 반영된다
    expect(minSpToOutspeed(MC, base, target, { attacker: { tailwind: true } })).toEqual({ kind: 'ok', sp: 0 })
  })

  it('목표 스피드가 정수가 아니면 거부', () => {
    expect(() => minSpToOutspeed(MC, base, 134.5)).toThrow(CoreInputError)
    expect(() => minSpToOutspeed(MC, base, Number.NaN)).toThrow(CoreInputError)
    expect(() => minSpToOutspeed(MC, base, -1)).toThrow(CoreInputError)
    for (const bad of ['134', null, true, [134]]) {
      let err: unknown
      try {
        minSpToOutspeed(MC, base, bad as unknown as number)
      } catch (e) {
        err = e
      }
      expect(err, String(bad)).toBeInstanceOf(CoreInputError)
      expect((err as CoreInputError).field).toBe('target')
    }
  })
})

describe('스냅샷에 있는 추가 스피드 보정(퀵풋·서핑테일·검은철구)', () => {
  const jolteon = mkSet({ species: 'jolteon', ability: 'quickfeet' })

  it('퀵풋: 상태이상이면 ×1.5이고 마비 반감을 받지 않는다', () => {
    expect(finalSpeed(MC, jolteon)).toBe(150)
    expect(finalSpeed(MC, { ...jolteon, status: 'par' })).toBe(225)
    expect(finalSpeed(MC, { ...jolteon, status: 'brn' })).toBe(225)
    expect(finalSpeed(MC, { ...jolteon, ability: 'voltabsorb', status: 'par' })).toBe(75)
  })

  it('서핑테일: 일렉트릭필드에서만 ×2', () => {
    const raichu = mkSet({ species: 'raichualola', ability: 'surgesurfer' })
    expect(finalSpeed(MC, raichu)).toBe(130)
    expect(finalSpeed(MC, raichu, { terrain: 'Electric' })).toBe(260)
    expect(finalSpeed(MC, raichu, { terrain: 'Psychic' })).toBe(130)
  })

  it('검은철구: ×0.5(스카프와 같은 도구 칸)', () => {
    expect(finalSpeed(MC, mkSet({ species: 'garchomp', ability: 'roughskin', item: 'ironball' }))).toBe(61)
  })

  it('세 보정 모두 엔진 getFinalSpeed와 같다(상태이상·필드·순풍·랭크 조합)', () => {
    const gen = Generations.get(0)
    const sets = [jolteon, mkSet({ species: 'raichualola', ability: 'surgesurfer' }), mkSet({ species: 'garchomp', ability: 'roughskin', item: 'ironball' })]
    let compared = 0
    for (const base of sets) {
      for (const status of ['none', 'par', 'brn'] as const) {
        for (const terrain of ['none', 'Electric'] as const) {
          for (const tailwind of [false, true]) {
            for (const spe of [-1, 0, 2]) {
              const set = { ...base, status, boosts: { spe } }
              const conds = normalizeConditions({ terrain, attacker: { tailwind } })
              const field = new Field({ gameType: 'Doubles', terrain: terrain === 'none' ? undefined : terrain, attackerSide: { isTailwind: tailwind } })
              const engine = engineSpeed(gen, buildEnginePokemon(MC, validateSet(MC, set), conds.attacker), field)
              if (engine >= 999) continue
              expect(finalSpeed(MC, set, { terrain, attacker: { tailwind } }), `${set.species} ${status} ${terrain} ${tailwind} ${spe}`).toBe(engine)
              compared++
            }
          }
        }
      }
    }
    expect(compared).toBeGreaterThan(100)
  })

  it('앱이 구현하지 않은 스피드 보정 특성·도구는 조용히 무시하지 않고 거부한다(합성 스냅샷)', () => {
    const snap = cloneSnapshot(MC)
    snap.data.abilities.protosynthesis = { id: 'protosynthesis', name: { en: 'Protosynthesis', ko: '고대활성', koSource: 'pokeapi' } }
    snap.data.species.garchomp.abilities.push('protosynthesis')
    snap.data.items.machobrace = { id: 'machobrace', name: { en: 'Macho Brace', ko: '교정깁스', koSource: 'pokeapi' } }
    expect(() => finalSpeed(snap, mkSet({ species: 'garchomp', ability: 'protosynthesis' }, snap))).toThrow(CoreInputError)
    expect(() => finalSpeed(snap, mkSet({ species: 'garchomp', ability: 'roughskin', item: 'machobrace' }, snap))).toThrow(CoreInputError)
  })

  it('행동 순서만 바꾸는 특성·도구(선제공격손톱·퀵드로·시간벌기)는 순서 비교에서 거부한다', () => {
    const chomp = mkSet({ species: 'garchomp', ability: 'roughskin' })
    const holder = (ability: string) => Object.values(MC.data.species).find((s) => !s.isMega && s.abilities.includes(ability))!
    const stall = holder('stall')
    const quickdraw = holder('quickdraw')
    expect(() => compareSpeed(MC, mkSet({ species: stall.id, ability: 'stall' }), chomp)).toThrow(CoreInputError)
    expect(() => compareSpeed(MC, chomp, mkSet({ species: quickdraw.id, ability: 'quickdraw' }))).toThrow(CoreInputError)
    expect(() => compareSpeed(MC, { ...chomp, item: 'quickclaw' }, chomp)).toThrow(CoreInputError)
    // 스피드 실능 자체는 그대로 계산된다.
    expect(finalSpeed(MC, { ...chomp, item: 'quickclaw' })).toBe(finalSpeed(MC, chomp))
  })
})

describe('자체 스피드 공식 vs 엔진 getFinalSpeed(999 미만 표본)', () => {
  // 짐벗기(Unburden)는 엔진도 발동 상태(abilityOn)를 받아야만 보정하므로 표본에서 뺀다.
  const OUT_OF_SCOPE = new Set(['unburden'])
  const gen = Generations.get(0)

  it('종 × 특성 × SP × 랭크 × 순풍 × 스카프 × 마비 × 날씨', () => {
    let compared = 0
    const species = Object.values(MC.data.species).filter((_, i) => i % 7 === 0)
    for (const s of species) {
      const base = s.isMega ? MC.data.species[s.baseSpecies!] : s
      const mega = MC.data.megas.find((m) => m.forme === s.id)
      for (const ability of base.abilities) {
        if (MC.manifest.engineUnsupported.abilities.includes(ability)) continue
        for (const sp of [0, 32]) {
          for (const spe of [-2, 0, 1, 3]) {
            for (const scarf of [false, true]) {
              if (scarf && mega) continue
              for (const status of ['none', 'par'] as const) {
                for (const weather of ['none', 'Rain', 'Sun', 'Sand', 'Snow'] as const) {
                  for (const tailwind of [false, true]) {
                    const set: PokemonSet = mkSet({
                      species: base.id,
                      ability,
                      nature: 'jolly',
                      sp: { spe: sp },
                      boosts: { spe },
                      status,
                      item: mega ? mega.stone : scarf ? 'choicescarf' : undefined,
                      mega: !!mega,
                    })
                    const r = validateSet(MC, set)
                    if (OUT_OF_SCOPE.has(r.ability)) continue
                    const conds = normalizeConditions({ weather, attacker: { tailwind } })
                    const field = new Field({ gameType: 'Doubles', weather: weather === 'none' ? undefined : weather, attackerSide: { isTailwind: tailwind } })
                    const engine = engineSpeed(gen, buildEnginePokemon(MC, r, conds.attacker), field)
                    if (engine >= 999) continue
                    expect(finalSpeed(MC, set, { weather, attacker: { tailwind } }), `${s.id} ${ability}`).toBe(engine)
                    compared++
                  }
                }
              }
            }
          }
        }
      }
    }
    expect(compared).toBeGreaterThan(5000)
  })
})

describe('도구·날씨를 무효화하는 특성(서투름·날씨부정)', () => {
  const lopunny = mkSet({ species: 'lopunny', ability: 'klutz', item: 'choicescarf' })
  const otherLopunny = { ...lopunny, ability: MC.data.species.lopunny.abilities.find((a) => a !== 'klutz')! }
  const beartic = mkSet({ species: 'beartic', ability: 'swiftswim' })
  const altaria = mkSet({ species: 'altaria', ability: 'cloudnine' })
  const plainAltaria = { ...altaria, ability: MC.data.species.altaria.abilities.find((a) => a !== 'cloudnine')! }
  const rain: BattleConditions = { weather: 'Rain' }

  it('스냅샷 합법 조합이다', () => {
    expect(MC.data.species.lopunny.abilities).toContain('klutz')
    expect(MC.data.species.beartic.abilities).toContain('swiftswim')
    expect(MC.data.species.altaria.abilities).toContain('cloudnine')
  })

  it('서투름이면 구애스카프·검은철구 스피드 보정이 없다', () => {
    expect(finalSpeed(MC, lopunny)).toBe(125)
    expect(finalSpeed(MC, { ...lopunny, item: 'ironball' })).toBe(125)
  })

  it('서투름이 아니면 스카프·검은철구가 정상 적용된다', () => {
    expect(finalSpeed(MC, otherLopunny)).toBe(187)
    expect(finalSpeed(MC, { ...otherLopunny, item: 'ironball' })).toBe(62)
  })

  it('서투름 도구 무효는 순서 비교·추월 역산에도 반영된다', () => {
    expect(compareSpeed(MC, lopunny, { ...lopunny, item: undefined }).order).toBe('tie')
    expect(minSpToOutspeed(MC, lopunny, 125)).toEqual({ kind: 'ok', sp: 1 })
  })

  it('상대에게 날씨부정이 있으면 비가 와도 쓱쓱이 발동하지 않는다', () => {
    expect(compareSpeed(MC, beartic, altaria, rain)).toMatchObject({ attackerSpeed: 70, defenderSpeed: 100, order: 'second' })
  })

  it('날씨부정이 자기 쪽(a)에 있어도 날씨가 무효다', () => {
    expect(compareSpeed(MC, altaria, beartic, rain)).toMatchObject({ attackerSpeed: 100, defenderSpeed: 70, order: 'first' })
  })

  it('날씨부정이 없으면 기존 동작(비에서 쓱쓱 ×2)을 유지한다', () => {
    expect(finalSpeed(MC, beartic, rain)).toBe(140)
    expect(compareSpeed(MC, beartic, plainAltaria, rain)).toMatchObject({ attackerSpeed: 140, defenderSpeed: 100, order: 'first' })
    expect(minSpToOutspeed(MC, beartic, plainAltaria, rain)).toEqual({ kind: 'ok', sp: 0 })
  })

  it('minSpToOutspeed(세트 목표)와 sweepSpeed도 같은 유효 날씨를 쓴다', () => {
    // 쓱쓱 무효면 툰베어(SP 0~32: 70~102)는 파비코리(100)를 SP 31에서야 넘는다
    expect(minSpToOutspeed(MC, beartic, altaria, rain)).toEqual({ kind: 'ok', sp: 31 })
    const s = sweepSpeed(MC, beartic, altaria, rain)
    expect(s.cells[0]).toMatchObject({ kind: 'ok', category: 'second' })
    expect(s.boundaries).toEqual([30, 31])
  })

  it('스피드 의존 대미지(자이로볼)도 서투름 스카프를 엔진과 같게 무효로 본다', () => {
    expect(MC.data.species.golurk.abilities).toContain('klutz')
    const golurk = mkSet({ species: 'golurk', ability: 'klutz', item: 'choicescarf', moves: ['gyroball'] })
    expect(calcDamage(MC, golurk, lopunny, 'gyroball').kind).toBe('damage')
  })
})
