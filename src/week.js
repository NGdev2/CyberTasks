// Week view, two modes:
//  - "plan" (default, compact like Daily Jobs): the goals planned for the week
//  - "schedule": week goals + seven day columns; one-off jobs can be dragged between days
import { todayKey, weekKey, addWeeks, addDays, weekOverview, addItem, moveOnce } from './schedule.js';
import { h, ICON, iconBtn, WEEKDAYS, dayNum, shortDate, weekNumber } from './ui.js';
import { taskRow, celebrate } from './rows.js';

export function mountWeek(app) {
  const { ctx, store, root } = app;
  let wk = weekKey(todayKey());
  let mode = ctx.storage.get('weekMode', 'plan');
  const SIZES = { plan: { w: 330, h: 380 }, schedule: { w: 940, h: 360 } };

  const meta = h('span', { class: 'ct-bar-meta' });
  const nowBtn = h('button', { class: 'ct-ibtn text', title: 'Back to this week', onclick: () => go(weekKey(todayKey())) }, 'NOW');
  const expandBtn = iconBtn('expand', 'Expand', () => ctx.frame.toggleExpand());
  const title = h('span', { class: 'ct-bar-title' });
  const modeBtn = h('button', { class: 'ct-ibtn text', onclick: () => setMode(mode === 'plan' ? 'schedule' : 'plan') });
  const bar = h('header', { class: 'ct-bar', 'data-ws-drag': '' },
    h('i', { class: 'ct-bar-icon' }), title, meta,
    h('span', { class: 'ct-bar-spacer' }), nowBtn, modeBtn,
    iconBtn('prev', 'Previous week', () => go(addWeeks(wk, -1))),
    iconBtn('next', 'Next week', () => go(addWeeks(wk, 1))),
    iconBtn('gear', 'Routines and options', () => app.openEditor({ tab: 'routines' })),
    expandBtn);

  const objLabel = h('div', { class: 'ct-label' });
  const objList = h('div', { class: 'ct-obj-list' });
  const days = h('div', { class: 'ct-days' });
  const micro = h('div', { class: 'ct-micro' }, h('i', { class: 'bars' }), h('span', { class: 'grow' }), h('span', { class: 'warn' }));
  // plan mode: the week's goals as a list, like Daily Jobs
  const planCount = h('div', { class: 'ct-count' });
  const planSeg = h('div', { class: 'ct-seg' });
  const planList = h('div', { class: 'ct-list ct-plan-only' });
  const planInput = h('input', { class: 'ct-input', placeholder: 'Add week goal', maxlength: 160 });
  const planForm = h('form', { class: 'ct-add ct-plan-only' }, h('span', { class: 'ct-add-prompt' }, '>'), planInput,
    iconBtn('plus', 'Add', () => planForm.requestSubmit()));
  planForm.onsubmit = (ev) => {
    ev.preventDefault();
    const t = planInput.value.trim();
    if (!t) return;
    planInput.value = '';
    store.mutate((db) => addItem(db, { order: Date.now(), title: t, scope: 'week', repeat: { type: 'once', week: wk } }));
  };
  root.append(h('div', { class: 'ct-shell' }), bar,
    h('div', { class: 'ct-sub ct-plan-only' }, planCount, planSeg), h('div', { class: 'ct-rule ct-plan-only' }), planList, planForm,
    h('section', { class: 'ct-obj' }, objLabel, objList), days, micro);

  // Each mode keeps its own size: switching resizes the widget (unless it is full screen).
  function setMode(next) {
    if (!ctx.frame.isExpanded()) {
      const r = ctx.frame.getRect();
      ctx.storage.set('size_' + mode, { w: r.w, h: r.h });
      const s = ctx.storage.get('size_' + next, SIZES[next]);
      ctx.frame.resize(s.w, s.h);
    }
    mode = next;
    ctx.storage.set('weekMode', mode);
    render();
  }
  // Existing big instances open in the new compact default.
  if (mode === 'plan' && !ctx.storage.get('size_plan') && ctx.frame.getRect().w > 600) ctx.frame.resize(SIZES.plan.w, SIZES.plan.h);

  // Inline "add" input used by objectives and day columns.
  function inlineAdd(container, placeholder, onAdd, cls = 'ct-add') {
    const input = h('input', { class: 'ct-input', placeholder, maxlength: 160 });
    const form = h('form', { class: cls }, h('span', { class: 'ct-add-prompt' }, '>'), input);
    form.onsubmit = (ev) => {
      ev.preventDefault();
      const v = input.value.trim();
      if (v) onAdd(v);   // re-render replaces the form
      else render();
    };
    input.onkeydown = (ev) => { if (ev.key === 'Escape') { ev.stopPropagation(); render(); } };
    input.onblur = () => setTimeout(() => { if (form.isConnected && !input.value.trim()) render(); }, 120);
    container.replaceWith(form);
    input.focus();
  }

  function render() {
    const today = todayKey();
    const ov = weekOverview(store.db, wk, { today, carryOver: store.prefs.carryOver });
    const first = ov.days[0].date, last = ov.days[6].date;
    meta.innerHTML = `<b>W${weekNumber(wk)}</b> · ${shortDate(first)} — ${shortDate(last)}`;
    nowBtn.style.display = wk === weekKey(today) ? 'none' : '';
    expandBtn.innerHTML = ICON[ctx.frame.isExpanded() ? 'collapse' : 'expand'];
    root.classList.toggle('ct-plan', mode === 'plan');
    title.textContent = mode === 'plan' ? 'Week Plan' : 'Weekly Schedule';
    modeBtn.textContent = mode === 'plan' ? '7D' : 'PLAN';
    modeBtn.title = mode === 'plan' ? 'Show the 7-day schedule' : 'Show only the week plan';
    if (mode === 'plan') {
      const goals = ov.objectives;
      const active = goals.filter((e) => !e.skipped);
      const done = active.filter((e) => e.done).length;
      planCount.innerHTML = `<b>${String(done).padStart(2, '0')}</b><span class="of">/${String(active.length).padStart(2, '0')}</span>Goals`;
      planSeg.replaceChildren(...Array.from({ length: Math.max(active.length, 1) }, (_, i) => h('i', { class: i < done ? 'on' : '' })));
      const sorted = [...goals].sort((a, b) => (store.prefs.doneAtBottom ? (a.done || a.skipped) - (b.done || b.skipped) : 0));
      planList.replaceChildren(...(sorted.length ? sorted.map((e) => taskRow(app, e)) : [h('div', { class: 'ct-empty' }, h('b', {}, 'No plans yet'), 'What should this week achieve?')]));
      const mt = ctx.ui.micro(today);
      micro.children[1].textContent = `W${weekNumber(wk)} · ${mt.text}`;
      micro.children[1].title = mt.title;
      micro.children[2].textContent = active.length - done ? `${active.length - done} OPEN` : active.length ? 'CLEAR' : 'IDLE';
      return;
    }

    // objectives
    const objs = ov.objectives.filter((e) => !e.skipped);
    objLabel.innerHTML = `Objectives <small>${objs.filter((e) => e.done).length}/${objs.length}</small>`;
    objList.replaceChildren(...ov.objectives.filter((e) => !e.skipped).map((e) => taskRow(app, e, { chip: true })));
    const adder = h('button', { class: 'ct-chip adder', title: 'Add an objective for this week' }, '+ OBJECTIVE');
    adder.onclick = () => inlineAdd(adder, 'Week objective', (title) =>
      store.mutate((db) => addItem(db, { order: Date.now(), title, scope: 'week', repeat: { type: 'once', week: wk } })), 'ct-chip');
    objList.append(adder);

    // day columns
    days.replaceChildren();
    let open = 0;
    for (const [i, d] of ov.days.entries()) {
      const tasks = d.tasks.filter((e) => !e.skipped);
      const done = tasks.filter((e) => e.done).length;
      open += tasks.length - done;
      const sorted = [...tasks].sort((a, b) => (store.prefs.doneAtBottom ? a.done - b.done : 0) || (b.overdue - a.overdue));
      const list = h('div', { class: 'ct-col-list' }, sorted.map((e) => taskRow(app, e, { compact: true })));
      const add = h('button', { class: 'ct-col-add', title: 'Add a job on this day' }, '+ ADD');
      add.onclick = () => inlineAdd(add, 'Job', (title) =>
        store.mutate((db) => addItem(db, { order: Date.now(), title, scope: 'day', repeat: { type: 'once', date: d.date } })));
      const col = h('div', { class: 'ct-col' + (d.date === today ? ' today' : d.date < today ? ' past' : ''), 'data-date': d.date },
        h('div', { class: 'ct-col-head' }, h('span', {}, WEEKDAYS[i]), h('b', {}, dayNum(d.date)), h('i', {}, tasks.length ? `${done}/${tasks.length}` : '')),
        list, add);
      days.append(col);
    }
    const mt = ctx.ui.micro(today);
    micro.children[1].textContent = `W${weekNumber(wk)} · ${mt.text}`;
    micro.children[1].title = mt.title;
    micro.children[2].textContent = open ? `${open} OPEN` : 'CLEAR';
  }

  function go(next) { wk = next; render(); }

  // ---------------------------------------------------------------- drag one-off jobs between days
  let drag = null;
  days.addEventListener('pointerdown', (ev) => {
    const row = ev.target.closest?.('.ct-row.once');
    if (!row || ev.button !== 0 || ev.target.closest('button, input')) return;
    drag = { row, id: row.dataset.id, from: row.closest('.ct-col').dataset.date, x: ev.clientX, y: ev.clientY, ghost: null, over: null };
    try { row.setPointerCapture(ev.pointerId); } catch { /* synthetic events have no capturable pointer */ }
  });
  days.addEventListener('pointermove', (ev) => {
    if (!drag) return;
    if (!drag.ghost) {
      if (Math.hypot(ev.clientX - drag.x, ev.clientY - drag.y) < 6) return;
      drag.ghost = h('div', { class: 'ct-ghost' }, drag.row.querySelector('.ct-title').textContent);
      root.append(drag.ghost);
      drag.row.style.opacity = '.35';
    }
    const r = root.getBoundingClientRect();
    drag.ghost.style.left = ev.clientX - r.left + 'px';
    drag.ghost.style.top = ev.clientY - r.top + 'px';
    const col = [...days.children].find((c) => { const b = c.getBoundingClientRect(); return ev.clientX >= b.left && ev.clientX <= b.right; });
    if (col !== drag.over) { drag.over?.classList.remove('drop'); col?.classList.add('drop'); drag.over = col; }
  });
  const endDrag = () => {
    if (!drag) return;
    const { ghost, over, id, from, row } = drag;
    drag = null;
    if (!ghost) return;
    ghost.remove();
    row.style.opacity = '';
    over?.classList.remove('drop');
    if (over && over.dataset.date !== from) store.mutate((db) => moveOnce(db, id, over.dataset.date));
  };
  days.addEventListener('pointerup', endDrag);
  days.addEventListener('pointercancel', endDrag);

  // Celebrate when the ticked job completes its day, or the last week objective is done.
  app.checkAllDone = (ticked) => {
    const ov = weekOverview(store.db, wk, { today: todayKey(), carryOver: store.prefs.carryOver });
    const pool = ticked.item.scope === 'week' ? ov.objectives
      : (ov.days.find((x) => x.date === (ticked.overdue ? todayKey() : ticked.date))?.tasks || []);
    const active = pool.filter((e) => !e.skipped);
    if (active.length && active.every((e) => e.done)) celebrate(app, ticked.item.scope === 'week' ? 'WEEK OBJECTIVES COMPLETE' : 'ALL JOBS COMPLETE');
  };

  store.subscribe(() => { if (!drag) render(); });
  ctx.on('expand', render);
  ctx.on('collapse', render);
  render();

  return {
    rollover(newToday) {
      // Follow into the new week only if the user was looking at the current one.
      if (wk === weekKey(addDays(newToday, -1))) wk = weekKey(newToday);
      render();
    },
  };
}

