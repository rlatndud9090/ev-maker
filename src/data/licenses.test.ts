/// <reference types="node" />
import { describe, expect, it } from 'vitest'
import { PROJECT_ROOT, buildLicenses, readProjectJson } from '../../scripts/data/lib/pipeline.mjs'
import { META_SCHEMA_VERSION } from './meta-schema'
import type { MetaIndex } from './meta-schema'

const KNOWN = ['MIT', 'BSD-3-Clause', 'ISC', 'Apache-2.0', '0BSD', 'BSD-2-Clause']
const config = readProjectJson('scripts/data/sources.config.json')
const POKEAPI_TEXT = 'PokeAPI license text\n'

const item = (match: 'bo1' | 'bo3', month: string, format: string, publishedAt: string) => ({
  match,
  month,
  file: `m-c/${month}-${match}.json`,
  format,
  url: `https://www.smogon.com/stats/${month}/chaos/${format}-1760.json`,
  publishedAt,
})

const metaIndex: MetaIndex = {
  schemaVersion: META_SCHEMA_VERSION,
  regulations: {
    'm-c': [
      item('bo3', '2026-10', 'gen9championsvgc2026regmcbo3', '2026-11-01T13:27:17Z'),
      item('bo1', '2026-10', 'gen9championsvgc2026regmc', '2026-11-01T13:20:00Z'),
    ],
  },
}

describe('buildLicenses 메타 출처', () => {
  it('메타 생성기 테스트 입력 픽스처가 testOnly에 원천 URL과 함께 있다', () => {
    const { licenses, notices } = buildLicenses(PROJECT_ROOT, config, POKEAPI_TEXT, metaIndex)
    const path = 'src/data/__fixtures__/meta/gen9championsvgc2026regmc-1760.2026-10.partial.json'
    const t = licenses.testOnly.find((x) => x.path === path)
    expect(t).toMatchObject({ source: 'https://www.smogon.com/stats/2026-10/chaos/gen9championsvgc2026regmc-1760.json' })
    expect(t?.usage).toContain('앱 번들에 넣지 않')
    expect(notices).toContain(`\`${path}\``)
  })

  it('메타 인덱스의 스냅샷마다 Smogon 항목·고지 절에 링크·월·공개 시각이 있다', () => {
    const { licenses, notices } = buildLicenses(PROJECT_ROOT, config, POKEAPI_TEXT, metaIndex)
    const smogon = licenses.entries.find((e) => e.id === 'data:smogon-stats')
    expect(smogon).toMatchObject({
      kind: 'data',
      license: 'NOASSERTION',
      attributionOnly: true,
      source: 'https://www.smogon.com/stats/',
      version: '2026-10 Bo1(공개 2026-11-01T13:20:00Z) · 2026-10 Bo3(공개 2026-11-01T13:27:17Z)',
    })
    expect(smogon?.months?.map((m) => `${m.regulation}/${m.month}/${m.match}`)).toEqual(['m-c/2026-10/bo1', 'm-c/2026-10/bo3'])
    const section = notices.split('\n## ').find((s) => s.startsWith('통계 출처'))
    expect(section).toBeDefined()
    expect(section).toContain('Smogon University 제공')
    expect(section).toContain('https://www.smogon.com/stats/')
    for (const it of metaIndex.regulations['m-c']) {
      expect(section).toContain(it.url)
      expect(section).toContain(it.publishedAt)
      expect(section).toContain(it.format)
    }
  })

  it('설정에만 기록되고 인덱스에 없는 월은 나오지 않는다', () => {
    const { licenses, notices } = buildLicenses(PROJECT_ROOT, config, POKEAPI_TEXT, metaIndex)
    expect(JSON.stringify(licenses)).not.toContain('2026-11/')
    expect(notices).not.toContain('2026-11/chaos')
    expect(licenses.entries.find((e) => e.id === 'data:smogon-stats')?.version).not.toContain('2026-11 ')
  })

  it('메타 인덱스가 비면 Smogon 항목·통계 출처 절이 없다', () => {
    const { licenses, notices } = buildLicenses(PROJECT_ROOT, config, POKEAPI_TEXT, { schemaVersion: META_SCHEMA_VERSION, regulations: {} })
    expect(licenses.entries.map((e) => e.id)).not.toContain('data:smogon-stats')
    expect(notices).not.toContain('## 통계 출처')
    const outsideTestOnly = notices.split('\n## ').filter((s) => !s.startsWith('테스트 전용 자료'))
    expect(outsideTestOnly.join('\n## ')).not.toContain('smogon.com/stats')
  })

  it('attributionOnly가 아닌 항목은 알려진 라이선스다', () => {
    const { licenses } = buildLicenses(PROJECT_ROOT, config, POKEAPI_TEXT, metaIndex)
    const licensed = licenses.entries.filter((e) => !e.attributionOnly)
    expect(licensed.length).toBeGreaterThan(0)
    for (const e of licensed) expect(KNOWN, e.id).toContain(e.license)
  })

  it('메타 인덱스 schemaVersion이 다르면 실패한다', () => {
    expect(() => buildLicenses(PROJECT_ROOT, config, POKEAPI_TEXT, { ...metaIndex, schemaVersion: 0 })).toThrow(/schemaVersion/)
  })
})
