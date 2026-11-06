import { buildTree, proofFor, verifyProof } from './merkle.js';

const RPC = 'https://api.devnet.solana.com';
const $app = document.getElementById('app');
const state = { rules: '2026', agent: false, day: '2026-06-21', slot: 48, member: 'alt-01', playing: null, live: null };
const cache = new Map();
const getJSON = async (u) => cache.get(u) ?? cache.set(u, await (await fetch(u)).json()).get(u);
const world = await getJSON('data/world.json');
const month = await getJSON('data/month.json');
const dayData = (d = state.day, r = state.rules, a = state.agent) => (state.live
  ? getJSON(`api/live?which=${state.live}&rules=${r}&agent=${a ? 1 : 0}`)
  : getJSON(`data/days/${d}-${r}${a ? '-agent' : ''}.json`));

// ---------- formatting ----------
const kwh = (wh) => (wh / 1000).toLocaleString('en', { maximumFractionDigits: wh < 10000 ? 1 : 0 });
const eur = (micro) => '€' + (micro / 1e6).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ct = (microPerWh) => (microPerWh / 10).toFixed(1) + ' ct';
const tz = { timeZone: 'Europe/Berlin' };
const hhmm = (ms) => new Date(ms).toLocaleTimeString('en-GB', { ...tz, hour: '2-digit', minute: '2-digit' });
const dname = (d) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const memberName = (id) => world.members.find((m) => m.id === id)?.name ?? (id.startsWith('pool:') ? 'Pool · ' + (world.communities[id.slice(5)]?.name ?? id) : id);
const cname = (c) => world.communities[c]?.name ?? c;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const kpi = (v, l, cls = '') => `<div class="card kpi ${cls}"><div class="v">${v}</div><div class="l">${l}</div></div>`;
const explorer = (sig) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;

// Keep CSS animations continuous across re-renders (the day player re-renders every 180 ms).
const phase = (period = 1) => `-${((performance.now() / 1000) % period).toFixed(3)}s`;
// Count numbers up from 0 once when a page opens.
function countUp(root = $app) {
  for (const el of root.querySelectorAll('.kpi .v, [data-count]')) {
    if (el.children.length) continue;
    const text = el.textContent;
    const nums = [...text.matchAll(/\d[\d,]*(\.\d+)?/g)];
    if (!nums.length) continue;
    const t0 = performance.now(), T = 900;
    const step = (now) => {
      const f = Math.min(1, (now - t0) / T), e = 1 - (1 - f) ** 3;
      let i = 0;
      el.textContent = text.replace(/\d[\d,]*(\.\d+)?/g, (m) => {
        const dec = (m.split('.')[1] ?? '').length, v = Number(m.replace(/,/g, '')) * e;
        i++; return v.toLocaleString('en', { minimumFractionDigits: dec, maximumFractionDigits: dec, useGrouping: m.includes(',') });
      });
      if (f < 1) requestAnimationFrame(step); else el.textContent = text;
    };
    requestAnimationFrame(step);
  }
}

// ---------- small SVG chart ----------
function chart(series, { h = 220, cursor = null, right = null, onPick } = {}) {
  const W = 960, H = h, pl = 44, pr = right ? 50 : 10, pt = 10, pb = 22;
  const n = series[0].data.length;
  const max = Math.max(1, ...series.flatMap((s) => (s.stackOn ? s.data.map((v, i) => v + s.stackOn[i]) : s.data)));
  const x = (i) => pl + (i / (n - 1)) * (W - pl - pr);
  const y = (v) => pt + (1 - v / max) * (H - pt - pb);
  let out = `<svg viewBox="0 0 ${W} ${H}" role="img">`;
  for (let k = 0; k <= 4; k++) {
    const v = (max * k) / 4;
    out += `<line x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/><text x="${pl - 6}" y="${y(v) + 4}" text-anchor="end">${kwh(v * 4)}</text>`;
  }
  out += `<text x="${pl - 6}" y="${H - 4}" text-anchor="end">kW</text>`;
  for (let hr = 0; hr <= 24; hr += 3) out += `<text x="${x(Math.min(hr * 4, n - 1))}" y="${H - 6}" text-anchor="middle">${String(hr).padStart(2, '0')}</text>`;
  for (const s of series) {
    const base = s.stackOn ?? Array(n).fill(0);
    const pts = s.data.map((v, i) => `${x(i)},${y(v + base[i])}`);
    if (s.area) {
      const bot = base.map((v, i) => `${x(i)},${y(v)}`).reverse();
      out += `<polygon points="${pts.join(' ')} ${bot.join(' ')}" fill="${s.color}" fill-opacity="${s.opacity ?? 0.35}"/>`;
    } else out += `<polyline points="${pts.join(' ')}" fill="none" stroke="${s.color}" stroke-width="${s.width ?? 2}" ${s.dash ? 'stroke-dasharray="5 4"' : ''}/>`;
  }
  if (right) {
    const rmin = Math.min(0, ...right.data), rmax = Math.max(...right.data);
    const ry = (v) => pt + (1 - (v - rmin) / (rmax - rmin || 1)) * (H - pt - pb);
    out += `<polyline points="${right.data.map((v, i) => `${x(i)},${ry(v)}`).join(' ')}" fill="none" stroke="${right.color}" stroke-width="1.5"/>`;
    for (const v of [rmin, 0, rmax]) out += `<text x="${W - pr + 6}" y="${ry(v) + 4}">${Math.round(v)}</text>`;
    out += `<text x="${W - pr + 6}" y="${H - 4}">${right.unit}</text>`;
  }
  if (cursor !== null) out += `<line x1="${x(cursor)}" x2="${x(cursor)}" y1="${pt}" y2="${H - pb}" stroke="var(--ink)" stroke-width="1.5"/>`;
  if (onPick) out += `<rect class="pick" x="${pl}" y="0" width="${W - pl - pr}" height="${H}" fill="transparent" style="cursor:crosshair"/>`;
  out += '</svg>';
  return out;
}
function bindPick(el, n, cb) {
  const r = el.querySelector('rect.pick');
  if (!r) return;
  r.addEventListener('click', (e) => {
    const b = r.getBoundingClientRect();
    cb(Math.max(0, Math.min(n - 1, Math.round(((e.clientX - b.left) / b.width) * (n - 1)))));
  });
}
const legend = (items) => `<div class="legend">${items.map(([c, l]) => `<span><i style="background:${c}"></i>${l}</span>`).join('')}</div>`;

// ---------- flow map ----------
function flowMap(slot) {
  const cs = world.communities;
  const W = 520, H = 330;
  const lats = Object.values(cs).map((c) => c.lat), lons = Object.values(cs).map((c) => c.lon);
  const [la0, la1, lo0, lo1] = [Math.min(...lats), Math.max(...lats), Math.min(...lons), Math.max(...lons)];
  const P = Object.fromEntries(Object.entries(cs).map(([k, c]) => [k, { x: 90 + ((c.lon - lo0) / (lo1 - lo0)) * (W - 180), y: 60 + (1 - (c.lat - la0) / (la1 - la0)) * (H - 140) }]));
  const zoneName = (z) => world.zones[z].name.replace(/ \(.*/, '');
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Energy flows between communities">`;
  s += `<defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="12" markerHeight="12" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="var(--cross)"/></marker>
        <marker id="ab" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="12" markerHeight="12" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="var(--block)"/></marker></defs>`;
  // zone boundary: a dashed line between zone A and B communities
  const ys = (z) => Object.entries(cs).filter(([, c]) => c.zone === z).map(([k]) => P[k].y);
  const zy = (Math.max(...ys('B')) + Math.min(...ys('A'))) / 2;
  s += `<line x1="0" y1="${zy}" x2="${W}" y2="${zy}" stroke="var(--muted)" stroke-dasharray="3 5"/>`;
  s += `<text x="${W - 6}" y="${zy - 6}" text-anchor="end">${zoneName('B')} ↑</text><text x="${W - 6}" y="${zy + 14}" text-anchor="end">${zoneName('A')} ↓</text>`;
  const arrow = (a, b, wh, color, marker, label) => {
    const w = Math.max(2, Math.min(9, Math.sqrt(wh) / 3));
    const dx = P[b].x - P[a].x, dy = P[b].y - P[a].y, L = Math.hypot(dx, dy), ox = (-dy / L) * 8, oy = (dx / L) * 8;
    const x1 = P[a].x + (dx / L) * 34 + ox, y1 = P[a].y + (dy / L) * 34 + oy, x2 = P[b].x - (dx / L) * 38 + ox, y2 = P[b].y - (dy / L) * 38 + oy;
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${w}" ${marker === 'ab' ? 'stroke-dasharray="6 5"' : ''} marker-end="url(#${marker})"/>
      ${marker === 'ah' ? `<line class="flowdash" style="animation-delay:${phase()}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#fff" stroke-opacity=".8" stroke-width="${Math.max(1.5, w / 2.5)}" stroke-dasharray="2 9" stroke-linecap="round"/>` : ''}
      <text x="${(x1 + x2) / 2 + ox * 3.5}" y="${(y1 + y2) / 2 + oy * 3.5 + 4}" text-anchor="middle" style="fill:${color};font-weight:600">${label}</text>`;
  };
  for (const [k, wh] of Object.entries(slot.flows)) { const [a, b] = k.split('>'); s += arrow(a, b, wh, 'var(--cross)', 'ah', `${kwh(wh * 4)} kW`); }
  for (const [k, wh] of Object.entries(slot.blockedFlows)) { const [a, b] = k.split('>'); s += arrow(a, b, wh, 'var(--block)', 'ab', `blocked ${kwh(wh * 4)} kW`); }
  for (const [k, p] of Object.entries(P)) {
    const inside = slot.intra[k] ?? 0;
    if (inside) s += `<circle class="pulse" style="animation-delay:${phase(1.6)}" cx="${p.x}" cy="${p.y}" r="30" fill="none" stroke="var(--share)" stroke-width="2"/>`;
    s += `<circle cx="${p.x}" cy="${p.y}" r="30" fill="var(--card)" stroke="${inside ? 'var(--share)' : 'var(--line)'}" stroke-width="${inside ? 3 : 1.5}"/>
      <text x="${p.x}" y="${p.y - 2}" text-anchor="middle" style="fill:var(--ink);font-weight:700">${esc(cs[k].name.split(' ')[0])}</text>
      <text x="${p.x}" y="${p.y + 13}" text-anchor="middle" style="fill:var(--share)">${inside ? kwh(inside * 4) + ' kW' : ''}</text>`;
  }
  s += `<text x="10" y="${H - 10}">Grid: import ${kwh(slot.imp * 4)} kW · export ${kwh(slot.exp * 4)} kW</text></svg>`;
  return s;
}

// ---------- views ----------
async function viewMonth() {
  const r = state.rules;
  const tot = (f) => month.reduce((a, d) => a + f(d[r]), 0);
  const other = r === '2026' ? '2028' : '2026';
  const shared = tot((x) => x.sharedWh), cross = tot((x) => x.crossWh), blocked = tot((x) => x.blockedWh);
  const sharedOther = month.reduce((a, d) => a + d[other].sharedWh, 0);
  const maxShared = Math.max(...month.map((d) => d[r].sharedWh + d[r].blockedWh));
  $app.innerHTML = `
    <h1>June 2026, replayed on real data</h1>
    <p class="sub">${month.length} days · 15-minute matching · hourly settlement. Rules: <b>${r === '2026' ? 'energy sharing law as it applies today (§42c EnWG: one grid zone)' : 'from 2028-06-01 (§42c EnWG: adjacent grid zone allowed)'}</b>.</p>
    <div class="grid kpis">
      ${kpi(kwh(shared) + ' kWh', 'shared between neighbours', 'good')}
      ${kpi(kwh(cross) + ' kWh', 'shared between communities', 'blue')}
      ${kpi(kwh(blocked) + ' kWh', 'blocked by the grid-zone rule', blocked ? 'bad' : '')}
      ${kpi(eur(tot((x) => x.localMicro)), 'paid to local producers')}
      ${kpi((r === '2026' ? '+' : '') + kwh(sharedOther - shared) + ' kWh', r === '2026' ? 'extra sharing once 2028 rules apply' : 'vs. today\'s rules', 'blue')}
    </div>
    <div class="card"><h2>Pick a day</h2>
      <div class="cal">${month.map((d) => `<a href="#/day/${d.day}" title="${d.negSlots} negative-price quarter-hours">
        <div class="d">${d.day.slice(8)}</div><div>${kwh(d[r].sharedWh)} kWh</div>
        <div class="bar"><span style="width:${(100 * d[r].sharedWh) / maxShared}%;background:var(--share)"></span><span style="width:${(100 * d[r].blockedWh) / maxShared}%;background:var(--block)"></span></div>
        <div style="color:var(--muted)">☀ ${d.ghiKwhM2}${d.negSlots ? ' · <span style="color:var(--price)">−€ ' + d.negSlots + '</span>' : ''}</div></a>`).join('')}</div>
      ${legend([['var(--share)', 'shared'], ['var(--block)', 'blocked by rule'], ['var(--price)', '−€ n = quarter-hours with negative wholesale price']])}
    </div>
    ${(() => {
      const b = world.flexBacktest?.[r];
      if (!b) return '';
      const rows = [['No shifting', b.none], ['Simple rule (11:00–15:00)', b.rule], ['Flex agent', b.agent]];
      const max = Math.max(...rows.map(([, v]) => v.micro));
      return `<div class="card" style="margin-top:14px"><h2>Flex agent, backtested on all ${month.length} days</h2>
        <p class="sub" style="margin:0 0 10px">${Object.keys(world.flex).map(memberName).join(', ')} may move 30% of their load within 06:00–22:00. The agent uses the day-ahead price and the solar forecast, and only counts spare solar it may legally receive. Forecast error is not modelled (same series as forecast and actual).</p>
        <table><tr><th>Strategy</th><th class="num">Energy cost (June)</th><th class="num">From grid</th><th class="num">From neighbours</th><th style="width:35%"></th></tr>
        ${rows.map(([l, v]) => `<tr><td>${l}</td><td class="num">${eur(v.micro)}</td><td class="num">${kwh(v.gridWh)} kWh</td><td class="num">${kwh(v.localWh)} kWh</td><td><div class="bar" style="height:10px"><span style="width:${(100 * v.micro) / max}%;background:${l === 'Flex agent' ? 'var(--share)' : 'var(--grid)'}"></span></div></td></tr>`).join('')}
        </table><p class="sub" style="margin:10px 0 0"><b>Agent vs no shifting: −${eur(b.none.micro - b.agent.micro)} (${((100 * (b.none.micro - b.agent.micro)) / b.none.micro).toFixed(1)}%)</b> · vs simple rule: −${eur(b.rule.micro - b.agent.micro)}. Turn the agent on (top right) to see where it moves load.</p></div>`;
    })()}`;
  countUp();
}

async function viewDay() {
  let D;
  try { D = await dayData(); } catch (e) { $app.innerHTML = `<p class="reason">Live data unavailable (${esc(e.message)}). Live mode needs the server (npm run serve).</p>`; return; }
  const n = D.slots.length;
  if (state.live && state.jumpToNow) {
    state.jumpToNow = false;
    const now = Date.now();
    const k = D.slots.findIndex((x) => x.t <= now && now < x.t + 900e3);
    state.slot = k >= 0 ? k : 48;
  }
  state.slot = Math.min(state.slot, n - 1);
  const s = D.slots[state.slot];
  const settled = await getJSON('data/chain/index.json');
  const k = D.kpi;
  const idx = month.findIndex((m) => m.day === state.day);
  let moved = 0;
  if (state.agent) {
    const B = await dayData(state.day, state.rules, false);
    for (const id of Object.keys(world.flex)) D.members[id].load.forEach((w, i) => { moved += Math.max(0, w - B.members[id].load[i]); });
  }
  $app.innerHTML = `
    <h1>${state.live ? `Live · ${state.live === 'today' ? 'today' : 'tomorrow'}, ${dname(D.day)}` : `${dname(state.day)} 2026`}</h1>
    <p class="sub">${state.live
      ? `Real day-ahead prices already published for ${D.day} (SMARD) and the current solar forecast (Open-Meteo), fetched ${new Date(D.live.fetchedAt).toLocaleTimeString('en-GB', { ...tz, hour: '2-digit', minute: '2-digit' })}. ${state.live === 'tomorrow' ? 'This is a real plan made in advance: turn on the flex agent to see where it would move load tomorrow.' : 'The cursor starts at the current quarter-hour.'} Fictional members.`
      : 'Real wholesale price and sunshine for this day; fictional members. Click the chart or press play.'}</p>
    <div class="controls card">
      ${state.live
        ? `<a class="btn" style="text-decoration:none;padding:7px 12px" href="#/live/today">${state.live === 'today' ? '● ' : ''}Today</a><a class="btn" style="text-decoration:none;padding:7px 12px" href="#/live/tomorrow">${state.live === 'tomorrow' ? '● ' : ''}Tomorrow</a>`
        : `<label>Day</label><input id="dayr" type="range" min="0" max="${month.length - 1}" value="${idx}"/><b>${state.day}</b>`}
      <button class="btn" id="play">${state.playing ? '❚❚ Pause' : '▶ Play day'}</button>
      <label>Time</label><input id="slotr" type="range" min="0" max="${n - 1}" value="${state.slot}"/>
      <b>${hhmm(s.t)}</b>
    </div>
    <div class="grid kpis">
      ${kpi(kwh(k.sharedWh) + ' kWh', 'shared locally', 'good')}
      ${kpi(kwh(k.crossWh) + ' kWh', 'between communities', 'blue')}
      ${kpi(kwh(k.blockedWh) + ' kWh', 'blocked by grid-zone rule', k.blockedWh ? 'bad' : '')}
      ${kpi(k.grossPayments + ' → ' + k.transfers, `payments → transfers after netting (${k.hours} hourly batches)`)}
      ${kpi(eur(k.localMicro), 'paid to local producers')}
      ${state.agent ? kpi(kwh(moved) + ' kWh', 'load moved by the flex agent', 'good') : ''}
    </div>
    <div class="grid two">
      <div class="card"><h2>${hhmm(s.t)} — who supplies whom</h2>${flowMap(s)}
        <div class="legend"><span>wholesale <b>${s.price.toFixed(1)} €/MWh</b></span><span>local price <b>${ct(s.local)}/kWh</b></span>
        <span>sun ${kwh(s.gen * 4)} kW · demand ${kwh(s.load * 4)} kW</span></div>
        ${k.memberRejections.map(([id, why]) => `<p class="reason">✕ ${esc(memberName(id))}: ${esc(why)}</p>`).join('')}
        ${s.blocked ? `<p class="reason">✕ ${kwh(s.blocked * 4)} kW could flow between grid zones but ${state.rules === '2026' ? '§42c EnWG allows this only from 2028-06-01' : 'is not allowed'}.</p>` : ''}
      </div>
      <div class="card"><h2>Whole day (kW)</h2><div id="ch">${chart([
        { data: D.slots.map((x) => x.gen), color: 'var(--sun)', area: true, opacity: 0.25 },
        { data: D.slots.map((x) => x.load), color: 'var(--ink)', width: 1.5 },
        { data: D.slots.map((x) => x.shared - x.cross), color: 'var(--share)', area: true, opacity: 0.6 },
        { data: D.slots.map((x) => x.cross), color: 'var(--cross)', area: true, opacity: 0.7, stackOn: D.slots.map((x) => x.shared - x.cross) },
        { data: D.slots.map((x) => x.blocked), color: 'var(--block)', area: true, opacity: 0.5, stackOn: D.slots.map((x) => x.shared) },
      ], { cursor: state.slot, right: { data: D.slots.map((x) => x.price), color: 'var(--price)', unit: '€/MWh' }, onPick: true })}</div>
      ${legend([['var(--sun)', 'solar'], ['var(--ink)', 'demand'], ['var(--share)', 'shared in community'], ['var(--cross)', 'between communities'], ['var(--block)', 'blocked by rule'], ['var(--price)', 'wholesale price']])}
      </div>
    </div>
    <div class="card" style="margin-top:14px"><h2>Hourly settlement</h2><div class="tablewrap"><table>
      <tr><th>Hour</th><th class="num">15-min payments</th><th class="num">Transfers</th><th class="num">Volume</th><th>Merkle root</th><th>Solana devnet</th></tr>
      ${D.hours.map((h) => {
        const onchain = !state.agent && !state.live && settled.find((c) => c.day === state.day && c.hourStartMs === h.hourStartMs && c.rules === (state.rules === '2028' ? '2028-06-01' : 'slot date'));
        const vol = h.transfers.filter((t) => t.from.startsWith('pool:') === false).reduce((a, t) => a + t.amountMicro, 0);
        return `<tr><td>${hhmm(h.hourStartMs)}</td><td class="num">${h.gross.payments}</td><td class="num">${h.transfers.length}</td><td class="num">${eur(vol)}</td>
          <td class="mono">${h.root.slice(0, 16)}…</td><td>${onchain ? `<a href="#/verify/${onchain.file}" class="ok">✓ settled · verify</a>` : `<span class="wait">${state.live ? 'planned' : 'simulated'}</span>`}</td></tr>`;
      }).join('')}
    </table></div></div>`;
  document.getElementById('slotr').oninput = (e) => { state.slot = +e.target.value; render(); };
  const dayr = document.getElementById('dayr');
  if (dayr) dayr.onchange = (e) => { location.hash = `#/day/${month[+e.target.value].day}`; };
  document.getElementById('play').onclick = () => {
    if (state.playing) { clearInterval(state.playing); state.playing = null; render(); return; }
    if (state.slot >= n - 1) state.slot = 0;
    state.playing = setInterval(() => { state.slot++; if (state.slot >= n - 1) { clearInterval(state.playing); state.playing = null; } render(); }, 180);
    render();
  };
  bindPick(document.getElementById('ch'), n, (i) => { state.slot = i; render(); });
  const key = `${location.hash}|${state.rules}|${state.agent}`;
  if (state.counted !== key) { state.counted = key; countUp(); }
  if (state.autoplay) { state.autoplay = false; if (!state.playing) { state.slot = 20; document.getElementById('play').click(); } }
}

async function viewMember() {
  const D = await dayData();
  const id = state.member;
  const M = D.members[id];
  const mem = world.members.find((m) => m.id === id);
  const lines = D.hours.map((h) => ({ h, line: h.lines.find((l) => l.id === id) })).filter((x) => x.line);
  const net = lines.reduce((a, x) => a + x.line.netMicro, 0);
  const sum = (a) => a.reduce((s, v) => s + v, 0);
  const dev = world.devnet?.members[id];
  $app.innerHTML = `
    <div class="controls card">
      <label>Member</label><select id="msel">${world.members.map((m) => `<option value="${m.id}" ${m.id === id ? 'selected' : ''}>${esc(m.name)} — ${esc(cname(m.community))}</option>`).join('')}</select>
      <label>Day</label><select id="dsel">${month.map((d) => `<option ${d.day === state.day ? 'selected' : ''}>${d.day}</option>`).join('')}</select>
    </div>
    <h1>${esc(mem.name)}</h1>
    <p class="sub">${esc(cname(mem.community))} · ${mem.kind}${mem.pvKwp ? ` · ${mem.pvKwp} kWp solar` : ' · no solar'} · ${dname(state.day)}</p>
    <div class="grid kpis">
      ${kpi(kwh(sum(M.sell)) + ' kWh', 'sold to neighbours', 'good')}
      ${kpi(kwh(sum(M.buy)) + ' kWh', 'bought from neighbours', 'blue')}
      ${kpi(kwh(sum(M.imp)) + ' kWh', 'from the grid')}
      ${kpi((net >= 0 ? '+' : '') + eur(net), net >= 0 ? 'earned today' : 'paid today', net >= 0 ? 'good' : '')}
      ${kpi('<span id="lim">…</span>', 'spending limit left (on-chain)')}
    </div>
    <div class="grid two">
      <div class="card"><h2>My day (kW)</h2>${chart([
        { data: M.gen, color: 'var(--sun)', area: true, opacity: 0.25 },
        { data: M.load, color: 'var(--ink)', width: 1.5 },
        { data: M.sell, color: 'var(--share)', area: true, opacity: 0.6 },
        { data: M.buy, color: 'var(--cross)', area: true, opacity: 0.6 },
      ], { h: 200 })}${legend([['var(--sun)', 'my solar'], ['var(--ink)', 'my use'], ['var(--share)', 'sold'], ['var(--cross)', 'bought']])}</div>
      <div class="card"><h2>My hourly statement</h2><p class="sub" style="margin:0 0 8px">Check any line yourself: your browser rebuilds the proof and compares it with that hour's root. You never see other members' lines.</p>
        <div class="tablewrap"><table><tr><th>Hour</th><th class="num">Bought</th><th class="num">Sold</th><th class="num">Net</th><th>Proof</th></tr>
        ${lines.map((x, k) => `<tr><td>${hhmm(x.h.hourStartMs)}</td><td class="num">${kwh(x.line.whBought)}</td><td class="num">${kwh(x.line.whSold)}</td><td class="num">${eur(x.line.netMicro)}</td><td><button class="btn" data-k="${k}">check</button> <span id="p${k}"></span></td></tr>`).join('')}
        </table></div></div>
    </div>
    <div class="card" style="margin-top:14px"><h2>Ask your energy agent</h2>
      <p class="sub" style="margin:0 0 8px">Write what you want in your own words, e.g. a minimum price for selling, when flexible equipment may run, or a new monthly spending limit. The agent (Claude) only proposes and simulates on ${state.day}; nothing changes until you approve.</p>
      <div class="controls" style="margin:0"><input id="ask" style="flex:1;min-width:220px;font:inherit;padding:8px 10px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--ink)" maxlength="500" placeholder="Type a request…"/><button class="btn" id="askBtn">Ask</button></div>
      <div id="agentOut"></div>
    </div>
    ${mem.kind === 'large' ? '<p class="reason">✕ Not eligible: §42c EnWG energy sharing is open to households, public bodies and micro/small/medium enterprises only. This member buys from the grid.</p>' : ''}
    ${dev ? `<p class="sub mono">Wallet ${dev.owner} · token account <a href="https://explorer.solana.com/address/${dev.tokenAccount}?cluster=devnet" target="_blank">${dev.tokenAccount.slice(0, 8)}…</a></p>` : ''}`;
  document.getElementById('msel').onchange = (e) => { location.hash = `#/member/${e.target.value}`; };
  document.getElementById('dsel').onchange = (e) => { state.day = e.target.value; render(); };
  $app.querySelectorAll('button[data-k]').forEach((b) => (b.onclick = async () => {
    const { h, line } = lines[+b.dataset.k];
    const tree = await buildTree(h.lines);
    const proof = proofFor(tree, h.lines.indexOf(line));
    const ok = (await verifyProof(line, proof, h.root)) && tree.root === h.root;
    document.getElementById('p' + b.dataset.k).innerHTML = ok ? `<span class="ok">✓ ${proof.length}-step proof</span>` : '<span class="no">✕ mismatch</span>';
  }));
  const out = document.getElementById('agentOut');
  // Demo password for the agent (kept for this browser tab only).
  const demoPw = () => {
    let pw = null;
    try { pw = sessionStorage.getItem('demoPw'); } catch {}
    if (!pw) { pw = prompt('Demo password for the AI agent:') ?? ''; try { sessionStorage.setItem('demoPw', pw); } catch {} }
    return pw;
  };
  const forgetPw = () => { try { sessionStorage.removeItem('demoPw'); } catch {} };
  const ask = async () => {
    const text = document.getElementById('ask').value.trim();
    if (!text) return;
    out.innerHTML = '<p class="wait">Thinking…</p>';
    try {
      const r = await fetch('api/agent', { method: 'POST', headers: { 'content-type': 'application/json', 'x-demo-password': demoPw() }, body: JSON.stringify({ text, memberId: id, day: state.day, rules: state.rules }) });
      const j = await r.json();
      if (!r.ok) { if (r.status === 401) forgetPw(); out.innerHTML = `<p class="reason">${esc(j.error)}</p>`; return; }
      out.innerHTML = `<p style="white-space:pre-wrap">${esc(j.reply)}</p>` + j.proposals.map((p, k) => {
        const e = p.effect;
        const rows = e ? `<table><tr><th></th><th class="num">Sold</th><th class="num">Bought</th><th class="num">Grid in</th><th class="num">Net for the day</th></tr>
          ${[['Now', e.before], ['With this', e.after]].map(([l, v]) => `<tr><td>${l}</td><td class="num">${v.sold_kwh.toFixed(1)} kWh</td><td class="num">${v.bought_kwh.toFixed(1)} kWh</td><td class="num">${v.grid_import_kwh.toFixed(1)} kWh</td><td class="num">€${v.net_eur_for_the_day.toFixed(2)}</td></tr>`).join('')}</table>` : '';
        return `<div class="card" style="margin-top:10px"><b>Proposal:</b> <span class="mono">${esc(JSON.stringify(p.proposal))}</span>${rows}
          <div class="controls" style="margin:8px 0 0"><button class="btn" data-ap="${k}">Approve</button><span id="ap${k}"></span></div></div>`;
      }).join('');
      out.querySelectorAll('button[data-ap]').forEach((b) => (b.onclick = async () => {
        const k = b.dataset.ap;
        b.disabled = true;
        document.getElementById('ap' + k).innerHTML = '<span class="wait">applying…</span>';
        const r2 = await fetch('api/approve', { method: 'POST', headers: { 'content-type': 'application/json', 'x-demo-password': demoPw() }, body: JSON.stringify({ proposal: j.proposals[k].proposal }) });
        const a = await r2.json();
        document.getElementById('ap' + k).innerHTML = r2.ok ? `<span class="ok">✓ applied</span>${a.explorer ? ` · <a href="${a.explorer}" target="_blank">on-chain approval</a>` : ''}` : `<span class="no">${esc(a.error)}</span>`;
      }));
    } catch (e) { out.innerHTML = `<p class="reason">Agent unavailable (${esc(e.message)}). The static demo has no server.</p>`; }
  };
  document.getElementById('askBtn').onclick = ask;
  document.getElementById('ask').onkeydown = (e) => { if (e.key === 'Enter') ask(); };
  if (dev) rpc('getTokenAccountBalance', [dev.tokenAccount]).then(async () => {
    const info = await rpc('getAccountInfo', [dev.tokenAccount, { encoding: 'jsonParsed' }]);
    const t = info.value.data.parsed.info;
    document.getElementById('lim').textContent = t.delegatedAmount ? '€' + t.delegatedAmount.uiAmountString : '€0';
  }).catch(() => { document.getElementById('lim').textContent = 'n/a'; });
}

async function rpc(method, params) {
  for (let i = 0; i < 5; i++) {
    const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    if (r.status === 429) { await new Promise((ok) => setTimeout(ok, 800 * 2 ** i)); continue; }
    const j = await r.json();
    if (j.error) throw new Error(j.error.message);
    return j.result;
  }
  throw new Error('RPC rate-limited, try again');
}

async function viewVerify(file) {
  const list = await getJSON('data/chain/index.json');
  if (!file) {
    $app.innerHTML = `<h1>Verify a settled hour</h1><p class="sub">Anyone can check that the payments on Solana match the published statement, using only public data.</p>
      <div class="card"><table><tr><th>Day</th><th>Hour</th><th>Rules</th><th class="num">Transactions</th><th></th></tr>
      ${list.map((c) => `<tr><td>${c.day}</td><td>${hhmm(c.hourStartMs)}</td><td>${c.rules}</td><td class="num">${c.txs}</td><td><a href="#/verify/${c.file}">verify →</a></td></tr>`).join('')}</table></div>`;
    return;
  }
  const rec = await getJSON(`data/chain/${file}`);
  const row = (id, label) => `<div class="check"><span id="${id}" class="wait">…</span><span>${label}</span></div>`;
  $app.innerHTML = `<h1>Verify ${rec.day} ${hhmm(rec.hourStartMs)}</h1>
    <p class="sub">Your browser does every check below itself: it fetches the transactions from Solana devnet and recomputes the Merkle root.</p>
    <div class="card">
      ${row('c1', `Recompute the Merkle root from ${rec.lines.length} statement lines`)}
      ${row('c2', `Find ${rec.signatures.length} transaction(s) on Solana devnet`)}
      ${row('c3', 'Each transaction memo carries this root')}
      ${row('c4', 'Token movements on-chain equal the netted transfers, to the micro-euro')}
      ${row('c5', 'Change one line by €0.000001 → the root no longer matches')}
    </div>
    ${rec.duplicateSettlement ? `<div class="card" style="margin-top:14px"><h2 class="no">Known issue: duplicate settlement</h2><p class="sub" style="margin:0">${esc(rec.duplicateSettlement.note)}</p>${rec.duplicateSettlement.signatures.map((s) => `<p class="mono"><a href="${explorer(s)}" target="_blank">${s}</a></p>`).join('')}</div>` : ''}
    <div class="card" style="margin-top:14px"><h2>Published memo</h2><p class="mono">${esc(rec.memo)}</p>
      ${rec.signatures.map((s) => `<p class="mono"><a href="${explorer(s)}" target="_blank">${s}</a></p>`).join('')}</div>
    <div class="card" style="margin-top:14px"><h2>Netted transfers (${rec.transfers.length}, instead of ${rec.gross.payments} separate 15-minute payments)</h2><div class="tablewrap"><table>
      <tr><th>From</th><th>To</th><th class="num">Amount</th></tr>
      ${rec.transfers.map((t) => `<tr><td>${esc(memberName(t.from))}</td><td>${esc(memberName(t.to))}</td><td class="num">${eur(t.amountMicro)}</td></tr>`).join('')}</table></div></div>`;
  const set = (id, ok, msg = '') => { document.getElementById(id).outerHTML = `<span class="${ok ? 'ok' : 'no'}">${ok ? '✓' : '✕'}</span>${msg ? ` <span class="sub" style="margin:0">${esc(msg)}</span>` : ''}`; };
  const tree = await buildTree(rec.lines);
  set('c1', tree.root === rec.root, tree.root.slice(0, 20) + '…');
  try {
    const txs = [];
    for (const sig of rec.signatures) txs.push(await rpc('getTransaction', [sig, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }]));
    set('c2', txs.every((t) => t && !t.meta.err), `${txs.filter(Boolean).length} found`);
    const memos = txs.map((t) => t.transaction.message.instructions.find((i) => i.program === 'spl-memo')?.parsed ?? '');
    set('c3', memos.every((m) => m.includes(`root=${tree.root}`)));
    const owner = {};
    for (const [c, p] of Object.entries(world.devnet.pools)) owner[p.tokenAccount] = `pool:${c}`;
    for (const [id, p] of Object.entries(world.devnet.members)) owner[p.tokenAccount] = id;
    const chain = {};
    for (const t of txs) {
      const keys = t.transaction.message.accountKeys.map((k) => k.pubkey);
      const amt = (list, i) => BigInt(list.find((b) => b.accountIndex === i && b.mint === world.devnet.mint)?.uiTokenAmount.amount ?? '0');
      const idx = new Set([...t.meta.preTokenBalances, ...t.meta.postTokenBalances].map((b) => b.accountIndex));
      for (const i of idx) { const id = owner[keys[i]] ?? keys[i]; chain[id] = (chain[id] ?? 0n) + amt(t.meta.postTokenBalances, i) - amt(t.meta.preTokenBalances, i); }
    }
    const ledger = {};
    for (const t of rec.transfers) { ledger[t.from] = (ledger[t.from] ?? 0n) - BigInt(t.amountMicro); ledger[t.to] = (ledger[t.to] ?? 0n) + BigInt(t.amountMicro); }
    const ids = new Set([...Object.keys(chain), ...Object.keys(ledger)]);
    const bad = [...ids].filter((i) => (chain[i] ?? 0n) !== (ledger[i] ?? 0n));
    set('c4', bad.length === 0, bad.length ? `mismatch: ${bad.join(', ')}` : `${ids.size} accounts match`);
  } catch (e) { set('c2', false, e.message); }
  const tampered = rec.lines.map((l, i) => (i === 0 ? { ...l, netMicro: (l.netMicro ?? 0) + 1 } : l));
  set('c5', (await buildTree(tampered)).root !== rec.root);
}

// ---------- story: problem → pitch → solution → what I built → … each with claim, evidence, background ----------
const LAW = 'https://www.gesetze-im-internet.de/enwg_2005/__42c.html';
const BNETZA = 'https://www.bundesnetzagentur.de/DE/Vportal/Energie/Energy_Sharing/start.html';
const SETTLE_TX = [ // measured with getTransaction (devnet), 2026-06-21 13:00 hour
  { sig: '5dr7ZaLupsr7FBqvYFniDyt6fkXJwoPcf1n8J61mPRTaz9Kv963zsxQvUDLv1pWShCkhh7KChungmZsbxU1bqEQU', fee: 5000, sigs: 1 },
  { sig: '23WAfaZuYJZHyGtjLd6b6PDAvnruvDoSaQw9Hk6xK8wKEhZiAC7QyY4jSEwhM8skcJoBNSHTfkzM7Y2K1dYYMP39', fee: 20000, sigs: 4 },
];
async function viewStory() {
  const d21 = await getJSON('data/days/2026-06-21-2026.json');
  const tot = (r, f) => month.reduce((a, d) => a + d[r][f], 0);
  const fb = world.flexBacktest;
  const pct = (r) => ((100 * (fb[r].none.micro - fb[r].agent.micro)) / fb[r].none.micro).toFixed(1);
  const fee = SETTLE_TX.reduce((a, t) => a + t.fee, 0);
  const jonas = world.devnet?.members['alt-02'];
  const ext = (href, t) => `<a href="${href}" target="_blank" rel="noopener">${t} ↗</a>`;
  const inapp = (href, t) => `<a href="${href}">${t} →</a>`;
  const N = (v) => `<b data-count>${v}</b>`;
  const sec = (n, title, claim, evidence, background, extra = '') => `<section class="card story">
    <div class="sn">${n}</div><div><h2>${title}</h2><p class="claim">${claim}</p>${extra}
    <div class="ev"><div class="lab">Evidence</div><ul>${evidence.map((e) => `<li>${e}</li>`).join('')}</ul></div>
    <div class="bg"><div class="lab">Background</div><p>${background}</p></div></div></section>`;
  const steps = [['Real data', 'SMARD prices + Open-Meteo sun, 15 min'], ['Match', 'roof → community → neighbour → grid'], ['§42c rules', 'who, which zone, which date'], ['Net', 'hourly, multilateral'], ['Merkle root', 'one hash per hour'], ['Solana', 'SPL transfers + memo'], ['Verify', 'in any browser']];
  $app.innerHTML = `
    <div class="hero card"><div class="kicker">Germany's new energy-sharing law (§42c EnWG), in force since 1 June 2026</div>
      <h1>SolarP2P is the clearing layer for neighbourhood solar: matched every 15 minutes, settled hourly on Solana, checkable by anyone.</h1>
      <div class="grid kpis" style="margin:14px 0 0">
        ${kpi(d21.kpi.grossPayments + ' → ' + d21.kpi.transfers, 'payments → transfers, one day (21 June)')}
        ${kpi(kwh(tot('2026', 'blockedWh')) + ' kWh', 'blocked by today\'s zone rule (June)', 'bad')}
        ${kpi(kwh(tot('2028', 'sharedWh')) + ' kWh', 'shared under 2028 rules (June)', 'good')}
        ${kpi(fee.toLocaleString('en') + ' lamports', 'Solana fees for one settled hour')}
      </div></div>

    ${sec(1, 'Problem', 'The new law makes sharing solar with neighbours legal, but every sunny day becomes hundreds of tiny payments, and until 2028 sharing stops at grid-zone borders.', [
      `§42c(4) EnWG: sharing <i>"ab dem 1. Juni 2026 innerhalb des Bilanzierungsgebietes eines Elektrizitätsverteilernetzbetreibers"</i>; a directly adjacent area in the same control zone only from 1 June 2028. ${ext(LAW, 'law text')}`,
      `§42c(1) No. 6–7: consumption and generation are metered every quarter-hour (<i>"viertelstündliche registrierende Leistungsmessung"</i>). ${ext(LAW, 'law text')}`,
      `Measured here: one 15-member neighbourhood, 21 June → ${N(d21.kpi.grossPayments)} quarter-hour payments. ${inapp('#/day/2026-06-21', 'Day')}`,
      `Measured here: June 2026 → ${N(kwh(tot('2026', 'blockedWh')))} kWh could have been shared but was blocked by the zone rule. ${inapp('#/month', 'Month')}`,
    ], `Shared energy still pays <i>"die üblichen Zahlungen für Netzentgelte und Umlagen"</i> (${ext(BNETZA, 'Bundesnetzagentur')}), so the saving per kWh is small. Our conclusion (reasoning, not a measurement): settlement must be cheap, automatic and trusted, or the overhead eats the saving.`)}

    ${sec(2, 'One-line pitch', 'SolarP2P is the clearing layer a community or its local utility runs: neighbours\' solar matched every 15 minutes under §42c, settled hourly on Solana, and checkable by anyone.', [
      'Sections 1 and 3 give the reason for each part of this sentence.',
    ], 'Built solo for the MLH Solana Hackathon, AI track.')}

    ${sec(3, 'Solution', 'Match every 15 minutes, settle every hour, prove every payment.', [
      `15 minutes is the law's own metering interval (§42c(1) No. 6–7). ${ext(LAW, 'law text')}`,
      `Hourly multilateral netting: ${N(d21.kpi.grossPayments)} payments → ${N(d21.kpi.transfers)} transfers on 21 June. ${inapp('#/day/2026-06-21', 'Day')}`,
      'Engine tests (9, <span class="mono">node --test</span>): energy balance, settlement reproduces every member\'s position, pools never go negative, blocked energy counted once.',
    ], 'Order of supply: own roof → own community → a neighbouring community only where §42c allows → grid. The local price sits between the feed-in tariff and the grid price minus fees. These tariffs are assumptions and are shown in the banner.')}

    ${sec(4, 'What I built', 'A working clearing system on real German market data, with two AI agents and on-chain settlement.', [
      `Real data: SMARD day-ahead quarter-hour prices (series 4169) and Open-Meteo irradiance for all ${month.length} days of June 2026, plus live today and tomorrow. ${inapp('#/live/tomorrow', 'Live')}`,
      `§42c rule engine: member types and grid zones, switchable between today's rules and the 2028 rules. ${inapp('#/month', 'Month')}`,
      `Settlement on Solana devnet in a test-euro SPL token, with a Merkle root of each hour's statement in the memo. ${inapp('#/verify/2026-06-21-11Z.json', 'Verify')}`,
      `Member agent (Claude): turns "Never sell my solar under 20 cents" into a policy, simulates it on real data, and changes nothing until the member approves. ${inapp('#/member/alt-01', 'Member')}`,
      `Flex agent: moves 30% of the school's, sports hall's and supermarket's load into hours with spare neighbour solar. June backtest: −${N(pct('2026'))}% energy cost under today's rules, −${N(pct('2028'))}% under the 2028 rules, after grid fees. ${inapp('#/month', 'Month')}`,
    ], 'Members and their loads are fictional; prices and sunshine are real. Live mode refreshes from the public APIs every 15 minutes.')}

    ${sec(5, 'How it works', 'Every hour produces a statement that anyone can reproduce and check against the chain.', [
      `The Verify page fetches the hour's transactions from Solana devnet, recomputes the Merkle root from the statement, checks the memo, and matches every token movement to the netted transfers, to the micro-euro. ${inapp('#/verify/2026-06-21-11Z.json', 'Verify 13:00')}`,
      'Tamper test on the same page: change one line by €0.000001 and the root no longer matches.',
      `Each member can check only their own line with a Merkle proof, without seeing other members' lines. ${inapp('#/member/alt-01', 'Member → check')}`,
    ], 'Stack: Node.js engine in integer Wh and micro-euro (largest-remainder rounding, multilateral netting); SHA-256 Merkle tree with separate leaf and node prefixes; @solana/web3.js, SPL Token, SPL Memo; Claude (claude-opus-5-5) with strict tool schemas; static web app, hosted on Render.',
      `<div class="pipe">${steps.map(([t, d], i) => `<div class="step" style="animation-delay:${i * 0.12}s"><b>${t}</b><span>${d}</span></div>`).join('<i class="arr"></i>')}</div>`)}

    ${sec(6, 'Why a blockchain', 'Several parties who do not fully trust one operator need one shared record and spending limits that nobody can override.', [
      `Parties: members, producers, three communities and the operator. Each hour's statement root is public; a member checks their own line without asking anyone. ${inapp('#/member/alt-01', 'Member → check')}`,
      `The payment is the proof: every settlement transaction carries the root in its memo. ${ext(explorer(SETTLE_TX[0].sig), 'transaction')}`,
      `Limits enforced by the chain: each member's token account approves the operator only up to a limit (SPL delegate). Jonas lowered his to €15 through the agent. ${jonas ? ext(`https://explorer.solana.com/address/${jonas.tokenAccount}?cluster=devnet`, 'Jonas\'s token account') : ''}`,
    ], 'Without a shared ledger, members must trust the operator\'s database and statements. Honest scope: matching and netting run off-chain (fast and private); only payments and one hash per hour go on-chain. Meter data never does.')}

    ${sec(7, 'Why Solana', `The law creates many small payments; on Solana one settled hour cost ${fee.toLocaleString('en')} lamports (0.000025 SOL) and needed no custom program.`, [
      ...SETTLE_TX.map((t) => `Settlement transaction: ${t.fee.toLocaleString('en')} lamports (${t.sigs} signature${t.sigs > 1 ? 's' : ''}). ${ext(explorer(t.sig), 'explorer')}`),
      'Built only from existing programs: SPL Token (transferChecked, approveChecked for limits) and SPL Memo. No custom on-chain code to audit.',
      `Verification reads public RPC directly from the browser: no wallet, no account, no server of ours. ${inapp('#/verify/2026-06-21-11Z.json', 'Verify')}`,
    ], 'Fees above were measured on devnet. Mainnet fees depend on priority fees and the SOL price; not measured here.')}

    ${sec(8, 'Results (June 2026 replay)', 'Under the 2028 rules the same neighbourhood shares more than twice as much solar and imports less from the grid.', [
      `All numbers are sums over the 30 replayed days; switch the rules in the header to see each column. ${inapp('#/month', 'Month')}`,
    ], 'Real prices and sunshine; fictional members; tariffs are assumptions (banner). The flex agent uses the same series as forecast and actual, so forecast error is not modelled.', `<table><tr><th></th><th class="num">Today's rules</th><th class="num">2028 rules</th></tr>
        ${[['Shared between neighbours', 'sharedWh'], ['Shared between communities', 'crossWh'], ['Blocked by zone rule', 'blockedWh'], ['Imported from grid', 'importWh']].map(([l, f]) => `<tr><td>${l}</td><td class="num">${kwh(tot('2026', f))} kWh</td><td class="num">${kwh(tot('2028', f))} kWh</td></tr>`).join('')}
        <tr><td>Paid to local producers</td><td class="num">${eur(tot('2026', 'localMicro'))}</td><td class="num">${eur(tot('2028', 'localMicro'))}</td></tr></table>`)}

    ${sec(9, 'Business (hypothesis)', 'Hypothesis: energy communities and the local utilities that run them pay a per-member fee for clearing, proof and agents.', [
      'No customer interviews or pricing tests yet. This section is a hypothesis, not a result.',
      `What the replay does show: ${eur(tot('2026', 'localMicro'))} in June went to local producers under today's rules, ${eur(tot('2028', 'localMicro'))} under the 2028 rules.`,
      `Who may join is set by law: households, public bodies and micro, small and medium enterprises (§42c(1)–(2)). ${ext(LAW, 'law text')}`,
    ], 'The engine is the same for one community or many; the 2028 rule change is what makes cross-community clearing matter.')}

    ${sec(10, 'Honest limits', 'What this demo does not prove.', [
      'Members, loads and tariffs are fictional or assumed.',
      'Devnet only, test-euro token, demo keys held by the server.',
      `Operator error during the build: two hours were settled twice on devnet (identical amounts). Shown openly on the Verify page; a chain-based duplicate check now prevents it. ${inapp('#/verify/2026-06-21-11Z.json', 'Verify')}`,
    ], 'Every number on this page comes from this app\'s data, the law text, or a devnet transaction you can open.')}

    ${sec(11, 'Next', 'From 1 June 2028 the law allows sharing with a directly adjacent grid area, which is where cross-community clearing starts to matter.', [
      `§42c(4) No. 2 EnWG. ${ext(LAW, 'law text')}`,
      'Plans, not done: real smart-meter data, a regulated euro stablecoin instead of the test token, and member-held keys.',
    ], 'The 2028 switch in the header shows that future today.')}`;
  countUp();
}

// ---------- router ----------
async function render() {
  const [, page = '', arg] = location.hash.replace(/^#/, '').split('/');
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('on', a.dataset.nav === (page || 'story')));
  document.querySelectorAll('[data-rules]').forEach((b) => b.classList.toggle('on', b.dataset.rules === state.rules));
  const ab = document.getElementById('agentBtn'); ab.classList.toggle('on', state.agent); ab.textContent = `Flex agent: ${state.agent ? 'on' : 'off'}`;
  if (page === 'day' && arg && arg !== state.day) state.day = arg;
  if (page === 'day' && state.autoKey !== state.day) { state.autoKey = state.day; state.autoplay = true; }
  if (page !== 'day') state.autoKey = null;
  const wasLive = state.live;
  state.live = page === 'live' ? (arg === 'tomorrow' ? 'tomorrow' : 'today') : null;
  if (state.live && state.live !== wasLive) state.jumpToNow = state.live === 'today';
  if (page === 'member' && arg) state.member = arg;
  if (page === 'day' || page === 'live') return viewDay();
  if (page === 'member') return viewMember();
  if (page === 'verify') return viewVerify(arg);
  if (page === 'month') return viewMonth();
  return viewStory();
}
document.querySelectorAll('[data-rules]').forEach((b) => (b.onclick = () => { state.rules = b.dataset.rules; render(); }));
document.getElementById('agentBtn').onclick = () => { state.agent = !state.agent; render(); };
window.addEventListener('hashchange', () => { if (state.playing) { clearInterval(state.playing); state.playing = null; } render(); });
render();
