import { memo, type FocusEvent, type MouseEvent, type PointerEvent, type Ref } from 'react'
import { bundleLabel, type SpeedBadge as Badge, type SpeedStatus } from '../../cards'
import type { Snapshot } from '../../data/schema'
import { namesOf } from '../../ui/names'
import { ItemMark } from './ItemMark'
import { PokemonIcon } from './PokemonIcon'
import { STATUS_CLASS, badgeLabel, conditionTag, presetMark, type SpeedBadgeHandlers } from './speedText'

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
}

/** 배지 버튼: 포켓몬 이미지 · 배분 표기 · 도구 아이콘(배분 오른쪽, 겹치지 않음) · 조건 태그 · 표지. 이름은 글자 없이 툴팁(title)·접근 이름으로만 */
export const SpeedBadge = memo(function SpeedBadge({ game, badge: b, status, active, open, detailId, handlers, buttonRef }: Props) {
  const names = namesOf(game)
  const label = badgeLabel(game, b, status)
  const tag = conditionTag(b.condition)
  const preset = presetMark(b)
  const cls = ['speed-badge', status === null ? 'neu' : STATUS_CLASS[status], b.origin === 'preset' ? 'pre' : '', b.origin === 'added' ? 'add' : '', open ? 'on' : '']
    .filter(Boolean)
    .join(' ')
  const open_ = () => handlers.onOpen(b.id)
  return (
    <li className="speed-badge-item">
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
        onClick={(e: MouseEvent) => {
          e.stopPropagation()
          open_()
        }}
        onFocus={(e: FocusEvent) => {
          if (e.target === e.currentTarget) open_()
        }}
        onPointerEnter={(e: PointerEvent) => {
          if (e.pointerType === 'mouse') handlers.onHover(b.id)
        }}
        onPointerLeave={(e: PointerEvent) => {
          if (e.pointerType === 'mouse') handlers.onHover(null)
        }}
        onKeyDown={(e) => handlers.onKey(b.id, e)}
      >
        <PokemonIcon speciesId={b.speciesId} size={28} lazy />
        <span className="speed-badge-text" aria-hidden="true">
          <b className="num">{bundleLabel(b.bundle.sp, b.bundle.nature)}</b>
          {b.item !== null && (
            <ItemMark item={{ id: b.item.id, name: names.items.label(b.item.id), role: 'held' }} lazy game={game} className={b.item.negated ? 'item-negated' : undefined} />
          )}
          {tag !== undefined && <em className="speed-tag">{tag}</em>}
          {b.item?.negated && <span className="speed-mark off">도구 무효</span>}
          {b.origin === 'added' && <span className="speed-mark add">추가</span>}
          {preset !== undefined && <span className="speed-mark pre">{preset}</span>}
        </span>
      </button>
    </li>
  )
})
