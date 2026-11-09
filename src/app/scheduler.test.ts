import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBrowserScheduler } from './scheduler'

const g = globalThis as { scheduler?: unknown }
const original = g.scheduler

afterEach(() => {
  if (original === undefined) delete g.scheduler
  else g.scheduler = original
})

describe('createBrowserScheduler', () => {
  it('scheduler.yield가 있으면 그것을 쓴다', async () => {
    const native = { yield: vi.fn(() => Promise.resolve()) }
    g.scheduler = native
    await createBrowserScheduler().yield()
    expect(native.yield).toHaveBeenCalledTimes(1)
  })

  it('없으면 MessageChannel 왕복으로 매크로태스크 뒤에 풀린다', async () => {
    delete g.scheduler
    const order: string[] = []
    const p = createBrowserScheduler()
      .yield()
      .then(() => order.push('yield'))
    await Promise.resolve()
    order.push('microtask')
    await p
    expect(order).toEqual(['microtask', 'yield'])
  })

  it('yield가 함수가 아니면 대체 경로를 쓴다', async () => {
    g.scheduler = { yield: 'nope' }
    await expect(createBrowserScheduler().yield()).resolves.toBeUndefined()
  })
})
