// 실행기가 조각 사이에 메인 스레드를 내주는 수단.
export interface Scheduler {
  yield(): Promise<void>
}

/** MessageChannel 왕복(setTimeout의 최소 지연 제한을 피한다). */
export function createBrowserScheduler(): Scheduler {
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
