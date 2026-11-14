// Einstieg: Routing, Rendering, Interaktionen
import { createStore, todayBerlin } from './data.js';
import { renderTables } from './views/tables.js';
import { renderGroupMatches } from './views/tables.js';
import { renderSchedule, defaultMatchday, toggleDay } from './views/schedule.js';
import { renderKnockout } from './views/knockout.js';
import { renderTeam } from './views/team.js';
import { esc, fmtRange, fmtShort, fmtShortY, fmtTime, installFlagFallback } from './ui.js';

const $ = (s, root = document) => root.querySelector(s);
const view = $('#view');
const hero = $('#hero');
const panel = $('#team-panel');
const scrim = $('#scrim');
const tooltip = $('#tooltip');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
/** Touch ohne Maus: keine Hover-Tooltips in Tabellenzellen. */
const touchUi = matchMedia('(hover: none), (pointer: coarse)');

const state = {
  model: null,
  route: { view: 'tabellen', league: 'A', group: null, md: null, filter: 'alle' },
  pushedTeam: false,
  prevHash: null,
  focusTab: null,
  skipGroupScroll: false,
  openGroups: new Set(),
  team: null,
  lastFocus: null,
  error: null,
};

/* ------------------------------------------------------------------ Routing */

function parseHash() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const [v, a, b] = parts;
  if (v === 'spieltage') return { view: 'spieltage', team: null, md: Number(a) || null, filter: ['A', 'B', 'C', 'D'].includes(b) ? b : 'alle' };
  if (v === 'ko') return { view: 'ko', team: null };
  if (v === 'team' && a) return { view: 'tabellen', league: null, team: a.toUpperCase() };
  const league = ['A', 'B', 'C', 'D'].includes((a || '').toUpperCase()) ? a.toUpperCase() : state.route.league || 'A';
  return { view: 'tabellen', team: null, league, group: b ? b.toUpperCase() : null };
}

function onRoute() {
  const r = parseHash();
  const prevView = state.route.view;
  if (r.team && state.model?.teams[r.team]) {
    if (state.team === r.team && !panel.hidden) return;
    r.league = state.model.teams[r.team].league;
    state.route = { ...state.route, ...r };
    render();
    openTeam(r.team, { fromRoute: true });
    return;
  }
  if (!panel.hidden) closeTeam({ fromRoute: true });
  const skipScroll = state.skipGroupScroll;
  state.skipGroupScroll = false;
  const cur = state.route;
  if (skipScroll && ['view', 'league', 'group', 'md', 'filter'].every((k) => r[k] === undefined || r[k] === cur[k])) {
    return; // Rückkehr aus dem Team-Panel: Ansicht unverändert lassen (Fokus & Scrollposition bleiben)
  }
  state.route = { ...state.route, ...r };
  render({ scrollTop: prevView !== r.view });
  if (r.group && !skipScroll) {
    const el = document.getElementById(`gruppe-${r.group}`);
    if (el) {
      el.scrollIntoView({ behavior: reducedMotion.matches ? 'auto' : 'smooth', block: 'start' });
      el.classList.add('is-flash');
      setTimeout(() => el.classList.remove('is-flash'), 1600);
    }
  }
}

/* ------------------------------------------------------------------ Render */

function render({ scrollTop = false } = {}) {
  const m = state.model;
  document.querySelectorAll('[data-nav]').forEach((a) => {
    const active = a.dataset.nav === state.route.view;
    a.classList.toggle('is-active', active);
    if (active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  if (!m) return;

  const showHero = state.route.view === 'tabellen';
  hero.hidden = !showHero;
  if (showHero) renderHero(m);
  view.classList.toggle('view--top', !showHero);
  let html = '';
  if (state.route.view === 'spieltage') {
    const md = state.route.md || defaultMatchday(m);
    html = renderSchedule(m, md, state.route.filter);
    document.title = `Spieltag ${md} · Nations League Monitor 2026/27`;
  } else if (state.route.view === 'ko') {
    html = renderKnockout(m);
    document.title = 'K.-o.-Phase & Play-offs · Nations League Monitor 2026/27';
  } else {
    html = renderTables(m, state.route.league || 'A', { openGroups: state.openGroups });
    document.title = `Liga ${state.route.league || 'A'} · Nations League Monitor 2026/27`;
  }
  const focusTab = state.focusTab;
  const oldGlider = $('.league-switch__glider');
  const from = oldGlider ? { t: oldGlider.style.transform, w: oldGlider.style.width, h: oldGlider.style.height } : null;
  const wasStuck = $('.league-switch-wrap')?.classList.contains('is-stuck');
  view.innerHTML = html;
  view.dataset.view = state.route.view;
  if (wasStuck) $('.league-switch-wrap')?.classList.add('is-stuck');
  const g = $('.league-switch__glider');
  if (g && from?.t && !reducedMotion.matches) {
    // Glider gleitet vom alten zum neuen Tab, obwohl der Umschalter neu gerendert wurde
    g.style.transition = 'none';
    Object.assign(g.style, { transform: from.t, width: from.w, height: from.h });
    void g.offsetWidth;
    g.style.transition = '';
    positionGlider();
  } else positionGlider(true);
  observeSwitch();
  if (focusTab) { state.focusTab = null; document.getElementById(`tab-${focusTab}`)?.focus({ preventScroll: true }); }
  if (scrollTop) window.scrollTo({ top: 0, behavior: 'auto' });
  if (state.team && !panel.hidden) { panel.innerHTML = renderTeam(m, state.team); fitHeroName(); }
  fitNames();
  markStuckHeads();
  centerActiveMatchday();
}

/** Spieltag-Leiste (mobil waagerecht scrollbar): gewählten Spieltag in die Mitte holen, ohne die Seite zu scrollen. */
function centerActiveMatchday() {
  const strip = $('.md-strip');
  const active = strip?.querySelector('.md-tab.is-active');
  if (!strip || !active || strip.scrollWidth <= strip.clientWidth) return;
  strip.scrollLeft = Math.max(0, active.offsetLeft - (strip.clientWidth - active.offsetWidth) / 2);
}

function renderHero(m) {
  const total = m.matches.length;
  const done = m.matches.filter((x) => x.status === 'FINISHED');
  const live = m.matches.filter((x) => x.status === 'LIVE').length;
  const goals = done.reduce((s, x) => s + x.hs + x.as, 0);
  const mds = [1, 2, 3, 4, 5, 6].map((d) => {
    const ms = m.matches.filter((x) => x.md === d);
    const fin = ms.length && ms.every((x) => x.status === 'FINISHED');
    const part = ms.some((x) => x.status !== 'UPCOMING');
    const dates = ms.map((x) => x.date).sort();
    return { d, fin, part, from: dates[0], to: dates[dates.length - 1] };
  });
  const next = mds.find((x) => !x.fin);
  const mdDone = mds.filter((x) => x.fin).length;
  const today = todayBerlin();
  const days = next ? Math.round((Date.parse(`${next.from}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 864e5) : null;
  // Viertelfinale: 8 Plätze (Liga A, Platz 1–2) – wie viele sind rechnerisch vergeben?
  const leagueA = m.leagues.find((l) => l.id === 'A');
  const qfRows = leagueA ? leagueA.groups.flatMap((g) => g.table.filter((r) => r.zone === 'ko')) : [];
  const qfSafe = qfRows.filter((r) => r.locked);
  const qfNames = qfSafe.map((r) => m.teams[r.code]?.name).filter(Boolean);
  const qfTip = `Teams, die Platz 1 oder 2 ihrer Gruppe in Liga A rechnerisch sicher haben${qfNames.length ? `: ${qfNames.join(', ')}.` : ' – bisher noch keines.'}`;
  const phase = live ? `Live · ${live} ${live === 1 ? 'Spiel läuft' : 'Spiele laufen'}`
    : !next ? 'Ligaphase beendet'
    : next.part || days <= 0 ? `Ligaphase · Spieltag ${next.d} läuft`
    : `Ligaphase · Pause bis ${fmtShort(next.from)}`;
  const daysText = days === null ? '' : days > 1 ? `in ${days} Tagen` : days === 1 ? 'morgen' : days === 0 ? 'heute' : 'läuft';

  hero.innerHTML = `
  <div class="hero__inner">
    <div class="hero__main">
      <p class="eyebrow eyebrow--accent"><span class="pulse${live ? ' is-live' : ''}" aria-hidden="true"></span>${phase}</p>
      <h1 id="hero-title" class="hero__title">UEFA Nations League <span class="hero__season">2026/27</span></h1>
      <p class="hero__lead">54 Nationen, 4 Ligen, 14 Gruppen: alle Tabellen und Spiele – und auf einen Blick, wer ins Viertelfinale einzieht, aufsteigt, in die Play-offs muss oder absteigt.</p>
    </div>
    <div class="hero__panel">
      <div class="md-track-wrap">
        <p class="label md-track__caption" aria-hidden="true">Ligaphase · ${mdDone}/6 Spieltage</p>
        <div class="md-track" role="img" aria-label="${mdDone} von 6 Spieltagen der Ligaphase absolviert">
          ${mds.map((x) => `<a class="md-track__seg${x.fin ? ' is-done' : x.part ? ' is-part' : ''}${next && x.d === next.d ? ' is-next' : ''}" href="#/spieltage/${x.d}" tabindex="-1" aria-hidden="true">
            <span class="md-track__bar"></span><span class="md-track__label">${x.d}</span></a>`).join('')}
        </div>
      </div>
      ${next ? `<a class="hero__next" href="#/spieltage/${next.d}">
        <span class="hero__next-label">${next.part ? 'Aktueller' : 'Nächster'} Spieltag</span>
        <span class="hero__next-main">Spieltag ${next.d}<span class="hero__next-date">${fmtRange(next.from, next.to)}</span></span>
        <span class="hero__next-count">${daysText}</span>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>
      </a>` : ''}
      <dl class="kpis">
        <div><dt>Spiele</dt><dd>${done.length}<small>/${total}</small></dd></div>
        <div><dt>Tore</dt><dd>${goals}</dd></div>
        <div><dt>Tore/Spiel</dt><dd>${done.length ? (goals / done.length).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '–'}</dd></div>
        <div class="kpi--info" data-tip-title="Viertelfinale rechnerisch sicher" data-tip="${esc(qfTip)}" tabindex="0"><dt>VF sicher<svg class="kpi__info" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.6v.1"/></svg></dt><dd>${qfSafe.length}<small>/${qfRows.length || 8}</small></dd></div>
      </dl>
    </div>
  </div>`;
}

const NB = '\u00a0';
/** Geschützte Leerzeichen, damit Tooltips nicht in „22:00 | Uhr“ oder „104/156 | Spiele“ umbrechen. */
const keepTogether = (t) => String(t || '')
  .replace(/(\d{1,2}:\d{2}) Uhr/g, `$1${NB}Uhr`)
  .replace(/(\d+\/\d+) Spiele beendet/g, `$1${NB}Spiele${NB}beendet`)
  .replace(/Spieltag (\d)/g, `Spieltag${NB}$1`);

function renderStatus(m) {
  const el = $('#data-status');
  const s = m.source;
  const snapLong = s.snapshotAt ? `${fmtShortY(s.snapshotAt)}, ${fmtTime(s.snapshotAt)} Uhr` : 'unbekannt';
  el.className = `data-status data-status--${s.kind}${s.liveNow ? ' is-live-now' : ''}`;
  const txt = el.querySelector('.data-status__text');
  if (s.kind === 'live') {
    txt.innerHTML = `<b>Live</b><span class="data-status__long"> · ${esc(s.provider)}</span><span class="data-status__time"> · ${fmtTime(s.fetchedAt)}</span>`;
    el.dataset.tipTitle = s.liveNow ? 'Live – Spiele laufen' : 'Live-Abgleich aktiv';
    el.dataset.tip = [
      `Datenstand: ${m.asOf || 'UEFA-Daten'}`,
      `Live-Quelle: ${s.provider}, zuletzt ${fmtTime(s.fetchedAt)} Uhr`,
      `Basis: UEFA-Snapshot, ${snapLong}`,
      `Aktualisierung alle ${s.liveNow ? '60 Sekunden' : '5 Minuten'}`,
    ].join('\n');
  } else {
    const ageH = s.snapshotAt ? (Date.now() - Date.parse(s.snapshotAt)) / 36e5 : Infinity;
    const stale = ageH > 24;
    el.classList.toggle('is-stale', stale);
    // Quelle steht im Chip selbst – nicht erst im Tooltip. Ein Wortlaut für alle Breiten: relativ („heute, 02:44 Uhr“),
    // ältere Stände mit Datum („06.10. · 02:44 Uhr“). Sehr schmal nur „Stand …“ (Quelle im Tooltip und in der Fußzeile).
    const snapDay = s.snapshotAt ? new Date(s.snapshotAt).toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' }) : null;
    const today = todayBerlin();
    const yesterday = new Date(Date.parse(`${today}T12:00:00Z`) - 864e5).toISOString().slice(0, 10);
    const t = s.snapshotAt ? fmtTime(s.snapshotAt) : '';
    const rel = !s.snapshotAt ? null : snapDay === today ? 'heute' : snapDay === yesterday ? 'gestern' : null;
    const when = !s.snapshotAt ? '–' : rel ? `${rel}, ${t}` : `${fmtShort(s.snapshotAt)} · ${t}`;
    const tiny = !s.snapshotAt ? '–' : snapDay === today ? t : rel || fmtShort(s.snapshotAt);
    // Langform und Kurzform als vollständige Textknoten (kein „UEFA - Daten“ durch geteilte Spans)
    txt.innerHTML = `<span class="data-status__src"><b class="data-status__long">UEFA-Daten</b><b class="data-status__short">UEFA</b><span class="data-status__sep"> · </span></span>` +
      `<span class="data-status__when">${when}<span class="data-status__long">&nbsp;Uhr</span></span>` +
      `<span class="data-status__tiny">Stand ${tiny}</span>`;
    el.dataset.tipTitle = stale ? 'UEFA-Datenstand älter als 24 Stunden' : 'Gespeicherter UEFA-Datenstand';
    el.dataset.tip = [
      `Datenstand: ${m.asOf || 'UEFA-Daten'}`,
      `Quelle: UEFA-Snapshot, ${snapLong}`,
      s.idle ? 'Live-Abgleich: startet automatisch an Spieltagen' : 'Live-Abgleich: derzeit nicht erreichbar – neuer Versuch alle 10 Minuten',
    ].map(keepTogether).join('\n');
  }
  if (s.kind === 'live') el.dataset.tip = el.dataset.tip.split('\n').map(keepTogether).join('\n');
  el.setAttribute('aria-label', `${el.dataset.tipTitle}. ${el.dataset.tip.replaceAll('\n', '. ')}`);
  el.tabIndex = 0;
  $('#footer-asof').textContent = `${m.asOf || 'UEFA-Daten'} · ${snapLong}`;
}

/* ------------------------------------------------------------------ Team panel */

function openTeam(code, { fromRoute = false, opener = null } = {}) {
  if (!state.model?.teams[code]) return;
  const wasHidden = panel.hidden;
  if (wasHidden) {
    // Fokus kehrt beim Schließen zum auslösenden Element zurück (auch bei angetippten Tabellenzeilen)
    state.lastFocus = opener || document.activeElement;
    state.prevHash = fromRoute ? null : location.hash || '#/tabellen';
    state.pushedTeam = false;
  }
  clearTimeout(state.closeTimer);
  state.cancelClose?.();
  state.team = code;
  panel.innerHTML = renderTeam(state.model, code);
  panel.classList.remove('is-closing');
  scrim.classList.remove('is-closing');
  panel.style.transform = '';
  panel.hidden = false;
  scrim.hidden = false;
  document.body.classList.add('has-panel');
  if (wasHidden) {
    void panel.offsetWidth; // Reflow erzwingen, damit der Übergang sicher startet
    panel.classList.add('is-open');
    scrim.classList.add('is-open');
  } else {
    // Team-zu-Team-Wechsel: Kopf (Flagge, Name) blendet sichtbar über
    panel.classList.remove('is-swap');
    void panel.offsetWidth;
    panel.classList.add('is-open', 'is-swap');
    clearTimeout(state.swapTimer);
    state.swapTimer = setTimeout(() => panel.classList.remove('is-swap'), 360);
  }
  panel.scrollTop = 0;
  fitNames(panel);
  fitHeroName();
  onPanelScroll();
  panel.focus({ preventScroll: true });
  if (!fromRoute) {
    // Teilbare URL + Zurück-Taste schließt das Panel
    if (state.pushedTeam) history.replaceState(null, '', `#/team/${code}`);
    else { history.pushState({ team: code }, '', `#/team/${code}`); state.pushedTeam = true; }
  }
}

function closeTeam({ fromRoute = false, navigate = null } = {}) {
  if (panel.hidden || panel.classList.contains('is-closing')) return;
  state.team = null;
  panel.classList.remove('is-open');
  panel.classList.add('is-closing');
  panel.style.transform = '';
  // Hintergrund blendet im selben Takt wie das Panel aus; versteckt wird er erst in done()
  scrim.classList.add('is-closing');
  scrim.classList.remove('is-open');
  document.body.classList.remove('has-panel');
  let finished = false;
  const done = () => {
    if (finished) return;
    finished = true;
    state.cancelClose = null;
    panel.removeEventListener('transitionend', onEnd);
    panel.hidden = true; scrim.hidden = true; panel.innerHTML = '';
    panel.classList.remove('is-closing');
    scrim.classList.remove('is-closing');
  };
  const onEnd = (e) => { if (e.target === panel && e.propertyName === 'transform') done(); };
  // Wird das Panel während des Schließens erneut geöffnet, darf das alte Schließen nicht mehr greifen
  state.cancelClose = () => { finished = true; panel.removeEventListener('transitionend', onEnd); state.cancelClose = null; };
  if (reducedMotion.matches) done();
  else { panel.addEventListener('transitionend', onEnd); state.closeTimer = setTimeout(done, 480); }

  if (!fromRoute) {
    if (navigate) {
      history.replaceState(null, '', navigate);
      state.pushedTeam = false;
      onRoute();
    } else if (state.pushedTeam) {
      state.pushedTeam = false;
      state.skipGroupScroll = true;
      history.back();
    } else if (location.hash.startsWith('#/team/')) {
      history.replaceState(null, '', `#/tabellen/${state.route.league || 'A'}`);
    }
  } else {
    state.pushedTeam = false;
  }
  if (!navigate && state.lastFocus && state.lastFocus !== document.body && document.contains(state.lastFocus)) state.lastFocus.focus({ preventScroll: true });
}

/** Kompakte Kopfzeile im Panel, sobald der Hero aus dem Bild scrollt. */
function onPanelScroll() {
  const tp = panel.querySelector('.tp');
  if (!tp) return;
  const heroEl = panel.querySelector('.tp__hero');
  const condensed = heroEl ? panel.scrollTop > heroEl.offsetTop + heroEl.offsetHeight - 70 : false;
  tp.classList.toggle('is-condensed', condensed);
  tp.classList.toggle('is-scrolled', panel.scrollTop > 4);
}

/** Bottom-Sheet (mobil): an der Griffleiste nach unten ziehen schließt das Panel. */
function bindSheetDrag() {
  let startY = null, dy = 0, pid = null;
  const isSheet = () => matchMedia('(max-width: 720px)').matches;
  panel.addEventListener('pointerdown', (e) => {
    if (!isSheet() || !e.target.closest('.tp__bar') || e.target.closest('button')) return;
    if (panel.scrollTop > 0) return;
    startY = e.clientY; dy = 0; pid = e.pointerId;
    panel.setPointerCapture(pid);
    panel.classList.add('is-dragging');
  });
  panel.addEventListener('pointermove', (e) => {
    if (startY === null || e.pointerId !== pid) return;
    dy = Math.max(0, e.clientY - startY);
    panel.style.transform = `translateY(${dy}px)`;
  });
  const end = (e) => {
    if (startY === null || e.pointerId !== pid) return;
    panel.classList.remove('is-dragging');
    try { panel.releasePointerCapture(pid); } catch { /* egal */ }
    startY = null;
    if (dy > 110) closeTeam();
    else panel.style.transform = '';
  };
  panel.addEventListener('pointerup', end);
  panel.addEventListener('pointercancel', end);
}

function trapFocus(e) {
  if (panel.hidden || e.key !== 'Tab') return;
  const f = [...panel.querySelectorAll('button, a[href], [tabindex]:not([tabindex="-1"])')].filter((x) => x.offsetParent !== null);
  if (!f.length) return;
  const first = f[0], last = f[f.length - 1];
  if (e.shiftKey && (document.activeElement === first || document.activeElement === panel)) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

/* ------------------------------------------------------------------ Tooltip */

let tipTarget = null;
let tipTimer = null;
function showTip(target) {
  const text = target?.dataset.tip;
  if (!text) return;
  clearTimeout(tipTimer);
  tipTarget = target;
  const title = target.dataset.tipTitle;
  tooltip.innerHTML = `${title ? `<b class="tooltip__title">${esc(title)}</b>` : ''}<span class="tooltip__body">${esc(text)}</span>`;
  tooltip.classList.toggle('tooltip--wide', target.matches('.data-status'));
  tooltip.hidden = false;
  const r = target.getBoundingClientRect();
  const tw = tooltip.offsetWidth, th = tooltip.offsetHeight;
  const vw = document.documentElement.clientWidth;
  const headerH = $('#site-header').getBoundingClientRect().bottom;
  // Innerhalb der Inhaltsspalte bleiben (max. 1320px), nicht bis an den Fensterrand laufen
  const inPanel = Boolean(target.closest('#team-panel'));
  const box = inPanel ? panel.getBoundingClientRect() : { left: Math.max(0, (vw - 1320) / 2), right: Math.min(vw, (vw + 1320) / 2) };
  const minX = Math.max(12, box.left + 12), maxX = Math.min(vw - 12, box.right - 12);
  let x, y, side;
  if (target.dataset.tipSide === 'right' && r.right + 12 + tw < maxX) {
    // rechts neben dem Element – verdeckt keine Kopfzeilen
    x = r.right + 10; y = r.top + r.height / 2 - th / 2; side = 'right';
  } else {
    x = Math.max(minX, Math.min(r.left + r.width / 2 - tw / 2, maxX - tw));
    y = r.bottom + 10; side = 'below';
    if (y + th > window.innerHeight - 8 && r.top - th - 10 > headerH) { y = r.top - th - 10; side = 'above'; }
  }
  const ty = Math.max(8, y);
  tooltip.style.transform = `translate(${Math.round(x)}px, ${Math.round(ty)}px)`;
  tooltip.dataset.side = side;
  // Pfeil zeigt immer auf die Mitte des Auslösers – auch wenn der Tooltip am Rand eingeklemmt wird
  tooltip.style.setProperty('--caret-x', `${Math.round(Math.min(tw - 14, Math.max(14, r.left + r.width / 2 - x)))}px`);
  tooltip.style.setProperty('--caret-y', `${Math.round(Math.min(th - 14, Math.max(14, r.top + r.height / 2 - ty)))}px`);
  tooltip.classList.add('is-visible');
  target.setAttribute('aria-describedby', 'tooltip');
}
function hideTip() {
  clearTimeout(tipTimer);
  if (tipTarget) tipTarget.removeAttribute('aria-describedby');
  tipTarget = null;
  tooltip.classList.remove('is-visible');
  tooltip.hidden = true;
}

/* ------------------------------------------------------------------ Misc UI */

function positionGlider(instant = false) {
  const sw = $('.league-switch');
  if (!sw) return;
  const active = sw.querySelector('.league-tab.is-active');
  const glider = sw.querySelector('.league-switch__glider');
  if (!active || !glider) return;
  if (instant) glider.style.transition = 'none';
  glider.style.width = `${active.offsetWidth}px`;
  glider.style.height = `${active.offsetHeight}px`;
  glider.style.transform = `translate(${active.offsetLeft}px, ${active.offsetTop}px)`;
  if (instant) { void glider.offsetWidth; glider.style.transition = ''; }
}

/** Liga-Umschalter klebt unter dem Header und wird dabei kompakt. */
let switchObserver = null;
function observeSwitch() {
  switchObserver?.disconnect();
  const wrap = $('.league-switch-wrap');
  if (!wrap) { $('#site-header').classList.remove('has-subbar'); return; }
  if (!('IntersectionObserver' in window)) return;
  let sentinel = $('.league-switch-sentinel');
  if (!sentinel) {
    sentinel = document.createElement('div');
    sentinel.className = 'league-switch-sentinel';
    sentinel.setAttribute('aria-hidden', 'true');
  }
  wrap.before(sentinel);
  const top = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--header-h')) || 64;
  switchObserver = new IntersectionObserver(([e]) => {
    const stuck = !e.isIntersecting && e.boundingClientRect.top < top() + 1;
    $('#site-header').classList.toggle('has-subbar', stuck);
    if (wrap.classList.contains('is-stuck') !== stuck) {
      wrap.classList.toggle('is-stuck', stuck);
      requestAnimationFrame(() => positionGlider(true));
      clearTimeout(observeSwitch.t);
      observeSwitch.t = setTimeout(() => positionGlider(true), 320); // nach dem Padding-Übergang erneut messen
    }
  }, { rootMargin: `-${top() + 1}px 0px 0px 0px`, threshold: 0 });
  switchObserver.observe(sentinel);
}

/** Bereiche, in denen ein Team überall gleich heißen soll (Tabelle + „Nächste Spiele“ derselben Karte usw.). */
const NAME_SCOPES = '.group-card, .match-list, .fixture-list, .cross-card, .cmp, .chip-list, .md-summary';
const NAME_LEVEL = ['', 'use-short', 'use-code'];

/**
 * Lange Namen: Kurzname, sobald der volle Name abgeschnitten würde; Kürzel nur als letzte Stufe.
 * Spiellisten und (schmal) Gruppentabellen brechen Namen lieber zweizeilig um, statt zu Kürzeln zu werden –
 * in Gruppentabellen gibt es nie Kürzel. Innerhalb eines Bereichs bekommt dasselbe Team überall dieselbe Stufe.
 */
function fitNames(root = document) {
  const over = (el) => el && el.offsetParent && el.scrollWidth > el.clientWidth + 1;
  const tns = [...root.querySelectorAll('.tn')];
  const levels = new Map();
  const narrow = matchMedia('(max-width: 600px)').matches;
  // Sehr schmal (≤ 370px): Zeilen bleiben einzeilig – zu lange Namen nehmen Kurzform bzw. Kürzel (AZE, LIE) statt umzubrechen
  const tiny = matchMedia('(max-width: 370px)').matches;
  // Vergleichs-Chips („Dritte 2/4“): je Ansicht entweder alle neben dem Namen oder – wenn ein Name nicht passt – alle darunter
  const grid = document.querySelector('.group-grid');
  if (grid && (root === document || root.contains(grid))) {
    grid.classList.remove('tags-below');
    for (const t of tns) t.classList.remove('use-short', 'use-code');
    const tight = !narrow && [...grid.querySelectorAll('.standings .c-team__tags')].some((x) => over(x.closest('.c-team__in')?.querySelector('.tn__full')));
    grid.classList.toggle('tags-below', tight);
  }
  const wrapsAt = (tn) => !tiny && Boolean(tn.closest('.match__team, .mini-match__team') || (narrow && tn.closest('.standings')));
  // Gruppenkarten (Tabelle + nächste Spiele): lieber zweizeilig umbrechen als Kurzformen; Spielliste: lieber Kurzform
  const prefersWrap = (tn) => Boolean(tn.closest('.group-card'));
  for (const tn of tns) {
    tn.classList.remove('use-short', 'use-code');
    const wraps = wrapsAt(tn);
    if (wraps) tn.classList.add('is-measuring');
    let lv = 0;
    if (over(tn.querySelector('.tn__full'))) {
      lv = 2;
      if (tn.classList.contains('has-short') && !(wraps && prefersWrap(tn))) {
        tn.classList.add('use-short');
        if (!over(tn.querySelector('.tn__short'))) lv = 1;
        tn.classList.remove('use-short');
      }
      // umbrechen statt Kürzel; schmale Gruppentabellen brechen immer um (keine Kurzformen neben vollen Namen)
      if (wraps && (lv === 2 || tn.closest('.standings'))) lv = 0;
      if (lv === 2 && tn.closest('.standings') && !tiny) lv = tn.classList.contains('has-short') ? 1 : 0;
    }
    if (wraps) tn.classList.remove('is-measuring');
    levels.set(tn, lv);
  }
  const scopeMax = new Map();
  const key = (tn) => {
    const scope = tn.closest(NAME_SCOPES);
    return scope ? [scope, tn.dataset.code] : null;
  };
  for (const tn of tns) {
    const k = key(tn);
    if (!k) continue;
    const m = scopeMax.get(k[0]) || new Map();
    m.set(k[1], Math.max(m.get(k[1]) || 0, levels.get(tn)));
    scopeMax.set(k[0], m);
  }
  for (const tn of tns) {
    const k = key(tn);
    let lv = levels.get(tn);
    // Bereichsweit nur bis zum Kurznamen angleichen – Kürzel bleiben auf Stellen beschränkt, an denen nichts anderes passt
    if (k) lv = Math.max(lv, Math.min(1, scopeMax.get(k[0]).get(k[1]) || 0));
    if (lv === 2 && tn.closest('.match__team, .mini-match__team, .standings') && !(tiny && tn.closest('.standings, .mini-match__team'))) lv = tn.classList.contains('has-short') ? 1 : 0;
    if (lv === 1 && !tn.classList.contains('has-short')) lv = 0;
    levels.set(tn, lv);
  }
  // Kürzel nur tabellenweit (Vergleichstabellen): Braucht ein Team das Kürzel, zeigt die ganze Tabelle Kürzel
  const codeTables = new Set(tns.filter((tn) => levels.get(tn) === 2).map((tn) => tn.closest('.cmp-table')).filter(Boolean));
  for (const tn of tns) {
    let lv = levels.get(tn);
    if (codeTables.has(tn.closest('.cmp-table'))) lv = 2;
    if (lv) tn.classList.add(NAME_LEVEL[lv]);
  }
}

/** Großer Teamname im Panel: eine Zeile, bei Bedarf kleiner (bis 22px) statt mitten im Wort umzubrechen. */
function fitHeroName(root = panel) {
  const el = root.querySelector('.tp__name');
  if (!el) return;
  el.style.fontSize = '';
  let size = parseFloat(getComputedStyle(el).fontSize);
  while (el.scrollWidth > el.clientWidth + 1 && size > 22) {
    size -= 1;
    el.style.fontSize = `${size}px`;
  }
}

/** Tageskopf der Spielliste: Linie/Schatten nur, solange er angeheftet ist. */
function markStuckHeads() {
  const heads = document.querySelectorAll('.day__head');
  if (!heads.length) return;
  heads.forEach((h) => {
    // Tatsächliche Haftkante (Kopf, ggf. + angeheftete Spieltag-Leiste)
    const top = parseFloat(getComputedStyle(h).top) || headerBottom();
    const r = h.getBoundingClientRect();
    const sec = h.parentElement.getBoundingClientRect();
    h.classList.toggle('is-stuck', r.top <= top + 1 && sec.top < top - 1);
  });
}

function toggleGroup(id, btn) {
  const box = document.getElementById(`gm-${id}`);
  const open = !state.openGroups.has(id);
  if (open) state.openGroups.add(id); else state.openGroups.delete(id);
  btn.setAttribute('aria-expanded', String(open));
  btn.querySelector('span').textContent = open ? 'Spiele ausblenden' : 'Alle Spiele & Ergebnisse';
  if (open) {
    const g = state.model.leagues.flatMap((l) => l.groups).find((x) => x.id === id);
    box.innerHTML = renderGroupMatches(state.model, g);
    box.hidden = false;
    fitNames(box);
  } else {
    box.hidden = true;
    box.innerHTML = '';
  }
}

/** Design-Wahl: System (folgt dem Gerät) → Hell → Dunkel → System. Das Symbol zeigt die aktuelle Wahl. */
const THEME_ORDER = ['system', 'light', 'dark'];
const THEME_NAME = { system: 'System', light: 'Hell', dark: 'Dunkel' };
const systemLight = matchMedia('(prefers-color-scheme: light)');
const themePref = () => (THEME_ORDER.includes(document.documentElement.dataset.themePref) ? document.documentElement.dataset.themePref : 'system');

function applyTheme(pref, { animate = true } = {}) {
  const root = document.documentElement;
  const t = pref === 'system' ? (systemLight.matches ? 'light' : 'dark') : pref;
  if (animate && !reducedMotion.matches && root.dataset.theme !== t) {
    root.classList.add('theme-anim');
    clearTimeout(applyTheme.timer);
    applyTheme.timer = setTimeout(() => root.classList.remove('theme-anim'), 320);
  }
  root.dataset.theme = t;
  root.dataset.themePref = pref;
  updateThemeButton();
}
function setTheme(pref) {
  try { if (pref === 'system') localStorage.removeItem('nl-theme'); else localStorage.setItem('nl-theme', pref); } catch { /* egal */ }
  applyTheme(pref);
}
function updateThemeButton() {
  const pref = themePref();
  const light = document.documentElement.dataset.theme === 'light';
  const next = THEME_ORDER[(THEME_ORDER.indexOf(pref) + 1) % THEME_ORDER.length];
  const btn = $('#theme-toggle');
  const now = pref === 'system' ? `System (${light ? 'hell' : 'dunkel'})` : THEME_NAME[pref];
  btn.setAttribute('aria-label', `Design: ${now}. Wechseln zu ${THEME_NAME[next]}`);
  btn.dataset.tipTitle = `Design: ${now}`;
  btn.dataset.tip = `Klicken für ${THEME_NAME[next]}`;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', light ? '#f3f5fb' : '#050a1a');
}

function goLeague(id) {
  const hash = `#/tabellen/${id}`;
  if (location.hash !== hash) history.pushState(null, '', hash);
  // Fokus folgt immer dem neuen Tab (auch nach Mausklick → Pfeiltasten funktionieren weiter);
  // der sichtbare Ring erscheint per :focus-visible nur bei Tastaturbedienung
  state.focusTab = id;
  onRoute();
  revealLeagueHead();
}

/** Nach einem Ligawechsel im angehefteten Zustand: Liga-Kopf vollständig unter der Leiste zeigen. */
function revealLeagueHead() {
  const wrap = $('.league-switch-wrap');
  const sentinel = $('.league-switch-sentinel');
  if (!wrap?.classList.contains('is-stuck') || !sentinel) return;
  const top = sentinel.getBoundingClientRect().top + window.scrollY - headerBottom();
  window.scrollTo({ top: Math.max(0, top), behavior: reducedMotion.matches ? 'auto' : 'smooth' });
}

const headerHeight = () => Math.round($('#site-header').getBoundingClientRect().height);
/** Sichtbare Unterkante des Kopfs (berücksichtigt die eingeklappte Markenzeile). */
const headerBottom = () => Math.max(0, Math.round($('#site-header').getBoundingClientRect().bottom));

/** --header-h folgt der tatsächlichen Header-Höhe → angeheftete Leisten schließen nahtlos an. */
function trackHeaderHeight() {
  const apply = () => {
    const h = headerHeight();
    if (!h) return;
    const cur = parseFloat(document.documentElement.style.getPropertyValue('--header-h'));
    if (cur === h) return;
    document.documentElement.style.setProperty('--header-h', `${h}px`);
    observeSwitch();
  };
  apply();
  if ('ResizeObserver' in window) new ResizeObserver(apply).observe($('#site-header'));
}

function bind() {
  document.addEventListener('click', (e) => {
    // Touch: Erklär-Zeichen in der Tabelle (Platz-Chip, Vergleichsrang, ⇅) öffnen wie die ganze Zeile das Team-Panel –
    // die Erklärung steht dort; kleine Tooltip-Ziele konkurrieren nicht mit dem Zeilen-Tipp
    const touchRow = touchUi.matches && e.target.closest('.standings tbody tr');
    if (e.target.closest('.data-status') || (!touchRow && e.target.closest('.tie-mark'))) return; // Tooltip statt Navigation
    const closer = e.target.closest('[data-close-panel]');
    if (closer) {
      const link = closer.closest('a[href]');
      if (link) { e.preventDefault(); closeTeam({ navigate: link.getAttribute('href') }); }
      else closeTeam();
      return;
    }
    const leagueTab = e.target.closest('a.league-tab');
    if (leagueTab && !e.metaKey && !e.ctrlKey && !e.shiftKey && e.button === 0) {
      e.preventDefault();
      goLeague(leagueTab.dataset.league);
      return;
    }
    const scrollTo = e.target.closest('[data-scroll-to]');
    if (scrollTo) {
      document.getElementById(scrollTo.dataset.scrollTo)?.scrollIntoView({ behavior: reducedMotion.matches ? 'auto' : 'smooth', block: 'start' });
      return;
    }
    const teamBtn = e.target.closest('[data-team]');
    if (teamBtn && !e.target.closest('a[href]:not([data-team])') && (touchRow || !e.target.closest('.xrank, .tie-mark, .zone-badge'))) {
      e.preventDefault();
      hideTip();
      const opener = teamBtn.matches('button, a[href]') ? teamBtn : teamBtn.querySelector('button[data-team]') || null;
      openTeam(teamBtn.dataset.team, { opener });
      return;
    }
    const dayBtn = e.target.closest('[data-day-toggle]');
    if (dayBtn) { toggleDay(dayBtn); markStuckHeads(); return; }
    const tg = e.target.closest('[data-toggle-group]');
    if (tg) { toggleGroup(tg.dataset.toggleGroup, tg); return; }
  });
  scrim.addEventListener('click', () => closeTeam());
  panel.addEventListener('scroll', onPanelScroll, { passive: true });
  bindSheetDrag();
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { if (!tooltip.hidden) hideTip(); else closeTeam(); }
    trapFocus(e);
    // Pfeiltasten, Pos1 und Ende im Liga-Umschalter
    const tab = e.target.closest?.('.league-tab');
    if (tab && ['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) {
      const ids = ['A', 'B', 'C', 'D'];
      const i = ids.indexOf(tab.dataset.league);
      const n = e.key === 'Home' ? 0 : e.key === 'End' ? ids.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : ids.length - 1)) % ids.length;
      e.preventDefault();
      goLeague(ids[n]);
    }
  });
  const toggle = $('#theme-toggle');
  toggle.addEventListener('pointerleave', () => { delete toggle.dataset.tipMuted; });
  toggle.addEventListener('click', () => {
    toggle.dataset.tipMuted = '1'; // Tooltip erst nach erneutem Überfahren wieder zeigen
    hideTip();
    setTheme(THEME_ORDER[(THEME_ORDER.indexOf(themePref()) + 1) % THEME_ORDER.length]);
  });
  systemLight.addEventListener?.('change', () => { if (themePref() === 'system') applyTheme('system'); });

  // Tooltips: Maus mit kurzer Verzögerung, Tastatur sofort, Touch per Tipp
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch') return;
    let t = e.target.closest('[data-tip]');
    if (t?.dataset.tipMuted) t = null;
    if (t === tipTarget) return;
    clearTimeout(tipTimer);
    if (t) tipTimer = setTimeout(() => showTip(t), tipTarget ? 0 : 280);
    else if (tipTarget) hideTip();
  });
  document.addEventListener('pointerdown', (e) => {
    if (!e.target.closest('.data-status, .pos[data-tip], .xrank, .tie-mark, .zone-badge, .kpis [data-tip], .md-summary [data-tip]')) hideTip();
  }, true);
  document.addEventListener('focusin', (e) => {
    let t = e.target.closest?.('[data-tip]');
    // Tastatur: Zonen-Erklärung der Zeile am Teamnamen zeigen, Tabellenführer am Liga-Tab
    if (!t && e.target.matches?.('.standings .team-link')) t = e.target.closest('tr')?.querySelector('.pos[data-tip]');
    if (!t && e.target.matches?.('.league-tab')) t = e.target.querySelector('.league-tab__aside[data-tip]');
    if (t && t.offsetParent && e.target.matches(':focus-visible')) showTip(t); else if (tipTarget) hideTip();
  });
  document.addEventListener('click', (e) => {
    const t = e.target.closest('.data-status[data-tip], .pos[data-tip], .xrank[data-tip], .tie-mark[data-tip], .zone-badge[data-tip], .kpis [data-tip], .md-summary [data-tip]');
    if (t && touchUi.matches && t.closest('.standings')) return; // Touch: Zeile öffnet das Panel (siehe oben)
    if (t && t !== tipTarget) { e.stopPropagation(); showTip(t); }
  }, true);
  window.addEventListener('scroll', () => tipTarget && hideTip(), { passive: true });
  let rz = null;
  window.addEventListener('resize', () => {
    positionGlider(true); hideTip();
    cancelAnimationFrame(rz); rz = requestAnimationFrame(() => { fitNames(); if (!panel.hidden) fitHeroName(); });
  });
  window.addEventListener('hashchange', onRoute);
  window.addEventListener('popstate', () => { if (!location.hash.startsWith('#/team/') && !panel.hidden) closeTeam({ fromRoute: true }); });

  // Header: transparent oben, beim Scrollen deckend mit Linie
  const header = $('#site-header');
  let stuckRaf = 0;
  // Schmal (zweizeiliger Kopf): beim Herunterscrollen weicht die Markenzeile, die Tabs bleiben; beim Hochscrollen kehrt sie zurück
  const twoRow = matchMedia('(max-width: 960px)');
  let lastY = window.scrollY;
  const setShift = (on) => {
    const nav = header.querySelector('.main-nav');
    const shift = on && nav ? Math.round(nav.getBoundingClientRect().top - header.getBoundingClientRect().top + (header.classList.contains('is-condensed') ? parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--header-shift')) || 0 : 0)) : 0;
    header.classList.toggle('is-condensed', Boolean(shift));
    document.documentElement.style.setProperty('--header-shift', `${shift}px`);
  };
  twoRow.addEventListener?.('change', () => setShift(false));
  const onScroll = () => {
    const y = window.scrollY;
    header.classList.toggle('is-scrolled', y > 4);
    if (twoRow.matches && !document.body.classList.contains('has-panel')) {
      const dy = y - lastY;
      if (y < 120 || dy < -6) { if (header.classList.contains('is-condensed')) setShift(false); }
      else if (dy > 6 && !header.classList.contains('is-condensed')) { hideTip(); setShift(true); }
      if (Math.abs(dy) > 6 || y < 120) lastY = y;
    } else lastY = y;
    cancelAnimationFrame(stuckRaf);
    stuckRaf = requestAnimationFrame(markStuckHeads);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

/* ------------------------------------------------------------------ Start */

async function main() {
  installFlagFallback();
  trackHeaderHeight();
  updateThemeButton();
  bind();
  state.route = { ...state.route, ...parseHash() };
  render();
  const store = createStore((model) => {
    const first = !state.model;
    state.model = model;
    renderStatus(model);
    if (first) onRoute(); else render();
  });
  try {
    await store.start();
  } catch (e) {
    view.innerHTML = `<div class="error-box" role="alert"><h2>Daten konnten nicht geladen werden</h2><p>Bitte die Seite über einen Webserver öffnen (siehe README) und erneut laden.</p><p class="muted">${esc(e?.message || e)}</p><button type="button" class="ghost-btn" onclick="location.reload()">Erneut laden</button></div>`;
    $('#data-status .data-status__text').textContent = 'Offline';
  }
  document.fonts?.ready.then(() => { positionGlider(true); fitNames(); if (!panel.hidden) fitHeroName(); });
}

main();
