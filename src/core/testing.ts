/// <reference types="node" />
// 테스트 전용 픽스처. 앱 코드에서 import하지 않는다.
import { loadSnapshotSync } from '../data/testing'
import type { Snapshot, StatTable } from '../data/schema'
import type { PokemonSet } from './types'
import golden from './__golden__/independent.json'

export const MC: Snapshot = loadSnapshotSync('m-c')
export const MB: Snapshot = loadSnapshotSync('m-b')

export const ZERO_SP: StatTable = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }

export const toId = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

type SetInput = Omit<Partial<PokemonSet>, 'sp'> & { species: string; ability: string; sp?: Partial<StatTable> }

export function mkSet(input: SetInput, snapshot: Snapshot = MC): PokemonSet {
  const { sp, ...rest } = input
  return { regulation: snapshot.manifest.regulation.id, nature: 'hardy', moves: [], ...rest, sp: { ...ZERO_SP, ...sp } }
}

export interface GoldenSide {
  setSpecies: string
  mega: boolean
  nature: string
  ability: string
  item: string | null
  sp: StatTable
}

/**
 * 독립 기준값의 표시명 입력을 앱 세트(id)로 옮긴다.
 * 기준값의 ability는 계산에 쓴 특성이라, 메가 세트는 원종 첫 특성을 세트 특성으로 쓰고 메가 폼 특성과 같은지 확인한다.
 */
export function goldenSet(side: GoldenSide, moves: string[] = []): PokemonSet {
  const species = toId(side.setSpecies)
  let ability = toId(side.ability)
  if (side.mega) {
    const forme = MC.data.megas.find((m) => m.base === species && m.stone === toId(side.item ?? ''))
    if (!forme || MC.data.species[forme.forme].abilities[0] !== ability) throw new Error(`기준값 메가 특성 불일치: ${side.setSpecies}`)
    ability = MC.data.species[species].abilities[0]
  }
  const set: PokemonSet = {
    regulation: 'm-c',
    species,
    ability,
    nature: toId(side.nature),
    sp: { ...side.sp },
    moves,
  }
  if (side.item) set.item = toId(side.item)
  if (side.mega) set.mega = true
  return set
}

/** 사례마다 모양이 달라 호출 측이 형태를 지정한다. */
export function goldenCase<T>(id: string): T & { source: string; attacker: GoldenSide; defender: GoldenSide } {
  const c = golden.cases.find((x) => x.id === id)
  if (!c) throw new Error(`golden case ${id} 없음`)
  return c as unknown as T & { source: string; attacker: GoldenSide; defender: GoldenSide }
}
export const GOLDEN_SOURCE = golden.source

/** 깊은 복제(합성 스냅샷용). */
export const cloneSnapshot = (s: Snapshot): Snapshot => structuredClone(s)
