import { useId } from 'react'
import type { Snapshot, StatId } from '../data/schema'
import { STAT_IDS, validateSet, type Status } from '../core'
import { BOOST_STATS, MOVE_SLOTS, parseNumber, toPokemonSet, type BoostStat, type SetDraft } from '../ui/setDraft'
import { learnsetOptions, namesOf, pickSpecies } from '../ui/names'
import { STAT_LABEL, STATUS_LABEL, attempt, keysOf } from '../ui/labels'
import { Errors } from '../ui/Errors'

interface Props {
  title: string
  snapshot: Snapshot
  draft: SetDraft
  onChange: (d: SetDraft) => void
}

export function SetEditor({ title, snapshot, draft, onChange }: Props) {
  const uid = useId()
  const headingId = `${uid}-h`
  const names = namesOf(snapshot)
  const pick = pickSpecies(snapshot, draft.species)
  const base = pick?.base
  const { set, megaByName } = toPokemonSet(snapshot, draft)
  const resolved = attempt(() => validateSet(snapshot, set))
  const { spTotal, spMaxPerStat } = snapshot.manifest.rules
  const spSum = STAT_IDS.reduce((acc, s) => acc + parseNumber(draft.sp[s]), 0)

  const update = (patch: Partial<SetDraft>) => onChange({ ...draft, ...patch })

  const onSpecies = (text: string) => {
    const next = pickSpecies(snapshot, text)
    const patch: Partial<SetDraft> = { species: text }
    if (next) {
      if (!next.base.abilities.includes(draft.ability)) patch.ability = next.base.abilities[0]
      if (next.megaStone !== undefined) {
        patch.item = names.items.label(next.megaStone)
        patch.mega = true
      }
    }
    update(patch)
  }

  const abilityOptions = base ? [...base.abilities] : []
  if (!abilityOptions.includes(draft.ability)) abilityOptions.push(draft.ability)

  return (
    <section className="panel" aria-labelledby={headingId}>
      <h2 id={headingId}>{title}</h2>
      <div className="fields">
        <label>
          종
          <input list={`${uid}-species`} value={draft.species} onChange={(e) => onSpecies(e.target.value)} />
        </label>
        <datalist id={`${uid}-species`}>
          {names.speciesOptions.map((o) => (
            <option key={o} value={o} />
          ))}
        </datalist>
        <label>
          특성
          <select value={draft.ability} onChange={(e) => update({ ability: e.target.value })}>
            {abilityOptions.map((a) => (
              <option key={a} value={a}>
                {base?.abilities.includes(a) ? names.abilities.label(a) : `(목록 밖) ${names.abilities.label(a)}`}
              </option>
            ))}
          </select>
        </label>
        <label>
          도구
          <input list={`${uid}-items`} value={draft.item} placeholder="없음" onChange={(e) => update({ item: e.target.value })} />
        </label>
        <datalist id={`${uid}-items`}>
          {names.itemOptions.map((o) => (
            <option key={o} value={o} />
          ))}
        </datalist>
        <label>
          성격
          <select value={draft.nature} onChange={(e) => update({ nature: e.target.value })}>
            {Object.values(snapshot.data.natures).map((n) => (
              <option key={n.id} value={n.id}>
                {names.natures.label(n.id)}
                {n.plus && n.minus && n.plus !== n.minus ? ` (+${STAT_LABEL[n.plus]} −${STAT_LABEL[n.minus]})` : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={megaByName || draft.mega}
            disabled={megaByName}
            onChange={(e) => update({ mega: e.target.checked })}
          />
          메가진화{megaByName ? ' (메가 폼 이름으로 선택됨)' : ''}
        </label>
        <label>
          상태이상
          <select value={draft.status} onChange={(e) => update({ status: e.target.value as Status })}>
            {keysOf(STATUS_LABEL).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <fieldset>
        <legend>
          SP (능력치당 0~{spMaxPerStat}) · 합계 <output>{Number.isFinite(spSum) ? spSum : '?'}</output> / {spTotal} · 잔여{' '}
          <output>{Number.isFinite(spSum) ? spTotal - spSum : '?'}</output>
        </legend>
        <div className="grid6">
          {STAT_IDS.map((s: StatId) => (
            <label key={s}>
              SP {STAT_LABEL[s]}
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={spMaxPerStat}
                value={draft.sp[s]}
                onChange={(e) => update({ sp: { ...draft.sp, [s]: e.target.value } })}
              />
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend>랭크 (−6~+6)</legend>
        <div className="grid6">
          {BOOST_STATS.map((s: BoostStat) => (
            <label key={s}>
              랭크 {STAT_LABEL[s]}
              <input
                type="number"
                inputMode="numeric"
                min={-6}
                max={6}
                value={draft.boosts[s]}
                onChange={(e) => update({ boosts: { ...draft.boosts, [s]: e.target.value } })}
              />
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend>기술</legend>
        <div className="grid2">
          {Array.from({ length: MOVE_SLOTS }, (_, i) => (
            <label key={i}>
              기술 {i + 1}
              <input
                list={`${uid}-moves`}
                value={draft.moves[i] ?? ''}
                onChange={(e) => {
                  const moves = [...draft.moves]
                  moves[i] = e.target.value
                  update({ moves })
                }}
              />
            </label>
          ))}
        </div>
        <datalist id={`${uid}-moves`}>
          {learnsetOptions(snapshot, base).map((o) => (
            <option key={o} value={o} />
          ))}
        </datalist>
      </fieldset>

      {resolved.ok ? (
        <div className="result" aria-live="polite">
          <p>
            계산 종: <strong>{names.species.label(resolved.value.species.id)}</strong> · 계산 특성:{' '}
            {names.abilities.label(resolved.value.ability)} · 타입: {resolved.value.species.types.join('/')}
          </p>
          <table className="stats">
            <caption>실능치</caption>
            <thead>
              <tr>
                {STAT_IDS.map((s) => (
                  <th key={s} scope="col">
                    {STAT_LABEL[s]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                {STAT_IDS.map((s) => (
                  <td key={s} data-stat={s}>
                    {resolved.value.stats[s]}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      ) : (
        <Errors title="세트 오류" lines={resolved.errors} />
      )}
    </section>
  )
}
