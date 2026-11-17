# CyberTasks data model and schedule engine

One database is shared by every instance (Day view and Week view). It is stored with
WidgetSystem's `ctx.shared` under the key `db`, as plain JSON.

## Dates

- A **date key** is a local calendar date: `'YYYY-MM-DD'`.
- A **week key** is an ISO-8601 week: `'YYYY-Www'`, for example `'2026-W47'`. Weeks start on
  Monday, and the ISO week-year can differ from the calendar year at the year boundary.
- All date arithmetic works on date keys with UTC math (`Date.UTC`), so DST changes can't
  skip or repeat a day. Only `todayKey()` reads the local clock.

## Database

```js
{
  v: 1,
  items: [Item],
  done: { [occKey]: { at: epochMs } | { at: epochMs, skip: true } },
}
```

`occKey` identifies one occurrence: `` `${item.id}@${dateKey}` `` for day-scope items, and
`` `${item.id}@${weekKey}` `` for week-scope items. A one-off task is just an item whose single
occurrence is its date, so done-tracking works the same way for everything.

## Item

```js
{
  id: string,              // unique, e.g. 'i' + Date.now().toString(36) + random
  title: string,
  scope: 'day' | 'week',   // 'day': appears on dates. 'week': appears in a week's objectives
  repeat: Repeat,
  created: 'YYYY-MM-DD',   // recurring items never appear before this date (or before its week)
  until?: 'YYYY-MM-DD',    // optional inclusive end date
  paused?: boolean,        // paused items never occur
  order?: number,          // manual sort hint, ascending. Missing means after the ordered ones, in creation order
}
```

### Repeat, scope `'day'`

| repeat | occurs on |
|---|---|
| `{type:'once', date:'YYYY-MM-DD'}` | that date |
| `{type:'daily', every?: n}` | every n days counted from `created` (default 1) |
| `{type:'weekly', days:[1..7]}` | those ISO weekdays (1 = Mon ... 7 = Sun) |
| `{type:'monthly', day: 1..31 \| -1}` | that day of the month. `-1` = last day. If the month is shorter than `day`, the last day of the month |
| `{type:'yearly', month: 1..12, day: 1..31}` | that date every year. Feb 29 falls on Feb 28 in non-leap years |

### Repeat, scope `'week'`

| repeat | occurs in |
|---|---|
| `{type:'once', week:'YYYY-Www'}` | that week |
| `{type:'weekly', every?: n}` | every n weeks counted from the week containing `created` (default 1) |

## Carry-over (overdue)

When the Day view shows **today** with carry-over on, unfinished day-scope `once` items whose
date is before today also appear, flagged `overdue: true` with their `originDate`. Their
occurrence key stays the original date (`id@originDate`), so ticking them completes the
original task. Missed recurring occurrences don't carry over: they simply come back.

Skipped occurrences (`skip: true`) count as resolved: they are hidden from counts as done or
skipped and never carried over.

## Engine API: `src/schedule.js` (pure ESM, no DOM, no dependencies)

```js
// dates
todayKey(now = new Date()) -> 'YYYY-MM-DD'      // local date
addDays(dateKey, n) -> dateKey
isoWeekday(dateKey) -> 1..7
weekKey(dateKey) -> 'YYYY-Www'
weekDays(weekKey) -> [7 dateKeys, Mon..Sun]
addWeeks(weekKey, n) -> weekKey
daysInMonth(year, month) -> 28..31

// queries
occursOn(item, dateKey) -> boolean                 // day scope only (false for week items)
occursInWeek(item, weekKey) -> boolean             // week scope only
tasksForDay(db, dateKey, {today, carryOver = true}) -> [Entry]
tasksForWeek(db, weekKey) -> [Entry]               // week-scope objectives
weekOverview(db, weekKey, {today, carryOver}) -> {days: [{date, tasks: [Entry]}], objectives: [Entry]}
nextOccurrence(item, fromDateKey) -> dateKey | null  // first occurrence >= from, scanning up to 800 days
streak(db, item, todayKey) -> number                 // consecutive done occurrences going back from the
                                                     // latest occurrence <= today. If today's occurrence
                                                     // isn't done yet, start from the previous one.
                                                     // Skips neither break nor extend the streak
describeRepeat(item) -> string                     // short English: 'Every day', 'Every 2 days', 'Mon, Thu',
                                                   // 'Weekdays', 'Weekends', 'Monthly on the 15th', 'Monthly on the last day',
                                                   // 'Yearly on Mar 14', 'Once, Fri 20 Nov', 'Every week', 'Week 47'

// Entry = {item, key, date|week, done, skipped, overdue, originDate?, recurring}
// Ordering: by item.order, then created, then title. The UI decides where done items go.

// mutations (mutate db in place, return the affected item or entry)
emptyDb() -> db
addItem(db, {title, scope='day', repeat, created}) -> item  // fills id and created (default today)
updateItem(db, id, patch) -> item
removeItem(db, id)                                 // also deletes that item's done entries
setDone(db, key, done: boolean)                    // done=false removes the entry
skip(db, key)                                      // marks the occurrence {skip:true}
moveOnce(db, id, newDateKey)                       // once items only. Re-keys an existing done entry
prune(db, todayKey)                                // delete done entries older than 400 days, and
                                                   // once items done more than 30 days ago
validate(db) -> db                                 // repair or upgrade an unknown or partial db (never throws)
```
