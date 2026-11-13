import { describe, expect, it } from 'vitest'
import { DEFAULT_CACHE_LIMIT, createLruCache } from './cache'

const cells = (n: number) => [{ sp: n, category: String(n) }]

describe('createLruCache', () => {
  it('상한을 넘으면 가장 오래 쓰지 않은 항목부터 버리고, get은 최근 사용으로 올린다', () => {
    const c = createLruCache(2)
    c.set('a', cells(1))
    c.set('b', cells(2))
    expect(c.get('a')).toEqual(cells(1))
    c.set('c', cells(3))
    expect(c.get('b')).toBeUndefined()
    expect(c.get('a')).toEqual(cells(1))
    expect(c.get('c')).toEqual(cells(3))
    expect(c.size).toBe(2)
  })

  it('같은 키 set은 덮어쓰고 최근 사용으로 올린다, clear는 비운다', () => {
    const c = createLruCache(2)
    c.set('a', cells(1))
    c.set('b', cells(2))
    c.set('a', cells(9))
    c.set('c', cells(3))
    expect(c.get('a')).toEqual(cells(9))
    expect(c.get('b')).toBeUndefined()
    c.clear()
    expect(c.size).toBe(0)
  })

  it('기본 상한 5000, 1 미만·비정수 상한은 거부', () => {
    expect(DEFAULT_CACHE_LIMIT).toBe(5000)
    const c = createLruCache()
    for (let i = 0; i < DEFAULT_CACHE_LIMIT + 10; i++) c.set(String(i), cells(i))
    expect(c.size).toBe(DEFAULT_CACHE_LIMIT)
    expect(c.get('0')).toBeUndefined()
    expect(() => createLruCache(0)).toThrow()
    expect(() => createLruCache(1.5)).toThrow()
  })
})
