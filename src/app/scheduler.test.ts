import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBrowserScheduler } from './scheduler'

const g = globalThis as { scheduler?: unknown }
const original = g.scheduler

afterEach(() => {
  if (original === undefined) delete g.scheduler
  else g.scheduler = original
})

describe('createBrowserScheduler', () => {
  it('MessageChannel 왕복으로 매크로태스크 뒤에 풀린다', async () => {
    const order: string[] = []
    const p = createBrowserScheduler()
      .yield()
      .then(() => order.push('yield'))
    await Promise.resolve()
    order.push('microtask')
    await p
    expect(order).toEqual(['microtask', 'yield'])
  })

  // scheduler.yield 이어달리기는 렌더·일반 작업보다 앞서 계산 중 프레임을 굶긴다.
  it('scheduler.yield가 있어도 쓰지 않는다', async () => {
    const native = { yield: vi.fn(() => Promise.resolve()) }
    g.scheduler = native
    await createBrowserScheduler().yield()
    expect(native.yield).not.toHaveBeenCalled()
  })
})
