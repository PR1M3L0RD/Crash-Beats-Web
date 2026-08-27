const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000

export function getMondayUtcWeekKey(value = new Date()) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value)
  if (!Number.isFinite(date.getTime())) throw new TypeError('A valid date is required.')

  const daysSinceMonday = (date.getUTCDay() + 6) % 7
  const monday = new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate() - daysSinceMonday,
  ))
  return monday.toISOString().slice(0, 10)
}

export function millisecondsUntilNextMondayUtc(value = new Date()) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value)
  if (!Number.isFinite(date.getTime())) throw new TypeError('A valid date is required.')

  const currentMonday = new Date(`${getMondayUtcWeekKey(date)}T00:00:00.000Z`)
  return Math.max(0, currentMonday.getTime() + (7 * DAY_IN_MILLISECONDS) - date.getTime())
}
