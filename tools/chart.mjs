#!/usr/bin/env node
/**
 * chart.mjs — draws my GitHub year as a riso print.
 *
 * The hosted card services (github-readme-stats, activity-graph) were returning 503 and
 * 402, and none of them looked like the rest of my work anyway. This asks the GitHub API
 * for the numbers and draws three SVGs into assets/:
 *
 *   contributions.svg   the year as a halftone: one dot per day, sized by how much I did
 *   registers.svg       the front panel of the machine, showing this year's counters
 *   languages.svg       what I actually write, by bytes
 *
 * Run: GITHUB_TOKEN=… node tools/chart.mjs [username]
 */
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const USER = process.argv[2] || 'Legend101Zz';
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
const OUT = path.join(path.dirname(path.dirname(new URL(import.meta.url).pathname)), 'assets');

const INK = { paper: '#F1EADB', paper2: '#E6DDC9', ink: '#22304A', soft: '#5C6A82', teal: '#177C80', red: '#DF5C3A', amber: '#F7CE6D', screen: '#16202F' };

if (!TOKEN) { console.error('chart: set GITHUB_TOKEN'); process.exit(1); }

const QUERY = `query($u:String!){ user(login:$u){
  contributionsCollection{
    contributionCalendar{ totalContributions weeks{ firstDay contributionDays{ date contributionCount } } }
    totalCommitContributions totalPullRequestContributions totalIssueContributions totalPullRequestReviewContributions
  }
  repositories(first:100, ownerAffiliations:OWNER, isFork:false){
    nodes{ stargazerCount languages(first:8, orderBy:{field:SIZE,direction:DESC}){ edges{ size node{ name } } } } }
}}`;

const res = await fetch('https://api.github.com/graphql', {
  method: 'POST',
  headers: { Authorization: `bearer ${TOKEN}`, 'Content-Type': 'application/json', 'User-Agent': 'comreton-chart' },
  body: JSON.stringify({ query: QUERY, variables: { u: USER } }),
});
const json = await res.json();
if (!json.data?.user) { console.error('chart: API said', JSON.stringify(json).slice(0, 300)); process.exit(1); }

const cc = json.data.user.contributionsCollection;
const weeks = cc.contributionCalendar.weeks;
const days = weeks.flatMap((w) => w.contributionDays);
const total = cc.contributionCalendar.totalContributions;
const stars = json.data.user.repositories.nodes.reduce((n, r) => n + r.stargazerCount, 0);

// streaks, counted backwards from the most recent day that has data
let cur = 0, best = 0, run = 0;
for (const d of days) { if (d.contributionCount > 0) { run++; best = Math.max(best, run); } else run = 0; }
for (let i = days.length - 1; i >= 0; i--) {
  if (days[i].contributionCount > 0) cur++;
  else if (i !== days.length - 1) break;            // today may legitimately be empty
}
const busiest = days.reduce((a, b) => (b.contributionCount > a.contributionCount ? b : a), days[0]);

// languages by bytes, across own non-fork repos
const bytes = new Map();
for (const r of json.data.user.repositories.nodes)
  for (const e of r.languages.edges) bytes.set(e.node.name, (bytes.get(e.node.name) || 0) + e.size);
const langs = [...bytes].sort((a, b) => b[1] - a[1]).slice(0, 6);
const langTotal = langs.reduce((n, l) => n + l[1], 0) || 1;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const MONO = 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace';
const paperDefs = `
  <defs>
    <pattern id="g" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(15)">
      <circle cx="1.2" cy="1.2" r="1.1" fill="${INK.teal}" opacity=".13"/>
    </pattern>
  </defs>`;

/* ---------------------------------------------------------------- the year */
{
  const P = 15, R = 5.6, left = 34, top = 44;
  const W = left + weeks.length * P + 22, H = top + 7 * P + 54;
  const max = Math.max(...days.map((d) => d.contributionCount), 1);
  const level = (n) => (n === 0 ? 0 : n >= max * 0.6 ? 4 : n >= max * 0.3 ? 3 : n >= max * 0.12 ? 2 : 1);

  let dots = '', over = '';
  weeks.forEach((w, wi) => {
    w.contributionDays.forEach((d) => {
      const wd = new Date(d.date + 'T00:00:00Z').getUTCDay();
      const cx = left + wi * P + P / 2, cy = top + wd * P + P / 2, L = level(d.contributionCount);
      if (L === 0) { dots += `<circle cx="${cx}" cy="${cy}" r="1.5" fill="${INK.ink}" opacity=".14"/>`; return; }
      const r = [0, R * 0.34, R * 0.56, R * 0.8, R][L];
      dots += `<circle cx="${cx}" cy="${cy}" r="${r.toFixed(2)}" fill="${INK.ink}" opacity="${L === 4 ? 0.9 : 0.78}"/>`;
      // the busiest days get a second pass in vermilion, deliberately misregistered
      if (L === 4) over += `<circle cx="${(cx + 1.6).toFixed(1)}" cy="${(cy - 1.2).toFixed(1)}" r="${(r * 0.62).toFixed(2)}" fill="${INK.red}" opacity=".85"/>`;
    });
  });

  let months = '';
  let lastM = -1;
  weeks.forEach((w, wi) => {
    const d = new Date(w.firstDay + 'T00:00:00Z'), m = d.getUTCMonth();
    if (m !== lastM && wi < weeks.length - 1) {
      months += `<text x="${left + wi * P}" y="${top - 10}" font-size="10" fill="${INK.soft}" font-family="${MONO}">${d.toLocaleString('en', { month: 'short', timeZone: 'UTC' }).toLowerCase()}</text>`;
      lastM = m;
    }
  });
  const wd = ['mon', 'wed', 'fri'].map((n, i) => `<text x="2" y="${top + (i * 2 + 1) * P + 10}" font-size="9" fill="${INK.soft}" font-family="${MONO}">${n}</text>`).join('');

  const legend = [1, 2, 3, 4].map((L, i) => `<circle cx="${W - 92 + i * 14}" cy="${H - 20}" r="${[R * 0.34, R * 0.56, R * 0.8, R][i].toFixed(2)}" fill="${INK.ink}" opacity=".8"/>`).join('');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${total} contributions in the last year">
${paperDefs}
  <rect width="${W}" height="${H}" fill="${INK.paper}"/><rect width="${W}" height="${H}" fill="url(#g)"/>
  <text x="14" y="24" font-size="13" fill="${INK.ink}" font-family="${MONO}">the last year, printed</text>
  <text x="${W - 14}" y="24" text-anchor="end" font-size="13" fill="${INK.red}" font-family="${MONO}">${total.toLocaleString('en')} contributions</text>
  <line x1="14" y1="31" x2="${W - 14}" y2="31" stroke="${INK.ink}" stroke-width="1" opacity=".25"/>
  ${months}${wd}${dots}${over}
  <text x="14" y="${H - 16}" font-size="10.5" fill="${INK.soft}" font-family="${MONO}">longest streak ${best} days · current ${cur} · busiest ${busiest.contributionCount} on ${busiest.date}</text>
  <text x="${W - 106}" y="${H - 16}" text-anchor="end" font-size="10" fill="${INK.soft}" font-family="${MONO}">less</text>
  ${legend}<text x="${W - 14}" y="${H - 16}" text-anchor="end" font-size="10" fill="${INK.soft}" font-family="${MONO}">more</text>
</svg>`;
  await mkdir(OUT, { recursive: true });
  await writeFile(path.join(OUT, 'contributions.svg'), svg);
}

/* ------------------------------------------------------- the front panel */
{
  const regs = [
    ['CONTRIBUTIONS', total.toLocaleString('en')],
    ['COMMITS', cc.totalCommitContributions.toLocaleString('en')],
    ['PULL REQUESTS', cc.totalPullRequestContributions.toLocaleString('en')],
    ['REVIEWS', cc.totalPullRequestReviewContributions.toLocaleString('en')],
    ['STARS', String(stars)],
    ['STREAK', `${best}d`],
  ];
  const W = 880, H = 76, cell = (W - 24) / regs.length;
  const cells = regs.map(([k, v], i) => {
    const cx = 12 + cell * i + cell / 2;
    return `<text x="${cx}" y="40" text-anchor="middle" font-size="21" fill="${INK.amber}" font-family="${MONO}">${v}</text>
    <text x="${cx}" y="56" text-anchor="middle" font-size="9" fill="${INK.amber}" opacity=".7" letter-spacing="1" font-family="${MONO}">${k}</text>`;
  }).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="registers: ${regs.map(r => r.join(' ')).join(', ')}">
  <rect width="${W}" height="${H}" rx="6" fill="${INK.screen}"/>
  <rect x="3" y="3" width="${W - 6}" height="${H - 6}" rx="4" fill="none" stroke="${INK.amber}" stroke-width="1" opacity=".25"/>
  ${cells}
  <circle cx="${W - 16}" cy="${H - 14}" r="3.4" fill="${INK.red}"><animate attributeName="opacity" values=".3;1;.3" dur="2.4s" repeatCount="indefinite"/></circle>
</svg>`;
  await writeFile(path.join(OUT, 'registers.svg'), svg);
}

/* ---------------------------------------------------------- the languages */
{
  const W = 430, H = 40 + langs.length * 22 + 34;
  const inks = [INK.ink, INK.teal, INK.red, INK.amber, INK.soft, INK.paper2];
  let x = 14, bar = '';
  langs.forEach(([, size], i) => {
    const w = ((W - 28) * size) / langTotal;
    bar += `<rect x="${x.toFixed(1)}" y="34" width="${Math.max(2, w - 1.5).toFixed(1)}" height="14" rx="2" fill="${inks[i]}" stroke="${INK.ink}" stroke-width=".8"/>`;
    x += w;
  });
  const rows = langs.map(([name, size], i) => {
    const pct = ((size / langTotal) * 100).toFixed(1);
    const y = 70 + i * 22;
    return `<rect x="14" y="${y - 9}" width="11" height="11" rx="2" fill="${inks[i]}" stroke="${INK.ink}" stroke-width=".8"/>
    <text x="33" y="${y}" font-size="12" fill="${INK.ink}" font-family="${MONO}">${esc(name)}</text>
    <text x="${W - 14}" y="${y}" text-anchor="end" font-size="12" fill="${INK.soft}" font-family="${MONO}">${pct}%</text>`;
  }).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="most used languages">
${paperDefs}
  <rect width="${W}" height="${H}" fill="${INK.paper}"/><rect width="${W}" height="${H}" fill="url(#g)"/>
  <text x="14" y="22" font-size="13" fill="${INK.ink}" font-family="${MONO}">what I actually write</text>
  <line x1="14" y1="28" x2="${W - 14}" y2="28" stroke="${INK.ink}" stroke-width="1" opacity=".25"/>
  ${bar}${rows}
</svg>`;
  await writeFile(path.join(OUT, 'languages.svg'), svg);
}

console.log(`chart: ${total} contributions · ${langs.length} languages · streak ${best}d → assets/`);
