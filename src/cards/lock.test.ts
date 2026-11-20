import { describe, expect, it } from 'vitest'
import type { PokemonSet } from '../core'
import type { StatId } from '../data/schema'
import {
  branchBudget,
  budgetMark,
  checkLockCandidate,
  deriveLocks,
  lockTargetId,
  sameLockTarget,
  type CutLock,
  type LockDerivation,
  type LockKind,
  type LockResolution,
  type LockTargetKey,
  type Stairs,
} from './lock'
import { realData } from './testing'

const { game } = realData()

const mySet = (nature = 'hardy', sp: Partial<Record<StatId, number>> = {}): PokemonSet => ({
  regulation: game.manifest.regulation.id,
  species: 'raichu',
  ability: 'static',
  nature,
  sp: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...sp },
  moves: [],
})

const speedTarget = (opponentId = 'opp'): Extract<LockTargetKey, { kind: 'speed' }> => ({
  kind: 'speed',
  origin: 'ladder',
  opponentId,
  bundle: { sp: 32, nature: 'plus' },
  condition: 'none',
  filterKind: null,
})
const damageTarget = (kind: 'attack' | 'defense', opponentId = 'opp'): LockTargetKey => ({
  kind,
  source: 'ladder',
  opponentId,
  category: 'physical',
  bundle: { ladder: 'k' },
  item: null,
  itemKey: 'earthquake',
})

function lock(seq: number, stats: StatId[], kind?: LockKind): CutLock {
  const k: LockKind = kind ?? (stats.length === 2 ? 'defense' : stats[0] === 'spe' ? 'speed' : 'attack')
  return {
    seq,
    kind: k,
    target: k === 'speed' ? speedTarget(`o${seq}`) : damageTarget(k, `o${seq}`),
    stage: k === 'speed' ? 'first' : k === 'attack' ? 'guaranteed-ohko' : 'guaranteed-survive',
    stats,
  }
}
const single = (stat: StatId, neutral: number | null, plus: number | null): LockResolution => ({ kind: 'ok', options: { shape: 'single', stat, neutral, plus } })
const pair = (defense: 'def' | 'spd', neutral: Stairs | null, plus: Stairs | null): LockResolution => ({ kind: 'ok', options: { shape: 'pair', defense, neutral, plus } })
const stairs = (f: (hp: number) => number | null): Stairs => Array.from({ length: 33 }, (_, hp) => f(hp))

function derive(locks: CutLock[], res: Record<number, LockResolution>, opts: { set?: PokemonSet; baseChoice?: string | null } = {}): LockDerivation {
  return deriveLocks({
    game,
    mySet: opts.set ?? mySet(),
    locks,
    resolutions: new Map(Object.entries(res).map(([k, v]) => [Number(k), v])),
    baseChoice: opts.baseChoice ?? null,
  })
}
const ids = (d: LockDerivation) => d.branches.map((b) => b.id)
const branch = (d: LockDerivation, id: string) => {
  const b = d.branches.find((x) => x.id === id)
  if (b === undefined) throw new Error(`갈래 ${id} 없음`)
  return b
}

describe('lockTargetId·sameLockTarget', () => {
  it('키 순서와 무관한 구조 비교, 필드가 다르면 다른 대상', () => {
    const a = damageTarget('attack')
    const reordered: LockTargetKey = { itemKey: 'earthquake', item: null, bundle: { ladder: 'k' }, category: 'physical', opponentId: 'opp', source: 'ladder', kind: 'attack' }
    expect(sameLockTarget(a, reordered)).toBe(true)
    expect(lockTargetId(a)).toBe(lockTargetId(reordered))
    expect(sameLockTarget(a, { ...damageTarget('attack'), bundle: { preset: 0 } })).toBe(false)
    expect(sameLockTarget(a, damageTarget('defense'))).toBe(false)
    expect(sameLockTarget(speedTarget(), { ...speedTarget(), bundle: { preset: 0 } })).toBe(false)
    expect(sameLockTarget(speedTarget(), { ...speedTarget(), condition: 'tailwind', filterKind: 'tailwind' })).toBe(false)
  })
})

describe('deriveLocks 갈래', () => {
  it('고정이 없으면 갈래·기준 없음, 초과 0', () => {
    const d = derive([], {}, { set: mySet('hardy', { hp: 32, atk: 32, spe: 32 }) })
    expect(d).toMatchObject({ branches: [], baseId: null, lockedStats: [], overTotal: 0 })
    expect(d.statuses.size).toBe(0)
  })

  it('S 고정 하나(AC1형): +S 갈래는 상승안, 고정 밖 갈래는 무보정안, 기준은 고정 밖', () => {
    const d = derive([lock(1, ['spe'])], { 1: single('spe', 20, 12) })
    expect(ids(d)).toEqual(['plus:spe', 'out'])
    expect(branch(d, 'plus:spe')).toMatchObject({ plus: 'spe', nature: 'jolly', lockedSp: { spe: 12 }, lockedSum: 12 })
    expect(branch(d, 'plus:spe').choice.get(1)).toBe('plus')
    expect(branch(d, 'out')).toMatchObject({ plus: 'out', nature: 'hardy', lockedSp: { spe: 20 }, lockedSum: 20 })
    expect(branch(d, 'out').choice.get(1)).toBe('neutral')
    expect(d.baseId).toBe('out')
    expect(d.lockedStats).toEqual(['spe'])
    expect(d.statuses.get(1)).toEqual({ kind: 'active' })
  })

  it('갈래 존재: 상승안이 없으면 그 능력치 갈래 없음, 무보정안이 없으면 고정 밖 갈래 없음', () => {
    expect(ids(derive([lock(1, ['spe'])], { 1: single('spe', 20, null) }))).toEqual(['out'])
    const onlyPlus = derive([lock(1, ['spe'])], { 1: single('spe', null, 12) })
    expect(ids(onlyPlus)).toEqual(['plus:spe'])
    expect(onlyPlus.baseId).toBe('plus:spe')
  })

  it('32 초과 선택지는 없는 것으로 본다', () => {
    expect(ids(derive([lock(1, ['spe'])], { 1: single('spe', 33, 30) }))).toEqual(['plus:spe'])
    const tall = derive([lock(1, ['hp', 'def'])], { 1: pair('def', stairs(() => 33), stairs((hp) => Math.max(0, 10 - hp))) })
    expect(ids(tall)).toEqual(['plus:def'])
  })

  it('AC3: 공격 컷 + 스피드 컷 → +A·+S·고정 밖 갈래, 각 갈래는 X 고정만 상승안', () => {
    const d = derive([lock(1, ['atk']), lock(2, ['spe'])], { 1: single('atk', 28, 20), 2: single('spe', 20, 12) })
    expect(ids(d)).toEqual(['plus:atk', 'plus:spe', 'out'])
    expect(branch(d, 'plus:atk')).toMatchObject({ nature: 'adamant', lockedSp: { atk: 20, spe: 20 }, lockedSum: 40 })
    expect(branch(d, 'plus:spe')).toMatchObject({ nature: 'jolly', lockedSp: { atk: 28, spe: 12 }, lockedSum: 40 })
    expect(branch(d, 'out')).toMatchObject({ nature: 'hardy', lockedSp: { atk: 28, spe: 20 }, lockedSum: 48 })
    expect([...branch(d, 'plus:atk').choice]).toEqual([
      [1, 'plus'],
      [2, 'neutral'],
    ])
    for (const b of d.branches) {
      expect(b.lockedSum).toBeLessThanOrEqual(game.manifest.rules.spTotal)
      const n = game.data.natures[b.nature]
      expect(['atk', 'spe']).not.toContain(n.minus)
    }
  })

  it('AC3: 하락 자리가 없는 갈래는 나오지 않는다(겁쟁이 + A·B·C·D 고정 → 고정 밖 갈래 없음)', () => {
    const locks = [lock(1, ['atk']), lock(2, ['def'], 'attack'), lock(3, ['spa']), lock(4, ['spd'], 'attack')]
    const d = derive(locks, { 1: single('atk', 8, 2), 2: single('def', 8, 4), 3: single('spa', 8, 2), 4: single('spd', 8, 7) }, { set: mySet('timid') })
    expect(ids(d)).toEqual(['plus:atk', 'plus:def', 'plus:spa', 'plus:spd'])
    for (const b of d.branches) expect(game.data.natures[b.nature].minus).toBe('spe')
  })

  it('AC3: 고정 합이 66을 넘는 갈래는 나오지 않는다', () => {
    const locks = [lock(1, ['atk']), lock(2, ['spe']), lock(3, ['hp', 'def'])]
    // 쌍 무보정은 H+B 최소 합 20(H20 B0), 상승은 4(H4 B0)
    const d = derive(locks, {
      1: single('atk', 26, 20),
      2: single('spe', 26, 20),
      3: pair('def', stairs((hp) => Math.max(0, 20 - hp)), stairs((hp) => Math.max(0, 4 - hp))),
    })
    // +A 20+26+20 = 66, +S 26+20+20 = 66, +B 26+26+4 = 56, 고정 밖 72
    expect(ids(d)).toEqual(['plus:atk', 'plus:spe', 'plus:def'])
    expect(branch(d, 'plus:def')).toMatchObject({ lockedSp: { atk: 26, spe: 26, hp: 4, def: 0 }, lockedSum: 56 })
  })
})

describe('deriveLocks 상태', () => {
  it('AC4: 66 초과 후보는 sp-short, 값은 66만 넘는 갈래들의 최소 초과량', () => {
    const locks = [lock(1, ['spe']), lock(2, ['hp', 'def'])]
    const res = {
      1: single('spe', 32, 26),
      2: pair('def', stairs((hp) => Math.max(0, 20 - hp)), stairs((hp) => Math.max(0, 14 - hp))),
    }
    // 후보 A(30 / 22): +S 26+20+30 = 76, +B 32+14+30 = 76, +A 32+20+22 = 74, 고정 밖 82 → 최소 초과 8
    const r = checkLockCandidate({
      game,
      mySet: mySet(),
      locks,
      resolutions: new Map(Object.entries(res).map(([k, v]) => [Number(k), v])),
      candidate: { lock: { kind: 'attack', target: damageTarget('attack', 'c'), stage: 'guaranteed-ohko', stats: ['atk'] }, resolution: single('atk', 30, 22) },
    })
    expect(r).toEqual({ kind: 'sp-short', over: 8 })
    const d = derive([...locks, lock(3, ['atk'])], { ...res, 3: single('atk', 30, 22) })
    expect(d.statuses.get(3)).toEqual({ kind: 'sp-short', over: 8 })
    expect(d.statuses.get(1)).toEqual({ kind: 'active' })
    expect(d.lockedStats).toEqual(['hp', 'def', 'spe'])
  })

  it('AC4: +A로만 닿는 A 고정 + +S로만 닿는 S 고정 → 성격 충돌', () => {
    const d = derive([lock(1, ['atk']), lock(2, ['spe'])], { 1: single('atk', null, 20), 2: single('spe', null, 20) })
    expect(d.statuses.get(1)).toEqual({ kind: 'active' })
    expect(d.statuses.get(2)).toEqual({ kind: 'nature-conflict' })
    expect(ids(d)).toEqual(['plus:atk'])
    expect(d.lockedStats).toEqual(['atk'])
    const r = checkLockCandidate({
      game,
      mySet: mySet(),
      locks: [lock(1, ['atk'])],
      resolutions: new Map([[1, single('atk', null, 20)]]),
      candidate: { lock: { kind: 'speed', target: speedTarget(), stage: 'first', stats: ['spe'] }, resolution: single('spe', null, 20) },
    })
    expect(r).toEqual({ kind: 'nature-conflict' })
  })

  it('후보 판정: 들어가면 ok, 두 선택지 모두 없거나 해석 실패면 unreachable', () => {
    const base = { game, mySet: mySet(), locks: [lock(1, ['spe'])], resolutions: new Map([[1, single('spe', 20, 12)]]) }
    const cand = { kind: 'attack' as const, target: damageTarget('attack'), stage: 'guaranteed-ohko' as const, stats: ['atk'] as StatId[] }
    expect(checkLockCandidate({ ...base, candidate: { lock: cand, resolution: single('atk', 20, 10) } })).toEqual({ kind: 'ok' })
    expect(checkLockCandidate({ ...base, candidate: { lock: cand, resolution: single('atk', null, null) } })).toEqual({ kind: 'unreachable' })
    expect(checkLockCandidate({ ...base, candidate: { lock: cand, resolution: { kind: 'missing' } } })).toEqual({ kind: 'unreachable' })
  })

  it('생성 순서로 판정하고, 앞 고정이 빠지면 뒤 고정이 복귀한다', () => {
    const locks = [lock(1, ['atk']), lock(2, ['spe'])]
    const ok = { 1: single('atk', null, 20), 2: single('spe', null, 20) }
    expect(derive(locks, ok).statuses.get(2)).toEqual({ kind: 'nature-conflict' })
    // seq를 바꾸면 충돌은 나중 고정에 붙는다
    const swapped = derive([lock(2, ['atk']), lock(1, ['spe'])], { 2: ok[1], 1: ok[2] })
    expect(swapped.statuses.get(2)).toEqual({ kind: 'nature-conflict' })
    expect(ids(swapped)).toEqual(['plus:spe'])
    // 앞 고정이 도달 불가가 되면 뒤 고정이 active로 돌아오고, 앞 고정이 회복하면 다시 충돌
    const blocked = derive(locks, { ...ok, 1: { kind: 'unreachable', reason: '계산 불가' } })
    expect(blocked.statuses.get(1)).toEqual({ kind: 'unreachable', reason: '계산 불가' })
    expect(blocked.statuses.get(2)).toEqual({ kind: 'active' })
    expect(ids(blocked)).toEqual(['plus:spe'])
    expect(derive(locks, ok).statuses.get(2)).toEqual({ kind: 'nature-conflict' })
  })

  it('입력 순서와 무관하게 seq 순으로 파생한다', () => {
    const res = { 1: single('atk', 28, 20), 2: single('spe', 20, 12) }
    const a = derive([lock(1, ['atk']), lock(2, ['spe'])], res)
    const b = derive([lock(2, ['spe']), lock(1, ['atk'])], res)
    expect(b.locks.map((l) => l.seq)).toEqual([1, 2])
    expect(ids(b)).toEqual(ids(a))
    expect([...b.statuses]).toEqual([...a.statuses])
  })

  it('상태 우선순위: 해석 상태(세트 오류·대상 없음·도달 불가)가 먼저 붙고, 그 고정은 갈래에 들지 않는다', () => {
    const locks = [lock(1, ['atk']), lock(2, ['spa']), lock(3, ['def'], 'attack'), lock(4, ['spd'], 'attack'), lock(5, ['spe'])]
    const d = derive(locks, {
      1: { kind: 'set-error' },
      3: { kind: 'unreachable' },
      4: single('spd', null, null),
      5: single('spe', 20, 12),
    })
    expect([...d.statuses]).toEqual([
      [1, { kind: 'set-error' }],
      [2, { kind: 'missing' }],
      [3, { kind: 'unreachable' }],
      [4, { kind: 'unreachable' }],
      [5, { kind: 'active' }],
    ])
    expect(d.lockedStats).toEqual(['spe'])
    expect(ids(d)).toEqual(['plus:spe', 'out'])
  })

  it('AC10: 대상 없음 → 계산에서 빠짐 → 대상이 돌아오면 복귀', () => {
    const locks = [lock(1, ['spe']), lock(2, ['atk'])]
    const ok = { 1: single('spe', 20, 12), 2: single('atk', 28, 20) }
    const gone = derive(locks, { ...ok, 2: { kind: 'missing' } })
    expect(gone.statuses.get(2)).toEqual({ kind: 'missing' })
    expect(gone.lockedStats).toEqual(['spe'])
    expect(ids(gone)).toEqual(['plus:spe', 'out'])
    const back = derive(locks, ok)
    expect(back.statuses.get(2)).toEqual({ kind: 'active' })
    expect(back.lockedStats).toEqual(['atk', 'spe'])
    expect(ids(back)).toEqual(['plus:spe', 'plus:atk', 'out'])
  })
})

describe('deriveLocks R4 합치기', () => {
  it('같은 단일 능력치 고정 여럿은 갈래 안에서 최대', () => {
    const d = derive([lock(1, ['spe']), lock(2, ['spe'])], { 1: single('spe', 20, 12), 2: single('spe', 24, 10) })
    expect(branch(d, 'plus:spe').lockedSp).toEqual({ spe: 12 })
    expect(branch(d, 'out').lockedSp).toEqual({ spe: 24 })
  })

  it('AC12: H를 공유하는 쌍 두 개는 H마다 합 최소(손 계산 대조), 능력치별 최대 합보다 크지 않다', () => {
    const b = stairs((hp) => Math.max(0, 16 - hp))
    const d = stairs((hp) => Math.max(0, 12 - Math.floor(hp / 2)))
    const r = derive([lock(1, ['hp', 'def']), lock(2, ['hp', 'spd'])], { 1: pair('def', b, null), 2: pair('spd', d, null) })
    // f(H) = H + max(0, 16 − H) + max(0, 12 − ⌊H/2⌋): H ≤ 16이면 28 − ⌊H/2⌋, H = 16에서 20, 그 뒤 증가
    expect(branch(r, 'out').lockedSp).toEqual({ hp: 16, def: 0, spd: 4 })
    expect(branch(r, 'out').lockedSum).toBe(20)
    // 쌍 하나씩의 최소 합 점(동률 H 큰 쪽): B 쌍 H16 B0, D 쌍 H0 D12 → 능력치별 최대 H16 B0 D12 = 28
    const alone1 = branch(derive([lock(1, ['hp', 'def'])], { 1: pair('def', b, null) }), 'out').lockedSp
    const alone2 = branch(derive([lock(2, ['hp', 'spd'])], { 2: pair('spd', d, null) }), 'out').lockedSp
    expect(alone1).toEqual({ hp: 16, def: 0 })
    expect(alone2).toEqual({ hp: 0, spd: 12 })
    const maxSum = Math.max(alone1.hp ?? 0, alone2.hp ?? 0) + (alone1.def ?? 0) + (alone2.spd ?? 0)
    expect(maxSum).toBe(28)
    expect(branch(r, 'out').lockedSum).toBeLessThanOrEqual(maxSum)
    // 완전 탐색 대조
    let best = Infinity
    for (let hp = 0; hp <= 32; hp++) best = Math.min(best, hp + (b[hp] ?? 0) + (d[hp] ?? 0))
    expect(branch(r, 'out').lockedSum).toBe(best)
  })

  it('계단에 불가(null) H가 있으면 그 H는 건너뛰고, 전부 불가면 그 갈래 없음', () => {
    const b = stairs((hp) => (hp < 10 ? null : Math.max(0, 14 - hp)))
    expect(branch(derive([lock(1, ['hp', 'def'])], { 1: pair('def', b, null) }), 'out').lockedSp).toEqual({ hp: 14, def: 0 })
    expect(ids(derive([lock(1, ['hp', 'def'])], { 1: pair('def', stairs(() => null), stairs(() => 0)) }))).toEqual(['plus:def'])
  })

  it('바디프레스 B 단일 + 방어 B 쌍: B 하나로 합쳐 합 최소(동률 H 큰 쪽)', () => {
    const d = derive([lock(1, ['def'], 'attack'), lock(2, ['hp', 'def'])], {
      1: single('def', 10, 6),
      2: pair('def', stairs((hp) => Math.max(0, 16 - hp)), stairs((hp) => Math.max(0, 10 - hp))),
    })
    expect(ids(d)).toEqual(['plus:def', 'out'])
    // 고정 밖: H + max(16 − H, 10) → H ≤ 6에서 16 → H6 B10
    expect(branch(d, 'out')).toMatchObject({ lockedSp: { hp: 6, def: 10 }, lockedSum: 16 })
    // +B: H + max(10 − H, 6) → H ≤ 4에서 10 → H4 B6, 두 고정 모두 상승안
    expect(branch(d, 'plus:def')).toMatchObject({ nature: 'impish', lockedSp: { hp: 4, def: 6 }, lockedSum: 10 })
    expect([...branch(d, 'plus:def').choice]).toEqual([
      [1, 'plus'],
      [2, 'plus'],
    ])
  })

  it('단일 H 고정은 쌍 묶음의 H 하한', () => {
    const d = derive([lock(1, ['hp'], 'defense'), lock(2, ['hp', 'def'])], {
      1: single('hp', 12, null),
      2: pair('def', stairs((hp) => Math.max(0, 20 - 2 * hp)), null),
    })
    expect(ids(d)).toEqual(['out'])
    expect(branch(d, 'out').lockedSp).toEqual({ hp: 12, def: 0 })
  })

  it('능력치를 공유하지 않는 묶음은 따로 합친다', () => {
    const d = derive([lock(1, ['hp', 'def']), lock(2, ['spe'])], { 1: pair('def', stairs((hp) => Math.max(0, 8 - hp)), null), 2: single('spe', 20, 12) })
    expect(branch(d, 'out').lockedSp).toEqual({ hp: 8, def: 0, spe: 20 })
  })
})

describe('deriveLocks 기준 갈래(AC14)', () => {
  it('고정 밖 갈래가 있으면 남은 예산이 더 작아도 고정 밖', () => {
    expect(derive([lock(1, ['spe'])], { 1: single('spe', 20, 12) }).baseId).toBe('out')
  })

  it('고정 밖이 없으면 고정 합 최소, 동률이면 seq가 앞선 고정의 능력치 갈래', () => {
    const res = (a: number, c: number) => ({
      [a]: single('atk', 8, 2),
      2: single('def', 8, 4),
      [c]: single('spa', 8, 2),
      4: single('spd', 8, 7),
    })
    const locksA = [lock(1, ['atk']), lock(2, ['def'], 'attack'), lock(3, ['spa']), lock(4, ['spd'], 'attack')]
    const d = derive(locksA, res(1, 3), { set: mySet('timid') })
    expect(ids(d)).not.toContain('out')
    expect(d.baseId).toBe('plus:atk')
    const locksC = [lock(3, ['atk']), lock(2, ['def'], 'attack'), lock(1, ['spa']), lock(4, ['spd'], 'attack')]
    expect(derive(locksC, res(3, 1), { set: mySet('timid') }).baseId).toBe('plus:spa')
  })

  it('유효한 baseChoice는 그대로, 사라진 갈래를 고르면 자동 규칙으로 돌아간다', () => {
    const locks = [lock(1, ['spe'])]
    expect(derive(locks, { 1: single('spe', 20, 12) }, { baseChoice: 'plus:spe' }).baseId).toBe('plus:spe')
    expect(derive(locks, { 1: single('spe', 20, null) }, { baseChoice: 'plus:spe' }).baseId).toBe('out')
    expect(derive(locks, { 1: single('spe', 20, 12) }, { baseChoice: 'plus:atk' }).baseId).toBe('out')
  })

  it('overTotal = 기준 갈래 고정 합 + 고정 밖 내 SP − 66(0 이상)', () => {
    const locks = [lock(1, ['spe'])]
    const res = { 1: single('spe', 20, 12) }
    expect(derive(locks, res, { set: mySet('hardy', { hp: 2, atk: 32, spe: 32 }) }).overTotal).toBe(0)
    expect(derive(locks, res, { set: mySet('hardy', { hp: 2, atk: 32, def: 20, spe: 32 }) }).overTotal).toBe(8)
    expect(derive(locks, res, { set: mySet('hardy', { hp: 2, atk: 32, def: 20 }), baseChoice: 'plus:spe' }).overTotal).toBe(0)
  })
})

describe('branchBudget·budgetMark(R6·R9)', () => {
  const spTotal = game.manifest.rules.spTotal
  const set = mySet('hardy', { hp: 2, atk: 32 })
  const d = derive([lock(1, ['spe'])], { 1: single('spe', 20, 12) }, { set })

  it('보는 능력치가 고정 아님: 66 − 갈래 고정 합 − 고정도 보지도 않는 능력치 SP', () => {
    expect(branchBudget(d, branch(d, 'out'), set.sp, ['hp', 'def'], spTotal)).toEqual({ remaining: 14, othersSp: 32 })
    expect(branchBudget(d, branch(d, 'plus:spe'), set.sp, ['hp', 'def'], spTotal)).toEqual({ remaining: 22, othersSp: 32 })
  })

  it('보는 능력치가 고정: 그 고정 SP를 되더한다', () => {
    expect(branchBudget(d, branch(d, 'out'), set.sp, ['spe'], spTotal)).toEqual({ remaining: 32, othersSp: 34 })
  })

  it('0 미만은 0', () => {
    const heavy = { ...set.sp, spa: 32, hp: 10 }
    expect(branchBudget(d, branch(d, 'out'), heavy, ['def'], spTotal)).toEqual({ remaining: 0, othersSp: 74 })
  })

  it('budgetMark: 들면 fits, 아니면 n = 필요 − 남은, n이 다른 능력치 SP 합을 넘으면 m = n − 그 합', () => {
    expect(budgetMark(14, 14, 32)).toEqual({ kind: 'fits' })
    expect(budgetMark(16, 14, 32)).toEqual({ kind: 'need', n: 2 })
    expect(budgetMark(46, 14, 32)).toEqual({ kind: 'need', n: 32 })
    expect(budgetMark(50, 14, 32)).toEqual({ kind: 'short', m: 4 })
  })
})
