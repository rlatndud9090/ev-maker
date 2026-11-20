import { describe, expect, it } from 'vitest'
import { buildSpeedChart, speedBadgeLockKey, speedLockSignature, type SpeedBadge } from '../cards'
import { realData } from '../cards/testing'
import { toPokemonSet } from '../ui/setDraft'
import { initialRunGeneration, nextRunGeneration, speedLockResolutions, type RunGeneration } from './lockRuntime'
import { initialState, reducer, type AppAction, type AppState } from './state'

const { game, bo1 } = realData()
const SP_TOTAL = game.manifest.rules.spTotal

describe('nextRunGeneration', () => {
  it('리듀서 세대·서명이 그대로면 같은 객체', () => {
    const g = initialRunGeneration(3, 'a')
    expect(g.run).toBe(3)
    expect(nextRunGeneration(g, 3, 'a')).toBe(g)
  })

  it('서명만 바뀌면 +1, 리듀서 세대가 바뀌면 그만큼(서명이 같이 바뀌어도)', () => {
    const g0 = initialRunGeneration(0, 'a')
    const g1 = nextRunGeneration(g0, 0, 'b')
    expect(g1).toEqual({ reducerGeneration: 0, signature: 'b', run: 1 })
    const g2 = nextRunGeneration(g1, 1, 'c')
    expect(g2).toEqual({ reducerGeneration: 1, signature: 'c', run: 2 })
    const g3 = nextRunGeneration(g2, 3, 'c')
    expect(g3.run).toBe(4)
  })

  it('서명이 바뀐 적 없으면 실행 세대 = 리듀서 세대', () => {
    let g = initialRunGeneration(0, '[]')
    for (const r of [1, 2, 2, 5, 6]) {
      g = nextRunGeneration(g, r, '[]')
      expect(g.run).toBe(r)
    }
  })
})

/** 상태 열마다 실행 세대를 굴려 실행기 입력(세대)이 바뀐 횟수를 센다 */
function runUpdates(states: readonly AppState[]): number {
  let gen: RunGeneration | null = null
  let updates = 0
  for (const s of states) {
    const sig = speedLockSignature(speedLockResolutions(s, game, bo1))
    const next: RunGeneration = gen === null ? initialRunGeneration(s.generation, sig) : nextRunGeneration(gen, s.generation, sig)
    if (gen !== null && next.run !== gen.run) updates++
    gen = next
  }
  return updates
}

function steps(start: AppState, actions: readonly AppAction[]): AppState[] {
  const out = [start]
  for (const a of actions) out.push(reducer(out[out.length - 1], a))
  return out
}

const base = initialState(game.manifest.regulation.id)
const mySet = toPokemonSet(game, base.draft).set
const chart = buildSpeedChart({
  game,
  view: bo1,
  myAbility: mySet.ability,
  criteria: base.criteria,
  filters: base.filters,
  customTargets: [],
  added: [],
})
const locked = (badge: SpeedBadge): AppState =>
  reducer(base, { type: 'add-lock', lock: { kind: 'speed', target: speedBadgeLockKey(badge), stage: 'first', stats: ['spe'] }, spTotal: SP_TOTAL })
const tailwindChanges = (badge: SpeedBadge): boolean => {
  const s = locked(badge)
  const off = speedLockSignature(speedLockResolutions(s, game, bo1))
  const on = speedLockSignature(speedLockResolutions(reducer(s, { type: 'set-my-tailwind', on: true }), game, bo1))
  return off !== on
}
const noneBadges = chart.badges.filter((b) => b.condition.kind === 'none')
const stable = noneBadges.find((b) => !tailwindChanges(b))
const moving = noneBadges.find((b) => tailwindChanges(b))

describe('실행 세대: 스피드 고정 입력(AC16)', () => {
  it('찾은 배지 전제', () => {
    expect(stable).toBeDefined()
    expect(moving).toBeDefined()
  })

  it('무관한 스피드 배분 추가·고정 S가 그대로인 순풍 토글 → 실행기 입력 갱신 0회', () => {
    if (stable === undefined) return
    const other = chart.badges.find((b) => b.opponentId !== stable.opponentId && b.origin === 'ladder')
    expect(other).toBeDefined()
    if (other === undefined) return
    const s = locked(stable)
    const actions: AppAction[] = [
      { type: 'add-speed-bundle', bundle: { opponentId: other.opponentId, sp: 7, nature: 'neutral' }, spMax: game.manifest.rules.spMaxPerStat },
      { type: 'set-my-tailwind', on: true },
      { type: 'set-my-tailwind', on: false },
    ]
    const seq = steps(s, actions)
    expect(seq.every((x) => x.generation === s.generation)).toBe(true)
    expect(runUpdates(seq)).toBe(0)
  })

  it('고정 S가 바뀌는 순풍 토글 → 1회', () => {
    if (moving === undefined) return
    expect(runUpdates(steps(locked(moving), [{ type: 'set-my-tailwind', on: true }]))).toBe(1)
  })

  it('고정이 없으면 리듀서 세대만 따른다(스피드 입력은 갱신 0회, 세대 입력은 그 횟수)', () => {
    const target = moving ?? chart.badges[0]
    const seq = steps(base, [
      { type: 'set-my-tailwind', on: true },
      { type: 'add-speed-bundle', bundle: { opponentId: target.opponentId, sp: 7, nature: 'neutral' }, spMax: game.manifest.rules.spMaxPerStat },
      { type: 'set-roll-steps', steps: 2 },
      { type: 'set-my-tailwind', on: false },
      { type: 'set-top-n', topN: 5 },
    ])
    expect(speedLockResolutions(seq[seq.length - 1], game, bo1).size).toBe(0)
    const reducerBumps = seq.slice(1).filter((s, i) => s.generation !== seq[i].generation).length
    expect(runUpdates(seq)).toBe(reducerBumps)
    let g = initialRunGeneration(seq[0].generation, '[]')
    for (const s of seq) {
      g = nextRunGeneration(g, s.generation, speedLockSignature(speedLockResolutions(s, game, bo1)))
      expect(g.run).toBe(s.generation)
    }
  })
})
