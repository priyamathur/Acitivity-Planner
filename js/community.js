// Shared by the app and the server. Privacy model for "Popular near you":
//  - location is reduced on the device to a coarse grid cell (~5 km); raw
//    coordinates are never sent
//  - kids are reduced to age bands; no names, birth years or photos are sent
//  - the server only returns activities shared by at least MIN_FAMILIES
//    distinct families, so no single family's activity can be singled out

export const CELL_DEG = 0.05; // ~5.5 km north–south; narrower east–west away from the equator

export const AGE_BANDS = [
  { id: '0-3', label: 'ages 0–3', min: 0, max: 3 },
  { id: '4-5', label: 'ages 4–5', min: 4, max: 5 },
  { id: '6-8', label: 'ages 6–8', min: 6, max: 8 },
  { id: '9-12', label: 'ages 9–12', min: 9, max: 12 },
];

export function cellFor({ lat, lon }) {
  return `${Math.floor(lat / CELL_DEG)}:${Math.floor(lon / CELL_DEG)}`;
}

const CELL_RE = /^-?\d{1,4}:-?\d{1,4}$/;
export const isValidCell = (c) => typeof c === 'string' && CELL_RE.test(c);

// The cell plus its 8 neighbours, so "near you" isn't cut off at a grid edge.
export function neighbourCells(cell) {
  const [y, x] = cell.split(':').map(Number);
  const out = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) out.push(`${y + dy}:${x + dx}`);
  return out;
}

export function bandFor(age) {
  return AGE_BANDS.find((b) => age >= b.min && age <= b.max)?.id ?? null;
}

export function bandsForAges(ages) {
  return [...new Set(ages.map(bandFor).filter(Boolean))];
}

export const isValidBand = (b) => AGE_BANDS.some((x) => x.id === b);
export const bandLabel = (id) => AGE_BANDS.find((b) => b.id === id)?.label ?? id;
