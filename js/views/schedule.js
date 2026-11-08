import { esc, flag, scoreCell, fmtDay, fmtDayShort, fmtRange, fmtTime, fmtShort, fmtWeekShort, teamName } from '../ui.js';
import { todayBerlin } from '../data.js';
import { analyzeMatches, stakeSentence } from '../stakes.js';

const LEAGUE_FILTERS = [['alle', 'Alle'], ['A', 'Liga A'], ['B', 'Liga B'], ['C', 'Liga C'], ['D', 'Liga D']];
const CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5.5 12.5l4 4 9-9"/></svg>';
const STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.8l2.5 5.1 5.6.8-4 3.9 1 5.6-5.1-2.7-5.1 2.7 1-5.6-4-3.9 5.6-.8z"/></svg>';
const INFO_SM = '<svg class="kpi__info" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.6v.1"/></svg>';
const STAKE_TIP = 'Das Ergebnis dieses Spiels legt allein – unabhängig vom Parallelspiel der Gruppe – rechnerisch etwas fest: Viertelfinale, Aufstieg, Play-off, Klassenerhalt oder Platz 4. Grundlage ist der Stand vor dem Spieltag; Gleichstände werden vorsichtig gewertet (nur Punkte).';
const BOLT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 3L5 13.5h6L10 21l8-10.5h-6z"/></svg>';
const PIN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/></svg>';
const INFO = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.6v.1"/></svg>';

export function defaultMatchday(model) {
  const open = model.matches.filter((m) => m.status !== 'FINISHED');
  if (!open.length) return 6;
  return Math.min(...open.map((m) => m.md));
}

export function renderSchedule(model, md, leagueFilter) {
  const mds = [...new Set(model.matches.map((m) => m.md))].sort((a, b) => a - b);
  const current = defaultMatchday(model);
  const list = model.matches.filter((m) => m.md === md && (leagueFilter === 'alle' || m.league === leagueFilter));
  const byDate = new Map();
  for (const m of list) {
    if (!byDate.has(m.date)) byDate.set(m.date, []);
    byDate.get(m.date).push(m);
  }
  const scope = leagueFilter === 'alle' ? '' : ` (Liga ${leagueFilter})`;
  const info = analyzeMatches(model, list);
  // Die Vorschau-Kopfzeile nennt den Abstand („in 35 Tagen“) bereits – dann keine Wiederholung am Tageskopf
  const summaryHasWhen = list.length > 0 && list.every((m) => m.status === 'UPCOMING');

  return `
  <section class="section" aria-labelledby="sched-title">
    <header class="section-head section-head--row">
      <div class="section-head__title">
        <p class="eyebrow">Ligaphase · 6 Spieltage</p>
        <h2 id="sched-title" class="display">Spieltage</h2>
      </div>
      <div class="seg-scroll">
        <div class="filter-chips" role="group" aria-label="Nach Liga filtern">
          ${LEAGUE_FILTERS.map(([id, label]) => `<a class="chip${leagueFilter === id ? ' is-active' : ''}" href="#/spieltage/${md}/${id}" ${leagueFilter === id ? 'aria-current="true"' : ''}>${label}</a>`).join('')}
        </div>
      </div>
    </header>

    <nav class="md-strip" aria-label="Spieltag wählen">
      ${mds.map((d) => {
        const ms = model.matches.filter((m) => m.md === d);
        const dates = ms.map((m) => m.date).sort();
        const fin = ms.every((m) => m.status === 'FINISHED');
        const live = ms.some((m) => m.status === 'LIVE');
        const state = live ? 'live' : fin ? 'done' : d === current ? 'next' : 'open';
        const stateLabel = { live: 'Live', done: 'Beendet', next: 'Nächster', open: 'Geplant' }[state];
        // Auswahl = Fläche + Ring; Status = nur Punkt/Häkchen + leises Wort (konkurriert nicht mit der Auswahl)
        return `<a class="md-tab md-tab--${state}${d === md ? ' is-active' : ''}" href="#/spieltage/${d}/${leagueFilter}" ${d === md ? 'aria-current="page"' : ''}>
          <span class="md-tab__label">Spieltag</span>
          <span class="md-tab__num">${d}</span>
          ${state === 'done' ? `<span class="md-tab__done" title="Beendet">${CHECK}<span class="sr-only">beendet</span></span>`
            : state === 'live' || state === 'next' ? `<span class="md-tab__state"><span class="md-tab__state-dot" aria-hidden="true"></span><span class="md-tab__state-text">${stateLabel}</span></span>` : `<span class="sr-only">${stateLabel}</span>`}
          <span class="md-tab__date">${fmtRange(dates[0], dates[dates.length - 1])}</span>
        </a>`;
      }).join('')}
    </nav>

    ${summary(model, list, scope, info)}

    ${highlights(model, list, info, md)}

    ${list.length ? [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, ms], di, dayList) => {
      const allDone = ms.every((m) => m.status === 'FINISHED');
      const anyLive = ms.some((m) => m.status === 'LIVE');
      const days = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${todayBerlin()}T00:00:00Z`)) / 864e5);
      const when = days > 1 ? `in ${days} Tagen` : days === 1 ? 'morgen' : days === 0 ? 'heute' : 'ausstehend';
      // Status-Pill nur, wo sie etwas sagt (Live, offene Tage); beendete Tage sind am Ergebnis erkennbar
      const mixed = !allDone && ms.some((m) => m.status === 'FINISHED');
      const firstOpen = dayList.findIndex(([, x]) => x.some((m) => m.status !== 'FINISHED')) === di;
      const pill = anyLive ? '<span class="day__pill day__pill--live"><span class="live-dot" aria-hidden="true"></span>Live</span>'
        : allDone ? ''
        : mixed ? `<span class="day__pill day__pill--upcoming">${CHECK}teils beendet</span>`
        : firstOpen && !summaryHasWhen ? `<span class="day__pill day__pill--when">${when}</span>` : '';
      // Spielort-Spalte nur, wenn er für mindestens die Hälfte der Spiele des Tages bekannt ist (keine halb leere Spalte)
      const withVenue = ms.filter((m) => m.venue).length * 2 >= ms.length;
      return `
      <section class="day" aria-label="${esc(fmtDay(date))}">
        <h3 class="day__head"><span class="day__date"><b><span class="day__date-long">${esc(fmtDay(date))}</span><span class="day__date-short" aria-hidden="true">${esc(fmtDayShort(date))}</span></b></span><span class="day__count">${pill}<span class="day__pill day__pill--count">${ms.length}&nbsp;${ms.length === 1 ? 'Spiel' : 'Spiele'}</span></span></h3>
        <ul class="match-list${withVenue ? ' has-venue' : ''}">
          ${ms.map((m) => matchRow(model, m, { venue: withVenue, info: info.get(m) })).join('')}
        </ul>
      </section>`;
    }).join('') : emptyState(model, md, leagueFilter)}
  </section>`;
}

function summary(model, list, scope, info) {
  const done = list.filter((m) => m.status === 'FINISHED');
  const live = list.filter((m) => m.status === 'LIVE');
  if (!done.length && !live.length && list.length) {
    // Kommender Spieltag: nützliche Vorschau statt Nullen
    const first = [...list].sort((a, b) => (a.kickoff || a.date).localeCompare(b.kickoff || b.date))[0];
    const days = Math.round((Date.parse(`${first.date}T00:00:00Z`) - Date.parse(`${todayBerlin()}T00:00:00Z`)) / 864e5);
    const decisive = [...info.values()].filter((x) => x.stakes.length).length;
    const when = days > 1 ? `in ${days} Tagen` : days === 1 ? 'morgen' : days === 0 ? 'heute' : '';
    const leagues = new Set(list.map((m) => m.league)).size;
    // Datum und Uhrzeit als eigene, nicht umbrechende Teile (kein hängender Trennpunkt)
    const at = (m) => `<span class="nowrap">${fmtWeekShort(m.date)} ${fmtShort(m.date)}</span>${m.kickoff ? `<span class="md-summary__sep" aria-hidden="true"> · </span><span class="nowrap">${fmtTime(m.kickoff)}</span>` : ''}`;
    return `<div class="md-summary md-summary--preview md-summary--3">
      <div class="md-summary__cell"><b class="md-summary__val">${list.length}</b><span class="md-summary__cap">${scope ? `Spiele${scope}` : `Spiele in ${leagues} ${leagues === 1 ? 'Liga' : 'Ligen'}`}</span></div>
      ${decisiveCell(decisive, 'können entscheiden', 'kann entscheiden')}
      <div class="md-summary__cell"><b class="md-summary__val md-summary__when">${at(first)}</b><span class="md-summary__cap">Erster Anpfiff${when ? `<span class="md-summary__pill">${when}</span>` : ''}</span></div>
    </div>`;
  }
  const goals = [...done, ...live].reduce((s, m) => s + m.hs + m.as, 0);
  const n = done.length + live.length;
  // „beendet“ nur, wenn es etwas Neues sagt (nicht alle Spiele gespielt); mobil eine Zeile
  const partial = done.length !== list.length;
  const openDecisive = [...info].filter(([m, x]) => m.status !== 'FINISHED' && x.stakes.length).length;
  return `<div class="md-summary md-summary--stats${partial ? '' : ' md-summary--3'}">
    <div class="md-summary__cell"><b class="md-summary__val">${list.length}</b><span class="md-summary__cap">Spiele${scope}</span></div>
    ${partial ? `<div class="md-summary__cell"><b class="md-summary__val">${done.length}</b><span class="md-summary__cap">beendet</span></div>` : ''}
    <div class="md-summary__cell"><b class="md-summary__val">${goals}</b><span class="md-summary__cap">Tore</span></div>
    <div class="md-summary__cell"><b class="md-summary__val">${n ? (goals / n).toLocaleString('de-DE', { maximumFractionDigits: 2, minimumFractionDigits: 1 }) : '–'}</b><span class="md-summary__cap">pro Spiel</span></div>
    ${openDecisive ? decisiveCell(openDecisive, 'können noch entscheiden', 'kann noch entscheiden') : ''}
  </div>`;
}

/** Kennzahl „können entscheiden“ – Erklärung per Tooltip, der auch auf Touch und mit Tastatur öffnet. */
function decisiveCell(n, plural, singular) {
  return `<div class="md-summary__cell kpi--info" tabindex="0" data-tip-title="Kann entscheiden" data-tip="${esc(STAKE_TIP)}"><b class="md-summary__val">${n}</b><span class="md-summary__cap">${n === 1 ? singular : plural}${INFO_SM}</span></div>`;
}

/** Topspiel je Gruppe (nach Tabellenlage) – aufklappbar, auf schmalen Bildschirmen zunächst zu. */
function highlights(model, list, info, md) {
  const tops = list.filter((m) => info.get(m)?.top).sort((a, b) => a.group.localeCompare(b.group));
  // Beendeter Spieltag: keine Vorschau mehr (der Stern an den Spielen bleibt)
  if (!tops.length || list.every((m) => m.status === 'FINISHED')) return '';
  const wide = typeof matchMedia === 'function' && matchMedia('(min-width: 721px)').matches;
  const decisive = tops.filter((m) => info.get(m).stakes.length).length;
  const pos = (t) => `<small><span class="sr-only">, Tabellenplatz </span>${t.row.pos}.</small>`;
  return `<details class="tops"${wide ? ' open' : ''}>
    <summary class="tops__title"><span class="tops__title-main">${STAR}<span>Topspiele je Gruppe</span></span><span class="tops__count">${tops.length} Spiele${decisive ? ` · ${decisive} ${decisive === 1 ? 'kann' : 'können'} entscheiden` : ''}</span><svg class="tops__chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></summary>
    <p class="tops__legend"><span class="tops__key tops__key--star">${STAR}Topspiel: das Spiel jeder Gruppe mit der spannendsten Tabellenlage</span><span class="tops__key">${BOLT}Kann entscheiden: das Ergebnis allein legt etwas fest</span>${md > currentMd(model) ? `<span class="tops__asof">Stand vor Spieltag ${md} – frühere offene Spiele können noch etwas ändern.</span>` : ''}</p>
    <ul class="tops__list">
      ${tops.map((m) => {
        const h = model.teams[m.home], a = model.teams[m.away];
        const st = info.get(m).stakes;
        return `<li class="top">
          <a class="match__group match__group--${m.league}" href="#/tabellen/${m.league}/${m.group}" aria-label="Tabelle Gruppe ${m.group}"><span>${m.group[0]}</span>${m.group.slice(1)}</a>
          <span class="top__pair">
            <button type="button" class="top__team" data-team="${esc(h.code)}">${flag(h)}${teamName(h)}${pos(h)}</button>
            <span class="top__vs" aria-hidden="true">–</span>
            <button type="button" class="top__team" data-team="${esc(a.code)}">${flag(a)}${teamName(a)}${pos(a)}</button>
          </span>
          <span class="top__when">${fmtWeekShort(m.date)} ${fmtShort(m.date)}${m.kickoff ? ` · ${fmtTime(m.kickoff)}` : ''}</span>
          ${st.length ? `<span class="top__stake">${stakeList(model, st)}</span>` : ''}
        </li>`;
      }).join('')}
    </ul>
  </details>`;
}

const currentMd = (model) => defaultMatchday(model);

/** Aussagen als Liste: „Frankreich: Schon mit einem Remis ist das Viertelfinale sicher.“ Team zuerst, damit Artikel und Plural nie stören. */
function stakeList(model, stakes) {
  return stakes.map((x) => `<span class="stake">${BOLT}<span><b>${esc(model.teams[x.team].name)}:</b> ${esc(stakeSentence(x))}</span></span>`).join('');
}

function emptyState(model, md, leagueFilter) {
  const next = model.matches.filter((m) => m.md > md && (leagueFilter === 'alle' || m.league === leagueFilter)).sort((a, b) => a.md - b.md)[0];
  return `<div class="empty"><p><b>Keine Spiele${leagueFilter === 'alle' ? '' : ` der Liga ${leagueFilter}`} an Spieltag ${md}.</b></p>
    ${next ? `<p><a class="link-btn" href="#/spieltage/${next.md}/${leagueFilter}">Zu Spieltag ${next.md} →</a></p>` : ''}</div>`;
}

/** Spielort in zwei Teilen: Stadion (darf gekürzt werden) und Stadt (bleibt immer stehen). Ohne Stadt: nur Stadion. */
function venueParts(v) {
  const i = v.lastIndexOf(', ');
  return i > 0 ? [v.slice(0, i).trim(), v.slice(i + 2).trim()] : [v.trim(), ''];
}

export function matchRow(model, m, { showGroup = true, venue = false, info = null } = {}) {
  const h = model.teams[m.home], a = model.teams[m.away];
  const done = Number.isInteger(m.hs) && m.status !== 'LIVE';
  const res = (side) => {
    if (!done) return '';
    const own = side === 'h' ? m.hs : m.as, opp = side === 'h' ? m.as : m.hs;
    return own > opp ? ' is-win' : own < opp ? ' is-loss' : ' is-draw';
  };
  const live = m.status === 'LIVE';
  const [stadium, city] = m.venue ? venueParts(m.venue) : ['', ''];
  // Raster: Meta links (Gruppe, Anstoß) | Heim | Ergebnis/Anstoß | Gast | Spielort – mobil Meta unter dem Ergebnis
  const venueHtml = m.venue
    ? `<span class="match__venue" title="${esc(m.venue)}">${PIN}<span class="match__venue-text">${stadium ? `<span class="match__venue-stadium">${esc(stadium)}</span>` : ''}${stadium && city ? '<span class="match__venue-comma">,&nbsp;</span>' : ''}${city ? `<span class="match__venue-city">${esc(city)}</span>` : ''}</span></span>`
    : '<span class="match__venue" aria-hidden="true"></span>';
  // Hinweise nur, solange das Spiel nicht beendet ist (live bleiben sie stehen)
  const stakes = done ? [] : info?.stakes || [];
  return `<li class="match${live ? ' is-live' : ''}${done ? ' is-done' : ' is-open'}${m.note || stakes.length ? ' has-note' : ''}${info?.top ? ' is-top' : ''}">
    <span class="match__meta">
      ${showGroup ? `<a class="match__group match__group--${m.league}" href="#/tabellen/${m.league}/${m.group}" aria-label="Tabelle Gruppe ${m.group}"><span>${m.group[0]}</span>${m.group.slice(1)}</a>` : ''}
      ${live ? '<span class="match__time is-live"><span class="live-dot"></span>Live</span>'
        : done && m.kickoff ? `<span class="match__time"><span class="match__sep" aria-hidden="true">·</span>${fmtTime(m.kickoff)}<span class="sr-only">&nbsp;Uhr Anstoß</span></span>`
        : `<span class="match__time match__time--day"><span class="match__sep" aria-hidden="true">·</span>${fmtWeekShort(m.date)}</span>`}
      ${info?.top ? `<span class="match__top" title="Topspiel der Gruppe">${STAR}<span class="sr-only">Topspiel der Gruppe</span></span>` : ''}
      ${venue && m.venue ? `<span class="match__meta-venue"><span class="match__sep" aria-hidden="true">·</span>${esc(city || stadium)}</span>` : ''}
    </span>
    <button type="button" class="match__team match__team--h${res('h')}" data-team="${esc(h.code)}">
      ${teamName(h)}${flag(h)}
    </button>
    ${scoreCell(m)}
    <button type="button" class="match__team match__team--a${res('a')}" data-team="${esc(a.code)}">
      ${flag(a)}${teamName(a)}
    </button>
    ${venue ? venueHtml : ''}
    ${stakes.length ? `<span class="match__note match__stake"><span class="sr-only">Kann entscheiden: </span>${stakeList(model, stakes)}</span>`
      : m.note ? `<span class="match__note">${INFO}${esc(m.note)}</span>` : ''}
  </li>`;
}
