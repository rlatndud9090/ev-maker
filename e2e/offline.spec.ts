import { expect, test } from '@playwright/test'
import { ALL_SP_ZERO, combo, fillSet, openPage, region } from './helpers'

test('로드·계산·조회 중 외부 origin 요청 0건', async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin
  const all: string[] = []
  page.on('request', (r) => all.push(r.url()))

  await openPage(page)
  await fillSet(page, '공격측', { species: '맘모꾸리', nature: 'adamant', sp: { ...ALL_SP_ZERO, 공격: '32' }, moves: ['지진', '', '', ''] })
  await fillSet(page, '방어측', { species: '어흥염', item: '', mega: false, nature: 'careful', sp: { ...ALL_SP_ZERO, HP: '32', 방어: '2' } })
  await region(page, '대전 조건').getByLabel('공격측 도우미').check()
  await expect(region(page, '대미지 판정').getByTestId('attack-band')).toHaveText('확정 1타')
  await combo(region(page, 'SP 스윕'), '스윕 대상').selectOption({ label: '방어측 HP (방어 관점)' })
  await expect(region(page, 'SP 스윕').locator('tbody tr')).toHaveCount(33)
  await combo(page, '레귤레이션').selectOption('m-b')
  await expect(page.getByTestId('regulation-rules')).toContainText('M-B')
  await combo(page, '레귤레이션').selectOption('m-c')
  await expect(page.getByTestId('regulation-rules')).toContainText('M-C')

  expect(all.length).toBeGreaterThan(0)
  expect(all.filter((u) => !u.startsWith('data:') && new URL(u).origin !== origin)).toEqual([])
})
