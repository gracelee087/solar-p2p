// Fetch one real day (Europe/Berlin local day) of public data and cache it in data/.
//  - Day-ahead wholesale price, 15-min, DE-LU: SMARD (Bundesnetzagentur), series 4169, EUR/MWh
//  - Global horizontal irradiance, 15-min: Open-Meteo, W/m2
// Usage: node scripts/fetch-day.js 2026-10-26 [lat] [lon]
import { writeFile, mkdir } from 'node:fs/promises';

const [, , day, lat = '50.00', lon = '8.26'] = process.argv;
if (!/^\d{4}-\d{2}-\d{2}$/.test(day ?? '')) {
  console.error('usage: node scripts/fetch-day.js YYYY-MM-DD [lat] [lon]');
  process.exit(1);
}

// UTC ms of local midnight in Berlin for the given day.
function berlinMidnightUtc(d) {
  const guess = Date.parse(`${d}T00:00:00Z`);
  const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hour: '2-digit', hourCycle: 'h23' });
  const offsetH = Number(fmt.format(new Date(guess))); // Berlin hour at 00:00 UTC = offset
  return guess - offsetH * 3600e3;
}

const start = berlinMidnightUtc(day);
const end = berlinMidnightUtc(new Date(Date.parse(`${day}T12:00:00Z`) + 86400e3).toISOString().slice(0, 10));
const slots = (end - start) / 900e3; // 96 normally, 92/100 on DST days

async function getJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

// SMARD: weekly chunks indexed by start timestamp.
const base = 'https://www.smard.de/app/chart_data/4169/DE';
const { timestamps } = await getJson(`${base}/index_quarterhour.json`);
const chunkStarts = timestamps.filter((t) => t <= end).slice(-2); // day may span two chunks
const prices = new Map();
for (const t of chunkStarts) {
  const { series } = await getJson(`${base}/4169_DE_quarterhour_${t}.json`);
  for (const [ts, v] of series) if (v !== null) prices.set(ts, v);
}

// Open-Meteo: UTC times, fetch the surrounding UTC dates.
const d0 = new Date(start).toISOString().slice(0, 10);
const d1 = new Date(end).toISOString().slice(0, 10);
const om = await getJson(
  `https://historical-forecast-api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&minutely_15=shortwave_radiation&timezone=UTC&start_date=${d0}&end_date=${d1}`,
);
const ghi = new Map(om.minutely_15.time.map((t, i) => [Date.parse(`${t}:00Z`), om.minutely_15.shortwave_radiation[i]]));

const rows = [];
for (let i = 0; i < slots; i++) {
  const t = start + i * 900e3;
  const priceEurMWh = prices.get(t);
  const g = ghi.get(t);
  if (priceEurMWh === undefined || g === undefined || g === null) {
    throw new Error(`missing data at ${new Date(t).toISOString()} price=${priceEurMWh} ghi=${g}`);
  }
  rows.push({ t, priceEurMWh, ghiWm2: g });
}

await mkdir('data', { recursive: true });
const out = {
  day,
  timezone: 'Europe/Berlin',
  location: { lat: Number(lat), lon: Number(lon) },
  sources: {
    price: 'SMARD.de (Bundesnetzagentur), day-ahead DE-LU, series 4169, quarter-hour, EUR/MWh',
    irradiance: 'Open-Meteo historical-forecast-api minutely_15 shortwave_radiation (GHI), W/m2',
  },
  fetchedAt: new Date().toISOString(),
  slots: rows,
};
await writeFile(`data/day-${day}.json`, JSON.stringify(out, null, 1));
console.log(`data/day-${day}.json: ${rows.length} slots`);
