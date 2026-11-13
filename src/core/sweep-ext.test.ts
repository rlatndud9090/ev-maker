import { describe, expect, it } from 'vitest'
import { MC, cloneSnapshot, mkSet } from './testing'
import {
  CoreError,
  CoreInputError,
  calcDamage,
  checkSpeedSupport,
  compareSpeed,
  judgeDamage,
  judgeSpeed,
  sweepDamage,
  sweepSpeed,
  validateSet,
  type DamageSweepTarget,
  type PokemonSet,
  type SweepResult,
} from './index'
import type { StatId } from '../data/schema'

const withSp = (set: PokemonSet, stat: StatId, sp: number): PokemonSet => ({ ...set, sp: { ...set.sp, [stat]: sp } })
const IGNORE = { ignoreSpTotal: true }

/** 그 기술을 배우고 엔진이 지원하는 특성을 가진 첫 비메가 종의 세트 */
function learner(moveId: string, sp: Partial<PokemonSet['sp']> = {}): PokemonSet {
  const unsupported = MC.manifest.engineUnsupported.abilities
  const s = Object.values(MC.data.species).find((x) => !x.isMega && x.learnset.includes(moveId) && x.abilities.some((a) => !unsupported.includes(a)))
  if (!s) throw new Error(`${moveId}을 배우는 종이 없다`)
  return mkSet({ species: s.id, ability: s.abilities.find((a) => !unsupported.includes(a))!, sp, moves: [moveId] })
}

const kingambit = mkSet({ species: 'kingambit', ability: 'defiant' })
const delphox = mkSet({ species: 'delphox', ability: 'blaze', item: 'delphoxite', mega: true, sp: { hp: 2 } })
const SPEND = { hp: 32, spe: 16 } // 다른 능력치 합 48 → 스윕 능력치 잔여 예산 18

describe('대미지 스윕 허용 능력치 합집합', () => {
  it.each<[DamageSweepTarget['side'], StatId]>([
    ['attacker', 'atk'],
    ['attacker', 'spa'],
    ['attacker', 'def'],
    ['defender', 'hp'],
    ['defender', 'def'],
    ['defender', 'spd'],
    ['defender', 'atk'],
  ])('%s %s 허용', (side, stat) => {
    expect(sweepDamage(MC, { side, stat }, kingambit, delphox, 'suckerpunch').cells).toHaveLength(33)
  })
  it.each<[DamageSweepTarget['side'], StatId]>([
    ['attacker', 'hp'],
    ['attacker', 'spd'],
    ['attacker', 'spe'],
    ['defender', 'spa'],
    ['defender', 'spe'],
  ])('%s %s 거부', (side, stat) => {
    expect(() => sweepDamage(MC, { side, stat }, kingambit, delphox, 'suckerpunch')).toThrow(CoreInputError)
  })
})

describe('ignoreSpTotal: SP 합계 상한만 건너뛴다', () => {
  const over = { ...kingambit, sp: { ...kingambit.sp, hp: 32, atk: 32, spe: 32 } }

  it('합계 초과 세트는 기본 거부, 옵션이면 판정된다', () => {
    expect(() => validateSet(MC, over)).toThrow(CoreError)
    expect(validateSet(MC, over, IGNORE).stats.atk).toBe(validateSet(MC, withSp(kingambit, 'atk', 32)).stats.atk)
    expect(() => calcDamage(MC, over, delphox, 'suckerpunch')).toThrow(CoreError)
    expect(calcDamage(MC, over, delphox, 'suckerpunch', undefined, undefined, IGNORE).kind).toBe('damage')
    expect(() => compareSpeed(MC, over, delphox)).toThrow(CoreError)
    expect(compareSpeed(MC, over, delphox, undefined, IGNORE).order).toBeDefined()
  })

  it('능력치별 범위·합법성 위반은 옵션이어도 거부한다', () => {
    const codes = (fn: () => unknown) => {
      try {
        fn()
      } catch (e) {
        return (e as CoreError).details.map((d) => d.code)
      }
      throw new Error('거부되지 않았다')
    }
    expect(codes(() => validateSet(MC, withSp(over, 'def', 33), IGNORE))).toEqual(['INVALID_SP'])
    expect(codes(() => validateSet(MC, { ...over, ability: 'levitate' }, IGNORE))).toEqual(['ILLEGAL_ABILITY'])
    expect(codes(() => calcDamage(MC, { ...over, moves: ['surf'] }, delphox, 'suckerpunch', undefined, undefined, IGNORE))).toEqual(['ILLEGAL_MOVE'])
  })
})

/** 예산 밖 칸 범주 = 그 칸 SP로 덮어쓴 세트를 ignoreSpTotal로 단건 판정한 범주. 옵션을 끄면 over-budget 칸. */
function expectOverBudgetCells<T>(on: SweepResult<T>, off: SweepResult<T>, judgeAt: (sp: number) => string, overSps: number[]) {
  expect(off.cells.filter((c) => c.kind === 'over-budget').map((c) => c.sp)).toEqual(overSps)
  expect(on.cells.every((c) => c.kind === 'ok')).toBe(true)
  for (const c of on.cells) {
    if (c.kind !== 'ok') continue
    const isOver = overSps.includes(c.sp)
    expect(c.overBudget === true, `sp ${c.sp}`).toBe(isOver)
    expect(c.category, `sp ${c.sp}`).toBe(judgeAt(c.sp))
    if (!isOver) {
      const offCell = off.cells[c.sp]
      expect(offCell.kind === 'ok' && offCell.category).toBe(c.category)
    }
  }
}

describe('judgeOverBudget: 예산 밖 칸도 판정', () => {
  const overSps = [19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32]

  it('공격측 공격(대도각참 기습 → 메가마폭시)', () => {
    const atk = { ...kingambit, sp: { ...kingambit.sp, ...SPEND } }
    const target = { side: 'attacker', stat: 'atk' } as const
    const on = sweepDamage(MC, target, atk, delphox, 'suckerpunch', undefined, undefined, { judgeOverBudget: true })
    const off = sweepDamage(MC, target, atk, delphox, 'suckerpunch')
    expectOverBudgetCells(on, off, (sp) => judgeDamage(MC, 'attacker', withSp(atk, 'atk', sp), delphox, 'suckerpunch', undefined, undefined, IGNORE).category, overSps)
    // 예산 밖 칸끼리의 경계(19)도 경계에 들어간다
    expect(on.boundaries).toEqual([13, 19])
    expect(off.boundaries).toEqual([13])
  })

  it('공격측 방어(바디프레스)', () => {
    const atk = learner('bodypress', SPEND)
    const def = mkSet({ species: 'kingambit', ability: 'defiant' })
    const target = { side: 'attacker', stat: 'def' } as const
    const on = sweepDamage(MC, target, atk, def, 'bodypress', undefined, undefined, { judgeOverBudget: true })
    const off = sweepDamage(MC, target, atk, def, 'bodypress')
    expectOverBudgetCells(on, off, (sp) => judgeDamage(MC, 'attacker', withSp(atk, 'def', sp), def, 'bodypress', undefined, undefined, IGNORE).category, overSps)
    const dmg = on.cells.map((c) => (c.kind === 'ok' && c.value.kind === 'damage' ? c.value.max : -1))
    expect(dmg[32]).toBeGreaterThan(dmg[0])
  })

  it('방어측 HP', () => {
    const def = { ...delphox, sp: { ...delphox.sp, hp: 0, def: 32, spe: 16 } }
    const target = { side: 'defender', stat: 'hp' } as const
    const on = sweepDamage(MC, target, kingambit, def, 'suckerpunch', undefined, undefined, { judgeOverBudget: true })
    const off = sweepDamage(MC, target, kingambit, def, 'suckerpunch')
    expectOverBudgetCells(on, off, (sp) => judgeDamage(MC, 'defender', kingambit, withSp(def, 'hp', sp), 'suckerpunch', undefined, undefined, IGNORE).category, overSps)
  })

  it('방어측 공격(속임수)', () => {
    const atk = learner('foulplay')
    const def = { ...kingambit, sp: { ...kingambit.sp, ...SPEND } }
    const target = { side: 'defender', stat: 'atk' } as const
    const on = sweepDamage(MC, target, atk, def, 'foulplay', undefined, undefined, { judgeOverBudget: true })
    const off = sweepDamage(MC, target, atk, def, 'foulplay')
    expectOverBudgetCells(on, off, (sp) => judgeDamage(MC, 'defender', atk, withSp(def, 'atk', sp), 'foulplay', undefined, undefined, IGNORE).category, overSps)
    const dmg = on.cells.map((c) => (c.kind === 'ok' && c.value.kind === 'damage' ? c.value.max : -1))
    expect(dmg[32]).toBeGreaterThan(dmg[0])
  })

  it('스피드', () => {
    const set = { ...kingambit, sp: { ...kingambit.sp, hp: 32, atk: 16 } }
    const opp = mkSet({ species: 'garchomp', ability: 'roughskin', sp: { spe: 20 } })
    const on = sweepSpeed(MC, set, opp, undefined, { judgeOverBudget: true })
    const off = sweepSpeed(MC, set, opp)
    expectOverBudgetCells(on, off, (sp) => judgeSpeed(MC, withSp(set, 'spe', sp), opp, undefined, IGNORE).category, overSps)
  })

  it('기준 세트 합계 초과는 옵션이 있을 때만 받는다', () => {
    const over = { ...kingambit, sp: { ...kingambit.sp, hp: 32, def: 32, spe: 32 } }
    expect(() => sweepDamage(MC, { side: 'attacker', stat: 'atk' }, over, delphox, 'suckerpunch')).toThrow(CoreError)
    const r = sweepDamage(MC, { side: 'attacker', stat: 'atk' }, over, delphox, 'suckerpunch', undefined, undefined, { judgeOverBudget: true })
    expect(r.cells.every((c) => c.kind === 'ok' && c.overBudget === true)).toBe(true)
  })
})

describe('단건 판정 = 스윕 칸 판정', () => {
  it('judgeDamage로 0~32를 판정하면 대도각참 기습 → 메가마폭시 A 경계 13·19가 재현된다', () => {
    const r = sweepDamage(MC, { side: 'attacker', stat: 'atk' }, kingambit, delphox, 'suckerpunch')
    const cats = r.cells.map((c) => judgeDamage(MC, 'attacker', withSp(kingambit, 'atk', c.sp), delphox, 'suckerpunch').category)
    r.cells.forEach((c, i) => expect(c.kind === 'ok' && c.category).toBe(cats[i]))
    expect(cats.flatMap((c, i) => (i > 0 && c !== cats[i - 1] ? [i] : []))).toEqual([13, 19])
  })

  it('방어 관점·면역·변화기', () => {
    const d = judgeDamage(MC, 'defender', kingambit, delphox, 'suckerpunch')
    expect(d.value.kind === 'damage' && d.category).toBe(d.value.kind === 'damage' ? d.value.defenseBand : '')
    const mamo = mkSet({ species: 'mamoswine', ability: 'oblivious' })
    expect(judgeDamage(MC, 'defender', mamo, delphox, 'earthquake').category).toBe('guaranteed-survive')
    expect(judgeDamage(MC, 'attacker', mamo, delphox, 'earthquake').category).toBe('mid-or-lower')
    expect(() => judgeDamage(MC, 'attacker', kingambit, delphox, 'swordsdance')).toThrow(CoreInputError)
    expect(() => judgeDamage(MC, 'both' as never, kingambit, delphox, 'suckerpunch')).toThrow(CoreInputError)
  })

  it('judgeSpeed는 compareSpeed의 order', () => {
    const opp = mkSet({ species: 'garchomp', ability: 'roughskin' })
    const j = judgeSpeed(MC, kingambit, opp)
    expect(j.value).toEqual(compareSpeed(MC, kingambit, opp))
    expect(j.category).toBe(j.value.order)
  })
})

describe('checkSpeedSupport', () => {
  const fieldOf = (fn: () => void): string => {
    try {
      fn()
    } catch (e) {
      if (e instanceof CoreInputError) return e.field
      throw e
    }
    throw new Error('거부되지 않았다')
  }

  it('지원 세트는 통과, 세트 오류는 CoreError, 합계 초과는 옵션으로만 통과', () => {
    expect(() => checkSpeedSupport(MC, kingambit)).not.toThrow()
    expect(() => checkSpeedSupport(MC, { ...kingambit, item: 'choicescarf' })).not.toThrow()
    expect(() => checkSpeedSupport(MC, { ...kingambit, item: 'ironball' })).not.toThrow()
    expect(() => checkSpeedSupport(MC, { ...kingambit, ability: 'levitate' })).toThrow(CoreError)
    const over = { ...kingambit, sp: { ...kingambit.sp, hp: 32, atk: 32, spe: 32 } }
    expect(() => checkSpeedSupport(MC, over)).toThrow(CoreError)
    expect(() => checkSpeedSupport(MC, over, IGNORE)).not.toThrow()
  })

  it('행동 순서 특성·도구는 field ability·item으로 거부(시간벌기 깜까미, 퀵드로 가라르 야도란, 선제공격손톱)', () => {
    expect(fieldOf(() => checkSpeedSupport(MC, mkSet({ species: 'sableye', ability: 'stall' })))).toBe('ability')
    expect(fieldOf(() => checkSpeedSupport(MC, mkSet({ species: 'slowbrogalar', ability: 'quickdraw' })))).toBe('ability')
    expect(fieldOf(() => checkSpeedSupport(MC, { ...kingambit, item: 'quickclaw' }))).toBe('item')
  })

  it('미구현 스피드 보정 특성·도구도 field ability·item으로 거부(합성 스냅샷)', () => {
    const snap = cloneSnapshot(MC)
    snap.data.abilities.protosynthesis = { id: 'protosynthesis', name: { en: 'Protosynthesis', ko: '고대활성', koSource: 'pokeapi' } }
    snap.data.species.garchomp.abilities.push('protosynthesis')
    snap.data.items.machobrace = { id: 'machobrace', name: { en: 'Macho Brace', ko: '교정깁스', koSource: 'pokeapi' } }
    expect(fieldOf(() => checkSpeedSupport(snap, mkSet({ species: 'garchomp', ability: 'protosynthesis' }, snap)))).toBe('ability')
    expect(fieldOf(() => checkSpeedSupport(snap, mkSet({ species: 'garchomp', ability: 'roughskin', item: 'machobrace' }, snap)))).toBe('item')
  })
})
