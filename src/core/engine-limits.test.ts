// 엔진이 조용히 틀린 값을 내는 경로(스피드 상한·미구현 위력 0 기술·HP 가득 생존 효과)를 봉인한다.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { Dex } from '@pkmn/dex'
import { MC, mkSet } from './testing'
import { CoreError, calcDamage, finalSpeed, type CoreErrorCode, type DamageResult, type DamageResultOk, type PokemonSet } from './index'
import { koChance } from './damage'

function errorsOf(fn: () => unknown): { code: CoreErrorCode; field?: string }[] {
  try {
    fn()
  } catch (e) {
    expect(e).toBeInstanceOf(CoreError)
    return (e as CoreError).details.map(({ code, field }) => ({ code, field }))
  }
  throw new Error('오류가 나지 않았다')
}

const ok = (r: DamageResult): DamageResultOk => {
  if (r.kind !== 'damage') throw new Error(`대미지 결과가 아니다: ${r.kind}`)
  return r
}

describe('스피드 의존 기술: 엔진 999 상한과 앱 스피드가 다르면 거부(ADR 결정 4)', () => {
  const atk = mkSet({
    species: 'jolteon',
    ability: 'voltabsorb',
    nature: 'timid',
    item: 'choicescarf',
    sp: { spa: 32, spe: 32 },
    boosts: { spe: 2 },
    moves: ['electroball'],
  })
  const def = mkSet({ species: 'jolteon', ability: 'quickfeet', nature: 'timid', sp: { spe: 32 }, boosts: { spe: 1 } })

  it('앱 스피드 1200 vs 300(게임 위력 150)을 엔진 999로 계산하지 않는다', () => {
    const tw = { attacker: { tailwind: true } }
    expect(finalSpeed(MC, atk, tw)).toBe(1200)
    expect(finalSpeed(MC, def, tw, 'defender')).toBe(300)
    expect(errorsOf(() => calcDamage(MC, atk, def, 'electroball', tw))).toEqual([{ code: 'ENGINE_UNSUPPORTED', field: 'move' }])
  })

  it('상한에 닿지 않으면 그대로 계산된다', () => {
    // 600 / 300 = 2 → 위력 80
    expect(finalSpeed(MC, atk)).toBe(600)
    expect(calcDamage(MC, atk, def, 'electroball').kind).toBe('damage')
  })

  it.each([
    ['gyroball', mkSet({ species: 'aegislash', ability: 'stancechange', nature: 'brave', sp: { atk: 32 } })],
    ['payback', mkSet({ species: 'absol', ability: 'justified', item: 'choicescarf', nature: 'jolly', sp: { spe: 32 }, boosts: { spe: 6 } })],
  ])('%s도 엔진 스피드가 앱과 다르면 거부', (move, attacker) => {
    const fast = mkSet({ species: 'jolteon', ability: 'voltabsorb', nature: 'timid', item: 'choicescarf', sp: { spe: 32 }, boosts: { spe: 6 } })
    const target = move === 'gyroball' ? fast : mkSet({ species: 'garchomp', ability: 'roughskin' })
    const side = move === 'gyroball' ? { defender: { tailwind: true } } : { attacker: { tailwind: true } }
    expect(errorsOf(() => calcDamage(MC, attacker, target, move, side))).toEqual([{ code: 'ENGINE_UNSUPPORTED', field: 'move' }])
  })

  it('분석(Analytic)은 행동 순서로 위력이 바뀌므로 같은 규칙을 따른다', () => {
    const starmie = mkSet({ species: 'starmie', ability: 'analytic', item: 'choicescarf', nature: 'timid', sp: { spe: 32 }, boosts: { spe: 6 } })
    const target = mkSet({ species: 'garchomp', ability: 'roughskin' })
    expect(errorsOf(() => calcDamage(MC, starmie, target, 'surf', { attacker: { tailwind: true } }))).toEqual([
      { code: 'ENGINE_UNSUPPORTED', field: 'move' },
    ])
    expect(calcDamage(MC, { ...starmie, boosts: {} }, target, 'surf').kind).toBe('damage')
  })

  it('엔진(@smogon/calc 0.12.0) champions 대미지 경로가 stats.spe를 읽는 곳은 위 기술·특성뿐이다(버전업 감지)', () => {
    const require = createRequire(import.meta.url)
    const src = readFileSync(require.resolve('@smogon/calc/dist/mechanics/champions.js'), 'utf8')
    expect(src.match(/stats\.spe/g)?.length).toBe(10)
    expect([...src.matchAll(/turnOrder(?! =)/g)].length).toBe(3)
  })
})

describe('엔진이 구현하지 않은 위력 0 공격기(ADR 결정 2 엔진 미지원)', () => {
  const zeroPower = Object.values(MC.data.moves).filter((m) => m.category !== 'Status' && m.basePower === 0)
  const defenders = [
    mkSet({ species: 'garchomp', ability: 'roughskin' }),
    mkSet({ species: 'incineroar', ability: 'blaze' }),
    mkSet({ species: 'kingambit', ability: 'defiant' }),
  ]
  const learner = (moveId: string): PokemonSet => {
    const s = Object.values(MC.data.species).find(
      (x) => !x.isMega && x.learnset.includes(moveId) && x.abilities.some((a) => !MC.manifest.engineUnsupported.abilities.includes(a)),
    )!
    const ability = s.abilities.find((a) => !MC.manifest.engineUnsupported.abilities.includes(a))!
    return mkSet({ species: s.id, ability, sp: { atk: 32, spa: 32 } })
  }

  it('스냅샷에 위력 0 공격기가 있다', () => {
    expect(zeroPower.length).toBeGreaterThan(10)
  })

  it.each(zeroPower.map((m) => [m.id]))('%s: 타입 면역이 아닌 상대에게 대미지가 나오거나 ENGINE_UNSUPPORTED다(면역으로 숨지 않는다)', (id) => {
    const move = MC.data.moves[id]
    const target = defenders.find((d) => Dex.getImmunity(move.type, MC.data.species[d.species].types))!
    // 내던지기는 도구가 있어야 위력이 생긴다.
    const attacker = { ...learner(id), ...(id === 'fling' ? { item: 'ironball' } : {}) }
    if (MC.manifest.engineUnsupported.moves.includes(id)) {
      expect(errorsOf(() => calcDamage(MC, attacker, target, id))).toEqual([{ code: 'ENGINE_UNSUPPORTED', field: 'move' }])
    } else {
      expect(calcDamage(MC, attacker, target, id).kind).toBe('damage')
    }
  })

  it('지적 사례: 압솔에게 쓰는 분노의앞니·카운터·일격기는 면역이 아니라 ENGINE_UNSUPPORTED', () => {
    const absol = mkSet({ species: 'absol', ability: 'justified', item: 'leftovers' })
    for (const id of ['superfang', 'counter', 'endeavor', 'fissure', 'guillotine', 'horndrill', 'sheercold', 'metalburst', 'mirrorcoat', 'spitup', 'beatup', 'comeuppance']) {
      expect(MC.manifest.engineUnsupported.moves, id).toContain(id)
      expect(errorsOf(() => calcDamage(MC, learner(id), absol, id)), id).toEqual([{ code: 'ENGINE_UNSUPPORTED', field: 'move' }])
    }
  })

  it('세트 기술 목록에 있기만 한 미지원 기술은 다른 기술 계산을 막지 않는다', () => {
    const cinderace = mkSet({ species: 'cinderace', ability: 'blaze', moves: ['superfang', 'pyroball'] })
    expect(calcDamage(MC, cinderace, mkSet({ species: 'garchomp', ability: 'roughskin' }), 'pyroball').kind).toBe('damage')
  })
})

describe('HP 가득일 때 쓰러지지 않는 효과(PRD F3 1타 확률)', () => {
  const mamo = mkSet({ species: 'mamoswine', ability: 'oblivious', nature: 'adamant', sp: { atk: 32 } })
  const singles = { gameType: 'Singles' } as const

  it('옹골참: HP 가득이면 단타 1타 확률 0(확정 버팀), HP가 1이라도 깎였으면 원래 분포', () => {
    const aggron = mkSet({ species: 'aggron', ability: 'sturdy' })
    const full = ok(calcDamage(MC, mamo, aggron, 'earthquake', singles))
    expect(full.min).toBeGreaterThanOrEqual(full.defenderHp)
    expect(full.ohkoChance).toBe(0)
    expect(full.attackBand).toBe('mid-or-lower')
    expect(full.defenseBand).toBe('guaranteed-survive')
    const chipped = ok(calcDamage(MC, mamo, { ...aggron, curHp: full.defenderHp - 1 }, 'earthquake', singles))
    expect(chipped.ohkoChance).toBe(1)
    expect(chipped.rolls).toEqual(full.rolls)
  })

  it('틀깨기 공격자는 옹골참을 무시한다', () => {
    const excadrill = mkSet({ species: 'excadrill', ability: 'moldbreaker', nature: 'adamant', sp: { atk: 32 } })
    const r = ok(calcDamage(MC, excadrill, mkSet({ species: 'aggron', ability: 'sturdy' }), 'earthquake', singles))
    expect(r.ohkoChance).toBe(koChance(r.rolls, r.defenderHp))
    expect(r.ohkoChance).toBe(1)
  })

  it('기합의띠: HP 가득이면 단타 1타 확률 0, 서투름(Klutz)이면 효과가 없다', () => {
    const chomp = mkSet({ species: 'garchomp', ability: 'roughskin', nature: 'adamant', sp: { atk: 32 } })
    const sash = ok(calcDamage(MC, chomp, mkSet({ species: 'aegislash', ability: 'stancechange', item: 'focussash' }), 'earthquake', singles))
    expect(sash.min).toBeGreaterThanOrEqual(sash.defenderHp)
    expect(sash.ohkoChance).toBe(0)
    expect(sash.attackBand).toBe('mid-or-lower')
    const klutz = ok(calcDamage(MC, chomp, mkSet({ species: 'lopunny', ability: 'klutz', item: 'focussash' }), 'earthquake', singles))
    expect(klutz.ohkoChance).toBe(koChance(klutz.rolls, klutz.defenderHp))
  })

  it('연속기는 첫 타만 HP − 1로 막히고 나머지 타는 그대로 들어간다(전수 계수와 대조)', () => {
    const hydreigon = mkSet({ species: 'hydreigon', ability: 'levitate', nature: 'adamant', sp: { atk: 32 }, boosts: { atk: 6 } })
    const frail = mkSet({ species: 'alakazam', ability: 'synchronize', item: 'focussash' })
    const r = ok(calcDamage(MC, hydreigon, frail, 'doublehit', singles))
    expect(r.hits).toBe(2)
    const hp = r.defenderHp
    let ko = 0
    for (const a of r.rolls[0]) for (const b of r.rolls[1]) if (Math.min(a, hp - 1) + b >= hp) ko++
    expect(r.ohkoChance).toBe(ko / 256)
    expect(r.rolls[0].some((d) => d >= hp)).toBe(true)
    // 매 타 최소 1이므로 첫 타가 막혀도 다음 타가 남은 1을 깎는다.
    expect(r.ohkoChance).toBe(1)
  })

  it('탈(Disguise)은 첫 타를 막는 규칙을 다루지 않으므로 이유가 담긴 오류로 거부한다(틀깨기는 계산)', () => {
    const kingambit = mkSet({ species: 'kingambit', ability: 'defiant', nature: 'adamant', sp: { atk: 32 } })
    const mimikyu = mkSet({ species: 'mimikyu', ability: 'disguise' })
    expect(errorsOf(() => calcDamage(MC, kingambit, mimikyu, 'ironhead'))).toEqual([{ code: 'ENGINE_UNSUPPORTED', field: 'defender.ability' }])
    expect(calcDamage(MC, kingambit, mimikyu, 'swordsdance')).toEqual({ kind: 'status' })
    const pangoro = mkSet({ species: 'pangoro', ability: 'moldbreaker', nature: 'adamant', sp: { atk: 32 } })
    expect(calcDamage(MC, pangoro, mimikyu, 'ironhead').kind).toBe('damage')
  })
})
