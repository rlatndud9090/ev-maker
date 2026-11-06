import { expect, type Locator, type Page } from '@playwright/test'

export const region = (page: Page, name: string) => page.getByRole('region', { name, exact: true })

/** select와 datalist 입력은 combobox다. 감싼 label의 텍스트엔 option 문구가 섞여 getByLabel 정확 일치가 안 된다. */
export const combo = (scope: Page | Locator, name: string) => scope.getByRole('combobox', { name, exact: true })

export async function openPage(page: Page) {
  await page.goto('/')
  await expect(region(page, '공격측').locator('table.stats')).toBeVisible()
}

export interface SetInput {
  species?: string
  nature?: string
  item?: string
  mega?: boolean
  sp?: Partial<Record<'HP' | '공격' | '방어' | '특공' | '특방' | '스피드', string>>
  moves?: string[]
}

export async function fillSet(page: Page, side: '공격측' | '방어측', s: SetInput) {
  const r = region(page, side)
  if (s.species !== undefined) await combo(r, '종').fill(s.species)
  if (s.item !== undefined) await combo(r, '도구').fill(s.item)
  if (s.mega !== undefined) await r.getByRole('checkbox', { name: /^메가진화/ }).setChecked(s.mega)
  if (s.nature !== undefined) await combo(r, '성격').selectOption(s.nature)
  for (const [stat, v] of Object.entries(s.sp ?? {})) await r.getByRole('spinbutton', { name: `SP ${stat}`, exact: true }).fill(v)
  for (const [i, m] of (s.moves ?? []).entries()) await combo(r, `기술 ${i + 1}`).fill(m)
}

export const ALL_SP_ZERO = { HP: '0', 공격: '0', 방어: '0', 특공: '0', 특방: '0', 스피드: '0' } as const

export const statCell = (page: Page, side: '공격측' | '방어측', stat: string) =>
  region(page, side).locator(`table.stats td[data-stat="${stat}"]`)
