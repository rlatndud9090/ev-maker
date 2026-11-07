/// <reference types="node" />
// 테스트 전용 동기 로더(node fs). 앱 코드에서 import하지 않는다.
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertMetaIndex, assertMetaSnapshot, metaFileName, resolveMetaSelection } from './meta-guard'
import type { MetaRequest } from './meta-guard'
import type { MetaIndex, MetaSnapshot } from './meta-schema'
import type { RegulationIndex, Snapshot } from './schema'
import { assertManifest, resolveRegulationId } from './snapshot-guard'

const readJson = <T>(rel: string): T => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8')) as T

export function loadRegulationIndexSync(): RegulationIndex {
  return readJson<RegulationIndex>('./regulations/index.json')
}

export function loadSnapshotSync(id?: string): Snapshot {
  const resolved = resolveRegulationId(loadRegulationIndexSync(), id)
  const manifest = readJson<Snapshot['manifest']>(`./regulations/${resolved}/manifest.json`)
  assertManifest(resolved, manifest)
  return { manifest, data: readJson<Snapshot['data']>(`./regulations/${resolved}/data.json`) }
}

/** 동결(frozen) 레귤레이션의 커밋된 manifest·data를 outRoot에 복사한다. 반환: 복사한 상대 경로. */
export function seedFrozenSnapshots(outRoot: string): string[] {
  const out: string[] = []
  for (const r of loadRegulationIndexSync().regulations.filter((x) => x.frozen)) {
    for (const f of ['manifest.json', 'data.json']) {
      const rel = `src/data/regulations/${r.id}/${f}`
      mkdirSync(join(outRoot, `src/data/regulations/${r.id}`), { recursive: true })
      copyFileSync(fileURLToPath(new URL(`./regulations/${r.id}/${f}`, import.meta.url)), join(outRoot, rel))
      out.push(rel)
    }
  }
  return out
}

export function loadMetaIndexSync(): MetaIndex {
  const index = readJson<MetaIndex>('./meta/index.json')
  assertMetaIndex(index)
  return index
}

/** loadMetaSnapshot과 같은 선택 규칙·검사를 쓰는 동기 판. */
export function loadMetaSnapshotSync(req?: MetaRequest): MetaSnapshot {
  const sel = resolveMetaSelection(loadMetaIndexSync(), loadRegulationIndexSync(), req)
  const meta = readJson<MetaSnapshot>(`./meta/${sel.regulation}/${metaFileName(sel.month, sel.match)}`)
  assertMetaSnapshot(sel, meta)
  return meta
}
