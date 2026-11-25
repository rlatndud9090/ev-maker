import { describe, expect, it } from 'vitest'
import { finalSpeed, minSpToOutspeed, type PokemonSet } from '../core'
import { SPEED_MIN_SP_LEGACY } from './__fixtures__/speedMinSpLegacy'
import { buildSpeedChart, type SpeedBadge, type SpeedChartModel } from './speedChart'
import {
  compareInRow,
  focusAfterRemove,
  ladderRows,
  markHasScarf,
  markLabel,
  markSpoken,
  minSpToPass,
  navigate,
  speedBaseline,
  speedCeilings,
  speedZones,
  statusOf,
  visibleBadges,
  zoneSpoken,
  type LadderRow,
  type SpeedBaseline,
  type SpeedCeilings,
} from './speedLadder'
import { realData } from './testing'
import { DEFAULT_CRITERIA, DEFAULT_SPEED_FILTERS } from './types'

const { game, bo1 } = realData()

const chomp: PokemonSet = {
  regulation: 'm-c',
  species: 'garchomp',
  ability: 'roughskin',
  item: 'lifeorb',
  nature: 'hardy',
  sp: { hp: 2, atk: 32, def: 0, spa: 0, spd: 0, spe: 32 },
  moves: ['earthquake'],
}

function badge(id: string, speed: number, patch: Partial<SpeedBadge> = {}): SpeedBadge {
  return {
    id,
    origin: 'ladder',
    source: 'ladder',
    opponentId: id,
    speciesId: id,
    mega: false,
    bundle: { sp: 32, nature: 'neutral', share: 0.5 },
    listed: true,
    condition: { kind: 'none' },
    filterKind: null,
    speed,
    item: null,
    set: chomp,
    usageRank: 1,
    ...patch,
  }
}
const ok = (speed: number): SpeedBaseline => ({ kind: 'ok', speed, sp: 32, nature: 'neutral', tailwind: false })

describe('기준선', () => {
  it('내 도구·순풍을 반영하고 날씨·필드는 넣지 않는다', () => {
    expect(speedBaseline(game, chomp, false)).toEqual({ kind: 'ok', speed: 154, sp: 32, nature: 'neutral', tailwind: false })
    expect(speedBaseline(game, { ...chomp, item: 'choicescarf' }, false)).toMatchObject({ speed: 231 })
    expect(speedBaseline(game, { ...chomp, item: 'choicescarf' }, true)).toMatchObject({ speed: 462, tailwind: true })
    expect(speedBaseline(game, { ...chomp, nature: 'jolly', sp: { ...chomp.sp, spe: 20 } }, false)).toMatchObject({ sp: 20, nature: 'plus' })
    expect(speedBaseline(game, { ...chomp, boosts: { spe: 2 } }, false)).toMatchObject({ speed: 154 })
  })

  it('내 세트가 스피드 거부면 원인, 세트 자체 오류면 invalid이고 상태·최소 S를 내지 않는다(AC5b)', () => {
    const claw = speedBaseline(game, { ...chomp, item: 'quickclaw' }, false)
    expect(claw).toEqual({ kind: 'rejected', rejection: { kind: 'order', field: 'item', id: 'quickclaw' } })
    const stall: PokemonSet = { ...chomp, species: 'sableye', ability: 'stall', moves: ['fakeout'] }
    expect(speedBaseline(game, stall, false)).toEqual({ kind: 'rejected', rejection: { kind: 'order', field: 'ability', id: 'stall' } })
    const invalid = speedBaseline(game, { ...chomp, sp: { ...chomp.sp, hp: 32 } }, false)
    expect(invalid).toEqual({ kind: 'invalid' })
    for (const b of [claw, invalid]) {
      expect(statusOf(100, b)).toBeNull()
    }
    expect(minSpToPass(game, { ...chomp, item: 'quickclaw' }, 100, false)).toBeNull()
    expect(minSpToPass(game, { ...chomp, sp: { ...chomp.sp, hp: 32 } }, 100, false)).toBeNull()
    expect(speedBaseline(game, chomp, false).kind).toBe('ok')
  })
})

describe('상태·필터', () => {
  it('기준선 아래는 추월, 같으면 동속, 위는 추월당함', () => {
    const b = ok(150)
    expect([statusOf(149, b), statusOf(150, b), statusOf(151, b)]).toEqual(['outspeeds', 'tie', 'outsped'])
  })

  it('조건 필터는 조건 배지만 거르고 기본·추가 배지는 늘 보인다', () => {
    const model: SpeedChartModel = {
      badges: [
        badge('base', 100),
        badge('added', 110, { origin: 'added' }),
        badge('rank', 150, { condition: { kind: 'rank', stage: 1, means: [] }, filterKind: 'rank' }),
        badge('scarf', 150, { condition: { kind: 'scarf', share: 0.1 }, filterKind: 'scarf' }),
        badge('tw', 200, { condition: { kind: 'tailwind' }, filterKind: 'tailwind' }),
        badge('field', 200, { condition: { kind: 'field', ability: 'swiftswim', field: { kind: 'weather', weather: 'Rain' } }, filterKind: 'field' }),
      ],
      unsupported: [],
      options: new Map(),
    }
    expect(visibleBadges(model, DEFAULT_SPEED_FILTERS).map((b) => b.id)).toEqual(['base', 'added', 'rank', 'scarf', 'field'])
    expect(visibleBadges(model, { rank: false, scarf: false, tailwind: true, field: false }).map((b) => b.id)).toEqual(['base', 'added', 'tw'])
  })

  it('실데이터 기본 필터: 순풍 배지가 빠지고 그 밖의 배지는 남는다', () => {
    const model = buildSpeedChart({ game, view: bo1, myAbility: 'roughskin', criteria: DEFAULT_CRITERIA, filters: { topN: 30, selected: [] }, customTargets: [], added: [] })
    const shown = visibleBadges(model, DEFAULT_SPEED_FILTERS)
    expect(shown.some((b) => b.condition.kind === 'tailwind')).toBe(false)
    expect(shown.length).toBe(model.badges.filter((b) => b.condition.kind !== 'tailwind').length)
  })
})

describe('같은 줄 순서(speed-bundles-pin-disable R3)', () => {
  const cmp = compareInRow()
  it('AC5: 사용률 순위 3위·1위·2위 상대 배지는 1위·2위·3위 순이다(점유율·이름과 무관)', () => {
    const list = [
      badge('r3', 150, { opponentId: 'r3', speciesId: 'a', usageRank: 3, bundle: { sp: 32, nature: 'neutral', share: 0.9 } }),
      badge('r1', 150, { opponentId: 'r1', speciesId: 'z', usageRank: 1, bundle: { sp: 32, nature: 'neutral', share: 0.1 } }),
      badge('r2', 150, { opponentId: 'r2', speciesId: 'm', usageRank: 2, bundle: { sp: 32, nature: 'neutral', share: 0.5 } }),
    ]
    expect([...list].sort(cmp).map((b) => b.id)).toEqual(['r1', 'r2', 'r3'])
  })

  it('AC5: 같은 상대는 점유율 내림(30% → 8%) → 기본 먼저 → 직접 입력(추가 순)이고, 직접 입력 배지도 그 포켓몬 자리에 놓으며, 목록 밖 타겟은 줄 맨 뒤다', () => {
    const one = { opponentId: 'p1', speciesId: 'p1', usageRank: 1 }
    const two = { opponentId: 'p2', speciesId: 'p2', usageRank: 2 }
    const list = [
      badge('preset-1-0', 150, { origin: 'preset', source: 'custom', opponentId: 'x', speciesId: 'x', usageRank: 0, bundle: { sp: 32, nature: 'neutral', share: null }, presetIndex: 0, addedOrder: 1, listed: false }),
      badge('preset-0-1', 150, { origin: 'preset', source: 'custom', opponentId: 'y', speciesId: 'y', usageRank: 0, bundle: { sp: 32, nature: 'neutral', share: null }, presetIndex: 1, addedOrder: 0, listed: false }),
      badge('preset-0-0', 150, { origin: 'preset', source: 'custom', opponentId: 'y', speciesId: 'y', usageRank: 0, bundle: { sp: 32, nature: 'neutral', share: null }, presetIndex: 0, addedOrder: 0, listed: false }),
      badge('custom-added', 150, { origin: 'added', source: 'custom', opponentId: 'x', speciesId: 'x', usageRank: 0, bundle: { sp: 5, nature: 'neutral', share: null }, addedOrder: 3, listed: false }),
      badge('p2-base', 150, { ...two, bundle: { sp: 32, nature: 'neutral', share: 0.6 } }),
      badge('p2-free', 150, { ...two, origin: 'added', bundle: { sp: 9, nature: 'neutral', share: null }, addedOrder: 1, listed: false }),
      badge('p1-free-2', 150, { ...one, origin: 'added', bundle: { sp: 3, nature: 'neutral', share: null }, addedOrder: 2, listed: false }),
      badge('p1-free-0', 150, { ...one, origin: 'added', bundle: { sp: 4, nature: 'neutral', share: null }, addedOrder: 0, listed: false }),
      badge('p1-8', 150, { ...one, bundle: { sp: 20, nature: 'neutral', share: 0.08 } }),
      badge('p1-30-cond', 150, { ...one, bundle: { sp: 32, nature: 'neutral', share: 0.3 }, condition: { kind: 'tailwind' }, filterKind: 'tailwind' }),
      badge('p1-30', 150, { ...one, bundle: { sp: 32, nature: 'neutral', share: 0.3 } }),
      badge('p1-listed', 150, { ...one, origin: 'added', bundle: { sp: 28, nature: 'neutral', share: 0.2 }, addedOrder: 5 }),
    ]
    expect([...list].sort(cmp).map((b) => b.id)).toEqual([
      'p1-30',
      'p1-30-cond',
      'p1-listed',
      'p1-8',
      'p1-free-0',
      'p1-free-2',
      'p2-base',
      'p2-free',
      'custom-added',
      'preset-0-0',
      'preset-0-1',
      'preset-1-0',
    ])
  })

  it('실데이터: 같은 실수치 줄의 래더 배지는 사용률 순위가 줄지 않는다', () => {
    const model = buildSpeedChart({ game, view: bo1, myAbility: 'roughskin', criteria: DEFAULT_CRITERIA, filters: { topN: 100, selected: [] }, customTargets: [], added: [] })
    const byId = new Map(model.badges.map((b) => [b.id, b]))
    let shared = 0
    for (const row of ladderRows(model.badges, null, cmp)) {
      const ranks = row.badgeIds.map((id) => byId.get(id)?.usageRank ?? 0)
      expect(ranks).toEqual([...ranks].sort((a, b) => a - b))
      if (new Set(ranks).size > 1) shared += 1
    }
    expect(shared).toBeGreaterThan(0)
  })
})

describe('사다리 줄', () => {
  const cmp = compareInRow()
  const badges = [badge('a', 200), badge('b', 150), badge('c', 150, { bundle: { sp: 0, nature: 'neutral', share: 0.9 } }), badge('d', 149)]
  it('실수치 내림차순 줄(윗줄 차이 없음), 내 실수치에 배지가 없으면 빈 기준선 줄이 낀다', () => {
    expect(ladderRows(badges, 160, cmp)).toEqual([
      { speed: 200, badgeIds: ['a'], baseline: false },
      { speed: 160, badgeIds: [], baseline: true },
      { speed: 150, badgeIds: ['c', 'b'], baseline: false },
      { speed: 149, badgeIds: ['d'], baseline: false },
    ])
  })
  it('동속 줄이 기준선 줄이고, 거부(null)면 기준선 줄이 없다', () => {
    expect(ladderRows(badges, 150, cmp).map((r) => [r.speed, r.baseline])).toEqual([
      [200, false],
      [150, true],
      [149, false],
    ])
    expect(ladderRows(badges, null, cmp).some((r) => r.baseline)).toBe(false)
    expect(ladderRows([], 154, cmp)).toEqual([{ speed: 154, badgeIds: [], baseline: true }])
  })
})

describe('최소 S(AC7b·AC8)', () => {
  it('(a) 그 SP에서 엄격히 앞서고 SP−1에서는 아니다, (b) 동속은 추월이 아니다', () => {
    const me: PokemonSet = { ...chomp, sp: { ...chomp.sp, hp: 2, spe: 32 } }
    for (const target of [130, 136, 149, 154]) {
      const r = minSpToPass(game, me, target, false)
      for (const [nature, res] of [['hardy', r?.neutral], ['jolly', r?.plus]] as const) {
        if (res === undefined || res.kind === 'impossible') continue
        const at = (sp: number) => finalSpeed(game, { ...me, nature, sp: { ...me.sp, spe: sp } }, undefined)
        expect(at(res.sp)).toBeGreaterThan(target)
        if (res.sp > 0) expect(at(res.sp - 1)).toBeLessThanOrEqual(target)
      }
    }
    expect(minSpToPass(game, me, 154, false)?.neutral).toEqual({ kind: 'impossible' })
  })

  it('(c) 0~32에서 닿지 않으면 불가', () => {
    expect(minSpToPass(game, chomp, 400, false)).toEqual({ neutral: { kind: 'impossible' }, plus: { kind: 'impossible' } })
  })

  it('기존 결과 고정표: 추월 목표 사례는 기존 값과 같고 예산 초과는 코어 remaining 그대로다', () => {
    const cases = SPEED_MIN_SP_LEGACY.filter((c) => c.classification === '추월 목표 비교 대상')
    expect(cases.length).toBeGreaterThanOrEqual(6)
    for (const c of cases) {
      const target = finalSpeed(game, c.opponentSet)
      const r = minSpToPass(game, c.mySet, target, c.myTailwind)
      const remaining = c.mySet.sp.spe + c.remaining
      for (const which of ['neutral', 'plus'] as const) {
        const legacy = c.legacy[which]
        const expected = legacy === null ? { kind: 'impossible' } : legacy.need === 0 ? { kind: 'ok', sp: legacy.sp } : { kind: 'over-budget', sp: legacy.sp, remaining }
        expect(r?.[which], `${c.id} ${which}`).toEqual(expected)
        const core = minSpToOutspeed(game, { ...c.mySet, nature: c.natures[which] }, target, { attacker: { tailwind: c.myTailwind } })
        expect(r?.[which], `${c.id} ${which} core`).toEqual(core)
        if (legacy !== null && legacy.need > 0 && r?.[which].kind === 'over-budget') expect(r[which].sp - r[which].remaining).toBe(legacy.need)
      }
    }
    expect(cases.some((c) => c.covers.includes('예산 초과'))).toBe(true)
  })

  it('기존 결과 고정표: 규칙 변경 사례는 새 기대값(엄격 추월)으로 고정한다', () => {
    const expected: Record<string, unknown> = {
      'tie-boundary-tie-goal': { neutral: { kind: 'over-budget', sp: 28, remaining: 16 }, plus: { kind: 'ok', sp: 15 } },
      'opponent-scarf-tie-goal': { neutral: { kind: 'ok', sp: 9 }, plus: { kind: 'ok', sp: 0 } },
      'keep-first': { neutral: { kind: 'ok', sp: 9 }, plus: { kind: 'ok', sp: 0 } },
      'opponent-scarf-keep': { neutral: { kind: 'ok', sp: 9 }, plus: { kind: 'ok', sp: 0 } },
    }
    const cases = SPEED_MIN_SP_LEGACY.filter((c) => c.classification === '규칙 변경으로 결과 다름')
    expect(cases.map((c) => c.id).sort()).toEqual(Object.keys(expected).sort())
    for (const c of cases) expect(minSpToPass(game, c.mySet, finalSpeed(game, c.opponentSet), c.myTailwind), c.id).toEqual(expected[c.id])
  })

  it('내 순풍을 켠 채 상대 순풍 배지의 최소 S는 양쪽 순풍을 넣은 코어 값과 같다', () => {
    const opp: PokemonSet = { ...chomp, item: 'choicescarf', nature: 'jolly' }
    const me: PokemonSet = { ...chomp, item: 'choicescarf', sp: { hp: 2, atk: 32, def: 0, spa: 0, spd: 0, spe: 32 } }
    const target = finalSpeed(game, opp, { attacker: { tailwind: true } })
    const r = minSpToPass(game, me, target, true)
    const both = { attacker: { tailwind: true }, defender: { tailwind: true } }
    expect(r?.neutral).toEqual(minSpToOutspeed(game, { ...me, nature: 'hardy' }, opp, both))
    expect(r?.plus).toEqual(minSpToOutspeed(game, { ...me, nature: 'jolly' }, opp, both))
    expect(r?.plus).toEqual({ kind: 'impossible' })
  })
})

describe('컷 고정 옵션(합계 검사 끔·성격 지정)', () => {
  // H32 A32 S32 = 96 > 66
  const over: PokemonSet = { ...chomp, sp: { ...chomp.sp, hp: 32 } }

  it('옵션이 없거나 비어 있으면 결과가 같다', () => {
    for (const target of [100, 136, 154, 400]) {
      const base = minSpToPass(game, chomp, target, false)
      expect(minSpToPass(game, chomp, target, false, {})).toEqual(base)
      expect(minSpToPass(game, chomp, target, true, {})).toEqual(minSpToPass(game, chomp, target, true))
    }
    expect(speedBaseline(game, chomp, true, {})).toEqual(speedBaseline(game, chomp, true))
  })

  it('합계 초과 세트: 옵션이 없으면 무효, ignoreSpTotal이면 기준선·최소 S를 낸다', () => {
    expect(speedBaseline(game, over, false)).toEqual({ kind: 'invalid' })
    expect(minSpToPass(game, over, 136, false)).toBeNull()
    expect(speedBaseline(game, over, false, { ignoreSpTotal: true })).toEqual(speedBaseline(game, chomp, false))
    const r = minSpToPass(game, over, 136, false, { ignoreSpTotal: true })
    expect(r?.neutral).toEqual(minSpToOutspeed(game, { ...over, nature: 'hardy' }, 136, { attacker: { tailwind: false } }, { ignoreSpTotal: true }))
    expect(r?.neutral.kind).toBe('over-budget')
  })

  it('natures를 주면 그 두 성격으로 판정하고 plus null이면 상승 결과가 null이다', () => {
    const target = 150
    const r = minSpToPass(game, chomp, target, false, { natures: { neutral: 'adamant', plus: 'timid' } })
    expect(r?.neutral).toEqual(minSpToOutspeed(game, { ...chomp, nature: 'adamant' }, target, { attacker: { tailwind: false } }))
    expect(r?.plus).toEqual(minSpToOutspeed(game, { ...chomp, nature: 'timid' }, target, { attacker: { tailwind: false } }))
    expect(minSpToPass(game, chomp, target, false, { natures: { neutral: 'hardy', plus: null } })).toEqual({ neutral: minSpToPass(game, chomp, target, false)?.neutral, plus: null })
  })

  it('랭크는 옵션과 무관하게 지운다', () => {
    expect(minSpToPass(game, { ...over, boosts: { spe: 2 } }, 136, false, { ignoreSpTotal: true })).toEqual(minSpToPass(game, over, 136, false, { ignoreSpTotal: true }))
  })
})

describe('키보드 탐색(AC20)', () => {
  const rows: LadderRow[] = [
    { speed: 300, badgeIds: ['a1', 'a2', 'a3'], baseline: false },
    { speed: 250, badgeIds: [], baseline: true },
    { speed: 200, badgeIds: ['b1'], baseline: false },
    { speed: 100, badgeIds: ['c1', 'c2'], baseline: false },
  ]
  it('위아래는 이웃 배지 줄의 같은 순번(없으면 마지막), 빈 기준선 줄은 건너뛴다', () => {
    expect(navigate(rows, 'a3', 'ArrowDown')).toBe('b1')
    expect(navigate(rows, 'b1', 'ArrowUp')).toBe('a1')
    expect(navigate(rows, 'c2', 'ArrowUp')).toBe('b1')
    expect(navigate(rows, 'a2', 'ArrowUp')).toBe('a2')
    expect(navigate(rows, 'c1', 'ArrowDown')).toBe('c1')
    const wide: LadderRow[] = [rows[0], { speed: 50, badgeIds: ['d1', 'd2', 'd3'], baseline: false }]
    expect(navigate(wide, 'd2', 'ArrowUp')).toBe('a2')
  })
  it('좌우는 같은 줄 이웃, Home/End는 첫 배지·마지막 배지', () => {
    expect(navigate(rows, 'a2', 'ArrowLeft')).toBe('a1')
    expect(navigate(rows, 'a1', 'ArrowLeft')).toBe('a1')
    expect(navigate(rows, 'a2', 'ArrowRight')).toBe('a3')
    expect(navigate(rows, 'a3', 'ArrowRight')).toBe('a3')
    expect(navigate(rows, 'b1', 'Home')).toBe('a1')
    expect(navigate(rows, 'b1', 'End')).toBe('c2')
    expect(navigate(rows, 'gone', 'ArrowDown')).toBe('a1')
    expect(navigate([{ speed: 1, badgeIds: [], baseline: true }], 'x', 'Home')).toBe('x')
  })
  it('삭제 뒤 포커스: 같은 줄 다음 → 앞 → 아랫줄 → 윗줄, 마지막 하나면 null', () => {
    expect(focusAfterRemove(rows, 'a2')).toBe('a3')
    expect(focusAfterRemove(rows, 'a3')).toBe('a2')
    expect(focusAfterRemove(rows, 'b1')).toBe('c1')
    const tail: LadderRow[] = [rows[0], { speed: 100, badgeIds: ['z'], baseline: false }]
    expect(focusAfterRemove(tail, 'z')).toBe('a1')
    expect(focusAfterRemove([{ speed: 1, badgeIds: ['only'], baseline: false }], 'only')).toBeNull()
    expect(focusAfterRemove(rows, 'gone')).toBeNull()
  })
})

describe('기준 실수치(speed-reach-band AC1, 2026-11-24 세 번째 개정: 구애스카프 가정 포함)', () => {
  // 기대값은 독립 경로: S SP를 32로(성격은 무보정 hardy·상승 jolly) 둔 세트, S SP를 0으로(무보정 hardy) 둔 세트, 그 세트의 도구만 구애스카프로 둔 세트의 기준선 값
  const atSp = (set: PokemonSet, nature: string, spe: number): PokemonSet => ({ ...set, nature, sp: { ...set.sp, spe } })
  const ok = (b: SpeedBaseline): number => {
    if (b.kind !== 'ok') throw new Error('기대값 세트가 유효하지 않다')
    return b.speed
  }
  const at = (set: PokemonSet, nature: string, spe: number, tw: boolean) => ok(speedBaseline(game, atSp(set, nature, spe), tw, { ignoreSpTotal: true }))
  const expected = (set: PokemonSet, tw: boolean, withScarf = true): SpeedCeilings => {
    const scarfSet: PokemonSet = { ...set, item: 'choicescarf' }
    return {
      floor: at(set, 'hardy', 0, tw),
      neutral: at(set, 'hardy', 32, tw),
      plus: at(set, 'jolly', 32, tw),
      plusSign: 'plus',
      scarf: withScarf ? { neutral: at(scarfSet, 'hardy', 32, tw), plus: at(scarfSet, 'jolly', 32, tw) } : null,
    }
  }
  const low: PokemonSet = { ...chomp, nature: 'hardy', sp: { ...chomp.sp, spe: 5 } }

  it('도구 없음·생명의구슬·내 순풍 각각 "S0 무보정"·"S32 무보정"·"S32 상승"·"구애스카프 S32 무보정·상승" 기준선과 같다', () => {
    const noItem: PokemonSet = { ...low, item: undefined }
    expect(speedCeilings(game, noItem, false)).toEqual(expected(noItem, false))
    expect(speedCeilings(game, low, false)).toEqual(expected(low, false))
    expect(speedCeilings(game, low, true)).toEqual(expected(low, true))
    const c = speedCeilings(game, low, false)!
    expect(speedCeilings(game, low, true)!.plus).toBeGreaterThan(c.plus)
    expect(speedCeilings(game, low, true)!.floor).toBeGreaterThan(c.floor)
    // 구애스카프 구간은 보라 구간 위에 쌓인다
    expect(c.scarf!.neutral).toBeGreaterThan(c.plus)
    expect(c.scarf!.plus).toBeGreaterThan(c.scarf!.neutral)
  })

  it('지금 도구가 구애스카프면 스카프 가정이 없다(보라 구간이 이미 스카프 포함)', () => {
    const scarf: PokemonSet = { ...low, item: 'choicescarf' }
    const c = speedCeilings(game, scarf, false)!
    expect(c).toEqual(expected(scarf, false, false))
    expect(c.scarf).toBeNull()
    expect(c.plus).toBe(speedCeilings(game, low, false)!.scarf!.plus)
  })

  it('S0 최소는 하락 성격을 넣지 않은 무보정 값이고 지금 기준선 이하일 수 있다(지금 S 하락이면 범위 아래)', () => {
    const c = speedCeilings(game, low, false)!
    expect(c.floor).toBeLessThan(c.neutral)
    const atFloor = speedBaseline(game, atSp(low, 'hardy', 0), false)
    expect(atFloor.kind === 'ok' && atFloor.speed).toBe(c.floor)
    const minus = speedBaseline(game, atSp(low, 'brave', 0), false)
    expect(minus.kind === 'ok' && minus.speed).toBeLessThan(c.floor)
  })

  it('지금 S SP·성격(하락 포함)·SP 합계 초과·랭크와 무관하다', () => {
    const want = speedCeilings(game, low, false)
    expect(want).toEqual(expected(low, false))
    expect(want!.plus).toBeGreaterThan(want!.neutral)
    for (const v of [
      { ...low, sp: { ...low.sp, spe: 32 } },
      { ...low, nature: 'brave' },
      { ...low, nature: 'jolly', sp: { ...low.sp, spe: 0 } },
      { ...low, nature: 'timid' },
      { ...low, sp: { hp: 32, atk: 32, def: 32, spa: 0, spd: 0, spe: 20 } },
      { ...low, boosts: { spe: 2 } },
    ] satisfies PokemonSet[]) {
      expect(speedCeilings(game, v, false), JSON.stringify(v.sp) + v.nature).toEqual(want)
    }
  })

  it('합계 말고 다른 이유로 무효이거나 스피드 거부면 없다', () => {
    expect(speedCeilings(game, { ...low, sp: { ...low.sp, hp: 33 } }, false)).toBeNull()
    expect(speedCeilings(game, { ...low, species: 'nope' }, false)).toBeNull()
    expect(speedCeilings(game, { ...low, item: 'quickclaw' }, false)).toBeNull()
  })

  it('표지·읽기 표기', () => {
    expect(markLabel(32, 'floor')).toBe('S0')
    expect(markLabel(32, 'max')).toBe('S32')
    expect(markLabel(32, 'maxPlus')).toBe('S32↑')
    expect(markLabel(32, 'scarfMax')).toBe('S32')
    expect(markLabel(32, 'scarfMaxPlus')).toBe('S32↑')
    expect((['floor', 'max', 'maxPlus', 'scarfMax', 'scarfMaxPlus'] as const).map(markHasScarf)).toEqual([false, false, false, true, true])
    expect(markSpoken(32, 'floor', '구애스카프')).toBe('S0 성격 무보정 최소')
    expect(markSpoken(32, 'max', '구애스카프')).toBe('S32 성격 무보정 최대')
    expect(markSpoken(32, 'maxPlus', '구애스카프')).toBe('S32 성격 상승 최대')
    expect(markSpoken(32, 'scarfMax', '구애스카프')).toBe('구애스카프 S32 성격 무보정 최대')
    expect(markSpoken(32, 'scarfMaxPlus', '구애스카프')).toBe('구애스카프 S32 성격 상승 최대')
    expect(zoneSpoken(32, 'base', '구애스카프')).toBe('S0~S32 무보정 구간')
    expect(zoneSpoken(32, 'basePlus', '구애스카프')).toBe('S32 성격 상승 구간')
    expect(zoneSpoken(32, 'scarf', '구애스카프')).toBe('구애스카프 S32 무보정 구간')
    expect(zoneSpoken(32, 'scarfPlus', '구애스카프')).toBe('구애스카프 S32 성격 상승 구간')
  })
})

describe('배경색 구간·경계 줄(speed-reach-band AC2~AC4, 2026-11-24 세 번째 개정)', () => {
  const cmp = compareInRow()
  // 경계: S0 120 · S32 165 · S32↑ 181 · 스카프 S32 247 · 스카프 S32↑ 271
  const C: SpeedCeilings = { floor: 120, neutral: 165, plus: 181, plusSign: 'plus', scarf: { neutral: 247, plus: 271 } }
  const view = (rows: LadderRow[]) => rows.map((r) => [r.speed, r.badgeIds.length, r.baseline, r.mark ?? null, r.zone ?? null])
  const ofSpeeds = (xs: number[]) => xs.map((x) => badge(`s${x}`, x))

  it('speedZones: 아래에서 위로 네 구간, 비는 구간은 빠진다', () => {
    expect(speedZones(C)).toEqual([
      { kind: 'base', top: 165, mark: 'max' },
      { kind: 'basePlus', top: 181, mark: 'maxPlus' },
      { kind: 'scarf', top: 247, mark: 'scarfMax' },
      { kind: 'scarfPlus', top: 271, mark: 'scarfMaxPlus' },
    ])
    expect(speedZones({ ...C, scarf: null }).map((z) => z.kind)).toEqual(['base', 'basePlus'])
    // 스카프가 효과 없음(스카프 S32 ≤ S32↑): 스카프 무보정 구간이 비고, 스카프 상승 위 끝도 S32↑ 이하면 둘 다 빠진다
    expect(speedZones({ ...C, scarf: { neutral: 165, plus: 181 } }).map((z) => z.kind)).toEqual(['base', 'basePlus'])
    expect(speedZones({ ...C, scarf: { neutral: 175, plus: 190 } })).toEqual([
      { kind: 'base', top: 165, mark: 'max' },
      { kind: 'basePlus', top: 181, mark: 'maxPlus' },
      { kind: 'scarfPlus', top: 190, mark: 'scarfMaxPlus' },
    ])
  })

  it('AC2: 줄 구성·구간(S0 최소 이상, 각 위 끝 포함, 기준선 띠 제외)·경계 표지', () => {
    expect(view(ladderRows(ofSpeeds([300, 260, 250, 200, 178, 160, 150, 110]), 154, cmp, C))).toEqual([
      [300, 1, false, null, null],
      [271, 0, false, 'scarfMaxPlus', 'scarfPlus'],
      [260, 1, false, null, 'scarfPlus'],
      [250, 1, false, null, 'scarfPlus'],
      [247, 0, false, 'scarfMax', 'scarf'],
      [200, 1, false, null, 'scarf'],
      [181, 0, false, 'maxPlus', 'basePlus'],
      [178, 1, false, null, 'basePlus'],
      [165, 0, false, 'max', 'base'],
      [160, 1, false, null, 'base'],
      [154, 0, true, null, null],
      [150, 1, false, null, 'base'],
      [120, 0, false, 'floor', 'base'],
      [110, 1, false, null, null],
    ])
  })

  it('AC3 (a)(b): 같은 실수치 상대 줄에 표지를 붙이고 새 줄을 만들지 않는다. 각 경계 줄은 아래 구간의 위 끝', () => {
    expect(view(ladderRows(ofSpeeds([272, 271, 248, 247, 182, 181, 166, 165, 120, 119]), 154, cmp, C))).toEqual([
      [272, 1, false, null, null],
      [271, 1, false, 'scarfMaxPlus', 'scarfPlus'],
      [248, 1, false, null, 'scarfPlus'],
      [247, 1, false, 'scarfMax', 'scarf'],
      [182, 1, false, null, 'scarf'],
      [181, 1, false, 'maxPlus', 'basePlus'],
      [166, 1, false, null, 'basePlus'],
      [165, 1, false, 'max', 'base'],
      [154, 0, true, null, null],
      [120, 1, false, 'floor', 'base'],
      [119, 1, false, null, null],
    ])
  })

  it('AC3 (c)(d): 기준선이 경계 실수치와 같으면 기준선 줄에 표지(따로 줄 없음, 띠는 구간 없음)', () => {
    const c = view(ladderRows(ofSpeeds([178]), 181, cmp, { ...C, scarf: null }))
    expect(c).toEqual([
      [181, 0, true, 'maxPlus', null],
      [178, 1, false, null, 'basePlus'],
      [165, 0, false, 'max', 'base'],
      [120, 0, false, 'floor', 'base'],
    ])
    const e = view(ladderRows(ofSpeeds([130, 110]), 120, cmp, { ...C, scarf: null }))
    expect(e).toEqual([
      [181, 0, false, 'maxPlus', 'basePlus'],
      [165, 0, false, 'max', 'base'],
      [130, 1, false, null, 'base'],
      [120, 0, true, 'floor', null],
      [110, 1, false, null, null],
    ])
  })

  it('AC3 (e): 두 S32 기준이 같으면 줄 하나, 표기는 상승 변형의 실제 S 보정. 스카프 두 기준이 같아도 하나', () => {
    const same = (plusSign: 'plus' | 'neutral') => view(ladderRows(ofSpeeds([180, 160]), 150, cmp, { floor: 120, neutral: 170, plus: 170, plusSign, scarf: null }))
    expect(same('neutral')).toEqual([
      [180, 1, false, null, null],
      [170, 0, false, 'max', 'base'],
      [160, 1, false, null, 'base'],
      [150, 0, true, null, null],
      [120, 0, false, 'floor', 'base'],
    ])
    expect(same('plus').map((r) => r[3])).toEqual([null, 'maxPlus', null, null, 'floor'])
    const scarfSame = view(ladderRows([], 150, cmp, { floor: 120, neutral: 170, plus: 170, plusSign: 'neutral', scarf: { neutral: 255, plus: 255 } }))
    expect(scarfSame).toEqual([
      [255, 0, false, 'scarfMax', 'scarf'],
      [170, 0, false, 'max', 'base'],
      [150, 0, true, null, null],
      [120, 0, false, 'floor', 'base'],
    ])
  })

  it('AC3 (f)(h): 기준선 없으면 경계·구간 없음. 지금 S 하락이라 기준선이 S0 최소보다 낮으면 띠는 구간 아래', () => {
    const f = ladderRows(ofSpeeds([194, 160]), null, cmp, C)
    expect(view(f)).toEqual([
      [194, 1, false, null, null],
      [160, 1, false, null, null],
    ])
    expect(f.every((r) => !('mark' in r) && !('zone' in r))).toBe(true)
    const h = view(ladderRows(ofSpeeds([125, 118]), 115, cmp, { ...C, scarf: null }))
    expect(h).toEqual([
      [181, 0, false, 'maxPlus', 'basePlus'],
      [165, 0, false, 'max', 'base'],
      [125, 1, false, null, 'base'],
      [120, 0, false, 'floor', 'base'],
      [118, 1, false, null, null],
      [115, 0, true, null, null],
    ])
  })

  it('기준 없이 부르면 기존 줄과 같다(필드 없음)', () => {
    const bs = ofSpeeds([194, 160])
    expect(ladderRows(bs, 154, cmp, null)).toEqual(ladderRows(bs, 154, cmp))
    expect(ladderRows(bs, 154, cmp)).toEqual([
      { speed: 194, badgeIds: ['s194'], baseline: false },
      { speed: 160, badgeIds: ['s160'], baseline: false },
      { speed: 154, badgeIds: [], baseline: true },
    ])
  })

  it('AC4: 위아래 이동은 배지 없는 경계 줄을 건너뛰고, 표지가 붙은 상대 줄 배지는 이동 대상', () => {
    const rows = ladderRows(ofSpeeds([300, 200, 178, 160, 150, 110]), 154, cmp, C)
    expect(navigate(rows, 's300', 'ArrowDown')).toBe('s200')
    expect(navigate(rows, 's200', 'ArrowDown')).toBe('s178')
    expect(navigate(rows, 's178', 'ArrowDown')).toBe('s160')
    expect(navigate(rows, 's160', 'ArrowDown')).toBe('s150')
    expect(navigate(rows, 's150', 'ArrowDown')).toBe('s110')
    const merged = ladderRows(ofSpeeds([271, 247, 181, 165, 150, 120]), 154, cmp, C)
    expect(navigate(merged, 's271', 'ArrowDown')).toBe('s247')
    expect(navigate(merged, 's181', 'ArrowDown')).toBe('s165')
    expect(navigate(merged, 's150', 'ArrowDown')).toBe('s120')
    expect(focusAfterRemove(rows, 's178')).toBe('s160')
  })
})
