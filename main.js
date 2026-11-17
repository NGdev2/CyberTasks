// CyberTasks entry: one widget, two variants (Day / Week) sharing one database.
import { todayKey, tasksForDay, addItem } from './src/schedule.js';
import { createStore } from './src/store.js';
import { h } from './src/ui.js';
import { mountDay } from './src/day.js';
import { mountWeek } from './src/week.js';
import { openEditor } from './src/editor.js';

const FONTS = [
  ['CT Rajdhani', 'Rajdhani-Regular.ttf', '400'],
  ['CT Rajdhani', 'Rajdhani-Medium.ttf', '500'],
  ['CT Rajdhani', 'Rajdhani-SemiBold.ttf', '600'],
  ['CT Rajdhani', 'Rajdhani-Bold.ttf', '700'],
  ['CT Mono', 'ShareTechMono-Regular.ttf', '400'],
];

// @font-face inside a shadow root is unreliable, so fonts go into the page's font set (once).
function loadFonts(ctx) {
  if (!window.__ctFonts) {
    window.__ctFonts = Promise.all(FONTS.map(([family, file, weight]) => {
      const face = new FontFace(family, `url("${ctx.asset('assets/fonts/' + file)}")`, { weight });
      document.fonts.add(face);
      return face.load().catch((e) => ctx.log('font failed', file, String(e)));
    }));
  }
  return window.__ctFonts;
}

// Messages addressed to the widget id reach every instance with the same data object.
const handled = new WeakSet();

export async function mount(ctx) {
  await loadFonts(ctx);
  const store = createStore(ctx);
  const view = ctx.variant === 'week' ? 'week' : 'day';
  const root = h('div', { class: `ct ct-${view}` });
  ctx.root.append(root);

  const app = { ctx, store, root, view };
  app.openEditor = (opts) => openEditor(app, opts);
  const viewApi = view === 'week' ? mountWeek(app) : mountDay(app);

  const applyPrefs = () => {
    root.classList.toggle('no-decor', !store.prefs.decor);
    root.classList.toggle('no-glitch', !store.prefs.glitch);
  };
  applyPrefs();
  store.subscribe(applyPrefs);

  ctx.menu.add({ icon: '↻', label: 'Routines…', action: () => app.openEditor({ tab: 'routines' }) });
  ctx.menu.add({ icon: '⚙', label: 'Options…', action: () => app.openEditor({ tab: 'options' }) });

  // Day rollover + notifications.
  let today = todayKey();
  const tick = () => {
    const t = todayKey();
    if (t !== today) { today = t; viewApi.rollover(t); }
    notify(ctx, store);
  };
  ctx.every(20_000, tick);
  tick();

  // widgetctl send cybertasks '{"add":"Buy milk"}'  |  '{"open":"routines"}'  |  '{"open":"routines","newTitle":"Gym"}'
  ctx.on('message', ({ data }) => {
    if (!data || typeof data !== 'object' || handled.has(data)) return;
    handled.add(data);
    if (data.add) store.mutate((db) => addItem(db, { order: Date.now(), title: String(data.add), scope: 'day', repeat: { type: 'once', date: todayKey() } }));
    if (data.open) app.openEditor({ tab: data.open === 'options' ? 'options' : 'routines', ...('newTitle' in data ? { newTitle: data.newTitle } : {}) });
  });
}

// Morning briefing / evening reminder. The first instance to check claims the slot, so
// with a Day and a Week instance on screen the notification still fires once.
function notify(ctx, store) {
  const p = store.prefs;
  const now = new Date();
  const today = todayKey(now);
  const sent = ctx.shared.get('notified', {});
  const open = () => tasksForDay(store.db, today, { today, carryOver: p.carryOver }).filter((e) => !e.done && !e.skipped);
  if (p.briefing && now.getHours() >= p.briefHour && sent.brief !== today) {
    ctx.shared.set('notified', { ...sent, brief: today });
    const jobs = open();
    if (jobs.length) ctx.host.notify(`TODAY // ${jobs.length} JOB${jobs.length > 1 ? 'S' : ''}`, jobs.slice(0, 6).map((e) => '◇ ' + e.item.title).join('\n'));
  } else if (p.reminder && now.getHours() >= p.remindHour && sent.remind !== today) {
    ctx.shared.set('notified', { ...sent, remind: today });
    const jobs = open();
    if (jobs.length) ctx.host.notify(`${jobs.length} JOB${jobs.length > 1 ? 'S' : ''} LEFT TODAY`, jobs.slice(0, 6).map((e) => '◇ ' + e.item.title).join('\n'));
  }
}
