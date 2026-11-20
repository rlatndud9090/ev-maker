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
