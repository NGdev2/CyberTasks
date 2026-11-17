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
