// 내 포켓몬 패널의 컷 고정 표시(R12·R13·R14·AC1·AC14): 고정 능력치 SP 줄(조작 막음·기준 갈래 값), 성격 ▲ 기준 갈래 선택, 고정 목록, 초과·자르기 알림.
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { deriveLocks, type CutLock, type LockDerivation, type LockResolution } from '../../cards'
import { realData } from '../../cards/testing'
import type { StatId } from '../../data/schema'
import { STAT_LABEL } from '../../ui/labels'
import { toPokemonSet, type SetDraft } from '../../ui/setDraft'
import { LockUiContext, NO_LOCK_UI, type LockUi } from '../lockContext'
import type { LockTrim } from '../state'
import { MySetPanel } from './MySetPanel'
import { LOCK_NAME, NO_NEUTRAL_BRANCH_TEXT, lockDescription, lockDescriptionSpoken, lockSubjectSpoken } from './lockText'

const { game, bo1 } = realData()
const noop = () => {}
const spTotal = game.manifest.rules.spTotal

/** AC1 세트: 메가라이츄Y, 무보정, SP 전부 0, 메가스톤 외 도구 없음 */
const raichuY = (sp: Partial<Record<StatId, number>> = {}): SetDraft => ({
  species: 'raichu',
  ability: 'static',
  item: 'raichunitey',
  nature: 'hardy',
  sp: { hp: '0', atk: '0', def: '0', spa: '0', spd: '0', spe: '0', ...Object.fromEntries(Object.entries(sp).map(([k, v]) => [k, String(v)])) },
  moves: ['thunderbolt', 'focusblast', 'grassknot', 'voltswitch'],
  mega: true,
  status: 'none',
  boosts: { atk: '0', def: '0', spa: '0', spd: '0', spe: '0' },
})

const speedLock: CutLock = {
  seq: 1,
  kind: 'speed',
  target: { kind: 'speed', origin: 'ladder', opponentId: 'garchomp', bundle: { sp: 32, nature: 'plus' }, condition: 'none', filterKind: null },
  stage: 'first',
  stats: ['spe'],
}
const single = (stat: StatId, neutral: number | null, plus: number | null): LockResolution => ({ kind: 'ok', options: { shape: 'single', stat, neutral, plus } })

function derive(draft: SetDraft, resolutions: ReadonlyMap<number, LockResolution>, baseChoice: string | null = null): LockDerivation {
  return deriveLocks({ game, mySet: toPokemonSet(game, draft).set, locks: [speedLock], resolutions, baseChoice })
}

function panel(draft: SetDraft, ui: Partial<LockUi> | null, resolutions?: ReadonlyMap<number, LockResolution>): string {
  const body = <MySetPanel game={game} view={bo1} draft={draft} dispatch={noop} reasons={[]} onDisplaySp={noop} lockResolutions={resolutions} />
  if (ui === null) return renderToStaticMarkup(body)
  const value: LockUi = { ...NO_LOCK_UI, enabled: true, locks: [speedLock], ...ui }
  return renderToStaticMarkup(<LockUiContext.Provider value={value}>{body}</LockUiContext.Provider>)
}

const textOf = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
const lockedSpOf = (html: string, stat: StatId) => textOf(new RegExp(`data-testid="sp-locked-${stat}">(.*?)</span>`).exec(html)?.[1] ?? '').trim()
/** 그 능력치 SP 줄 하나 */
const rowOf = (html: string, stat: StatId) => {
  const m = new RegExp(`<div class="sp-row"[^>]*>(?:(?!<div class="sp-row").)*?aria-label="SP ${STAT_LABEL[stat]} 숫자"(?:(?!<div class="sp-row").)*`, 's').exec(html)
  return m?.[0] ?? ''
}
/** aria-label이 정확히 label인 입력·버튼 태그(없으면 실패: 빈 문자열로 통과하지 않게) */
function tagOf(html: string, label: string): string {
  const tag = new RegExp(`<(?:input|button)[^>]*aria-label="${label}"[^>]*>`).exec(html)?.[0]
  expect(tag, label).toBeDefined()
  return tag ?? ''
}
const attr = (tag: string, name: string) => new RegExp(` ${name}="([^"]*)"`).exec(tag)?.[1]
const isDisabled = (tag: string) => / disabled=""/.test(tag)

describe('내 포켓몬 패널: 컷 고정 없음', () => {
  it('Provider 없이는 지금처럼 S 숫자 입력·슬라이더·성격 토글을 조작할 수 있고 고정 목록이 없다', () => {
    const html = panel(raichuY(), null)
    expect(isDisabled(tagOf(html, 'SP 스피드 숫자'))).toBe(false)
    expect(isDisabled(tagOf(html, 'SP 스피드'))).toBe(false)
    expect(html).not.toContain('sp-locked-')
    expect(html).not.toContain('data-locked')
    expect(html).not.toContain('lock-list')
    expect(isDisabled(tagOf(html, '스피드 성격 상승'))).toBe(false)
  })
})

describe('내 포켓몬 패널: 스피드 컷 고정(AC1·R12)', () => {
  const resolutions = new Map([[1, single('spe', 23, 8)]])
  const derivation = derive(raichuY(), resolutions)

  it('갈래가 S8+·S23 두 개다(전제)', () => {
    expect(derivation.branches.map((b) => b.id)).toEqual(['plus:spe', 'out'])
  })

  const html = panel(raichuY(), { derivation, planSet: null }, resolutions)

  it('S 줄은 슬라이더 모양 그대로 두고 슬라이더·−/+·숫자 입력을 막은 채 기준 갈래("고정 밖" S23) 값을 보인다', () => {
    const row = rowOf(html, 'spe')
    expect(row).toContain('data-locked="true"')
    const range = tagOf(row, 'SP 스피드')
    expect(range).toContain('type="range"')
    expect(isDisabled(range)).toBe(true)
    expect(attr(range, 'value')).toBe('23')
    expect(attr(range, 'style')).toContain('--fill')
    const num = tagOf(row, 'SP 스피드 숫자')
    expect(isDisabled(num)).toBe(true)
    expect(attr(num, 'value')).toBe('23')
    expect(isDisabled(tagOf(row, 'SP 스피드 1 내리기'))).toBe(true)
    expect(isDisabled(tagOf(row, 'SP 스피드 1 올리기'))).toBe(true)
    // 읽기 설명: 고정됨과 갈래별 값
    expect(lockedSpOf(html, 'spe')).toBe('SP 스피드 고정됨: S8+ / S23')
    expect(attr(range, 'aria-describedby')).toBe(attr(num, 'aria-describedby'))
    // 다른 능력치는 그대로 조작
    expect(isDisabled(tagOf(html, 'SP HP 숫자'))).toBe(false)
    expect(rowOf(html, 'hp')).not.toContain('data-locked')
  })

  it('고정 줄 ▲는 기준 갈래 선택(지금 "고정 밖"이라 꺼짐·누를 수 있음), ▼는 막힘. 고정 밖 줄 ▲▼는 평소처럼', () => {
    const plus = tagOf(html, '스피드 성격 상승')
    expect(attr(plus, 'aria-pressed')).toBe('false')
    expect(isDisabled(plus)).toBe(false)
    expect(isDisabled(tagOf(html, '스피드 성격 하락'))).toBe(true)
    for (const stat of ['공격', '방어', '특공', '특방']) expect(isDisabled(tagOf(html, `${stat} 성격 상승`))).toBe(false)
  })

  it('성격 안내 문구·"표 기준" 라디오가 없다', () => {
    expect(textOf(html)).not.toContain('상승은 갈래별')
    expect(html).not.toContain('type="radio"')
    expect(html).not.toContain('표 기준')
  })

  it('합계는 기준 갈래("고정 밖" S23) 값 기준이다', () => {
    expect(derivation.baseId).toBe('out')
    expect(textOf(html)).toContain(`SP 합계 23 / ${spTotal} · 잔여 ${spTotal - 23}`)
  })

  it('고정 목록: 상대 이미지·배분(이름 글자 없음, 스피드는 단계 라벨 없음), 오른쪽 선택지 SP만, 해제는 "×"(읽기 이름 "…고정 해제")', () => {
    const list = html.slice(html.indexOf('class="lock-list"'))
    const desc = /<button type="button" class="lock-desc"[^>]*>(.*?)<\/button>/s.exec(list)?.[1] ?? ''
    expect(desc).toMatch(/<img class="mon-icon lock-mon"[^>]*data-species-icon="garchomp"/)
    expect(textOf(desc).trim()).toBe('S32↑')
    expect(textOf(list)).not.toContain(game.data.species.garchomp.name.ko)
    // 툴팁·읽기 이름에도 스피드 단계 라벨 없음(더 느리려는 컷은 없다)
    expect(list).not.toContain('선공')
    expect(list).not.toContain('ko-badge')
    expect(list).toMatch(/<span class="lock-sp num">S8\+ \/ S23<\/span>/)
    expect(textOf(list.slice(list.indexOf('<ul')))).not.toContain('고정')
    expect(list).toContain(`title="${lockDescription(game, speedLock)}"`)
    const remove = /<button[^>]*class="lock-remove"[^>]*>(.*?)<\/button>/s.exec(list)
    expect(remove?.[0]).toContain(`aria-label="${lockSubjectSpoken(game, speedLock)} 고정 해제"`)
    expect(textOf(remove?.[1] ?? '').trim()).toBe('×')
    expect(lockDescriptionSpoken(game, speedLock)).toBe(`${LOCK_NAME}: ${lockSubjectSpoken(game, speedLock)}`)
    // 목록은 SP 입력 블록 아래
    expect(html.indexOf('class="lock-list"')).toBeGreaterThan(html.indexOf('class="sp-block"'))
  })

  it('S 상승 갈래가 기준이면 S ▲가 켜지고 S 줄·합계가 그 갈래(S8+)를 따른다(AC14)', () => {
    const d = derive(raichuY(), resolutions, 'plus:spe')
    const h = panel(raichuY(), { derivation: d }, resolutions)
    expect(attr(tagOf(h, '스피드 성격 상승'), 'aria-pressed')).toBe('true')
    expect(isDisabled(tagOf(h, '스피드 성격 상승'))).toBe(false)
    expect(attr(tagOf(h, 'SP 스피드'), 'value')).toBe('8')
    expect(textOf(h)).toContain(`SP 합계 8 / ${spTotal}`)
    // 고정 밖 ▲는 꺼져 있다(상승이 S)
    expect(attr(tagOf(h, '공격 성격 상승'), 'aria-pressed')).toBe('false')
  })

  it('상승안만 있으면(갈래 하나) S ▲는 켜진 채 비활성이고 고정 밖 ▲도 켤 수 없다', () => {
    const one = new Map([[1, single('spe', null, 23)]])
    const h = panel(raichuY(), { derivation: derive(raichuY(), one) }, one)
    const plus = tagOf(h, '스피드 성격 상승')
    expect(attr(plus, 'aria-pressed')).toBe('true')
    expect(isDisabled(plus)).toBe(true)
    expect(attr(plus, 'title')).toBe(NO_NEUTRAL_BRANCH_TEXT)
    expect(lockedSpOf(h, 'spe')).toBe('SP 스피드 고정됨: S23+')
    expect(attr(tagOf(h, 'SP 스피드'), 'value')).toBe('23')
    expect(isDisabled(tagOf(h, '공격 성격 상승'))).toBe(true)
  })

  it('무보정안만 있으면 S ▲는 꺼진 채 비활성이다', () => {
    const one = new Map([[1, single('spe', 23, null)]])
    const h = panel(raichuY(), { derivation: derive(raichuY(), one) }, one)
    const plus = tagOf(h, '스피드 성격 상승')
    expect(attr(plus, 'aria-pressed')).toBe('false')
    expect(isDisabled(plus)).toBe(true)
  })
})

describe('내 포켓몬 패널: 고정 상태·경고', () => {
  it('도달 불가 고정만 있는 능력치는 조작을 막은 채 상태 칩, 목록에도 칩이 보인다', () => {
    const resolutions = new Map<number, LockResolution>([[1, { kind: 'unreachable' }]])
    const derivation = derive(raichuY(), resolutions)
    const html = panel(raichuY(), { derivation }, resolutions)
    expect(lockedSpOf(html, 'spe')).toBe('SP 스피드 고정됨: 도달 불가')
    expect(rowOf(html, 'spe')).toMatch(/<span class="lock-chip"[^>]*>도달 불가<\/span>/)
    expect(isDisabled(tagOf(html, 'SP 스피드 숫자'))).toBe(true)
    expect(html).toMatch(/<span id="[^"]+" class="lock-chip"[^>]*>도달 불가<\/span>/)
    expect(html).toMatch(/class="lock-desc"[^>]*aria-describedby="[^"]+"/)
  })

  it('계산 중이면 목록 제목에 "계산 중…"이 보이고 상태 칩은 없다', () => {
    const html = panel(raichuY(), { derivation: null, pending: true })
    expect(html).toContain('aria-busy="true"')
    expect(textOf(html)).toContain('계산 중…')
    expect(lockedSpOf(html, 'spe')).toBe('SP 스피드 고정됨: 계산 중')
  })

  it('계획 세트 합이 66을 넘으면 세트 오류가 아니라 초과량 경고다', () => {
    const draft = raichuY({ hp: 32, spa: 32 })
    const resolutions = new Map([[1, single('spe', 23, 8)]])
    const derivation = derive(draft, resolutions)
    expect(derivation.overTotal).toBe(32 + 32 + 23 - spTotal)
    const html = panel(draft, { derivation }, resolutions)
    expect(html).toContain(`SP 합계 ${spTotal}을 ${derivation.overTotal} 넘음`)
    expect(html).not.toContain('role="alert"')
    // 고정 중에도 실능치를 보인다(합계 초과로 계산이 멈추지 않는다)
    expect(html).not.toMatch(/aria-label="스피드 실능치">—</)
  })

  it('복원 자르기 알림은 상태 알림이고 닫기 버튼이 있다(고정이 모두 풀린 뒤에도)', () => {
    const trim: readonly LockTrim[] = [{ stat: 'spe', from: 32, to: 20 }]
    const html = panel(raichuY({ spe: 20 }), { locks: [], trim })
    expect(html).toMatch(/<div class="lock-trim" role="status"/)
    expect(textOf(html)).toContain(`S 32 → 20(합계 ${spTotal} 초과로 줄임)`)
    expect(html).toContain('aria-label="SP 줄임 알림 닫기"')
    expect(html).not.toContain('lock-list')
    expect(html).toContain('aria-label="SP 스피드 숫자"')
  })
})
