// CoreError 코드 목록(types.ts)에 없는 입력 위반(대전 조건·랭크·현재 HP·상태이상·임계값 등)용 오류.
import { CoreError, type CoreErrorCode } from './types'

export class CoreInputError extends Error {
  readonly field: string
  constructor(field: string, message: string) {
    super(`${field}: ${message}`)
    this.name = 'CoreInputError'
    this.field = field
  }
}

export function coreError(code: CoreErrorCode, field: string, message: string): CoreError {
  return new CoreError([{ code, field, message }])
}

export const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** 프로토타입 키(__proto__ 등)를 걸러내는 own-key 조회. */
export const hasOwn = (obj: object, key: string): boolean => Object.prototype.hasOwnProperty.call(obj, key)

export function assertKnownKeys(obj: Record<string, unknown>, allowed: readonly string[], field: string): void {
  for (const k of Object.keys(obj)) {
    if (!allowed.includes(k)) throw new CoreInputError(`${field}.${k}`, '알 수 없는 필드다')
  }
}

export function optionalBoolean(v: unknown, field: string): boolean {
  if (v === undefined) return false
  if (typeof v !== 'boolean') throw new CoreInputError(field, `boolean이어야 한다(받은 값: ${String(v)})`)
  return v
}

export function integerInRange(v: unknown, min: number, max: number, field: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
    throw new CoreInputError(field, `${min}~${max} 정수여야 한다(받은 값: ${String(v)})`)
  }
  return v
}

export function oneOf<T extends string>(v: unknown, allowed: readonly T[], field: string): T {
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) {
    throw new CoreInputError(field, `${allowed.join('|')} 중 하나여야 한다(받은 값: ${String(v)})`)
  }
  return v as T
}
