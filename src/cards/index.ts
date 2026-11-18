// 카드 모델 공개 API. 순수 모듈이며 데이터는 입력으로 받는다.
export * from './types'
export { addedBundleCardId, addedBundleIdentity, addedBundlePin, bundleIdentity, cardId, rowId, presetKey, samePin, speedBundleIdentity } from './ids'
export { isSpValue } from './spValue'
export { relevantStats, myDependsOn } from './relevance'
export { bundlesOf } from './bundles'
export { categoryDefault, chosenOption, defaultOption, groupCards, groupItems, groupKey, isPinned, pinOf, type CardGroup, type GroupItem } from './groups'
export { RANK_MEANS, REACTIONS, applyMeans, myMeansNotes } from './rankMeans'
export { presetAssumption } from './presets'
export { opponentSeeds, planTab, type OpponentCategorySeeds, type OpponentSeedsResult } from './plan'
export { ladderInRange } from './range'
export {
  additionTargetOf,
  damageAdditionQuery,
  judgeDamageAddition,
  judgeSpeedAddition,
  observedState,
  speedAdditionQuery,
  targetStatus,
  type AdditionTarget,
  type AdditionVerdict,
  type DamageAdditionQuery,
  type DamageCategoryQuery,
  type DamageObserved,
  type ObservedState,
  type SpeedAdditionQuery,
  type SpeedObserved,
  type TargetStatus,
  type UnavailableReason,
} from './addition'
export {
  taskKey,
  pendingTasks,
  nextStage,
  mayUnlockPair,
  neededVariants,
  rowJudgements,
  rowChanges,
  cardDefault,
  cardExplore,
  shownItemKey,
  opponentKey,
  probeKey,
  primaryCardIds,
  taskCardId,
  type RowJudgements,
} from './schedule'
export {
  BASE_CONDITION_ID,
  baseConditionOf,
  itemKey,
  cardItems,
  compareItems,
  resolveDefault,
  itemStates,
  type CardItemRef,
  type DefaultResult,
  type ItemProbe,
  type ItemState,
  type ItemVariability,
} from './items'
export { natureVariants } from './natures'
export { judgementKey } from './key'
export { createLruCache } from './cache'
export { computeRowTask } from './rowTask'
export { assembleTab, createTabAssembler, type TabAssembler } from './assemble'
export { buildTabView } from './batch'
export { cellLabel } from './target'
export { bucketKey, resultBucket, sortByResult, type ResultBucket, type ResultSection, type SortMode } from './resultSort'
export {
  buildSpeedChart,
  customSpeedOpponent,
  ladderBaseSet,
  ladderSpeedOpponent,
  scarfConditionOf,
  speedKey,
  type LadderSpeedOpponent,
  type NatureSign,
  type SpeedBadge,
  type SpeedBadgeOrigin,
  type SpeedBundleOption,
  type SpeedChartInput,
  type SpeedChartModel,
  type SpeedCondition,
  type SpeedUnsupported,
} from './speedChart'
export {
  bundleLabel,
  bundleSpoken,
  compareInRow,
  focusAfterRemove,
  ladderRows,
  minSpToPass,
  navigate,
  speedBaseline,
  statusOf,
  visibleBadges,
  type LadderRow,
  type MinSp,
  type NavKey,
  type SpeedBaseline,
  type SpeedStatus,
} from './speedLadder'
