import { describe, expect, it } from 'vitest'
import { finalSpeed, minSpToOutspeed, type PokemonSet } from '../core'
import { SPEED_MIN_SP_LEGACY } from './__fixtures__/speedMinSpLegacy'
import { buildSpeedChart, type SpeedBadge, type SpeedChartModel } from './speedChart'
import {
  compareInRow,
  focusAfterRemove,
  ladderRows,
  minSpToPass,
  navigate,
  speedBaseline,
  statusOf,
  visibleBadges,
  type LadderRow,
  type SpeedBaseline,
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
