/** SP 한 칸 값인지: 0 이상 spMax 이하 정수 */
export function isSpValue(v: unknown, spMax: number): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= spMax
}
