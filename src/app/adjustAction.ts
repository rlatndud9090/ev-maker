// 조정 팝오버에서 고른 (결과, 성격 선택지)를 리듀서 apply-adjust 액션으로 만든다.
import type { AdjustAllocation, AdjustView, LockDerivation } from '../cards'
import type { Snapshot, StatId } from '../data/schema'
import { choiceOf, natureIdFor, togglePlus, type NatureChoice } from '../ui/natureToggle'
import { toPokemonSet, type SetDraft } from '../ui/setDraft'
import type { AppAction } from './state'

export interface AdjustActionInput {
  game: Snapshot
  draft: SetDraft
  /** 지금 실행 세대의 고정 파생(고정이 없거나 계산 중이면 null) */
  derivation: LockDerivation | null
  view: AdjustView
  /** view.results index */
  result: number
  /** view.natures index */
  option: number
  /** 그 선택지의 배분(없으면 합 최소). H 최대는 그 선택지에 hMax가 있을 때만 */
  allocation?: AdjustAllocation
}

type NaturePatch = Pick<SetDraft, 'nature' | 'natureMinusAuto'>

const patchOf = (game: Snapshot, c: NatureChoice): NaturePatch => ({ nature: natureIdFor(game, c.plus, c.minus), natureMinusAuto: c.minusAuto })

/** 그 성격의 능력치 보정 부호(+1·0·−1). 모르는 성격은 0 */
function boostSign(game: Snapshot, natureId: string, stat: StatId): number {
  const n = Object.prototype.hasOwnProperty.call(game.data.natures, natureId) ? game.data.natures[natureId] : undefined
  if (n === undefined || n.plus === n.minus) return 0
  return (n.plus === stat ? 1 : 0) - (n.minus === stat ? 1 : 0)
}

/** 그 선택지가 ok가 아니거나 고른 배분이 없으면 null */
export function adjustAction({ game, draft, derivation, view, result, option, allocation = 'min-sum' }: AdjustActionInput): AppAction | null {
  const picked = view.results[result]?.options[option]
  const choiceNature = view.natures[option]
  if (picked?.kind !== 'ok' || choiceNature === undefined) return null
  const stats = allocation === 'h-max' ? picked.hMax : picked.stats
  if (stats === undefined) return null

  const sp: Partial<Record<StatId, number>> = {}
  for (const s of stats) if (!s.locked) sp[s.stat] = s.sp

  const choice = choiceOf(game, draft.nature, draft.natureMinusAuto === true)
  const adjustedPlus = view.natures.flatMap((n) => (n.id !== 'neutral' && n.plus !== null ? [n.plus] : []))
  let nature: NaturePatch | undefined
  if (choiceNature.id === 'neutral') {
    if (choice.plus !== undefined && adjustedPlus.includes(choice.plus)) nature = patchOf(game, { minusAuto: false })
  } else if (choiceNature.id === 'plus' && choiceNature.plus !== null && choice.plus !== choiceNature.plus) {
    nature = patchOf(game, togglePlus(game, choice, choiceNature.plus, toPokemonSet(game, draft).set.moves))
  }

  // 고정 중에는 계획이 하락을 관여 밖으로 옮기므로 상승만 맞으면 된다. 고정이 없으면 자동 하락이 관여 능력치에 떨어지지 않게 판정 성격으로 맞춘다.
  if (derivation === null && choiceNature.branchId === null) {
    const built = nature?.nature ?? draft.nature
    const differs = view.relevant.some((s) => s !== 'hp' && boostSign(game, built, s) !== boostSign(game, choiceNature.nature, s))
    if (differs) nature = { nature: choiceNature.nature, natureMinusAuto: false }
  }

  const action: AppAction = { type: 'apply-adjust', sp, lockedSp: choiceNature.lockedSp, keep: view.keep, rules: game.manifest.rules }
  if (nature !== undefined) action.nature = nature
  if (derivation !== null && choiceNature.branchId !== null && choiceNature.branchId !== derivation.baseId) action.lockBase = choiceNature.branchId
  return action
}
