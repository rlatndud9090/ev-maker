import { describe, expect, it } from 'vitest'
import { SnapshotLoadError, loadRegulationIndex, loadSnapshot } from './loader'
import { loadSnapshotSync } from './testing'

describe('데이터 접근층', () => {
  it('목록의 기본 레귤레이션을 해석하고, 생략하면 기본 스냅샷을 로드한다', async () => {
    const index = await loadRegulationIndex()
    expect(index.default).toBe('m-c')
    const def = await loadSnapshot()
    expect(def.manifest.regulation.id).toBe(index.default)
    expect(def).toEqual(await loadSnapshot('m-c'))
    expect(def).toEqual(loadSnapshotSync())
  })

  it('목록의 모든 레귤레이션을 고를 수 있다', async () => {
    const index = await loadRegulationIndex()
    for (const r of index.regulations) {
      const s = await loadSnapshot(r.id)
      expect(s.manifest.regulation.id).toBe(r.id)
      expect(s.manifest.source.gameData.mode).toBe(r.mode)
    }
  })

  it.each(['m-z', '', '__proto__', 'M-C', '../m-c'])('목록에 없는 레귤레이션 %j는 이유와 함께 거부한다', async (id) => {
    await expect(loadSnapshot(id)).rejects.toBeInstanceOf(SnapshotLoadError)
    expect(() => loadSnapshotSync(id)).toThrow(SnapshotLoadError)
  })

  it('문자열이 아닌 id도 거부한다', async () => {
    await expect(loadSnapshot(42 as unknown as string)).rejects.toThrow(/알 수 없는 레귤레이션/)
  })
})
