import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { LockUiContext, NO_LOCK_UI } from '../lockContext'
import { CutPin } from './CutPin'

const pinHtml = (direct: boolean) =>
  renderToStaticMarkup(
    <LockUiContext.Provider value={{ ...NO_LOCK_UI, enabled: true }}>
      <CutPin subject="몰드류" lockedBy={[]} items={() => []} direct={direct} />
    </LockUiContext.Provider>,
  )
const attr = (html: string, name: string) => new RegExp(` ${name}="([^"]*)"`).exec(html)?.[1]

describe('CutPin 메뉴 알림', () => {
  it('메뉴형 빈 핀은 닫힌 메뉴를 알린다(aria-haspopup=menu, aria-expanded=false)', () => {
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
})
