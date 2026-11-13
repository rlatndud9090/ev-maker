// 수용 기준 고정 입력의 주장을 코어·메타 직접 호출로 확인한다(카드 모델 함수를 쓰지 않는다).
import { describe, expect, it } from 'vitest'
import {
  CoreError,
  CoreInputError,
  checkSpeedSupport,
  judgeDamage,
  judgeSpeed,
  moveStatRefs,
  sweepDamage,
  sweepSpeed,
  validateSet,
  type BattleConditions,
  type PokemonSet,
  type SweepResult,
} from '../../core'
import type { MetaEntry } from '../../data/meta-schema'
import type { StatId } from '../../data/schema'
import { realData, syntheticView } from '../testing'
import { RANK_MEANS } from '../rankMeans'
import {
  EXAMPLE_SET,
  F1,
  F10,
  F11,
  F12,
  F2,
  F3,
  F4,
  F5,
  F6,
  F7,
  F8,
  F9,
  opponentSet,
  shellSideArmEntry,
  whiteHerbShellSmashEntry,
  withIllegalRepresentativeMove,
  type Boundary,
  type ExtremeCase,
  type OpponentRef,
} from './acceptance'
import { DEFAULT_ROLL_STEPS } from '../types'

/** 카드 입력과 같은 제품 판정 기준. 고정 상수는 이 기준으로 기록했다 */
const N = DEFAULT_ROLL_STEPS

const { game, bo1, bo3 } = realData()
const { spTotal, spMaxPerStat } = game.manifest.rules
const IGNORE_TOTAL = { ignoreSpTotal: true, rollSteps: N }
const OVER = { judgeOverBudget: true, rollSteps: N }

const total = (s: PokemonSet) => Object.values(s.sp).reduce((a, b) => a + b, 0)
const withSp = (s: PokemonSet, patch: Partial<Record<StatId, number>>): PokemonSet => ({ ...s, sp: { ...s.sp, ...patch } })
const entry = (id: string): MetaEntry => {
  const e = bo1.entry(id)
  if (!e) throw new Error(`Bo1 메타에 ${id}이 없다`)
  return e
}

function boundariesOf<T>(r: SweepResult<T>): Boundary[] {
  return r.boundaries.map((b) => {
    const from = r.cells[b - 1]
    const to = r.cells[b]
    if (from.kind !== 'ok' || to.kind !== 'ok') throw new Error('예산 밖 판정이 꺼진 스윕')
    return { sp: b, from: from.category, to: to.category }
  })
}

/** 스냅샷 분류 Status를 뺀 상대 기술 점유율 상위 5(동률 id 순). */
function topAttackMoves(e: MetaEntry): string[] {
  return Object.entries(e.moves.shares)
    .filter(([m]) => game.data.moves[m] && game.data.moves[m].category !== 'Status')
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, 5)
    .map(([m]) => m)
}

function coreErrorOf(f: () => unknown): { code?: string; field?: string } {
  try {
    f()
  } catch (e) {
    if (e instanceof CoreError) return { code: e.details[0].code, field: e.details[0].field }
    if (e instanceof CoreInputError) return { code: 'INPUT', field: e.field }
    throw e
  }
  throw new Error('거부되지 않았다')
}

describe('F9 예시 세트', () => {
  it('합계 66 이하로 검증을 통과하고 첫 기술이 내 A 또는 C를 참조한다', () => {
    validateSet(game, EXAMPLE_SET)
    expect(total(EXAMPLE_SET)).toBeLessThanOrEqual(spTotal)
    const refs = moveStatRefs(game, EXAMPLE_SET.moves[0])
    expect(refs.offense).toEqual({ owner: 'self', stat: 'atk' })
  })

  it('공격 탭: 예시 세트의 스톤샤워가 메가리자몽Y 대표에 대해 0~32 안에서 바뀐다', () => {
    const r = sweepDamage(game, { side: 'attacker', stat: 'atk' }, EXAMPLE_SET, opponentSet(bo1, F9.attack.opponent), F9.attack.move, undefined, undefined, OVER)
    expect(boundariesOf(r)).toEqual(F9.attack.boundaries)
  })

  it('스피드 탭: 대쓰여너 최대 S 묶음 대표에 대해 0~32 안에서 바뀐다', () => {
    const r = sweepSpeed(game, EXAMPLE_SET, opponentSet(bo1, F9.speed.opponent), undefined, OVER)
    expect(boundariesOf(r)).toEqual(F9.speed.boundaries)
  })
})

describe('F1 공격 탭 고정 입력', () => {
  it('잔여 예산 0 세트(합계 66)와 잔여 4 세트(합계 62)', () => {
    validateSet(game, F1.full)
    validateSet(game, F1.spare)
    expect(spTotal - total(F1.full)).toBe(F1.remaining.full)
    expect(spTotal - total(F1.spare)).toBe(F1.remaining.spare)
  })

  it('카드는 사용률 순이고 첫 카드는 상위 메타 포켓몬의 보존 배분이다', () => {
    const ranks = F1.cards.map((c) => entry(c.opponent.id).rank)
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks)
    expect(ranks[0]).toBeLessThanOrEqual(30)
    for (const c of F1.cards) {
      const share = entry(c.opponent.id).spreads.kept.find(([k]) => k === c.opponent.spread)?.[1]
      expect(share).toBeDefined()
      expect(share).toBeLessThanOrEqual(c.bundleShare)
    }
  })

  for (const which of ['full', 'spare'] as const) {
    it(`${which}: 현재 판정·경계·n이 코어 직접 호출과 같다`, () => {
      const mySet = F1[which]
      const current = mySet.sp[F1.sweepStat]
      const remaining = F1.remaining[which]
      for (const c of F1.cards) {
        const r = sweepDamage(game, { side: 'attacker', stat: F1.sweepStat }, mySet, opponentSet(bo1, c.opponent), F1.move, undefined, undefined, OVER)
        const cur = r.cells[current]
        expect(cur.kind === 'ok' && cur.category, c.opponent.spread).toBe(c.current)
        expect(boundariesOf(r), c.opponent.spread).toEqual(c.boundaries)
        expect(c.boundaries.map((b) => Math.max(0, b.sp - current - remaining))).toEqual(c.need[which])
        for (const cell of r.cells) expect(cell.kind === 'ok' && cell.overBudget === true).toBe(cell.sp > current + remaining)
      }
    })
  }

  const cats = (nature: string, ref: { id: string; spread: string }) =>
    sweepDamage(game, { side: 'attacker', stat: F1.sweepStat }, { ...F1.full, nature }, opponentSet(bo1, ref), F1.move, undefined, undefined, OVER).cells.map((c) =>
      c.kind === 'ok' ? c.category : 'x',
    )

  it('상승 성격으로만 바뀌는 상대: 현재(무보정)는 전 칸 같고 상승(고집)은 그 SP부터 한 단계 위', () => {
    const { opponent, fixed, label, plus } = F1.plusOnly
    expect(new Set(cats(F1.full.nature, opponent))).toEqual(new Set([fixed]))
    const p = cats(F1.plusNature, opponent)
    expect(p.findIndex((c) => c === label)).toBe(plus)
    expect(p.slice(0, plus).every((c) => c === fixed)).toBe(true)
  })

  it('두 성격 모두 같은 상대: 현재·상승 전 칸 같음', () => {
    const { opponent, fixed } = F1.bothSame
    expect(new Set([...cats(F1.full.nature, opponent), ...cats(F1.plusNature, opponent)])).toEqual(new Set([fixed]))
  })

  it('목표 대조 카드: 무보정·상승 최소 A', () => {
    const { opponent, current, label, neutral, plus } = F1.targetCard
    const n = cats(F1.full.nature, opponent)
    const p = cats(F1.plusNature, opponent)
    expect(n[F1.full.sp.atk]).toBe(current)
    expect([n.indexOf(label), p.indexOf(label)]).toEqual([neutral, plus])
  })
})

describe('F2 혼합 세트·사이코쇼크', () => {
  it('사이코쇼크는 특수기지만 상대 B를 참조한다', () => {
    validateSet(game, F2.mySet)
    expect(moveStatRefs(game, 'psyshock')).toMatchObject({ category: 'Special', defense: 'def' })
    expect(moveStatRefs(game, 'psychic')).toMatchObject({ category: 'Special', defense: 'spd' })
    expect(moveStatRefs(game, 'drainpunch')).toMatchObject({ category: 'Physical', defense: 'def' })
  })

  it('사이코쇼크 대미지는 상대 B로만 바뀐다', () => {
    const opp = opponentSet(bo1, F2.physical.opponent)
    const pct = (d: PokemonSet) => {
      const r = judgeDamage(game, 'attacker', F2.mySet, d, 'psyshock', undefined, undefined, IGNORE_TOTAL).value
      return r.kind === 'damage' ? r.maxPercent : NaN
    }
    expect(pct(withSp(opp, { def: 32 }))).toBeLessThan(pct(opp))
    expect(pct(withSp(opp, { spd: 32 }))).toBe(pct(opp))
  })

  it('물리 카드 대표(메가눈여아 사이코쇼크)·특수 카드 대표(짜랑고우거 사이코키네시스)에서 각각 판정이 바뀐다', () => {
    for (const side of [F2.physical, F2.special]) {
      const r = sweepDamage(game, { side: 'attacker', stat: F2.sweepStat }, F2.mySet, opponentSet(bo1, side.opponent), side.move, undefined, undefined, OVER)
      expect(boundariesOf(r), side.move).toEqual(side.boundaries)
    }
  })

  it('메가눈여아 대표에는 사이코쇼크가 세 기술 중 가장 세고, 짜랑고우거 물리 카드 대표에는 사이코키네시스가 무투자 확정1타', () => {
    const score = (ref: OpponentRef, move: string) => {
      const v = judgeDamage(game, 'attacker', F2.mySet, opponentSet(bo1, ref), move, undefined, undefined, { rollSteps: N }).value
      return v.kind === 'damage' ? [v.ohkoChance, v.maxPercent] : [-1, -1]
    }
    const beats = (a: number[], b: number[]) => a[0] > b[0] || (a[0] === b[0] && a[1] > b[1])
    for (const m of F2.mySet.moves.filter((x) => x !== F2.physical.move)) {
      expect(beats(score(F2.physical.opponent, F2.physical.move), score(F2.physical.opponent, m)), m).toBe(true)
    }
    const c = F2.crossDropped
    expect(beats(score(c.opponent, c.stronger), score(c.opponent, c.move))).toBe(true)
    const zero = { ...withSp(F2.mySet, { spa: 0 }), nature: 'serious' }
    expect(judgeDamage(game, 'attacker', zero, opponentSet(bo1, c.opponent), c.stronger, undefined, undefined, IGNORE_TOTAL).category).toBe('guaranteed-ohko')
  })
})

describe('F3 방어 탭 극단 필터', () => {
  const extremes = (c: ExtremeCase) => {
    const attacker = opponentSet(bo1, c.opponent)
    const stat = moveStatRefs(game, c.move).defense
    if (!stat) throw new Error(`${c.move}은 변화기다`)
    const at = (v: number, nature: string) =>
      judgeDamage(game, 'defender', attacker, withSp({ ...F3.mySet, nature }, { hp: v, [stat]: v }), c.move, undefined, undefined, IGNORE_TOTAL).category
    return { low: at(0, F3.mySet.nature), high: at(spMaxPerStat, F3.plusNature[stat as 'def' | 'spd']), currentHigh: at(spMaxPerStat, F3.mySet.nature) }
  }

  for (const [name, c] of [
    ['둘 다 확정 버팀', F3.bothSurvive],
    ['둘 다 확정1타', F3.bothOhko],
    ['통과', F3.passing],
    ['상승 성격으로만 통과', F3.plusOnly],
    ['상승 성격으로만 통과(가장 센 기술)', F3.plusOnlyStrongest],
  ] as const) {
    it(`${name}: ${c.opponent.id} ${c.move}`, () => {
      expect(topAttackMoves(entry(c.opponent.id))).toContain(c.move)
      const { low, high } = extremes(c)
      expect({ low, high }).toEqual({ low: c.low, high: c.high })
    })
  }

  it('상승 성격으로만 통과: 현재 성격 두 극단은 같다', () => {
    expect(extremes(F3.plusOnly)).toEqual({ low: F3.plusOnly.low, high: F3.plusOnly.high, currentHigh: F3.plusOnly.currentHigh })
    expect(F3.plusOnly.currentHigh).toBe(F3.plusOnly.low)
    expect(extremes(F3.plusOnlyStrongest)).toEqual({ low: F3.plusOnlyStrongest.low, high: F3.plusOnlyStrongest.high, currentHigh: F3.plusOnlyStrongest.currentHigh })
    expect(F3.plusOnlyStrongest.currentHigh).toBe(F3.plusOnlyStrongest.low)
  })

  it('둘 다 저난수 1타는 상위 30 × 공격기 상위 5 × 보존 배분 전부에서 사례가 없다', () => {
    expect(F3.bothLowRoll).toBeNull()
    const found: string[] = []
    for (const e of bo1.ranking.slice(0, 30)) {
      for (const move of topAttackMoves(e)) {
        if (moveStatRefs(game, move).categoryVaries) continue
        for (const [spread] of e.spreads.kept) {
          const c = { opponent: { id: e.id, spread }, move, low: 'low-roll-ohko', high: 'low-roll-ohko' } as const
          const r = extremes(c)
          if (r.low === 'low-roll-ohko' && r.high === 'low-roll-ohko') found.push(`${e.id} ${spread} ${move}`)
        }
      }
    }
    expect(found).toEqual([])
  })

  it('통과한 기술의 H 행·B 행 경계', () => {
    const attacker = opponentSet(bo1, F3.passing.opponent)
    const h = sweepDamage(game, { side: 'defender', stat: 'hp' }, attacker, F3.mySet, F3.passing.move, undefined, undefined, OVER)
    const b = sweepDamage(game, { side: 'defender', stat: 'def' }, attacker, F3.mySet, F3.passing.move, undefined, undefined, OVER)
    expect(boundariesOf(h)).toEqual(F3.passing.hpBoundaries)
    expect(boundariesOf(b)).toEqual(F3.passing.defBoundaries)
  })
})

describe('F4 스피드 탭', () => {
  const tailwind = (side: 'attacker' | 'defender'): BattleConditions => ({ [side]: { tailwind: true } })

  it('스카프 ≥ 10%·대표 도구 스카프 아님 → 스카프를 씌우면 전 칸 후공', () => {
    const e = entry(F4.scarf.opponent.id)
    expect(e.items.shares.choicescarf).toBe(F4.scarf.scarfShare)
    expect(F4.scarf.scarfShare).toBeGreaterThanOrEqual(0.1)
    const opp = opponentSet(bo1, F4.scarf.opponent)
    expect(opp.item).toBe(F4.scarf.item)
    const r = sweepSpeed(game, F4.mySet, { ...opp, item: 'choicescarf' }, undefined, OVER)
    expect(new Set(r.cells.map((c) => c.kind === 'ok' && c.category))).toEqual(new Set([F4.scarf.scarfOrder]))
  })

  it('스카프 < 10% 상대의 기본 행 경계', () => {
    expect(entry(F4.noScarf.opponent.id).items.shares.choicescarf).toBe(F4.noScarf.scarfShare)
    expect(F4.noScarf.scarfShare).toBeLessThan(0.1)
    const r = sweepSpeed(game, F4.mySet, opponentSet(bo1, F4.noScarf.opponent), undefined, OVER)
    expect(boundariesOf(r)).toEqual(F4.noScarf.boundaries)
  })

  it('대표 도구 스카프 → 스카프를 뺀 최다 도구로 바꾼 행은 판정이 바뀐다', () => {
    const e = entry(F4.nonScarf.opponent.id)
    const opp = opponentSet(bo1, F4.nonScarf.opponent)
    expect(opp.item).toBe('choicescarf')
    const [top] = Object.entries(e.items.shares).filter(([k]) => k !== 'choicescarf').sort((a, b) => b[1] - a[1])
    expect(top[0]).toBe(F4.nonScarf.item)
    const base = sweepSpeed(game, F4.mySet, opp, undefined, OVER)
    expect(new Set(base.cells.map((c) => c.kind === 'ok' && c.category))).toEqual(new Set([F4.nonScarf.baseOrder]))
    const alt = sweepSpeed(game, F4.mySet, { ...opp, item: F4.nonScarf.item }, undefined, OVER)
    expect(boundariesOf(alt)).toEqual(F4.nonScarf.boundaries)
  })

  it('내 순풍·상대 순풍으로 현재 판정이 바뀐다', () => {
    const mine = opponentSet(bo1, F4.myTailwind.opponent)
    expect(judgeSpeed(game, F4.mySet, mine).category).toBe(F4.myTailwind.off)
    expect(judgeSpeed(game, F4.mySet, mine, tailwind('attacker')).category).toBe(F4.myTailwind.on)
    const theirs = opponentSet(bo1, F4.opponentTailwind.opponent)
    expect(judgeSpeed(game, F4.mySet, theirs).category).toBe(F4.opponentTailwind.off)
    expect(judgeSpeed(game, F4.mySet, theirs, tailwind('defender')).category).toBe(F4.opponentTailwind.on)
  })
})

describe('F5 랭크 행', () => {
  it('위협 점유율 10% 경계 양쪽 사례', () => {
    expect(entry(F5.threat.opponent).abilities[F5.threat.ability]).toBe(F5.threat.share)
    expect(F5.threat.share).toBeGreaterThanOrEqual(0.1)
    const below = entry(F5.threatBelow.opponent)
    expect(below.abilities[F5.threatBelow.ability]).toBe(F5.threatBelow.share)
    expect(F5.threatBelow.share).toBeLessThan(0.1)
    expect(below.rank).toBeGreaterThan(30)
  })

  it('오기·비오기 내 세트의 랭크 차이가 대미지에 드러난다', () => {
    for (const s of [F5.defiant.mySet, F5.nonDefiant.mySet, F5.swordsDance.mySet]) validateSet(game, s)
    expect(F5.swordsDance.mySet.moves).toContain('swordsdance')
    expect(F5.defiant.mySet.moves).not.toContain('swordsdance')
    const opp = opponentSet(bo1, { id: F5.threat.opponent, spread: entry(F5.threat.opponent).spreads.kept[0][0] })
    const pct = (s: PokemonSet) => {
      const r = judgeDamage(game, 'attacker', s, opp, F5.move).value
      return r.kind === 'damage' ? r.maxPercent : NaN
    }
    const up = pct({ ...F5.defiant.mySet, boosts: F5.defiant.myBoosts })
    const down = pct({ ...F5.nonDefiant.mySet, boosts: F5.nonDefiant.myBoosts })
    expect(up).toBeGreaterThan(down)
  })
})

describe('F6·F10 목록 밖 타겟', () => {
  const inMeta = (id: string) => bo1.entry(id) !== undefined || bo3.entry(id) !== undefined

  it('목록 밖 종·메가 폼은 로스터에 있고 Bo1·Bo3 메타에 없다', () => {
    for (const id of [F6.outside, F6.outsideMega.rosterId]) {
      expect(game.data.species[id], id).toBeDefined()
      expect(inMeta(id), id).toBe(false)
    }
    expect(game.data.megas).toContainEqual({ base: F6.outsideMega.base, forme: F6.outsideMega.rosterId, stone: F6.outsideMega.stone })
    expect(bo1.entry(F6.conflict)).toBeDefined()
  })

  it('워시로토무 타겟 기술: 물리·특수·랭크 수단', () => {
    const learnset = game.data.species[F10.rosterId].learnset
    for (const m of F10.moves) expect(learnset, m).toContain(m)
    expect(moveStatRefs(game, F10.physical).category).toBe('Physical')
    expect(moveStatRefs(game, F10.special).category).toBe('Special')
    expect(RANK_MEANS.some((r) => r.kind === 'move' && r.id === F10.rankMeans && r.target === 'opponent')).toBe(true)
    const ability = game.data.species[F10.rosterId].abilities[0]
    const noInvestment = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }
    validateSet(game, { regulation: game.manifest.regulation.id, species: F10.rosterId, ability, nature: 'hardy', sp: noInvestment, moves: [...F10.moves] })
  })
})

describe('F7 오류 격리', () => {
  it('방어 탭 행 오류: 상위 5 안의 엔진 미지원 기술', () => {
    const e = entry(F7.rowError.opponent)
    expect(topAttackMoves(e)).toContain(F7.rowError.move)
    const opp = opponentSet(bo1, { id: e.id, spread: e.spreads.kept[0][0] })
    expect(coreErrorOf(() => judgeDamage(game, 'defender', opp, EXAMPLE_SET, F7.rowError.move))).toEqual({ code: F7.rowError.code, field: F7.rowError.field })
  })

  it('공격 탭 상대 특성 오류: 탈', () => {
    const e = entry(F7.opponentAbilityError.opponent)
    const opp = opponentSet(bo1, { id: e.id, spread: e.spreads.kept[0][0] })
    expect(coreErrorOf(() => judgeDamage(game, 'attacker', EXAMPLE_SET, opp, EXAMPLE_SET.moves[0]))).toEqual({
      code: F7.opponentAbilityError.code,
      field: F7.opponentAbilityError.field,
    })
  })

  it('상대 세트 해석 실패 레시피', () => {
    const e = withIllegalRepresentativeMove(entry(F7.opponentCardError.opponent), F7.opponentCardError.illegalMove)
    expect(coreErrorOf(() => validateSet(game, e.representative.set)).code).toBe(F7.opponentCardError.code)
  })

  it('내 세트 오류: 합계 초과 / 스피드 탭만 / 방어 탭만', () => {
    expect(coreErrorOf(() => validateSet(game, F7.mySet.spTotal.set)).code).toBe(F7.mySet.spTotal.code)

    validateSet(game, F7.mySet.speedOnly.set)
    expect(coreErrorOf(() => checkSpeedSupport(game, F7.mySet.speedOnly.set))).toEqual({ code: 'INPUT', field: F7.mySet.speedOnly.field })

    const d = F7.mySet.defenseOnly
    validateSet(game, d.set)
    checkSpeedSupport(game, d.set)
    const attacker = opponentSet(bo1, d.attacker)
    expect(coreErrorOf(() => judgeDamage(game, 'defender', attacker, d.set, d.move)).field).toBe(d.field)
    expect(judgeDamage(game, 'attacker', d.set, attacker, d.set.moves[0]).category).toBeDefined()
  })
})

describe('F8 셸암즈·하양허브 연속기', () => {
  const metaUsers = (move: string) => [...bo1.ranking, ...bo3.ranking].filter((e) => (e.moves.shares[move] ?? 0) > 0).map((e) => e.id)

  it('셸암즈는 분류 가변이고 실제 메타 사용자가 없다', () => {
    expect(moveStatRefs(game, 'shellsidearm').categoryVaries).toBe(true)
    validateSet(game, F8.myShellSideArm)
    expect(metaUsers('shellsidearm')).toEqual([])
  })

  it('상대 셸암즈 레시피는 합성 뷰에 들어가고 대표 세트가 검증을 통과한다', () => {
    const synthetic = shellSideArmEntry(entry('farigiraf'))
    const view = syntheticView(game, bo1.meta, [...bo1.ranking, synthetic])
    const e = view.entry(F8.opponentShellSideArm)
    expect(e).toBeDefined()
    validateSet(game, e!.representative.set)
    expect(topAttackMoves(e!)).toContain('shellsidearm')
  })

  it('내 하양허브 + 껍질깨기 + 연속기', () => {
    const w = F8.myWhiteHerb
    validateSet(game, w.mySet)
    expect(w.mySet.item).toBe('whiteherb')
    expect(RANK_MEANS.find((r) => r.id === w.means)?.boosts).toMatchObject({ def: -1, spd: -1 })
    expect(game.data.moves[w.multihit].multihit).toBeDefined()
    expect(game.data.moves[w.other].multihit).toBeUndefined()
  })

  it('상대 하양허브 + 껍질깨기 + 연속기는 실제 메타에 없어 레시피로 만든다', () => {
    const w = F8.opponentWhiteHerb
    const real = [...bo1.ranking, ...bo3.ranking].filter(
      (e) => (e.items.shares.whiteherb ?? 0) > 0 && (e.moves.shares[w.means] ?? 0) > 0 && topAttackMoves(e).some((m) => game.data.moves[m].multihit !== undefined),
    )
    expect(real.map((e) => e.id)).toEqual([])
    const synthetic = whiteHerbShellSmashEntry(entry('sneasler'))
    const view = syntheticView(game, bo1.meta, [...bo1.ranking, synthetic])
    const e = view.entry(w.opponent)!
    validateSet(game, e.representative.set)
    expect(e.representative.set.item).toBe('whiteherb')
    expect(e.moves.shares[w.means]).toBeGreaterThanOrEqual(0.1)
    expect(topAttackMoves(e)).toContain(w.multihit)
  })
})

describe('F11 관여 능력치 S', () => {
  it('스피드 의존 기술만 내 S에 따라 대미지가 바뀐다', () => {
    const opp = opponentSet(bo1, F11.opponent)
    const pct = (s: PokemonSet, move: string, spe: number) => {
      const r = judgeDamage(game, 'attacker', withSp(s, { spe }), opp, move, undefined, undefined, IGNORE_TOTAL).value
      return r.kind === 'damage' ? r.maxPercent : NaN
    }
    const [lo, hi] = F11.speeds
    validateSet(game, F11.dependent.mySet)
    validateSet(game, F11.independent.mySet)
    expect(moveStatRefs(game, F11.dependent.move).speedDependent).toBe(true)
    expect(moveStatRefs(game, F11.independent.move).speedDependent).toBe(false)
    expect(pct(F11.dependent.mySet, F11.dependent.move, lo)).not.toBe(pct(F11.dependent.mySet, F11.dependent.move, hi))
    expect(pct(F11.independent.mySet, F11.independent.move, lo)).toBe(pct(F11.independent.mySet, F11.independent.move, hi))
  })
})

describe('F12 카드·조건당 가장 센 기술(현재 세트 단건 판정)', () => {
  const ROLL = { rollSteps: N }
  const round1 = (x: number) => Math.round(x * 10) / 10
  /** 내가 공격(공격 탭) 또는 상대가 나를 공격(방어 탭)하는 현재 세트 단건 판정 */
  const probe = (attacker: PokemonSet, defender: PokemonSet, move: string, side: 'attacker' | 'defender') => {
    const v = judgeDamage(game, side, attacker, defender, move, undefined, undefined, ROLL).value
    return v.kind === 'damage' ? { ohko: v.ohkoChance, maxPercent: round1(v.maxPercent) } : 'immune'
  }
  const mine = (my: PokemonSet, ref: Parameters<typeof opponentSet>[1], move: string) => probe(my, opponentSet(bo1, ref), move, 'attacker')
  const theirs = (my: PokemonSet, ref: Parameters<typeof opponentSet>[1], move: string) => probe(opponentSet(bo1, ref), my, move, 'defender')

  it('포푸니크: 분함의발구르기가 1타 확률 같은 지진보다 최대 대미지가 커 가장 세고, 무투자·무보정에서도 확정1타다', () => {
    const c = F12.sneasler
    for (const [move, want] of Object.entries(c.probe)) expect(mine(c.mySet, c.opponent, move), move).toEqual(want)
    expect(c.mySet.moves).toEqual(['earthquake', 'dragonclaw', 'rockslide', 'stompingtantrum'])
    const zero = { ...withSp(c.mySet, { atk: 0 }), nature: 'serious' }
    expect(judgeDamage(game, 'attacker', zero, opponentSet(bo1, c.opponent), c.chosen, undefined, undefined, { ...ROLL, ignoreSpTotal: true }).category).toBe('guaranteed-ohko')
  })

  it('동률(1타 확률·최대 대미지 비율 모두 같음): 지진 = 분함의발구르기', () => {
    const c = F12.slotTie
    expect(mine(c.mySet, c.opponent, c.chosen)).toEqual(c.probe)
    expect(mine(c.mySet, c.opponent, c.tiedWith)).toEqual(c.probe)
    expect(c.mySet.moves.indexOf(c.chosen)).toBeLessThan(c.mySet.moves.indexOf(c.tiedWith))
  })

  it('방어 탭 1타 확률 동률 → 최대 대미지 비율: 파멸의빛 > 문포스', () => {
    const c = F12.maxPercentTie
    for (const [move, want] of Object.entries(c.probe)) expect(theirs(c.mySet, c.opponent, move), move).toEqual(want)
    expect(topAttackMoves(entry(c.opponent.id))).toEqual(expect.arrayContaining([c.chosen, c.over]))
  })

  it('선공기: 기습은 도각참보다 약하고 우선도 > 0, 테일아머(키키링) 상대에게는 무효', () => {
    const c = F12.priority
    for (const [move, want] of Object.entries(c.probe)) expect(mine(c.mySet, c.opponent, move), move).toEqual(want)
    expect(game.data.moves[c.kept].priority).toBeGreaterThan(0)
    expect(game.data.moves[c.chosen].priority).toBe(0)
    expect(mine(c.mySet, c.immune.opponent, c.immune.move)).toBe('immune')
  })

  it('방어 탭: 대도각참 상위 5 후보 중 도각참이 나에게 가장 세다(기습은 선공기)', () => {
    const c = F12.defense
    const moves = topAttackMoves(entry(c.opponent.id))
    expect(moves).toEqual(expect.arrayContaining([c.chosen, c.kept, ...c.dropped]))
    for (const [move, want] of Object.entries(c.probe)) expect(theirs(c.mySet, c.opponent, move), move).toEqual(want)
    const best = theirs(c.mySet, c.opponent, c.chosen)
    for (const m of moves.filter((x) => x !== c.chosen)) {
      const r = theirs(c.mySet, c.opponent, m)
      if (r === 'immune' || best === 'immune') continue
      expect(r.ohko <= best.ohko && r.maxPercent < best.maxPercent, m).toBe(true)
    }
    expect(game.data.moves[c.kept].priority).toBeGreaterThan(0)
  })

  it('SP를 바꾸면 가장 센 기술이 분류를 넘어 바뀐다: 메가후딘 C32 사이코키네시스 → A32 드레인펀치', () => {
    const c = F12.spSwitch
    validateSet(game, c.moved)
    for (const [set, want] of [
      [c.mySet, c.special],
      [c.moved, c.physical],
    ] as const) {
      for (const [move, pct] of Object.entries(want.probe)) {
        const r = mine(set, c.opponent, move)
        expect(r === 'immune' ? r : r.maxPercent, move).toBe(pct)
        if (r !== 'immune') expect(r.ohko).toBe(0)
      }
    }
  })
})
