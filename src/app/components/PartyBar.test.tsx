import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { realData } from '../../cards/testing'
import { initialState, reducer } from '../state'
import { PartyBar } from './PartyBar'
import { IMPORT_ERROR_TEXT, slotLabel } from './partyText'

const noop = () => {}

describe('slotLabel', () => {
  it('포켓몬 @ 도구, 도구 없으면 포켓몬만, 빈 칸은 비어 있음', () => {
    expect(slotLabel({ index: 0, speciesLabel: '한카리아스', itemLabel: '구애스카프' })).toBe('1번 칸: 한카리아스 @ 구애스카프')
    expect(slotLabel({ index: 2, speciesLabel: '한카리아스', itemLabel: ' ' })).toBe('3번 칸: 한카리아스')
    expect(slotLabel({ index: 5, speciesLabel: '', itemLabel: '구애스카프' })).toBe('6번 칸: 비어 있음')
  })

  it('가져오기 실패 문구는 원인마다 다르다', () => {
    expect(new Set(Object.values(IMPORT_ERROR_TEXT)).size).toBe(Object.keys(IMPORT_ERROR_TEXT).length)
  })
})

describe('PartyBar', () => {
  const { game } = realData()
  const render = (state = initialState('m-c')) => renderToStaticMarkup(<PartyBar state={state} game={game} dispatch={noop} />)

  it('6칸, 활성 1번 칸만 aria-current, 나머지는 빈 칸 이름', () => {
    const html = render()
    expect(html.match(/data-testid="party-slot"/g)).toHaveLength(6)
    expect(html.match(/aria-current="true"/g)).toHaveLength(1)
    for (let n = 2; n <= 6; n++) expect(html).toContain(`aria-label="${n}번 칸: 비어 있음"`)
    expect(html).toMatch(/aria-label="1번 칸: [^"]+"/)
    expect(html).not.toContain('aria-label="1번 칸: 비어 있음"')
  })

  it('채운 칸만 비우기(×) 버튼과 끌기가 있다', () => {
    const html = render()
    expect(html.match(/data-testid="party-slot-clear"/g)).toHaveLength(1)
    expect(html).toContain('aria-label="1번 칸 비우기"')
    expect(html.match(/draggable="true"/g)).toHaveLength(1)
  })

  it('링크 입력·가져오기·파티 비우기, 빈 파티면 파티 비우기는 비활성', () => {
    expect(render()).toMatch(/data-testid="party-clear-all"(?![^>]*disabled)/)
    const empty = reducer(initialState('m-c'), { type: 'party-clear-all' })
    const html = render(empty)
    expect(html).toContain('PokePaste 링크')
    expect(html).toContain('>가져오기</button>')
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*data-testid="party-clear-all"/)
    expect(html).toContain('aria-label="1번 칸: 비어 있음"')
  })
})
