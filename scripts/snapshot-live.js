// Save today's and tomorrow's live data as a fallback snapshot for the hosted server.
// Usage: node scripts/snapshot-live.js
import { mkdirSync, writeFileSync } from 'node:fs';
import { fetchDay, berlinDate } from '../src/fetch-data.js';

mkdirSync('data/live', { recursive: true });
for (const offset of [0, 1, 2]) {
  const day = berlinDate(Date.now() + offset * 86400e3);
  try {
    const raw = await fetchDay(day, { source: 'forecast' });
    writeFileSync(`data/live/${day}.json`, JSON.stringify(raw));
    console.log(`data/live/${day}.json ${raw.slots.length} slots, fetched ${raw.fetchedAt}`);
  } catch (e) { console.log(`${day}: not available yet (${e.message.slice(0, 80)})`); }
}
