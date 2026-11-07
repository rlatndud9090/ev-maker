// 메타 데이터 접근층: 인덱스는 정적 import, 선택한 메타 스냅샷 파일만 지연 로드한다.
import indexJson from './meta/index.json'
import { MetaLoadError, assertMetaIndex, assertMetaSnapshot, metaFileName, resolveMetaSelection } from './meta-guard'
import type { MetaRequest, MetaSelection } from './meta-guard'
import type { MetaIndex, MetaSnapshot } from './meta-schema'
import gameIndexJson from './regulations/index.json'
import type { RegulationIndex } from './schema'

export { MetaLoadError } from './meta-guard'

/** 키 "./meta/<레귤레이션>/<월>-<매치>.json" */
export type MetaImporters = Record<string, () => Promise<MetaSnapshot>>

export interface MetaLoader {
  index(): MetaIndex
  select(req?: MetaRequest): MetaSelection
  /** 파일 키별 Promise 캐시. 실패하면 캐시에서 지운다. */
  load(req?: MetaRequest): Promise<MetaSnapshot>
}

export function createMetaLoader(index: MetaIndex, gameIndex: RegulationIndex, importers: MetaImporters): MetaLoader {
  const cache = new Map<string, Promise<MetaSnapshot>>()

  const checkedIndex = (): MetaIndex => {
    assertMetaIndex(index)
    return index
  }

  const select = (req?: MetaRequest): MetaSelection => resolveMetaSelection(checkedIndex(), gameIndex, req)

  async function fetchOne(key: string, sel: MetaSelection): Promise<MetaSnapshot> {
    const importer = Object.hasOwn(importers, key) ? importers[key] : undefined
    if (!importer) throw new MetaLoadError(`메타 스냅샷 파일이 없다: ${key}`)
    const meta = await importer()
    assertMetaSnapshot(sel, meta)
    return meta
  }

  function load(req?: MetaRequest): Promise<MetaSnapshot> {
    let sel: MetaSelection
    try {
      sel = select(req)
    } catch (e) {
      return Promise.reject(e)
    }
    const key = `./meta/${sel.regulation}/${metaFileName(sel.month, sel.match)}`
    let p = cache.get(key)
    if (!p) {
      p = fetchOne(key, sel)
      p.catch(() => cache.delete(key))
      cache.set(key, p)
    }
    return p
  }

  return { index: checkedIndex, select, load }
}

const defaultLoader = createMetaLoader(
  indexJson as MetaIndex,
  gameIndexJson,
  import.meta.glob<MetaSnapshot>('./meta/*/*.json', { import: 'default' }),
)

export async function loadMetaIndex(): Promise<MetaIndex> {
  return defaultLoader.index()
}

/** 생략한 값은 resolveMetaSelection 규칙으로 고른다. */
export function loadMetaSnapshot(req?: MetaRequest): Promise<MetaSnapshot> {
  return defaultLoader.load(req)
}
