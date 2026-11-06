import { describe, expect, it } from 'vitest'
import { MB, MC, cloneSnapshot, mkSet } from './testing'
import { CoreError, CoreInputError, calcDamage, validateSet, type CoreErrorCode, type PokemonSet } from './index'

function errorsOf(fn: () => unknown): { code: CoreErrorCode; field?: string }[] {
  try {
    fn()
  } catch (e) {
    expect(e).toBeInstanceOf(CoreError)
    return (e as CoreError).details.map(({ code, field }) => ({ code, field }))
  }
  throw new Error('오류가 나지 않았다')
}

const kingambit = (over: Partial<PokemonSet> = {}) =>
  mkSet({ species: 'kingambit', ability: 'defiant', moves: ['suckerpunch'], ...over })

describe('SP 검증(PRD F1)', () => {
  it.each([
    ['SP 33', { atk: 33 }, 'sp.atk'],
    ['음수 SP', { def: -1 }, 'sp.def'],
    ['소수 SP', { spa: 1.5 }, 'sp.spa'],
    ['NaN SP', { spd: Number.NaN }, 'sp.spd'],
    ['Infinity SP', { spe: Number.POSITIVE_INFINITY }, 'sp.spe'],
  ])('%s → INVALID_SP와 위반 능력치', (_, sp, field) => {
    const set = kingambit()
    expect(errorsOf(() => validateSet(MC, { ...set, sp: { ...set.sp, ...sp } }))).toEqual([{ code: 'INVALID_SP', field }])
  })

  it('합계 67 이상 → SP_TOTAL_EXCEEDED, 66은 통과(규칙값은 매니페스트에서 읽는다)', () => {
    expect(MC.manifest.rules.spTotal).toBe(66)
    const ok = kingambit({ sp: { hp: 32, atk: 32, def: 2, spa: 0, spd: 0, spe: 0 } })
    expect(() => validateSet(MC, ok)).not.toThrow()
    const over = kingambit({ sp: { hp: 32, atk: 32, def: 3, spa: 0, spd: 0, spe: 0 } })
    expect(errorsOf(() => validateSet(MC, over))).toEqual([{ code: 'SP_TOTAL_EXCEEDED', field: 'sp' }])
  })

  it('능력치 누락·알 수 없는 능력치 키도 거부한다', () => {
    const set = kingambit()
    const { spe: _spe, ...noSpe } = set.sp
    void _spe
    expect(errorsOf(() => validateSet(MC, { ...set, sp: noSpe as never }))).toEqual([{ code: 'INVALID_SP', field: 'sp.spe' }])
    expect(errorsOf(() => validateSet(MC, { ...set, sp: { ...set.sp, spc: 1 } as never }))).toEqual([
      { code: 'INVALID_SP', field: 'sp.spc' },
    ])
  })
})

describe('합법성 검증(PRD F1)', () => {
  it.each(['choiceband', 'choicespecs', 'assaultvest', 'boosterenergy'])('M-C 도구 %s는 거부된다', (item) => {
    expect(errorsOf(() => validateSet(MC, kingambit({ item })))).toEqual([{ code: 'UNKNOWN_ITEM', field: 'item' }])
  })

  it('존재하지 않는 종·기술 이름, 대도각참 위협, 배울 수 없는 기술은 이유가 담긴 오류', () => {
    expect(errorsOf(() => validateSet(MC, kingambit({ species: 'notapokemon' })))).toContainEqual({ code: 'UNKNOWN_SPECIES', field: 'species' })
    expect(errorsOf(() => validateSet(MC, kingambit({ moves: ['notamove'] })))).toEqual([{ code: 'UNKNOWN_MOVE', field: 'moves[0]' }])
    expect(errorsOf(() => validateSet(MC, kingambit({ ability: 'intimidate' })))).toEqual([{ code: 'ILLEGAL_ABILITY', field: 'ability' }])
    // champions에서 대도각참이 못 배우는 기술(notes ADR 근거 실측)
    expect(errorsOf(() => validateSet(MC, kingambit({ moves: ['metalclaw'] })))).toEqual([{ code: 'UNKNOWN_MOVE', field: 'moves[0]' }])
    expect(errorsOf(() => validateSet(MC, kingambit({ moves: ['flamethrower'] })))).toEqual([{ code: 'ILLEGAL_MOVE', field: 'moves[0]' }])
    expect(() => calcDamage(MC, kingambit(), kingambit(), 'flamethrower')).toThrow(CoreError)
  })

  it('대도각참 특성은 오기·총대장·프레셔이고 기습을 배운다', () => {
    for (const ability of ['defiant', 'supremeoverlord', 'pressure']) expect(() => validateSet(MC, kingambit({ ability }))).not.toThrow()
  })

  it('프로토타입 키·빈 문자열·비문자열 id는 존재하지 않는 항목으로 거부한다', () => {
    expect(errorsOf(() => validateSet(MC, kingambit({ species: '__proto__' })))).toContainEqual({ code: 'UNKNOWN_SPECIES', field: 'species' })
    expect(errorsOf(() => validateSet(MC, kingambit({ item: 'constructor' })))).toEqual([{ code: 'UNKNOWN_ITEM', field: 'item' }])
    expect(errorsOf(() => validateSet(MC, kingambit({ item: '' })))).toEqual([{ code: 'UNKNOWN_ITEM', field: 'item' }])
    expect(errorsOf(() => validateSet(MC, kingambit({ nature: 'toString' })))).toEqual([{ code: 'UNKNOWN_NATURE', field: 'nature' }])
    expect(errorsOf(() => validateSet(MC, kingambit({ ability: 1 as never })))).toEqual([{ code: 'UNKNOWN_ABILITY', field: 'ability' }])
  })

  it('기술 5개 이상·중복 기술은 거부한다', () => {
    const five = ['suckerpunch', 'ironhead', 'kowtowcleave', 'swordsdance', 'protect']
    expect(errorsOf(() => validateSet(MC, kingambit({ moves: five })))).toContainEqual({ code: 'ILLEGAL_MOVE', field: 'moves' })
    expect(errorsOf(() => validateSet(MC, kingambit({ moves: ['suckerpunch', 'suckerpunch'] })))).toEqual([
      { code: 'ILLEGAL_MOVE', field: 'moves[1]' },
    ])
  })

  it('여러 위반은 한 번에 모두 보고된다', () => {
    const set = kingambit({ ability: 'intimidate', item: 'choiceband', nature: 'nope', moves: ['notamove'] })
    expect(errorsOf(() => validateSet(MC, { ...set, sp: { ...set.sp, atk: 40 } })).map((e) => e.code)).toEqual([
      'ILLEGAL_ABILITY',
      'UNKNOWN_ITEM',
      'UNKNOWN_NATURE',
      'INVALID_SP',
      'UNKNOWN_MOVE',
    ])
  })

  it.each([[null], [undefined], ['m-c'], [42], [[]]])('세트가 객체가 아니면(%s) 레귤레이션 불일치가 아니라 CoreInputError(set)', (bad) => {
    let err: unknown
    try {
      validateSet(MC, bad as unknown as PokemonSet)
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(CoreInputError)
    expect((err as CoreInputError).field).toBe('set')
  })

  it('세트와 스냅샷의 레귤레이션이 다르면 다른 위반보다 먼저 REGULATION_MISMATCH 단독', () => {
    const set = kingambit({ regulation: 'm-b', ability: 'intimidate' })
    expect(errorsOf(() => validateSet(MC, set))).toEqual([{ code: 'REGULATION_MISMATCH', field: 'regulation' }])
    expect(() => validateSet(MB, set)).toThrow(CoreError)
    expect(() => validateSet(MB, kingambit({ regulation: 'm-b' }))).not.toThrow()
  })

  it('상태이상·랭크·현재 HP·알 수 없는 세트 필드는 CoreInputError', () => {
    expect(() => validateSet(MC, kingambit({ status: 'burn' as never }))).toThrow(CoreInputError)
    expect(() => validateSet(MC, kingambit({ boosts: { atk: 7 } }))).toThrow(CoreInputError)
    expect(() => validateSet(MC, kingambit({ boosts: { atk: 0.5 } }))).toThrow(CoreInputError)
    expect(() => validateSet(MC, kingambit({ boosts: { hp: 1 } as never }))).toThrow(CoreInputError)
    expect(() => validateSet(MC, kingambit({ curHp: 0 }))).toThrow(CoreInputError)
    expect(() => validateSet(MC, kingambit({ curHp: 176 }))).toThrow(CoreInputError)
    expect(() => validateSet(MC, { ...kingambit(), level: 100 } as never)).toThrow(CoreInputError)
    expect(validateSet(MC, kingambit({ curHp: 175 })).curHp).toBe(175)
  })
})

describe('메가 해석(PRD F1, ADR 결정 2)', () => {
  const resolve = (species: string, ability: string, item?: string) =>
    validateSet(MC, mkSet({ species, ability, item, mega: true })).species.id

  it('스톤 × 원종 표로 정확한 폼을 고른다', () => {
    expect(resolve('garchomp', 'roughskin', 'garchompitez')).toBe('garchompmegaz')
    expect(resolve('garchomp', 'roughskin', 'garchompite')).toBe('garchompmega')
    expect(resolve('charizard', 'blaze', 'charizarditey')).toBe('charizardmegay')
    expect(resolve('charizard', 'blaze', 'charizarditex')).toBe('charizardmegax')
  })

  it('메가 82쌍 전부가 표로 해석되고 결과 폼의 requiredItem·baseSpecies와 맞는다', () => {
    expect(MC.data.megas).toHaveLength(82)
    for (const m of MC.data.megas) {
      const base = MC.data.species[m.base]
      const r = validateSet(MC, mkSet({ species: m.base, ability: base.abilities[0], item: m.stone, mega: true }))
      expect(r.species.id).toBe(m.forme)
      expect(r.species.requiredItem).toBe(m.stone)
      expect(r.species.baseSpecies).toBe(m.base)
      expect(r.ability).toBe(r.species.abilities[0])
      expect(r.setAbility).toBe(base.abilities[0])
    }
  })

  it('다른 종의 스톤·스톤 없음·메가스톤 아닌 도구·메가 폼 id 직접 지정은 INVALID_MEGA', () => {
    expect(errorsOf(() => validateSet(MC, mkSet({ species: 'charizard', ability: 'blaze', item: 'garchompite', mega: true })))).toEqual([
      { code: 'INVALID_MEGA', field: 'item' },
    ])
    expect(errorsOf(() => validateSet(MC, mkSet({ species: 'charizard', ability: 'blaze', mega: true })))).toEqual([
      { code: 'INVALID_MEGA', field: 'item' },
    ])
    expect(errorsOf(() => validateSet(MC, mkSet({ species: 'charizard', ability: 'blaze', item: 'leftovers', mega: true })))).toEqual([
      { code: 'INVALID_MEGA', field: 'item' },
    ])
    expect(errorsOf(() => validateSet(MC, mkSet({ species: 'charizardmegay', ability: 'drought' })))).toContainEqual({
      code: 'INVALID_MEGA',
      field: 'species',
    })
    expect(errorsOf(() => validateSet(MC, mkSet({ species: 'charizard', ability: 'blaze', mega: 'yes' as never })))).toEqual([
      { code: 'INVALID_MEGA', field: 'mega' },
    ])
  })

  it('메가스톤을 지녀도 mega를 지정하지 않으면 원종으로 계산한다', () => {
    expect(validateSet(MC, mkSet({ species: 'garchomp', ability: 'roughskin', item: 'garchompitez' })).species.id).toBe('garchomp')
  })

  it('M-B에서는 메가한카리아스Z 세트가 거부되고 M-C에서는 계산된다', () => {
    const set = (snap: typeof MC) =>
      mkSet({ species: 'garchomp', ability: 'roughskin', item: 'garchompitez', mega: true, nature: 'adamant', sp: { atk: 32 } }, snap)
    expect(errorsOf(() => validateSet(MB, set(MB)))).toEqual([{ code: 'UNKNOWN_ITEM', field: 'item' }])
    const target = mkSet({ species: 'incineroar', ability: 'blaze' })
    expect(calcDamage(MC, set(MC), target, 'earthquake').kind).toBe('damage')
  })
})

describe('규칙값', () => {
  it('레벨 50이 아닌 스냅샷은 계산을 거부한다(공식·엔진 모두 50 고정)', () => {
    const snap = cloneSnapshot(MC)
    snap.manifest.rules.level = 100
    expect(() => validateSet(snap, kingambit())).toThrow(CoreInputError)
  })

  it('SP 상한·합계는 매니페스트 규칙값을 따른다', () => {
    const snap = cloneSnapshot(MC)
    snap.manifest.rules.spTotal = 64
    snap.manifest.rules.spMaxPerStat = 31
    expect(errorsOf(() => validateSet(snap, kingambit({ sp: { hp: 32, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 } })))).toEqual([
      { code: 'INVALID_SP', field: 'sp.hp' },
    ])
    expect(errorsOf(() => validateSet(snap, kingambit({ sp: { hp: 31, atk: 31, def: 3, spa: 0, spd: 0, spe: 0 } })))).toEqual([
      { code: 'SP_TOTAL_EXCEEDED', field: 'sp' },
    ])
  })
})

describe('엔진 미지원 항목(ADR 결정 2)', () => {
  it('실제 M-C 매니페스트의 미지원 기술·특성은 ENGINE_UNSUPPORTED', () => {
    const u = MC.manifest.engineUnsupported
    expect(u.moves).toContain('pound')
    // pound를 배우는 합법 종이 없어 learnset에만 넣은 합성 스냅샷으로 확인한다.
    const snap = cloneSnapshot(MC)
    snap.data.species.kingambit.learnset.push('pound')
    // 기술 목록에 있기만 하면 거부하지 않고, 그 기술을 계산할 때 거부한다.
    expect(validateSet(snap, kingambit({ moves: ['pound', 'suckerpunch'] })).set.moves).toEqual(['pound', 'suckerpunch'])
    expect(errorsOf(() => calcDamage(snap, kingambit({ moves: ['pound'] }), kingambit(), 'pound'))).toEqual([{ code: 'ENGINE_UNSUPPORTED', field: 'move' }])
    const holder = Object.values(MC.data.species).find((s) => s.abilities.includes('battlebond'))!
    expect(errorsOf(() => validateSet(MC, mkSet({ species: holder.id, ability: 'battlebond' })))).toEqual([
      { code: 'ENGINE_UNSUPPORTED', field: 'ability' },
    ])
  })

  it('합성 스냅샷: 매니페스트에 기록된 종·도구·특성·기술은 계산이 거부된다', () => {
    const snap = cloneSnapshot(MC)
    snap.manifest.engineUnsupported = { species: ['kingambit'], items: ['leftovers'], abilities: ['blaze'], moves: ['suckerpunch'] }
    const field = (set: PokemonSet) => errorsOf(() => validateSet(snap, set)).map((e) => e.field)
    expect(field(kingambit({ moves: [] }))).toEqual(['species'])
    expect(field(mkSet({ species: 'incineroar', ability: 'blaze' }))).toEqual(['ability'])
    expect(field(mkSet({ species: 'incineroar', ability: 'intimidate', item: 'leftovers' }))).toEqual(['item'])
    const target = mkSet({ species: 'incineroar', ability: 'intimidate' })
    expect(() => calcDamage(snap, mkSet({ species: 'incineroar', ability: 'intimidate' }), target, 'suckerpunch')).toThrow(CoreError)
  })
})
