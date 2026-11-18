/// <reference types="node" />
import { describe, expect, it } from 'vitest'
import type { MetaEntry } from '../data/meta-schema'
import { RESIST_BERRIES } from './berries'
import { iconTargets } from './iconTargets'
import { POWER_ITEMS } from './powerItems'
import { realData, syntheticEntry } from './testing'

const { game, bo1 } = realData()
const entry = (id: string): MetaEntry => {
  const e = bo1.meta.entries.find((x) => x.id === id)
  if (e === undefined) throw new Error(`실데이터에 ${id}가 없다`)
  return e
}
const withItem = (base: MetaEntry, item: string, shares: Record<string, number>): MetaEntry =>
  syntheticEntry(base, { representative: { ...base.representative, set: { ...base.representative.set, item } }, items: { ...base.items, shares } })

describe('iconTargets (R14 = 판정에 관여하는 도구)', () => {
  it('메타가 없어도 반감열매·화력 도구 전부와 스피드 배수 도구(구애스카프·검은철구)가 들어간다', () => {
    const t = iconTargets(game, [])
    for (const id of [...Object.keys(RESIST_BERRIES), ...POWER_ITEMS]) expect(t.get(id), id).toContain('existing')
    expect(t.get('choicescarf')).toEqual(['speed-item'])
    expect(t.get('ironball')).toEqual(['speed-item'])
  })

  it('래더 가정 세트 도구는 순서 비교 불가의 원인일 때만 넣는다(먹다남은음식·메가스톤은 넣지 않는다)', () => {
    const claw = withItem(entry('sneasler'), 'quickclaw', { quickclaw: 0.9 })
    const left = withItem(entry('garchomp'), 'leftovers', { leftovers: 0.9 })
    const t = iconTargets(game, [{ ...bo1.meta, entries: [claw, left, entry('charizardmegay')] }])
    expect(t.get('quickclaw')).toEqual(['speed-rejection'])
    expect(t.has('leftovers')).toBe(false)
    expect(t.has('charizarditey')).toBe(false)
  })

  it('실데이터 메타 전체로도 반감열매·화력 도구·스피드 배수 도구 42종뿐이다(비교 불가 원인 도구 없음)', () => {
    const t = iconTargets(game, [bo1.meta])
    expect([...t.keys()].sort()).toEqual([...Object.keys(RESIST_BERRIES), ...POWER_ITEMS, 'choicescarf', 'ironball'].sort())
    for (const s of t.values()) expect(s).not.toContain('speed-rejection')
  })

  it('메가스톤은 실데이터 어디서도 대상이 아니다', () => {
    const t = iconTargets(game, [bo1.meta])
    for (const m of game.data.megas) expect(t.has(m.stone), m.stone).toBe(false)
  })

  it('결과는 id 순 정렬이고 근거도 정렬돼 있다', () => {
    const ids = [...iconTargets(game, [bo1.meta]).keys()]
    expect(ids).toEqual([...ids].sort())
    for (const s of iconTargets(game, [bo1.meta]).values()) expect([...s]).toEqual([...s].sort())
  })
})
