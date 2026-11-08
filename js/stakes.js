// Topspiele und mögliche Entscheidungen je Gruppe und Spieltag
import { positionRanges, isFinished } from './standings.js';

/**
 * Tabellengrenzen, an denen sich je Liga die Folge ändert (Plätze ≤ cut gegenüber > cut).
 * yes/no sind Satzreste für „rechnerisch geschafft“ bzw. „rechnerisch verpasst“; stakeSentence() setzt
 * daraus mit dem nötigen Ergebnis einen ganzen Satz zusammen („Mit einem Sieg ist … sicher.“).
 * Liga A, Platz 3/4: Ob Klassenerhalt, Play-off oder Abstieg folgt, entscheidet erst der Vergleich
 * der Gruppen – innerhalb der Gruppe steht nur fest, ob ein Team Letzter wird.
 * Liga D: Alle Teams steigen auf – nichts zu entscheiden.
 */
const CUTS = {
  A: [{ cut: 2, yes: 'ist das Viertelfinale sicher', no: 'ist das Viertelfinale nicht mehr erreichbar' },
    { cut: 3, yes: 'kann das Team nicht mehr Gruppenletzter werden und steigt damit nicht direkt ab',
      no: 'steht Platz 4 in der Gruppe fest, dann droht das Play-off A/B oder sogar der direkte Abstieg', low: true }],
  B: [{ cut: 1, yes: 'ist der direkte Aufstieg in Liga A sicher', no: 'ist der direkte Aufstieg nicht mehr möglich' },
    { cut: 2, yes: 'ist mindestens Platz 2 sicher und damit wenigstens das Play-off um den Aufstieg in Liga A',
      no: 'ist auch Platz 2 nicht mehr erreichbar, ein Aufstieg ist dann ausgeschlossen' },
    { cut: 3, yes: 'ist der Klassenerhalt in Liga B sicher',
      no: 'steht Platz 4 in der Gruppe fest, dann geht es im Play-off B/C um den Klassenerhalt', low: true }],
  C: [{ cut: 1, yes: 'ist der direkte Aufstieg in Liga B sicher', no: 'ist der direkte Aufstieg nicht mehr möglich' },
    { cut: 2, yes: 'ist mindestens Platz 2 sicher und damit wenigstens das Play-off um den Aufstieg in Liga B',
      no: 'ist auch Platz 2 nicht mehr erreichbar, ein Aufstieg ist dann ausgeschlossen' }],
};

// Ergebnis aus Sicht des Heimteams: Sieg, Remis, Niederlage
const RESULTS = [['W', 1, 0], ['D', 0, 0], ['L', 0, 1]];
const flip = { W: 'L', D: 'D', L: 'W' };
const clear = (m) => ({ ...m, hs: null, as: null, status: 'UPCOMING' });

/**
 * Analysiert eine Gruppe für einen Spieltag – immer mit dem Stand vor dem Spieltag, damit Stern und
 * Hinweise auch während und nach den Spielen gleich bleiben. Alle Ergebniskombinationen der Spiele
 * dieses Spieltags werden durchgespielt; für jede Kombination liefert positionRanges die noch
 * möglichen Plätze bis zum Ende der Ligaphase (Gleichstände vorsichtig, nur Punkte).
 * @returns {Map<object, object[]>} je Spiel die möglichen Entscheidungen
 */
function analyzeGroup(group, md) {
  const out = new Map();
  const cuts = CUTS[group.league];
  const day = group.matches.filter((m) => m.md === md);
  if (!cuts || !day.length) return out;
  const base = group.matches.map((m) => (m.md >= md ? clear(m) : m));
  // Erst wenn höchstens noch zwei Spiele je Team offen sind, kann etwas feststehen (spart Rechenzeit)
  const remaining = base.filter((m) => m.md !== md && !isFinished(m));
  if (remaining.length > 4) return out;
  const before = positionRanges(group.teams, base);
  if (!before) return out;

  // Alle Kombinationen der Spieltagsergebnisse → mögliche Plätze je Team
  const combos = [];
  const walk = (i, res) => {
    if (i === day.length) {
      const hyp = base.map((m) => {
        const k = day.indexOf(day.find((d) => d.home === m.home && d.away === m.away));
        if (k < 0) return m;
        const [, hs, as] = RESULTS.find((r) => r[0] === res[k]);
        return { ...m, hs, as, status: 'FINISHED' };
      });
      combos.push({ res: [...res], ranges: positionRanges(group.teams, hyp) });
      return;
    }
    for (const [r] of RESULTS) walk(i + 1, [...res, r]);
  };
  walk(0, []);

  day.forEach((m, k) => {
    const found = [];
    for (const [code, home] of [[m.home, true], [m.away, false]]) {
      const now = before[code];
      const pos = group.table.find((r) => r.code === code)?.pos ?? 99;
      // Ergebnis aus Sicht dieses Teams; wichtigste Grenze zuerst, je Team höchstens eine Aussage
      const own = (c) => (home ? c.res[k] : flip[c.res[k]]);
      let best = null;
      for (const { cut, yes, no, low } of cuts) {
        if (now.best > cut || now.worst <= cut) continue; // an dieser Grenze schon entschieden
        // „verpasst / steht fest“ nur, wenn ein Team den Platz verliert, den es gerade hält,
        // oder wenn sich die untere Zone bestätigt – nicht für jedes Team, das nur noch hofft
        const checks = [['yes', yes, (r) => r.worst <= cut, ['D', 'W']]]; // schwächstes ausreichendes Ergebnis zuerst
        if (pos <= cut || low) checks.push(['no', no, (r) => r.best > cut, ['D', 'L']]);
        for (const [kind, text, ok, order] of checks) {
          for (const result of order) {
            const cs = combos.filter((c) => own(c) === result);
            // Nur Aussagen, die dieses Ergebnis allein entscheidet – unabhängig vom Parallelspiel
            if (!cs.length || !cs.every((c) => c.ranges && ok(c.ranges[code]))) continue;
            if (!best || (kind === 'yes' && best.kind === 'no')) best = { team: code, kind, text, result, cut };
            break;
          }
        }
        if (best) break;
      }
      if (best) found.push(best);
    }
    out.set(m, found);
  });
  return out;
}

/** Gewicht der Tabellenlage; Spiele, in denen für beide Teams nichts mehr offen ist, zählen kaum. */
function weight(model, m, stakes, group) {
  const h = model.teams[m.home]?.row, a = model.teams[m.away]?.row;
  if (!h || !a) return 0;
  const settled = (r) => group.ranges?.[r.code] && group.ranges[r.code].best === group.ranges[r.code].worst;
  if (settled(h) && settled(a)) return -100;
  return h.pts + a.pts + (h.pos <= 2 && a.pos <= 2 ? 6 : 0) - Math.abs(h.pts - a.pts) + 8 * stakes.length;
}

/**
 * Für alle Spiele der Liste: mögliche Entscheidungen und je Gruppe ein Topspiel (★).
 * @returns {Map<object, {stakes: object[], top: boolean}>}
 */
export function analyzeMatches(model, list) {
  const info = new Map();
  const groups = new Map(model.leagues.flatMap((l) => l.groups.map((g) => [g.id, g])));
  const byGroup = new Map();
  for (const m of list) {
    const key = `${m.group}|${m.md}`;
    if (!byGroup.has(key)) byGroup.set(key, { g: groups.get(m.group), md: m.md, ms: [] });
    byGroup.get(key).ms.push(m);
  }
  for (const { g, md, ms } of byGroup.values()) {
    if (!g) continue;
    const stakes = analyzeGroup(g, md);
    for (const m of ms) info.set(m, { stakes: stakes.get(g.matches.find((x) => x.home === m.home && x.away === m.away)) || [], top: false });
    // Topspiel nur mit Tabellenstand (ab Spieltag 2) und wenn die Gruppe mehrere Spiele am Spieltag hat
    const playedBefore = g.matches.some((x) => x.md < md && isFinished(x));
    if (!playedBefore || ms.length < 2) continue;
    const scored = ms.map((m) => ({ m, w: weight(model, m, info.get(m).stakes, g) }));
    scored.sort((a, b) => b.w - a.w || info.get(b.m).stakes.length - info.get(a.m).stakes.length);
    if (scored[0].w > -100) info.get(scored[0].m).top = true;
  }
  return info;
}

/**
 * Aussage als ganzer Satz aus Sicht des genannten Teams, z. B.
 * „Schon mit einem Remis ist das Viertelfinale sicher.“ oder
 * „Bei einer Niederlage ist der direkte Aufstieg nicht mehr möglich.“
 */
export function stakeSentence(s) {
  if (s.kind === 'yes') return s.result === 'D' ? `Schon mit einem Remis ${s.text}.` : `Mit einem Sieg ${s.text}.`;
  return s.result === 'D' ? `Schon bei einem Remis ${s.text}.` : `Bei einer Niederlage ${s.text}.`;
}
