export const POKEMON_ICON_SOURCE: Readonly<{ repo: string; commit: string; dir: string }>
export function pokemonIconUrl(src: number | string): string
export const HAND_POKEAPI_IDS: Readonly<Record<string, number>>
export const KNOWN_SAME_IMAGE: readonly (readonly string[])[]

export interface RosterSpecies {
  id: string
  num: number
  name?: string
  baseSpecies?: string
  isMega: boolean
}

export interface Resolution {
  resolved: Record<string, { pokeapiId: number; src: string; via: 'hand' | 'form' | 'num' }>
  unresolved: { id: string; reason: string }[]
}

export function resolvePokeapiIds(
  species: readonly RosterSpecies[],
  forms: readonly { identifier: string; pokemon_id: string; form_identifier?: string; is_default?: string }[],
  hand?: Readonly<Record<string, number>>,
): Resolution

export function bagSpriteFile(englishName: string): string
export const BULBA_CATEGORY: string
export function bulbaFilePathUrl(file: string): string
export function bulbaImageInfoUrl(files: readonly string[]): string
export function parseBulbaImageInfo(json: unknown): Record<string, { timestamp: string; sha1: string; url: string }>
export function needsDownload(args: {
  force: boolean
  prev: Readonly<Record<string, unknown>> | undefined
  want: string
  wantKey: string
  sha: string | undefined
}): boolean
export function sameImageGroups(
  entries: Readonly<Record<string, { sha256: string }>>,
  known?: readonly (readonly string[])[],
): { known: string[][]; unexpected: string[][] }
export const ITEM_ICON_IDS: readonly string[]

export function rosterOf(
  snapshots: readonly { species: Record<string, { num: number; name?: { en?: string }; baseSpecies?: string; isMega?: boolean }> }[],
  metaIds?: readonly string[],
): { species: RosterSpecies[]; missingMeta: string[] }
