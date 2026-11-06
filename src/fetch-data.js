// Fetch one real day (Europe/Berlin local day) of public data.
//  - Day-ahead wholesale price, 15-min, DE-LU: SMARD (Bundesnetzagentur), series 4169, EUR/MWh
//  - Global horizontal irradiance, 15-min: Open-Meteo (archived forecasts for past days, live forecast for today/tomorrow)

// UTC ms of local midnight in Berlin for the given day.
export function berlinMidnightUtc(d) {
  const guess = Date.parse(`${d}T00:00:00Z`);
  const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hour: '2-digit', hourCycle: 'h23' });
  const offsetH = Number(fmt.format(new Date(guess))); // Berlin hour at 00:00 UTC = offset
  return guess - offsetH * 3600e3;
}
export const berlinDate = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(new Date(ms));

async function getJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

/** @param source 'historical' (archived forecasts, past days) | 'forecast' (today / tomorrow) */
export async function fetchDay(day, { lat = '50.00', lon = '8.26', source = 'historical' } = {}) {
  const start = berlinMidnightUtc(day);
  const end = berlinMidnightUtc(new Date(Date.parse(`${day}T12:00:00Z`) + 86400e3).toISOString().slice(0, 10));
  const slots = (end - start) / 900e3; // 96 normally, 92/100 on DST days

  const base = 'https://www.smard.de/app/chart_data/4169/DE';
  const { timestamps } = await getJson(`${base}/index_quarterhour.json`);
  const prices = new Map();
  for (const t of timestamps.filter((t) => t <= end).slice(-2)) { // day may span two weekly chunks
    const { series } = await getJson(`${base}/4169_DE_quarterhour_${t}.json`);
    for (const [ts, v] of series) if (v !== null) prices.set(ts, v);
  }

  const host = source === 'forecast' ? 'api.open-meteo.com' : 'historical-forecast-api.open-meteo.com';
  const d0 = new Date(start).toISOString().slice(0, 10);
  const d1 = new Date(end).toISOString().slice(0, 10);
  const om = await getJson(`https://${host}/v1/forecast?latitude=${lat}&longitude=${lon}&minutely_15=shortwave_radiation&timezone=UTC&start_date=${d0}&end_date=${d1}`);
  const ghi = new Map(om.minutely_15.time.map((t, i) => [Date.parse(`${t}:00Z`), om.minutely_15.shortwave_radiation[i]]));

  const rows = [];
  for (let i = 0; i < slots; i++) {
    const t = start + i * 900e3;
    const priceEurMWh = prices.get(t);
    const g = ghi.get(t);
    if (priceEurMWh === undefined || g === undefined || g === null) throw new Error(`missing data at ${new Date(t).toISOString()} price=${priceEurMWh} ghi=${g}`);
    rows.push({ t, priceEurMWh, ghiWm2: g });
  }
  return {
    day, timezone: 'Europe/Berlin', location: { lat: Number(lat), lon: Number(lon) },
    sources: {
      price: 'SMARD.de (Bundesnetzagentur), day-ahead DE-LU, series 4169, quarter-hour, EUR/MWh',
      irradiance: `Open-Meteo ${source === 'forecast' ? 'forecast' : 'historical-forecast-api'} minutely_15 shortwave_radiation (GHI), W/m2`,
    },
    fetchedAt: new Date().toISOString(),
    slots: rows,
  };
}
