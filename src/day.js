// Day view: today's jobs (or any day you browse to), quick add, progress segments.
import { todayKey, addDays, tasksForDay, addItem } from './schedule.js';
import { h, ICON, iconBtn, dayLabel, microText } from './ui.js';
import { taskRow, celebrate } from './rows.js';

export function mountDay(app) {
  const { ctx, store, root } = app;
  let viewDate = todayKey();

  const meta = h('span', { class: 'ct-bar-meta' });
  const todayBtn = h('button', { class: 'ct-ibtn text', title: 'Back to today', onclick: () => go(todayKey()) }, 'TODAY');
  const expandBtn = iconBtn('expand', 'Expand', () => ctx.frame.toggleExpand());
  const bar = h('header', { class: 'ct-bar', 'data-ws-drag': '' },
    h('i', { class: 'ct-bar-icon' }), h('span', { class: 'ct-bar-title' }, 'Daily Jobs'), meta,
    h('span', { class: 'ct-bar-spacer' }), todayBtn,
    iconBtn('prev', 'Previous day', () => go(addDays(viewDate, -1))),
    iconBtn('next', 'Next day', () => go(addDays(viewDate, 1))),
    iconBtn('gear', 'Routines and options', () => app.openEditor({ tab: 'routines' })),
    expandBtn);

  const count = h('div', { class: 'ct-count' });
  const seg = h('div', { class: 'ct-seg' });
  const list = h('div', { class: 'ct-list' });
  const input = h('input', { class: 'ct-input', placeholder: 'Add job', maxlength: 160 });
  const form = h('form', { class: 'ct-add' },
    h('span', { class: 'ct-add-prompt' }, '>'), input,
    iconBtn('repeat', 'Make it a routine (repeat on days)', () => {
      app.openEditor({ tab: 'routines', newTitle: input.value.trim() || null });
      input.value = '';
    }),
    iconBtn('plus', 'Add', () => form.requestSubmit()));
  form.onsubmit = (ev) => {
    ev.preventDefault();
    const title = input.value.trim();
    if (!title) return;
    input.value = '';
    const item = store.mutate((db) => addItem(db, { order: Date.now(), title, scope: 'day', repeat: { type: 'once', date: viewDate } }));
    list.querySelector(`[data-id="${item.id}"]`)?.classList.add('enter');
  };
  const micro = h('div', { class: 'ct-micro' }, h('i', { class: 'bars' }), h('span', { class: 'grow' }), h('span', { class: 'warn' }));

  root.append(h('div', { class: 'ct-shell' }), bar, h('div', { class: 'ct-sub' }, count, seg), h('div', { class: 'ct-rule' }), list, form, micro);

  function entries() {
    const today = todayKey();
    const all = tasksForDay(store.db, viewDate, { today, carryOver: store.prefs.carryOver });
    const rank = (e) => (e.skipped ? 3 : e.done ? (store.prefs.doneAtBottom ? 2 : 1) : e.overdue ? 0 : 1);
    return all.map((e, i) => ({ e, i })).sort((a, b) => rank(a.e) - rank(b.e) || a.i - b.i).map((x) => x.e);
  }

  function render() {
    const today = todayKey();
    const es = entries();
    const active = es.filter((e) => !e.skipped);
    const done = active.filter((e) => e.done).length;

    meta.textContent = dayLabel(viewDate) + (viewDate === today ? '' : viewDate < today ? ' · LOG' : ' · PLANNED');
    todayBtn.style.display = viewDate === today ? 'none' : '';
    expandBtn.innerHTML = ICON[ctx.frame.isExpanded() ? 'collapse' : 'expand'];

    count.innerHTML = `<b>${String(done).padStart(2, '0')}</b><span class="of">/${String(active.length).padStart(2, '0')}</span>Complete`;
    seg.replaceChildren();
    seg.className = 'ct-seg' + (active.length > 16 ? ' bar' : '');
    if (active.length > 16) seg.style.setProperty('--p', done / active.length);
    else for (let i = 0; i < Math.max(active.length, 1); i++) seg.append(h('i', { class: i < done ? 'on' : '' }));

    list.replaceChildren();
    if (!es.length) {
      list.append(h('div', { class: 'ct-empty' }, h('b', {}, viewDate < today ? 'No records' : 'No jobs'),
        viewDate < today ? 'Nothing was logged for this day' : 'Type below to add one'));
    }
    let shownDoneSep = false;
    for (const e of es) {
      if ((e.done || e.skipped) && !shownDoneSep && store.prefs.doneAtBottom && es.some((x) => !x.done && !x.skipped)) {
        list.append(h('div', { class: 'ct-sep' }, 'Completed'));
        shownDoneSep = true;
      }
      list.append(taskRow(app, e));
    }

    const left = active.length - done;
    const mt = microText(viewDate);
    micro.children[1].textContent = mt.text;
    micro.children[1].title = mt.title;
    micro.children[2].textContent = left ? `${left} PENDING` : active.length ? 'SYNC OK' : 'IDLE';
  }

  function go(date) {
    viewDate = date;
    render();
  }

  // Celebrate only when the last open job of the day being viewed is ticked.
  app.checkAllDone = () => {
    const active = entries().filter((e) => !e.skipped);
    if (active.length && active.every((e) => e.done)) celebrate(app);
  };

  store.subscribe(render);
  ctx.on('expand', render);
  ctx.on('collapse', render);
  render();

  return {
    rollover(newToday) {
      // Follow the new day if the user was looking at "today".
      if (viewDate === addDays(newToday, -1)) viewDate = newToday;
      render();
    },
  };
}
