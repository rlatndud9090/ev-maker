import { describe, expect, it } from 'vitest'
import { MIN_BELOW, isOutOfView, placePopover, visibleArea, type Rect } from './popoverPlacement'

const rect = (left: number, top: number, width: number, height: number): Rect => ({ left, top, right: left + width, bottom: top + height })
const opts = { gap: 6, margin: 16 }
const vp = { width: 1280, height: 800 }

describe('placePopover', () => {
  it('자리가 충분하면 앵커 바로 아래, 왼쪽 맞춤', () => {
    const p = placePopover(rect(100, 100, 80, 30), { width: 360, height: 300 }, vp, opts)
    expect(p).toEqual({ side: 'below', top: 136, left: 100, maxHeight: 800 - 16 - 136 })
  })

  it('오른쪽이 넘치면 앵커 오른쪽에 맞춘다', () => {
    const p = placePopover(rect(1150, 100, 100, 30), { width: 360, height: 200 }, vp, opts)
    expect(p.left).toBe(1250 - 360)
  })

  it('앵커 오른쪽 맞춤도 넘치면 화면 안으로 끼운다', () => {
    const p = placePopover(rect(1240, 100, 30, 30), { width: 360, height: 200 }, { width: 1280, height: 800 }, opts)
    expect(p.left).toBe(1280 - 16 - 360)
    const q = placePopover(rect(0, 100, 30, 30), { width: 360, height: 200 }, { width: 300, height: 800 }, opts)
    expect(q.left).toBe(16)
  })

  it('아래가 모자라고 위가 더 넓으면 위로 뒤집는다', () => {
    const p = placePopover(rect(100, 600, 80, 30), { width: 360, height: 300 }, vp, opts)
    expect(p.side).toBe('above')
    expect(p.top).toBe(600 - 6 - 300)
    expect(p.maxHeight).toBe(600 - 6 - 16)
  })

  it('아래가 모자라도 위보다 넓으면 아래에 두고 남은 높이만큼만', () => {
    const p = placePopover(rect(100, 300, 80, 30), { width: 360, height: 700 }, vp, opts)
    expect(p.side).toBe('below')
    expect(p.top).toBe(336)
    expect(p.maxHeight).toBe(800 - 16 - 336)
  })

  it('아래 높이가 최소 높이 이상이면 위가 더 넓어도 아래에 두고 안에서 스크롤', () => {
    const p = placePopover(rect(100, 450, 80, 30), { width: 360, height: 700 }, vp, opts)
    expect(p.side).toBe('below')
    expect(p.maxHeight).toBe(800 - 16 - 486)
    expect(p.maxHeight).toBeGreaterThanOrEqual(MIN_BELOW)
  })

  it('위로 뒤집어도 남은 높이를 넘지 않고 위 여백 아래로 끼운다', () => {
    const p = placePopover(rect(100, 700, 80, 30), { width: 360, height: 900 }, vp, opts)
    expect(p.side).toBe('above')
    expect(p.maxHeight).toBe(700 - 6 - 16)
    expect(p.top).toBe(16)
  })

  it('앵커가 화면 위로 나가도 팝오버는 화면 안', () => {
    const p = placePopover(rect(100, -200, 80, 30), { width: 360, height: 300 }, vp, opts)
    expect(p.top).toBe(16)
  })
})

describe('visibleArea · isOutOfView', () => {
  const viewport = rect(0, 0, 1280, 800)
  const frame = rect(300, 200, 600, 400)

  it('겹치는 영역을 구한다', () => {
    expect(visibleArea([viewport, frame])).toEqual(frame)
    expect(visibleArea([viewport, rect(1200, 700, 400, 400)])).toEqual(rect(1200, 700, 80, 100))
    expect(visibleArea([viewport, rect(2000, 0, 10, 10)])).toBeNull()
  })

  it('조금이라도 보이면 밖이 아니다', () => {
    const area = visibleArea([viewport, frame])
    expect(isOutOfView(rect(400, 190, 50, 20), area)).toBe(false)
    expect(isOutOfView(rect(400, 590, 50, 20), area)).toBe(false)
  })

  it('완전히 나가면 밖이다', () => {
    const area = visibleArea([viewport, frame])
    expect(isOutOfView(rect(400, 170, 50, 30), area)).toBe(true)
    expect(isOutOfView(rect(400, 600, 50, 30), area)).toBe(true)
    expect(isOutOfView(rect(400, 300, 50, 30), null)).toBe(true)
  })
})
