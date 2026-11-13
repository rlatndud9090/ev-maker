import type { RowView, Tab } from '../../cards'
import type { Snapshot } from '../../data/schema'
import { typeNameOf, typeSlug } from '../../ui/labels'
import { TypeIcon } from '../../ui/TypeIcon'
import { moveRankParts, rowTitle } from './text'

interface Props {
  game: Snapshot
  tab: Tab
  row: Pick<RowView, 'moveId' | 'sweepStat' | 'basis' | 'refs'>
}

/** 간단행 기술 라벨: [타입 아이콘][사용자 공격 랭크][기술명][그 밖의 랭크(작게)]. 내 기술 칸처럼 타입색 테두리·배경. */
export function MoveLabel({ game, tab, row }: Props) {
  const move = row.moveId !== undefined && Object.prototype.hasOwnProperty.call(game.data.moves, row.moveId) ? game.data.moves[row.moveId] : undefined
  const type = typeNameOf(move?.type)
  const { own, rest } = moveRankParts(tab, row)
  return (
    <span className="move-chip" data-testid="move-label" data-type={type ? typeSlug(type) : undefined}>
      {type && (
        <>
          <TypeIcon type={type} />{' '}
        </>
      )}
      {own !== undefined && (
        <>
          <span className="move-rank num" data-testid="move-rank">
            {own}
          </span>{' '}
        </>
      )}
      <span className="move-name">{rowTitle(game, row, false)}</span>
      {rest !== '' && (
        <>
          {' '}
          <span className="move-boosts" data-testid="move-boosts">
            {rest}
          </span>
        </>
      )}
    </span>
  )
}

/** 우선도 > 0 기술(선공기) 표시. 기술 라벨 밖에 둔다 */
export function PriorityTag() {
  return (
    <span className="priority-tag" data-testid="priority-tag">
      선공
    </span>
  )
}

/** 판정이 내 SP·성격(무보정·상승) 조정으로 바뀔 수 있음 표시. compact = 배분 목록 항목용 짧은 글씨(접근 가능한 이름은 같다). */
export function VariableTag({ compact = false, id, testId = 'variable-tag' }: { compact?: boolean; id?: string; testId?: string }) {
  return (
    <span className={compact ? 'variable-tag compact' : 'variable-tag'} data-testid={testId} id={id} title="내 SP·성격 조정으로 판정이 바뀔 수 있습니다">
      {compact ? (
        <>
          변동<span className="sr-only"> 가능</span>
        </>
      ) : (
        '변동 가능'
      )}
    </span>
  )
}
