import { describe, expect, it } from 'vitest'
import type { PokemonSet } from '../core'
import type { StatId } from '../data/schema'
import { deriveLocks, type CutLock, type LockResolution, type LockStage, type LockTargetKey, type Stairs } from './lock'
import { pinMenuView, type PinMenuInput, type PinMenuView } from './lockPin'
import { realData } from './testing'
import type { AdjustOption, AdjustStat, LockStageCandidate } from './types'

const { game } = realData()

const mySet = (nature = 'hardy'): PokemonSet => ({
  regulation: game.manifest.regulation.id,
  species: 'raichu',
  ability: 'static',
  nature,
  sp: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
  moves: [],
})
const target = (kind: 'attack' | 'defense', opponentId: string): LockTargetKey => ({
  kind,
  source: 'ladder',
  opponentId,
  category: 'physical',
  bundle: { ladder: 'k' },
  item: null,
  itemKey: 'earthquake',
})
const stairs = (f: (hp: number) => number | null): Stairs => Array.from({ length: 33 }, (_, hp) => f(hp))
const single = (stat: StatId, neutral: number | null, plus: number | null): LockResolution => ({ kind: 'ok', options: { shape: 'single', stat, neutral, plus } })
const pair = (defense: 'def' | 'spd', neutral: Stairs | null, plus: Stairs | null): LockResolution => ({ kind: 'ok', options: { shape: 'pair', defense, neutral, plus } })

const attackStage = (stage: LockStage, resolution: LockResolution, opponentId = 'opp', stat: StatId = 'atk'): LockStageCandidate => ({
  stage,
  candidate: { kind: 'ready', lock: { kind: 'attack', target: target('attack', opponentId), stage, stats: [stat] }, resolution },
})
const defenseStage = (stage: LockStage, resolution: LockResolution, defense: 'def' | 'spd' = 'def', opponentId = 'opp'): LockStageCandidate => ({
  stage,
  candidate: { kind: 'ready', lock: { kind: 'defense', target: target('defense', opponentId), stage, stats: ['hp', defense] }, resolution },
})

const view = (input: Partial<PinMenuInput> & Pick<PinMenuInput, 'side' | 'stages'>): PinMenuView =>
  pinMenuView({ game, mySet: mySet(), locks: [], resolutions: new Map(), lockBase: null, ...input })
const text = (o: AdjustOption | undefined): string =>
  o === undefined ? '-' : o.kind === 'ok' ? o.stats.map((s) => `${s.stat}${s.sp}${s.plus ? '+' : ''}${s.locked ? '!' : ''}`).join(' ') : `off:${o.reason}${o.over === undefined ? '' : `(${o.over})`}`
const grid = (v: PinMenuView) => v.results.map((r) => [r.label, ...r.options.map(text)])

/** 핵심 불변식: 고를 수 있는 선택지의 SP = 그 선택(고정·배분·기준 갈래)을 실제로 건 뒤 파생의 기준 갈래 lockedSp */
function expectMenuMatchesDerivation(v: PinMenuView, input: Pick<PinMenuInput, 'locks' | 'resolutions' | 'lockBase' | 'stages'> & { set?: PokemonSet }) {
  let checked = 0
  v.results.forEach((r, i) => {
    r.options.forEach((o, j) => {
      if (o.kind !== 'ok') return
      const pick = v.picks[i][j]
      expect(pick).not.toBeNull()
      if (pick === null) return
      const stage = input.stages.find((s) => s.stage === r.label)
      const resolution = stage?.candidate.kind === 'ready' ? stage.candidate.resolution : undefined
      if (resolution === undefined) throw new Error('후보 없음')
      const allocs: [readonly AdjustStat[], CutLock['allocation'], string | undefined][] = [[o.stats, undefined, pick.base]]
      if (o.hMax !== undefined) {
        expect(pick.hMax?.lock).toEqual({ ...pick.lock, allocation: 'h-max' })
        allocs.push([o.hMax, 'h-max', pick.hMax?.base])
      }
      for (const [stats, allocation, pickBase] of allocs) {
        const kept = input.locks.filter((l) => !l.stats.some((s) => s !== 'hp' && pick.lock.stats.includes(s)))
        const seq = input.locks.reduce((m, l) => Math.max(m, l.seq), 0) + 1
        const res = new Map(input.resolutions)
        const up = input.stages.find((s) => s.stage === 'guaranteed-survive')
        res.set(seq, allocation === 'h-max' && r.label === 'low-roll-ohko' && up?.candidate.kind === 'ready' && up.candidate.resolution.kind === 'ok' && up.candidate.resolution.options.shape === 'pair' && resolution.kind === 'ok' && resolution.options.shape === 'pair'
          ? { kind: 'ok', options: { ...resolution.options, next: { neutral: up.candidate.resolution.options.neutral, plus: up.candidate.resolution.options.plus } } }
          : resolution)
        const lock: CutLock = { ...pick.lock, seq, ...(allocation === undefined ? {} : { allocation }) }
        const d = deriveLocks({ game, mySet: input.set ?? mySet(), locks: [...kept, lock], resolutions: res, baseChoice: pickBase ?? input.lockBase })
        const base = d.branches.find((b) => b.id === d.baseId)
        for (const s of stats) expect(base?.lockedSp[s.stat], `${r.label} ${j} ${allocation ?? 'min-sum'} ${s.stat}`).toBe(s.sp)
        checked++
      }
    })
  })
  expect(checked).toBeGreaterThan(0)
}

describe('pinMenuView 공격', () => {
  const stages = [attackStage('high-roll-ohko', single('atk', 20, 14)), attackStage('guaranteed-ohko', single('atk', 28, 20))]

  it('무보정/상승 두 선택지, 좋은 단계부터, 고른 성격의 기준 갈래(자동 규칙과 같으면 생략)', () => {
    const v = view({ side: 'attack', stages })
    expect(v.state).toBe('ready')
    expect(v.natures.map((n) => [n.id, n.plus])).toEqual([
      ['neutral', null],
      ['plus', 'atk'],
    ])
    expect(grid(v)).toEqual([
      ['guaranteed-ohko', 'atk28', 'atk20+'],
      ['high-roll-ohko', 'atk20', 'atk14+'],
    ])
    expect(v.picks[0].map((p) => p?.base)).toEqual([undefined, 'plus:atk'])
    expect(v.picks[0][0]?.lock).toEqual(stages[1].candidate.kind === 'ready' ? stages[1].candidate.lock : null)
    expectMenuMatchesDerivation(v, { locks: [], resolutions: new Map(), lockBase: null, stages })
  })

  it('정확 규칙: 위 단계를 같은 비용 이하로 내는 아래 단계 선택지는 끄고, 고를 선택지가 없는 단계는 뺀다', () => {
    const same = [attackStage('high-roll-ohko', single('atk', 28, 14)), attackStage('guaranteed-ohko', single('atk', 28, 20))]
    expect(grid(view({ side: 'attack', stages: same }))).toEqual([
      ['guaranteed-ohko', 'atk28', 'atk20+'],
      ['high-roll-ohko', 'off:unreachable', 'atk14+'],
    ])
    const none = [attackStage('high-roll-ohko', single('atk', 28, 20)), attackStage('guaranteed-ohko', single('atk', 28, 20))]
    expect(view({ side: 'attack', stages: none }).results.map((r) => r.label)).toEqual(['guaranteed-ohko'])
  })

  it('1단 대표 선택지는 내 세트 성격의 상승(없으면 무보정), 닿지 않으면 가장 싼 선택지. 현재 결과 표지', () => {
    expect(view({ side: 'attack', stages }).results.map((r) => r.lead)).toEqual([0, 0])
    expect(view({ side: 'attack', stages, mySet: mySet('adamant') }).results.map((r) => r.lead)).toEqual([1, 1])
    const plusOnly = [attackStage('high-roll-ohko', single('atk', null, 14)), attackStage('guaranteed-ohko', single('atk', null, 20))]
    expect(view({ side: 'attack', stages: plusOnly }).results.map((r) => [r.lead, text(r.options[0])])).toEqual([
      [1, 'off:unreachable'],
      [1, 'off:unreachable'],
    ])
    expect(view({ side: 'attack', stages, current: 'high-roll-ohko' }).results.map((r) => r.current)).toEqual([false, true])
  })

  it('후보가 하나라도 계산 중이면 computing', () => {
    const v = view({ side: 'attack', stages: [stages[0], { stage: 'guaranteed-ohko', candidate: { kind: 'computing' } }] })
    expect(v).toEqual({ state: 'computing', natures: [], results: [], picks: [] })
  })

  it('SP 부족은 초과량을 싣고, 결과가 없으면 최소 초과량을 emptyOver로', () => {
    const speed: CutLock = { seq: 1, kind: 'speed', target: { kind: 'speed', origin: 'ladder', opponentId: 's', bundle: { sp: 32, nature: 'plus' }, condition: 'none', filterKind: null }, stage: 'first', stats: ['spe'] }
    const spa: CutLock = { seq: 2, kind: 'attack', target: target('attack', 'c'), stage: 'guaranteed-ohko', stats: ['spa'] }
    const resolutions = new Map([
      [1, single('spe', 32, null)],
      [2, single('spa', 30, null)],
    ])
    const v = view({ side: 'attack', stages, locks: [speed, spa], resolutions })
    // S32 + C30 + A(14~28) > 66, 최소 초과는 고난수 +A14: 76 − 66 = 10
    expect(v.results).toEqual([])
    expect(v.emptyOver).toBe(10)
  })

  it('교체될 고정을 빼고 계산한다(같은 A의 기존 고정은 값에 들지 않는다)', () => {
    const old: CutLock = { seq: 1, kind: 'attack', target: target('attack', 'old'), stage: 'guaranteed-ohko', stats: ['atk'] }
    const resolutions = new Map([[1, single('atk', 32, 30)]])
    const v = view({ side: 'attack', stages, locks: [old], resolutions })
    expect(grid(v)).toEqual([
      ['guaranteed-ohko', 'atk28', 'atk20+'],
      ['high-roll-ohko', 'atk20', 'atk14+'],
    ])
    expectMenuMatchesDerivation(v, { locks: [old], resolutions, lockBase: null, stages })
  })

  it('다른 고정이 있으면 무보정은 지금 기준 갈래, 상승은 plus:v. 기준 갈래와 값이 달라지는 고정 능력치를 함께 보인다', () => {
    const speed: CutLock = { seq: 1, kind: 'speed', target: { kind: 'speed', origin: 'ladder', opponentId: 's', bundle: { sp: 32, nature: 'plus' }, condition: 'none', filterKind: null }, stage: 'first', stats: ['spe'] }
    const resolutions = new Map([[1, single('spe', 20, 12)]])
    const v = view({ side: 'attack', stages, locks: [speed], resolutions, lockBase: 'plus:spe' })
    expect(v.natures.map((n) => n.branchId)).toEqual(['plus:spe', 'plus:atk'])
    expect(grid(v)).toEqual([
      ['guaranteed-ohko', 'atk28', 'atk20+ spe20!'],
      ['high-roll-ohko', 'atk20', 'atk14+ spe20!'],
    ])
    expect(v.picks[0].map((p) => p?.base)).toEqual([undefined, 'plus:atk'])
    expectMenuMatchesDerivation(v, { locks: [speed], resolutions, lockBase: 'plus:spe', stages })
  })
})

describe('pinMenuView 무보정 갈래', () => {
  it('지금 기준 갈래(고정 밖)가 고정을 더하면 사라지면, 무보정은 남는 갈래 중 자동 규칙이 고를 갈래로 건다', () => {
    const speed: CutLock = { seq: 1, kind: 'speed', target: { kind: 'speed', origin: 'ladder', opponentId: 's', bundle: { sp: 32, nature: 'plus' }, condition: 'none', filterKind: null }, stage: 'first', stats: ['spe'] }
    const atk: CutLock = { seq: 2, kind: 'attack', target: target('attack', 'a'), stage: 'guaranteed-ohko', stats: ['atk'] }
    const resolutions = new Map([
      [1, single('spe', 31, 18)],
      [2, single('atk', 30, null)],
    ])
    // 고정 밖: S31 + A30 = 61(기준). C12를 더하면 73이라 고정 밖이 사라지고 +S 갈래(S18 + A30 + C12 = 60)가 남는다.
    // +C 갈래는 S31 + A30 + C(6·2): 확정1타는 67이라 갈래가 없고(고정과 겹침), 고난수1타는 63
    const stages = [attackStage('high-roll-ohko', single('spa', 12, 2), 'c', 'spa'), attackStage('guaranteed-ohko', single('spa', 16, 6), 'c', 'spa')]
    const v = view({ side: 'attack', stages, locks: [speed, atk], resolutions })
    expect(grid(v)).toEqual([
      ['guaranteed-ohko', 'spa16 spe18!', 'off:no-branch'],
      ['high-roll-ohko', 'spa12 spe18!', 'spa2+'],
    ])
    expect(v.picks[1][0]?.base).toBeUndefined()
    expectMenuMatchesDerivation(v, { locks: [speed, atk], resolutions, lockBase: null, stages })
  })
})

describe('pinMenuView 방어', () => {
  // 저난수1타: H + B ≥ 12 근방(H 하나당 B 하나), 확정견딤: B ≥ 20 − H
  const low = stairs((hp) => Math.max(0, 12 - hp))
  const survive = stairs((hp) => Math.max(0, 20 - hp))
  const stages = [defenseStage('low-roll-ohko', pair('def', low, null)), defenseStage('guaranteed-survive', pair('def', survive, null))]

  it('H 최대는 합 최소보다 H가 클 때만, 저난수 H 최대는 확정견딤에 닿지 않는 가장 큰 H', () => {
    const v = view({ side: 'defense', stages })
    expect(grid(v)).toEqual([
      ['guaranteed-survive', 'hp20 def0', 'off:unreachable'],
      ['low-roll-ohko', 'hp12 def0', 'off:unreachable'],
    ])
    const [survived, lowRoll] = v.results
    const hMaxText = (o: AdjustOption) => (o.kind === 'ok' && o.hMax !== undefined ? o.hMax.map((s) => `${s.stat}${s.sp}`).join(' ') : undefined)
    expect(hMaxText(survived.options[0])).toBe('hp32 def0')
    // H 13~19는 B 0으로 확정견딤(20 − H > 0)에 닿지 않는다 → H 19
    expect(hMaxText(lowRoll.options[0])).toBe('hp19 def0')
    expectMenuMatchesDerivation(v, { locks: [], resolutions: new Map(), lockBase: null, stages })
  })

  it('반대쪽 쌍(H+D) 고정 중: 3선택지(무보정·B 보정·D 보정), H·D 고정 표지, H 최대 없음', () => {
    const hd: CutLock = { seq: 1, kind: 'defense', target: target('defense', 'hd'), stage: 'guaranteed-survive', stats: ['hp', 'spd'] }
    const resolutions = new Map([[1, pair('spd', stairs((hp) => Math.max(0, 10 - hp)), stairs((hp) => Math.max(0, 6 - hp)))]])
    const withPlus = [defenseStage('low-roll-ohko', pair('def', low, stairs((hp) => Math.max(0, 8 - hp)))), defenseStage('guaranteed-survive', pair('def', survive, stairs((hp) => Math.max(0, 14 - hp))))]
    const v = view({ side: 'defense', stages: withPlus, locks: [hd], resolutions })
    expect(v.natures.map((n) => [n.id, n.plus, n.branchId])).toEqual([
      ['neutral', null, 'out'],
      ['plus', 'def', 'plus:def'],
      ['other-plus', 'spd', 'plus:spd'],
    ])
    for (const r of v.results) for (const o of r.options) if (o.kind === 'ok') expect(o.hMax).toBeUndefined()
    const okStats = v.results[0].options.find((o) => o.kind === 'ok')
    expect(okStats?.kind === 'ok' ? okStats.stats.map((s) => [s.stat, s.locked]) : []).toEqual([
      ['hp', true],
      ['def', false],
      ['spd', true],
    ])
    expectMenuMatchesDerivation(v, { locks: [hd], resolutions, lockBase: null, stages: withPlus })
  })

  it('H 최대 선택지는 그 배분의 자동 규칙 갈래로 기준 갈래를 따로 정한다(합 최소와 갈래가 달라도 메뉴 값대로 걸린다)', () => {
    // 고정 밖은 A30 + 무보정 확정견딤(합 최소 37) = 67 > 66이라 없다. 합 최소: +B(A30 + 28 = 58) < +A(A22 + 37 = 59)라 자동 = plus:def.
    // B 상승 · H 최대(H32 B0)는 A30 + 32 = 62 > 59라, 기준 갈래를 싣지 않으면 자동 규칙이 plus:atk로 옮겨 간다.
    const atk: CutLock = { seq: 1, kind: 'attack', target: target('attack', 'a'), stage: 'guaranteed-ohko', stats: ['atk'] }
    const resolutions = new Map([[1, single('atk', 30, 22)]])
    const survive = [defenseStage('guaranteed-survive', pair('def', stairs((hp) => (37 - hp <= 32 ? Math.max(0, 37 - hp) : null)), stairs((hp) => Math.max(0, 28 - hp))))]
    const v = view({ side: 'defense', stages: survive, locks: [atk], resolutions })
    const j = v.natures.findIndex((n) => n.id === 'plus')
    const o = v.results[0].options[j]
    expect(o.kind === 'ok' ? o.hMax?.map((s) => `${s.stat}${s.sp}`) : undefined).toEqual(['hp32', 'def0'])
    const pick = v.picks[0][j]
    expect(pick?.base).toBeUndefined()
    expect(pick?.hMax?.base).toBe('plus:def')
    expectMenuMatchesDerivation(v, { locks: [atk], resolutions, lockBase: null, stages: survive })
  })

  it('교체: 다른 대상 H+B 고정은 빼고 계산한다', () => {
    const hb: CutLock = { seq: 1, kind: 'defense', target: target('defense', 'hb'), stage: 'guaranteed-survive', stats: ['hp', 'def'] }
    const resolutions = new Map([[1, pair('def', stairs((hp) => (hp >= 30 ? 0 : null)), null)]])
    const v = view({ side: 'defense', stages, locks: [hb], resolutions })
    expect(grid(v)).toEqual(grid(view({ side: 'defense', stages })))
  })
})
