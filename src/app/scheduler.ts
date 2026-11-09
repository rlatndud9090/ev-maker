// 실행기가 조각 사이에 메인 스레드를 내주는 수단.
export interface Scheduler {
  yield(): Promise<void>
}

interface PrioritizedScheduler {
  yield?: () => Promise<void>
}

/** scheduler.yield가 있으면 그것, 없으면 MessageChannel 왕복(setTimeout의 최소 지연 제한을 피한다). */
export function createBrowserScheduler(): Scheduler {
  const native = (globalThis as { scheduler?: PrioritizedScheduler }).scheduler
  if (typeof native?.yield === 'function') {
    const y = native.yield.bind(native)
    return { yield: () => y() }
  }
  return {
    yield: () =>
      new Promise<void>((resolve) => {
        const channel = new MessageChannel()
        channel.port1.onmessage = () => {
          channel.port1.close()
          resolve()
        }
        channel.port2.postMessage(null)
      }),
  }
}
