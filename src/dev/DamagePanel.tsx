import { useId } from 'react'
import type { Snapshot } from '../data/schema'
import { DEFAULT_THRESHOLDS, calcDamage, type BattleConditions, type DamageResultOk, type PokemonSet } from '../core'
import { namesOf } from './names'
import { ATTACK_BAND_LABEL, DEFENSE_BAND_LABEL, attempt, damagePercent, percent } from './labels'
import { Errors } from './Errors'

interface Props {
  snapshot: Snapshot
  attacker: PokemonSet
  defender: PokemonSet
  /** 공격측 기술 슬롯 라벨(빈 칸 제외)과 그 기술 id */
  moveSlots: Array<{ slot: number; label: string; id: string }>
  slot: number
  onSlot: (slot: number) => void
  conditions: BattleConditions
}

function DamageSummary({ r, snapshot }: { r: DamageResultOk; snapshot: Snapshot }) {
  const names = namesOf(snapshot)
  return (
    <dl className="kv">
      <dt>대면</dt>
      <dd>
        {names.species.label(r.attackerSpecies)}({names.abilities.label(r.attackerAbility)}) →{' '}
        {names.species.label(r.defenderSpecies)}({names.abilities.label(r.defenderAbility)})
      </dd>
      <dt>대미지</dt>
      <dd>
        {r.min}~{r.max} / HP {r.defenderHp} ({damagePercent(r.minPercent)}~{damagePercent(r.maxPercent)})
      </dd>
      <dt>타수</dt>
      <dd>{r.hits}</dd>
      <dt>1타 확률</dt>
      <dd>{percent(r.ohkoChance * 100, 2)}</dd>
      <dt>공격 관점</dt>
      <dd data-testid="attack-band">{ATTACK_BAND_LABEL[r.attackBand]}</dd>
      <dt>방어 관점</dt>
      <dd data-testid="defense-band">{DEFENSE_BAND_LABEL[r.defenseBand]}</dd>
    </dl>
  )
}

export function DamagePanel({ snapshot, attacker, defender, moveSlots, slot, onSlot, conditions }: Props) {
  const uid = useId()
  const current = moveSlots.find((m) => m.slot === slot) ?? moveSlots[0]
  const result = attempt(() => {
    if (!current) throw new Error('공격측 기술을 하나 이상 입력하세요')
    return calcDamage(snapshot, attacker, defender, current.id, conditions)
  })

  return (
    <section className="panel" aria-labelledby={`${uid}-h`}>
      <h2 id={`${uid}-h`}>대미지 판정</h2>
      <label>
        공격 기술
        <select value={current?.slot ?? ''} onChange={(e) => onSlot(Number(e.target.value))}>
          {moveSlots.map((m) => (
            <option key={m.slot} value={m.slot}>
              {m.label}
            </option>
          ))}
        </select>
      </label>
      <p className="hint">
        구간 경계: 고난수 1타 ≥ {percent(DEFAULT_THRESHOLDS.highRoll * 100, 2)}, 저난수 1타 ≤{' '}
        {percent(DEFAULT_THRESHOLDS.lowRoll * 100, 2)}. 1타 확률은 방어측 현재 HP 기준.
      </p>
      {!result.ok ? (
        <Errors title="계산 오류" lines={result.errors} />
      ) : result.value.kind === 'status' ? (
        <p data-testid="damage-kind">변화기 (대미지 판정 대상 아님)</p>
      ) : result.value.kind === 'immune' ? (
        <p data-testid="damage-kind">효과 없음</p>
      ) : (
        <div aria-live="polite">
          <DamageSummary r={result.value} snapshot={snapshot} />
          <h3>난수 16단계</h3>
          {result.value.rolls.map((hit, i) => (
            <p key={i} className="rolls">
              <span>{i + 1}타:</span> {hit.join(', ')}
            </p>
          ))}
        </div>
      )}
    </section>
  )
}
