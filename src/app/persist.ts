// 파티·전역 상대 목록의 브라우저 저장(키 하나, 형식 버전). 읽기는 검증 실패·저장소 예외면 버리고 null.
import { useEffect, useMemo, useRef, type Dispatch } from 'react'
import type { Snapshot } from '../data/schema'
import { STAT_IDS } from '../core'
import { namesOf } from '../ui/names'
import { BOOST_STATS, MOVE_SLOTS, type SetDraft } from '../ui/setDraft'
import { PARTY_SIZE, isPartyIndex, partySlices, type PartyGlobals, type PartyHydration, type SlotSlice } from './party'
import type { AppAction, AppState } from './state'

export const STORAGE_KEY = 'ev-maker:party'
export const VERSION = 1
export const SAVE_DELAY_MS = 300

export interface PersistedParty extends PartyHydration {
  version: typeof VERSION
  /** 저장 당시 레귤레이션 id */
  regulation: string
  /** 길이 PARTY_SIZE, 활성 자리 포함(활성 칸 조각을 반영) */
  slots: readonly (SlotSlice | null)[]
  globals: PartyGlobals
}

/** 저장에 쓰는 상태 부분(스피드 차트는 추가 목록만) */
export type PersistSource = Pick<
  AppState,
  | 'regulation'
  | 'party'
  | 'draft'
  | 'draftCache'
  | 'moveChoices'
  | 'locks'
  | 'lockSeq'
  | 'lockBase'
  | 'lockNature'
  | 'lockSpTotal'
  | 'customTargets'
  | 'addedBundles'
  | 'addedMoves'
  | 'pinnedBundles'
> & { speedChart: Pick<AppState['speedChart'], 'added'> }

export function serialize(state: PersistSource): PersistedParty {
  return {
    version: VERSION,
    regulation: state.regulation,
    slots: partySlices(state),
    active: state.party.active,
    globals: {
      customTargets: state.customTargets,
      addedBundles: state.addedBundles,
      addedMoves: state.addedMoves,
      pinnedBundles: state.pinnedBundles,
      speedAdded: state.speedChart.added,
    },
  }
}

// ---- 모양 검사 ----

type Rec = Record<string, unknown>
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v)
const isStr = (v: unknown): v is string => typeof v === 'string'
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isStrOrNull = (v: unknown): boolean => v === null || isStr(v)
const isNumOrNull = (v: unknown): boolean => v === null || isNum(v)
const strTable = (v: unknown, keys: readonly string[]): boolean => isRec(v) && keys.every((k) => isStr(v[k]))
const arrayOf = (v: unknown, item: (x: unknown) => boolean): boolean => Array.isArray(v) && v.every(item)
const oneOf = (v: unknown, values: readonly unknown[]): boolean => values.includes(v)

const STATUSES = ['none', 'par', 'brn', 'psn', 'tox', 'slp', 'frz'] as const
const LOCK_STAGES = ['guaranteed-ohko', 'high-roll-ohko', 'guaranteed-survive', 'low-roll-ohko', 'first'] as const

function isDraft(v: unknown): v is SetDraft {
  return (
    isRec(v) &&
    isStr(v.species) &&
    isStr(v.ability) &&
    isStr(v.item) &&
    isStr(v.nature) &&
    (v.natureMinusAuto === undefined || typeof v.natureMinusAuto === 'boolean') &&
    strTable(v.sp, STAT_IDS) &&
    Array.isArray(v.moves) &&
    v.moves.length === MOVE_SLOTS &&
    arrayOf(v.moves, isStr) &&
    typeof v.mega === 'boolean' &&
    oneOf(v.status, STATUSES) &&
    strTable(v.boosts, BOOST_STATS)
  )
}

/** 공격·방어 고정 타깃(cards LockTargetKey)의 필드 타입 */
function isDamageTarget(t: Rec): boolean {
  const b = t.bundle
  return (
    oneOf(t.source, ['ladder', 'custom']) &&
    isStrOrNull(t.category) &&
    isRec(b) &&
    (isStr(b.ladder) || isNum(b.preset) || isStr(b.added)) &&
    isStrOrNull(t.item) &&
    isStr(t.itemKey)
  )
}

/** 스피드 고정 타깃의 필드 타입 */
function isSpeedTarget(t: Rec): boolean {
  const b = t.bundle
  return oneOf(t.origin, ['ladder', 'added', 'preset']) && isRec(b) && ((isNum(b.sp) && isStr(b.nature)) || isNum(b.preset)) && isStr(t.condition) && isStrOrNull(t.filterKind)
}

function isLock(v: unknown): boolean {
  if (!isRec(v) || !isNum(v.seq) || !oneOf(v.stage, LOCK_STAGES) || !arrayOf(v.stats, (s) => oneOf(s, STAT_IDS))) return false
  // 방어 쌍 배분(cards CutLock.allocation): 방어 고정에만, 'h-max'만
  if (v.allocation !== undefined && !(v.kind === 'defense' && v.allocation === 'h-max')) return false
  const t = v.target
  if (!isRec(t) || t.kind !== v.kind || !isStr(t.opponentId)) return false
  if (t.kind === 'speed') return isSpeedTarget(t)
  return (t.kind === 'attack' || t.kind === 'defense') && isDamageTarget(t)
}

const isMoveChoice = (v: unknown): boolean => isRec(v) && isStr(v.tab) && isStr(v.source) && isStr(v.opponentId) && isStr(v.key)

function isSlice(v: unknown): v is SlotSlice {
  return (
    isRec(v) &&
    isDraft(v.draft) &&
    isRec(v.draftCache) &&
    Object.values(v.draftCache).every(isDraft) &&
    arrayOf(v.moveChoices, isMoveChoice) &&
    arrayOf(v.locks, isLock) &&
    isNum(v.lockSeq) &&
    isStrOrNull(v.lockBase) &&
    (v.lockNature === null || (isRec(v.lockNature) && isStr(v.lockNature.nature))) &&
    isNumOrNull(v.lockSpTotal)
  )
}

const hasOpponent = (v: unknown): boolean => isRec(v) && isStr(v.opponentId)

function isGlobals(v: unknown): v is PartyGlobals {
  return (
    isRec(v) &&
    arrayOf(v.customTargets, (t) => isRec(t) && isStr(t.rosterId) && arrayOf(t.moves, isStr) && isRec(t.edits)) &&
    arrayOf(v.addedBundles, (b) => hasOpponent(b) && isRec((b as Rec).sp)) &&
    arrayOf(v.addedMoves, (m) => hasOpponent(m) && isStr((m as Rec).moveId)) &&
    arrayOf(v.pinnedBundles, (p) => hasOpponent(p) && isStr((p as Rec).key)) &&
    arrayOf(v.speedAdded, (s) => hasOpponent(s) && isNum((s as Rec).sp))
  )
}

function isPersisted(v: unknown): v is PersistedParty {
  return (
    isRec(v) &&
    v.version === VERSION &&
    isStr(v.regulation) &&
    isPartyIndex(v.active) &&
    Array.isArray(v.slots) &&
    v.slots.length === PARTY_SIZE &&
    v.slots.every((s) => s === null || isSlice(s)) &&
    isGlobals(v.globals)
  )
}

// ---- 이름 정리 ----

/** 현재 스냅샷 이름 색인으로 풀리지 않는 도구·기술·특성을 비운다(성격은 무보정). 종이 있는데 풀리지 않으면 null */
function cleanDraft(draft: SetDraft, game: Snapshot): SetDraft | null {
  const names = namesOf(game)
  const keep = (text: string, ok: (t: string) => boolean) => (text.trim() === '' || ok(text) ? text : '')
  if (draft.species.trim() !== '' && names.species.resolve(draft.species) === undefined) return null
  return {
    ...draft,
    item: keep(draft.item, (t) => names.items.resolve(t) !== undefined),
    ability: keep(draft.ability, (t) => names.abilities.resolve(t) !== undefined),
    nature: names.natures.resolve(draft.nature) !== undefined ? draft.nature : 'hardy',
    moves: draft.moves.map((m) => keep(m, (t) => names.moves.resolve(t) !== undefined)),
  }
}

function cleanSlice(slice: SlotSlice, game: Snapshot): SlotSlice | null {
  const draft = cleanDraft(slice.draft, game)
  if (draft === null) return null
  const draftCache: Record<string, SetDraft> = {}
  for (const [id, d] of Object.entries(slice.draftCache)) {
    if (!Object.prototype.hasOwnProperty.call(game.data.species, id)) continue
    const cleaned = cleanDraft(d, game)
    if (cleaned !== null) draftCache[id] = cleaned
  }
  return { ...slice, draft, draftCache }
}

// ---- 저장소 ----

export type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

/** 버전·모양 검사를 통과한 저장 파티(세트는 현재 스냅샷 기준으로 정리). 없음·실패·예외면 null */
export function loadPersisted(storage: StorageLike | null, game: Snapshot): PersistedParty | null {
  try {
    const raw = storage?.getItem(STORAGE_KEY)
    if (raw === null || raw === undefined) return null
    const parsed: unknown = JSON.parse(raw)
    if (!isPersisted(parsed)) return null
    return { ...parsed, slots: parsed.slots.map((s) => (s === null ? null : cleanSlice(s, game))) }
  } catch {
    return null
  }
}

export function savePersisted(storage: StorageLike | null, state: PersistSource): void {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(serialize(state)))
  } catch {
    // 저장소가 막히거나 가득 차도 메모리로만 동작한다
  }
}

export function browserStorage(): StorageLike | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

/** 마운트 때 한 번 복원하고, 이후 저장 대상이 바뀌면 SAVE_DELAY_MS 묶어 저장한다(페이지를 떠날 때 대기분을 바로 쓴다) */
export function usePartyPersistence(state: AppState, dispatch: Dispatch<AppAction>, game: Snapshot): void {
  const loaded = useRef(false)
  useEffect(() => {
    if (loaded.current) return
    loaded.current = true
    const saved = loadPersisted(browserStorage(), game)
    if (saved !== null) dispatch({ type: 'party-hydrate', saved })
  }, [dispatch, game])

  const { regulation, party, draft, draftCache, moveChoices, locks, lockSeq, lockBase, lockNature, lockSpTotal } = state
  const { customTargets, addedBundles, addedMoves, pinnedBundles } = state
  const speedAdded = state.speedChart.added
  const source = useMemo<PersistSource>(
    () => ({
      regulation,
      party,
      draft,
      draftCache,
      moveChoices,
      locks,
      lockSeq,
      lockBase,
      lockNature,
      lockSpTotal,
      customTargets,
      addedBundles,
      addedMoves,
      pinnedBundles,
      speedChart: { added: speedAdded },
    }),
    [regulation, party, draft, draftCache, moveChoices, locks, lockSeq, lockBase, lockNature, lockSpTotal, customTargets, addedBundles, addedMoves, pinnedBundles, speedAdded],
  )

  // 첫 렌더의 기본 상태는 복원 전이라 저장하지 않는다
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    const flush = () => savePersisted(browserStorage(), source)
    const timer = setTimeout(flush, SAVE_DELAY_MS)
    window.addEventListener('pagehide', flush)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('pagehide', flush)
    }
  }, [source])
}
