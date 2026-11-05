// 생성 리포트: 직전 레귤레이션 대비 diff, 모드 상속 리포트.
import { cmp, deepEqual } from './util.mjs'

const SPECIES_FIELDS = ['types', 'baseStats', 'weightkg', 'abilities', 'learnset', 'requiredItem', 'baseSpecies']
const MOVE_FIELDS = ['type', 'category', 'basePower', 'accuracy', 'priority', 'multihit', 'target', 'flags']

function setDiff(prevIds, curIds) {
  const p = new Set(prevIds)
  const c = new Set(curIds)
  return {
    added: [...c].filter((x) => !p.has(x)).sort(cmp),
    removed: [...p].filter((x) => !c.has(x)).sort(cmp),
  }
}

/** prev → cur 추가·제거와 공통 항목의 수치 차이 경고. 입력은 SnapshotData. */
export function diffSnapshots(prev, cur) {
  const megaIds = (d) => Object.values(d.species).filter((s) => s.isMega).map((s) => s.id)
  const warnings = []
  for (const [kind, fields] of [
    ['species', SPECIES_FIELDS],
    ['moves', MOVE_FIELDS],
  ]) {
    for (const id of Object.keys(cur[kind]).sort(cmp)) {
      const a = prev[kind][id]
      const b = cur[kind][id]
      if (!a) continue
      for (const f of fields) {
        if (deepEqual(a[f] ?? null, b[f] ?? null)) continue
        if (Array.isArray(a[f]) && Array.isArray(b[f]) && f !== 'types' && f !== 'abilities') {
          const d = setDiff(a[f], b[f])
          warnings.push({ kind, id, field: f, added: d.added, removed: d.removed })
        } else warnings.push({ kind, id, field: f, prev: a[f] ?? null, cur: b[f] ?? null })
      }
    }
  }
  return {
    species: setDiff(Object.keys(prev.species), Object.keys(cur.species)),
    megas: setDiff(megaIds(prev), megaIds(cur)),
    items: setDiff(Object.keys(prev.items), Object.keys(cur.items)),
    moves: setDiff(Object.keys(prev.moves), Object.keys(cur.moves)),
    abilities: setDiff(Object.keys(prev.abilities), Object.keys(cur.abilities)),
    warnings,
  }
}

const label = (d, kind, id) => {
  const n = d[kind][id]?.name
  return n ? `${id} (${n.en} / ${n.ko})` : id
}

export function renderDiffMd(regId, prevId, diff, prevData, curData) {
  const lines = [`# ${regId} 스냅샷 diff`, '']
  if (!diff) {
    lines.push('직전 레귤레이션이 없어 diff를 만들지 않았다.', '')
    return lines.join('\n')
  }
  lines.push(`기준: ${prevId} → ${regId}`, '', '| 범주 | 추가 | 제거 |', '| --- | --- | --- |')
  for (const k of ['species', 'megas', 'items', 'moves', 'abilities']) {
    lines.push(`| ${k} | ${diff[k].added.length} | ${diff[k].removed.length} |`)
  }
  lines.push('')
  for (const [k, kind] of [
    ['species', 'species'],
    ['megas', 'species'],
    ['items', 'items'],
    ['moves', 'moves'],
    ['abilities', 'abilities'],
  ]) {
    for (const dir of ['added', 'removed']) {
      const list = diff[k][dir]
      if (!list.length) continue
      const d = dir === 'added' ? curData : prevData
      lines.push(`## ${k} ${dir === 'added' ? '추가' : '제거'} (${list.length})`, '')
      for (const id of list) lines.push(`- ${label(d, kind, id)}`)
      lines.push('')
    }
  }
  lines.push(`## 수치 차이 경고 (${diff.warnings.length})`, '')
  if (!diff.warnings.length) lines.push('없음', '')
  for (const w of diff.warnings) {
    const body =
      'added' in w
        ? `+${w.added.length} [${w.added.join(', ')}] / -${w.removed.length} [${w.removed.join(', ')}]`
        : `${JSON.stringify(w.prev)} → ${JSON.stringify(w.cur)}`
    lines.push(`- WARNING ${w.kind}/${w.id}.${w.field}: ${body}`)
  }
  lines.push('')
  return lines.join('\n')
}

export function renderInheritanceMd(regId, source, learnsetFrom, learnsetOverrideDiffs) {
  const o = source.modOverrides
  const list = (xs) => (xs.length ? xs.join(', ') : '없음')
  const lines = [
    `# ${regId} 원천 상속 리포트`,
    '',
    `- 원천 모드: ${source.mode}${source.parentMode ? ` (inherit: ${source.parentMode})` : ''}`,
    `- 모드 자체 Pokedex 오버라이드: ${o.pokedex.length}개 (${list(o.pokedex)})`,
    `- 모드 자체 Abilities 오버라이드: ${o.abilities.length}개 (${list(o.abilities)})`,
    `- 모드 자체 Learnsets 오버라이드: ${o.learnsets.length}개${o.learnsets.length > 40 ? '' : ` (${list(o.learnsets)})`}`,
    `- 모드 자체 Moves 오버라이드: ${o.moves.length}개${o.moves.length > 40 ? '' : ` (${list(o.moves)})`}`,
    `- 모드 자체 Items 오버라이드: ${o.items.length}개`,
    '',
    '종족값·타입·종별 특성은 Pokedex/Abilities 오버라이드가 없으면 상속 원천 값을 그대로 쓴다.',
    '',
  ]
  if (learnsetOverrideDiffs) {
    lines.push(`## 부모 모드(${source.parentMode}) 대비 learnset 오버라이드 차이`, '')
    if (!learnsetOverrideDiffs.length) lines.push('없음', '')
    for (const d of learnsetOverrideDiffs) {
      lines.push(`- ${d.id}: +${d.added.length} [${d.added.join(', ')}] / -${d.removed.length} [${d.removed.join(', ')}]`)
    }
    lines.push('')
  }
  const fb = Object.entries(learnsetFrom).sort((a, b) => cmp(a[0], b[0]))
  lines.push(`## 자기 learnset이 없어 다른 폼의 목록을 쓴 종 (${fb.length})`, '')
  if (!fb.length) lines.push('없음')
  for (const [id, from] of fb) lines.push(`- ${id} ← ${from}`)
  lines.push('')
  return lines.join('\n')
}
