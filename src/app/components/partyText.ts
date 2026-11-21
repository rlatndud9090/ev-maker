import type { PartySlotView } from '../party'

/** 칸 읽기 이름: "<n>번 칸: 포켓몬 @ 도구" / "<n>번 칸: 비어 있음" */
export function slotLabel(slot: Pick<PartySlotView, 'index' | 'speciesLabel' | 'itemLabel'>): string {
  const n = `${slot.index + 1}번 칸`
  const species = slot.speciesLabel.trim()
  if (species === '') return `${n}: 비어 있음`
  const item = slot.itemLabel.trim()
  return item === '' ? `${n}: ${species}` : `${n}: ${species} @ ${item}`
}

export type ImportFailure = 'format' | 'network' | 'not-found' | 'empty' | 'no-species'

export const IMPORT_ERROR_TEXT: Readonly<Record<ImportFailure, string>> = {
  format: 'pokepast.es 링크가 아닙니다. 예: https://pokepast.es/27afa251f1c9a8b7',
  network: '네트워크 오류로 paste를 받지 못했습니다. 연결을 확인하고 다시 시도해 주세요. 파티는 그대로입니다.',
  'not-found': '그 paste를 찾을 수 없습니다. 링크를 확인해 주세요. 파티는 그대로입니다.',
  empty: 'paste에 포켓몬이 없습니다. 파티는 그대로입니다.',
  'no-species': '현재 레귤레이션에서 찾을 수 있는 포켓몬이 없습니다. 파티는 그대로입니다.',
}

export const IMPORT_CONFIRM_TEXT = '현재 파티를 바꿉니다. 지금 파티의 포켓몬과 컷 고정은 사라지고, 추가한 상대 목록은 그대로 남습니다.'
export const CLEAR_CONFIRM_TEXT = '파티 6칸을 모두 비웁니다. 각 포켓몬의 세트와 컷 고정이 사라집니다.'
export const EMPTY_SLOT_TEXT = '포켓몬을 골라 주세요'

export const importedText = (count: number) => `${count}마리를 가져왔습니다.`
export const movedText = (to: number) => `${to + 1}번 칸으로 옮겼습니다.`
