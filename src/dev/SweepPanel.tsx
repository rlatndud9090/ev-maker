import { useId, useState } from 'react'
import type { Snapshot, StatId } from '../data/schema'
import {
  sweepDamage,
  sweepSpeed,
  type BattleConditions,
  type DamageResult,
  type PokemonSet,
  type SpeedResult,
  type SweepResult,
} from '../core'
import { CATEGORY_LABEL, ORDER_LABEL, STAT_LABEL, attempt, damagePercent, percent } from '../ui/labels'
import { Errors } from '../ui/Errors'

type Target = { kind: 'damage'; side: 'attacker' | 'defender'; stat: StatId } | { kind: 'speed' }

const TARGETS: Array<{ key: string; label: string; target: Target }> = [
  ...(['atk', 'spa'] as const).map((stat) => ({
    key: `attacker-${stat}`,
    label: `공격측 ${STAT_LABEL[stat]} (공격 관점)`,
    target: { kind: 'damage', side: 'attacker', stat } as Target,
  })),
  ...(['hp', 'def', 'spd'] as const).map((stat) => ({
    key: `defender-${stat}`,
    label: `방어측 ${STAT_LABEL[stat]} (방어 관점)`,
    target: { kind: 'damage', side: 'defender', stat } as Target,
  })),
  { key: 'attacker-spe', label: '공격측 스피드 (행동 순서)', target: { kind: 'speed' } },
]

interface Props {
  snapshot: Snapshot
  attacker: PokemonSet
  defender: PokemonSet
  moveId: string | undefined
  moveLabel: string | undefined
  conditions: BattleConditions
}

type AnySweep = { kind: 'damage'; r: SweepResult<DamageResult> } | { kind: 'speed'; r: SweepResult<SpeedResult> }

function damageDetail(v: DamageResult): string {
  if (v.kind !== 'damage') return v.kind === 'immune' ? '효과 없음' : '변화기'
  return `${v.min}~${v.max} (${damagePercent(v.minPercent)}~${damagePercent(v.maxPercent)}) · 1타 ${percent(v.ohkoChance * 100, 2)}`
}

export function SweepPanel({ snapshot, attacker, defender, moveId, moveLabel, conditions }: Props) {
  const uid = useId()
  const [key, setKey] = useState(TARGETS[0].key)
  const target = (TARGETS.find((t) => t.key === key) ?? TARGETS[0]).target

  const result = attempt<AnySweep>(() => {
    if (target.kind === 'speed') return { kind: 'speed', r: sweepSpeed(snapshot, attacker, defender, conditions) }
    if (moveId === undefined) throw new Error('공격측 기술을 하나 이상 입력하세요')
    return { kind: 'damage', r: sweepDamage(snapshot, target, attacker, defender, moveId, conditions) }
  })

  return (
    <section className="panel wide" aria-labelledby={`${uid}-h`}>
      <h2 id={`${uid}-h`}>SP 스윕</h2>
      <label>
        스윕 대상
        <select value={key} onChange={(e) => setKey(e.target.value)}>
          {TARGETS.map((t) => (
            <option key={t.key} value={t.key}>
              {t.label}
            </option>
          ))}
        </select>
      </label>
      <p className="hint">
        {target.kind === 'speed' ? '공격측 스피드 SP만 바꿔 방어측과 행동 순서를 비교합니다.' : `기술: ${moveLabel ?? '없음'} (대미지 판정과 같은 기술)`}
      </p>
      {!result.ok ? (
        <Errors title="스윕 오류" lines={result.errors} />
      ) : (
        <>
          <p>
            경계 SP: <strong data-testid="sweep-boundaries">{result.value.r.boundaries.length ? result.value.r.boundaries.join(', ') : '없음'}</strong>
          </p>
          <div className="scroll">
            <table className="sweep">
              <thead>
                <tr>
                  <th scope="col">SP</th>
                  <th scope="col">판정</th>
                  <th scope="col">상세</th>
                  <th scope="col">비고</th>
                </tr>
              </thead>
              <tbody>
                {result.value.r.cells.map((cell) => {
                  const boundary = result.value.r.boundaries.includes(cell.sp)
                  const cls = cell.kind === 'over-budget' ? 'over' : boundary ? 'boundary' : undefined
                  return (
                    <tr key={cell.sp} className={cls} data-sp={cell.sp}>
                      <td>{cell.sp}</td>
                      {cell.kind === 'over-budget' ? (
                        <>
                          <td>—</td>
                          <td>—</td>
                          <td>예산 초과</td>
                        </>
                      ) : (
                        <>
                          <td>{result.value.kind === 'speed' ? ORDER_LABEL[cell.category as keyof typeof ORDER_LABEL] : CATEGORY_LABEL[cell.category] ?? cell.category}</td>
                          <td>
                            {result.value.kind === 'speed'
                              ? `${(cell.value as SpeedResult).attackerSpeed} vs ${(cell.value as SpeedResult).defenderSpeed}`
                              : damageDetail(cell.value as DamageResult)}
                          </td>
                          <td>{boundary ? '경계' : ''}</td>
                        </>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}
