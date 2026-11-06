// Fetch one real past day of public data and cache it in data/.
// Usage: node scripts/fetch-day.js 2026-10-26 [lat] [lon]
import { writeFile, mkdir } from 'node:fs/promises';
import { fetchDay } from '../src/fetch-data.js';

const [, , day, lat = '50.00', lon = '8.26'] = process.argv;
if (!/^\d{4}-\d{2}-\d{2}$/.test(day ?? '')) {
  console.error('usage: node scripts/fetch-day.js YYYY-MM-DD [lat] [lon]');
  process.exit(1);
}
const out = await fetchDay(day, { lat, lon, source: 'historical' });
await mkdir('data', { recursive: true });
await writeFile(`data/day-${day}.json`, JSON.stringify(out, null, 1));
console.log(`data/day-${day}.json: ${out.slots.length} slots`);
