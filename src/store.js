// One database + preferences shared by every CyberTasks instance (Day and Week views).
// Writes go through ctx.shared, which notifies the other instances so they re-render.
import { validate, prune, todayKey } from './schedule.js';

export const DEFAULT_PREFS = {
  carryOver: true,      // unfinished one-off tasks from past days show up today as overdue
  doneAtBottom: true,
  celebrate: true,      // banner + confetti when everything for today is done
  glitch: true,
  decor: true,          // micro text, barcodes, corner tab
  briefing: false,      // morning notification with today's jobs
  briefHour: 9,
  reminder: false,      // evening notification if jobs are left
  remindHour: 20,
};

export function createStore(ctx) {
  let db = validate(ctx.shared.get('db', null));
  let prefs = { ...DEFAULT_PREFS, ...ctx.shared.get('prefs', {}) };
  const subs = new Set();
  const emit = () => { for (const fn of subs) fn(); };

  ctx.on('shared', ({ key }) => {
    if (key === 'db') db = validate(ctx.shared.get('db', null));
    else if (key === 'prefs') prefs = { ...DEFAULT_PREFS, ...ctx.shared.get('prefs', {}) };
    else return;
    emit();
  });

  const today = todayKey();
  if (ctx.shared.get('pruned') !== today) {
    prune(db, today);
    ctx.shared.set('db', db);
    ctx.shared.set('pruned', today);
  }

  return {
    get db() { return db; },
    get prefs() { return prefs; },
    /** Run fn(db), persist, re-render everyone. Returns fn's result. */
    mutate(fn) {
      const result = fn(db);
      ctx.shared.set('db', db);
      emit();
      return result;
    },
    setPref(key, value) {
      prefs = { ...prefs, [key]: value };
      ctx.shared.set('prefs', prefs);
      emit();
    },
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
  };
}
