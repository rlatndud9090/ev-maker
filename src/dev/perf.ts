// 개발용 브라우저 성능 측정 훅(window.__perf). e2e가 호출한다. 코어 공개 API를 그대로 부른다.
import type { Snapshot, StatTable } from '../data/schema'
import { calcDamage, sweepDamage, type PokemonSet } from '../core'
import { loadSnapshot } from '../data/loader'
import { assertMetaSnapshot } from '../data/meta-guard'
import type { MetaSnapshot } from '../data/meta-schema'
import { createMetaView, topAssumptions } from '../meta'

const ZERO: StatTable = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }

export interface PerfStats {
  median: number
  min: number
  max: number
  runs: number
}

export interface PerfHook {
  /** 대도각참 기습 → 메가마폭시 공격 SP 33칸 sweepDamage */
  sweep(runs?: number, warmup?: number): Promise<PerfStats>
  /** 고집 맘모꾸리 지진 → 상대 300세트 calcDamage */
  batch(runs?: number, warmup?: number): Promise<PerfStats>
  /** m-c 2026-10 Bo1 메타 본문 JSON.parse → 검사 → 뷰 → 상위 30 대표 가정 */
  metaLoad(runs?: number, warmup?: number): Promise<PerfStats>
}

declare global {
  interface Window {
    __perf?: PerfHook
  }
}

function measure(fn: () => void, runs: number, warmup: number): PerfStats {
  for (let i = 0; i < warmup; i++) fn()
  const samples: number[] = []
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now()
    fn()
    samples.push(performance.now() - t0)
  }
  samples.sort((a, b) => a - b)
  const mid = samples.length >> 1
  const median = samples.length % 2 ? samples[mid] : (samples[mid - 1] + samples[mid]) / 2
  return { median, min: samples[0], max: samples[samples.length - 1], runs }
}

const set = (s: Snapshot, p: Omit<PokemonSet, 'regulation' | 'sp'> & { sp?: Partial<StatTable> }): PokemonSet => ({
  ...p,
  regulation: s.manifest.regulation.id,
  sp: { ...ZERO, ...p.sp },
})

function batchOpponents(s: Snapshot, count: number): PokemonSet[] {
  const unsupported = s.manifest.engineUnsupported
  const pool = Object.values(s.data.species)
    // 탈(Disguise)은 코어가 대미지 계산을 거부한다.
    .filter((e) => !e.isMega && !unsupported.species.includes(e.id) && !unsupported.abilities.includes(e.abilities[0]) && e.abilities[0] !== 'disguise')
    .sort((a, b) => a.id.localeCompare(b.id))
  return Array.from({ length: count }, (_, i) => {
    const e = pool[i % pool.length]
    return set(s, { species: e.id, ability: e.abilities[0], nature: 'hardy', moves: [], sp: { hp: i % 2 ? 0 : 32 } })
  })
}

export function installPerfHook(): void {
  window.__perf = {
    async sweep(runs = 50, warmup = 5) {
      const s = await loadSnapshot('m-c')
      const atk = set(s, { species: 'kingambit', ability: 'defiant', nature: 'hardy', moves: ['suckerpunch'] })
      const def = set(s, { species: 'delphox', ability: 'blaze', item: 'delphoxite', mega: true, nature: 'hardy', moves: [], sp: { hp: 2 } })
      return measure(() => void sweepDamage(s, { side: 'attacker', stat: 'atk' }, atk, def, 'suckerpunch'), runs, warmup)
    },
    async batch(runs = 10, warmup = 2) {
      const s = await loadSnapshot('m-c')
      const atk = set(s, { species: 'mamoswine', ability: 'oblivious', nature: 'adamant', moves: ['earthquake'], sp: { atk: 32 } })
      const opponents = batchOpponents(s, 300)
      return measure(() => opponents.forEach((d) => calcDamage(s, atk, d, 'earthquake')), runs, warmup)
    },
    async metaLoad(runs = 20, warmup = 3) {
      const s = await loadSnapshot('m-c')
      const { default: text } = await import('../data/meta/m-c/2026-10-bo1.json?raw')
      const sel = { regulation: 'm-c', match: 'bo1', month: '2026-10' } as const
      return measure(
        () => {
          const meta = JSON.parse(text) as MetaSnapshot
          assertMetaSnapshot(sel, meta)
          if (topAssumptions(createMetaView(meta, s), 30).length !== 30) throw new Error('상위 30 대표 가정 부족')
        },
        runs,
        warmup,
      )
    },
  }
}
