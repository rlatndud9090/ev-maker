import { useId } from 'react'
import type { GameType, Terrain, Weather } from '../core'
import type { ConditionsDraft, SideDraft } from './draft'
import { GAME_TYPE_LABEL, TERRAIN_LABEL, WEATHER_LABEL, keysOf } from '../ui/labels'

interface Props {
  draft: ConditionsDraft
  onChange: (d: ConditionsDraft) => void
}

const SIDE_FLAGS: Array<[keyof Omit<SideDraft, 'alliesFainted'>, string]> = [
  ['tailwind', '순풍'],
  ['helpingHand', '도우미'],
  ['friendGuard', '프렌드가드'],
  ['reflect', '리플렉터'],
  ['lightScreen', '빛의장막'],
]

function SideFields({ title, side, onChange }: { title: string; side: SideDraft; onChange: (s: SideDraft) => void }) {
  return (
    <fieldset>
      <legend>{title}</legend>
      <div className="checks">
        {SIDE_FLAGS.map(([k, label]) => (
          <label key={k} className="check">
            <input type="checkbox" checked={side[k]} onChange={(e) => onChange({ ...side, [k]: e.target.checked })} />
            {title} {label}
          </label>
        ))}
      </div>
      <label>
        {title} 쓰러진 아군 수
        <input
          type="number"
          inputMode="numeric"
          min={0}
          value={side.alliesFainted}
          onChange={(e) => onChange({ ...side, alliesFainted: e.target.value })}
        />
      </label>
    </fieldset>
  )
}

export function ConditionsEditor({ draft, onChange }: Props) {
  const headingId = `${useId()}-h`
  const update = (patch: Partial<ConditionsDraft>) => onChange({ ...draft, ...patch })
  return (
    <section className="panel" aria-labelledby={headingId}>
      <h2 id={headingId}>대전 조건</h2>
      <div className="fields">
        <label>
          배틀 형식
          <select value={draft.gameType} onChange={(e) => update({ gameType: e.target.value as GameType })}>
            {keysOf(GAME_TYPE_LABEL).map((k) => (
              <option key={k} value={k}>
                {GAME_TYPE_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <label>
          날씨
          <select value={draft.weather} onChange={(e) => update({ weather: e.target.value as Weather })}>
            {keysOf(WEATHER_LABEL).map((k) => (
              <option key={k} value={k}>
                {WEATHER_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <label>
          필드
          <select value={draft.terrain} onChange={(e) => update({ terrain: e.target.value as Terrain })}>
            {keysOf(TERRAIN_LABEL).map((k) => (
              <option key={k} value={k}>
                {TERRAIN_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <label>
          범위기 대상 수
          <select
            value={draft.spreadTargets ?? ''}
            onChange={(e) => update({ spreadTargets: e.target.value === '' ? undefined : (Number(e.target.value) as 1 | 2) })}
          >
            <option value="">코어 기본값</option>
            <option value="1">1</option>
            <option value="2">2</option>
          </select>
        </label>
        <label>
          타수 지정(가변 타수 기술)
          <input
            type="number"
            inputMode="numeric"
            min={1}
            value={draft.hits}
            placeholder="기본"
            onChange={(e) => update({ hits: e.target.value })}
          />
        </label>
        <label className="check">
          <input type="checkbox" checked={draft.critical} onChange={(e) => update({ critical: e.target.checked })} />
          급소
        </label>
      </div>
      <div className="grid2">
        <SideFields title="공격측" side={draft.attacker} onChange={(attacker) => update({ attacker })} />
        <SideFields title="방어측" side={draft.defender} onChange={(defender) => update({ defender })} />
      </div>
    </section>
  )
}
