import { expect, test } from '@playwright/test'
import { ALL_SP_ZERO, combo, fillSet, openPage, region, statCell } from './helpers'

test.beforeEach(async ({ page }) => openPage(page))

test('고집 맘모꾸리 공격 SP 32 → 공격 실능치 200', async ({ page }) => {
  await fillSet(page, '공격측', { species: '맘모꾸리', nature: 'adamant', item: '', mega: false, sp: { ...ALL_SP_ZERO, 공격: '32' }, moves: ['지진', '', '', ''] })
  await expect(region(page, '공격측').getByRole('alert')).toHaveCount(0)
  await expect(statCell(page, '공격측', 'atk')).toHaveText('200')
})

async function kingambitVsMegaDelphox(page: import('@playwright/test').Page) {
  await fillSet(page, '공격측', {
    species: '대도각참',
    nature: 'hardy',
    item: '',
    mega: false,
    sp: { ...ALL_SP_ZERO, 공격: '32' },
    moves: ['기습', '', '', ''],
  })
  await fillSet(page, '방어측', { species: '메가마폭시', nature: 'hardy', sp: { ...ALL_SP_ZERO, HP: '2' } })
}

test('대도각참 기습 → 메가마폭시: 한국어 이름으로 고르면 확정 1타', async ({ page }) => {
  await kingambitVsMegaDelphox(page)
  const def = region(page, '방어측')
  await expect(combo(def, '도구')).toHaveValue('마폭시나이트')
  await expect(def.getByText('계산 종: 메가마폭시')).toBeVisible()
  const dmg = region(page, '대미지 판정')
  await expect(dmg.getByTestId('attack-band')).toHaveText('확정 1타')
  await expect(dmg.getByTestId('defense-band')).toHaveText('중난수 이상')
  await expect(dmg.getByText('162~192 / HP 152 (106.5%~126.3%)')).toBeVisible()
  await expect(dmg.locator('p.rolls')).toHaveText('1타: 162, 164, 164, 168, 168, 170, 174, 174, 176, 180, 180, 182, 186, 186, 188, 192')
})

test('같은 대면의 공격 SP 스윕: 33칸 판정과 경계 SP 13, 19', async ({ page }) => {
  await kingambitVsMegaDelphox(page)
  const sw = region(page, 'SP 스윕')
  await combo(sw, '스윕 대상').selectOption({ label: '공격측 공격 (공격 관점)' })
  await expect(sw.locator('tbody tr')).toHaveCount(33)
  await expect(sw.getByTestId('sweep-boundaries')).toHaveText('13, 19')
  await expect(sw.locator('tr.boundary')).toHaveCount(2)
  await expect(sw.locator('tr[data-sp="12"] td').nth(1)).toHaveText('중난수 이하')
  await expect(sw.locator('tr[data-sp="13"] td').nth(1)).toHaveText('고난수 1타')
  await expect(sw.locator('tr[data-sp="19"] td').nth(1)).toHaveText('확정 1타')

  // 다른 능력치에 SP를 몰면 합계 상한을 넘는 칸은 예산 초과로 표시된다.
  await fillSet(page, '공격측', { sp: { HP: '32', 방어: '32', 공격: '0' } })
  await expect(sw.locator('tbody tr')).toHaveCount(33)
  await expect(sw.locator('tr.over')).toHaveCount(30)
  await expect(sw.locator('tr[data-sp="3"]')).toContainText('예산 초과')
})

test('스피드 비교: 판정, 순풍으로 판정이 바뀜, 추월 최소 SP', async ({ page }) => {
  await fillSet(page, '공격측', { species: '플라엣테(영원의 꽃)', nature: 'timid', item: '', mega: false, sp: ALL_SP_ZERO, moves: ['', '', '', ''] })
  await fillSet(page, '방어측', { species: '한카리아스', nature: 'jolly', item: '', mega: false, sp: ALL_SP_ZERO })
  const sp = region(page, '스피드 비교')
  await expect(sp.getByTestId('speed-order')).toHaveText('후공')
  await expect(sp.getByTestId('outspeed')).toHaveText('SP 11')

  await region(page, '대전 조건').getByLabel('공격측 순풍').check()
  await expect(sp.getByTestId('speed-order')).toHaveText('선공')
  await expect(sp.getByTestId('outspeed')).toHaveText('SP 0')
})

test('M-B를 고르면 메가한카리아스Z를 쓸 수 없고, M-C로 돌아오면 계산된다', async ({ page }) => {
  await fillSet(page, '공격측', { species: '메가한카리아스Z', nature: 'jolly', sp: ALL_SP_ZERO, moves: ['', '', '', ''] })
  const atk = region(page, '공격측')
  await expect(combo(atk, '도구')).toHaveValue('한카리아스나이트Z')
  await expect(atk.getByText('계산 종: 메가한카리아스Z')).toBeVisible()

  await combo(page, '레귤레이션').selectOption('m-b')
  await expect(page.getByTestId('regulation-rules')).toContainText('M-B')
  await expect(atk.getByRole('alert')).toContainText('UNKNOWN_SPECIES')
  await expect(atk.locator('table.stats')).toHaveCount(0)
  await expect(atk.locator('datalist option[value="메가한카리아스Z"]')).toHaveCount(0)

  await combo(page, '레귤레이션').selectOption('m-c')
  await expect(atk.getByText('계산 종: 메가한카리아스Z')).toBeVisible()
})

test('잘못된 입력은 조용히 무시되지 않고 오류로 보인다', async ({ page }) => {
  await fillSet(page, '공격측', { sp: { 공격: '' } })
  await expect(region(page, '공격측').getByRole('alert')).toContainText('INVALID_SP')
  await fillSet(page, '공격측', { sp: { 공격: '32' }, moves: ['없는기술'] })
  await expect(region(page, '대미지 판정').getByRole('alert')).toContainText('UNKNOWN_MOVE')
})
