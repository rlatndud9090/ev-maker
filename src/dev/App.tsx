import { useEffect, useState } from 'react'
import type { RegulationIndex, Snapshot } from '../data/schema'
import { loadRegulationIndex, loadSnapshot } from '../data/loader'
import { INITIAL_ATTACKER, INITIAL_CONDITIONS, INITIAL_DEFENDER, toConditions, type ConditionsDraft } from './draft'
import { moveIdOf, toPokemonSet, type SetDraft } from '../ui/setDraft'
import { namesOf } from '../ui/names'
import { errorLines } from '../ui/labels'
import { Errors } from '../ui/Errors'
import { SetEditor } from './SetEditor'
import { ConditionsEditor } from './ConditionsEditor'
import { DamagePanel } from './DamagePanel'
import { SpeedPanel } from './SpeedPanel'
import { SweepPanel } from './SweepPanel'
import { Licenses } from '../ui/Licenses'

type Loaded = { status: 'loading' } | { status: 'ok'; snapshot: Snapshot } | { status: 'error'; errors: string[] }

export function App() {
  const [index, setIndex] = useState<RegulationIndex>()
  const [regulation, setRegulation] = useState<string>()
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' })
  const [attacker, setAttacker] = useState<SetDraft>(INITIAL_ATTACKER)
  const [defender, setDefender] = useState<SetDraft>(INITIAL_DEFENDER)
  const [conditions, setConditions] = useState<ConditionsDraft>(INITIAL_CONDITIONS)
  const [slot, setSlot] = useState(0)

  useEffect(() => {
    void loadRegulationIndex().then((i) => {
      setIndex(i)
      setRegulation(i.default)
    })
  }, [])

  useEffect(() => {
    if (regulation === undefined) return
    let live = true
    loadSnapshot(regulation).then(
      (snapshot) => live && setLoaded({ status: 'ok', snapshot }),
      (e: unknown) => live && setLoaded({ status: 'error', errors: errorLines(e) }),
    )
    return () => {
      live = false
    }
  }, [regulation])

  const snapshot = loaded.status === 'ok' ? loaded.snapshot : undefined

  return (
    <main>
      <header>
        <h1>계산 코어 확인 페이지</h1>
        <p className="hint">개발용 화면입니다. 모든 판정은 계산 코어가 내고, 이 화면은 결과만 보여 줍니다.</p>
        <label>
          레귤레이션
          <select
            value={regulation ?? ''}
            disabled={!index}
            onChange={(e) => {
              setLoaded({ status: 'loading' })
              setRegulation(e.target.value)
            }}
          >
            {index?.regulations.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
                {r.id === index.default ? ' (기본)' : ''}
              </option>
            ))}
          </select>
        </label>
        {snapshot && (
          <p className="hint" data-testid="regulation-rules">
            {snapshot.manifest.regulation.name} · 레벨 {snapshot.manifest.rules.level} · SP 능력치당 {snapshot.manifest.rules.spMaxPerStat}, 합계{' '}
            {snapshot.manifest.rules.spTotal}
          </p>
        )}
      </header>

      {loaded.status === 'loading' && <p role="status">스냅샷을 불러오는 중…</p>}
      {loaded.status === 'error' && <Errors title="스냅샷 로드 오류" lines={loaded.errors} />}
      {snapshot && (
        <Workspace
          snapshot={snapshot}
          attacker={attacker}
          defender={defender}
          conditions={conditions}
          slot={slot}
          setAttacker={setAttacker}
          setDefender={setDefender}
          setConditions={setConditions}
          setSlot={setSlot}
        />
      )}
      <footer>
        <Licenses snapshot={snapshot} />
      </footer>
    </main>
  )
}

interface WorkspaceProps {
  snapshot: Snapshot
  attacker: SetDraft
  defender: SetDraft
  conditions: ConditionsDraft
  slot: number
  setAttacker: (d: SetDraft) => void
  setDefender: (d: SetDraft) => void
  setConditions: (d: ConditionsDraft) => void
  setSlot: (n: number) => void
}

function Workspace(p: WorkspaceProps) {
  const { snapshot } = p
  const atkSet = toPokemonSet(snapshot, p.attacker).set
  const defSet = toPokemonSet(snapshot, p.defender).set
  const cond = toConditions(p.conditions)
  const moveSlots = p.attacker.moves.flatMap((_text, slot) => {
    const id = moveIdOf(snapshot, p.attacker, slot)
    return id === undefined ? [] : [{ slot, label: `${slot + 1}. ${namesOf(snapshot).moves.label(id)}`, id }]
  })
  const current = moveSlots.find((m) => m.slot === p.slot) ?? moveSlots[0]

  return (
    <div className="layout">
      <SetEditor title="공격측" snapshot={snapshot} draft={p.attacker} onChange={p.setAttacker} />
      <SetEditor title="방어측" snapshot={snapshot} draft={p.defender} onChange={p.setDefender} />
      <ConditionsEditor draft={p.conditions} onChange={p.setConditions} />
      <DamagePanel
        snapshot={snapshot}
        attacker={atkSet}
        defender={defSet}
        moveSlots={moveSlots}
        slot={current?.slot ?? 0}
        onSlot={p.setSlot}
        conditions={cond}
      />
      <SpeedPanel snapshot={snapshot} attacker={atkSet} defender={defSet} conditions={cond} />
      <SweepPanel
        snapshot={snapshot}
        attacker={atkSet}
        defender={defSet}
        moveId={current?.id}
        moveLabel={current?.label}
        conditions={cond}
      />
    </div>
  )
}
