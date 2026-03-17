import { describe, it, expect } from 'vitest'

// ─── Inline copies of pure time-parsing functions from useBoard.ts ──

/** Parse a human-readable duration string (e.g. "8h", "2d", "1.5h") to minutes. */
function parseDuration(s: string | undefined): number {
  if (!s) return 0
  const m = s.trim().match(/^(\d+(?:\.\d+)?)\s*(m|min|h|d|w)?$/i)
  if (!m) return 0
  const val = parseFloat(m[1])
  switch ((m[2] || 'h').toLowerCase()) {
    case 'm': case 'min': return val
    case 'h': return val * 60
    case 'd': return val * 60 * 8 // 8h workday
    case 'w': return val * 60 * 40 // 5d workweek
    default: return val * 60
  }
}

/** Format minutes to a human-readable duration string. */
function formatDuration(minutes: number): string {
  if (minutes <= 0) return '0h'
  if (minutes < 60) return `${Math.round(minutes)}m`
  if (minutes < 480) return `${(minutes / 60).toFixed(1).replace(/\.0$/, '')}h`
  return `${(minutes / 480).toFixed(1).replace(/\.0$/, '')}d`
}

/** Add duration to an existing duration string (e.g. "4h" + "2h" = "6h"). */
function addDuration(existing: string | undefined, addition: string): string {
  const total = parseDuration(existing) + parseDuration(addition)
  return formatDuration(total)
}

// ─── parseDuration Tests ────────────────────────────────────────

describe('parseDuration', () => {
  describe('hours', () => {
    it('parses "8h" → 480 minutes', () => expect(parseDuration('8h')).toBe(480))
    it('parses "1h" → 60 minutes', () => expect(parseDuration('1h')).toBe(60))
    it('parses "0.5h" → 30 minutes', () => expect(parseDuration('0.5h')).toBe(30))
    it('parses "1.5h" → 90 minutes', () => expect(parseDuration('1.5h')).toBe(90))
    it('parses "24h" → 1440 minutes', () => expect(parseDuration('24h')).toBe(1440))
  })

  describe('days (8h workday)', () => {
    it('parses "1d" → 480 minutes', () => expect(parseDuration('1d')).toBe(480))
    it('parses "2d" → 960 minutes', () => expect(parseDuration('2d')).toBe(960))
    it('parses "0.5d" → 240 minutes', () => expect(parseDuration('0.5d')).toBe(240))
    it('parses "5d" → 2400 minutes', () => expect(parseDuration('5d')).toBe(2400))
  })

  describe('weeks (40h workweek)', () => {
    it('parses "1w" → 2400 minutes', () => expect(parseDuration('1w')).toBe(2400))
    it('parses "2w" → 4800 minutes', () => expect(parseDuration('2w')).toBe(4800))
  })

  describe('minutes', () => {
    it('parses "30m" → 30', () => expect(parseDuration('30m')).toBe(30))
    it('parses "90min" → 90', () => expect(parseDuration('90min')).toBe(90))
    it('parses "15m" → 15', () => expect(parseDuration('15m')).toBe(15))
  })

  describe('bare numbers default to hours', () => {
    it('parses "4" → 240 minutes (4h)', () => expect(parseDuration('4')).toBe(240))
    it('parses "1" → 60 minutes (1h)', () => expect(parseDuration('1')).toBe(60))
  })

  describe('edge cases', () => {
    it('returns 0 for undefined', () => expect(parseDuration(undefined)).toBe(0))
    it('returns 0 for empty string', () => expect(parseDuration('')).toBe(0))
    it('returns 0 for garbage', () => expect(parseDuration('abc')).toBe(0))
    it('returns 0 for negative-looking input', () => expect(parseDuration('-1h')).toBe(0))
    it('trims whitespace', () => expect(parseDuration('  4h  ')).toBe(240))
    it('handles "0h"', () => expect(parseDuration('0h')).toBe(0))
    it('handles "0d"', () => expect(parseDuration('0d')).toBe(0))
  })

  describe('case insensitivity', () => {
    it('parses "8H" → 480', () => expect(parseDuration('8H')).toBe(480))
    it('parses "2D" → 960', () => expect(parseDuration('2D')).toBe(960))
    it('parses "1W" → 2400', () => expect(parseDuration('1W')).toBe(2400))
    it('parses "30M" → 30', () => expect(parseDuration('30M')).toBe(30))
    it('parses "90MIN" → 90', () => expect(parseDuration('90MIN')).toBe(90))
  })
})

// ─── formatDuration Tests ───────────────────────────────────────

describe('formatDuration', () => {
  describe('zero and negative', () => {
    it('formats 0 → "0h"', () => expect(formatDuration(0)).toBe('0h'))
    it('formats -10 → "0h"', () => expect(formatDuration(-10)).toBe('0h'))
  })

  describe('minutes range (< 60)', () => {
    it('formats 30 → "30m"', () => expect(formatDuration(30)).toBe('30m'))
    it('formats 1 → "1m"', () => expect(formatDuration(1)).toBe('1m'))
    it('formats 59 → "59m"', () => expect(formatDuration(59)).toBe('59m'))
    it('formats 45.6 → "46m" (rounds)', () => expect(formatDuration(45.6)).toBe('46m'))
  })

  describe('hours range (60 ≤ min < 480)', () => {
    it('formats 60 → "1h"', () => expect(formatDuration(60)).toBe('1h'))
    it('formats 120 → "2h"', () => expect(formatDuration(120)).toBe('2h'))
    it('formats 90 → "1.5h"', () => expect(formatDuration(90)).toBe('1.5h'))
    it('formats 360 → "6h"', () => expect(formatDuration(360)).toBe('6h'))
    it('formats 240 → "4h"', () => expect(formatDuration(240)).toBe('4h'))
    it('formats 420 → "7h"', () => expect(formatDuration(420)).toBe('7h'))
    it('formats 479 → still hours', () => expect(formatDuration(479)).toMatch(/h$/))
  })

  describe('days range (≥ 480)', () => {
    // NOTE: 480 minutes = 8 hours = 1 workday. The code uses strict < 480,
    // so exactly 480 formats as "1d" (days) rather than "8h" (hours).
    // This is a boundary design decision — document and verify.
    it('formats 480 → "1d"', () => expect(formatDuration(480)).toBe('1d'))
    it('formats 960 → "2d"', () => expect(formatDuration(960)).toBe('2d'))
    it('formats 2400 → "5d"', () => expect(formatDuration(2400)).toBe('5d'))
    it('formats 720 → "1.5d"', () => expect(formatDuration(720)).toBe('1.5d'))
  })
})

// ─── addDuration Tests ──────────────────────────────────────────

describe('addDuration', () => {
  it('"4h" + "2h" → "6h"', () => expect(addDuration('4h', '2h')).toBe('6h'))
  it('"1d" + "4h" → "1.5d"', () => expect(addDuration('1d', '4h')).toBe('1.5d'))
  it('undefined + "2h" → "2h"', () => expect(addDuration(undefined, '2h')).toBe('2h'))
  it('"30m" + "30m" → "1h"', () => expect(addDuration('30m', '30m')).toBe('1h'))
  it('"7h" + "1h" → "1d"', () => expect(addDuration('7h', '1h')).toBe('1d'))
  it('"0h" + "0h" → "0h"', () => expect(addDuration('0h', '0h')).toBe('0h'))
  it('"2d" + "1d" → "3d"', () => {
    // 2d = 960, 1d = 480, total = 1440 → 1440/480 = 3 → "3d"
    expect(addDuration('2d', '1d')).toBe('3d')
  })
  it('"1h" + "30m" → "1.5h"', () => expect(addDuration('1h', '30m')).toBe('1.5h'))
})

// ─── Round-trip consistency ─────────────────────────────────────

describe('parseDuration ↔ formatDuration round-trip', () => {
  const cases = ['1h', '2h', '4h', '30m', '1d', '2d', '1.5h', '1.5d']
  for (const input of cases) {
    it(`round-trips "${input}"`, () => {
      const minutes = parseDuration(input)
      const formatted = formatDuration(minutes)
      const reparsed = parseDuration(formatted)
      expect(reparsed).toBe(minutes)
    })
  }
})
