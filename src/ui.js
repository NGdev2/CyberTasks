// Small DOM helpers, icons and labels shared by the views.
import { isoWeekday } from './schedule.js';

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c);
  return el;
}

export const ICON = {
  prev: '<svg viewBox="0 0 10 12"><path d="M9 1 2 6l7 5z" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
  next: '<svg viewBox="0 0 10 12"><path d="m1 1 7 5-7 5z" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
  gear: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4"/><rect x="5" y="5" width="6" height="6" transform="rotate(45 8 8)"/></svg>',
  close: '<svg viewBox="0 0 12 12"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" stroke-width="1.6"/></svg>',
  plus: '<svg viewBox="0 0 12 12"><path d="M6 1v10M1 6h10" stroke="currentColor" stroke-width="1.8"/></svg>',
  repeat: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M2 7V5h10l-2-2M14 9v2H4l2 2"/></svg>',
  expand: '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M7 1h4v4M5 11H1V7M11 1 7 5M1 11l4-4"/></svg>',
  collapse: '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M11 5H7V1M1 7h4v4M7 5l4-4M5 7l-4 4"/></svg>',
};

export const iconBtn = (icon, title, onclick, cls = 'ct-ibtn') =>
  h('button', { class: cls, title, html: ICON[icon] || icon, onclick: (e) => { e.stopPropagation(); onclick(e); } });

// ---------------------------------------------------------------- dates (display only)
export const WEEKDAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
export const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const parts = (key) => key.split('-').map(Number);
export const dayNum = (key) => String(parts(key)[2]).padStart(2, '0');
export const shortDate = (key) => { const [, m, d] = parts(key); return `${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')}`; };
export const dayLabel = (key) => `${WEEKDAYS[isoWeekday(key) - 1]} ${shortDate(key)}`;
export const weekNumber = (wk) => Number(wk.split('-W')[1]);

// ---------------------------------------------------------------- micro text: real data + computing history
const HISTORY = {
  '01-01': [1970, 'UNIX EPOCH STARTS'], '01-15': [2001, 'WIKIPEDIA LAUNCHED'], '01-19': [2038, '32-BIT UNIX TIME ENDS'],
  '01-24': [1984, 'MACINTOSH RELEASED'], '02-15': [1946, 'ENIAC DEDICATED'], '02-20': [1991, 'PYTHON 0.9.0 RELEASED'],
  '03-12': [1989, 'THE WEB IS PROPOSED'], '03-15': [1985, 'FIRST .COM REGISTERED'], '04-01': [1976, 'APPLE FOUNDED'],
  '04-04': [1975, 'MICROSOFT FOUNDED'], '04-07': [2005, "GIT'S FIRST COMMIT"], '04-10': [2008, 'GITHUB LAUNCHES'],
  '04-30': [1993, 'THE WEB GOES PUBLIC DOMAIN'], '05-11': [1997, 'DEEP BLUE BEATS KASPAROV'], '05-23': [1995, 'JAVA ANNOUNCED'],
  '06-23': [1912, 'ALAN TURING BORN'], '07-20': [1969, 'APOLLO 11 LANDS'], '08-06': [1991, 'FIRST WEBSITE ONLINE'],
  '08-12': [1981, 'IBM PC INTRODUCED'], '08-24': [1995, 'WINDOWS 95 RELEASED'], '08-25': [1991, 'LINUX ANNOUNCED'],
  '09-04': [1998, 'GOOGLE FOUNDED'], '09-09': [1947, 'FIRST BUG FOUND: A MOTH'], '09-17': [1991, 'LINUX 0.01 RELEASED'],
  '09-27': [1983, 'GNU ANNOUNCED'], '10-29': [1969, 'ARPANET SENDS "LO"'], '11-02': [1988, 'MORRIS WORM SPREADS'],
  '11-17': [1970, 'MOUSE PATENT GRANTED'], '11-20': [1985, 'WINDOWS 1.0 RELEASED'], '12-09': [1968, 'MOTHER OF ALL DEMOS'],
  '12-10': [1815, 'ADA LOVELACE BORN'],
};
const SAYINGS = ['THERE IS NO PLACE LIKE 127.0.0.1', 'THE ANSWER IS 42', 'HELLO, WORLD', 'IT WORKS ON MY MACHINE',
  'EXIT 0 IS THE GOAL', 'COMMIT EARLY, COMMIT OFTEN', 'HAVE YOU TRIED TURNING IT OFF AND ON?', 'SUDO MAKE ME A SANDWICH',
  '/DEV/NULL HEARS ALL COMPLAINTS', 'ADA · TURING · HOPPER', 'CTRL+S, THEN CTRL+S AGAIN', '0x2A == 42'];

const utcDay = (key) => { const [y, m, d] = parts(key); return Date.UTC(y, m - 1, d) / 86400000; };
export const unixDay = (key) => utcDay(key);                                   // days since 1970-01-01
export const dayOfYear = (key) => utcDay(key) - utcDay(key.slice(0, 4) + '-01-01') + 1;

/** "DAY 321 // 1970: MOUSE PATENT GRANTED", or a classic saying when the date has no event. */
export function microText(dateKey) {
  const doy = dayOfYear(dateKey);
  const event = doy === 256 ? ['', "PROGRAMMERS' DAY"] : HISTORY[dateKey.slice(5)];
  const fact = event ? (event[0] ? `${event[0]}: ${event[1]}` : event[1]) : SAYINGS[unixDay(dateKey) % SAYINGS.length];
  return { text: `DAY ${doy} // ${fact}`, title: `Day ${doy} of the year · Unix day ${unixDay(dateKey)}${event ? ' · on this day in computing' : ''}` };
}

// ---------------------------------------------------------------- context menu inside the widget
export function contextMenu(root, x, y, title, items) {
  root.querySelector('.ct-menu')?.remove();
  const menu = h('div', { class: 'ct-menu' },
    title ? h('div', { class: 'ct-menu-head' }, title) : null,
    items.filter(Boolean).map((it) => h('button', {
      class: 'ct-menu-item' + (it.danger ? ' danger' : ''),
      onclick: (e) => { e.stopPropagation(); close(); it.action(); },
    }, it.label)));
  root.append(menu);
  const r = root.getBoundingClientRect();
  const m = menu.getBoundingClientRect();
  menu.style.left = Math.max(4, Math.min(x - r.left, r.width - m.width - 4)) + 'px';
  menu.style.top = Math.max(4, Math.min(y - r.top, r.height - m.height - 4)) + 'px';
  const close = () => { menu.remove(); root.removeEventListener('pointerdown', outside, true); };
  const outside = (e) => { if (!e.composedPath().includes(menu)) close(); };
  setTimeout(() => root.addEventListener('pointerdown', outside, true));
  return close;
}

// Glitch an element once (CSS class removed when done so it can replay).
export function glitch(el) {
  el.classList.remove('ct-glitch');
  void el.offsetWidth;
  el.classList.add('ct-glitch');
  el.addEventListener('animationend', () => el.classList.remove('ct-glitch'), { once: true });
}

export const SPARKS = ['#5ef6ff', '#ff5d55', '#fcee0a'];
