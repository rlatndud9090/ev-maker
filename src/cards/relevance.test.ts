import { describe, expect, it } from 'vitest'
import { STAT_IDS, moveStatRefs } from '../core'
import { myDependsOn, relevantStats } from './relevance'
import { realData } from './testing'

const { game } = realData()

describe('relevantStats', () => {
  it('일반 물리기: 공격측 A, 방어측 H·B', () => {
    expect(relevantStats('damage', moveStatRefs(game, 'earthquake'))).toEqual({ attacker: ['atk'], defender: ['hp', 'def'] })
  })

  it('사이코쇼크는 방어측 B, 바디프레스는 공격측 B, 속임수는 방어측 A', () => {
    expect(relevantStats('damage', moveStatRefs(game, 'psyshock'))).toEqual({ attacker: ['spa'], defender: ['hp', 'def'] })
    expect(relevantStats('damage', moveStatRefs(game, 'bodypress'))).toEqual({ attacker: ['def'], defender: ['hp', 'def'] })
    expect(relevantStats('damage', moveStatRefs(game, 'foulplay'))).toEqual({ attacker: [], defender: ['hp', 'atk', 'def'] })
  })

  it('S는 스피드 의존 기술이거나 공격측 계산 특성이 스피드 의존 특성일 때만 양쪽에 든다', () => {
    expect(relevantStats('damage', moveStatRefs(game, 'gyroball'))).toEqual({ attacker: ['atk', 'spe'], defender: ['hp', 'def', 'spe'] })
    expect(relevantStats('damage', moveStatRefs(game, 'earthquake'), 'analytic')).toEqual({
      attacker: ['atk', 'spe'],
      defender: ['hp', 'def', 'spe'],
    })
    expect(relevantStats('damage', moveStatRefs(game, 'earthquake'), 'roughskin').attacker).not.toContain('spe')
  })

  it('스피드 판정은 양쪽 S, refs가 없는 대미지 판정은 모든 능력치', () => {
    expect(relevantStats('speed', undefined)).toEqual({ attacker: ['spe'], defender: ['spe'] })
    expect(relevantStats('damage', undefined)).toEqual({ attacker: [...STAT_IDS], defender: [...STAT_IDS] })
  })
})

describe('myDependsOn', () => {
  const eq = moveStatRefs(game, 'earthquake')
  it('스윕 능력치와 exclude를 뺀 내 쪽 관여 능력치', () => {
    expect(myDependsOn({ judge: 'damage', refs: eq, sweep: { side: 'attacker', stat: 'atk' } }, 'attacker')).toEqual([])
    expect(myDependsOn({ judge: 'damage', refs: eq, sweep: { side: 'defender', stat: 'hp' } }, 'defender')).toEqual(['def'])
    expect(myDependsOn({ judge: 'damage', refs: eq, sweep: undefined }, 'defender', ['hp', 'def'])).toEqual([])
  })

  it('상대 속임수의 방어 행은 내 A에 의존하고, 스피드 의존이면 내 S에도 의존한다', () => {
    const foul = moveStatRefs(game, 'foulplay')
    expect(myDependsOn({ judge: 'damage', refs: foul, sweep: { side: 'defender', stat: 'hp' } }, 'defender')).toEqual(['atk', 'def'])
    const gyro = moveStatRefs(game, 'gyroball')
    expect(myDependsOn({ judge: 'damage', refs: gyro, sweep: { side: 'attacker', stat: 'atk' } }, 'attacker')).toEqual(['spe'])
    expect(myDependsOn({ judge: 'damage', refs: eq, sweep: { side: 'attacker', stat: 'atk' } }, 'attacker', [], 'analytic')).toEqual(['spe'])
  })

  it('스피드 행은 스윕 능력치(S) 외 의존 없음', () => {
    expect(myDependsOn({ judge: 'speed', refs: undefined, sweep: { side: 'attacker', stat: 'spe' } }, 'attacker')).toEqual([])
  })
})
