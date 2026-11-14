import { describe, expect, it } from 'vitest'
import { realData, syntheticEntry } from '../cards/testing'
import type { MetaEntry } from '../data/meta-schema'
import { namesOf } from '../ui/names'
import { EXAMPLE_DRAFT } from './example'
import { representativeDraft, speciesOnlyDraft } from './speciesDraft'

const { game, bo1 } = realData()
const names = namesOf(game)
const label = (id: string) => names.species.label(id)
const entries = (table: Record<string, MetaEntry>) => (id: string) => table[id]
const real = (id: string) => bo1.entry(id)!

describe('representativeDraft', () => {
  it('대표 세트의 기술·SP·성격·도구·특성(이름은 화면 라벨, 성격 하락은 직접 지정)', () => {
    // 2026-10 Bo1 sneasler 대표 세트: unburden·whiteherb·adamant·H2 A32 S32·closecombat direclaw fakeout protect
    const got = representativeDraft(game, entries({ sneasler: real('sneasler') }), EXAMPLE_DRAFT, label('sneasler'))!
    expect(got.species).toBe(label('sneasler'))
    expect(got.ability).toBe('unburden')
    expect(got.item).toBe(names.items.label('whiteherb'))
    expect(got.nature).toBe('adamant')
    expect(got.natureMinusAuto).toBe(false)
    expect(got.sp).toEqual({ hp: '2', atk: '32', def: '0', spa: '0', spd: '0', spe: '32' })
    expect(got.moves).toEqual(['closecombat', 'direclaw', 'fakeout', 'protect'].map((m) => names.moves.label(m)))
    expect(got.mega).toBe(false)
    expect(got.status).toBe(EXAMPLE_DRAFT.status)
  })

  it('메가 폼은 그 메가스톤, 메가 폼 항목이 없으면 원종 항목으로 대신한다', () => {
    const own = representativeDraft(game, entries({ charizardmegay: real('charizardmegay') }), EXAMPLE_DRAFT, label('charizardmegay'))!
    expect(own.item).toBe(names.items.label('charizarditey'))
    expect(own.nature).toBe('quiet')
    const base = syntheticEntry(real('sneasler'), {})
    base.representative.set = { ...base.representative.set, species: 'charizard', ability: 'blaze', item: 'choicespecs' }
    const viaBase = representativeDraft(game, entries({ charizard: base }), EXAMPLE_DRAFT, label('charizardmegay'))!
    expect(viaBase.item).toBe(names.items.label('charizarditey'))
    expect(viaBase.ability).toBe('blaze')
  })

  it('가질 수 없는 특성은 첫 특성, 게임에 없는 기술은 건너뛴다, 메가스톤 대표 도구는 비운다', () => {
    const e = syntheticEntry(real('sneasler'), {})
    e.representative.set = { ...e.representative.set, ability: 'levitate', item: 'charizarditey', moves: ['nosuchmove', 'fakeout'] }
    const got = representativeDraft(game, entries({ sneasler: e }), EXAMPLE_DRAFT, label('sneasler'))!
    expect(got.ability).toBe(game.data.species.sneasler.abilities[0])
    expect(got.item).toBe('')
    expect(got.moves).toEqual([names.moves.label('fakeout'), '', '', ''])
  })

  it('메타 목록 밖 종·풀리지 않는 이름은 undefined', () => {
    expect(representativeDraft(game, entries({}), EXAMPLE_DRAFT, label('sneasler'))).toBeUndefined()
    expect(representativeDraft(game, entries({ sneasler: real('sneasler') }), EXAMPLE_DRAFT, '없는포켓몬')).toBeUndefined()
  })
})

describe('speciesOnlyDraft', () => {
  it('종만 바꾸고 기술·SP·성격은 그대로, 가질 수 없는 특성은 첫 특성, 메가 폼에서 벗어나면 스톤을 비운다', () => {
    const got = speciesOnlyDraft(game, EXAMPLE_DRAFT, label('sneasler'))
    expect(got).toEqual({ ...EXAMPLE_DRAFT, species: label('sneasler'), ability: game.data.species.sneasler.abilities[0] })
    const mega = speciesOnlyDraft(game, EXAMPLE_DRAFT, label('charizardmegay'))
    expect(mega.item).toBe(names.items.label('charizarditey'))
    expect(speciesOnlyDraft(game, mega, label('charizard')).item).toBe('')
  })
})
