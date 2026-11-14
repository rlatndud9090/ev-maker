// R13 바뀐 기술 타입 표시(AC34 화면): 기술 배지·메뉴 항목·상세 제목·내 기술 칸의 타입 아이콘·색이 판정에 쓰는 타입이다.
import { readFileSync } from 'node:fs'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { cards, combo, mySet, openProduct, selectTab, tabPanel, waitComplete } from './helpers'

interface Named { name: { ko: string; koLabel?: string } }
const data = JSON.parse(readFileSync(new URL('../src/data/regulations/m-c/data.json', import.meta.url), 'utf8')) as {
  species: Record<string, Named>
  moves: Record<string, Named>
}
const label = (n: Named) => (n.name.koLabel ? `${n.name.ko}(${n.name.koLabel})` : n.name.ko)
const HYPER_VOICE = label(data.moves.hypervoice)

const groupRow = (page: Page, id: string) => cards(page).and(page.locator(`[data-group-key='${JSON.stringify(['ladder', id])}']`))
const moveBox = (page: Page, i: number) => combo(mySet(page), `기술 ${i + 1}`)

/** 종을 고르고, 하이퍼보이스가 기술 칸에 없으면 1번 칸에 넣는다. 하이퍼보이스가 든 칸 번호 */
async function chooseWithHyperVoice(page: Page, speciesId: string): Promise<number> {
  const species = combo(mySet(page), '종')
  const gen = await tabPanel(page).getAttribute('data-generation')
  await species.fill(label(data.species[speciesId]))
  await species.press('Enter')
  await expect(species).toHaveValue(label(data.species[speciesId]))
  await expect(tabPanel(page)).not.toHaveAttribute('data-generation', gen ?? '')
  for (let i = 0; i < 4; i++) if ((await moveBox(page, i).inputValue()) === HYPER_VOICE) return i
  await moveBox(page, 0).fill(HYPER_VOICE)
  await moveBox(page, 0).press('Enter')
  await expect(moveBox(page, 0)).toHaveValue(HYPER_VOICE)
  return 0
}

const moveSlot = (page: Page, i: number) => mySet(page).locator('.move-slot').nth(i)

/** 첫 카드에서 하이퍼보이스 항목을 고르고 배지·메뉴 항목·상세 제목의 타입을 본다 */
async function expectAttackHyperVoice(page: Page, slug: string, typeKo: string) {
  await waitComplete(page)
  const card = cards(page).first()
  const pick = card.getByTestId('move-pick')
  await pick.click()
  const item = card.getByTestId('move-menu').locator('[role="menuitemradio"][data-move="hypervoice"]').first()
  await expect(item.getByTestId('move-label')).toHaveAttribute('data-type', slug)
  await expect(item.getByTestId('move-label')).toContainText(`${typeKo} 타입`)
  await item.click()
  await expect(pick.getByTestId('move-label')).toHaveAttribute('data-type', slug)
  await expect(pick.getByTestId('move-label')).toContainText(HYPER_VOICE)
  const toggle = card.locator('.card-toggle')
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click()
  const title = card.getByTestId('row').first().locator('.row-title').getByTestId('move-label')
  await expect(title).toHaveAttribute('data-type', slug)
  await expect(title).toContainText(HYPER_VOICE)
}

async function expectSlotType(slot: Locator, slug: string, typeKo: string) {
  await expect(slot).toHaveAttribute('data-type', slug)
  await expect(slot.locator('img[data-type-icon]')).toHaveAttribute('data-type-icon', slug)
  // 기술 칸 콤보박스의 설명(aria-describedby)이 바뀐 타입 이름을 읽는다
  await expect(slot.getByRole('combobox')).toHaveAccessibleDescription(`${typeKo} 타입`)
}

test.describe('바뀐 기술 타입 표시(R13)', () => {
  test('메가가디안(페어리스킨) 하이퍼보이스는 페어리, 원종 가디안이면 노말(AC34)', async ({ page }) => {
    await openProduct(page)
    await waitComplete(page)

    const mega = await chooseWithHyperVoice(page, 'gardevoirmega')
    await expectSlotType(moveSlot(page, mega), 'fairy', '페어리')
    await expectAttackHyperVoice(page, 'fairy', '페어리')

    const base = await chooseWithHyperVoice(page, 'gardevoir')
    await expectSlotType(moveSlot(page, base), 'normal', '노말')
    await expectAttackHyperVoice(page, 'normal', '노말')
  })

  test('방어 탭: 가뭄(메가리자몽Y) 상대의 웨더볼 항목은 불꽃', async ({ page }) => {
    await openProduct(page)
    await waitComplete(page)
    // 예시 세트(한카리아스)는 불꽃을 반감해 웨더볼이 후보에서 빠진다(R2). 불꽃 등배인 메가가디안으로 본다.
    await chooseWithHyperVoice(page, 'gardevoirmega')
    await selectTab(page, '방어')
    await waitComplete(page)
    const row = groupRow(page, 'charizardmegay')
    await expect(row.first()).toBeVisible()
    await row.first().getByTestId('move-pick').click()
    const item = row.first().getByTestId('move-menu').locator('[role="menuitemradio"][data-move="weatherball"]').first()
    await expect(item.getByTestId('move-label')).toHaveAttribute('data-type', 'fire')
    await expect(item.getByTestId('move-label')).toContainText('불꽃 타입')
  })
})
