/**
 * CyberTasks schedule engine (spec: docs/DATA_MODEL.md).
 *
 * Pure ES module: no DOM, no dependencies. Every date computation converts
 * 'YYYY-MM-DD' keys to UTC day numbers, so DST can never skip or repeat a day.
 * Only todayKey() reads the local clock (prune() also uses it, to turn the
 * `at` timestamps it was given into local dates).
 *
 * Error policy:
 * - Functions that take a date key or week key argument throw on a malformed key.
 * - Functions that take items never throw on a malformed item. The item just
 *   doesn't occur, so an unvalidated db can't crash a view.
 * - addItem / updateItem / moveOnce throw a descriptive Error on invalid input
 *   and leave the db unchanged.
 * - validate() never throws.
 */

const DAY_MS = 86_400_000;
const SCAN_DAYS = 800; // nextOccurrence look-ahead
const KEEP_DONE_DAYS = 400; // prune: done entries older than this go
const KEEP_ONCE_DAYS = 30; // prune: one-off items resolved longer ago than this go

const WEEKDAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const ITEM_FIELDS = new Set(['id', 'title', 'scope', 'repeat', 'created', 'until', 'paused', 'order']);

const pad = (n, width = 2) => String(n).padStart(width, '0');
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const show = (v) => (typeof v === 'string' ? `'${v}'` : typeof v === 'number' ? String(v) : `<${typeof v}>`);
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// ---------------------------------------------------------------------------
// Date keys <-> UTC day numbers (days since 1970-01-01)

function isLeapYear(y) {
  return y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
}

/** {y, m, d} for a real calendar date 'YYYY-MM-DD', otherwise null. */
function parseDate(key) {
  const m = typeof key === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(key) : null;
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  return mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo) ? { y, m: mo, d } : null;
}

function requireDate(key) {
  const p = parseDate(key);
  if (!p) throw new Error(`Invalid date key ${show(key)}, expected 'YYYY-MM-DD'`);
  return p;
}

function dayNumber({ y, m, d }) {
  const t = new Date(0);
  t.setUTCFullYear(y, m - 1, d); // unlike Date.UTC, this keeps years 0..99 as written
  return Math.round(t.getTime() / DAY_MS);
}

function dateKeyOf(n) {
  const t = new Date(n * DAY_MS);
  return `${pad(t.getUTCFullYear(), 4)}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** ISO weekday 1..7 of day number n (day 0, 1970-01-01, was a Thursday). */
function weekdayOf(n) {
  return (((n + 3) % 7) + 7) % 7 + 1;
}

/** Day number of the Monday starting the ISO week that contains day n. */
function mondayOf(n) {
  return n - weekdayOf(n) + 1;
}

/** ISO week {y, w} of day n. A week belongs to the year that holds its Thursday. */
function isoWeekOf(n) {
  const thursday = mondayOf(n) + 3;
  const y = new Date(thursday * DAY_MS).getUTCFullYear();
  return { y, w: Math.floor((thursday - dayNumber({ y, m: 1, d: 1 })) / 7) + 1 };
}

function formatWeek({ y, w }) {
  return `${pad(y, 4)}-W${pad(w)}`;
}

/** 52 or 53. Dec 28 always lies in the last ISO week of its year. */
function weeksInYear(y) {
  return isoWeekOf(dayNumber({ y, m: 12, d: 28 })).w;
}

/** {y, w} for a valid 'YYYY-Www' (w within that year's 52/53 weeks), otherwise null. */
function parseWeek(key) {
  const m = typeof key === 'string' ? /^(\d{4})-W(\d{2})$/.exec(key) : null;
  if (!m) return null;
  const y = +m[1], w = +m[2];
  return w >= 1 && w <= weeksInYear(y) ? { y, w } : null;
}

function requireWeek(key) {
  const p = parseWeek(key);
  if (!p) throw new Error(`Invalid week key ${show(key)}, expected 'YYYY-Www'`);
  return p;
}

/** Day number of the Monday of ISO week {y, w}. Week 1 is the week containing Jan 4. */
function weekStart({ y, w }) {
  return mondayOf(dayNumber({ y, m: 1, d: 4 })) + (w - 1) * 7;
}

function requireInt(n, fn) {
  if (!Number.isInteger(n)) throw new Error(`${fn}: n must be an integer, got ${show(n)}`);
}

// ---------------------------------------------------------------------------
// Dates (public)

/** Local calendar date of `now` as 'YYYY-MM-DD'. The only reader of the local clock. */
export function todayKey(now = new Date()) {
  const d = now instanceof Date ? now : new Date(now);
  return `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function addDays(dateKey, n) {
  requireInt(n, 'addDays');
  return dateKeyOf(dayNumber(requireDate(dateKey)) + n);
}

/** 1 = Monday ... 7 = Sunday. */
export function isoWeekday(dateKey) {
  return weekdayOf(dayNumber(requireDate(dateKey)));
}

/** ISO-8601 week key, e.g. '2026-W47'. The year is the ISO week-year. */
export function weekKey(dateKey) {
  return formatWeek(isoWeekOf(dayNumber(requireDate(dateKey))));
}

/** The 7 date keys of an ISO week, Monday first. */
export function weekDays(wk) {
  const start = weekStart(requireWeek(wk));
  return Array.from({ length: 7 }, (_, i) => dateKeyOf(start + i));
}

export function addWeeks(wk, n) {
  requireInt(n, 'addWeeks');
  return formatWeek(isoWeekOf(weekStart(requireWeek(wk)) + 7 * n));
}

/** month is 1..12. */
export function daysInMonth(year, month) {
  return month === 2 && isLeapYear(year) ? 29 : MONTH_DAYS[month - 1];
}

// ---------------------------------------------------------------------------
// Occurrence rules

const everyOf = (r) => (Number.isInteger(r.every) && r.every >= 1 ? r.every : 1);

/** Shaped like an item well enough to evaluate, and not paused. */
function isActive(item) {
  return isObject(item) && isObject(item.repeat) && !item.paused;
}

/** Day n is after the item's inclusive `until`. */
function pastUntil(item, n) {
  const u = parseDate(item.until);
  return u !== null && n > dayNumber(u);
}

/** Day-scope items only. Recurring items start at `created`; nothing occurs after `until`. */
export function occursOn(item, dateKey) {
  if (!isActive(item) || item.scope === 'week') return false;
  const p = parseDate(dateKey);
  if (!p) return false;
  const n = dayNumber(p);
  if (pastUntil(item, n)) return false;
  const r = item.repeat;
  if (r.type === 'once') return r.date === dateKey;
  const created = parseDate(item.created);
  if (!created || n < dayNumber(created)) return false;
  switch (r.type) {
    case 'daily':
      return (n - dayNumber(created)) % everyOf(r) === 0;
    case 'weekly':
      return Array.isArray(r.days) && r.days.includes(weekdayOf(n));
    case 'monthly': {
      const last = daysInMonth(p.y, p.m);
      return p.d === (r.day === -1 ? last : Math.min(r.day, last));
    }
    case 'yearly': // Feb 29 lands on Feb 28 in non-leap years
      return p.m === r.month && p.d === Math.min(r.day, daysInMonth(p.y, r.month));
    default:
      return false;
  }
}

/**
 * Week-scope items only. A recurring item starts at the ISO week containing
 * `created`, and `every` counts from that week. With `until`, the week that
 * contains `until` is the last one.
 */
export function occursInWeek(item, wk) {
  if (!isActive(item) || item.scope !== 'week') return false;
  const w = parseWeek(wk);
  if (!w) return false;
  const start = weekStart(w);
  if (pastUntil(item, start)) return false;
  const r = item.repeat;
  if (r.type === 'once') return r.week === wk;
  if (r.type !== 'weekly') return false;
  const created = parseDate(item.created);
  if (!created) return false;
  const weeks = (start - mondayOf(dayNumber(created))) / 7;
  return weeks >= 0 && weeks % everyOf(r) === 0;
}

// ---------------------------------------------------------------------------
// Queries

const itemsOf = (db) => (isObject(db) && Array.isArray(db.items) ? db.items : []);
const recordOf = (db, key) => (isObject(db) && isObject(db.done) && db.done[key]) || null;

function makeEntry(db, item, key, place, originDate) {
  const rec = recordOf(db, key);
  const entry = {
    item,
    key,
    ...place,
    done: !!rec && !rec.skip,
    skipped: !!rec && !!rec.skip,
    overdue: originDate !== undefined,
  };
  if (originDate !== undefined) entry.originDate = originDate;
  entry.recurring = item.repeat.type !== 'once';
  return entry;
}

/** item.order ascending (missing order last), then created, then title (case-insensitive), then id. */
function compareItems(a, b) {
  const oa = Number.isFinite(a.order) ? a.order : Infinity;
  const ob = Number.isFinite(b.order) ? b.order : Infinity;
  if (oa !== ob) return oa < ob ? -1 : 1;
  const ta = String(a.title ?? ''), tb = String(b.title ?? '');
  return (
    cmp(String(a.created ?? ''), String(b.created ?? '')) ||
    cmp(ta.toLowerCase(), tb.toLowerCase()) ||
    cmp(ta, tb) ||
    cmp(String(a.id ?? ''), String(b.id ?? ''))
  );
}

const compareEntries = (x, y) => compareItems(x.item, y.item) || cmp(x.key, y.key);

/**
 * Entries for one day. When dateKey === opts.today and carryOver isn't false,
 * unfinished day-scope once items from earlier dates are added with
 * overdue: true. Their `date` is the day shown, `originDate` is their own
 * date, and their key stays `${id}@${originDate}`. Each item appears at most once.
 */
export function tasksForDay(db, dateKey, opts) {
  requireDate(dateKey);
  const { today, carryOver = true } = opts || {};
  const seen = new Set();
  const entries = [];
  for (const item of itemsOf(db)) {
    if (!occursOn(item, dateKey) || seen.has(item.id)) continue;
    seen.add(item.id);
    entries.push(makeEntry(db, item, `${item.id}@${dateKey}`, { date: dateKey }));
  }
  if (dateKey === today && carryOver !== false) {
    for (const item of itemsOf(db)) {
      if (!isActive(item) || item.scope === 'week' || item.repeat.type !== 'once') continue;
      const origin = item.repeat.date;
      const key = `${item.id}@${origin}`;
      // Done or skipped once items are resolved and never carry over.
      if (seen.has(item.id) || !occursOn(item, origin) || !(origin < dateKey) || recordOf(db, key)) continue;
      seen.add(item.id);
      entries.push(makeEntry(db, item, key, { date: dateKey }, origin));
    }
  }
  return entries.sort(compareEntries);
}

/** Week-scope objectives for one ISO week. No carry-over. */
export function tasksForWeek(db, wk) {
  requireWeek(wk);
  const seen = new Set();
  const entries = [];
  for (const item of itemsOf(db)) {
    if (!occursInWeek(item, wk) || seen.has(item.id)) continue;
    seen.add(item.id);
    entries.push(makeEntry(db, item, `${item.id}@${wk}`, { week: wk }));
  }
  return entries.sort(compareEntries);
}

/** Carry-over only shows on the day equal to opts.today, if that day is in this week. */
export function weekOverview(db, wk, opts) {
  return {
    days: weekDays(wk).map((date) => ({ date, tasks: tasksForDay(db, date, opts) })),
    objectives: tasksForWeek(db, wk),
  };
}

/**
 * First occurrence on or after fromDateKey, scanning 800 days, otherwise null.
 * For a week-scope item, the result is the Monday of the first occurring week,
 * starting with the week that contains fromDateKey (so it can be a few days
 * before fromDateKey).
 */
export function nextOccurrence(item, fromDateKey) {
  const from = dayNumber(requireDate(fromDateKey));
  if (!isActive(item)) return null;
  if (item.scope === 'week') {
    for (let start = mondayOf(from); start < from + SCAN_DAYS; start += 7) {
      if (occursInWeek(item, formatWeek(isoWeekOf(start)))) return dateKeyOf(start);
    }
    return null;
  }
  for (let n = from; n < from + SCAN_DAYS; n++) {
    const key = dateKeyOf(n);
    if (occursOn(item, key)) return key;
  }
  return null;
}

/** Day number (or week-start day number) of the earliest slot the item could occupy. */
function firstSlot(item) {
  const r = item.repeat;
  const week = item.scope === 'week';
  if (r.type === 'once') {
    const p = week ? parseWeek(r.week) : parseDate(r.date);
    return p ? (week ? weekStart(p) : dayNumber(p)) : null;
  }
  const c = parseDate(item.created);
  return c ? (week ? mondayOf(dayNumber(c)) : dayNumber(c)) : null;
}

/**
 * Consecutive done occurrences going back from the latest occurrence <= today
 * (for week items: <= the current week). An occurrence on today that isn't
 * resolved yet is passed over instead of breaking the streak. Skipped
 * occurrences neither count nor break it. Paused items have no occurrences,
 * so their streak is 0.
 */
export function streak(db, item, today) {
  const t = requireDate(today);
  if (!isActive(item)) return 0;
  const first = firstSlot(item);
  if (first === null) return 0;
  const week = item.scope === 'week';
  const step = week ? 7 : 1;
  const current = week ? mondayOf(dayNumber(t)) : dayNumber(t);
  let count = 0;
  for (let n = current; n >= first; n -= step) {
    const slot = week ? formatWeek(isoWeekOf(n)) : dateKeyOf(n);
    if (!(week ? occursInWeek(item, slot) : occursOn(item, slot))) continue;
    const rec = recordOf(db, `${item.id}@${slot}`);
    if (rec && !rec.skip) count++;
    else if (!rec && n !== current) break;
  }
  return count;
}

function ordinal(n) {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return n + (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
}

/**
 * Short English description of item.repeat, or '' if the repeat is malformed.
 *
 * Year rule for one-off items: the year is appended only when it differs from
 * the year of item.created ('Once, Fri 1 Jan 2027'). For week items, the ISO
 * week-year is compared with the week-year of created ('Week 1, 2027'). The
 * text depends only on the item and never on the clock.
 */
export function describeRepeat(item) {
  const r = isObject(item) ? item.repeat : null;
  if (!isObject(r)) return '';
  const week = item.scope === 'week';
  const created = parseDate(item.created);
  switch (r.type) {
    case 'once': {
      if (week) {
        const w = parseWeek(r.week);
        if (!w) return '';
        const cw = created ? isoWeekOf(dayNumber(created)) : null;
        return `Week ${w.w}` + (cw && cw.y !== w.y ? `, ${w.y}` : '');
      }
      const p = parseDate(r.date);
      if (!p) return '';
      const text = `Once, ${WEEKDAY_NAMES[weekdayOf(dayNumber(p)) - 1]} ${p.d} ${MONTH_NAMES[p.m - 1]}`;
      return created && created.y !== p.y ? `${text} ${p.y}` : text;
    }
    case 'daily': {
      const n = everyOf(r);
      return n === 1 ? 'Every day' : `Every ${n} days`;
    }
    case 'weekly': {
      if (week) {
        const n = everyOf(r);
        return n === 1 ? 'Every week' : `Every ${n} weeks`;
      }
      if (!Array.isArray(r.days)) return '';
      const days = [...new Set(r.days)].filter((d) => Number.isInteger(d) && d >= 1 && d <= 7).sort((a, b) => a - b);
      const sig = days.join(',');
      if (sig === '1,2,3,4,5,6,7') return 'Every day';
      if (sig === '1,2,3,4,5') return 'Weekdays';
      if (sig === '6,7') return 'Weekends';
      if (days.length === 6) return `Every day except ${WEEKDAY_NAMES[[1, 2, 3, 4, 5, 6, 7].find((d) => !days.includes(d)) - 1]}`;
      return days.map((d) => WEEKDAY_NAMES[d - 1]).join(', ');
    }
    case 'monthly':
      if (r.day === -1) return 'Monthly on the last day';
      return Number.isInteger(r.day) ? `Monthly on the ${ordinal(r.day)}` : '';
    case 'yearly':
      return MONTH_NAMES[r.month - 1] && Number.isInteger(r.day) ? `Yearly on ${MONTH_NAMES[r.month - 1]} ${r.day}` : '';
    default:
      return '';
  }
}

// ---------------------------------------------------------------------------
// Item normalization (shared by addItem, updateItem and validate)

/** Integers, or strings holding one ('3', '-1'). Anything else is NaN. */
function toInt(v) {
  if (typeof v === 'number') return Number.isInteger(v) ? v : NaN;
  if (typeof v === 'string' && /^\s*-?\d+\s*$/.test(v)) return Number(v);
  return NaN;
}

/** Returns a clean copy of `raw` (known fields only), or throws a descriptive Error. */
function checkRepeat(raw, scope) {
  const fail = (msg) => {
    throw new Error(`Invalid repeat for a ${scope}-scope item: ${msg}`);
  };
  if (!isObject(raw)) fail("expected an object such as {type: 'once', date: 'YYYY-MM-DD'}");
  const { type } = raw;
  const withEvery = (r) => {
    if (raw.every === undefined || raw.every === null) return r;
    const every = toInt(raw.every);
    if (!(every >= 1)) fail(`'every' must be a whole number >= 1, got ${show(raw.every)}`);
    return { ...r, every };
  };

  if (scope === 'week') {
    if (type === 'once') {
      // Accept {date} and turn it into the week containing it.
      const week = raw.week === undefined && parseDate(raw.date) ? weekKey(raw.date) : raw.week;
      if (!parseWeek(week)) fail(`'once' needs week: 'YYYY-Www', got ${show(week)}`);
      return { type, week };
    }
    if (type === 'weekly') return withEvery({ type });
    fail(`type must be 'once' or 'weekly', got ${show(type)}`);
  }

  switch (type) {
    case 'once':
      if (!parseDate(raw.date)) fail(`'once' needs date: 'YYYY-MM-DD', got ${show(raw.date)}`);
      return { type, date: raw.date };
    case 'daily':
      return withEvery({ type });
    case 'weekly': {
      const days = Array.isArray(raw.days) ? raw.days.map(toInt) : [];
      if (!days.length || days.some((d) => !(d >= 1 && d <= 7))) {
        fail("'weekly' needs a non-empty days array of ISO weekdays 1..7 (1 = Mon, 7 = Sun)");
      }
      return { type, days: [...new Set(days)].sort((a, b) => a - b) };
    }
    case 'monthly': {
      const day = toInt(raw.day);
      if (!(day === -1 || (day >= 1 && day <= 31))) fail(`'monthly' day must be 1..31 or -1, got ${show(raw.day)}`);
      return { type, day };
    }
    case 'yearly': {
      const month = toInt(raw.month), day = toInt(raw.day);
      if (!(month >= 1 && month <= 12)) fail(`'yearly' month must be 1..12, got ${show(raw.month)}`);
      const max = daysInMonth(2000, month); // leap year, so Feb 29 is allowed
      if (!(day >= 1 && day <= max)) fail(`'yearly' day must be 1..${max} for month ${month}, got ${show(raw.day)}`);
      return { type, month, day };
    }
    default:
      return fail(`unknown type ${show(type)}`);
  }
}

/**
 * Builds a clean item from `raw`, or throws. Strict mode (addItem/updateItem)
 * rejects bad values. Lenient mode (validate) coerces what it can, drops bad
 * optional fields and only throws on a missing title or an invalid repeat.
 * Unknown extra fields are kept, so UI-specific data survives.
 */
function cleanItem(raw, id, lenient) {
  if (!isObject(raw)) throw new Error('item must be an object');
  const fail = (msg) => {
    throw new Error(msg);
  };

  let title = raw.title;
  if (lenient && typeof title === 'number' && Number.isFinite(title)) title = String(title);
  if (typeof title !== 'string' || !title.trim()) fail('title must be a non-empty string');

  let scope = raw.scope;
  let repeat;
  if (lenient && scope !== 'day' && scope !== 'week') {
    // Infer the scope the repeat is valid for, preferring 'day'. A repeat with
    // day-only fields (days, date) stays 'day' even when it is invalid.
    try {
      repeat = checkRepeat(raw.repeat, 'day');
      scope = 'day';
    } catch {
      const r = isObject(raw.repeat) ? raw.repeat : {};
      scope = r.days === undefined && r.date === undefined ? 'week' : 'day';
    }
  }
  if (scope !== 'day' && scope !== 'week') fail(`scope must be 'day' or 'week', got ${show(scope)}`);
  repeat ??= checkRepeat(raw.repeat, scope);

  let created = raw.created;
  if (!parseDate(created)) {
    if (!lenient) fail(`created must be a date key 'YYYY-MM-DD', got ${show(created)}`);
    if (repeat.type !== 'once') created = todayKey();
    else created = scope === 'day' ? repeat.date : dateKeyOf(weekStart(parseWeek(repeat.week)));
  }

  const item = { id, title: title.trim(), scope, repeat, created };

  if (raw.until !== undefined && raw.until !== null) {
    if (parseDate(raw.until)) item.until = raw.until;
    else if (!lenient) fail(`until must be a date key 'YYYY-MM-DD', got ${show(raw.until)}`);
  }

  if (raw.paused !== undefined && raw.paused !== null) {
    if (typeof raw.paused === 'boolean') {
      if (raw.paused) item.paused = true;
    } else if (!lenient) {
      fail(`paused must be a boolean, got ${show(raw.paused)}`);
    } else if (raw.paused === 1 || raw.paused === 'true') {
      item.paused = true;
    }
  }

  if (raw.order !== undefined && raw.order !== null) {
    const order = lenient && typeof raw.order === 'string' && raw.order.trim() ? Number(raw.order) : raw.order;
    if (typeof order === 'number' && Number.isFinite(order)) item.order = order;
    else if (!lenient) fail(`order must be a finite number, got ${show(raw.order)}`);
  }

  for (const [k, v] of Object.entries(raw)) {
    if (!ITEM_FIELDS.has(k) && v !== undefined) item[k] = v;
  }
  return item;
}

/** The occurrence key of a once item, otherwise null. */
function onceKey(item) {
  const r = item.repeat;
  if (!isObject(r) || r.type !== 'once') return null;
  return `${item.id}@${item.scope === 'week' ? r.week : r.date}`;
}

/** Day number of the last day an occurrence key covers (a week's Sunday), or null. */
function keyEndDay(key) {
  const at = key.lastIndexOf('@');
  const slot = key.slice(at + 1);
  const d = parseDate(slot);
  if (d) return dayNumber(d);
  const w = parseWeek(slot);
  return w ? weekStart(w) + 6 : null;
}

function isOccKey(key) {
  return typeof key === 'string' && key.lastIndexOf('@') > 0 && keyEndDay(key) !== null;
}

function keyItemId(key) {
  return key.slice(0, key.lastIndexOf('@'));
}

function makeId(taken) {
  let id;
  do id = 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  while (taken(id));
  return id;
}

function needDb(db) {
  if (!isObject(db)) throw new Error('db must be an object (use emptyDb() or validate())');
  if (!Array.isArray(db.items)) db.items = [];
  if (!isObject(db.done)) db.done = {};
  return db;
}

function findItem(db, id) {
  return db.items.find((it) => isObject(it) && it.id === id) || null;
}

function moveRecord(db, from, to) {
  if (from === to || !db.done[from]) return;
  db.done[to] = db.done[from];
  delete db.done[from];
}

// ---------------------------------------------------------------------------
// Mutations (mutate db in place)

export function emptyDb() {
  return { v: 1, items: [], done: {} };
}

/**
 * Adds an item and returns it. Fills `id` and defaults `created` to todayKey().
 * If `repeat` is omitted, the item is a one-off on `created` (day scope) or in
 * the week containing `created` (week scope). Optional until/paused/order and
 * extra fields are accepted. Throws on invalid input.
 */
export function addItem(db, fields) {
  needDb(db);
  if (!isObject(fields)) throw new Error('addItem needs an object like {title, scope, repeat, created}');
  // A caller-supplied id is ignored: ids are always generated.
  const { id: _ignored, title, scope = 'day', repeat, created = todayKey(), ...rest } = fields;
  if (!parseDate(created)) throw new Error(`created must be a date key 'YYYY-MM-DD', got ${show(created)}`);
  let rep = repeat;
  if (rep === undefined) {
    rep = scope === 'week' ? { type: 'once', week: weekKey(created) } : { type: 'once', date: created };
  }
  const id = makeId((x) => !!findItem(db, x));
  const item = cleanItem({ ...rest, title, scope, repeat: rep, created }, id, false);
  db.items.push(item);
  return item;
}

/**
 * Applies `patch` with JSON-merge-patch semantics: undefined values are ignored,
 * null removes a field (allowed for until/paused/order/extra fields, an error
 * for required ones). `id` can't change. The item object keeps its identity.
 * When a once item's date or week changes, its done entry is re-keyed.
 * Returns the item, or null if no item has that id. Throws on an invalid
 * result and leaves the item untouched.
 */
export function updateItem(db, id, patch) {
  needDb(db);
  if (!isObject(patch)) throw new Error('updateItem: patch must be an object');
  const item = findItem(db, id);
  if (!item) return null;
  const merged = { ...item };
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'id' || v === undefined) continue;
    if (v === null) delete merged[k];
    else merged[k] = v;
  }
  const next = cleanItem(merged, item.id, false);
  const oldKey = onceKey(item), newKey = onceKey(next);
  if (oldKey && newKey) moveRecord(db, oldKey, newKey);
  for (const k of Object.keys(item)) delete item[k];
  return Object.assign(item, next);
}

/** Removes the item and all of its done entries. Returns the removed item, or null. */
export function removeItem(db, id) {
  needDb(db);
  const removed = findItem(db, id);
  if (!removed) return null;
  db.items = db.items.filter((it) => !(isObject(it) && it.id === id));
  for (const key of Object.keys(db.done)) {
    if (keyItemId(key) === id) delete db.done[key];
  }
  return removed;
}

function requireOccKey(key, fn) {
  if (!isOccKey(key)) throw new Error(`${fn}: invalid occurrence key ${show(key)}, expected 'id@YYYY-MM-DD' or 'id@YYYY-Www'`);
}

/**
 * done=true records {at: now} (an existing done record keeps its timestamp,
 * a skip is replaced). done=false removes the record, which also un-skips.
 * Returns the record, or null.
 */
export function setDone(db, key, done = true) {
  needDb(db);
  requireOccKey(key, 'setDone');
  if (!done) {
    delete db.done[key];
    return null;
  }
  const cur = db.done[key];
  if (!cur || cur.skip) db.done[key] = { at: Date.now() };
  return db.done[key];
}

/** Marks the occurrence skipped. Returns the record. */
export function skip(db, key) {
  needDb(db);
  requireOccKey(key, 'skip');
  db.done[key] = { at: Date.now(), skip: true };
  return db.done[key];
}

/**
 * Moves a once item to another date and re-keys its done/skip record. For a
 * week-scope once item, newDateKey may be a week key, or a date key that is
 * turned into its week. Returns the item, or null if no item has that id.
 * Throws for recurring items or an invalid key.
 */
export function moveOnce(db, id, newDateKey) {
  needDb(db);
  const item = findItem(db, id);
  if (!item) return null;
  if (!isObject(item.repeat) || item.repeat.type !== 'once') {
    throw new Error(`moveOnce: item ${show(id)} is not a once item`);
  }
  let repeat;
  if (item.scope === 'week') {
    repeat = { type: 'once', week: parseWeek(newDateKey) ? newDateKey : weekKey(newDateKey) };
  } else {
    requireDate(newDateKey);
    repeat = { type: 'once', date: newDateKey };
  }
  return updateItem(db, id, { repeat });
}

/** Local day number of an epoch-ms timestamp, or -Infinity if unusable. */
function localDayOf(at) {
  if (typeof at !== 'number' || !Number.isFinite(at)) return -Infinity;
  const p = parseDate(todayKey(new Date(at)));
  return p ? dayNumber(p) : -Infinity;
}

/**
 * Housekeeping. Returns {items, entries}: how many of each were removed.
 *
 * - A once item whose occurrence was resolved (done or skipped) more than 30
 *   days ago is removed together with its record. "Ago" counts from the later
 *   of its date (a week's Sunday) and the local day it was ticked. A task
 *   ticked early stays until 30 days after its date, and an old task ticked
 *   late stays for 30 days. Skipped ones go too, otherwise they would come
 *   back as overdue once their record aged out.
 * - Any other record whose occurrence (a week's Sunday) is more than 400 days
 *   before today is deleted. Records of remaining once items are kept, so an
 *   old finished task can't reappear as overdue.
 */
export function prune(db, today) {
  needDb(db);
  const now = dayNumber(requireDate(today));
  const removed = { items: 0, entries: 0 };
  const keptOnceKeys = new Set();

  db.items = db.items.filter((item) => {
    const key = isObject(item) ? onceKey(item) : null;
    if (!key) return true;
    const rec = db.done[key];
    const end = keyEndDay(key);
    if (rec && end !== null && now - Math.max(end, localDayOf(rec.at)) > KEEP_ONCE_DAYS) {
      delete db.done[key];
      removed.entries++;
      removed.items++;
      return false;
    }
    keptOnceKeys.add(key);
    return true;
  });

  for (const key of Object.keys(db.done)) {
    if (keptOnceKeys.has(key)) continue;
    const end = keyEndDay(key);
    if (end !== null && now - end > KEEP_DONE_DAYS) {
      delete db.done[key];
      removed.entries++;
    }
  }
  return removed;
}

/**
 * Returns a well-formed copy of any input and never throws. A JSON string is
 * parsed. Items without a title or with an invalid repeat are dropped. Missing
 * or duplicate ids get fresh ones. Numeric strings are coerced. A missing
 * scope is inferred from the repeat. A missing `created` falls back to the
 * once date or week, otherwise today. Malformed done records are dropped.
 * Unknown fields, top-level and on items, are kept. The input is not mutated.
 */
export function validate(input) {
  try {
    return repair(input);
  } catch {
    return emptyDb(); // last resort for hostile inputs (throwing getters, proxies)
  }
}

function repair(input) {
  let src = input;
  if (typeof src === 'string') {
    try {
      src = JSON.parse(src);
    } catch {
      src = null;
    }
  }
  const db = emptyDb();
  if (!isObject(src)) return db;

  for (const [k, v] of Object.entries(src)) {
    if (k !== 'v' && k !== 'items' && k !== 'done') db[k] = v;
  }

  const rawItems = Array.isArray(src.items) ? src.items : isObject(src.items) ? Object.values(src.items) : [];
  const ids = new Set();
  for (const raw of rawItems) {
    let id = isObject(raw) ? raw.id : undefined;
    if (typeof id === 'number' && Number.isFinite(id)) id = String(id);
    if (typeof id !== 'string' || !id || ids.has(id)) id = makeId((x) => ids.has(x));
    let item;
    try {
      item = cleanItem(raw, id, true);
    } catch {
      continue;
    }
    ids.add(id);
    db.items.push(item);
  }

  if (isObject(src.done)) {
    for (const [key, val] of Object.entries(src.done)) {
      if (!isOccKey(key)) continue;
      let rec = null;
      if (val === true) rec = { at: 0 };
      else if (typeof val === 'number' && Number.isFinite(val)) rec = { at: val };
      else if (isObject(val)) {
        const at = typeof val.at === 'number' || typeof val.at === 'string' ? Number(val.at) : NaN;
        rec = { at: Number.isFinite(at) ? at : 0 };
        if (val.skip === true || val.skip === 1 || val.skip === 'true') rec.skip = true;
      }
      if (rec) db.done[key] = rec;
    }
  }
  return db;
}
