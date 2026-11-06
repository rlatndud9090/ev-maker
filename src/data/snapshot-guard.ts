// 로더(브라우저)와 테스트용 동기 로더가 공유하는 레귤레이션 id 해석·스냅샷 정합 검사.
import { SNAPSHOT_SCHEMA_VERSION } from './schema'
import type { RegulationIndex, SnapshotManifest } from './schema'

export class SnapshotLoadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SnapshotLoadError'
  }
}

/** 생략하면 index.default. 목록에 없는 id는 거부한다(allowlist). */
export function resolveRegulationId(index: RegulationIndex, id?: unknown): string {
  const target = id === undefined ? index.default : id
  if (typeof target !== 'string' || !index.regulations.some((r) => r.id === target)) {
    const known = index.regulations.map((r) => r.id).join(', ')
    throw new SnapshotLoadError(`알 수 없는 레귤레이션: ${String(target)} (사용 가능: ${known})`)
  }
  return target
}

export function assertManifest(id: string, manifest: SnapshotManifest): void {
  if (manifest.regulation?.id !== id) {
    throw new SnapshotLoadError(`스냅샷 ${id}의 매니페스트 레귤레이션이 ${manifest.regulation?.id}이다`)
  }
  if (manifest.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) {
    throw new SnapshotLoadError(
      `스냅샷 ${id}의 schemaVersion ${manifest.schemaVersion}을 읽을 수 없다(앱 ${SNAPSHOT_SCHEMA_VERSION})`,
    )
  }
}
