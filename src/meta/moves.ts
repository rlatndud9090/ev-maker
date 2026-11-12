// 메타 항목의 기술 사용률 순위(내 포켓몬 종을 바꿀 때 기술 칸 미리 채우기).
import type { MetaEntry } from '../data/meta-schema'
import type { Snapshot } from '../data/schema'

/**
 * 그 항목의 기술 사용률(moves.shares) 내림차순·동률은 id 순으로 최대 n개 기술 id. 변화기도 포함한다.
 * 게임 데이터에 없는 기술 id는 건너뛰고 다음 순위를 쓴다. 0 이하 사용률은 쓰지 않는다.
 */
export function topMoves(entry: MetaEntry, game: Snapshot, n: number): string[] {
  return Object.entries(entry.moves.shares)
    .filter(([id, share]) => share > 0 && Object.prototype.hasOwnProperty.call(game.data.moves, id))
    .sort(([a, x], [b, y]) => y - x || (a < b ? -1 : a > b ? 1 : 0))
    .slice(0, Math.max(0, n))
    .map(([id]) => id)
}
