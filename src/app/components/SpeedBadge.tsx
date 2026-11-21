import { memo, type MouseEvent, type Ref } from 'react'
import { bundleLabel, bundleSpoken, type SpeedBadge as Badge, type SpeedLockCandidate, type SpeedStatus } from '../../cards'
import type { Snapshot } from '../../data/schema'
import { namesOf } from '../../ui/names'
import { useLockUi } from '../lockContext'
import { CutPin } from './CutPin'
import { ItemMark } from './ItemMark'
import { pinStageView } from './lockText'
import { PokemonIcon } from './PokemonIcon'
import { LOCKED_MARK_TEXT, STATUS_CLASS, badgeLabel, conditionTag, presetMark, type SpeedBadgeHandlers } from './speedText'

interface Props {
  game: Snapshot
  badge: Badge
  status: SpeedStatus | null
  /** 로빙 탭 인덱스의 현재 자리 */
  active: boolean
  open: boolean
  detailId: string | undefined
  handlers: SpeedBadgeHandlers
  buttonRef?: Ref<HTMLButtonElement>
  /** 이 배지를 대상으로 하는 고정 seq */
  lockedBy?: readonly number[]
  /** 컷 고정 후보(핀을 누를 때 부른다). 고정 문맥이 없으면 핀이 없다 */
  pinCandidate?: (b: Badge) => SpeedLockCandidate
  /** 빈 핀 비활성 이유(바로 고정할 수 없고 이유가 정해짐). 없으면 활성 */
  pinDisabled?: string
}

const NO_SEQS: readonly number[] = []

/** 배지 앞 컷 고정 핀: 단계가 추월 하나라 빈 핀은 바로 고정하고, 걸 수 없으면 그 한 단계의 이유를 메뉴로 보인다 */
function SpeedPin({
  game,
  badge: b,
  lockedBy,
  pinCandidate,
  pinDisabled,
  active,
  handlers,
}: Pick<Props, 'game' | 'badge' | 'active' | 'handlers' | 'pinDisabled'> & { lockedBy: readonly number[]; pinCandidate: (b: Badge) => SpeedLockCandidate }) {
  const ui = useLockUi()
  return (
    <CutPin
      subject={`${namesOf(game).species.label(b.speciesId)} ${bundleSpoken(b.bundle.sp, b.bundle.nature)}`}
      lockedBy={lockedBy}
      disabledReason={pinDisabled}
      items={() => [pinStageView('first', pinCandidate(b), ui.check)]}
      direct
      tabIndex={active ? 0 : -1}
      onKeyDown={(e) => handlers.onKey(b.id, e)}
    />
  )
}

/** 배지 버튼: 포켓몬 이미지 · 배분 표기 · 스피드에 배수를 건 도구 아이콘만(배분 오른쪽, 겹치지 않음) · 조건 태그 · 표지. 이름은 글자 없이 툴팁(title)·접근 이름으로만 */
export const SpeedBadge = memo(function SpeedBadge({ game, badge: b, status, active, open, detailId, handlers, buttonRef, lockedBy = NO_SEQS, pinCandidate, pinDisabled }: Props) {
  const locked = lockedBy.length > 0
  const names = namesOf(game)
  const label = badgeLabel(game, b, status, locked)
  const tag = conditionTag(b.condition)
  const preset = presetMark(b)
  const cls = ['speed-badge', status === null ? 'neu' : STATUS_CLASS[status], b.origin === 'preset' ? 'pre' : '', b.origin === 'added' ? 'add' : '', open ? 'on' : '', locked ? 'locked' : '']
    .filter(Boolean)
    .join(' ')
  return (
    <li className="speed-badge-item">
      {pinCandidate !== undefined && <SpeedPin game={game} badge={b} lockedBy={lockedBy} pinCandidate={pinCandidate} pinDisabled={pinDisabled} active={active} handlers={handlers} />}
      <button
        ref={buttonRef}
        type="button"
        className={cls}
        tabIndex={active ? 0 : -1}
        aria-label={label}
        title={names.species.label(b.speciesId)}
        aria-expanded={open}
        aria-controls={open ? detailId : undefined}
        data-testid="speed-badge"
        data-badge-id={b.id}
        data-speed={b.speed}
        data-status={status ?? 'neutral'}
        data-origin={b.origin}
        data-condition={b.condition.kind}
        data-locked={locked ? 'true' : undefined}
        onClick={(e: MouseEvent) => {
          e.stopPropagation()
          handlers.onToggle(b.id)
        }}
        onKeyDown={(e) => handlers.onKey(b.id, e)}
      >
        <PokemonIcon speciesId={b.speciesId} size={28} lazy />
        <span className="speed-badge-text" aria-hidden="true">
          <b className="num">{bundleLabel(b.bundle.sp, b.bundle.nature)}</b>
          {b.item !== null && <ItemMark item={{ id: b.item, name: names.items.label(b.item), role: 'held' }} lazy />}
          {tag !== undefined && <em className="speed-tag">{tag}</em>}
          {b.origin === 'added' && <span className="speed-mark add">추가</span>}
          {preset !== undefined && <span className="speed-mark pre">{preset}</span>}
          {locked && <span className="speed-mark locked">{LOCKED_MARK_TEXT}</span>}
        </span>
      </button>
    </li>
  )
})
