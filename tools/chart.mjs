#!/usr/bin/env node
/**
 * chart.mjs — draws my GitHub years as a riso print.
 *
 * The hosted card services were returning 503 and 402, and none of them looked like the
 * rest of my work. This asks the GitHub API and draws into assets/:
 *
 *   contributions.svg   the tape: every year since 2021 as a weekly strip, then the last
 *                       year day by day as halftone dots, with a print head sweeping over
 *   contributions.json  the same data, for the hoverable version at comreton.vercel.app/tape
 *   registers.svg       the machine's front panel, this year's counters
 *   radar.svg           commits / PRs / issues / reviews / stars, as a web
 *   languages.svg       what I write — averaged per repo, so one huge bundle cannot win
 *   manga.svg           because I have been reading manga longer than I have been coding
 *
 * Run: GITHUB_TOKEN=… node tools/chart.mjs [username]
 */
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const USER = process.argv[2] || 'Legend101Zz';
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
const ROOT = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const OUT = path.join(ROOT, 'assets');
const FIRST_YEAR = 2021;

const INK = { paper: '#F1EADB', paper2: '#E6DDC9', ink: '#22304A', soft: '#5C6A82', teal: '#177C80', red: '#DF5C3A', amber: '#F7CE6D', screen: '#16202F' };
const MONO = 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

if (!TOKEN) { console.error('chart: set GITHUB_TOKEN'); process.exit(1); }

const gql = async (query, variables) => {
  const r = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `bearer ${TOKEN}`, 'Content-Type': 'application/json', 'User-Agent': 'comreton-chart' },
    body: JSON.stringify({ query, variables }),
  });
  const j = await r.json();
  if (!j.data) { console.error('chart: API said', JSON.stringify(j).slice(0, 400)); process.exit(1); }
  return j.data;
};

/* ------------------------------------------------------------------ data */
const thisYear = new Date().getUTCFullYear();
const years = [];
for (let y = FIRST_YEAR; y <= thisYear; y++) years.push(y);

const yearQuery = `query($u:String!){ user(login:$u){
  ${years.map((y) => `y${y}: contributionsCollection(from:"${y}-01-01T00:00:00Z", to:"${y}-12-31T23:59:59Z"){
      contributionCalendar{ totalContributions weeks{ firstDay contributionDays{ date contributionCount } } }
      totalCommitContributions totalPullRequestContributions totalIssueContributions totalPullRequestReviewContributions }`).join('\n')}
  rolling: contributionsCollection{
    contributionCalendar{ totalContributions weeks{ firstDay contributionDays{ date contributionCount } } }
    totalCommitContributions totalPullRequestContributions totalIssueContributions totalPullRequestReviewContributions }
}}`;

const u = (await gql(yearQuery, { u: USER })).user;

// repos, paginated — he has hundreds, and 100 was not enough to be fair to Rust and C++
let repos = [], cursor = null;
for (let page = 0; page < 4; page++) {
  const d = await gql(
    `query($u:String!,$c:String){ user(login:$u){ repositories(first:100, after:$c, ownerAffiliations:OWNER, isFork:false, orderBy:{field:PUSHED_AT,direction:DESC}){
      pageInfo{ hasNextPage endCursor }
      nodes{ name stargazerCount isArchived primaryLanguage{name} languages(first:10, orderBy:{field:SIZE,direction:DESC}){ edges{ size node{ name } } } } }}}`,
    { u: USER, c: cursor }
  );
  const r = d.user.repositories;
  repos = repos.concat(r.nodes);
  if (!r.pageInfo.hasNextPage) break;
  cursor = r.pageInfo.endCursor;
}
const stars = repos.reduce((n, r) => n + r.stargazerCount, 0);

// repos he contributes to but does not own — Brian2, Caravan and friends, where the C++ is
const contributed = (await gql(
  `query($u:String!){ user(login:$u){ repositoriesContributedTo(first:100, includeUserRepositories:false,
     contributionTypes:[COMMIT, PULL_REQUEST, REPOSITORY]){
     nodes{ nameWithOwner stargazerCount languages(first:10, orderBy:{field:SIZE,direction:DESC}){ edges{ size node{ name } } } } }}}`,
  { u: USER }
)).user.repositoriesContributedTo.nodes;

const roll = u.rolling;
const rollWeeks = roll.contributionCalendar.weeks;
const rollDays = rollWeeks.flatMap((w) => w.contributionDays);
const rollTotal = roll.contributionCalendar.totalContributions;

const perYear = years.map((y) => {
  const c = u[`y${y}`];
  return {
    year: y,
    total: c.contributionCalendar.totalContributions,
    commits: c.totalCommitContributions,
    prs: c.totalPullRequestContributions,
    issues: c.totalIssueContributions,
    reviews: c.totalPullRequestReviewContributions,
    weeks: c.contributionCalendar.weeks.map((w) => w.contributionDays.reduce((n, d) => n + d.contributionCount, 0)),
  };
});
const allTime = perYear.reduce((n, y) => n + y.total, 0);

let best = 0, run = 0, cur = 0;
for (const d of rollDays) { if (d.contributionCount > 0) { run++; best = Math.max(best, run); } else run = 0; }
for (let i = rollDays.length - 1; i >= 0; i--) {
  if (rollDays[i].contributionCount > 0) cur++;
  else if (i !== rollDays.length - 1) break;
}
const busiest = rollDays.reduce((a, b) => (b.contributionCount > a.contributionCount ? b : a), rollDays[0]);

/* languages: each repo votes with its own shares, so one 40 MB bundle cannot own the chart */
const share = new Map();
let counted = 0;
const vote = (r, weight) => {
  const edges = r.languages.edges.filter((e) => !['EJS', 'Handlebars', 'Blade', 'Procfile'].includes(e.node.name));
  const tot = edges.reduce((n, e) => n + e.size, 0);
  if (!tot) return;
  counted++;
  for (const e of edges) share.set(e.node.name, (share.get(e.node.name) || 0) + (weight * e.size) / tot);
};
for (const r of contributed) vote(r, 0.6);     // half a vote: I write in them, I did not start them
for (const r of repos) {
  vote(r, 1);
}
const ranked = [...share].sort((a, b) => b[1] - a[1]);
const langs = ranked.slice(0, 8);
const alsoWrites = ranked.slice(8, 14).map(([n]) => n);
const langTotal = langs.reduce((n, l) => n + l[1], 0) || 1;

await mkdir(OUT, { recursive: true });
await writeFile(
  path.join(OUT, 'contributions.json'),
  JSON.stringify({ user: USER, generated: new Date().toISOString(), rollTotal, allTime, best, cur, busiest, perYear, days: rollDays }, null, 0)
);

const paperDefs = `<defs>
    <pattern id="g" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(15)">
      <circle cx="1.2" cy="1.2" r="1.1" fill="${INK.teal}" opacity=".13"/>
    </pattern>
    <linearGradient id="sweep" x1="0" x2="1" y1="0" y2="0">
      <stop offset="0" stop-color="${INK.amber}" stop-opacity="0"/>
      <stop offset=".5" stop-color="${INK.amber}" stop-opacity=".55"/>
      <stop offset="1" stop-color="${INK.amber}" stop-opacity="0"/>
    </linearGradient>
  </defs>`;

/* ------------------------------------------------------------- the tape */
{
  const W = 880;
  const yearTop = 52, yearH = 26, tapeH = perYear.length * yearH;
  const gridTop = yearTop + tapeH + 34;
  const P = 14.2, R = 5.4, left = 40;
  const H = gridTop + 7 * P + 52;
  const maxDay = Math.max(...rollDays.map((d) => d.contributionCount), 1);
  const maxWeek = Math.max(...perYear.flatMap((y) => y.weeks), 1);
  const level = (n) => (n === 0 ? 0 : n >= maxDay * 0.6 ? 4 : n >= maxDay * 0.3 ? 3 : n >= maxDay * 0.12 ? 2 : 1);

  // years, one strip each: 53 weekly dots
  let tape = '';
  perYear.forEach((y, yi) => {
    const cy = yearTop + yi * yearH + yearH / 2;
    tape += `<text x="14" y="${cy + 4}" font-size="11.5" fill="${INK.ink}" font-family="${MONO}">${y.year}</text>`;
    tape += `<text x="${W - 14}" y="${cy + 4}" text-anchor="end" font-size="11" fill="${INK.soft}" font-family="${MONO}">${y.total.toLocaleString('en')}</text>`;
    const strip = W - left - 78;
    y.weeks.forEach((n, wi) => {
      const cx = left + (wi * strip) / 53 + 4;
      const r = n === 0 ? 1.3 : 1.8 + (Math.sqrt(n / maxWeek) * 4.4);
      const ink = n >= maxWeek * 0.55 ? INK.red : n >= maxWeek * 0.28 ? INK.teal : INK.ink;
      tape += `<circle cx="${cx.toFixed(1)}" cy="${cy}" r="${r.toFixed(2)}" fill="${ink}" opacity="${n ? 0.85 : 0.16}"><title>${y.year} week ${wi + 1}: ${n}</title></circle>`;
    });
  });

  // the last rolling year, day by day
  let dots = '', over = '', titles = '';
  rollWeeks.forEach((w, wi) => {
    w.contributionDays.forEach((d) => {
      const wd = new Date(d.date + 'T00:00:00Z').getUTCDay();
      const cx = left + wi * P + P / 2, cy = gridTop + wd * P + P / 2, L = level(d.contributionCount);
      const t = `<title>${d.contributionCount} on ${d.date}</title>`;
      if (L === 0) { dots += `<circle cx="${cx}" cy="${cy}" r="1.5" fill="${INK.ink}" opacity=".14">${t}</circle>`; return; }
      const r = [0, R * 0.34, R * 0.56, R * 0.8, R][L];
      dots += `<circle cx="${cx}" cy="${cy}" r="${r.toFixed(2)}" fill="${INK.ink}" opacity="${L === 4 ? 0.9 : 0.78}">${t}</circle>`;
      if (L === 4)
        over += `<circle cx="${(cx + 1.6).toFixed(1)}" cy="${(cy - 1.2).toFixed(1)}" r="${(r * 0.62).toFixed(2)}" fill="${INK.red}" opacity=".85">
        <animate attributeName="opacity" values=".85;.35;.85" dur="3s" begin="${((wi % 7) * 0.4).toFixed(1)}s" repeatCount="indefinite"/></circle>`;
    });
  });

  let months = '', lastM = -1;
  rollWeeks.forEach((w, wi) => {
    const d = new Date(w.firstDay + 'T00:00:00Z'), m = d.getUTCMonth();
    if (m !== lastM && wi < rollWeeks.length - 1) {
      months += `<text x="${left + wi * P}" y="${gridTop - 9}" font-size="9.5" fill="${INK.soft}" font-family="${MONO}">${d.toLocaleString('en', { month: 'short', timeZone: 'UTC' }).toLowerCase()}</text>`;
      lastM = m;
    }
  });
  const wd = ['mon', 'wed', 'fri'].map((n, i) => `<text x="4" y="${gridTop + (i * 2 + 1) * P + 9}" font-size="8.5" fill="${INK.soft}" font-family="${MONO}">${n}</text>`).join('');
  const legend = [1, 2, 3, 4].map((L, i) => `<circle cx="${W - 92 + i * 14}" cy="${H - 19}" r="${[R * 0.34, R * 0.56, R * 0.8, R][i].toFixed(2)}" fill="${INK.ink}" opacity=".8"/>`).join('');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${allTime} contributions since ${FIRST_YEAR}">
${paperDefs}
  <rect width="${W}" height="${H}" fill="${INK.paper}"/><rect width="${W}" height="${H}" fill="url(#g)"/>
  <text x="14" y="24" font-size="13" fill="${INK.ink}" font-family="${MONO}">the tape · every year since ${FIRST_YEAR}</text>
  <text x="${W - 14}" y="24" text-anchor="end" font-size="13" fill="${INK.red}" font-family="${MONO}">${allTime.toLocaleString('en')} contributions</text>
  <line x1="14" y1="32" x2="${W - 14}" y2="32" stroke="${INK.ink}" stroke-width="1" opacity=".25"/>
  <text x="14" y="46" font-size="9.5" fill="${INK.soft}" font-family="${MONO}">one dot per week</text>
  ${tape}
  <line x1="14" y1="${yearTop + tapeH + 14}" x2="${W - 14}" y2="${yearTop + tapeH + 14}" stroke="${INK.ink}" stroke-width="1" opacity=".18"/>
  <text x="14" y="${yearTop + tapeH + 10}" font-size="9.5" fill="${INK.soft}" font-family="${MONO}">day by day, the last year</text>
  ${months}${wd}${dots}${over}
  <rect x="-140" y="${gridTop - 16}" width="120" height="${7 * P + 22}" fill="url(#sweep)">
    <animateTransform attributeName="transform" type="translate" from="0 0" to="${W + 200} 0" dur="7s" repeatCount="indefinite"/>
  </rect>
  <text x="14" y="${H - 15}" font-size="10.5" fill="${INK.soft}" font-family="${MONO}">${rollTotal.toLocaleString('en')} in the last year · longest streak ${best} days · busiest ${busiest.contributionCount} on ${busiest.date}</text>
  <text x="${W - 106}" y="${H - 15}" text-anchor="end" font-size="10" fill="${INK.soft}" font-family="${MONO}">less</text>
  ${legend}<text x="${W - 14}" y="${H - 15}" text-anchor="end" font-size="10" fill="${INK.soft}" font-family="${MONO}">more</text>
</svg>`;
  await writeFile(path.join(OUT, 'contributions.svg'), svg);
}

/* ------------------------------------------------------ the front panel */
{
  const regs = [
    ['CONTRIBUTIONS', allTime.toLocaleString('en')],
    ['COMMITS', perYear.reduce((n, y) => n + y.commits, 0).toLocaleString('en')],
    ['PULL REQUESTS', perYear.reduce((n, y) => n + y.prs, 0).toLocaleString('en')],
    ['REVIEWS', perYear.reduce((n, y) => n + y.reviews, 0).toLocaleString('en')],
    ['REPOS', String(repos.length)],
    ['STREAK', `${best}d`],
  ];
  const W = 880, H = 76, cell = (W - 24) / regs.length;
  const cells = regs.map(([k, v], i) => {
    const cx = 12 + cell * i + cell / 2;
    return `<text x="${cx}" y="40" text-anchor="middle" font-size="21" fill="${INK.amber}" font-family="${MONO}">${v}</text>
    <text x="${cx}" y="56" text-anchor="middle" font-size="9" fill="${INK.amber}" opacity=".7" letter-spacing="1" font-family="${MONO}">${k}</text>`;
  }).join('');
  await writeFile(path.join(OUT, 'registers.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="registers">
  <rect width="${W}" height="${H}" rx="6" fill="${INK.screen}"/>
  <rect x="3" y="3" width="${W - 6}" height="${H - 6}" rx="4" fill="none" stroke="${INK.amber}" stroke-width="1" opacity=".25"/>
  ${cells}
  <circle cx="${W - 16}" cy="${H - 14}" r="3.4" fill="${INK.red}"><animate attributeName="opacity" values=".3;1;.3" dur="2.4s" repeatCount="indefinite"/></circle>
</svg>`);
}

/* -------------------------------------------------------------- the web */
{
  const axes = [
    ['commits', perYear.reduce((n, y) => n + y.commits, 0)],
    ['pull requests', perYear.reduce((n, y) => n + y.prs, 0)],
    ['reviews', perYear.reduce((n, y) => n + y.reviews, 0)],
    ['issues', perYear.reduce((n, y) => n + y.issues, 0)],
    ['stars', stars],
    ['repos', repos.length],
  ];
  const W = 430, H = 300, cx = W / 2, cy = 152, rad = 92;
  const max = Math.max(...axes.map((a) => a[1]), 1);
  const pt = (i, k) => {
    const a = (i / axes.length) * Math.PI * 2 - Math.PI / 2;
    return [cx + Math.cos(a) * rad * k, cy + Math.sin(a) * rad * k];
  };
  // log-ish scale so a 3,000 next to a 37 still says something
  const norm = (v) => Math.max(0.12, Math.log10(v + 1) / Math.log10(max + 1));
  const rings = [0.25, 0.5, 0.75, 1]
    .map((k) => `<polygon points="${axes.map((_, i) => pt(i, k).map((n) => n.toFixed(1)).join(',')).join(' ')}" fill="none" stroke="${INK.ink}" stroke-width=".8" opacity="${k === 1 ? 0.35 : 0.16}"/>`)
    .join('');
  const spokes = axes.map((_, i) => `<line x1="${cx}" y1="${cy}" x2="${pt(i, 1)[0].toFixed(1)}" y2="${pt(i, 1)[1].toFixed(1)}" stroke="${INK.ink}" stroke-width=".8" opacity=".2"/>`).join('');
  const poly = axes.map((a, i) => pt(i, norm(a[1])).map((n) => n.toFixed(1)).join(',')).join(' ');
  const knots = axes.map((a, i) => { const [x, y] = pt(i, norm(a[1])); return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4" fill="${INK.red}" stroke="${INK.paper}" stroke-width="1.4"><title>${a[0]}: ${a[1]}</title></circle>`; }).join('');
  const labels = axes.map((a, i) => {
    const [x, y] = pt(i, 1.24);
    const anchor = x > cx + 6 ? 'start' : x < cx - 6 ? 'end' : 'middle';
    return `<text x="${x.toFixed(1)}" y="${(y + 3).toFixed(1)}" text-anchor="${anchor}" font-size="10.5" fill="${INK.ink}" font-family="${MONO}">${a[0]}</text>
    <text x="${x.toFixed(1)}" y="${(y + 15).toFixed(1)}" text-anchor="${anchor}" font-size="11" fill="${INK.red}" font-family="${MONO}">${a[1].toLocaleString('en')}</text>`;
  }).join('');
  await writeFile(path.join(OUT, 'radar.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="what the work is made of">
${paperDefs}
  <rect width="${W}" height="${H}" fill="${INK.paper}"/><rect width="${W}" height="${H}" fill="url(#g)"/>
  <text x="14" y="22" font-size="13" fill="${INK.ink}" font-family="${MONO}">what the work is made of</text>
  <line x1="14" y1="28" x2="${W - 14}" y2="28" stroke="${INK.ink}" stroke-width="1" opacity=".25"/>
  ${rings}${spokes}
  <polygon points="${poly}" fill="${INK.teal}" fill-opacity=".3" stroke="${INK.teal}" stroke-width="2">
    <animateTransform attributeName="transform" type="scale" additive="sum" values="1;1.03;1" dur="4s" repeatCount="indefinite"/>
    <animate attributeName="fill-opacity" values=".3;.42;.3" dur="4s" repeatCount="indefinite"/>
  </polygon>
  <g transform="translate(${cx} ${cy})"><line x1="0" y1="0" x2="${rad}" y2="0" stroke="${INK.amber}" stroke-width="1.6" opacity=".55">
    <animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="9s" repeatCount="indefinite"/></line></g>
  ${knots}${labels}
  <text x="14" y="${H - 12}" font-size="9.5" fill="${INK.soft}" font-family="${MONO}">since ${FIRST_YEAR} · log scale, or commits would eat the chart</text>
</svg>`);
}

/* ---------------------------------------------------------- the languages */
{
  const W = 430, H = 52 + langs.length * 21 + 54;
  const inks = [INK.ink, INK.teal, INK.red, INK.amber, INK.soft, INK.paper2, INK.teal, INK.red];
  let x = 14, bar = '';
  langs.forEach(([, v], i) => {
    const w = ((W - 28) * v) / langTotal;
    bar += `<rect x="${x.toFixed(1)}" y="36" width="${Math.max(2, w - 1.5).toFixed(1)}" height="14" rx="2" fill="${inks[i]}" stroke="${INK.ink}" stroke-width=".8"/>`;
    x += w;
  });
  const rows = langs.map(([name, v], i) => {
    const pct = ((v / langTotal) * 100).toFixed(1);
    const y = 72 + i * 21;
    return `<rect x="14" y="${y - 9}" width="11" height="11" rx="2" fill="${inks[i]}" stroke="${INK.ink}" stroke-width=".8"/>
    <text x="33" y="${y}" font-size="12" fill="${INK.ink}" font-family="${MONO}">${esc(name)}</text>
    <text x="${W - 14}" y="${y}" text-anchor="end" font-size="12" fill="${INK.soft}" font-family="${MONO}">${pct}%</text>`;
  }).join('');
  await writeFile(path.join(OUT, 'languages.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="most used languages">
${paperDefs}
  <rect width="${W}" height="${H}" fill="${INK.paper}"/><rect width="${W}" height="${H}" fill="url(#g)"/>
  <text x="14" y="22" font-size="13" fill="${INK.ink}" font-family="${MONO}">what I actually write</text>
  <text x="${W - 14}" y="22" text-anchor="end" font-size="9.5" fill="${INK.soft}" font-family="${MONO}">${counted} repos, averaged</text>
  <line x1="14" y1="28" x2="${W - 14}" y2="28" stroke="${INK.ink}" stroke-width="1" opacity=".25"/>
  ${bar}${rows}
  <text x="14" y="${H - 27}" font-size="9.5" fill="${INK.ink}" font-family="${MONO}">also: ${esc(alsoWrites.slice(0, 5).join(' · '))}</text>
  <text x="14" y="${H - 13}" font-size="9.5" fill="${INK.soft}" font-family="${MONO}">my repos + the ones I contribute to · Java and C++ live at work and in Brian2's codegen</text>
</svg>`);
}

/* ------------------------------------------------------------- the manga */
{
  const src = await readFile(path.join(ROOT, 'assets/manga-source.svg'), 'utf8').catch(() => null);
  const d = src && src.match(/<path[^>]*fill="rgb\(1\.7[^"]*"[^>]*\bd="([^"]+)"/)?.[1];
  if (d) {
    const W = 430, H = 206;
    await writeFile(path.join(OUT, 'manga.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="a manga lover, running">
${paperDefs}
  <rect width="${W}" height="${H}" fill="${INK.paper}"/><rect width="${W}" height="${H}" fill="url(#g)"/>
  <text x="14" y="22" font-size="13" fill="${INK.ink}" font-family="${MONO}">off the clock</text>
  <line x1="14" y1="28" x2="${W - 14}" y2="28" stroke="${INK.ink}" stroke-width="1" opacity=".25"/>
  <circle cx="300" cy="112" r="66" fill="${INK.amber}" opacity=".9"/>
  <circle cx="300" cy="112" r="66" fill="none" stroke="${INK.ink}" stroke-width="1.4" opacity=".5"/>
  <g stroke="${INK.red}" stroke-width="2.6" stroke-linecap="round" opacity=".8">
    <line x1="150" y1="70" x2="215" y2="70"><animate attributeName="x1" values="150;120;150" dur="1.1s" repeatCount="indefinite"/><animate attributeName="opacity" values=".1;.9;.1" dur="1.1s" repeatCount="indefinite"/></line>
    <line x1="140" y1="112" x2="222" y2="112"><animate attributeName="x1" values="140;104;140" dur=".85s" repeatCount="indefinite"/><animate attributeName="opacity" values=".15;1;.15" dur=".85s" repeatCount="indefinite"/></line>
    <line x1="158" y1="152" x2="220" y2="152"><animate attributeName="x1" values="158;128;158" dur="1.3s" repeatCount="indefinite"/><animate attributeName="opacity" values=".1;.8;.1" dur="1.3s" repeatCount="indefinite"/></line>
  </g>
  <g transform="translate(300 112)">
    <animateTransform attributeName="transform" type="translate" values="300 112; 300 104; 300 112" dur="1.05s" repeatCount="indefinite" additive="replace"/>
    <g transform="scale(0.031) translate(-2000 -2000)">
      <path d="${d}" fill="${INK.ink}"/>
    </g>
  </g>
  <text x="14" y="104" font-size="12" fill="${INK.ink}" font-family="${MONO}">a manga lover</text>
  <text x="14" y="122" font-size="10.5" fill="${INK.soft}" font-family="${MONO}">longer than I have</text>
  <text x="14" y="137" font-size="10.5" fill="${INK.soft}" font-family="${MONO}">been writing code</text>
  <text x="14" y="${H - 14}" font-size="9.5" fill="${INK.red}" font-family="${MONO}">→ so PanelSummary turns PDFs into it</text>
</svg>`);
  } else console.warn('chart: no manga-source.svg, skipping manga.svg');
}

/* GitHub's image proxy caches README images hard, so stamp the URLs with today's date
   — a new URL is a new cache entry, and the profile updates the day the numbers do. */
{
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const readme = path.join(ROOT, 'README.md');
  const before = await readFile(readme, 'utf8');
  const after = before.replace(/\.\/assets\/(contributions|registers|radar|languages|manga)\.svg(\?v=\d+)?/g, `./assets/$1.svg?v=${stamp}`);
  if (after !== before) { await writeFile(readme, after); console.log(`chart: stamped README image urls v=${stamp}`); }
}

console.log(`chart: ${allTime} contributions since ${FIRST_YEAR} · ${langs.length} languages · streak ${best}d → assets/`);
console.log('chart: ' + langs.map(([n, v]) => `${n} ${((v / langTotal) * 100).toFixed(1)}%`).join(' · '));
