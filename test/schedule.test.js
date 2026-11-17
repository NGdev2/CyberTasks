import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as S from '../src/schedule.js';

const {
  todayKey, addDays, isoWeekday, weekKey, weekDays, addWeeks, daysInMonth,
  occursOn, occursInWeek, tasksForDay, tasksForWeek, weekOverview, nextOccurrence, streak, describeRepeat,
  emptyDb, addItem, updateItem, removeItem, setDone, skip, moveOnce, prune, validate,
} = S;

// ---------------------------------------------------------------------------
// helpers

const TODAY = '2026-11-17'; // a Tuesday in 2026-W47

function dbWith(...fieldsList) {
  const db = emptyDb();
  const items = fieldsList.map((f) => addItem(db, f));
  return { db, items };
}

function item(fields) {
  return addItem(emptyDb(), fields);
}

/** All dates in [from, to] on which the item occurs. */
function occurrences(it, from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) if (occursOn(it, d)) out.push(d);
  return out;
}

/** Epoch ms of local noon on a date key (stable in any time zone). */
function localNoon(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d, 12).getTime();
}

const titles = (entries) => entries.map((e) => e.item.title);

// ---------------------------------------------------------------------------
// API surface

test('exports exactly the Engine API from the spec', () => {
  const expected = [
    'todayKey', 'addDays', 'isoWeekday', 'weekKey', 'weekDays', 'addWeeks', 'daysInMonth',
    'occursOn', 'occursInWeek', 'tasksForDay', 'tasksForWeek', 'weekOverview', 'nextOccurrence', 'streak',
    'describeRepeat', 'emptyDb', 'addItem', 'updateItem', 'removeItem', 'setDone', 'skip', 'moveOnce', 'prune',
    'validate',
  ];
  assert.deepEqual(Object.keys(S).sort(), [...expected].sort());
  for (const name of expected) assert.equal(typeof S[name], 'function', name);
});

// ---------------------------------------------------------------------------
// dates

test('todayKey reads the local calendar date and zero-pads', () => {
  assert.equal(todayKey(new Date(2026, 10, 17, 0, 0, 1)), '2026-11-17');
  assert.equal(todayKey(new Date(2026, 10, 17, 23, 59, 59)), '2026-11-17');
  assert.equal(todayKey(new Date(2027, 0, 5, 12)), '2027-01-05');
  assert.match(todayKey(), /^\d{4}-\d{2}-\d{2}$/);
});

test('addDays crosses months, years and leap days', () => {
  assert.equal(addDays('2026-11-17', 1), '2026-11-18');
  assert.equal(addDays('2026-11-17', 0), '2026-11-17');
  assert.equal(addDays('2026-11-30', 1), '2026-12-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2027-01-01', -1), '2026-12-31');
  assert.equal(addDays('2024-02-28', 1), '2024-02-29');
  assert.equal(addDays('2024-02-29', 1), '2024-03-01');
  assert.equal(addDays('2025-02-28', 1), '2025-03-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addDays('2026-01-01', 365), '2027-01-01');
  assert.equal(addDays('2024-01-01', 366), '2025-01-01');
  assert.equal(addDays('2026-01-01', -365), '2025-01-01');
  assert.equal(addDays('2000-02-28', 1), '2000-02-29');
  assert.equal(addDays('1900-02-28', 1), '1900-03-01');
});

test('addDays never skips or repeats a day around DST changes', () => {
  // EU and US transitions in 2026
  assert.equal(addDays('2026-03-08', 1), '2026-03-09');
  assert.equal(addDays('2026-03-09', -1), '2026-03-08');
  assert.equal(addDays('2026-03-29', 1), '2026-03-30');
  assert.equal(addDays('2026-10-25', 1), '2026-10-26');
  assert.equal(addDays('2026-11-01', 1), '2026-11-02');
  assert.equal(addDays('2026-10-25', -1), '2026-10-24');

  // Walk 2020..2030 day by day: 11 years with 3 leap years = 4018 days, all distinct and increasing.
  let d = '2020-01-01';
  let prev = '';
  let steps = 0;
  while (d !== '2031-01-01') {
    assert.ok(d > prev, `${d} after ${prev}`);
    prev = d;
    d = addDays(d, 1);
    steps++;
    assert.ok(steps <= 4018, 'walk overran');
  }
  assert.equal(steps, 4018);
  assert.equal(addDays('2020-01-01', 4018), '2031-01-01');
  assert.equal(addDays('2031-01-01', -4018), '2020-01-01');
});

test('date functions reject malformed keys', () => {
  for (const bad of ['2026-02-30', '2026-13-01', '2026-1-1', '26-01-01', '', null, undefined, 20261117, '2026-11-17T00:00']) {
    assert.throws(() => addDays(bad, 1), /Invalid date key/);
    assert.throws(() => isoWeekday(bad), /Invalid date key/);
    assert.throws(() => weekKey(bad), /Invalid date key/);
  }
  assert.throws(() => addDays('2026-01-01', 1.5), /integer/);
  assert.throws(() => addDays('2026-01-01', '1'), /integer/);
});

test('isoWeekday: 1 = Monday ... 7 = Sunday', () => {
  assert.equal(isoWeekday('2026-11-16'), 1);
  assert.equal(isoWeekday('2026-11-17'), 2);
  assert.equal(isoWeekday('2026-11-20'), 5);
  assert.equal(isoWeekday('2026-11-22'), 7);
  assert.equal(isoWeekday('2026-01-01'), 4);
  assert.equal(isoWeekday('2000-01-01'), 6);
  assert.equal(isoWeekday('1970-01-01'), 4);
  assert.equal(isoWeekday('1969-12-29'), 1);
});

test('weekKey uses the ISO week-year at year boundaries', () => {
  const cases = {
    '2026-12-31': '2026-W53',
    '2027-01-01': '2026-W53',
    '2027-01-03': '2026-W53',
    '2027-01-04': '2027-W01',
    '2024-12-30': '2025-W01',
    '2024-12-29': '2024-W52',
    '2021-01-03': '2020-W53',
    '2021-01-04': '2021-W01',
    '2020-12-31': '2020-W53',
    '2026-01-01': '2026-W01',
    '2025-12-29': '2026-W01',
    '2025-12-28': '2025-W52',
    '2008-12-29': '2009-W01',
    '2010-01-03': '2009-W53',
    '2000-01-01': '1999-W52',
    '2026-11-17': '2026-W47',
    '2026-11-16': '2026-W47',
    '2026-11-22': '2026-W47',
    '2026-11-23': '2026-W48',
    '2026-01-05': '2026-W02', // zero-padded
  };
  for (const [date, wk] of Object.entries(cases)) assert.equal(weekKey(date), wk, date);
});

test('weekDays returns Monday..Sunday, also across year boundaries', () => {
  assert.deepEqual(weekDays('2026-W47'), [
    '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22',
  ]);
  assert.deepEqual(weekDays('2026-W53'), [
    '2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03',
  ]);
  assert.deepEqual(weekDays('2025-W01'), [
    '2024-12-30', '2024-12-31', '2025-01-01', '2025-01-02', '2025-01-03', '2025-01-04', '2025-01-05',
  ]);
  assert.deepEqual(weekDays('2020-W53'), [
    '2020-12-28', '2020-12-29', '2020-12-30', '2020-12-31', '2021-01-01', '2021-01-02', '2021-01-03',
  ]);
  assert.equal(weekDays('2027-W01')[0], '2027-01-04');
  assert.equal(weekDays('2026-W01')[0], '2025-12-29');
});

test('week functions reject malformed or out-of-range week keys', () => {
  // 2025 has 52 ISO weeks, 2026 has 53
  for (const bad of ['2025-W53', '2026-W54', '2026-W00', '2026-W5', '2026W47', '2026-w47', '', null, 47]) {
    assert.throws(() => weekDays(bad), /Invalid week key/);
    assert.throws(() => addWeeks(bad, 1), /Invalid week key/);
  }
  assert.throws(() => addWeeks('2026-W47', 0.5), /integer/);
});

test('addWeeks crosses 52- and 53-week years', () => {
  assert.equal(addWeeks('2026-W47', 0), '2026-W47');
  assert.equal(addWeeks('2026-W47', 1), '2026-W48');
  assert.equal(addWeeks('2026-W52', 1), '2026-W53');
  assert.equal(addWeeks('2026-W53', 1), '2027-W01');
  assert.equal(addWeeks('2027-W01', -1), '2026-W53');
  assert.equal(addWeeks('2025-W52', 1), '2026-W01');
  assert.equal(addWeeks('2026-W01', -1), '2025-W52');
  assert.equal(addWeeks('2020-W53', 1), '2021-W01');
  assert.equal(addWeeks('2021-W01', -1), '2020-W53');
  assert.equal(addWeeks('2026-W47', 52), '2027-W46'); // 2026 has 53 weeks
  assert.equal(addWeeks('2025-W47', 52), '2026-W47'); // 2025 has 52
  assert.equal(addWeeks('2027-W46', -52), '2026-W47');
});

test('weekDays / weekKey / addWeeks round-trip over 800 consecutive weeks', () => {
  const yearsWith53 = new Set();
  let wk = '2014-W01';
  for (let i = 0; i < 800; i++) {
    const days = weekDays(wk);
    assert.equal(isoWeekday(days[0]), 1, wk);
    assert.equal(isoWeekday(days[6]), 7, wk);
    for (const d of days) assert.equal(weekKey(d), wk, d);
    const next = addWeeks(wk, 1);
    assert.equal(weekDays(next)[0], addDays(days[6], 1), `${wk} -> ${next}`);
    assert.equal(addWeeks(next, -1), wk);
    assert.equal(addWeeks(addWeeks(wk, 37), -37), wk);
    assert.equal(addWeeks(addWeeks(wk, -110), 110), wk);
    if (wk.endsWith('-W53')) yearsWith53.add(wk.slice(0, 4));
    wk = next;
  }
  assert.deepEqual([...yearsWith53], ['2015', '2020', '2026']);
});

test('daysInMonth handles leap years', () => {
  assert.equal(daysInMonth(2024, 2), 29);
  assert.equal(daysInMonth(2026, 2), 28);
  assert.equal(daysInMonth(2000, 2), 29);
  assert.equal(daysInMonth(1900, 2), 28);
  assert.equal(daysInMonth(2026, 1), 31);
  assert.equal(daysInMonth(2026, 4), 30);
  assert.equal(daysInMonth(2026, 11), 30);
  assert.equal(daysInMonth(2026, 12), 31);
});

test('results do not depend on the local time zone', () => {
  const modUrl = new URL('../src/schedule.js', import.meta.url).href;
  const script = `
    import { addDays, weekKey, isoWeekday, todayKey } from ${JSON.stringify(modUrl)};
    const out = [];
    let d = '2025-12-20';
    for (let i = 0; i < 800; i++) { out.push(d + ' ' + weekKey(d) + ' ' + isoWeekday(d)); d = addDays(d, 1); }
    out.push(todayKey(new Date(2026, 2, 8, 0, 30)), todayKey(new Date(2026, 2, 29, 2, 30)),
             todayKey(new Date(2026, 9, 25, 2, 30)), todayKey(new Date(2026, 10, 1, 1, 30)));
    console.log(JSON.stringify(out));`;
  const run = (tz) => {
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      env: { ...process.env, TZ: tz },
      encoding: 'utf8',
    });
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout);
  };
  const reference = run('UTC');
  assert.equal(new Set(reference.slice(0, 800)).size, 800);
  assert.ok(reference.includes('2026-03-29 2026-W13 7'));
  assert.ok(reference.includes('2026-03-30 2026-W14 1'));
  assert.deepEqual(reference.slice(800), ['2026-03-08', '2026-03-29', '2026-10-25', '2026-11-01']);
  for (const tz of ['America/New_York', 'Europe/Berlin', 'Australia/Lord_Howe', 'Asia/Kathmandu', 'America/Havana']) {
    assert.deepEqual(run(tz), reference, tz);
  }
});

// ---------------------------------------------------------------------------
// occursOn: day scope

test('once (day) occurs only on its date', () => {
  const it = item({ title: 'Dentist', repeat: { type: 'once', date: '2026-11-20' }, created: TODAY });
  assert.deepEqual(occurrences(it, '2026-11-01', '2026-12-31'), ['2026-11-20']);
  assert.equal(occursInWeek(it, '2026-W47'), false);
  // a once item may be dated before `created`
  const past = item({ title: 'Back-dated', repeat: { type: 'once', date: '2026-11-10' }, created: TODAY });
  assert.equal(occursOn(past, '2026-11-10'), true);
});

test('daily counts every n days from created, across months, years and DST', () => {
  const every1 = item({ title: 'd1', repeat: { type: 'daily' }, created: '2026-11-01' });
  assert.deepEqual(occurrences(every1, '2026-10-25', '2026-11-04'), [
    '2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04',
  ]);

  const every3 = item({ title: 'd3', repeat: { type: 'daily', every: 3 }, created: '2026-10-21' });
  assert.deepEqual(occurrences(every3, '2026-10-15', '2026-11-08'), [
    '2026-10-21', '2026-10-24', '2026-10-27', '2026-10-30', '2026-11-02', '2026-11-05', '2026-11-08',
  ]);

  const every2 = item({ title: 'd2', repeat: { type: 'daily', every: 2 }, created: '2026-12-28' });
  assert.deepEqual(occurrences(every2, '2026-12-25', '2027-01-05'), [
    '2026-12-28', '2026-12-30', '2027-01-01', '2027-01-03', '2027-01-05',
  ]);
  // Feb 29 counts as a day
  const leap = item({ title: 'leap', repeat: { type: 'daily', every: 2 }, created: '2024-02-27' });
  assert.deepEqual(occurrences(leap, '2024-02-27', '2024-03-04'), ['2024-02-27', '2024-02-29', '2024-03-02', '2024-03-04']);

  // every 7 from a Monday stays on Mondays for years: no drift
  const weekly = item({ title: 'd7', repeat: { type: 'daily', every: 7 }, created: '2026-01-05' });
  const hits = occurrences(weekly, '2026-01-01', '2028-12-31');
  assert.equal(hits.length, 156);
  assert.ok(hits.every((d) => isoWeekday(d) === 1));
});

test('nothing recurring occurs before created or after until', () => {
  const it = item({ title: 'x', repeat: { type: 'daily' }, created: '2026-11-10', until: '2026-11-12' });
  assert.deepEqual(occurrences(it, '2026-11-01', '2026-11-30'), ['2026-11-10', '2026-11-11', '2026-11-12']);
  const once = item({ title: 'o', repeat: { type: 'once', date: '2026-11-20' }, created: TODAY, until: '2026-11-19' });
  assert.equal(occursOn(once, '2026-11-20'), false);
  const m = item({ title: 'm', repeat: { type: 'monthly', day: 15 }, created: TODAY });
  assert.equal(occursOn(m, '2026-11-15'), false);
  assert.equal(occursOn(m, '2026-12-15'), true);
  const y = item({ title: 'y', repeat: { type: 'yearly', month: 3, day: 14 }, created: TODAY });
  assert.equal(occursOn(y, '2026-03-14'), false);
  assert.equal(occursOn(y, '2027-03-14'), true);
});

test('paused items never occur', () => {
  for (const repeat of [
    { type: 'once', date: TODAY },
    { type: 'daily' },
    { type: 'weekly', days: [1, 2, 3, 4, 5, 6, 7] },
    { type: 'monthly', day: 17 },
    { type: 'yearly', month: 11, day: 17 },
  ]) {
    const it = item({ title: 'p', repeat, created: '2026-01-01', paused: true });
    assert.deepEqual(occurrences(it, '2026-01-01', '2026-12-31'), [], repeat.type);
    assert.equal(nextOccurrence(it, '2026-01-01'), null);
  }
  const wk = item({ title: 'pw', scope: 'week', repeat: { type: 'weekly' }, created: '2026-01-01', paused: true });
  assert.equal(occursInWeek(wk, '2026-W47'), false);
});

test('weekly (day) occurs on the listed ISO weekdays from created', () => {
  const it = item({ title: 'gym', repeat: { type: 'weekly', days: [4, 1] }, created: TODAY });
  assert.deepEqual(it.repeat.days, [1, 4]);
  assert.deepEqual(occurrences(it, '2026-11-09', '2026-11-30'), ['2026-11-19', '2026-11-23', '2026-11-26', '2026-11-30']);
  assert.equal(occursOn(it, '2026-11-16'), false); // Monday before created
});

test('monthly day 31 lands on the last day of shorter months', () => {
  const it = item({ title: 'rent', repeat: { type: 'monthly', day: 31 }, created: '2026-01-01' });
  assert.deepEqual(occurrences(it, '2026-01-01', '2026-12-31'), [
    '2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31', '2026-06-30',
    '2026-07-31', '2026-08-31', '2026-09-30', '2026-10-31', '2026-11-30', '2026-12-31',
  ]);
  assert.ok(occursOn(it, '2028-02-29'));
  assert.ok(!occursOn(it, '2028-02-28'));
  const d30 = item({ title: 'd30', repeat: { type: 'monthly', day: 30 }, created: '2024-01-01' });
  assert.ok(occursOn(d30, '2024-02-29'));
  assert.ok(occursOn(d30, '2025-02-28'));
  assert.ok(occursOn(d30, '2025-03-30'));
  assert.ok(!occursOn(d30, '2025-03-31'));
});

test('monthly -1 is always the last day of the month', () => {
  const it = item({ title: 'eom', repeat: { type: 'monthly', day: -1 }, created: '2024-01-01' });
  assert.deepEqual(occurrences(it, '2024-01-01', '2024-06-30'), [
    '2024-01-31', '2024-02-29', '2024-03-31', '2024-04-30', '2024-05-31', '2024-06-30',
  ]);
  assert.ok(occursOn(it, '2025-02-28'));
});

test('every monthly item occurs exactly once in every month', () => {
  for (const day of [...Array.from({ length: 31 }, (_, i) => i + 1), -1]) {
    const it = item({ title: `m${day}`, repeat: { type: 'monthly', day }, created: '2023-01-01' });
    const perMonth = new Map();
    for (const d of occurrences(it, '2023-01-01', '2028-12-31')) {
      const ym = d.slice(0, 7);
      assert.ok(!perMonth.has(ym), `day ${day}: twice in ${ym}`);
      perMonth.set(ym, d);
    }
    assert.equal(perMonth.size, 72, `day ${day}`);
    for (const [ym, d] of perMonth) {
      const last = daysInMonth(+ym.slice(0, 4), +ym.slice(5));
      assert.equal(+d.slice(8), day === -1 ? last : Math.min(day, last), `day ${day} in ${ym}`);
    }
  }
});

test('yearly occurs once a year; Feb 29 lands on Feb 28 in non-leap years', () => {
  const leap = item({ title: 'leapling', repeat: { type: 'yearly', month: 2, day: 29 }, created: '2026-01-01' });
  assert.deepEqual(occurrences(leap, '2026-01-01', '2033-12-31'), [
    '2026-02-28', '2027-02-28', '2028-02-29', '2029-02-28', '2030-02-28', '2031-02-28', '2032-02-29', '2033-02-28',
  ]);
  assert.ok(!occursOn(leap, '2028-02-28'));
  const pi = item({ title: 'pi', repeat: { type: 'yearly', month: 3, day: 14 }, created: '2026-01-01' });
  assert.deepEqual(occurrences(pi, '2026-01-01', '2028-12-31'), ['2026-03-14', '2027-03-14', '2028-03-14']);
});

test('occursOn / occursInWeek tolerate malformed items and keys', () => {
  for (const bad of [null, undefined, 0, 'x', [], {}, { repeat: 'daily' }, { repeat: { type: 'nope' } },
    { scope: 'day', repeat: { type: 'daily' } } /* no created */, { repeat: { type: 'weekly' }, created: TODAY }]) {
    assert.equal(occursOn(bad, TODAY), false);
    assert.equal(occursInWeek(bad, '2026-W47'), false);
    assert.equal(nextOccurrence(bad, TODAY), null);
    assert.equal(streak(emptyDb(), bad, TODAY), 0);
    assert.equal(typeof describeRepeat(bad), 'string');
  }
  const ok = item({ title: 'ok', repeat: { type: 'daily' }, created: '2026-01-01' });
  assert.equal(occursOn(ok, 'garbage'), false);
  assert.equal(occursOn(ok, '2026-02-30'), false);
});

// ---------------------------------------------------------------------------
// occursInWeek: week scope

test('once (week) occurs only in its week; day items never occur in weeks', () => {
  const it = item({ title: 'Ship v1', scope: 'week', repeat: { type: 'once', week: '2026-W47' }, created: TODAY });
  assert.equal(occursInWeek(it, '2026-W47'), true);
  assert.equal(occursInWeek(it, '2026-W48'), false);
  assert.equal(occursOn(it, TODAY), false);
  const day = item({ title: 'd', repeat: { type: 'daily' }, created: '2026-01-01' });
  assert.equal(occursInWeek(day, '2026-W47'), false);
});

test('weekly (week) starts at the week containing created', () => {
  // created on Sunday 2026-11-22, so the whole of W47 counts
  const it = item({ title: 'review', scope: 'week', repeat: { type: 'weekly' }, created: '2026-11-22' });
  assert.equal(occursInWeek(it, '2026-W46'), false);
  assert.equal(occursInWeek(it, '2026-W47'), true);
  assert.equal(occursInWeek(it, '2026-W48'), true);
  assert.equal(occursInWeek(it, '2027-W10'), true);
});

test('weekly every n counts weeks across a 53-week year', () => {
  const it = item({ title: 'bi', scope: 'week', repeat: { type: 'weekly', every: 2 }, created: '2026-12-21' }); // W52
  const hits = [];
  for (let wk = '2026-W50'; wk !== '2027-W06'; wk = addWeeks(wk, 1)) if (occursInWeek(it, wk)) hits.push(wk);
  assert.deepEqual(hits, ['2026-W52', '2027-W01', '2027-W03', '2027-W05']);

  const tri = item({ title: 'tri', scope: 'week', repeat: { type: 'weekly', every: 3 }, created: '2020-12-24' }); // 2020-W52
  const triHits = [];
  for (let wk = '2020-W50'; wk !== '2021-W08'; wk = addWeeks(wk, 1)) if (occursInWeek(tri, wk)) triHits.push(wk);
  assert.deepEqual(triHits, ['2020-W52', '2021-W02', '2021-W05']);
});

test('week items: the week containing until is the last one', () => {
  const mk = (until) => item({ title: 'u', scope: 'week', repeat: { type: 'weekly' }, created: '2026-11-02', until });
  const wed = mk('2026-11-18');
  assert.equal(occursInWeek(wed, '2026-W47'), true);
  assert.equal(occursInWeek(wed, '2026-W48'), false);
  const sun = mk('2026-11-22');
  assert.equal(occursInWeek(sun, '2026-W47'), true);
  assert.equal(occursInWeek(sun, '2026-W48'), false);
  const mon = mk('2026-11-23');
  assert.equal(occursInWeek(mon, '2026-W48'), true);
  assert.equal(occursInWeek(mon, '2026-W49'), false);
  const once = item({ title: 'o', scope: 'week', repeat: { type: 'once', week: '2026-W48' }, created: TODAY, until: '2026-11-20' });
  assert.equal(occursInWeek(once, '2026-W48'), false);
});

// ---------------------------------------------------------------------------
// tasksForDay / carry-over

function carryFixture() {
  const { db, items } = dbWith(
    { title: 'A today', repeat: { type: 'once', date: TODAY }, created: '2026-11-10' },
    { title: 'B overdue', repeat: { type: 'once', date: '2026-11-15' }, created: '2026-11-10' },
    { title: 'C done earlier', repeat: { type: 'once', date: '2026-11-14' }, created: '2026-11-10' },
    { title: 'D skipped earlier', repeat: { type: 'once', date: '2026-11-13' }, created: '2026-11-10' },
    { title: 'E daily', repeat: { type: 'daily' }, created: '2026-11-01' },
    { title: 'F future', repeat: { type: 'once', date: '2026-11-20' }, created: '2026-11-10' },
    { title: 'G week once', scope: 'week', repeat: { type: 'once', week: '2026-W46' }, created: '2026-11-10' },
    { title: 'H paused', repeat: { type: 'once', date: '2026-11-12' }, created: '2026-11-10', paused: true },
    { title: 'I weds', repeat: { type: 'weekly', days: [3] }, created: '2026-11-01' },
  );
  const [A, B, C, D, E, F, G, H, I] = items;
  setDone(db, `${C.id}@2026-11-14`, true);
  skip(db, `${D.id}@2026-11-13`);
  return { db, A, B, C, D, E, F, G, H, I };
}

test('tasksForDay carries unfinished once items over to today only', () => {
  const { db, A, B } = carryFixture();
  const list = tasksForDay(db, TODAY, { today: TODAY });
  assert.deepEqual(titles(list), ['E daily', 'A today', 'B overdue']); // E was created first

  const b = list.find((e) => e.item === B);
  assert.deepEqual(b, {
    item: B, key: `${B.id}@2026-11-15`, date: TODAY, done: false, skipped: false,
    overdue: true, originDate: '2026-11-15', recurring: false,
  });
  assert.deepEqual(Object.keys(b), ['item', 'key', 'date', 'done', 'skipped', 'overdue', 'originDate', 'recurring']);

  const a = list.find((e) => e.item === A);
  assert.deepEqual(Object.keys(a), ['item', 'key', 'date', 'done', 'skipped', 'overdue', 'recurring']);
  assert.equal(a.overdue, false);
  assert.equal(a.key, `${A.id}@${TODAY}`);
  assert.equal(list.find((e) => e.item.title === 'E daily').recurring, true);
});

test('carry-over is off for other days, without today, or with carryOver:false', () => {
  const { db } = carryFixture();
  assert.deepEqual(titles(tasksForDay(db, TODAY)), ['E daily', 'A today']);
  assert.deepEqual(titles(tasksForDay(db, TODAY, {})), ['E daily', 'A today']);
  assert.deepEqual(titles(tasksForDay(db, TODAY, { today: TODAY, carryOver: false })), ['E daily', 'A today']);
  assert.deepEqual(titles(tasksForDay(db, '2026-11-18', { today: TODAY })), ['E daily', 'I weds']);
  assert.deepEqual(titles(tasksForDay(db, '2026-11-16', { today: TODAY })), ['E daily']);
});

test('an overdue item shows normally on its own date and leaves today once done', () => {
  const { db, B } = carryFixture();
  const own = tasksForDay(db, '2026-11-15', { today: TODAY });
  const b = own.find((e) => e.item === B);
  assert.equal(b.overdue, false);
  assert.ok(!('originDate' in b));

  setDone(db, `${B.id}@2026-11-15`, true);
  assert.deepEqual(titles(tasksForDay(db, TODAY, { today: TODAY })), ['E daily', 'A today']);
  assert.equal(tasksForDay(db, '2026-11-15').find((e) => e.item === B).done, true);

  setDone(db, `${B.id}@2026-11-15`, false);
  assert.deepEqual(titles(tasksForDay(db, TODAY, { today: TODAY })), ['E daily', 'A today', 'B overdue']);
});

test('done/skipped flags on day entries', () => {
  const { db, A, E } = carryFixture();
  skip(db, `${A.id}@${TODAY}`);
  setDone(db, `${E.id}@${TODAY}`, true);
  const list = tasksForDay(db, TODAY, { today: TODAY });
  const a = list.find((e) => e.item === A);
  const e = list.find((x) => x.item === E);
  assert.deepEqual([a.done, a.skipped], [false, true]);
  assert.deepEqual([e.done, e.skipped], [true, false]);
  // previous day of the recurring item is unaffected
  assert.equal(tasksForDay(db, '2026-11-16').find((x) => x.item === E).done, false);
});

test('tasksForDay never lists an item twice', () => {
  const { db, items: [once, daily] } = dbWith(
    { title: 'o', repeat: { type: 'once', date: '2026-11-15' }, created: '2026-11-10' },
    { title: 'd', repeat: { type: 'daily' }, created: '2026-11-01' },
  );
  db.items.push(once, daily); // same objects twice (e.g. a bad merge)
  db.items.push({ ...once, repeat: { type: 'once', date: '2026-11-14' } }); // duplicate id, other date
  const list = tasksForDay(db, TODAY, { today: TODAY });
  assert.equal(list.length, 2);
  assert.equal(new Set(list.map((e) => e.item.id)).size, 2);
});

test('entries sort by order, then created, then title', () => {
  const { db } = dbWith(
    { title: 'Z late', repeat: { type: 'daily' }, created: '2026-11-01' },
    { title: 'X order 2', repeat: { type: 'daily' }, created: '2026-11-05', order: 2 },
    { title: 'Banana', repeat: { type: 'daily' }, created: '2026-10-01' },
    { title: 'Y order 1', repeat: { type: 'daily' }, created: '2026-11-09', order: 1 },
    { title: 'apple', repeat: { type: 'daily' }, created: '2026-10-01' },
    { title: 'N order -1', repeat: { type: 'daily' }, created: '2026-11-09', order: -1 },
    { title: 'O order 0', repeat: { type: 'daily' }, created: '2026-11-09', order: 0 },
  );
  assert.deepEqual(titles(tasksForDay(db, TODAY)), [
    'N order -1', 'O order 0', 'Y order 1', 'X order 2', 'apple', 'Banana', 'Z late',
  ]);
});

test('tasksForDay rejects a malformed date key and tolerates a garbage db', () => {
  assert.throws(() => tasksForDay(emptyDb(), '2026-02-30'), /Invalid date key/);
  assert.deepEqual(tasksForDay(null, TODAY, { today: TODAY }), []);
  assert.deepEqual(tasksForDay({ items: 'x', done: 5 }, TODAY, { today: TODAY }), []);
  assert.deepEqual(tasksForDay({ items: [null, 1, { title: 'no repeat' }] }, TODAY, { today: TODAY }), []);
});

// ---------------------------------------------------------------------------
// tasksForWeek / weekOverview

test('tasksForWeek lists week-scope objectives with done state and week keys', () => {
  const { db, items: [once, weekly, bi] } = dbWith(
    { title: 'Ship v1', scope: 'week', repeat: { type: 'once', week: '2026-W47' }, created: '2026-11-10' },
    { title: 'Weekly review', scope: 'week', repeat: { type: 'weekly' }, created: '2026-11-01' },
    { title: 'Fortnightly', scope: 'week', repeat: { type: 'weekly', every: 2 }, created: '2026-11-02' }, // W45
    { title: 'Day item', repeat: { type: 'daily' }, created: '2026-11-01' },
  );
  const w47 = tasksForWeek(db, '2026-W47');
  assert.deepEqual(titles(w47), ['Weekly review', 'Fortnightly', 'Ship v1']);
  const first = w47.find((e) => e.item === once);
  assert.deepEqual(Object.keys(first), ['item', 'key', 'week', 'done', 'skipped', 'overdue', 'recurring']);
  assert.equal(first.key, `${once.id}@2026-W47`);
  assert.equal(first.week, '2026-W47');
  assert.equal(first.recurring, false);
  assert.equal(w47.find((e) => e.item === weekly).recurring, true);

  setDone(db, `${weekly.id}@2026-W47`, true);
  skip(db, `${bi.id}@2026-W47`);
  const again = tasksForWeek(db, '2026-W47');
  assert.equal(again.find((e) => e.item === weekly).done, true);
  assert.equal(again.find((e) => e.item === bi).skipped, true);
  assert.deepEqual(titles(tasksForWeek(db, '2026-W48')), ['Weekly review']);
  // week once items never carry over
  assert.deepEqual(titles(tasksForWeek(db, '2026-W49')), ['Weekly review', 'Fortnightly']);
  assert.throws(() => tasksForWeek(db, '2025-W53'), /Invalid week key/);
});

test('weekOverview has 7 days Mon..Sun, carry-over on today only, and objectives', () => {
  const { db } = carryFixture();
  addItem(db, { title: 'Objective', scope: 'week', repeat: { type: 'weekly' }, created: '2026-11-01' });
  const ov = weekOverview(db, '2026-W47', { today: TODAY });
  assert.deepEqual(ov.days.map((d) => d.date), weekDays('2026-W47'));
  const overdue = ov.days.flatMap((d) => d.tasks.filter((t) => t.overdue).map((t) => `${d.date} ${t.item.title}`));
  assert.deepEqual(overdue, [`${TODAY} B overdue`]);
  assert.deepEqual(titles(ov.days[1].tasks), ['E daily', 'A today', 'B overdue']);
  assert.deepEqual(titles(ov.days[4].tasks), ['E daily', 'F future']);
  assert.deepEqual(titles(ov.objectives), ['Objective']);
  assert.deepEqual(ov.objectives, tasksForWeek(db, '2026-W47'));

  const other = weekOverview(db, '2026-W48', { today: TODAY });
  assert.ok(other.days.every((d) => d.tasks.every((t) => !t.overdue)));
  const off = weekOverview(db, '2026-W47', { today: TODAY, carryOver: false });
  assert.ok(off.days.every((d) => d.tasks.every((t) => !t.overdue)));
});

// ---------------------------------------------------------------------------
// nextOccurrence

test('nextOccurrence finds the first occurrence on or after from', () => {
  const daily = item({ title: 'd', repeat: { type: 'daily', every: 3 }, created: '2026-11-01' });
  assert.equal(nextOccurrence(daily, '2026-11-01'), '2026-11-01');
  assert.equal(nextOccurrence(daily, '2026-11-02'), '2026-11-04');
  assert.equal(nextOccurrence(daily, '2026-10-01'), '2026-11-01'); // never before created

  const weekly = item({ title: 'w', repeat: { type: 'weekly', days: [1, 4] }, created: '2026-11-01' });
  assert.equal(nextOccurrence(weekly, TODAY), '2026-11-19');
  assert.equal(nextOccurrence(weekly, '2026-11-20'), '2026-11-23');

  const m31 = item({ title: 'm', repeat: { type: 'monthly', day: 31 }, created: '2026-01-01' });
  assert.equal(nextOccurrence(m31, '2026-02-01'), '2026-02-28');

  const leap = item({ title: 'l', repeat: { type: 'yearly', month: 2, day: 29 }, created: '2026-01-01' });
  assert.equal(nextOccurrence(leap, '2026-03-01'), '2027-02-28');
  assert.equal(nextOccurrence(leap, '2027-03-01'), '2028-02-29');

  const once = item({ title: 'o', repeat: { type: 'once', date: '2026-11-20' }, created: TODAY });
  assert.equal(nextOccurrence(once, TODAY), '2026-11-20');
  assert.equal(nextOccurrence(once, '2026-11-21'), null);
  // the scan covers from .. from+799
  const at799 = item({ title: 'edge', repeat: { type: 'once', date: addDays(TODAY, 799) }, created: TODAY });
  const at800 = item({ title: 'far', repeat: { type: 'once', date: addDays(TODAY, 800) }, created: TODAY });
  assert.equal(nextOccurrence(at799, TODAY), addDays(TODAY, 799));
  assert.equal(nextOccurrence(at800, TODAY), null);

  const ended = item({ title: 'e', repeat: { type: 'daily' }, created: '2026-01-01', until: '2026-06-30' });
  assert.equal(nextOccurrence(ended, TODAY), null);

  assert.throws(() => nextOccurrence(daily, 'nope'), /Invalid date key/);
  assert.equal(nextOccurrence(null, TODAY), null);
});

test('nextOccurrence for week items returns the Monday of the next occurring week', () => {
  const bi = item({ title: 'bi', scope: 'week', repeat: { type: 'weekly', every: 2 }, created: '2026-11-09' }); // W46
  assert.equal(nextOccurrence(bi, TODAY), '2026-11-23'); // W48
  assert.equal(nextOccurrence(bi, '2026-11-11'), '2026-11-09'); // W46 itself
  const once = item({ title: 'o', scope: 'week', repeat: { type: 'once', week: '2027-W01' }, created: TODAY });
  assert.equal(nextOccurrence(once, TODAY), '2027-01-04');
  assert.equal(nextOccurrence(once, '2027-01-11'), null);
});

// ---------------------------------------------------------------------------
// streak

test('streak counts back from the last occurrence; an unfinished today does not break it', () => {
  const { db, items: [it] } = dbWith({ title: 'habit', repeat: { type: 'daily' }, created: '2026-11-01' });
  for (const d of ['2026-11-14', '2026-11-15', '2026-11-16']) setDone(db, `${it.id}@${d}`, true);
  assert.equal(streak(db, it, TODAY), 3);
  setDone(db, `${it.id}@${TODAY}`, true);
  assert.equal(streak(db, it, TODAY), 4);
  // tomorrow, with tomorrow not yet done, the streak still stands
  assert.equal(streak(db, it, '2026-11-18'), 4);
  // the day after tomorrow, a missed day breaks it
  assert.equal(streak(db, it, '2026-11-19'), 0);
});

test('streak: skipped days neither break nor count', () => {
  const { db, items: [it] } = dbWith({ title: 'habit', repeat: { type: 'daily' }, created: '2026-11-01' });
  for (const d of ['2026-11-12', '2026-11-13', '2026-11-15', '2026-11-16']) setDone(db, `${it.id}@${d}`, true);
  skip(db, `${it.id}@2026-11-14`);
  assert.equal(streak(db, it, TODAY), 4); // 11-11 was missed
  skip(db, `${it.id}@${TODAY}`);
  assert.equal(streak(db, it, TODAY), 4);
});

test('streak: a missed day breaks it', () => {
  const { db, items: [it] } = dbWith({ title: 'habit', repeat: { type: 'daily' }, created: '2026-11-01' });
  for (const d of ['2026-11-13', '2026-11-14', '2026-11-16']) setDone(db, `${it.id}@${d}`, true);
  assert.equal(streak(db, it, TODAY), 1);
});

test('streak: a weekly Mon/Thu item only counts its own occurrences', () => {
  const { db, items: [it] } = dbWith({ title: 'gym', repeat: { type: 'weekly', days: [1, 4] }, created: '2026-11-01' });
  for (const d of ['2026-11-09', '2026-11-12', '2026-11-16']) setDone(db, `${it.id}@${d}`, true);
  setDone(db, `${it.id}@2026-11-10`, true); // a Tuesday: not an occurrence, ignored
  assert.equal(streak(db, it, TODAY), 3); // Tue: latest occurrence is Mon 11-16
  assert.equal(streak(db, it, '2026-11-19'), 3); // Thu not done yet
  setDone(db, `${it.id}@2026-11-19`, true);
  assert.equal(streak(db, it, '2026-11-19'), 4);
  setDone(db, `${it.id}@2026-11-12`, false);
  assert.equal(streak(db, it, '2026-11-19'), 2);
  assert.equal(streak(db, it, '2026-11-21'), 2); // Sat: Thu was the latest occurrence
});

test('streak ignores records before created and respects every and until', () => {
  const { db, items: [late, alt, ended] } = dbWith(
    { title: 'late', repeat: { type: 'daily' }, created: '2026-11-15' },
    { title: 'alt', repeat: { type: 'daily', every: 2 }, created: '2026-11-01' },
    { title: 'ended', repeat: { type: 'daily' }, created: '2026-11-01', until: '2026-11-10' },
  );
  for (const d of ['2026-11-13', '2026-11-14', '2026-11-15', '2026-11-16']) setDone(db, `${late.id}@${d}`, true);
  assert.equal(streak(db, late, TODAY), 2);
  // alt occurs on odd days: 11-13, 11-15, 11-17
  for (const d of ['2026-11-13', '2026-11-15']) setDone(db, `${alt.id}@${d}`, true);
  assert.equal(streak(db, alt, TODAY), 2);
  assert.equal(streak(db, alt, '2026-11-16'), 2);
  for (const d of ['2026-11-08', '2026-11-09', '2026-11-10']) setDone(db, `${ended.id}@${d}`, true);
  assert.equal(streak(db, ended, TODAY), 3);
});

test('streak for week items, once items and paused items', () => {
  const { db, items: [wk, once, paused, future] } = dbWith(
    { title: 'review', scope: 'week', repeat: { type: 'weekly' }, created: '2026-10-01' },
    { title: 'once', repeat: { type: 'once', date: '2026-11-15' }, created: '2026-11-10' },
    { title: 'paused', repeat: { type: 'daily' }, created: '2026-11-01', paused: true },
    { title: 'future', repeat: { type: 'once', date: '2026-11-20' }, created: '2026-11-10' },
  );
  for (const w of ['2026-W44', '2026-W45', '2026-W46']) setDone(db, `${wk.id}@${w}`, true);
  assert.equal(streak(db, wk, TODAY), 3);
  setDone(db, `${wk.id}@2026-W47`, true);
  assert.equal(streak(db, wk, TODAY), 4);
  skip(db, `${wk.id}@2026-W45`);
  assert.equal(streak(db, wk, TODAY), 3);

  assert.equal(streak(db, once, TODAY), 0);
  setDone(db, `${once.id}@2026-11-15`, true);
  assert.equal(streak(db, once, TODAY), 1);

  setDone(db, `${paused.id}@2026-11-16`, true);
  assert.equal(streak(db, paused, TODAY), 0);
  setDone(db, `${future.id}@2026-11-20`, true);
  assert.equal(streak(db, future, TODAY), 0);

  assert.throws(() => streak(db, wk, 'nope'), /Invalid date key/);
  assert.equal(streak(db, null, TODAY), 0);
});

// ---------------------------------------------------------------------------
// describeRepeat

test('describeRepeat: day-scope repeat types', () => {
  const d = (repeat, extra = {}) => describeRepeat(item({ title: 't', repeat, created: TODAY, ...extra }));
  assert.equal(d({ type: 'daily' }), 'Every day');
  assert.equal(d({ type: 'daily', every: 1 }), 'Every day');
  assert.equal(d({ type: 'daily', every: 2 }), 'Every 2 days');
  assert.equal(d({ type: 'weekly', days: [1, 4] }), 'Mon, Thu');
  assert.equal(d({ type: 'weekly', days: [7, 3] }), 'Wed, Sun');
  assert.equal(d({ type: 'weekly', days: [5] }), 'Fri');
  assert.equal(d({ type: 'weekly', days: [1, 2, 3, 4, 5] }), 'Weekdays');
  assert.equal(d({ type: 'weekly', days: [6, 7] }), 'Weekends');
  assert.equal(d({ type: 'weekly', days: [1, 2, 3, 4, 5, 6, 7] }), 'Every day');
  assert.equal(d({ type: 'weekly', days: [1, 2, 3, 4, 6] }), 'Mon, Tue, Wed, Thu, Sat');
  assert.equal(d({ type: 'monthly', day: 15 }), 'Monthly on the 15th');
  assert.equal(d({ type: 'monthly', day: -1 }), 'Monthly on the last day');
  assert.equal(d({ type: 'yearly', month: 3, day: 14 }), 'Yearly on Mar 14');
  assert.equal(d({ type: 'yearly', month: 2, day: 29 }), 'Yearly on Feb 29');
  assert.equal(d({ type: 'once', date: '2026-11-20' }), 'Once, Fri 20 Nov');
  assert.equal(d({ type: 'once', date: '2026-01-05' }), 'Once, Mon 5 Jan');
  // another year than created's: the year is appended
  assert.equal(d({ type: 'once', date: '2027-01-01' }), 'Once, Fri 1 Jan 2027');
  assert.equal(d({ type: 'once', date: '2025-12-31' }), 'Once, Wed 31 Dec 2025');
});

test('describeRepeat: ordinal suffixes', () => {
  const expected = {
    1: '1st', 2: '2nd', 3: '3rd', 4: '4th', 10: '10th', 11: '11th', 12: '12th', 13: '13th', 14: '14th',
    20: '20th', 21: '21st', 22: '22nd', 23: '23rd', 24: '24th', 30: '30th', 31: '31st',
  };
  for (const [day, ord] of Object.entries(expected)) {
    const it = item({ title: 't', repeat: { type: 'monthly', day: +day }, created: TODAY });
    assert.equal(describeRepeat(it), `Monthly on the ${ord}`);
  }
});

test('describeRepeat: week-scope repeat types', () => {
  const w = (repeat, created = TODAY) => describeRepeat(item({ title: 't', scope: 'week', repeat, created }));
  assert.equal(w({ type: 'weekly' }), 'Every week');
  assert.equal(w({ type: 'weekly', every: 1 }), 'Every week');
  assert.equal(w({ type: 'weekly', every: 2 }), 'Every 2 weeks');
  assert.equal(w({ type: 'once', week: '2026-W47' }), 'Week 47');
  assert.equal(w({ type: 'once', week: '2026-W05' }), 'Week 5');
  assert.equal(w({ type: 'once', week: '2027-W01' }), 'Week 1, 2027');
  // 2027-01-02 is in ISO week-year 2026, so W53 of 2026 needs no year
  assert.equal(w({ type: 'once', week: '2026-W53' }, '2027-01-02'), 'Week 53');
});

test('describeRepeat returns an empty string for malformed repeats', () => {
  assert.equal(describeRepeat(null), '');
  assert.equal(describeRepeat({}), '');
  assert.equal(describeRepeat({ repeat: { type: 'hourly' } }), '');
  assert.equal(describeRepeat({ repeat: { type: 'once', date: 'nope' } }), '');
  assert.equal(describeRepeat({ repeat: { type: 'weekly' } }), '');
  assert.equal(describeRepeat({ repeat: { type: 'yearly', month: 13, day: 1 } }), '');
});

// ---------------------------------------------------------------------------
// mutations

test('emptyDb returns a fresh, well-formed db', () => {
  const a = emptyDb();
  assert.deepEqual(a, { v: 1, items: [], done: {} });
  a.items.push(1);
  assert.deepEqual(emptyDb().items, []);
});

test('addItem fills id and created, normalizes and stores optional fields', () => {
  const db = emptyDb();
  const it = addItem(db, { title: '  Water plants  ', repeat: { type: 'weekly', days: [3, 1, 3] } });
  assert.equal(db.items[0], it);
  assert.match(it.id, /^i[0-9a-z]+$/);
  assert.equal(it.created, todayKey());
  assert.equal(it.scope, 'day');
  assert.equal(it.title, 'Water plants');
  assert.deepEqual(it.repeat, { type: 'weekly', days: [1, 3] });

  const full = addItem(db, {
    title: 'Full', repeat: { type: 'daily', every: 2 }, created: '2026-11-01',
    until: '2026-12-31', paused: false, order: 3, color: 'cyan', id: 'mine',
  });
  assert.notEqual(full.id, 'mine');
  assert.deepEqual({ ...full, id: undefined }, {
    id: undefined, title: 'Full', scope: 'day', repeat: { type: 'daily', every: 2 },
    created: '2026-11-01', until: '2026-12-31', order: 3, color: 'cyan',
  });

  // no repeat: a one-off on created (day) or in created's week (week)
  assert.deepEqual(addItem(db, { title: 'quick', created: '2026-11-20' }).repeat, { type: 'once', date: '2026-11-20' });
  assert.deepEqual(addItem(db, { title: 'goal', scope: 'week', created: '2027-01-02' }).repeat, { type: 'once', week: '2026-W53' });
  // week once given a date becomes that date's week
  assert.deepEqual(addItem(db, { title: 'g2', scope: 'week', repeat: { type: 'once', date: '2024-12-30' } }).repeat,
    { type: 'once', week: '2025-W01' });
});

test('addItem generates unique ids', () => {
  const db = emptyDb();
  for (let i = 0; i < 2000; i++) addItem(db, { title: `t${i}`, repeat: { type: 'daily' }, created: TODAY });
  assert.equal(new Set(db.items.map((i) => i.id)).size, 2000);
});

test('addItem throws a clear Error on invalid input and leaves the db unchanged', () => {
  const db = emptyDb();
  const bad = [
    [{ title: 'x', repeat: { type: 'weekly', days: [] } }, /days/],
    [{ title: 'x', repeat: { type: 'weekly' } }, /days/],
    [{ title: 'x', repeat: { type: 'weekly', days: [0] } }, /days/],
    [{ title: 'x', repeat: { type: 'weekly', days: [8] } }, /days/],
    [{ title: 'x', repeat: { type: 'weekly', days: ['mon'] } }, /days/],
    [{ title: '', repeat: { type: 'daily' } }, /title/],
    [{ title: '   ', repeat: { type: 'daily' } }, /title/],
    [{ repeat: { type: 'daily' } }, /title/],
    [{ title: 5, repeat: { type: 'daily' } }, /title/],
    [{ title: 'x', scope: 'month', repeat: { type: 'daily' } }, /scope/],
    [{ title: 'x', scope: 'week', repeat: { type: 'daily' } }, /week-scope/],
    [{ title: 'x', scope: 'week', repeat: { type: 'once', week: '2025-W53' } }, /week/],
    [{ title: 'x', repeat: { type: 'once', week: '2026-W47' } }, /date/],
    [{ title: 'x', repeat: { type: 'once', date: '2026-02-30' } }, /date/],
    [{ title: 'x', repeat: { type: 'monthly', day: 0 } }, /monthly/],
    [{ title: 'x', repeat: { type: 'monthly', day: 32 } }, /monthly/],
    [{ title: 'x', repeat: { type: 'monthly', day: -2 } }, /monthly/],
    [{ title: 'x', repeat: { type: 'yearly', month: 13, day: 1 } }, /month/],
    [{ title: 'x', repeat: { type: 'yearly', month: 2, day: 30 } }, /day/],
    [{ title: 'x', repeat: { type: 'yearly', month: 4, day: 31 } }, /day/],
    [{ title: 'x', repeat: { type: 'daily', every: 0 } }, /every/],
    [{ title: 'x', repeat: { type: 'daily', every: 1.5 } }, /every/],
    [{ title: 'x', repeat: { type: 'hourly' } }, /unknown type/],
    [{ title: 'x', repeat: 'daily' }, /repeat/],
    [{ title: 'x', repeat: null }, /repeat/],
    [{ title: 'x', repeat: { type: 'daily' }, created: '2026-13-01' }, /created/],
    [{ title: 'x', created: 'yesterday' }, /created/],
    [{ title: 'x', repeat: { type: 'daily' }, until: 'never' }, /until/],
    [{ title: 'x', repeat: { type: 'daily' }, paused: 'yes' }, /paused/],
    [{ title: 'x', repeat: { type: 'daily' }, order: NaN }, /order/],
  ];
  for (const [fields, msg] of bad) {
    assert.throws(() => addItem(db, fields), (err) => err instanceof Error && msg.test(err.message), JSON.stringify(fields));
  }
  assert.throws(() => addItem(db), /addItem/);
  assert.throws(() => addItem(null, { title: 'x' }), /db/);
  assert.deepEqual(db, emptyDb());
});

test('updateItem patches in place, keeps identity, and validates', () => {
  const { db, items: [it] } = dbWith({ title: 'Old', repeat: { type: 'daily' }, created: '2026-11-01', until: '2026-12-31' });
  const same = updateItem(db, it.id, { title: 'New', order: 5, id: 'hijack', note: undefined });
  assert.equal(same, it);
  assert.equal(db.items[0], it);
  assert.equal(it.title, 'New');
  assert.equal(it.order, 5);
  assert.notEqual(it.id, 'hijack');
  assert.ok(!('note' in it));

  updateItem(db, it.id, { until: null, order: null, paused: true });
  assert.ok(!('until' in it));
  assert.ok(!('order' in it));
  assert.equal(it.paused, true);
  updateItem(db, it.id, { paused: false });
  assert.ok(!('paused' in it));

  const snapshot = structuredClone(it);
  assert.throws(() => updateItem(db, it.id, { repeat: { type: 'weekly', days: [] } }), /days/);
  assert.throws(() => updateItem(db, it.id, { title: null }), /title/);
  assert.throws(() => updateItem(db, it.id, { scope: 'week' }), /week-scope/);
  assert.throws(() => updateItem(db, it.id, 'nope'), /patch/);
  assert.deepEqual(it, snapshot);

  updateItem(db, it.id, { scope: 'week', repeat: { type: 'weekly', every: 2 } });
  assert.equal(describeRepeat(it), 'Every 2 weeks');
  assert.equal(updateItem(db, 'missing', { title: 'x' }), null);
});

test('updateItem re-keys the done record when a once date changes', () => {
  const { db, items: [it] } = dbWith({ title: 'o', repeat: { type: 'once', date: '2026-11-15' }, created: '2026-11-10' });
  setDone(db, `${it.id}@2026-11-15`, true);
  const rec = db.done[`${it.id}@2026-11-15`];
  updateItem(db, it.id, { repeat: { type: 'once', date: '2026-11-18' } });
  assert.deepEqual(db.done, { [`${it.id}@2026-11-18`]: rec });
});

test('removeItem deletes the item and only its own done records', () => {
  const db = validate({
    items: [
      { id: 'a', title: 'a', repeat: { type: 'daily' }, created: '2026-11-01' },
      { id: 'ab', title: 'ab', repeat: { type: 'daily' }, created: '2026-11-01' },
      { id: 'a@b', title: 'a@b', repeat: { type: 'daily' }, created: '2026-11-01' },
    ],
    done: {
      'a@2026-11-16': { at: 1 }, 'a@2026-11-17': { at: 2, skip: true },
      'ab@2026-11-17': { at: 3 }, 'a@b@2026-11-17': { at: 4 },
    },
  });
  const removed = removeItem(db, 'a');
  assert.equal(removed.title, 'a');
  assert.deepEqual(db.items.map((i) => i.id), ['ab', 'a@b']);
  assert.deepEqual(Object.keys(db.done).sort(), ['a@b@2026-11-17', 'ab@2026-11-17']);
  removeItem(db, 'a@b');
  assert.deepEqual(Object.keys(db.done), ['ab@2026-11-17']);
  assert.equal(removeItem(db, 'missing'), null);
});

test('setDone and skip manage occurrence records', () => {
  const { db, items: [it] } = dbWith({ title: 'd', repeat: { type: 'daily' }, created: '2026-11-01' });
  const key = `${it.id}@${TODAY}`;
  const before = Date.now();
  const rec = setDone(db, key, true);
  assert.deepEqual(Object.keys(rec), ['at']);
  assert.ok(rec.at >= before && rec.at <= Date.now());
  assert.equal(setDone(db, key, true), rec); // re-ticking keeps the original timestamp
  assert.equal(setDone(db, key, false), null);
  assert.ok(!(key in db.done));

  const s = skip(db, key);
  assert.equal(s.skip, true);
  assert.equal(typeof s.at, 'number');
  assert.equal(tasksForDay(db, TODAY)[0].skipped, true);
  setDone(db, key, true); // ticking a skipped occurrence replaces the skip
  assert.deepEqual(Object.keys(db.done[key]), ['at']);
  assert.equal(tasksForDay(db, TODAY)[0].done, true);
  setDone(db, key, false);
  assert.deepEqual(db.done, {});

  for (const bad of ['nokey', `${it.id}@notadate`, '@2026-11-17', '', null, 42]) {
    assert.throws(() => setDone(db, bad, true), /occurrence key/);
    assert.throws(() => skip(db, bad), /occurrence key/);
  }
  setDone(db, `${it.id}@2026-W47`, true); // week keys are valid keys too
  assert.ok(db.done[`${it.id}@2026-W47`]);
});

test('moveOnce moves a once item and re-keys its record', () => {
  const { db, items: [it, rec, wk] } = dbWith(
    { title: 'o', repeat: { type: 'once', date: '2026-11-15' }, created: '2026-11-10' },
    { title: 'r', repeat: { type: 'daily' }, created: '2026-11-01' },
    { title: 'w', scope: 'week', repeat: { type: 'once', week: '2026-W46' }, created: '2026-11-10' },
  );
  setDone(db, `${it.id}@2026-11-15`, true);
  assert.equal(moveOnce(db, it.id, '2026-11-19'), it);
  assert.deepEqual(it.repeat, { type: 'once', date: '2026-11-19' });
  assert.ok(!(`${it.id}@2026-11-15` in db.done));
  assert.ok(db.done[`${it.id}@2026-11-19`]);
  assert.equal(tasksForDay(db, '2026-11-19').find((e) => e.item === it).done, true);
  assert.equal(tasksForDay(db, '2026-11-15').length, 1); // only the daily item

  skip(db, `${it.id}@2026-11-19`);
  moveOnce(db, it.id, '2026-11-21');
  assert.equal(db.done[`${it.id}@2026-11-21`].skip, true);

  // moving an unfinished overdue task to today drops it from carry-over
  const { db: db2, items: [late] } = dbWith({ title: 'late', repeat: { type: 'once', date: '2026-11-10' }, created: '2026-11-01' });
  moveOnce(db2, late.id, TODAY);
  const list = tasksForDay(db2, TODAY, { today: TODAY });
  assert.equal(list.length, 1);
  assert.equal(list[0].overdue, false);

  // week-scope once: a week key or a date inside the target week
  setDone(db, `${wk.id}@2026-W46`, true);
  moveOnce(db, wk.id, '2026-W48');
  assert.deepEqual(wk.repeat, { type: 'once', week: '2026-W48' });
  assert.ok(db.done[`${wk.id}@2026-W48`]);
  moveOnce(db, wk.id, '2027-01-01');
  assert.deepEqual(wk.repeat, { type: 'once', week: '2026-W53' });
  assert.ok(db.done[`${wk.id}@2026-W53`]);

  assert.throws(() => moveOnce(db, rec.id, TODAY), /not a once item/);
  const snapshot = structuredClone(it);
  assert.throws(() => moveOnce(db, it.id, '2026-02-30'), /Invalid date key/);
  assert.throws(() => moveOnce(db, it.id, '2026-W47'), /Invalid date key/);
  assert.deepEqual(it, snapshot);
  assert.equal(moveOnce(db, 'missing', TODAY), null);
});

test('prune deletes records older than 400 days and once items resolved over 30 days ago', () => {
  const db = emptyDb();
  const ago = (n) => addDays(TODAY, -n);
  const daily = addItem(db, { title: 'daily', repeat: { type: 'daily' }, created: '2024-01-01' });
  const weekly = addItem(db, { title: 'weekly', scope: 'week', repeat: { type: 'weekly' }, created: '2024-01-01' });
  const once = (title, date, extra) => addItem(db, { title, repeat: { type: 'once', date }, created: '2024-01-01', ...extra });

  // recurring records: by occurrence date
  db.done[`${daily.id}@${ago(401)}`] = { at: localNoon(ago(401)) };
  db.done[`${daily.id}@${ago(400)}`] = { at: localNoon(ago(400)) };
  db.done[`${daily.id}@${ago(5)}`] = { at: localNoon(ago(5)) };
  // week records: by the week's Sunday
  let sunday = ago(401);
  while (isoWeekday(sunday) !== 7) sunday = addDays(sunday, -1);
  const oldWeek = weekKey(sunday);
  const keptWeek = weekKey(ago(400)); // its Sunday is at most 400 days ago
  db.done[`${weekly.id}@${oldWeek}`] = { at: 0 };
  db.done[`${weekly.id}@${keptWeek}`] = { at: 0 };
  // orphan record of a deleted item still ages out
  db.done[`gone@${ago(500)}`] = { at: 0 };

  const doneLongAgo = once('done 40d ago', ago(40));
  db.done[`${doneLongAgo.id}@${ago(40)}`] = { at: localNoon(ago(40)) };
  const lateTick = once('dated 40d ago, ticked today', ago(40));
  db.done[`${lateTick.id}@${ago(40)}`] = { at: localNoon(TODAY) };
  const earlyTick = once('future, ticked 40d ago', addDays(TODAY, 10));
  db.done[`${earlyTick.id}@${addDays(TODAY, 10)}`] = { at: localNoon(ago(40)) };
  const edge31 = once('31d', ago(31));
  db.done[`${edge31.id}@${ago(31)}`] = { at: localNoon(ago(31)) };
  const edge30 = once('30d', ago(30));
  db.done[`${edge30.id}@${ago(30)}`] = { at: localNoon(ago(30)) };
  const open = once('unfinished 60d ago', ago(60));
  const skipped = once('skipped 40d ago', ago(40));
  db.done[`${skipped.id}@${ago(40)}`] = { at: localNoon(ago(40)), skip: true };
  const unknownAt = once('done, unknown time', ago(40));
  db.done[`${unknownAt.id}@${ago(40)}`] = { at: 0 };
  const ancient = once('dated 500d ago, ticked 10d ago', ago(500));
  db.done[`${ancient.id}@${ago(500)}`] = { at: localNoon(ago(10)) };
  const weekOnce = addItem(db, { title: 'week once', scope: 'week', repeat: { type: 'once', week: weekKey(ago(45)) }, created: '2024-01-01' });
  db.done[`${weekOnce.id}@${weekKey(ago(45))}`] = { at: localNoon(ago(45)) };

  const result = prune(db, TODAY);

  assert.deepEqual(db.items.map((i) => i.title).sort(), [
    '30d', 'daily', 'dated 40d ago, ticked today', 'dated 500d ago, ticked 10d ago',
    'future, ticked 40d ago', 'unfinished 60d ago', 'weekly',
  ].sort());
  assert.deepEqual(Object.keys(db.done).sort(), [
    `${daily.id}@${ago(400)}`, `${daily.id}@${ago(5)}`, `${weekly.id}@${keptWeek}`,
    `${lateTick.id}@${ago(40)}`, `${earlyTick.id}@${addDays(TODAY, 10)}`, `${edge30.id}@${ago(30)}`,
    `${ancient.id}@${ago(500)}`,
  ].sort());
  assert.deepEqual(result, { items: 5, entries: 8 });
  // the kept unfinished task is still overdue, the old finished one did not come back
  assert.deepEqual(titles(tasksForDay(db, TODAY, { today: TODAY }).filter((e) => e.overdue)), ['unfinished 60d ago']);
  assert.ok(open);

  assert.deepEqual(prune(db, TODAY), { items: 0, entries: 0 });
  assert.throws(() => prune(db, 'nope'), /Invalid date key/);
});

// ---------------------------------------------------------------------------
// validate

test('validate turns garbage into an empty db', () => {
  for (const garbage of [null, undefined, 0, 42, NaN, '', 'garbage', '{"v":1', '[1,2]', [], [1, 2], true, false,
    () => {}, Symbol('x'), new Date(0), { v: 99 }]) {
    assert.deepEqual(validate(garbage), emptyDb(), String(typeof garbage));
  }
});

test('validate never throws, even on hostile objects', () => {
  const hostile = {};
  Object.defineProperty(hostile, 'items', { enumerable: true, get() { throw new Error('boom'); } });
  assert.deepEqual(validate(hostile), emptyDb());
  const cyclic = { items: [] };
  cyclic.items.push({ title: 'loop', repeat: { type: 'daily' }, created: TODAY, self: cyclic });
  assert.equal(validate(cyclic).items.length, 1);
});

test('validate repairs a partial db and parses JSON strings', () => {
  const partial = { items: [{ title: 'x', repeat: { type: 'daily' }, created: '2026-11-01' }] };
  const db = validate(partial);
  assert.equal(db.v, 1);
  assert.deepEqual(db.done, {});
  assert.equal(db.items.length, 1);
  assert.match(db.items[0].id, /^i[0-9a-z]+$/);
  assert.equal(db.items[0].scope, 'day');
  const fromJson = validate(JSON.stringify({ v: 1, items: [{ id: 'k', title: 'j', repeat: { type: 'daily' }, created: TODAY }], done: { [`k@${TODAY}`]: { at: 5 } } }));
  assert.equal(fromJson.items[0].id, 'k');
  assert.deepEqual(fromJson.done, { [`k@${TODAY}`]: { at: 5 } });
});

test('validate drops items without a title or with an invalid repeat', () => {
  const db = validate({
    items: [
      null, 'string', 42, [],
      { repeat: { type: 'daily' }, created: TODAY },
      { title: '', repeat: { type: 'daily' }, created: TODAY },
      { title: '   ', repeat: { type: 'daily' }, created: TODAY },
      { title: {}, repeat: { type: 'daily' }, created: TODAY },
      { title: 'no repeat', created: TODAY },
      { title: 'empty days', repeat: { type: 'weekly', days: [] }, created: TODAY },
      { title: 'bad type', repeat: { type: 'hourly' }, created: TODAY },
      { title: 'week daily', scope: 'week', repeat: { type: 'daily' }, created: TODAY },
      { title: 'bad once', repeat: { type: 'once', date: '2026-02-30' }, created: TODAY },
      { title: 'bad monthly', repeat: { type: 'monthly', day: 0 }, created: TODAY },
      { title: 'kept', repeat: { type: 'daily' }, created: TODAY },
    ],
  });
  assert.deepEqual(db.items.map((i) => i.title), ['kept']);
});

test('validate coerces types where sensible', () => {
  const db = validate({
    v: '1',
    items: [
      { id: 7, title: 123, repeat: { type: 'monthly', day: '15' }, created: '2026-11-01', order: '2', paused: 'true' },
      { id: 'w', title: 'days', repeat: { type: 'weekly', days: ['3', 1, 1] }, created: '2026-11-01', paused: false, order: 'x', until: 'nope' },
      { id: 'o', title: 'once, no created', repeat: { type: 'once', date: '2026-11-20' } },
      { id: 'wk', title: 'week, no scope', repeat: { type: 'once', week: '2026-W47' } },
      { id: 'r', title: 'recurring, no created', repeat: { type: 'daily', every: '2' }, created: 'yesterday' },
      { id: 'y', title: 'yearly', scope: 'bogus', repeat: { type: 'yearly', month: '2', day: '29' }, created: TODAY },
      { id: 'bw', title: 'weekly without days, no scope', repeat: { type: 'weekly', every: 2 }, created: TODAY },
    ],
  });
  const [m, w, o, wk, r, y, bw] = db.items;
  assert.equal(bw.scope, 'week');
  assert.deepEqual(bw.repeat, { type: 'weekly', every: 2 });
  assert.deepEqual(m, { id: '7', title: '123', scope: 'day', repeat: { type: 'monthly', day: 15 }, created: '2026-11-01', paused: true, order: 2 });
  assert.deepEqual(w, { id: 'w', title: 'days', scope: 'day', repeat: { type: 'weekly', days: [1, 3] }, created: '2026-11-01' });
  assert.equal(o.created, '2026-11-20');
  assert.equal(wk.scope, 'week');
  assert.equal(wk.created, '2026-11-16'); // Monday of that week
  assert.deepEqual(r.repeat, { type: 'daily', every: 2 });
  assert.equal(r.created, todayKey());
  assert.equal(y.scope, 'day');
  assert.deepEqual(y.repeat, { type: 'yearly', month: 2, day: 29 });
});

test('validate fixes ids, accepts items as a map, and keeps unknown fields', () => {
  const db = validate({
    settings: { theme: 'neon' },
    items: {
      a: { id: 'dup', title: 'first', repeat: { type: 'daily' }, created: TODAY, color: 'pink' },
      b: { id: 'dup', title: 'second', repeat: { type: 'daily' }, created: TODAY },
      c: { title: 'no id', repeat: { type: 'daily' }, created: TODAY },
      d: { id: '', title: 'empty id', repeat: { type: 'daily' }, created: TODAY },
    },
  });
  assert.deepEqual(db.settings, { theme: 'neon' });
  assert.deepEqual(db.items.map((i) => i.title), ['first', 'second', 'no id', 'empty id']);
  assert.equal(db.items[0].id, 'dup');
  assert.equal(db.items[0].color, 'pink');
  assert.equal(new Set(db.items.map((i) => i.id)).size, 4);
  assert.ok(db.items.every((i) => typeof i.id === 'string' && i.id));
});

test('validate cleans done records', () => {
  const db = validate({
    items: [],
    done: {
      nokey: { at: 1 },
      'x@notadate': { at: 1 },
      '@2026-11-17': { at: 1 },
      'x@2026-02-30': { at: 1 },
      'x@2025-W53': { at: 1 },
      'a@2026-11-17': { at: 10 },
      'b@2026-11-17': { at: '20' },
      'c@2026-11-17': true,
      'd@2026-11-17': 30,
      'e@2026-W47': { at: 40, skip: true },
      'f@2026-11-17': { skip: 1 },
      'g@2026-11-17': { at: 'soon', skip: false },
      'h@2026-11-17': false,
      'i@2026-11-17': null,
      'j@2026-11-17': 'done',
      'k@2026-11-17': [1],
    },
  });
  assert.deepEqual(db.done, {
    'a@2026-11-17': { at: 10 },
    'b@2026-11-17': { at: 20 },
    'c@2026-11-17': { at: 0 },
    'd@2026-11-17': { at: 30 },
    'e@2026-W47': { at: 40, skip: true },
    'f@2026-11-17': { at: 0, skip: true },
    'g@2026-11-17': { at: 0 },
  });
});

test('validate does not mutate its input and is idempotent', () => {
  const input = {
    items: [
      { id: 'a', title: ' a ', repeat: { type: 'weekly', days: ['2', 1] }, created: '2026-11-01', extra: { deep: [1] } },
      { id: 'b', title: 'b', scope: 'week', repeat: { type: 'weekly', every: 2 }, created: '2026-11-01', until: '2027-01-01' },
    ],
    done: { 'a@2026-11-17': { at: '5' } },
  };
  const copy = structuredClone(input);
  const once = validate(input);
  assert.deepEqual(input, copy);
  assert.deepEqual(validate(once), once);
  assert.deepEqual(validate(JSON.parse(JSON.stringify(once))), once);
  assert.notEqual(once.items[0].extra, undefined);
});

// Deterministic PRNG so fuzz failures are reproducible.
function mulberry32(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('validate survives fuzzed input and always yields items the strict API accepts', () => {
  const rand = mulberry32(12345);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const atoms = [null, undefined, 0, -1, 1, 2, 3, 7, 8, 15, 29, 31, 32, 1.5, NaN, Infinity, '', 'x', '1', '-1', '15',
    '2026-11-17', '2026-W47', '2026-02-30', '2025-W53', true, false, 'once', 'daily', 'weekly', 'monthly', 'yearly',
    'day', 'week', 'true'];
  const keys = ['v', 'items', 'done', 'id', 'title', 'scope', 'repeat', 'type', 'date', 'week', 'every', 'days',
    'day', 'month', 'created', 'until', 'paused', 'order', 'at', 'skip', 'i1@2026-11-17', 'x@2026-W47'];
  const garbage = (depth) => {
    const r = rand();
    if (depth > 3 || r < 0.35) return pick(atoms);
    if (r < 0.5) return Array.from({ length: Math.floor(rand() * 4) }, () => garbage(depth + 1));
    const o = {};
    for (let i = Math.floor(rand() * 6); i > 0; i--) o[pick(keys)] = garbage(depth + 1);
    return o;
  };
  const itemish = () => ({
    id: pick(['i1', 'i2', 7, '', undefined]),
    title: pick(['Task', '', 5, null, '  t  ']),
    scope: pick(['day', 'week', undefined, 'x']),
    repeat: rand() < 0.7
      ? { type: pick(['once', 'daily', 'weekly', 'monthly', 'yearly', 'x']), date: pick(atoms), week: pick(atoms),
        every: pick(atoms), days: rand() < 0.5 ? [pick(atoms), pick(atoms)] : pick(atoms), day: pick(atoms), month: pick(atoms) }
      : garbage(1),
    created: pick(atoms),
    until: pick(atoms),
    paused: pick(atoms),
    order: pick(atoms),
  });

  let survivors = 0;
  for (let i = 0; i < 600; i++) {
    const input = i % 3 === 0
      ? garbage(0)
      : { v: pick(atoms), items: Array.from({ length: 5 }, itemish), done: garbage(1) };

    // queries never throw on unvalidated data either
    assert.doesNotThrow(() => tasksForDay(input, TODAY, { today: TODAY }));
    assert.doesNotThrow(() => tasksForWeek(input, '2026-W47'));

    const db = validate(input);
    assert.equal(db.v, 1);
    assert.ok(Array.isArray(db.items));
    assert.ok(db.done && typeof db.done === 'object' && !Array.isArray(db.done));
    assert.equal(new Set(db.items.map((x) => x.id)).size, db.items.length);
    for (const it of db.items) {
      survivors++;
      assert.doesNotThrow(() => addItem(emptyDb(), it), JSON.stringify(it));
      assert.equal(typeof describeRepeat(it), 'string');
      assert.notEqual(describeRepeat(it), '');
      assert.doesNotThrow(() => streak(db, it, TODAY));
      assert.doesNotThrow(() => nextOccurrence(it, TODAY));
    }
    for (const [key, rec] of Object.entries(db.done)) {
      assert.match(key, /^.+@(\d{4}-\d{2}-\d{2}|\d{4}-W\d{2})$/);
      assert.equal(typeof rec.at, 'number');
    }
    assert.deepEqual(validate(db), db);
    assert.doesNotThrow(() => weekOverview(db, '2026-W47', { today: TODAY }));
  }
  assert.ok(survivors > 50, `only ${survivors} items survived; the fuzzer is too harsh`);
});
