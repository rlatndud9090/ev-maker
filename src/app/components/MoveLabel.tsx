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

/** 가장 센 기술이 아니지만 선공기라 남은 행의 표시(RowView.keptAsPriority). 기술 라벨 밖에 둔다 */
export function PriorityTag() {
  return (
    <span className="priority-tag" data-testid="priority-tag">
      선공
    </span>
  )
}
