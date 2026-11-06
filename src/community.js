// Fictional neighbourhood for the demo (SIMULATION). Places are real only as map coordinates;
// members, grid zones and numbers are invented.
export const ZONES = {
  A: { name: 'Grid zone A (fictional DSO, Mainz)', controlArea: 'X', adjacent: ['B'] },
  B: { name: 'Grid zone B (fictional DSO, Wiesbaden)', controlArea: 'X', adjacent: ['A'] },
};

export const COMMUNITIES = {
  alt: { name: 'Altstadt Solar', zone: 'A', lat: 49.9986, lon: 8.2747 },
  neu: { name: 'Neustadt Sun Club', zone: 'A', lat: 50.0071, lon: 8.2577 },
  bie: { name: 'Biebrich Roofs', zone: 'B', lat: 50.0396, lon: 8.2346 },
};

// kind: household | sme | municipal | large   profile: home | business
export const MEMBERS = [
  { id: 'alt-01', name: 'Lena (house, PV)', community: 'alt', kind: 'household', pvKwp: 9, loadKwh: 9, profile: 'home' },
  { id: 'alt-02', name: 'Jonas (flat)', community: 'alt', kind: 'household', pvKwp: 0, loadKwh: 7, profile: 'home' },
  { id: 'alt-03', name: 'Bakery Rhein', community: 'alt', kind: 'sme', pvKwp: 0, loadKwh: 40, profile: 'business' },
  { id: 'alt-04', name: 'Mia (house, PV)', community: 'alt', kind: 'household', pvKwp: 7, loadKwh: 8, profile: 'home' },
  { id: 'alt-05', name: 'Primary school', community: 'alt', kind: 'municipal', pvKwp: 30, loadKwh: 60, profile: 'business' },
  { id: 'neu-01', name: 'Can (house, PV)', community: 'neu', kind: 'household', pvKwp: 10, loadKwh: 10, profile: 'home' },
  { id: 'neu-02', name: 'Sara (flat)', community: 'neu', kind: 'household', pvKwp: 0, loadKwh: 6, profile: 'home' },
  { id: 'neu-03', name: 'Bike repair shop', community: 'neu', kind: 'sme', pvKwp: 0, loadKwh: 18, profile: 'business' },
  { id: 'neu-04', name: 'Coworking roof', community: 'neu', kind: 'sme', pvKwp: 25, loadKwh: 30, profile: 'business' },
  { id: 'neu-05', name: 'Logistics Corp (large)', community: 'neu', kind: 'large', pvKwp: 0, loadKwh: 120, profile: 'business' },
  { id: 'bie-01', name: 'Tom (house, PV)', community: 'bie', kind: 'household', pvKwp: 5, loadKwh: 9, profile: 'home' },
  { id: 'bie-02', name: 'Café am Rhein', community: 'bie', kind: 'sme', pvKwp: 0, loadKwh: 35, profile: 'business' },
  { id: 'bie-03', name: 'Ana (flat)', community: 'bie', kind: 'household', pvKwp: 0, loadKwh: 6, profile: 'home' },
  { id: 'bie-04', name: 'Sports hall', community: 'bie', kind: 'municipal', pvKwp: 0, loadKwh: 50, profile: 'business' },
  { id: 'bie-05', name: 'Corner supermarket', community: 'bie', kind: 'sme', pvKwp: 0, loadKwh: 90, profile: 'business' },
];

// Synthetic daily load shapes (SIMULATION, not a published standard profile), 96 quarter-hours in local time.
function shape(fn) {
  const w = Array.from({ length: 96 }, (_, i) => fn(i / 4));
  const s = w.reduce((a, b) => a + b, 0);
  return w.map((x) => x / s);
}
const bump = (h, c, width) => Math.exp(-(((h - c) / width) ** 2));
export const LOAD_SHAPES = {
  home: shape((h) => 0.25 + 0.8 * bump(h, 7.5, 1.2) + 0.5 * bump(h, 13, 2) + 1.3 * bump(h, 19.5, 2)),
  business: shape((h) => 0.15 + (h >= 7 && h < 18 ? 1 : 0) + 0.3 * bump(h, 12.5, 1.5)),
};
