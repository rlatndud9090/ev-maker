import { useId } from 'react'
import type { Snapshot } from '../data/schema'
import { compareSpeed, minSpToOutspeed, type BattleConditions, type OutspeedResult, type PokemonSet } from '../core'
import { ORDER_LABEL, attempt } from '../ui/labels'
import { Errors } from '../ui/Errors'

interface Props {
  snapshot: Snapshot
  attacker: PokemonSet
  defender: PokemonSet
  conditions: BattleConditions
}

const signed = (n: number | undefined) => (n === undefined ? '기술 없음' : n > 0 ? `+${n}` : String(n))

function outspeedText(r: OutspeedResult): string {
  switch (r.kind) {
    case 'ok':
      return `SP ${r.sp}`
    case 'over-budget':
      return `SP ${r.sp} 필요 — 예산 초과(남은 예산 ${r.remaining})`
    case 'impossible':
      return '불가 (SP 최대로도 추월하지 못함)'
  }
}

export function SpeedPanel({ snapshot, attacker, defender, conditions }: Props) {
  const uid = useId()
  const cmp = attempt(() => compareSpeed(snapshot, attacker, defender, conditions))
  const out = attempt(() => minSpToOutspeed(snapshot, attacker, defender, conditions))
  return (
    <section className="panel" aria-labelledby={`${uid}-h`}>
      <h2 id={`${uid}-h`}>스피드 비교</h2>
      {cmp.ok ? (
        <dl className="kv" aria-live="polite">
          <dt>공격측 스피드</dt>
          <dd>{cmp.value.attackerSpeed}</dd>
          <dt>방어측 스피드</dt>
          <dd>{cmp.value.defenderSpeed}</dd>
          <dt>판정(공격측 기준)</dt>
          <dd data-testid="speed-order">{ORDER_LABEL[cmp.value.order]}</dd>
          <dt>우선도(각 측 첫 기술, 순서 판정과 별개)</dt>
          <dd>
            공격측 {signed(cmp.value.attackerPriority)} · 방어측 {signed(cmp.value.defenderPriority)}
          </dd>
        </dl>
      ) : (
        <Errors title="스피드 비교 오류" lines={cmp.errors} />
      )}
      {out.ok ? (
        <p>
          공격측이 방어측을 추월하는 최소 스피드 SP: <strong data-testid="outspeed">{outspeedText(out.value)}</strong>
        </p>
      ) : (
        <Errors title="추월 SP 오류" lines={out.errors} />
      )}
    </section>
  )
}
