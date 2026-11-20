import type { ReactNode } from 'react'
import type { SpeedBranchLine, Tab } from '../../cards'
import { BASE_MARK_TEXT, branchLineSpoken, branchLineText, spShortText } from './lockText'
import './lockRow.css'

const shortTexts = (line: SpeedBranchLine): string[] =>
  [line.neutral, line.plus].flatMap((o) => (typeof o === 'object' && o !== null && o.budget.kind === 'short' ? [spShortText(o.budget.m)] : []))

/** 줄 글자 안 "SP 부족(m)"만 칩으로 */
function withShortChips(text: string, shorts: readonly string[]): ReactNode {
  const unique = [...new Set(shorts)]
  if (unique.length === 0) return text
  const out: ReactNode[] = []
  let rest = text
  for (;;) {
    const hits = unique.map((t) => ({ t, at: rest.indexOf(t) })).filter((h) => h.at >= 0)
    if (hits.length === 0) break
    const first = hits.reduce((a, b) => (b.at < a.at ? b : a))
    if (first.at > 0) out.push(rest.slice(0, first.at))
    out.push(
      <span key={out.length} className="lock-chip warn">
        {first.t}
      </span>,
    )
    rest = rest.slice(first.at + first.t.length)
  }
  if (rest !== '') out.push(rest)
  return out
}

/** 스피드 배지 상세의 갈래 줄 목록: "S12+일 때: …", 기준 갈래 줄에 "표 기준". 보이는 글자와 같은 내용의 읽기 이름을 따로 둔다 */
export function LockBranchList({ lines, tab }: { lines: readonly SpeedBranchLine[]; tab: Tab }) {
  return (
    <ul className="lock-branches" data-testid="lock-branches">
      {lines.map((line) => (
        <li key={line.branchId} className="lock-branch" data-testid="lock-branch" data-branch-id={line.branchId} data-base={line.isBase ? 'true' : undefined} data-status={line.status}>
          <span aria-hidden="true">
            {withShortChips(branchLineText(line, tab), shortTexts(line))}
            {line.isBase && <span className="lock-base-mark">{BASE_MARK_TEXT}</span>}
          </span>
          <span className="sr-only">{branchLineSpoken(line, tab)}</span>
        </li>
      ))}
    </ul>
  )
}
