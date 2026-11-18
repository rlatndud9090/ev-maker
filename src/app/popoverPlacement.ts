// 앵커 팝오버 자리 계산(화면 없이 단위 테스트한다). 좌표는 모두 뷰포트 기준 px.

/** 내용이 다 안 들어가도 아래에 두는 최소 높이(px) */
export const MIN_BELOW = 240

export interface Rect {
  top: number
  left: number
  bottom: number
  right: number
}

export interface Size {
  width: number
  height: number
}

export interface Placement {
  top: number
  left: number
  /** 고른 쪽에 남은 높이(내용이 더 길면 팝오버 안에서 스크롤) */
  maxHeight: number
  side: 'below' | 'above'
}

export interface PlaceOptions {
  /** 앵커와 팝오버 사이 */
  gap: number
  /** 화면 가장자리 여백 */
  margin: number
}

/**
 * 앵커 아래(아래 높이가 MIN_BELOW보다 모자라고 위가 더 넓으면 위)에 붙인다.
 * 가로는 앵커 왼쪽에 맞추고, 오른쪽이 넘치면 앵커 오른쪽에 맞춘 뒤 화면 안으로 끼운다.
 * content = 스크롤 없이 다 보일 때의 크기.
 */
export function placePopover(anchor: Rect, content: Size, viewport: Size, { gap, margin }: PlaceOptions): Placement {
  const below = viewport.height - margin - (anchor.bottom + gap)
  const above = anchor.top - gap - margin
  // 아래에 쓸 만한 높이가 있으면 아래를 지킨다(입력 중 내용이 늘어도 위아래로 튀지 않게)
  const side = below >= Math.min(content.height, MIN_BELOW) || below >= above ? 'below' : 'above'
  const room = Math.max(0, side === 'below' ? below : above)
  const height = Math.min(content.height, room)
  const rawTop = side === 'below' ? anchor.bottom + gap : anchor.top - gap - height
  const top = clamp(rawTop, margin, Math.max(margin, viewport.height - margin - height))

  let left = anchor.left
  if (left + content.width > viewport.width - margin) left = anchor.right - content.width
  left = clamp(left, margin, Math.max(margin, viewport.width - margin - content.width))
  return { top, left, maxHeight: room, side }
}

/** 스크롤 영역들(뷰포트 포함)이 겹쳐 보이는 영역. 겹치지 않으면 null */
export function visibleArea(clips: readonly Rect[]): Rect | null {
  if (clips.length === 0) return null
  let out = clips[0]
  for (const c of clips.slice(1)) {
    out = { top: Math.max(out.top, c.top), left: Math.max(out.left, c.left), bottom: Math.min(out.bottom, c.bottom), right: Math.min(out.right, c.right) }
  }
  return out.top >= out.bottom || out.left >= out.right ? null : out
}

/** 앵커가 보이는 영역 밖으로 완전히 나갔다 */
export function isOutOfView(anchor: Rect, area: Rect | null): boolean {
  if (area === null) return true
  return anchor.bottom <= area.top || anchor.top >= area.bottom || anchor.right <= area.left || anchor.left >= area.right
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi)
}
