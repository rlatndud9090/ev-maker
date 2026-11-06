// 수용 테스트 전용 독립 산술. 계산 코어·엔진을 import하지 않는다(대조 대상과 출처를 분리).
// 9세대 대미지 공식(레벨 50). 범위: 단일 보정(범위기·자속·상성·최종 보정 1개)만.

export const pokeRound = (n: number) => (n % 1 > 0.5 ? Math.ceil(n) : Math.floor(n))

/** mult10: 성격 보정 × 10(9·10·11) */
export function oracleStat(stat: 'hp' | 'other', base: number, sp: number, mult10: 9 | 10 | 11 = 10): number {
  if (stat === 'hp') return base === 1 ? 1 : base + sp + 75
  return Math.floor(((base + sp + 20) * mult10) / 10)
}

export interface OracleDamageInput {
  power: number
  attack: number
  defense: number
  spread?: boolean
  stab?: boolean
  effectiveness: number
  /** 최종 보정(4096 기준), 예: 멀티스케일 2048 */
  finalMod?: number
}

/** 16단계 난수(r = 85~100) 대미지 */
export function oracleRolls(i: OracleDamageInput): number[] {
  let base = Math.floor(Math.floor((22 * i.power * i.attack) / i.defense) / 50) + 2
  if (i.spread) base = pokeRound((base * 3072) / 4096)
  const out: number[] = []
  for (let r = 85; r <= 100; r++) {
    let d = Math.floor((base * r) / 100)
    if (i.stab) d = pokeRound((d * 6144) / 4096)
    d = Math.floor(d * i.effectiveness)
    if (i.finalMod !== undefined) d = pokeRound((d * i.finalMod) / 4096)
    out.push(Math.max(1, d))
  }
  return out
}

/** 16개 중 hp 이상인 개수 ÷ 16 */
export const oracleOhko = (rolls: number[], hp: number) => rolls.filter((d) => d >= hp).length / 16
