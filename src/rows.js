// Task row shared by the Day and Week views: check, tags, rename, context menu, effects.
import { setDone, skip, removeItem, updateItem, moveOnce, addDays, describeRepeat, streak, todayKey } from './schedule.js';
import { h, ICON, contextMenu, glitch, shortDate, SPARKS } from './ui.js';

export function taskRow(app, e, { compact = false, chip = false } = {}) {
  const { store } = app;
  const it = e.item;
  const cls = [chip ? 'ct-chip' : 'ct-row', e.done && 'done', e.skipped && 'skipped', e.overdue && 'overdue',
    e.recurring ? 'recurring' : 'once'].filter(Boolean).join(' ');
  const row = h('div', { class: cls, 'data-key': e.key, 'data-id': it.id });

  const check = h('button', { class: 'ct-check', title: e.skipped ? 'Skipped. Click to restore' : e.done ? 'Mark as not done' : 'Mark as done' });
  check.onclick = (ev) => { ev.stopPropagation(); toggle(app, e, row, check); };
  const title = h('span', { class: 'ct-title', title: it.title }, it.title);
  title.ondblclick = (ev) => { ev.stopPropagation(); rename(app, it, title); };
  row.append(check, title);

  if (!chip) {
    const tags = h('span', { class: 'ct-tags' });
    if (e.overdue) tags.append(h('span', { class: 'ct-tag yellow', title: 'Unfinished from ' + e.originDate }, compact ? '!' : `OVERDUE ${shortDate(e.originDate)}`));
    if (e.skipped && !compact) tags.append(h('span', { class: 'ct-tag' }, 'SKIPPED'));
    if (e.recurring) {
      const s = it.scope === 'day' ? streak(store.db, it, todayKey()) : 0;
      if (s >= 2 && !compact) tags.append(h('span', { class: 'ct-tag cyan', title: `${s} in a row` }, `x${s}`));
      tags.append(h('span', { class: 'ct-tag rep', title: describeRepeat(it) }, compact ? '↻' : '↻ ' + describeRepeat(it)));
    }
    if (tags.childElementCount) row.append(tags);
    if (!compact) {
      row.append(h('button', {
        class: 'ct-x', title: e.recurring ? 'Skip this time' : 'Delete', html: ICON.close,
        onclick: (ev) => { ev.stopPropagation(); e.recurring ? store.mutate((db) => skip(db, e.key)) : store.mutate((db) => removeItem(db, it.id)); },
      }));
    }
  }

  row.addEventListener('contextmenu', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    openRowMenu(app, e, row, ev.clientX, ev.clientY);
  });
  return row;
}

function openRowMenu(app, e, row, x, y) {
  const { store } = app;
  const it = e.item;
  const day = e.originDate || e.date;
  contextMenu(app.root, x, y, e.recurring ? describeRepeat(it) : 'ONE-OFF JOB', [
    { label: e.done ? 'Not done' : 'Done', action: () => toggle(app, e, row, row.querySelector('.ct-check')) },
    e.recurring && !e.done && !e.skipped && { label: it.scope === 'week' ? 'Skip this week' : 'Skip this day', action: () => store.mutate((db) => skip(db, e.key)) },
    { label: 'Rename', action: () => rename(app, it, row.querySelector('.ct-title')) },
    !e.recurring && it.scope === 'day' && { label: 'Move to tomorrow', action: () => store.mutate((db) => moveOnce(db, it.id, addDays(e.overdue ? todayKey() : day, 1))) },
    e.overdue && { label: 'Move to today', action: () => store.mutate((db) => moveOnce(db, it.id, todayKey())) },
    { label: e.recurring ? 'Edit routine…' : 'Make it a routine…', action: () => app.openEditor({ tab: 'routines', select: it.id, convert: !e.recurring }) },
    { label: e.recurring ? 'Delete routine' : 'Delete', danger: true, action: () => store.mutate((db) => removeItem(db, it.id)) },
  ]);
}

function rename(app, it, titleEl) {
  const input = h('input', { class: 'ct-title-input', value: it.title, maxlength: 160 });
  titleEl.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const finish = (save) => {
    if (done) return;
    done = true;
    const v = input.value.trim();
    if (save && v && v !== it.title) app.store.mutate((db) => updateItem(db, it.id, { title: v }));
    else input.replaceWith(titleEl);
  };
  input.onkeydown = (ev) => { if (ev.key === 'Enter') finish(true); if (ev.key === 'Escape') { ev.stopPropagation(); finish(false); } };
  input.onblur = () => finish(true);
}

function toggle(app, e, row, check) {
  const { store, ctx } = app;
  const nowDone = e.skipped ? false : !e.done;
  if (nowDone) {
    const r = check.getBoundingClientRect();
    ctx.particles.burst({ x: r.left + r.width / 2, y: r.top + r.height / 2, count: 16, colors: SPARKS, shapes: ['rect'], speed: 220, gravity: 300, life: 0.7, size: 5, spread: 360, angle: 0, fade: true });
    if (store.prefs.glitch) glitch(row);
  }
  // Let the glitch play before the list re-renders.
  setTimeout(() => {
    store.mutate((db) => setDone(db, e.key, nowDone));
    if (nowDone) app.checkAllDone?.(e);
  }, nowDone && store.prefs.glitch ? 240 : 0);
}

/** Yellow "ALL JOBS COMPLETE" band + confetti. */
export function celebrate(app, text = 'ALL JOBS COMPLETE') {
  const { root, ctx } = app;
  if (!app.store.prefs.celebrate) return;
  root.querySelector('.ct-banner')?.remove();
  const band = h('div', { class: 'ct-banner' }, text, h('small', {}, 'EXIT 0'));
  root.append(band);
  ctx.after(2700, () => band.remove());
  const r = root.getBoundingClientRect();
  ctx.particles.burst({ preset: 'confetti', x: r.left + r.width / 2, y: r.top + r.height * 0.42, colors: SPARKS, shapes: ['rect'] });
}
