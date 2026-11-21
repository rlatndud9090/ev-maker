import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { LockUiContext, NO_LOCK_UI } from '../lockContext'
import { CutPin } from './CutPin'

const noop = () => {}
const pinHtml = (direct: boolean) =>
  renderToStaticMarkup(
    <LockUiContext.Provider value={{ ...NO_LOCK_UI, enabled: true }}>
      {direct ? (
        <CutPin subject="몰드류" lockedBy={[]} items={() => []} direct />
      ) : (
        <CutPin subject="몰드류" lockedBy={[]} menu={() => ({ state: 'computing', natures: [], results: [], picks: [] })} onPick={noop} returnKey="k" />
      )}
    </LockUiContext.Provider>,
  )
const attr = (html: string, name: string) => new RegExp(` ${name}="([^"]*)"`).exec(html)?.[1]

describe('CutPin 메뉴 알림', () => {
  it('메뉴형 빈 핀(공·방)은 닫힌 메뉴를 알린다(aria-haspopup=menu, aria-expanded=false)', () => {
    const html = pinHtml(false)
    expect(attr(html, 'aria-haspopup')).toBe('menu')
    expect(attr(html, 'aria-expanded')).toBe('false')
  })

  it('바로 고정하는 빈 핀(스피드)은 닫힌 동안 메뉴를 알리지 않는다', () => {
    const html = pinHtml(true)
    expect(attr(html, 'aria-pressed')).toBe('false')
    expect(attr(html, 'aria-haspopup')).toBeUndefined()
    expect(attr(html, 'aria-expanded')).toBeUndefined()
  })
  it('막힌 빈 핀·찬 핀은 메뉴를 알리지 않는다', () => {
    const html = (props: { lockedBy: number[]; disabledReason?: string }) =>
      renderToStaticMarkup(
        <LockUiContext.Provider value={{ ...NO_LOCK_UI, enabled: true }}>
          <CutPin subject="몰드류" {...props} menu={() => ({ state: 'computing', natures: [], results: [], picks: [] })} onPick={noop} returnKey="k" />
        </LockUiContext.Provider>,
      )
    const blocked = html({ lockedBy: [], disabledReason: '고정할 판정이 없음' })
    expect(attr(blocked, 'aria-disabled')).toBe('true')
    expect(attr(blocked, 'aria-haspopup')).toBeUndefined()
    const locked = html({ lockedBy: [1] })
    expect(attr(locked, 'aria-pressed')).toBe('true')
    expect(attr(locked, 'aria-haspopup')).toBeUndefined()
  })
})

describe('바로 고정 핀 비활성(speed-bundles-pin-disable R7)', () => {
  const direct = (props: { lockedBy: number[]; disabledReason?: string }) =>
    renderToStaticMarkup(
      <LockUiContext.Provider value={{ ...NO_LOCK_UI, enabled: true }}>
        <CutPin subject="한카리아스 S32 성격 상승" {...props} items={() => []} direct />
      </LockUiContext.Provider>,
    )

  it('이유가 있으면 aria-disabled이고 title·읽기 설명에 그 문구가 그대로 들어간다(접근 이름은 그대로)', () => {
    for (const reason of ['도달 불가', 'SP 부족(8)', '성격 충돌', '내 세트 오류로 고정 불가']) {
      const html = direct({ lockedBy: [], disabledReason: reason })
      expect(attr(html, 'aria-disabled')).toBe('true')
      expect(attr(html, 'title')).toBe(reason)
      expect(attr(html, 'aria-label')).toBe('컷 고정: 한카리아스 S32 성격 상승')
      const note = attr(html, 'aria-describedby')
      expect(html).toContain(`<span id="${note}" class="sr-only">${reason}</span>`)
      expect(attr(html, 'aria-haspopup')).toBeUndefined()
    }
  })

  it('찬 핀은 이유가 있어도 비활성이 아니다(누르면 해제)', () => {
    const html = direct({ lockedBy: [1], disabledReason: '도달 불가' })
    expect(attr(html, 'aria-disabled')).toBeUndefined()
    expect(attr(html, 'aria-pressed')).toBe('true')
  })

  it('닫힌 핀은 알림 영역을 두지 않는다(메뉴가 열린 동안만 둔다)', () => {
    expect(direct({ lockedBy: [] })).not.toContain('cut-pin-notice')
    expect(pinHtml(false)).not.toContain('cut-pin-notice')
  })
})
