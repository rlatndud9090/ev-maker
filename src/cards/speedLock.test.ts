import { describe, expect, it } from 'vitest'
import { finalSpeed, minSpToOutspeed, type PokemonSet } from '../core'
import type { MetaEntry } from '../data/meta-schema'
import type { StatId } from '../data/schema'
import type { MetaView } from '../meta'
import { deriveLocks, type CutLock, type LockDerivation, type LockResolution } from './lock'
import { buildSpeedChart, type SpeedBadge } from './speedChart'
import {
  resolveSpeedLocks,
  speedBadgeLockKey,
  speedBranchLines,
  speedDropWarning,
  speedLockCandidate,
  speedLockSignature,
  type ResolveSpeedLocksInput,
  type SpeedBranchLine,
  type SpeedBranchOption,
} from './speedLock'
import { realData, syntheticEntry, syntheticView } from './testing'
import { DEFAULT_CRITERIA, type CustomTarget, type SpeedAddedBundle } from './types'

const { game, bo1 } = realData()
const regulation = game.manifest.regulation.id
const sp = (patch: Partial<Record<StatId, number>> = {}): Record<StatId, number> => ({ hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...patch })

/** AC1 세트: 메가라이츄Y(S 종족값 130), 무보정, SP 전부 0, 스피드 도구 없음(메가스톤만) */
const raichuY: PokemonSet = { regulation, species: 'raichu', ability: 'static', item: 'raichunitey', mega: true, nature: 'hardy', sp: sp(), moves: ['thunderbolt'] }
/** 라이츄(S 종족값 110), 도구 없음 */
const raichu: PokemonSet = { regulation, species: 'raichu', ability: 'static', nature: 'hardy', sp: sp(), moves: ['thunderbolt'] }

function chart(view: MetaView = bo1, added: readonly SpeedAddedBundle[] = [], customTargets: readonly CustomTarget[] = []) {
  return buildSpeedChart({ game, view, myAbility: 'static', criteria: { ...DEFAULT_CRITERIA }, filters: { topN: 200, selected: [] }, customTargets, added })
}
const baseBadges = (b: readonly SpeedBadge[]) => b.filter((x) => x.origin === 'ladder' && x.condition.kind === 'none')
const byRank = (a: SpeedBadge, b: SpeedBadge) => a.usageRank - b.usageRank

/** 스냅샷에서 S 종족값 120인 래더 상대의 기본 배지 중 배분이 (S32, 성격 sign)인 것 → 사용률 순위가 가장 높은 것 */
function badge120(sign: 'plus' | 'neutral'): SpeedBadge {
  const found = baseBadges(chart().badges)
    .filter((b) => game.data.species[b.speciesId].baseStats.spe === 120 && b.bundle.sp === 32 && b.bundle.nature === sign)
    .sort(byRank)[0]
  if (found === undefined) throw new Error(`no 120 ${sign}`)
  return found
}
const fastest120 = () => badge120('plus')
const semi120 = () => badge120('neutral')

function lockOf(badge: SpeedBadge, seq = 1, set: PokemonSet = raichuY): CutLock {
  const c = speedLockCandidate(game, set, badge, false)
  if (c.kind !== 'ready') throw new Error('not ready')
  return { ...c.lock, seq }
}

function resolve(locks: readonly CutLock[], patch: Partial<ResolveSpeedLocksInput> = {}) {
  return resolveSpeedLocks({ game, view: bo1, mySet: raichuY, locks, criteria: { ...DEFAULT_CRITERIA }, customTargets: [], added: [], myTailwind: false, ...patch })
}
const single = (neutral: number | null, plus: number | null): LockResolution => ({ kind: 'ok', options: { shape: 'single', stat: 'spe', neutral, plus } })

describe('AC1 수치: 메가라이츄Y가 120족 배지를 고정', () => {
  it("'최속 120족'(S32 상승, 실수치 189): 무보정은 32로 못 넘고 상승은 S23", () => {
    const b = fastest120()
    // 120족 Lv50: floor(271/2)+5 = 140, +32 = 172, ×1.1 = 189
    expect(b.speed).toBe(189)
    expect(finalSpeed(game, raichuY)).toBe(150)
    const c = speedLockCandidate(game, raichuY, b, false)
    expect(c).toEqual({
      kind: 'ready',
      lock: { kind: 'speed', target: { kind: 'speed', origin: 'ladder', opponentId: b.opponentId, bundle: { sp: 32, nature: 'plus' }, condition: 'none', filterKind: null }, stage: 'first', stats: ['spe'] },
      // 무보정 150+32 = 182 ≤ 189. 상승 floor(172×1.1) = 189(동속) → S23에서 190
      resolution: single(null, 23),
    })
    expect(resolve([lockOf(b)]).get(1)).toEqual(single(null, 23))
  })

  it("'준속 120족'(S32 무보정, 실수치 172): 무보정 S23(S22는 동속), 상승 S8", () => {
    const b = semi120()
    expect(b.speed).toBe(172)
    const c = speedLockCandidate(game, raichuY, b, false)
    expect(c.kind === 'ready' && c.resolution).toEqual(single(23, 8))
    expect(finalSpeed(game, { ...raichuY, sp: sp({ spe: 22 }) })).toBe(172)
    expect(finalSpeed(game, { ...raichuY, nature: 'timid', sp: sp({ spe: 7 }) })).toBe(172)
  })

  it('하락이 S인 내 성격이어도 상승안이 있다(내 랭크는 무시)', () => {
    const b = semi120()
    const brave = speedLockCandidate(game, { ...raichuY, nature: 'brave', boosts: { spe: 6 } }, b, false)
    expect(brave.kind === 'ready' && brave.resolution).toEqual(single(23, 8))
  })

  it('고정 불가 사유: 내 세트 오류·스피드 미지원 보정', () => {
    const b = semi120()
    expect(speedLockCandidate(game, { ...raichuY, species: 'nope' }, b, false)).toEqual({ kind: 'blocked', reason: 'set-error' })
    expect(speedLockCandidate(game, { ...raichu, item: 'quickclaw' }, b, false)).toEqual({ kind: 'blocked', reason: 'speed-unsupported' })
    // 합계 초과 세트는 옵션이 있을 때만 후보가 된다
    const over = { ...raichuY, sp: sp({ hp: 32, def: 32, spd: 32 }) }
    expect(speedLockCandidate(game, over, b, false)).toEqual({ kind: 'blocked', reason: 'set-error' })
    expect(speedLockCandidate(game, over, b, false, { ignoreSpTotal: true })).toMatchObject({ kind: 'ready', resolution: single(23, 8) })
  })
})

describe('AC5: 구애스카프 재계산', () => {
  it('스카프를 끼면 고정 SP가 줄어든다', () => {
    const target = baseBadges(chart().badges).find((b) => b.speed > 140 && b.speed < 160) as SpeedBadge
    const lock = lockOf(target, 1, raichu)
    const without = resolve([lock], { mySet: raichu }).get(1)
    const withScarf = resolve([lock], { mySet: { ...raichu, item: 'choicescarf' } }).get(1)
    if (without?.kind !== 'ok' || withScarf?.kind !== 'ok' || without.options.shape !== 'single' || withScarf.options.shape !== 'single') throw new Error('not ok')
    expect(without.options.neutral).not.toBeNull()
    expect(withScarf.options.neutral as number).toBeLessThan(without.options.neutral as number)
    expect(withScarf.options.plus as number).toBeLessThanOrEqual(without.options.plus as number)
  })

  it('스카프로만 닿는 배지를 고정한 뒤 스카프를 빼면 도달 불가로 계산에서 빠지고, 다시 끼면 돌아온다', () => {
    const scarfed = { ...raichu, item: 'choicescarf' }
    const target = chart().badges.find((b) => b.opponentId === 'garchomp' && b.condition.kind === 'scarf') as SpeedBadge
    // 가브리아스 154 × 1.5 = 231. 라이츄 S32 상승 178 < 231
    expect(target.speed).toBe(231)
    const lock = lockOf(target, 1, scarfed)
    expect(lock.target).toMatchObject({ condition: 'scarf', filterKind: 'scarf' })
    const derive = (set: PokemonSet) => {
      const resolutions = resolve([lock], { mySet: set })
      return { resolutions, d: deriveLocks({ game, mySet: set, locks: [lock], resolutions, baseChoice: null }) }
    }
    const on = derive(scarfed)
    // 스카프 라이츄: 무보정 (130+25)×1.5 = 232, 상승 floor(141×1.1) = 155 → 232
    expect(on.resolutions.get(1)).toEqual(single(25, 11))
    expect(on.d.statuses.get(1)).toEqual({ kind: 'active' })
    const off = derive(raichu)
    expect(off.resolutions.get(1)).toEqual({ kind: 'unreachable' })
    expect(off.d.statuses.get(1)).toEqual({ kind: 'unreachable' })
    expect(off.d.branches).toEqual([])
    expect(derive(scarfed)).toEqual(on)
  })
})

describe('대상 없음·세트 오류', () => {
  const sneasler = bo1.entry('sneasler') as MetaEntry
  const monthWith = (entry: MetaEntry | null): MetaView =>
    syntheticView(game, bo1.meta, bo1.ranking.flatMap((e) => (e.id !== 'sneasler' ? [e] : entry === null ? [] : [entry])))

  it('통계 월이 바뀌어 대상 배분이 사라지면 missing, 되돌리면 다시 해석된다', () => {
    const b = semi120()
    expect(b.opponentId).toBe('sneasler')
    const lock = lockOf(b)
    // S32 무보정(adamant·brave) 배분이 없는 달: 기본 배지는 jolly S32
    const jollyOnly = syntheticEntry(sneasler, { spreads: { kept: [['jolly:2/32/0/0/0/32', 0.5]], keptShare: 0.5, excludedShare: 0 } })
    expect(baseBadges(chart(monthWith(jollyOnly)).badges).find((x) => x.opponentId === 'sneasler')?.bundle).toMatchObject({ sp: 32, nature: 'plus' })
    expect(resolve([lock], { view: monthWith(jollyOnly) }).get(1)).toEqual({ kind: 'missing' })
    expect(resolve([lock], { view: monthWith(null) }).get(1)).toEqual({ kind: 'missing' })
    expect(resolve([lock], { view: bo1 }).get(1)).toEqual(single(23, 8))
  })

  it('필터와 무관하게 해석하고, 추가 배분 배지는 그 배분이 차트에 있는 동안만 해석된다', () => {
    const outside = bo1.ranking[60]
    const added: SpeedAddedBundle[] = [{ opponentId: outside.id, sp: 7, nature: 'minus' }]
    const b = chart(bo1, added).badges.find((x) => x.origin === 'added' && x.opponentId === outside.id) as SpeedBadge
    expect(b).toBeDefined()
    const lock = lockOf(b)
    expect(resolve([lock], { added }).get(1)?.kind).not.toBe('missing')
    expect(resolve([lock], { added: [] }).get(1)).toEqual({ kind: 'missing' })
  })

  it('목록 밖 타겟 프리셋 배지는 그 타겟이 있는 동안만 해석된다', () => {
    const customTargets: CustomTarget[] = [{ rosterId: 'raichualola', moves: ['agility'], edits: {} }]
    const b = chart(bo1, [], customTargets).badges.find((x) => x.origin === 'preset' && x.presetIndex === 0 && x.condition.kind === 'none') as SpeedBadge
    const lock = lockOf(b)
    expect(lock.target).toMatchObject({ origin: 'preset', bundle: { preset: 0 } })
    expect(resolve([lock], { customTargets }).get(1)?.kind).toBe('ok')
    expect(resolve([lock], { customTargets: [] }).get(1)).toEqual({ kind: 'missing' })
  })

  it('내 세트 오류는 대상 확인보다 먼저 set-error, 합계 초과만으로는 오류가 아니다', () => {
    const lock = lockOf(semi120())
    expect(resolve([lock], { mySet: { ...raichuY, species: 'nope' } }).get(1)).toEqual({ kind: 'set-error' })
    expect(resolve([lock], { mySet: { ...raichuY, species: 'nope' }, view: monthWith(null) }).get(1)).toEqual({ kind: 'set-error' })
    expect(resolve([lock], { mySet: { ...raichuY, sp: sp({ hp: 32, def: 32, spd: 32 }) } }).get(1)).toEqual(single(23, 8))
    expect(resolve([lock], { mySet: { ...raichu, item: 'quickclaw' } }).get(1)).toEqual({ kind: 'unreachable', reason: 'speed-unsupported' })
  })

  it('스피드 고정이 아니면 해석하지 않는다', () => {
    const attack: CutLock = { ...lockOf(semi120()), kind: 'attack', stats: ['spa'] }
    expect(resolve([attack]).size).toBe(0)
  })
})

describe('해석 서명(R16·AC16 기초)', () => {
  const slow = () => baseBadges(chart().badges).find((b) => b.speed < 100) as SpeedBadge

  it('무관한 배분 추가와 내 랭크 변경은 해석·서명을 바꾸지 않는다', () => {
    const locks = [lockOf(fastest120(), 1), lockOf(semi120(), 2)]
    const base = resolve(locks)
    const unrelated: SpeedAddedBundle[] = [{ opponentId: bo1.ranking[0].id, sp: 3, nature: 'neutral' }]
    expect(speedLockSignature(resolve(locks, { added: unrelated }))).toBe(speedLockSignature(base))
    expect(resolve(locks, { mySet: { ...raichuY, boosts: { spe: 2 } } })).toEqual(base)
  })

  it('고정 S가 그대로인 순풍 토글은 서명이 같고, 고정 S가 바뀌는 순풍 토글은 서명이 바뀐다', () => {
    const still = [lockOf(slow())]
    expect(resolve(still).get(1)).toEqual(single(0, 0))
    expect(speedLockSignature(resolve(still, { myTailwind: true }))).toBe(speedLockSignature(resolve(still)))
    const moves = [lockOf(fastest120())]
    expect(resolve(moves, { myTailwind: true }).get(1)).toEqual(single(0, 0))
    expect(speedLockSignature(resolve(moves, { myTailwind: true }))).not.toBe(speedLockSignature(resolve(moves)))
  })

  it('seq 순 결정적 직렬화이고 상태·두 SP만 담는다', () => {
    const map = new Map<number, LockResolution>([
      [3, { kind: 'unreachable', reason: 'speed-unsupported' }],
      [1, single(23, 8)],
      [2, { kind: 'missing' }],
    ])
    expect(speedLockSignature(map)).toBe(JSON.stringify([[1, 'ok', 23, 8], [2, 'missing'], [3, 'unreachable']]))
    expect(speedLockSignature(new Map([...map].reverse()))).toBe(speedLockSignature(map))
  })
})

describe('스피드 배지 갈래 줄(R8, AC2 스피드 쪽)', () => {
  const mySp = (patch: Partial<Record<StatId, number>> = {}) => sp(patch)
  const derive = (locks: CutLock[], resolutions: ReadonlyMap<number, LockResolution>, set: PokemonSet = raichuY): LockDerivation =>
    deriveLocks({ game, mySet: set, locks, resolutions, baseChoice: null })
  const lines = (d: LockDerivation, badge: SpeedBadge, spMine = mySp(), myTailwind = false): SpeedBranchLine[] =>
    speedBranchLines({ game, mySet: raichuY, derivation: d, badge, myTailwind, mySp: spMine, spTotal: game.manifest.rules.spTotal })
  /** 손 계산: 그 성격을 넣은 내 세트로 코어 최소 SP */
  const hand = (nature: string, target: number): number | null => {
    const r = minSpToOutspeed(game, { ...raichuY, nature }, target, { attacker: { tailwind: false } })
    return r.kind === 'impossible' ? null : r.sp
  }
  const spOfOption = (o: SpeedBranchOption | null | 'omitted'): number | null | 'omitted' => (o === null || o === 'omitted' ? o : o.stats[0].sp)

  const attackLock: CutLock = {
    seq: 1,
    kind: 'attack',
    target: { kind: 'attack', source: 'ladder', opponentId: 'x', category: 'special', bundle: { ladder: 'k' }, item: null, itemKey: 'thunderbolt' },
    stage: 'guaranteed-ohko',
    stats: ['spa'],
  }

  it('S 고정: 상승 갈래는 상승안만(max(고정, 최소)), 고정 밖 갈래는 무보정안만, 손 계산과 같다', () => {
    const lock = lockOf(semi120())
    const d = derive([lock], resolve([lock]))
    expect(d.branches.map((b) => [b.id, b.nature, b.lockedSp.spe])).toEqual([
      ['plus:spe', 'jolly', 8],
      ['out', 'hardy', 23],
    ])
    for (const target of [fastest120(), baseBadges(chart().badges).find((b) => b.speed < 100) as SpeedBadge]) {
      const [plusLine, outLine] = lines(d, target)
      expect(plusLine).toMatchObject({ branchId: 'plus:spe', branchPlus: 'spe', isBase: false, status: 'ok', neutral: 'omitted', condition: [{ stat: 'spe', sp: 8, plus: true }] })
      expect(outLine).toMatchObject({ branchId: 'out', branchPlus: 'out', isBase: true, status: 'ok', plus: 'omitted', condition: [{ stat: 'spe', sp: 23, plus: false }] })
      expect(outLine.omittedPlusStat).toBeUndefined()
      const maxed = (locked: number, h: number | null) => (h === null ? null : Math.max(locked, h))
      expect(spOfOption(plusLine.plus)).toBe(maxed(8, hand('jolly', target.speed)))
      expect(spOfOption(outLine.neutral)).toBe(maxed(23, hand('hardy', target.speed)))
    }
    const [slowPlus, slowOut] = lines(d, baseBadges(chart().badges).find((b) => b.speed < 100) as SpeedBadge)
    expect(slowPlus.plus).toMatchObject({ label: 'first', stats: [{ stat: 'spe', sp: 8 }], byLock: true, budget: { kind: 'fits' } })
    expect(slowOut.neutral).toMatchObject({ stats: [{ stat: 'spe', sp: 23 }], byLock: true })
    // 최속 120족은 무보정 불가
    expect(lines(d, fastest120())[1].neutral).toBeNull()
  })

  it('S 밖 고정: 그 능력치 상승 갈래는 무보정안만(상승은 C에), 고정 밖 갈래는 두 선택지, 손 계산과 같다', () => {
    const d = derive([attackLock], new Map([[1, { kind: 'ok', options: { shape: 'single', stat: 'spa', neutral: 10, plus: 5 } }]]))
    expect(d.branches.map((b) => [b.id, b.nature])).toEqual([
      ['plus:spa', 'modest'],
      ['out', 'hardy'],
    ])
    const target = semi120()
    const [plusLine, outLine] = lines(d, target)
    expect(plusLine).toMatchObject({ branchPlus: 'spa', plus: 'omitted', omittedPlusStat: 'spa', condition: [{ stat: 'spa', sp: 5, plus: true }] })
    expect(spOfOption(plusLine.neutral)).toBe(hand('modest', target.speed))
    expect(spOfOption(outLine.neutral)).toBe(hand('hardy', target.speed))
    // 고정 밖 갈래의 S 상승: 하락은 고정(C)·S 밖 첫 자리(A) → 겁쟁이
    expect(spOfOption(outLine.plus)).toBe(hand('timid', target.speed))
    expect([spOfOption(plusLine.neutral), spOfOption(outLine.neutral), spOfOption(outLine.plus)]).toEqual([23, 23, 8])
    expect(speedDropWarning(game, d)).toBe(false)
  })

  it('예산: 갈래 남은 예산으로 fits/need/short를 판정하고 음수 예산·음수 n이 나오지 않는다', () => {
    const d = derive([attackLock], new Map([[1, { kind: 'ok', options: { shape: 'single', stat: 'spa', neutral: 10, plus: 5 } }]]))
    const target = semi120()
    // 다른 능력치 H32 B20 = 52: 상승(C) 갈래 남은 66−5−52 = 9, 고정 밖 갈래 66−10−52 = 4
    const [plusLine, outLine] = lines(d, target, mySp({ hp: 32, def: 20 }))
    expect((plusLine.neutral as SpeedBranchOption).budget).toEqual({ kind: 'need', n: 14 })
    expect((outLine.neutral as SpeedBranchOption).budget).toEqual({ kind: 'need', n: 19 })
    expect((outLine.plus as SpeedBranchOption).budget).toEqual({ kind: 'need', n: 4 })
    // 다른 능력치 H32 B32 D10 = 74: 66 − 10 − 74 < 0 → 남은 예산 0
    const heavy = lines(d, target, mySp({ hp: 32, def: 32, spd: 10 }))
    expect((heavy[1].neutral as SpeedBranchOption).budget).toEqual({ kind: 'need', n: 23 })
    expect((heavy[1].plus as SpeedBranchOption).budget).toEqual({ kind: 'need', n: 8 })
    const fits = lines(d, target, mySp())
    expect((fits[1].plus as SpeedBranchOption).budget).toEqual({ kind: 'fits' })
    for (const line of [plusLine, outLine, ...heavy, ...fits]) {
      for (const o of [line.neutral, line.plus]) {
        if (o === null || o === 'omitted') continue
        if (o.budget.kind === 'need') expect(o.budget.n).toBeGreaterThan(0)
        if (o.budget.kind === 'short') expect(o.budget.m).toBeGreaterThan(0)
        expect(o.stats[0].sp).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('고정 대상 배지 자신·활성 갈래 없음·내 세트 계산 불가면 줄이 없다', () => {
    const b = semi120()
    const lock = lockOf(b)
    const d = derive([lock], resolve([lock]))
    expect(lines(d, b)).toEqual([])
    expect(speedBadgeLockKey(b)).toEqual(lock.target)
    expect(lines(derive([], new Map()), fastest120())).toEqual([])
    expect(speedBranchLines({ game, mySet: { ...raichu, item: 'quickclaw' }, derivation: d, badge: fastest120(), myTailwind: false, mySp: sp(), spTotal: 66 })).toEqual([])
  })

  it('내 순풍은 갈래 줄 최소 SP에 반영된다', () => {
    const d = derive([attackLock], new Map([[1, { kind: 'ok', options: { shape: 'single', stat: 'spa', neutral: 10, plus: 5 } }]]))
    const [, out] = lines(d, fastest120(), mySp(), true)
    expect(spOfOption(out.neutral)).toBe(0)
    expect(spOfOption(out.plus)).toBe(0)
  })
})
