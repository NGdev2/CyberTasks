// Routines editor + options, styled after the game's settings screen.
// Edits apply immediately (no Save button), like the in-game settings.
import {
  todayKey, addDays, weekKey, weekDays, addWeeks, daysInMonth, isoWeekday,
  addItem, updateItem, removeItem, describeRepeat, nextOccurrence, occursInWeek, streak,
} from './schedule.js';
import { h, ICON, WEEKDAYS, MONTHS, dayLabel, shortDate, weekNumber } from './ui.js';

const DAY_REPEATS = [['daily', 'Every day'], ['weekly', 'Days of week'], ['monthly', 'Day of month'], ['yearly', 'Date each year'], ['once', 'On one date']];
const WEEK_REPEATS = [['weekly', 'Every week'], ['once', 'One week only']];

const GROUPS = [
  ['Daily', (it) => it.scope === 'day' && it.repeat.type === 'daily'],
  ['Days of week', (it) => it.scope === 'day' && it.repeat.type === 'weekly'],
  ['Monthly', (it) => it.scope === 'day' && it.repeat.type === 'monthly'],
  ['Yearly', (it) => it.scope === 'day' && it.repeat.type === 'yearly'],
  ['Dated', (it, today) => it.scope === 'day' && it.repeat.type === 'once' && it.repeat.date > today],
  ['Week goals', (it, today) => it.scope === 'week' && (it.repeat.type === 'weekly' || it.repeat.week >= weekKey(today))],
];

const ordinal = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
function addMonths(key, n) {
  const [y, m, d] = key.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const ny = t.getUTCFullYear(), nm = t.getUTCMonth() + 1;
  return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(d, daysInMonth(ny, nm))).padStart(2, '0')}`;
}
const fullDate = (key) => `${dayLabel(key)}.${key.slice(0, 4)}`;

// ---------------------------------------------------------------- small controls
function sel(text, onPrev, onNext, small = false) {
  return h('div', { class: 'ct-sel' + (small ? ' small' : '') },
    h('button', { title: 'Previous', html: ICON.prev, onclick: onPrev }),
    h('output', {}, text),
    h('button', { title: 'Next', html: ICON.next, onclick: onNext }));
}
function toggle(on, onChange) {
  return h('button', { class: 'ct-toggle' + (on ? ' on' : ''), onclick: () => onChange(!on) }, on ? 'On' : 'Off', h('i'));
}
function field(label, ...value) {
  return h('div', { class: 'ct-field' }, h('label', {}, label), h('div', { class: 'ct-value' }, ...value));
}
function presets(list) {
  return h('div', { class: 'ct-presets' }, list.map(([label, fn]) => h('button', { onclick: fn }, label)));
}

// ---------------------------------------------------------------- editor
export function openEditor(app, opts = {}) {
  const { ctx, store, root } = app;
  root.querySelector('.ct-ed')?.__close?.();

  const today = todayKey();
  const state = { tab: opts.tab || 'routines', sel: opts.select || null };

  // Creating / converting happens up front so the form shows the real item.
  if ('newTitle' in opts) {
    state.sel = store.mutate((db) => addItem(db, { order: Date.now(), title: opts.newTitle || 'New routine', scope: 'day', repeat: { type: 'daily' } })).id;
    state.focusName = !opts.newTitle;
  } else if (opts.convert && state.sel) {
    const it = store.db.items.find((i) => i.id === state.sel);
    if (it?.repeat.type === 'once') {
      const start = it.scope === 'day' ? (it.repeat.date < today ? today : it.repeat.date) : today;
      store.mutate((db) => updateItem(db, it.id, it.scope === 'day'
        ? { repeat: { type: 'weekly', days: [isoWeekday(start)] }, created: start }
        : { repeat: { type: 'weekly' } }));
    }
  }

  // A small widget opens the editor full screen and returns afterwards.
  const expandedByUs = !ctx.frame.isExpanded() && (root.clientWidth < 760 || root.clientHeight < 480);
  if (expandedByUs) ctx.frame.expand();

  const tabs = h('nav', { class: 'ct-ed-tabs' });
  const body = h('div', { class: 'ct-ed-body' });
  const foot = h('div', { class: 'ct-ed-foot' });
  const win = h('div', { class: 'ct-ed-win' }, h('div', { class: 'ct-shell' }), tabs, body, foot);
  const ed = h('div', { class: 'ct-ed' }, win);
  ed.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); });
  ed.addEventListener('pointerdown', (e) => { if (e.target === ed) close(); });
  root.append(ed);

  let listEl, formEl;
  const editingText = () => {
    const a = ctx.shadow.activeElement;
    return !!a && a.tagName === 'INPUT' && formEl?.contains(a);
  };
  const item = () => store.db.items.find((i) => i.id === state.sel) || null;
  const update = (patch) => {
    try { store.mutate((db) => updateItem(db, state.sel, patch)); } catch (e) { ctx.log('update rejected', String(e)); }
    renderForm();
  };

  function render() {
    tabs.replaceChildren(
      h('span', { class: 'num' }, '1'),
      ...[['routines', 'Routines'], ['options', 'Options']].map(([id, label]) =>
        h('button', { class: 'ct-tab' + (state.tab === id ? ' on' : ''), onclick: () => { state.tab = id; render(); } }, label)),
      h('span', { class: 'num' }, '3'));
    body.replaceChildren();
    body.classList.toggle('even', state.tab === 'options');
    foot.replaceChildren();
    if (state.tab === 'routines') renderRoutines(); else renderOptions();
    foot.append(h('span', { class: 'grow' }),
      h('span', { class: 'ct-key' }, h('kbd', {}, 'ESC'), 'Close'));
    const closeBtn = h('button', { class: 'ct-btn ghost', onclick: close }, 'Close');
    foot.append(closeBtn);
  }

  // ---------------------------------------------------------------- routines tab
  function renderRoutines() {
    listEl = h('div', { class: 'ct-ed-list' });
    formEl = h('div', { class: 'ct-ed-form' });
    body.append(
      h('section', { class: 'ct-ed-col' }, h('div', { class: 'ct-ed-head' }, 'Routines', h('small', { class: 'count' })), listEl),
      h('section', { class: 'ct-ed-col' }, h('div', { class: 'ct-ed-head' }, 'Settings', h('small', {}, 'Applied instantly')), formEl));
    foot.append(
      h('button', { class: 'ct-btn cyan', onclick: () => {
        state.sel = store.mutate((db) => addItem(db, { order: Date.now(), title: 'New routine', scope: 'day', repeat: { type: 'daily' } })).id;
        state.focusName = true;
        renderList(); renderForm();
      } }, '+ New routine'),
      h('button', { class: 'ct-btn', onclick: () => {
        if (!state.sel) return;
        const ids = visibleIds();
        const idx = ids.indexOf(state.sel);
        store.mutate((db) => removeItem(db, state.sel));
        state.sel = ids[idx + 1] || ids[idx - 1] || null;
        renderList(); renderForm();
      } }, 'Delete'));
    renderList();
    renderForm();
  }

  // The item being edited stays listed even when it fits no group (e.g. a one-off for today).
  function groups() {
    const t = todayKey();
    const out = GROUPS.map(([label, test]) => [label, store.db.items.filter((it) => test(it, t))]);
    const sel = item();
    if (sel && !out.some(([, items]) => items.includes(sel))) out.unshift(['Editing', [sel]]);
    return out;
  }
  const visibleIds = () => groups().flatMap(([, items]) => items.map((it) => it.id));

  function renderList() {
    if (!listEl) return;
    listEl.replaceChildren();
    let n = 0;
    for (const [label, items] of groups()) {
      if (!items.length) continue;
      listEl.append(h('div', { class: 'ct-sep' }, label));
      for (const it of items) {
        n++;
        listEl.append(h('button', {
          class: 'ct-ed-item' + (it.id === state.sel ? ' on' : '') + (it.paused ? ' paused' : ''),
          onclick: () => { state.sel = it.id; renderList(); renderForm(); },
        }, h('b', {}, it.title), h('span', {}, describeRepeat(it) + (it.paused ? ' · paused' : ''))));
      }
    }
    if (!n) listEl.append(h('div', { class: 'ct-empty' }, h('b', {}, 'No routines'), 'Create one: + New routine'));
    body.querySelector('.count').textContent = `${n} ACTIVE`;
  }

  function renderForm() {
    if (!formEl) return;
    const it = item();
    formEl.replaceChildren();
    if (!it) { formEl.append(h('div', { class: 'ct-empty' }, h('b', {}, 'Select a routine'), 'or create a new one')); return; }
    const r = it.repeat;
    const t = todayKey();

    // name
    const name = h('input', { class: 'ct-text-input', value: it.title, maxlength: 160, placeholder: 'Routine name' });
    let nameTimer = 0;
    name.oninput = () => {
      clearTimeout(nameTimer);
      nameTimer = setTimeout(() => { if (name.value.trim()) { store.mutate((db) => updateItem(db, it.id, { title: name.value.trim() })); } }, 250);
    };
    name.onkeydown = (e) => { if (e.key === 'Enter') name.blur(); };
    formEl.append(field('Name', name));

    // scope
    formEl.append(field('Type', sel(it.scope === 'day' ? 'Day task' : 'Week goal', flipScope, flipScope)));
    function flipScope() {
      update(it.scope === 'day'
        ? { scope: 'week', repeat: { type: 'weekly' } }
        : { scope: 'day', repeat: { type: 'daily' } });
    }

    // repeat type
    const kinds = it.scope === 'day' ? DAY_REPEATS : WEEK_REPEATS;
    const ki = Math.max(0, kinds.findIndex(([k]) => k === r.type));
    const stepKind = (d) => update({ repeat: defaultRepeat(it, kinds[(ki + d + kinds.length) % kinds.length][0]) });
    formEl.append(field('Repeat', sel(kinds[ki][1], () => stepKind(-1), () => stepKind(1))));

    // type specific
    if (it.scope === 'day') {
      if (r.type === 'daily') {
        const every = r.every || 1;
        const set = (n) => update({ repeat: { type: 'daily', every: Math.min(30, Math.max(1, n)) } });
        formEl.append(field('Every', sel(every === 1 ? 'Day' : `${every} days`, () => set(every - 1), () => set(every + 1))));
      } else if (r.type === 'weekly') {
        const days = new Set(r.days);
        const pick = h('div', { class: 'ct-daypick' }, WEEKDAYS.map((label, i) => h('button', {
          class: days.has(i + 1) ? 'on' : '', title: label,
          onclick: () => {
            const next = new Set(days);
            if (next.has(i + 1)) { if (next.size > 1) next.delete(i + 1); } else next.add(i + 1);
            update({ repeat: { type: 'weekly', days: [...next].sort() } });
          },
        }, label.slice(0, 2))));
        formEl.append(field('Days', pick),
          field('', presets([['Weekdays', () => update({ repeat: { type: 'weekly', days: [1, 2, 3, 4, 5] } })],
            ['Weekend', () => update({ repeat: { type: 'weekly', days: [6, 7] } })],
            ['All', () => update({ repeat: { type: 'weekly', days: [1, 2, 3, 4, 5, 6, 7] } })]])));
      } else if (r.type === 'monthly') {
        // cycle 1..31, then "last day" (-1)
        const seq = [...Array.from({ length: 31 }, (_, i) => i + 1), -1];
        const i = seq.indexOf(r.day);
        const set = (d) => update({ repeat: { type: 'monthly', day: seq[(i + d + seq.length) % seq.length] } });
        formEl.append(field('Day of month', sel(r.day === -1 ? 'Last day' : ordinal(r.day), () => set(-1), () => set(1))));
        if (r.day > 28) formEl.append(field('', h('span', { class: 'ct-note' }, 'Shorter months use their last day')));
      } else if (r.type === 'yearly') {
        const max = daysInMonth(2024, r.month); // leap year: Feb 29 allowed
        const setDay = (d) => update({ repeat: { ...r, day: ((r.day - 1 + d + max) % max) + 1 } });
        const setMonth = (d) => {
          const month = ((r.month - 1 + d + 12) % 12) + 1;
          update({ repeat: { ...r, month, day: Math.min(r.day, daysInMonth(2024, month)) } });
        };
        formEl.append(field('Date', sel(String(r.day).padStart(2, '0'), () => setDay(-1), () => setDay(1), true),
          sel(MONTHS[r.month - 1], () => setMonth(-1), () => setMonth(1), true)));
      } else if (r.type === 'once') {
        const set = (date) => update({ repeat: { type: 'once', date } });
        formEl.append(
          field('Date', sel(fullDate(r.date), () => set(addDays(r.date, -1)), () => set(addDays(r.date, 1))),
            sel(MONTHS[Number(r.date.slice(5, 7)) - 1], () => set(addMonths(r.date, -1)), () => set(addMonths(r.date, 1)), true)),
          field('', presets([['Today', () => set(t)], ['Tomorrow', () => set(addDays(t, 1))],
            ['Next Mon', () => set(addDays(t, 8 - isoWeekday(t)))], ['+1 week', () => set(addDays(r.date, 7))]])));
      }
    } else if (r.type === 'weekly') {
      const every = r.every || 1;
      const set = (n) => update({ repeat: { type: 'weekly', every: Math.min(8, Math.max(1, n)) } });
      formEl.append(field('Every', sel(every === 1 ? 'Week' : `${every} weeks`, () => set(every - 1), () => set(every + 1))));
    } else {
      const set = (week) => update({ repeat: { type: 'once', week } });
      formEl.append(field('Week', sel(`W${weekNumber(r.week)} · ${shortDate(weekDays(r.week)[0])}`, () => set(addWeeks(r.week, -1)), () => set(addWeeks(r.week, 1)))));
    }

    // start / end for recurring items
    if (r.type !== 'once') {
      const setStart = (created) => update({ created });
      formEl.append(field('Starts', sel(fullDate(it.created), () => setStart(addDays(it.created, -1)), () => setStart(addDays(it.created, 1))),
        presets([['Today', () => setStart(t)]])));
      const hasEnd = !!it.until;
      const ends = [toggle(hasEnd, (on) => update({ until: on ? addMonths(t, 1) : null }))]  // null removes the field;
      if (hasEnd) ends.push(sel(fullDate(it.until), () => update({ until: addDays(it.until, -1) }), () => update({ until: addDays(it.until, 1) })),
        presets([['+1 M', () => update({ until: addMonths(it.until, 1) })]]));
      formEl.append(field('End date', ...ends));
    }
    formEl.append(field('Paused', toggle(!!it.paused, (on) => update({ paused: on }))));

    // preview
    formEl.append(field('Next', h('span', { class: 'ct-note', html: preview(it) })));
    if (it.scope === 'day' && r.type !== 'once') {
      formEl.append(field('Streak', h('span', { class: 'ct-note', html: `<b>${streak(store.db, it, t)}</b> in a row` })));
    }

    if (state.focusName) { state.focusName = false; setTimeout(() => { name.focus(); name.select(); }); }
  }

  function preview(it) {
    if (it.paused) return 'Paused';
    const out = [];
    if (it.scope === 'day') {
      let from = todayKey();
      while (out.length < 3) {
        const n = nextOccurrence(it, from);
        if (!n) break;
        out.push(dayLabel(n));
        from = addDays(n, 1);
      }
    } else {
      let w = weekKey(todayKey());
      for (let i = 0; i < 60 && out.length < 3; i++, w = addWeeks(w, 1)) if (occursInWeek(it, w)) out.push('W' + weekNumber(w));
    }
    return out.length ? out.map((s) => `<b>${s}</b>`).join(' · ') : 'No upcoming dates';
  }

  function defaultRepeat(it, type) {
    const t = todayKey();
    const anchor = it.repeat.date && it.repeat.date >= t ? it.repeat.date : t;
    const [, m, d] = anchor.split('-').map(Number);
    if (it.scope === 'week') return type === 'once' ? { type: 'once', week: weekKey(t) } : { type: 'weekly' };
    return {
      daily: { type: 'daily' },
      weekly: { type: 'weekly', days: [isoWeekday(anchor)] },
      monthly: { type: 'monthly', day: d },
      yearly: { type: 'yearly', month: m, day: d },
      once: { type: 'once', date: anchor },
    }[type];
  }

  // ---------------------------------------------------------------- options tab
  function renderOptions() {
    listEl = formEl = null;
    const p = store.prefs;
    const set = (k) => (v) => store.setPref(k, v);
    const hourSel = (k) => sel(`${String(p[k]).padStart(2, '0')}:00`, () => store.setPref(k, (p[k] + 23) % 24), () => store.setPref(k, (p[k] + 1) % 24), true);
    const col = (title, rows) => h('section', { class: 'ct-ed-col' }, h('div', { class: 'ct-ed-head' }, title), h('div', { class: 'ct-ed-form' }, rows));
    body.append(
      col('Tasks', [
        field('Carry over unfinished jobs', toggle(p.carryOver, set('carryOver'))),
        field('Completed jobs at the bottom', toggle(p.doneAtBottom, set('doneAtBottom'))),
        field('Morning briefing', p.briefing ? hourSel('briefHour') : null, toggle(p.briefing, set('briefing'))),
        field('Evening reminder', p.reminder ? hourSel('remindHour') : null, toggle(p.reminder, set('reminder'))),
      ]),
      col('Interface', [
        field('Celebrate completed days', toggle(p.celebrate, set('celebrate'))),
        field('Glitch effects', toggle(p.glitch, set('glitch'))),
        field('Decorative elements', toggle(p.decor, set('decor'))),
        field('Data', h('span', { class: 'ct-note', html: `<b>${store.db.items.length}</b> items · stored locally` })),
      ]));
  }

  // ---------------------------------------------------------------- lifecycle
  const unsub = store.subscribe(() => {
    if (state.tab === 'options') { render(); return; }
    renderList();
    if (!editingText()) renderForm();
  });
  const offKey = ctx.on('key', (k) => { if (k.key === 'Escape' && k.type === 'keydown') close(); });
  const offCollapse = ctx.on('collapse', () => close(true));

  let closed = false;
  function close(fromCollapse = false) {
    if (closed) return;
    closed = true;
    unsub(); offKey(); offCollapse();
    ed.remove();
    if (expandedByUs && !fromCollapse) ctx.frame.collapse();
  }
  ed.__close = close;
  render();
  return close;
}
