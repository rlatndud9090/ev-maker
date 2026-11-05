// 데이터 접근층: 레귤레이션 목록과 기본 레귤레이션을 해석하고, 선택한 스냅샷만 지연 로드한다.
import type { RegulationIndex, Snapshot, SnapshotData, SnapshotManifest } from './schema'
import indexJson from './regulations/index.json'
import { SnapshotLoadError, assertManifest, resolveRegulationId } from './snapshot-guard'

export { SnapshotLoadError } from './snapshot-guard'

const index: RegulationIndex = indexJson
const manifests = import.meta.glob<SnapshotManifest>('./regulations/*/manifest.json', { import: 'default' })
const datas = import.meta.glob<SnapshotData>('./regulations/*/data.json', { import: 'default' })
const cache = new Map<string, Promise<Snapshot>>()

export async function loadRegulationIndex(): Promise<RegulationIndex> {
  return index
}

async function load(id: string): Promise<Snapshot> {
  const m = manifests[`./regulations/${id}/manifest.json`]
  const d = datas[`./regulations/${id}/data.json`]
  if (!m || !d) throw new SnapshotLoadError(`레귤레이션 ${id}의 스냅샷 파일이 없다`)
  const [manifest, data] = await Promise.all([m(), d()])
  assertManifest(id, manifest)
  return { manifest, data }
}

/** id를 생략하면 index.default를 쓴다. */
export function loadSnapshot(id?: string): Promise<Snapshot> {
  let resolved: string
  try {
    resolved = resolveRegulationId(index, id)
  } catch (e) {
    return Promise.reject(e)
  }
  let p = cache.get(resolved)
  if (!p) {
    p = load(resolved)
    p.catch(() => cache.delete(resolved))
    cache.set(resolved, p)
  }
  return p
}
