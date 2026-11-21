/// <reference types="node" />
// ADR 결정 18·AC13: 고정 없는 입력의 cards·core 출력을 변경 전 코드 지문(__fixtures__/no-lock-identity.json)으로 봉인한다. 갱신은 UPDATE_NO_LOCK_IDENTITY=1일 때만.
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { afterAll, describe, expect, it } from 'vitest'
import { STAT_IDS, finalSpeed, minSpToOutspeed, validateSet, type PokemonSet } from '../core'
import type { StatId } from '../data/schema'
import { EXAMPLE_DRAFT } from '../app/example'
import { toPokemonSet } from '../ui/setDraft'
import { buildTabView } from '../cards/batch'
import { buildSpeedChart } from '../cards/speedChart'
import { minSpToPass, speedBaseline, statusOf } from '../cards/speedLadder'
import { natureVariants } from '../cards/natures'
import { cardInput, realData } from '../cards/testing'
import { DEFAULT_TOP_N, type CardInput, type CustomTarget, type TabView } from '../cards/types'

const FIXTURE = new URL('./__fixtures__/no-lock-identity.json', import.meta.url)
const UPDATE = process.env.UPDATE_NO_LOCK_IDENTITY === '1'

const { game } = realData()
const regulation = game.manifest.regulation.id
const sp = (patch: Partial<Record<StatId, number>>): Record<StatId, number> => ({ hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...patch })
const mk = (s: Omit<PokemonSet, 'regulation' | 'sp'> & { sp: Partial<Record<StatId, number>> }): PokemonSet => ({ regulation, ...s, sp: sp(s.sp) })

const ROTOM_WASH: CustomTarget = { rosterId: 'rotomwash', moves: ['hydropump', 'poltergeist', 'electroweb'], edits: {} }

interface Case {
  name: string
  mySet: PokemonSet
  topN: number
  customTargets?: readonly CustomTarget[]
}

const CASES: readonly Case[] = [
  { name: 'example-garchomp', mySet: toPokemonSet(game, EXAMPLE_DRAFT).set, topN: DEFAULT_TOP_N },
  {
    name: 'ac1-raichu-mega-y',
    mySet: mk({ species: 'raichu', ability: 'static', item: 'raichunitey', mega: true, nature: 'hardy', sp: {}, moves: ['thunderbolt', 'focusblast', 'grassknot', 'voltswitch'] }),
    topN: 20,
  },
  {
    name: 'gyroball-metagross',
    mySet: mk({ species: 'metagross', ability: 'clearbody', item: 'leftovers', nature: 'brave', sp: { hp: 32, atk: 32, def: 2 }, moves: ['gyroball', 'bulletpunch', 'earthquake', 'ironhead'] }),
    topN: 20,
  },
  {
    name: 'bodypress-corviknight',
    mySet: mk({ species: 'corviknight', ability: 'mirrorarmor', item: 'leftovers', nature: 'impish', sp: { hp: 32, def: 32, spd: 2 }, moves: ['bodypress', 'bravebird', 'irondefense', 'roost'] }),
    topN: 20,
    customTargets: [ROTOM_WASH],
  },
  {
    name: 'full66-electroball-raichu-scarf',
    mySet: mk({ species: 'raichu', ability: 'lightningrod', item: 'choicescarf', nature: 'timid', sp: { hp: 2, spa: 32, spe: 32 }, moves: ['thunderbolt', 'electroball', 'grassknot', 'focusblast'] }),
    topN: 20,
  },
]

function canon(v: unknown): unknown {
  if (v === undefined) return '$undefined'
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return v
  if (typeof v === 'number') return Number.isFinite(v) ? v : `$number:${String(v)}`
  if (Array.isArray(v)) return v.map(canon)
  if (v instanceof Map) return { $map: [...v.entries()].map(([k, x]) => [canon(k), canon(x)]) }
  if (v instanceof Set) return { $set: [...v].map(canon) }
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    return Object.fromEntries(Object.keys(o).sort().map((k) => [k, canon(o[k])]))
  }
  throw new Error(`지문에 넣을 수 없는 값: ${typeof v}`)
}

const digest = (v: unknown): string => createHash('sha256').update(JSON.stringify(canon(v))).digest('hex')

function attempt<T>(f: () => T): T | { thrown: string } {
  try {
    return f()
  } catch (e) {
    return { thrown: e instanceof Error ? `${e.name}: ${e.message}` : String(e) }
  }
}

function tabSummary(view: TabView) {
  const first = view.cards[0]
  return {
    status: view.status.kind,
    cards: view.cards.length,
    complete: view.complete,
    progress: view.progress,
    first: first && { id: first.id, opponent: first.opponent.id, category: first.category, headline: first.headline.kind, rows: first.rows.length },
  }
}

const TARGET_SPEEDS = [50, 100, 150, 200, 250, 300]

function fingerprint(c: Case) {
  const input: CardInput = cardInput({ mySet: c.mySet, filters: { topN: c.topN, selected: [] }, customTargets: c.customTargets ?? [] })
  const attack = buildTabView(input, 'attack')
  const defense = buildTabView(input, 'defense')
  const myAbility = attempt(() => validateSet(game, c.mySet).ability)
  // speed-bundles-pin-disable R1이 무고정 스피드 기본 배지를 "SP 배분 기준 이상 전부"로 의도적으로 바꿨다(고정 경로 누수가 아님).
  // 봉인 지문은 그대로 두고, 기준을 100% 초과로 두어 "1위 하나" 대체 규칙(= 변경 전 선정)만 남긴 차트로 나머지 전부(조건·추가·세트·실수치)를 봉인한다
  const chart = buildSpeedChart({
    game,
    view: input.view,
    myAbility: typeof myAbility === 'string' ? myAbility : null,
    criteria: { ...input.criteria, bundleShareMin: Infinity },
    filters: input.filters,
    customTargets: input.customTargets,
    added: [],
  })
  const baselines = [false, true].map((tw) => speedBaseline(game, c.mySet, tw))
  const ladder = {
    baselines,
    badges: chart.badges.map((b) => ({
      id: b.id,
      status: baselines.map((bl) => statusOf(b.speed, bl)),
      pass: [false, true].map((tw) => minSpToPass(game, c.mySet, b.speed, tw)),
    })),
  }
  const tailwind = { attacker: { tailwind: true } }
  const core = {
    finalSpeed: [attempt(() => finalSpeed(game, c.mySet)), attempt(() => finalSpeed(game, c.mySet, tailwind))],
    minSpToOutspeed: TARGET_SPEEDS.map((t) => [attempt(() => minSpToOutspeed(game, c.mySet, t)), attempt(() => minSpToOutspeed(game, c.mySet, t, tailwind))]),
  }
  return {
    hashes: { attack: digest(attack), defense: digest(defense), speedChart: digest(chart), speedLadder: digest(ladder), core: digest(core) },
    summary: {
      attack: tabSummary(attack),
      defense: tabSummary(defense),
      speed: { badges: chart.badges.length, unsupported: chart.unsupported.length, options: chart.options.size, baseline: baselines[0] },
      finalSpeed: core.finalSpeed[0],
    },
  }
}

function natureFingerprint() {
  const relevants: readonly (readonly StatId[])[] = [[], ['atk'], ['spa'], ['atk', 'spa'], ['def', 'spd'], ['hp', 'def'], ['spe'], STAT_IDS]
  const stats = ['atk', 'def', 'spa', 'spd', 'spe'] as const
  const ids = Object.keys(game.data.natures).sort()
  const table = ids.flatMap((n) => stats.flatMap((s) => relevants.map((r) => [n, s, r, natureVariants(game, n, s, r)])))
  return { hash: digest(table), count: table.length }
}

type Fixture = { regulation: string; natures: ReturnType<typeof natureFingerprint>; cases: Record<string, ReturnType<typeof fingerprint>> }

const stored: Fixture | null = existsSync(FIXTURE) ? (JSON.parse(readFileSync(FIXTURE, 'utf8')) as Fixture) : null
const fresh: Fixture = { regulation, natures: { hash: '', count: 0 }, cases: {} }

describe('무고정 동일성 지문(변경 전 코드로 봉인, 기능 작업이 fixture를 갱신하면 안 된다)', () => {
  afterAll(() => {
    if (UPDATE) writeFileSync(FIXTURE, `${JSON.stringify(fresh, null, 2)}\n`)
  })

  it('봉인 fixture가 있고 같은 레귤레이션이다', () => {
    if (UPDATE) return
    expect(stored, 'fixture 없음: UPDATE_NO_LOCK_IDENTITY=1로 변경 전 코드에서 한 번 생성한다').not.toBeNull()
    expect(stored?.regulation).toBe(regulation)
    expect(Object.keys(stored?.cases ?? {})).toEqual(CASES.map((c) => c.name))
  })

  it('사례 세트는 모두 유효한 세트다(세트 오류 경로가 아닌 실제 판정을 봉인)', () => {
    for (const c of CASES) expect(() => validateSet(game, c.mySet), c.name).not.toThrow()
  })

  it('natureVariants 전 조합', () => {
    fresh.natures = natureFingerprint()
    if (!UPDATE) expect(fresh.natures).toEqual(stored?.natures)
  })

  for (const c of CASES) {
    it(`${c.name}: 공격·방어 탭 뷰, 스피드 차트·사다리, 코어 스피드`, () => {
      const fp = fingerprint(c)
      fresh.cases[c.name] = fp
      if (UPDATE) return
      const want = stored?.cases[c.name]
      expect(fp.summary).toEqual(want?.summary)
      expect(fp.hashes).toEqual(want?.hashes)
    }, 120_000)
  }
})
