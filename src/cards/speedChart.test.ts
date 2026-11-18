import { describe, expect, it } from 'vitest'
import { finalSpeed, validateSet, type PokemonSet } from '../core'
import type { MetaEntry } from '../data/meta-schema'
import type { MetaView } from '../meta'
import { bundlesOf } from './bundles'
import { presetKey } from './ids'
import { buildSpeedChart, checkSpeedAddition, ladderBaseSet, scarfConditionOf, scarfFreeSet, type SpeedBadge, type SpeedChartInput } from './speedChart'
import { bundleLabel, bundleSpoken, visibleBadges } from './speedLadder'
import { realData, syntheticEntry, syntheticView } from './testing'
import { DEFAULT_CRITERIA, DEFAULT_SPEED_FILTERS, type CustomTarget } from './types'

const { game, bo1 } = realData()

function build(partial: Partial<SpeedChartInput> = {}) {
  return buildSpeedChart({
    game,
    view: bo1,
    myAbility: 'roughskin',
    criteria: { ...DEFAULT_CRITERIA },
    filters: { topN: 30, selected: [] },
    customTargets: [],
    added: [],
    ...partial,
  })
}

const entryOf = (view: MetaView, id: string): MetaEntry => {
  const e = view.entry(id)
  if (e === undefined) throw new Error(`no entry ${id}`)
  return e
}
const of = (badges: readonly SpeedBadge[], opponentId: string) => badges.filter((b) => b.opponentId === opponentId)
const kinds = (badges: readonly SpeedBadge[]) => badges.map((b) => b.condition.kind)

/** base 항목을 복제해 종·대표 세트·분포만 바꾼 합성 항목 */
function speciesEntry(id: string, rep: Omit<PokemonSet, 'regulation' | 'species' | 'moves'> & { moves?: string[] }, patch: Partial<MetaEntry> = {}): MetaEntry {
  const base = entryOf(bo1, 'incineroar')
  const moves = rep.moves ?? game.data.species[id].learnset.slice(0, 1)
  return syntheticEntry(base, {
    id,
    usage: 0.9,
    representative: { basis: 'modal-combination', set: { regulation: game.manifest.regulation.id, species: id, ...rep, moves } },
    abilities: { [rep.ability]: 1 },
    moves: dist({}),
    ...patch,
  })
}
const viewWith = (...entries: MetaEntry[]): MetaView => syntheticView(game, bo1.meta, entries)
const dist = (shares: Record<string, number>): MetaEntry['items'] => ({ shares, keptShare: Object.values(shares).reduce((a, s) => a + s, 0), excludedShare: 0 })
const spreads = (kept: [string, number][]): MetaEntry['spreads'] => ({ kept, keptShare: kept.reduce((a, [, s]) => a + s, 0), excludedShare: 0 })

describe('기본 배지(1위 묶음)', () => {
  it('래더 상대마다 기본 배지가 정확히 하나이고 그 종의 점유율 1위 S 묶음이다', () => {
    const m = build()
    const ladder = bo1.ranking.slice(0, 30)
    for (const e of ladder) {
      const base = of(m.badges, e.id).filter((b) => b.origin === 'ladder' && b.condition.kind === 'none')
      expect(base, e.id).toHaveLength(1)
      const top = bundlesOf(game, e, ['spe'], { bundleShareMin: 0 })[0]
      expect(base[0].bundle).toEqual({ sp: top.stats[0].sp, nature: top.stats[0].nature, share: top.share })
      expect(base[0].speed).toBe(finalSpeed(game, base[0].set))
    }
  })

  it('1위 점유율이 5% 미만이어도 그 묶음이 기본 배지다', () => {
    const e = speciesEntry('garchomp', { ability: 'roughskin', item: 'lifeorb', nature: 'adamant', sp: { hp: 2, atk: 32, def: 0, spa: 0, spd: 0, spe: 32 } }, {
      spreads: spreads([
        ['adamant:2/32/0/0/0/32', 0.03],
        ['hardy:2/32/0/0/0/10', 0.02],
      ]),
    })
    const m = build({ view: viewWith(e) })
    const base = m.badges.filter((b) => b.condition.kind === 'none')
    expect(base).toHaveLength(1)
    expect(base[0].bundle).toEqual({ sp: 32, nature: 'neutral', share: 0.03 })
  })

  it('1위 점유율이 같으면 실수치가 높은 묶음이 기본 배지다', () => {
    const e = speciesEntry('garchomp', { ability: 'roughskin', item: 'lifeorb', nature: 'adamant', sp: { hp: 2, atk: 32, def: 0, spa: 0, spd: 0, spe: 32 } }, {
      spreads: spreads([
        ['adamant:2/32/0/0/0/32', 0.3],
        ['jolly:2/32/0/0/0/32', 0.3],
      ]),
    })
    const m = build({ view: viewWith(e) })
    const base = m.badges.filter((b) => b.condition.kind === 'none')
    expect(base).toHaveLength(1)
    expect(base[0].bundle).toEqual({ sp: 32, nature: 'plus', share: 0.3 })
    expect(base[0].speed).toBe(169)
  })

  it('배분 표기는 공격·방어 탭처럼 화살표만: S32↑ · S20(무보정 기호 없음) · S0↓, 읽기 이름은 성격 보정 글자', () => {
    expect(bundleLabel(32, 'plus')).toBe('S32↑')
    expect(bundleLabel(20, 'neutral')).toBe('S20')
    expect(bundleLabel(0, 'minus')).toBe('S0↓')
    expect(bundleSpoken(32, 'plus')).toBe('S32 성격 상승')
    expect(bundleSpoken(20, 'neutral')).toBe('S20 성격 무보정')
    expect(bundleSpoken(0, 'minus')).toBe('S0 성격 하락')
  })

  it('기본 배지는 스카프 없는 가정 세트이고, 표시 도구(item)는 스피드 배수를 건 도구뿐이다(메가스톤 없음)', () => {
    const m = build()
    // 가브리아스 Bo1 대표 도구 구애스카프(51.55%) → 스카프 밖 최다 도구 생명의구슬(18.43%), 102족 S32 무보정 = 154
    const chomp = of(m.badges, 'garchomp').find((b) => b.condition.kind === 'none')
    expect(chomp).toMatchObject({ set: { item: 'lifeorb' }, item: null, speed: 154 })
    expect(ladderBaseSet(game, entryOf(bo1, 'garchomp')).set.item).toBe('lifeorb')
    const zard = of(m.badges, 'charizardmegay').find((b) => b.condition.kind === 'none')
    expect(zard).toMatchObject({ speciesId: 'charizardmegay', mega: true, set: { item: 'charizarditey' }, item: null })
    expect(ladderBaseSet(game, entryOf(bo1, 'charizardmegay'))).toMatchObject({ speciesId: 'charizardmegay', mega: true })
  })
})

describe('배지 목록은 내 SP·성격·도구·순풍과 무관하다', () => {
  it('특성이 같은 두 내 세트는 같은 배지 모델을 낸다', () => {
    const slow: PokemonSet = { regulation: 'm-c', species: 'garchomp', ability: 'roughskin', item: 'lifeorb', nature: 'brave', sp: { hp: 32, atk: 32, def: 2, spa: 0, spd: 0, spe: 0 }, moves: ['earthquake'] }
    const fast: PokemonSet = { ...slow, item: 'choicescarf', nature: 'jolly', sp: { hp: 2, atk: 32, def: 0, spa: 0, spd: 0, spe: 32 } }
    const a = build({ myAbility: validateSet(game, slow).ability })
    const b = build({ myAbility: validateSet(game, fast).ability })
    expect(b).toEqual(a)
  })
})

describe('조건 배지 생성(AC9)', () => {
  const rankEntry = speciesEntry('incineroar', { ability: 'intimidate', item: 'sitrusberry', nature: 'careful', sp: { hp: 32, atk: 2, def: 0, spa: 0, spd: 32, spe: 0 } }, {
    spreads: spreads([['careful:32/2/0/0/32/0', 0.5]]),
    moves: dist({ agility: 0.1, rockpolish: 0.15, shellsmash: 0.3, flamecharge: 0.2, dragondance: 0.0999, swordsdance: 0.5, tailwind: 0.6 }),
  })

  it('랭크업: 수단 기준 10% 이상만, S 없는 수단·순풍 제외, 같은 S 랭크 값은 하나로 합친다', () => {
    const m = build({ view: viewWith(rankEntry) })
    const rank = m.badges.filter((b) => b.condition.kind === 'rank')
    expect(rank.map((b) => (b.condition.kind === 'rank' ? [b.condition.stage, b.condition.means.map((x) => x.means.id)] : null))).toEqual([
      [1, ['flamecharge']],
      [2, ['agility', 'rockpolish', 'shellsmash']],
    ])
    const two = rank[1]
    expect(two.condition.kind === 'rank' && two.condition.means.map((x) => x.share)).toEqual([0.1, 0.15, 0.3])
    const base = m.badges.find((b) => b.condition.kind === 'none') as SpeedBadge
    expect(two.speed).toBe(finalSpeed(game, { ...base.set, boosts: { spe: 2 } }))
    expect(two).toMatchObject({ filterKind: 'rank', bundle: base.bundle, item: base.item })
  })

  it('스카프: 기준 5.0%는 포함·4.9%는 제외, 기준을 바꾸면 따라 바뀐다', () => {
    const scarfEntry = (share: number) =>
      speciesEntry('incineroar', { ability: 'intimidate', item: 'sitrusberry', nature: 'careful', sp: { hp: 32, atk: 2, def: 0, spa: 0, spd: 32, spe: 0 } }, {
        spreads: spreads([['careful:32/2/0/0/32/0', 0.5]]),
        items: dist({ sitrusberry: 0.5, choicescarf: share }),
      })
    expect(kinds(build({ view: viewWith(scarfEntry(0.05)) }).badges)).toContain('scarf')
    expect(kinds(build({ view: viewWith(scarfEntry(0.049)) }).badges)).not.toContain('scarf')
    const lowered = build({ view: viewWith(scarfEntry(0.049)), criteria: { ...DEFAULT_CRITERIA, scarfShareMin: 0.04 } })
    const scarf = lowered.badges.find((b) => b.condition.kind === 'scarf')
    expect(scarf).toMatchObject({ condition: { kind: 'scarf', share: 0.049 }, filterKind: 'scarf', item: 'choicescarf' })
  })

  it('스카프: 실데이터 펠리퍼(Bo1 5.52%)는 기본 기준에서 스카프 배지를 단다', () => {
    const scarf = of(build().badges, 'pelipper').find((b) => b.condition.kind === 'scarf')
    expect(scarf?.condition).toEqual({ kind: 'scarf', share: 0.0552 })
  })

  it('스카프: 대표 도구가 스카프여도 기본 배지는 스카프 없는 세트이고, 스카프 배지는 구애스카프 점유율로만 붙는다', () => {
    const chomp = of(build().badges, 'garchomp')
    const scarf = chomp.find((b) => b.condition.kind === 'scarf')
    // 154 × 1.5 = 231
    expect(scarf).toMatchObject({ condition: { kind: 'scarf', share: 0.5155 }, filterKind: 'scarf', set: { item: 'choicescarf' }, item: 'choicescarf', speed: 231 })
    expect(chomp.filter((b) => b.condition.kind === 'none').map((b) => b.set.item)).toEqual(['lifeorb'])
    expect(scarfConditionOf(entryOf(bo1, 'garchomp'), 0.05)).toEqual({ kind: 'scarf', share: 0.5155 })
    expect(scarfConditionOf(entryOf(bo1, 'pelipper'), 0.06)).toBeNull()
  })

  it('스카프: 대표 도구가 스카프라도 점유율이 기준 미만이면 스카프 배지가 없고, 스카프 밖 도구가 없으면 도구 없음', () => {
    const rep = { ability: 'roughskin', item: 'choicescarf', nature: 'adamant', sp: { hp: 2, atk: 32, def: 0, spa: 0, spd: 0, spe: 32 } }
    const low = speciesEntry('garchomp', rep, { spreads: spreads([['adamant:2/32/0/0/0/32', 0.5]]), items: dist({ choicescarf: 0.04, lifeorb: 0.03, focussash: 0.03 }) })
    const lowBadges = build({ view: viewWith(low) }).badges
    expect(kinds(lowBadges)).not.toContain('scarf')
    // 동률(3%)이면 id 순: focussash
    expect(lowBadges[0]).toMatchObject({ condition: { kind: 'none' }, set: { item: 'focussash' }, item: null, speed: 154 })
    const only = speciesEntry('garchomp', rep, { spreads: spreads([['adamant:2/32/0/0/0/32', 0.5]]), items: dist({ choicescarf: 1 }) })
    const onlyBadges = build({ view: viewWith(only) }).badges
    expect(onlyBadges[0].set.item).toBeUndefined()
    expect(onlyBadges.find((b) => b.condition.kind === 'scarf')?.speed).toBe(231)
    expect(scarfFreeSet(only, only.representative.set).item).toBeUndefined()
  })

  it('스카프: 메가는 스카프 배지가 없다', () => {
    const mega = syntheticEntry(entryOf(bo1, 'charizardmegay'), { items: dist({ charizarditey: 0.5, choicescarf: 0.5 }) })
    expect(kinds(build({ view: viewWith(mega) }).badges)).not.toContain('scarf')
    expect(scarfConditionOf(mega, 0.05)).toBeNull()
  })

  it('스카프 필터를 끄면 래더·추가 배지 중 구애스카프 장착 세트가 하나도 없다', () => {
    const m = build({ filters: { topN: 200, selected: [] }, added: [{ opponentId: 'garchomp', sp: 0, nature: 'minus' }, { opponentId: 'hydreigon', sp: 10, nature: 'neutral' }] })
    expect(m.badges.some((b) => b.set.item === 'choicescarf')).toBe(true)
    const shown = visibleBadges(m, { ...DEFAULT_SPEED_FILTERS, scarf: false, tailwind: true })
    expect(shown.filter((b) => b.set.item === 'choicescarf')).toEqual([])
    expect(shown.filter((b) => b.origin === 'added').map((b) => b.set.item)).toEqual(['lifeorb', 'chopleberry'])
  })

  it('날씨/필드: 특성 점유율 기준 경계, 내 구름보기·에어록이면 날씨 배지 없음', () => {
    const swim = (share: number) =>
      speciesEntry('basculegion', { ability: 'adaptability', item: 'focussash', nature: 'adamant', sp: { hp: 2, atk: 32, def: 0, spa: 0, spd: 0, spe: 32 } }, {
        spreads: spreads([['adamant:2/32/0/0/0/32', 0.5]]),
        abilities: { adaptability: 1 - share, swiftswim: share },
      })
    const at = build({ view: viewWith(swim(0.1)) }).badges.find((b) => b.condition.kind === 'field')
    expect(at).toMatchObject({ condition: { kind: 'field', ability: 'swiftswim', field: { kind: 'weather', weather: 'Rain' }, share: 0.1 }, filterKind: 'field' })
    expect(at?.speed).toBe(finalSpeed(game, { ...(at as SpeedBadge).set }, { weather: 'Rain' }))
    expect(at?.speed).toBe(260)
    expect(kinds(build({ view: viewWith(swim(0.0999)) }).badges)).not.toContain('field')
    for (const myAbility of ['cloudnine', 'airlock']) expect(kinds(build({ view: viewWith(swim(0.5)), myAbility }).badges)).not.toContain('field')
    expect(kinds(build({ myAbility: 'cloudnine' }).badges)).not.toContain('field')
    expect(of(build().badges, 'venusaur').some((b) => b.condition.kind === 'field')).toBe(true)
  })

  it('날씨/필드: 서핑테일(필드)은 내 구름보기에도 남는다', () => {
    const surge = speciesEntry('raichualola', { ability: 'surgesurfer', item: 'focussash', nature: 'timid', sp: { hp: 2, atk: 0, def: 0, spa: 32, spd: 0, spe: 32 } }, {
      spreads: spreads([['timid:2/0/0/32/0/32', 0.5]]),
    })
    const field = build({ view: viewWith(surge), myAbility: 'cloudnine' }).badges.find((b) => b.condition.kind === 'field')
    expect(field?.condition).toMatchObject({ ability: 'surgesurfer', field: { kind: 'terrain', terrain: 'Electric' } })
  })

  it('순풍: 표시 중인 상대(기본 배지)마다 하나다', () => {
    const m = build()
    const base = m.badges.filter((b) => b.condition.kind === 'none')
    const tailwind = m.badges.filter((b) => b.condition.kind === 'tailwind')
    expect(tailwind.map((b) => b.opponentId)).toEqual(base.map((b) => b.opponentId))
    for (const t of tailwind) expect(t.speed).toBe(finalSpeed(game, t.set, { attacker: { tailwind: true } }))
  })

  it('조건 배지는 기본 배지(1위 묶음)에만 붙고 추가한 배분에는 없다', () => {
    const m = build({ added: [{ opponentId: 'garchomp', sp: 0, nature: 'minus' }] })
    const chomp = of(m.badges, 'garchomp')
    const base = chomp.find((b) => b.origin === 'ladder' && b.condition.kind === 'none') as SpeedBadge
    for (const b of chomp.filter((x) => x.condition.kind !== 'none')) expect(b.bundle).toEqual(base.bundle)
    expect(chomp.filter((b) => b.origin === 'added').map((b) => b.condition.kind)).toEqual(['none'])
  })

  it('실수치가 기본 배지와 같으면 조건 배지를 만들지 않는다(무딘손)', () => {
    const klutz = speciesEntry('lopunny', { ability: 'klutz', item: 'choicescarf', nature: 'jolly', sp: { hp: 2, atk: 32, def: 0, spa: 0, spd: 0, spe: 32 } }, {
      spreads: spreads([['jolly:2/32/0/0/0/32', 0.5]]),
      items: dist({ choicescarf: 0.6, leftovers: 0.3 }),
    })
    const badges = build({ view: viewWith(klutz) }).badges
    expect(kinds(badges)).toEqual(['none', 'tailwind'])
    expect(badges[0]).toMatchObject({ set: { item: 'leftovers' }, item: null })
    expect(badges[0].speed).toBe(finalSpeed(game, { ...badges[0].set, item: 'choicescarf' }))
  })

  it('목록 밖 타겟: S 랭크업 기술·날씨/필드 특성이면 조건 배지, 스카프 배지는 없다', () => {
    const target: CustomTarget = { rosterId: 'raichualola', moves: ['agility'], edits: { [presetKey('speed', null, 0)]: { item: 'choicescarf' } } }
    const m = build({ filters: { topN: 1, selected: [] }, customTargets: [target] })
    const presets = m.badges.filter((b) => b.origin === 'preset')
    expect(presets.map((b) => [b.presetIndex, b.condition.kind])).toEqual([0, 1, 2].flatMap((p) => [[p, 'none'], [p, 'rank'], [p, 'tailwind'], [p, 'field']]))
    for (const b of presets) expect(b).toMatchObject({ opponentId: 'raichualola', bundle: { share: null }, listed: false, addedOrder: 0 })
    expect(presets[0].item).toBe('choicescarf')
    const field = presets.find((b) => b.condition.kind === 'field')
    expect(field?.condition).toEqual({ kind: 'field', ability: 'surgesurfer', field: { kind: 'terrain', terrain: 'Electric' } })
    const rank = presets.find((b) => b.condition.kind === 'rank')
    expect(rank?.condition).toEqual({ kind: 'rank', stage: 2, means: [{ means: { kind: 'move', id: 'agility' } }] })
  })

  it('목록 밖 타겟은 상위 N·선택 필터와 무관하게 보이고, 메타 목록 안 종은 받지 않는다', () => {
    const targets: CustomTarget[] = [
      { rosterId: 'garchomp', moves: ['earthquake'], edits: {} },
      { rosterId: 'raichualola', moves: ['agility'], edits: {} },
    ]
    const m = build({ filters: { topN: 1, selected: ['pelipper'] }, customTargets: targets })
    expect([...new Set(m.badges.map((b) => `${b.origin}:${b.opponentId}`))]).toEqual(['ladder:pelipper', 'preset:raichualola'])
    expect(of(m.badges, 'raichualola')[0].addedOrder).toBe(1)
  })
})

describe('순서 비교 불가(AC13)', () => {
  it('기본 세트가 거부되면 축에 놓지 않고 unsupported로 낸다', () => {
    const claw = speciesEntry('incineroar', { ability: 'intimidate', item: 'quickclaw', nature: 'careful', sp: { hp: 32, atk: 2, def: 0, spa: 0, spd: 32, spe: 0 } }, {
      spreads: spreads([['careful:32/2/0/0/32/0', 0.5]]),
    })
    const m = build({ view: viewWith(claw) })
    expect(m.badges).toEqual([])
    expect(m.unsupported).toEqual([{ opponentId: 'incineroar', speciesId: 'incineroar', origin: 'ladder', rejection: { kind: 'order', field: 'item', id: 'quickclaw' }, item: 'quickclaw' }])
    expect(m.options.has('incineroar')).toBe(false)
  })

  it('거부 원인이 특성이면 unsupported 도구 표시가 없다(지닌 도구는 원인이 아님)', () => {
    const stall = speciesEntry('sableye', { ability: 'stall', item: 'lifeorb', nature: 'careful', sp: { hp: 32, atk: 2, def: 0, spa: 0, spd: 32, spe: 0 } }, {
      spreads: spreads([['careful:32/2/0/0/32/0', 0.5]]),
    })
    const m = build({ view: viewWith(stall) })
    expect(m.unsupported).toEqual([{ opponentId: 'sableye', speciesId: 'sableye', origin: 'ladder', rejection: { kind: 'order', field: 'ability', id: 'stall' }, item: null }])
  })

  it('대표 도구가 스카프면 거부 판정도 스카프 밖 최다 도구 세트로 한다', () => {
    const e = speciesEntry('garchomp', { ability: 'roughskin', item: 'choicescarf', nature: 'adamant', sp: { hp: 2, atk: 32, def: 0, spa: 0, spd: 0, spe: 32 } }, {
      spreads: spreads([['adamant:2/32/0/0/0/32', 0.5]]),
      items: dist({ choicescarf: 0.6, quickclaw: 0.3 }),
    })
    const m = build({ view: viewWith(e) })
    expect(m.badges).toEqual([])
    expect(m.unsupported).toEqual([{ opponentId: 'garchomp', speciesId: 'garchomp', origin: 'ladder', rejection: { kind: 'order', field: 'item', id: 'quickclaw' }, item: 'quickclaw' }])
  })

  it('목록 밖 타겟 프리셋이 거부되면 그 프리셋만 unsupported다', () => {
    const target: CustomTarget = { rosterId: 'raichualola', moves: ['agility'], edits: { [presetKey('speed', null, 1)]: { item: 'quickclaw' } } }
    const m = build({ filters: { topN: 1, selected: [] }, customTargets: [target] })
    expect(m.unsupported).toEqual([
      { opponentId: 'raichualola', speciesId: 'raichualola', origin: 'preset', presetIndex: 1, rejection: { kind: 'order', field: 'item', id: 'quickclaw' }, item: 'quickclaw' },
    ])
    expect([...new Set(m.badges.filter((b) => b.origin === 'preset').map((b) => b.presetIndex))]).toEqual([0, 2])
  })
})

describe('추가 배분(R15)', () => {
  it('목록 묶음은 점유율을 갖고, 직접 입력은 점유율 없이 기본 세트의 S만 바꾼다', () => {
    const m = build({
      added: [
        { opponentId: 'garchomp', sp: 32, nature: 'plus' },
        { opponentId: 'garchomp', sp: 20, nature: 'minus' },
      ],
    })
    const added = of(m.badges, 'garchomp').filter((b) => b.origin === 'added')
    expect(added.map((b) => [b.bundle, b.listed, b.addedOrder])).toEqual([
      [{ sp: 32, nature: 'plus', share: 0.1767 }, true, 0],
      [{ sp: 20, nature: 'minus', share: null }, false, 1],
    ])
    const base = of(m.badges, 'garchomp').find((b) => b.origin === 'ladder' && b.condition.kind === 'none') as SpeedBadge
    expect(added[1].set).toMatchObject({ ability: base.set.ability, item: base.set.item, moves: base.set.moves })
    expect(game.data.natures[added[1].set.nature].minus).toBe('spe')
    expect(added[1].speed).toBe(finalSpeed(game, added[1].set))
  })

  it('SP 합이 넘치면 S 밖 능력치에서 덜어 합계를 지킨다', () => {
    const m = build({ added: [{ opponentId: 'kingambit', sp: 20, nature: 'neutral' }] })
    const added = of(m.badges, 'kingambit').find((b) => b.origin === 'added') as SpeedBadge
    const sp = added.set.sp
    expect(sp.spe).toBe(20)
    expect(Object.values(sp).reduce((a, v) => a + v, 0)).toBeLessThanOrEqual(game.manifest.rules.spTotal)
    expect(() => validateSet(game, added.set)).not.toThrow()
  })

  it('기본 배지·앞선 추가와 같은 배분, 형식 오류, 필터 밖 상대는 추가 배지를 만들지 않는다', () => {
    const m = build({
      filters: { topN: 30, selected: [] },
      added: [
        { opponentId: 'garchomp', sp: 32, nature: 'neutral' },
        { opponentId: 'garchomp', sp: 10, nature: 'neutral' },
        { opponentId: 'garchomp', sp: 10, nature: 'neutral' },
        { opponentId: 'garchomp', sp: 33, nature: 'neutral' },
        { opponentId: 'typhlosionhisui', sp: 10, nature: 'neutral' },
      ],
    })
    expect(m.badges.filter((b) => b.origin === 'added').map((b) => [b.opponentId, b.bundle.sp, b.addedOrder])).toEqual([['garchomp', 10, 1]])
  })

  it('묶음 목록은 스냅숏 전 묶음(점유율 내림차순)이고 차트에 있는 묶음을 표시한다', () => {
    const m = build({ added: [{ opponentId: 'garchomp', sp: 0, nature: 'minus' }] })
    expect(m.options.get('garchomp')).toEqual([
      // 스카프 없는 세트(생명의구슬): 102족 기본 122 + SP, 보정 ×1.1·×0.9 내림
      { sp: 32, nature: 'neutral', share: 0.3392, speed: 154, onChart: true },
      { sp: 0, nature: 'minus', share: 0.1774, speed: 109, onChart: true },
      { sp: 32, nature: 'plus', share: 0.1767, speed: 169, onChart: false },
      { sp: 29, nature: 'neutral', share: 0.0619, speed: 151, onChart: false },
      { sp: 28, nature: 'neutral', share: 0.0253, speed: 150, onChart: false },
      { sp: 0, nature: 'neutral', share: 0.0114, speed: 122, onChart: false },
      { sp: 10, nature: 'neutral', share: 0.011, speed: 132, onChart: false },
    ])
  })

  it('checkSpeedAddition: 형식·대상 오류는 invalid, 차트에 있으면 duplicate, 아니면 목록 여부와 함께 ok', () => {
    const m = build({ added: [{ opponentId: 'garchomp', sp: 10, nature: 'neutral' }] })
    expect(checkSpeedAddition(m, 'garchomp', 33, 'neutral', 32)).toEqual({ kind: 'invalid' })
    expect(checkSpeedAddition(m, 'garchomp', 1.5, 'neutral', 32)).toEqual({ kind: 'invalid' })
    expect(checkSpeedAddition(m, 'typhlosionhisui', 10, 'neutral', 32)).toEqual({ kind: 'invalid' })
    expect(checkSpeedAddition(m, 'garchomp', 32, 'neutral', 32)).toEqual({ kind: 'duplicate' })
    expect(checkSpeedAddition(m, 'garchomp', 10, 'neutral', 32)).toEqual({ kind: 'duplicate' })
    expect(checkSpeedAddition(m, 'garchomp', 32, 'plus', 32)).toEqual({ kind: 'ok', listed: true })
    expect(checkSpeedAddition(m, 'garchomp', 11, 'plus', 32)).toEqual({ kind: 'ok', listed: false })
  })
})

describe('경계 실수치(AC12)', () => {
  // 스카프 지닌 상대 = 사용자가 도구를 구애스카프로 지정한 목록 밖 타겟(프리셋 1: 무보정 S32). 래더 상대는 기본 배지가 스카프 없는 세트다
  const scarfTarget = (rosterId: string, moves: string[], ability?: string): Partial<SpeedChartInput> => ({
    view: viewWith(),
    customTargets: [{ rosterId, moves, edits: { [presetKey('speed', null, 0)]: ability === undefined ? { item: 'choicescarf' } : { item: 'choicescarf', ability } } }],
  })
  const preset0 = (badges: readonly SpeedBadge[], kind: SpeedBadge['condition']['kind']) => badges.find((b) => b.presetIndex === 0 && b.condition.kind === kind) as SpeedBadge

  it('스카프×순풍: 스카프 지닌 상대의 순풍 배지 = 154 × 1.5 × 2', () => {
    const t = preset0(build(scarfTarget('garchomp', ['earthquake'])).badges, 'tailwind')
    expect(t.speed).toBe(462)
    expect(t.speed).toBe(finalSpeed(game, t.set, { attacker: { tailwind: true } }))
  })

  it('+1×스카프: 스카프 지닌 애프룡(70족 S32 = 122)의 +1(용의춤) 배지 = floor(122 × 1.5) × 1.5 → 274.5 내림 274', () => {
    const rank = preset0(build(scarfTarget('flapple', ['dragondance'])).badges, 'rank')
    expect(rank).toMatchObject({ condition: { kind: 'rank', stage: 1 }, item: 'choicescarf', speed: 274 })
    expect(rank.speed).toBe(finalSpeed(game, { ...rank.set }))
  })

  it('날씨×스카프: 스카프 지닌 쓱쓱 상대의 비 배지 = 130 × 2 × 1.5', () => {
    const field = preset0(build(scarfTarget('basculegion', ['wavecrash'], 'swiftswim')).badges, 'field')
    expect(field.speed).toBe(390)
    expect(field.speed).toBe(finalSpeed(game, field.set, { weather: 'Rain' }))
  })

  it('래더 상대 순풍 배지는 스카프 없는 기본 세트 기준: 가브리아스 154 × 2', () => {
    const t = of(build().badges, 'garchomp').find((b) => b.condition.kind === 'tailwind') as SpeedBadge
    expect(t).toMatchObject({ speed: 308, set: { item: 'lifeorb' } })
  })

  it('홀수 반올림: 펠리퍼 85 × 1.5 = 127.5 → 127', () => {
    const scarf = of(build().badges, 'pelipper').find((b) => b.condition.kind === 'scarf') as SpeedBadge
    expect(scarf.speed).toBe(127)
  })

  it('무딘손: 스카프 지닌 기본 배지는 도구 효과 없는 값(172)이고 스카프 조건 배지가 없다', () => {
    const klutz = (item: string, shares: Record<string, number>) =>
      speciesEntry('lopunny', { ability: 'klutz', item, nature: 'jolly', sp: { hp: 2, atk: 32, def: 0, spa: 0, spd: 0, spe: 32 } }, {
        spreads: spreads([['jolly:2/32/0/0/0/32', 0.5]]),
        items: dist(shares),
      })
    const held = build({ view: viewWith(klutz('choicescarf', { choicescarf: 0.6, leftovers: 0.4 })) }).badges
    expect(held[0]).toMatchObject({ speed: 172, set: { item: 'leftovers' }, item: null })
    expect(kinds(held)).not.toContain('scarf')
    expect(kinds(build({ view: viewWith(klutz('leftovers', { leftovers: 0.6, choicescarf: 0.4 })) }).badges)).not.toContain('scarf')
  })
})
