import { describe, expect, it } from 'vitest'
import { toggleDetail } from './speedText'

// 배지 상세 여닫기(클릭·Enter·Space): 닫힘 → 열림, 같은 배지 → 닫힘, 다른 배지 → 그 배지로 전환
describe('toggleDetail', () => {
  it('닫힌 상태에서 배지를 누르면 그 배지 상세가 열린다', () => {
    expect(toggleDetail(null, 'a')).toBe('a')
  })
  it('열린 배지를 다시 누르면 닫힌다', () => {
    expect(toggleDetail('a', 'a')).toBeNull()
  })
  it('다른 배지를 누르면 그 배지 상세로 바뀐다', () => {
    expect(toggleDetail('a', 'b')).toBe('b')
  })
  it('열기 → 닫기 → 다시 열기를 오간다', () => {
    let open: string | null = null
    const seen: (string | null)[] = []
    for (const id of ['a', 'a', 'a', 'b', 'b']) seen.push((open = toggleDetail(open, id)))
    expect(seen).toEqual(['a', null, 'a', 'b', null])
  })
})
