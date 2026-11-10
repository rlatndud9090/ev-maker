// 성격을 능력치 줄의 상승(+)·하락(−) 토글로 고른다. 하락은 선택: 고르지 않으면 계산에 덜 쓰이는 쪽으로 자동 지정한다.
import type { Snapshot, StatId } from '../data/schema'

export type NatureStat = Exclude<StatId, 'hp'>

export interface NatureChoice {
  plus?: NatureStat
  minus?: NatureStat
  /** 하락이 자동 지정인지(사용자가 −를 직접 누르지 않음) */
  minusAuto: boolean
}

/** 상승·하락 쌍의 성격 id. 둘 다 없으면 무보정 성격. */
export function natureIdFor(snapshot: Snapshot, plus?: NatureStat, minus?: NatureStat): string {
  const all = Object.values(snapshot.data.natures)
  const hit =
    plus !== undefined && minus !== undefined
      ? all.find((n) => n.plus === plus && n.minus === minus)
      : all.find((n) => n.plus === undefined || n.plus === n.minus)
  if (!hit) throw new Error(`성격 없음: +${plus ?? '-'} −${minus ?? '-'}`)
  return hit.id
}

/** 성격 id → 토글 상태(무보정이면 둘 다 없음). */
export function choiceOf(snapshot: Snapshot, natureId: string, minusAuto: boolean): NatureChoice {
  const n = Object.prototype.hasOwnProperty.call(snapshot.data.natures, natureId) ? snapshot.data.natures[natureId] : undefined
  if (!n || n.plus === undefined || n.minus === undefined || n.plus === n.minus) return { minusAuto: false }
  return { plus: n.plus, minus: n.minus, minusAuto }
}

/** 자동 하락: A↔C는 서로, 그 밖은 내 기술이 특수만이면 A, 아니면 C. */
export function autoMinus(snapshot: Snapshot, plus: NatureStat, moveIds: readonly string[]): NatureStat {
  if (plus === 'atk') return 'spa'
  if (plus === 'spa') return 'atk'
  const cats = moveIds.flatMap((id) => (Object.prototype.hasOwnProperty.call(snapshot.data.moves, id) ? [snapshot.data.moves[id].category] : []))
  const special = cats.includes('Special')
  const physical = cats.includes('Physical')
  return special && !physical ? 'atk' : 'spa'
}

/** + 토글: 켜진 줄을 다시 누르면 끈다(무보정). 직접 고른 −는 다른 줄이면 유지한다. */
export function togglePlus(snapshot: Snapshot, c: NatureChoice, stat: NatureStat, moveIds: readonly string[]): NatureChoice {
  if (c.plus === stat) return { minusAuto: false }
  const keep = !c.minusAuto && c.minus !== undefined && c.minus !== stat
  return keep ? { plus: stat, minus: c.minus, minusAuto: false } : { plus: stat, minus: autoMinus(snapshot, stat, moveIds), minusAuto: true }
}

/** − 토글: + 없이·+와 같은 줄에는 켤 수 없다. 직접 고른 −를 다시 누르면 자동으로 돌아간다. */
export function toggleMinus(snapshot: Snapshot, c: NatureChoice, stat: NatureStat, moveIds: readonly string[]): NatureChoice {
  if (c.plus === undefined || c.plus === stat) return c
  if (c.minus === stat && !c.minusAuto) return { plus: c.plus, minus: autoMinus(snapshot, c.plus, moveIds), minusAuto: true }
  return { plus: c.plus, minus: stat, minusAuto: false }
}

/** 기술이 바뀌면 자동 −를 다시 정한다. */
export function refreshAuto(snapshot: Snapshot, c: NatureChoice, moveIds: readonly string[]): NatureChoice {
  if (!c.minusAuto || c.plus === undefined) return c
  return { plus: c.plus, minus: autoMinus(snapshot, c.plus, moveIds), minusAuto: true }
}
