// 제품 화면 첫 세트이자 반응성 측정 시나리오의 공용 입력. 이름은 화면 입력과 같은 한국어, 특성·성격은 id.
import type { SetDraft } from '../ui/setDraft'

/** 한카리아스 노력 H2·A32·S32(합계 66) 생명의구슬 + 물리 4기. 첫 기술(지진)이 내 A를 참조한다. */
export const EXAMPLE_DRAFT: SetDraft = {
  species: '한카리아스',
  ability: 'roughskin',
  item: '생명의구슬',
  nature: 'hardy',
  sp: { hp: '2', atk: '32', def: '0', spa: '0', spd: '0', spe: '32' },
  moves: ['지진', '드래곤클로', '스톤샤워', '분함의발구르기'],
  mega: false,
  status: 'none',
  boosts: { atk: '0', def: '0', spa: '0', spd: '0', spe: '0' },
}
