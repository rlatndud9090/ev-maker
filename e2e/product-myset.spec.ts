// R11 내 포켓몬 교체·재계산 UX: 처음 고른 종 = 대표 세트, 종별 수동 세트 기억(AC31), 종 교체 시 펼침 접기·스크롤 유지(AC32).
import { readFileSync } from 'node:fs'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { cards, combo, mySet, openProduct, selectTab, tabPanel, waitComplete } from './helpers'

interface Named { name: { ko: string; koLabel?: string } }
const data = JSON.parse(readFileSync(new URL('../src/data/regulations/m-c/data.json', import.meta.url), 'utf8')) as {
  species: Record<string, Named & { isMega?: boolean; abilities: string[] }>
  moves: Record<string, Named>
  items: Record<string, Named>
  natures: Record<string, { plus?: string; minus?: string }>
}
const label = (n: Named) => (n.name.koLabel ? `${n.name.ko}(${n.name.koLabel})` : n.name.ko)

interface RepSet { ability: string; item?: string; nature: string; sp: Record<string, number>; moves: string[] }
interface Entry { id: string; representative: { set: RepSet } }
interface IndexItem { match: 'bo1' | 'bo3'; month: string; battles: number }
/** 기본 통계(최근 월에서 판수가 더 많은 매치 방식, 동률 Bo1)의 항목 */
function defaultEntries(): Entry[] {
  const items = (JSON.parse(readFileSync(new URL('../src/data/meta/index.json', import.meta.url), 'utf8')) as { regulations: Record<string, IndexItem[]> }).regulations['m-c']
  const month = items.map((i) => i.month).sort().at(-1)!
  const pick = items.filter((i) => i.month === month).reduce((a, b) => (b.battles > a.battles || (b.battles === a.battles && b.match === 'bo1') ? b : a))
  return (JSON.parse(readFileSync(new URL(`../src/data/meta/m-c/${month}-${pick.match}.json`, import.meta.url), 'utf8')) as { entries: Entry[] }).entries
}

const STATS = { hp: 'HP', atk: '공격', def: '방어', spa: '특공', spd: '특방', spe: '스피드' } as const
const spBox = (page: Page, stat: keyof typeof STATS) => mySet(page).getByRole('spinbutton', { name: `SP ${STATS[stat]} 숫자`, exact: true })
const moveBox = (page: Page, i: number) => combo(mySet(page), `기술 ${i + 1}`)
const abilitySelect = (page: Page) => mySet(page).locator('label.chip', { hasText: '특성' }).locator('select')
const itemBox = (page: Page) => combo(mySet(page), '도구')
const cardLine = (card: Locator) => card.locator('button[aria-expanded]').first()
const expandedCards = (page: Page) => tabPanel(page).locator('[data-testid="card"] button.card-toggle[aria-expanded="true"]')
const scroller = (page: Page) => page.getByTestId('result-scroll')

async function chooseSpecies(page: Page, text: string) {
  const species = combo(mySet(page), '종')
  await species.fill(text)
  await species.press('Enter')
  await expect(species).toHaveValue(text)
}

/** 조작 후 새 세대 뷰가 끝날 때까지 */
async function afterRecompute(page: Page, before: string | null) {
  await expect(tabPanel(page)).not.toHaveAttribute('data-generation', before ?? '')
  await waitComplete(page)
}

async function expectRepresentative(page: Page, e: Entry) {
  const rep = e.representative.set
  const sp = data.species[e.id]
  expect(sp.abilities, '대표 특성은 그 종 특성').toContain(rep.ability)
  await expect(abilitySelect(page)).toHaveValue(rep.ability)
  await expect(itemBox(page)).toHaveValue(rep.item === undefined ? '' : label(data.items[rep.item]))
  for (const s of Object.keys(STATS) as (keyof typeof STATS)[]) await expect(spBox(page, s)).toHaveValue(String(rep.sp[s]))
  const moves = rep.moves.filter((m) => m in data.moves).slice(0, 4).map((m) => label(data.moves[m]))
  for (let i = 0; i < 4; i++) await expect(moveBox(page, i)).toHaveValue(moves[i] ?? '')
  const n = data.natures[rep.nature]
  const plus = n.plus !== n.minus ? n.plus : undefined
  for (const s of ['atk', 'def', 'spa', 'spd', 'spe'] as const) {
    const name = STATS[s]
    await expect(mySet(page).getByRole('button', { name: `${name} 성격 상승`, exact: true })).toHaveAttribute('aria-pressed', String(plus === s))
    await expect(mySet(page).getByRole('button', { name: new RegExp(`^${name} 성격 하락`) })).toHaveAttribute('aria-pressed', String(plus !== undefined && n.minus === s))
  }
}

test.describe('내 포켓몬 교체(R11)', () => {
  test('처음 고른 종은 대표 세트, 손으로 바꾼 도구·SP는 다른 종에 갔다 와도 남는다(AC31)', async ({ page }) => {
    await openProduct(page)
    await waitComplete(page)
    // 예시 세트(한카리아스)와 다른, 대표 특성을 가질 수 있고 보정 성격인 비메가 종 두 마리
    const pickable = defaultEntries().filter((e) => {
      const sp = data.species[e.id]
      const n = data.natures[e.representative.set.nature]
      return e.id !== 'garchomp' && sp !== undefined && !sp.isMega && sp.abilities.includes(e.representative.set.ability) && n.plus !== undefined && n.plus !== n.minus
    })
    const [a, b] = pickable
    expect(b, '대상 종 두 마리').toBeDefined()

    await chooseSpecies(page, label(data.species[a.id]))
    await expectRepresentative(page, a)

    // 손으로 도구·SP를 바꾼다(대표 세트와 다른 값)
    const other = Object.keys(data.items).find((id) => id !== a.representative.set.item && ['choicescarf', 'lifeorb', 'focussash'].includes(id))!
    await itemBox(page).fill(label(data.items[other]))
    await itemBox(page).press('Enter')
    await expect(itemBox(page)).toHaveValue(label(data.items[other]))
    const hp = a.representative.set.sp.hp === 0 ? '1' : '0'
    await spBox(page, 'hp').fill(hp)
    await expect(spBox(page, 'hp')).toHaveValue(hp)

    await chooseSpecies(page, label(data.species[b.id]))
    await expectRepresentative(page, b)

    await chooseSpecies(page, label(data.species[a.id]))
    await expect(itemBox(page)).toHaveValue(label(data.items[other]))
    await expect(spBox(page, 'hp')).toHaveValue(hp)
    await expect(abilitySelect(page)).toHaveValue(a.representative.set.ability)

    // 처음 화면의 예시 세트 종으로 돌아오면 예시 세트 그대로(대표 세트로 덮지 않는다)
    await chooseSpecies(page, '한카리아스')
    await expect(itemBox(page)).toHaveValue('생명의구슬')
    await expect(moveBox(page, 0)).toHaveValue('지진')
    await expect(spBox(page, 'atk')).toHaveValue('32')
  })

  test('종을 바꾸면 재계산 뒤 펼친 카드가 접히고, SP만 바꾸면 펼침 유지(AC32)', async ({ page }) => {
    await openProduct(page)
    await waitComplete(page)
    await cardLine(cards(page).nth(0)).click()
    await cardLine(cards(page).nth(1)).click()
    await expect(expandedCards(page)).toHaveCount(2)

    let gen = await tabPanel(page).getAttribute('data-generation')
    await mySet(page).getByRole('button', { name: 'SP HP 1 내리기', exact: true }).click()
    await afterRecompute(page, gen)
    await expect(expandedCards(page)).toHaveCount(2)

    const target = defaultEntries().find((e) => e.id !== 'garchomp' && data.species[e.id] && !data.species[e.id].isMega)!
    gen = await tabPanel(page).getAttribute('data-generation')
    await chooseSpecies(page, label(data.species[target.id]))
    await afterRecompute(page, gen)
    await expect(expandedCards(page)).toHaveCount(0)
    await expect(cards(page).first()).toBeVisible()
  })

  // 방어 탭은 재계산 중 기본 항목이 정해지기 전 카드를 숨겨 목록이 잠깐 짧아진다(고치기 전: scrollTop 900 → 185 근처로 줄었다).
  test('목록을 아래로 스크롤한 채 SP·종을 바꾸면 재계산 뒤 스크롤 위치가 거의 같다(AC32)', async ({ page }) => {
    await openProduct(page)
    await selectTab(page, '방어')
    await waitComplete(page)
    const box = scroller(page)
    const want = await box.evaluate((el) => {
      el.scrollTop = Math.min(900, el.scrollHeight - el.clientHeight)
      return el.scrollTop
    })
    expect(want, '스크롤할 만큼 긴 목록').toBeGreaterThan(200)
    const target = defaultEntries().find((e) => e.id !== 'garchomp' && data.species[e.id] && !data.species[e.id].isMega)!
    const steps: [string, () => Promise<void>][] = [
      ['SP 내리기', () => mySet(page).getByRole('button', { name: 'SP HP 1 내리기', exact: true }).click()],
      ['SP 올리기', () => mySet(page).getByRole('button', { name: 'SP HP 1 올리기', exact: true }).click()],
      ['종 교체', () => chooseSpecies(page, label(data.species[target.id]))],
    ]
    for (const [name, act] of steps) {
      const gen = await tabPanel(page).getAttribute('data-generation')
      // 재계산 중에도 매 프레임 scrollTop을 기록한다(중간에 줄었다가 앵커링으로 되돌아오는 것도 잡는다)
      await box.evaluate((el) => {
        const w = window as unknown as { tops: number[]; stopTops?: () => void }
        w.tops = []
        let on = true
        const tick = () => {
          if (!on) return
          w.tops.push(el.scrollTop)
          requestAnimationFrame(tick)
        }
        w.stopTops = () => (on = false)
        tick()
      })
      await act()
      await afterRecompute(page, gen)
      const tops = await page.evaluate(() => {
        const w = window as unknown as { tops: number[]; stopTops: () => void }
        w.stopTops()
        return w.tops
      })
      const got = await box.evaluate((el) => el.scrollTop)
      // 종 교체는 새 목록이 더 짧으면 끝에서 멈출 수 있다
      const cap = await box.evaluate((el) => el.scrollHeight - el.clientHeight)
      expect(Math.abs(got - Math.min(want, cap)), `${name}: ${want} → ${got}`).toBeLessThan(40)
      if (cap >= want) expect(Math.min(...tops), `${name} 재계산 중 최소 scrollTop`).toBeGreaterThan(want - 40)
    }
  })
})
