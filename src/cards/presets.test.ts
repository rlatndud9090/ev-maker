import { describe, expect, it } from 'vitest'
import { resolveAssumption } from '../meta'
import { presetAssumption } from './presets'
import { realData } from './testing'
import type { Category, PresetIndex, Tab } from './types'

const { game, bo1 } = realData()
const moves = ['hydropump']
const ZERO = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }

describe('presetAssumption', () => {
  const table: Array<[Tab, Category | null, PresetIndex, Partial<typeof ZERO>, string]> = [
    ['attack', 'physical', 0, { hp: 32, def: 32 }, 'hardy'],
    ['attack', 'physical', 1, { hp: 32, def: 32 }, 'impish'],
    ['attack', 'physical', 2, {}, 'hardy'],
    ['attack', 'special', 0, { hp: 32, spd: 32 }, 'hardy'],
    ['attack', 'special', 1, { hp: 32, spd: 32 }, 'careful'],
    ['attack', 'special', 2, {}, 'hardy'],
    ['defense', 'physical', 0, { atk: 32 }, 'hardy'],
    ['defense', 'physical', 1, { atk: 32 }, 'adamant'],
    ['defense', 'physical', 2, {}, 'hardy'],
    ['defense', 'special', 0, { spa: 32 }, 'hardy'],
    ['defense', 'special', 1, { spa: 32 }, 'modest'],
    ['defense', 'special', 2, {}, 'hardy'],
    ['speed', null, 0, { spe: 32 }, 'hardy'],
    ['speed', null, 1, { spe: 32 }, 'jolly'],
    ['speed', null, 2, {}, 'hardy'],
  ]
  it.each(table)('%s·%s 프리셋 %i', (tab, category, preset, sp, nature) => {
    const a = presetAssumption(game, 'rotomwash', moves, tab, category, preset)
    expect(a).toEqual({
      target: 'rotomwash',
      source: { kind: 'custom' },
      basis: 'as-published',
      set: { regulation: 'm-c', species: 'rotomwash', ability: game.data.species.rotomwash.abilities[0], nature, sp: { ...ZERO, ...sp }, moves },
    })
    expect(resolveAssumption(game, a).usable).toBe(true)
  })

  it('목록 밖 메가 폼 타겟 = 원종 + 메가스톤 + mega: true, 특성은 원종 첫 슬롯', () => {
    const mega = game.data.megas.find((m) => !bo1.entry(m.forme) && game.data.species[m.base].learnset.length > 0)
    expect(mega).toBeDefined()
    if (!mega) return
    const move = game.data.species[mega.base].learnset.find((id) => game.data.moves[id].category !== 'Status') as string
    const a = presetAssumption(game, mega.forme, [move], 'speed', null, 0)
    expect(a.target).toBe(mega.forme)
    expect(a.set).toMatchObject({ species: mega.base, item: mega.stone, mega: true, ability: game.data.species[mega.base].abilities[0] })
    const r = resolveAssumption(game, a)
    expect(r.usable && r.resolved.species.id).toBe(mega.forme)
  })

  it('편집값이 덮어쓰고 item: null이면 도구 없음', () => {
    const a = presetAssumption(game, 'rotomwash', moves, 'attack', 'physical', 0, {
      sp: { hp: 10, spe: 5 },
      nature: 'bold',
      item: 'leftovers',
    })
    expect(a.set).toMatchObject({ sp: { ...ZERO, hp: 10, def: 32, spe: 5 }, nature: 'bold', item: 'leftovers' })
    const mega = game.data.megas[0]
    const b = presetAssumption(game, mega.forme, [], 'speed', null, 0, { item: null })
    expect(b.set.item).toBeUndefined()
  })

  it('세트 기술은 타겟 기술 목록(복사본)', () => {
    const list = ['hydropump', 'voltswitch']
    const a = presetAssumption(game, 'rotomwash', list, 'defense', 'special', 0)
    expect(a.set.moves).toEqual(list)
    expect(a.set.moves).not.toBe(list)
  })

  it('프리셋이 없는 탭·분류 조합은 RangeError', () => {
    expect(() => presetAssumption(game, 'rotomwash', moves, 'attack', null, 0)).toThrow(RangeError)
  })
})
