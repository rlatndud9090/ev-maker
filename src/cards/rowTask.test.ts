import { describe, expect, it } from 'vitest'
import { judgeDamage, judgeSpeed, moveStatRefs, sweepDamage, sweepSpeed } from '../core'
import type { PokemonSet, SpTable } from '../core'
import { createLruCache } from './cache'
import { judgementKey } from './key'
import { computeRowTask } from './rowTask'
import { card, filter, fixed, game, plan, row, sp } from './__fixtures__/handPlan'
import type { JudgementCache, RowSpec, RowTask, TabPlan } from './types'
import { DEFAULT_ROLL_STEPS } from './types'

/** 카드 입력과 같은 제품 고난수 기준(cardInput 기본값). 코어 직접 호출 기대값도 이 기준의 5단 판정으로 낸다 */
const N = DEFAULT_ROLL_STEPS

const reg = game.manifest.regulation.id
const mk = (species: string, ability: string, s: Partial<SpTable>, extra: Partial<PokemonSet> = {}): PokemonSet => ({
  regulation: reg,
  species,
  ability,
  nature: 'hardy',
  sp: sp(s),
  moves: [],
  ...extra,
})

const kingambit = mk('kingambit', 'defiant', { hp: 32, atk: 16, spe: 18 }, { moves: ['suckerpunch', 'foulplay'] })
const delphox = mk('delphox', 'blaze', { hp: 2 }, { item: 'delphoxite', mega: true, moves: ['flareblitz'] })
const IGNORE = { ignoreSpTotal: true, rollSteps: N }
const OVER = { judgeOverBudget: true, rollSteps: N }
const BOUNDARIES_14 = [16, 19]

function attackPlan(over: Partial<RowSpec> = {}): TabPlan {
  const r: RowSpec = {
    ...row({ id: 'r', cardId: 'A', stat: 'atk', natures: { stat: 'atk', neutral: 'hardy', plus: 'adamant' } }),
    moveId: 'suckerpunch',
    attacker: kingambit,
    defender: delphox,
    ...over,
  }
  if (r.moveId !== undefined && game.data.moves[r.moveId]?.category !== 'Status') r.refs = moveStatRefs(game, r.moveId)
  const sr: RowSpec = { ...row({ id: 's', cardId: 'A', order: 1, stat: 'spe' }), judge: 'speed', attacker: kingambit, defender: delphox }
  delete sr.moveId
  return plan({
    cards: [card({ id: 'A', rowIds: ['r', 's'], fixedIds: ['x'] })],
    rows: [r, sr],
    fixed: [{ ...fixed('x', 'A'), attacker: kingambit, defender: delphox }],
    mySp: kingambit.sp,
  })
}

function defensePlan(): TabPlan {
  const me = mk('kingambit', 'defiant', { hp: 20, def: 10, atk: 32 })
  return plan({
    mySide: 'defender',
    cards: [card({ id: 'D', filterIds: ['f'] })],
    filters: [
      { ...filter('f', 'D', 0, { stat: 'def', neutral: 'hardy', plus: 'bold' }), moveId: 'flareblitz', attacker: delphox, defender: me, stats: ['hp', 'def'] },
    ],
    mySp: me.sp,
  })
}

const atk = (s: PokemonSet, v: number): PokemonSet => ({ ...s, sp: { ...s.sp, atk: v } })

describe('computeRowTask: 코어 판정 그대로', () => {
  const p = attackPlan()

  it('ends: 스윕 능력치 0·최대(현재 성격) + 무보정 0·상승 최대를 ignoreSpTotal로 단건 판정', () => {
    const r = computeRowTask(p, { kind: 'ends', rowId: 'r' })
    if (r.kind !== 'ends') throw new Error(r.kind)
    const lo = judgeDamage(game, 'attacker', atk(kingambit, 0), delphox, 'suckerpunch', {}, undefined, IGNORE)
    const hi = judgeDamage(game, 'attacker', atk(kingambit, 32), delphox, 'suckerpunch', {}, undefined, IGNORE)
    const plusHi = judgeDamage(game, 'attacker', { ...atk(kingambit, 32), nature: 'adamant' }, delphox, 'suckerpunch', {}, undefined, IGNORE)
    expect(r.low).toMatchObject({ sp: 0, category: lo.category })
    expect(r.high).toMatchObject({ sp: 32, category: hi.category })
    expect(r.range.low).toEqual(r.low)
    if (plusHi.value.kind !== 'damage') throw new Error(plusHi.value.kind)
    expect(r.range.high).toMatchObject({ sp: 32, category: plusHi.category, ohkoChance: plusHi.value.ohkoChance })
    if (hi.value.kind !== 'damage') throw new Error(hi.value.kind)
    expect(r.high.ohkoChance).toBe(hi.value.ohkoChance)
    expect(r.high.maxPercent).toBe(hi.value.maxPercent)
  })

  it('sweep: sweepDamage(judgeOverBudget) 직접 호출과 칸 범주·값이 같다(예산 밖 칸 포함)', () => {
    const r = computeRowTask(p, { kind: 'sweep', rowId: 'r', stage: 2 })
    if (r.kind !== 'sweep') throw new Error(r.kind)
    const direct = sweepDamage(game, { side: 'attacker', stat: 'atk' }, kingambit, delphox, 'suckerpunch', {}, undefined, OVER)
    expect(r.cells).toHaveLength(33)
    direct.cells.forEach((c, i) => {
      if (c.kind !== 'ok' || c.value.kind !== 'damage') throw new Error('예상 밖 칸')
      expect(r.cells[i]).toEqual({ sp: c.sp, category: c.category, ohkoChance: c.value.ohkoChance, minPercent: c.value.minPercent, maxPercent: c.value.maxPercent })
    })
    // 제품 5단 판정(고난수 14/16)의 경계. 코어 기본 3단(0.75)이면 [13, 19]
    expect(direct.boundaries).toEqual(BOUNDARIES_14)
    expect(direct.cells.some((c) => c.kind === 'ok' && c.overBudget)).toBe(true)
  })

  it('variant: 내 쪽 세트 성격만 바꾼 sweepDamage와 같다', () => {
    const r = computeRowTask(p, { kind: 'variant', rowId: 'r', nature: 'plus' })
    if (r.kind !== 'variant') throw new Error(r.kind)
    const direct = sweepDamage(game, { side: 'attacker', stat: 'atk' }, { ...kingambit, nature: 'adamant' }, delphox, 'suckerpunch', {}, undefined, OVER)
    expect(r.nature).toBe('plus')
    expect(r.cells.map((c) => [c.category, c.ohkoChance])).toEqual(
      direct.cells.map((c) => (c.kind === 'ok' && c.value.kind === 'damage' ? [c.category, c.value.ohkoChance] : ['x', 0])),
    )
    const neutral = computeRowTask(p, { kind: 'variant', rowId: 'r', nature: 'neutral' })
    expect(neutral).toEqual({ ...computeRowTask(p, { kind: 'sweep', rowId: 'r', stage: 2 }), kind: 'variant', nature: 'neutral' })
  })

  it('speed: 양 끝·스윕이 judgeSpeed·sweepSpeed와 같고 내 쪽/상대 스피드를 담는다', () => {
    const e = computeRowTask(p, { kind: 'ends', rowId: 's' })
    if (e.kind !== 'ends') throw new Error(e.kind)
    const hi = judgeSpeed(game, { ...kingambit, sp: { ...kingambit.sp, spe: 32 } }, delphox, {}, IGNORE)
    expect(e.high).toEqual({ sp: 32, category: hi.category, mySpeed: hi.value.attackerSpeed, opponentSpeed: hi.value.defenderSpeed })
    const s = computeRowTask(p, { kind: 'sweep', rowId: 's', stage: 3 })
    if (s.kind !== 'sweep') throw new Error(s.kind)
    const direct = sweepSpeed(game, kingambit, delphox, {}, OVER)
    expect(s.cells.map((c) => c.category)).toEqual(direct.cells.map((c) => (c.kind === 'ok' ? c.category : 'x')))
  })

  it('extreme: 낮은 극단 = H0·B0·무보정, 높은 극단 = H32·B32·B 상승 성격의 방어측 판정', () => {
    const d = defensePlan()
    const r = computeRowTask(d, { kind: 'extreme', filterId: 'f' })
    if (r.kind !== 'extreme') throw new Error(r.kind)
    const me = d.filters.f.defender
    const lo = judgeDamage(game, 'defender', delphox, { ...me, sp: { ...me.sp, hp: 0, def: 0 } }, 'flareblitz', {}, undefined, IGNORE)
    const hi = judgeDamage(game, 'defender', delphox, { ...me, nature: 'bold', sp: { ...me.sp, hp: 32, def: 32 } }, 'flareblitz', {}, undefined, IGNORE)
    expect([r.low.sp, r.low.category, r.high.sp, r.high.category]).toEqual([0, lo.category, 32, hi.category])
    if (hi.value.kind !== 'damage') throw new Error(hi.value.kind)
    expect(r.high.ohkoChance).toBe(hi.value.ohkoChance)
  })

  it('pair: 성격 변형마다 그 성격 세트의 판정으로 최소 조합을 낸다', () => {
    const d = defensePlan()
    const me = d.filters.f.defender
    const judgeAt = (nature: string, hp: number, def: number) =>
      judgeDamage(game, 'defender', delphox, { ...me, nature, sp: { ...me.sp, hp, def } }, 'flareblitz', {}, undefined, IGNORE).category
    for (const [nature, id] of [
      ['neutral', 'hardy'],
      ['plus', 'bold'],
    ] as const) {
      const r = computeRowTask(d, { kind: 'pair', filterId: 'f', nature })
      if (r.kind !== 'pair') throw new Error(r.kind)
      expect(r.nature).toBe(nature)
      for (const pt of r.points) expect(judgeAt(id, pt.hp, pt.defense)).toBe(pt.label)
    }
  })

  it('fixed: 세트 그대로 공격 관점 단건 판정', () => {
    const r = computeRowTask(p, { kind: 'fixed', fixedId: 'x' })
    if (r.kind !== 'fixed') throw new Error(r.kind)
    expect(r.cell.category).toBe(judgeDamage(game, 'attacker', kingambit, delphox, 'foulplay', undefined, undefined, { rollSteps: N }).category)
  })

  it('코어 도메인 오류는 이유로 담고 캐시하지 않는다, 그 밖 예외는 다시 던진다', () => {
    const bad = attackPlan({ moveId: 'flareblitz' })
    const cache = createLruCache()
    const r = computeRowTask(bad, { kind: 'ends', rowId: 'r' }, cache)
    expect(r).toMatchObject({ kind: 'error', task: { kind: 'ends', rowId: 'r' }, reason: { code: 'ILLEGAL_MOVE' } })
    expect(cache.size).toBe(0)
    const status = computeRowTask(attackPlan({ moveId: 'swordsdance', attacker: { ...kingambit, moves: ['swordsdance'] } }), { kind: 'ends', rowId: 'r' })
    expect(status).toMatchObject({ kind: 'error', reason: { code: 'INPUT', field: 'move' } })
    expect(() => computeRowTask(p, { kind: 'ends', rowId: 'nope' })).toThrow(Error)
  })
})

describe('캐시·judgementKey', () => {
  const counting = (): JudgementCache & { hits: number } => {
    const inner = createLruCache()
    const c = {
      hits: 0,
      get(k: string) {
        const v = inner.get(k)
        if (v !== undefined) c.hits++
        return v
      },
      set: (k: string, v: Parameters<JudgementCache['set']>[1]) => inner.set(k, v),
      clear: () => inner.clear(),
      get size() {
        return inner.size
      },
    }
    return c
  }
  const tasks: RowTask[] = [
    { kind: 'ends', rowId: 'r' },
    { kind: 'sweep', rowId: 'r', stage: 2 },
    { kind: 'ends', rowId: 's' },
    { kind: 'sweep', rowId: 's', stage: 3 },
    { kind: 'fixed', fixedId: 'x' },
    { kind: 'variant', rowId: 'r', nature: 'plus' },
  ]

  it('캐시 경유 결과 = 무캐시 결과, 두 번째는 전부 적중', () => {
    const p = attackPlan()
    const cache = counting()
    const first = tasks.map((t) => computeRowTask(p, t, cache))
    const second = tasks.map((t) => computeRowTask(p, t, cache))
    expect(first).toEqual(tasks.map((t) => computeRowTask(p, t)))
    expect(second).toEqual(first)
    expect(cache.hits).toBe(tasks.length)
  })

  it('관여하지 않는 SP·기술 목록은 키에 없고, 관여 SP·조건은 키를 바꾼다', () => {
    const base = attackPlan()
    const key = (p: TabPlan, t: RowTask) => judgementKey(p, t)
    const t: RowTask = { kind: 'sweep', rowId: 'r', stage: 2 }
    const myHp = attackPlan({ attacker: { ...kingambit, sp: { ...kingambit.sp, hp: 0 }, moves: ['suckerpunch'] } })
    expect(key(myHp, t)).toBe(key(base, t))
    const myAtk = attackPlan({ attacker: atk(kingambit, 3) })
    expect(key(myAtk, t)).toBe(key(base, t))
    expect(key(myAtk, { kind: 'fixed', fixedId: 'x' })).toBe(key(base, { kind: 'fixed', fixedId: 'x' }))
    const oppDef = attackPlan({ defender: { ...delphox, sp: { ...delphox.sp, def: 5 } } })
    expect(key(oppDef, t)).not.toBe(key(base, t))
    const tail = attackPlan({ conditions: { attacker: { tailwind: true } } })
    expect(key(tail, t)).not.toBe(key(base, t))
    expect(key(base, { kind: 'ends', rowId: 'r' })).not.toBe(key(base, t))
    expect(key(base, { kind: 'sweep', rowId: 'r', stage: 3 })).toBe(key(base, t))
    const boosted = attackPlan({ attacker: { ...kingambit, boosts: { atk: 2, spe: 0 } } })
    expect(key(boosted, t)).toBe(key(attackPlan({ attacker: { ...kingambit, boosts: { atk: 2 } } }), t))
    expect(key(boosted, t)).not.toBe(key(base, t))
  })

  it('rollSteps·성격 변형은 키를 가르고, 변형 스윕은 그 성격 세트의 sweep과 같은 키를 쓴다', () => {
    const base = attackPlan()
    const sweepT: RowTask = { kind: 'sweep', rowId: 'r', stage: 2 }
    const plusT: RowTask = { kind: 'variant', rowId: 'r', nature: 'plus' }
    expect(judgementKey({ ...base, rollSteps: 13 }, sweepT)).not.toBe(judgementKey(base, sweepT))
    expect(judgementKey(base, plusT)).not.toBe(judgementKey(base, sweepT))
    expect(judgementKey(base, plusT)).toBe(judgementKey(attackPlan({ attacker: { ...kingambit, nature: 'adamant' } }), sweepT))
    expect(judgementKey(base, { kind: 'variant', rowId: 'r', nature: 'neutral' })).toBe(judgementKey(base, sweepT))
    const otherPlus = attackPlan()
    otherPlus.rows.r.natures = { stat: 'atk', neutral: 'hardy', plus: 'lonely' }
    expect(judgementKey(otherPlus, { kind: 'ends', rowId: 'r' })).not.toBe(judgementKey(base, { kind: 'ends', rowId: 'r' }))
    const d = defensePlan()
    const pairKey = (nature: 'neutral' | 'plus') => judgementKey(d, { kind: 'pair', filterId: 'f', nature })
    expect(pairKey('neutral')).not.toBe(pairKey('plus'))
    const e = defensePlan()
    e.filters.f.natures = { stat: 'def', neutral: 'hardy', plus: 'impish' }
    expect(judgementKey(e, { kind: 'extreme', filterId: 'f' })).not.toBe(judgementKey(d, { kind: 'extreme', filterId: 'f' }))
    // 스피드 판정은 rollSteps와 무관
    const s: RowTask = { kind: 'sweep', rowId: 's', stage: 2 }
    expect(judgementKey({ ...base, rollSteps: 3 }, s)).toBe(judgementKey(base, s))
  })

  it('스피드 키는 양쪽 spe만 SP로 쓴다', () => {
    const t: RowTask = { kind: 'sweep', rowId: 's', stage: 2 }
    const p = attackPlan()
    const q = { ...p, rows: { ...p.rows, s: { ...p.rows.s, defender: { ...delphox, sp: { ...delphox.sp, hp: 30, atk: 9 } } } } }
    expect(judgementKey(q, t)).toBe(judgementKey(p, t))
    const r = { ...p, rows: { ...p.rows, s: { ...p.rows.s, defender: { ...delphox, sp: { ...delphox.sp, spe: 9 } } } } }
    expect(judgementKey(r, t)).not.toBe(judgementKey(p, t))
  })
})
