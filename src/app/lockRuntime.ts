// 앱 최상위 컷 고정 런타임: 스피드 고정 해석, 실행 세대(리듀서 세대 + 스피드 해석 서명), 실행기 고정 입력.
import { useMemo, useState } from 'react'
import { resolveSpeedLocks, speedLockSignature, type LockResolution } from '../cards'
import type { Snapshot } from '../data/schema'
import type { MetaView } from '../meta'
import { toPokemonSet } from '../ui/setDraft'
import type { LockRun } from './executor'
import { toLockRun } from './input'
import type { AppState } from './state'

const NO_SPEED: ReadonlyMap<number, LockResolution> = new Map()

type SpeedLockState = Pick<AppState, 'draft' | 'locks' | 'criteria' | 'customTargets' | 'speedChart'>

/** 스피드 고정 해석. view가 없거나(메타 로드 전) 스피드 고정이 없으면 빈 맵 */
export function speedLockResolutions(state: SpeedLockState, game: Snapshot, view: MetaView | undefined): ReadonlyMap<number, LockResolution> {
  if (view === undefined || !state.locks.some((l) => l.kind === 'speed')) return NO_SPEED
  return resolveSpeedLocks({
    game,
    view,
    mySet: toPokemonSet(game, state.draft).set,
    locks: state.locks,
    criteria: state.criteria,
    customTargets: state.customTargets,
    added: state.speedChart.added,
    myTailwind: state.speedChart.myTailwind,
  })
}

export interface RunGeneration {
  reducerGeneration: number
  signature: string
  /** 실행기와 모든 세대 비교 지점에 쓰는 세대 */
  run: number
}

export const initialRunGeneration = (reducerGeneration: number, signature: string): RunGeneration => ({ reducerGeneration, signature, run: reducerGeneration })

/**
 * 리듀서 세대가 바뀌면 그만큼, 서명만 바뀌면 1 오른다. 둘 다 그대로면 prev 자체를 돌려준다.
 * run − reducerGeneration은 서명만 바뀐 횟수라, 서명이 바뀐 적 없으면 run = 리듀서 세대다.
 */
export function nextRunGeneration(prev: RunGeneration, reducerGeneration: number, signature: string): RunGeneration {
  if (reducerGeneration !== prev.reducerGeneration) return { reducerGeneration, signature, run: prev.run + (reducerGeneration - prev.reducerGeneration) }
  if (signature !== prev.signature) return { reducerGeneration, signature, run: prev.run + 1 }
  return prev
}

export interface LockRuntime {
  /** 실행기 setInput의 세 번째 인자(고정이 없으면 undefined) */
  lockRun: LockRun | undefined
  /** 실행기·화면 세대 비교에 리듀서 세대 대신 쓴다 */
  runGeneration: number
  speedResolutions: ReadonlyMap<number, LockResolution>
}

export function useLockRuntime(state: AppState, game: Snapshot, view: MetaView | undefined): LockRuntime {
  const { draft, locks, lockBase, criteria, customTargets, speedChart } = state
  const speedResolutions = useMemo(
    () => speedLockResolutions({ draft, locks, criteria, customTargets, speedChart }, game, view),
    [draft, locks, criteria, customTargets, speedChart, game, view],
  )
  const signature = useMemo(() => speedLockSignature(speedResolutions), [speedResolutions])
  const [gen, setGen] = useState(() => initialRunGeneration(state.generation, signature))
  const next = nextRunGeneration(gen, state.generation, signature)
  // 렌더 중 이전 값에서 파생하는 상태 갱신(같은 입력이면 같은 객체라 다시 렌더하지 않는다)
  if (next !== gen) setGen(next)
  const lockRun = useMemo(() => toLockRun({ locks, lockBase }, speedResolutions), [locks, lockBase, speedResolutions])
  return { lockRun, runGeneration: next.run, speedResolutions }
}
