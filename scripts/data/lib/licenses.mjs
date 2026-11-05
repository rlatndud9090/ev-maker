// 번들되는 코드·데이터의 라이선스·출처 목록과 고지 파일.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PipelineError, cmp } from './util.mjs'

const KNOWN_LICENSES = new Set(['MIT', 'BSD-3-Clause', 'ISC', 'Apache-2.0', '0BSD', 'BSD-2-Clause'])
const LICENSE_FILES = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license', 'LICENCE']

const mitText = (holder) =>
  `MIT License

Copyright (c) ${holder}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`

export const SYNTHESIZED_NOTE =
  '패키지에 LICENSE 파일 없음: package.json license 필드 기준 MIT 표준 문안이며, 저작권자 표기는 저장소 기준 추정이다(원문 아님).'

function readPkg(root, name) {
  const dir = join(root, 'node_modules', name)
  const file = join(dir, 'package.json')
  if (!existsSync(file)) throw new PipelineError(`라이선스 수집: ${name} 미설치`)
  return { dir, pkg: JSON.parse(readFileSync(file, 'utf8')) }
}

function packageNotice(root, name) {
  const { dir, pkg } = readPkg(root, name)
  if (!KNOWN_LICENSES.has(pkg.license)) throw new PipelineError(`${name}: 라이선스 불명확(${pkg.license})`)
  const f = LICENSE_FILES.find((n) => existsSync(join(dir, n)))
  const repo = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url
  let text
  let textSource
  let note
  if (f) {
    text = readFileSync(join(dir, f), 'utf8').replace(/\r\n/g, '\n').trimEnd() + '\n'
    textSource = `${name}/${f}`
  } else if (pkg.license === 'MIT') {
    text = mitText(`${name} contributors (${repo ?? 'repository 미기재'})`)
    textSource = `${name}/package.json license 필드(패키지에 LICENSE 파일 없음, MIT 표준 문안)`
    note = SYNTHESIZED_NOTE
  } else throw new PipelineError(`${name}: LICENSE 파일 없음`)
  return { pkg, repo, text, textSource, note }
}

/** package.json dependencies를 따라 런타임 번들 대상 패키지를 모은다(@types 제외). */
function runtimePackages(root) {
  const top = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).dependencies ?? {}
  const out = new Set()
  const walk = (name) => {
    if (out.has(name) || name.startsWith('@types/')) return
    out.add(name)
    for (const dep of Object.keys(readPkg(root, name).pkg.dependencies ?? {})) walk(dep)
  }
  Object.keys(top).forEach(walk)
  return [...out].sort(cmp)
}

export const TRADEMARK =
  'Pokémon and Pokémon character names are trademarks of Nintendo, Creatures Inc. and GAME FREAK inc. ' +
  '포켓몬스터·포켓몬 및 등장 캐릭터 이름은 Nintendo·Creatures·GAME FREAK의 상표다. 이 프로젝트는 비공식이며 이들과 관계없다.'

export function buildLicenses(root, config, pokeapiLicenseText) {
  const entries = []
  const texts = []
  for (const name of runtimePackages(root)) {
    const n = packageNotice(root, name)
    entries.push({
      id: `npm:${name}`,
      kind: 'code',
      name,
      version: n.pkg.version,
      license: n.pkg.license,
      source: n.repo ?? null,
      usage: '앱 번들에 포함되는 런타임 코드',
      noticeSource: n.textSource,
    })
    texts.push({ title: `${name}@${n.pkg.version} (${n.pkg.license})`, text: n.text, note: n.note })
  }
  const dataPkgs = Object.keys(config.gameData.packages).sort(cmp)
  const dataNotices = dataPkgs.map((p) => packageNotice(root, p))
  dataNotices.forEach((n, i) => {
    if (n.pkg.version !== config.gameData.packages[dataPkgs[i]].version) {
      throw new PipelineError(`${dataPkgs[i]} 설치 버전이 고정값과 다름`)
    }
  })
  entries.push({
    id: 'data:showdown-pkmn',
    kind: 'data',
    name: 'Pokémon Showdown 데이터(@pkmn/mods·@pkmn/dex 패키징)',
    version: dataPkgs.map((p) => `${p}@${config.gameData.packages[p].version}`).join(', '),
    license: 'MIT',
    source: `https://github.com/${config.gameData.showdownCommitRef.repo} @ ${config.gameData.showdownCommitRef.sha} (참고), https://github.com/pkmn/ps`,
    usage: '스냅샷의 종·기술·도구·특성·성격·학습 기술 파생 데이터(빌드 시 추출, 패키지 자체는 번들하지 않음)',
    noticeSource: dataNotices.map((n) => n.textSource).join(', '),
  })
  dataNotices.forEach((n, i) =>
    texts.push({ title: `${dataPkgs[i]}@${n.pkg.version} (MIT, Pokémon Showdown 파생 데이터)`, text: n.text, note: n.note }),
  )
  entries.push({
    id: 'data:pokeapi',
    kind: 'data',
    name: 'PokeAPI CSV',
    version: config.ko.commit,
    license: 'BSD-3-Clause',
    source: `https://github.com/${config.ko.repo}/tree/${config.ko.commit}`,
    usage: '스냅샷의 한국어 명칭 파생 데이터(원본 CSV는 번들하지 않음)',
    noticeSource: `${config.ko.repo}/${config.ko.license.path} @ ${config.ko.commit}`,
  })
  texts.push({ title: `PokeAPI @ ${config.ko.commit} (BSD-3-Clause)`, text: pokeapiLicenseText.replace(/\r\n/g, '\n').trimEnd() + '\n' })
  for (const e of entries) if (!KNOWN_LICENSES.has(e.license)) throw new PipelineError(`${e.id}: 라이선스 불명확`)
  const licenses = {
    entries: entries.sort((a, b) => cmp(a.id, b.id)),
    trademark: TRADEMARK,
    testOnly: [
      {
        path: 'docs/raw/feature/champions-calc-data-core/mega-ko-official.tsv',
        source: 'https://pokemonkorea.co.kr/pokedex (포켓몬코리아 공식 도감)',
        usage: '메가 82항목 한국어 이름의 테스트 기준값. 앱 번들에 넣지 않는다.',
      },
    ],
  }
  return { licenses, notices: renderNotices(licenses, texts) }
}

function renderNotices(licenses, texts) {
  const lines = [
    '# Third-Party Notices',
    '',
    '이 파일은 `npm run gen:snapshot`이 생성한다. 손으로 고치지 않는다.',
    '',
    '## 목록',
    '',
    '| 항목 | 종류 | 버전 | 라이선스 | 용도 |',
    '| --- | --- | --- | --- | --- |',
  ]
  for (const e of licenses.entries) lines.push(`| ${e.name} | ${e.kind} | ${e.version} | ${e.license} | ${e.usage} |`)
  lines.push('', '## 상표', '', licenses.trademark, '', '## 테스트 전용 자료(번들하지 않음)', '')
  for (const t of licenses.testOnly) lines.push(`- \`${t.path}\`: ${t.usage} 출처: ${t.source}`)
  lines.push('', '## 라이선스 원문', '')
  for (const t of texts) {
    lines.push(`### ${t.title}`, '')
    if (t.note) lines.push(`> ${t.note}`, '')
    lines.push('```text', t.text.trimEnd(), '```', '')
  }
  return lines.join('\n')
}
