// Download NEW uploaded recording zips from Vercel Blob to ./collected_v5/ (skips ones already pulled).
// Usage:  BLOB_READ_WRITE_TOKEN=xxxxx node pull_recordings.mjs
// Already-pulled blob pathnames are tracked in pulled_manifest_v5.txt so re-running only fetches NEW people.
// Sessions over 4.0 MB arrive as parts: <name>_<session>_p<i>of<n>-<suffix>.zip. Every part carries its own
// meta.json, and the run reports any session whose parts are not all present yet.
import { list } from '@vercel/blob';
import { writeFile, mkdir, readFile, appendFile } from 'node:fs/promises';

let pulled = new Set();
try {
  pulled = new Set((await readFile('pulled_manifest_v5.txt', 'utf8')).split('\n').map(s => s.trim()).filter(Boolean));
} catch { /* no manifest yet */ }

const blobs = [];                                     // list() returns at most 1000 per page: follow the cursor
let cursor;
do {
  const page = await list({ prefix: 'recordings_v5/', cursor });
  blobs.push(...page.blobs);
  cursor = page.hasMore ? page.cursor : undefined;
} while (cursor);

await mkdir('collected_v5', { recursive: true });
let n = 0, skipped = 0;
for (const b of blobs) {
  if (pulled.has(b.pathname)) { skipped++; continue; }   // already pulled + QC'd, don't recheck
  const r = await fetch(b.url);
  if (!r.ok) { console.log('FAILED', b.pathname, r.status); continue; }
  const buf = Buffer.from(await r.arrayBuffer());
  const fn = 'collected_v5/' + b.pathname.split('/').pop();
  await writeFile(fn, buf);
  await appendFile('pulled_manifest_v5.txt', b.pathname + '\n');
  console.log('saved', fn, buf.length, 'bytes');
  n++;
}
// completeness of multi-part sessions, over everything in the store
const sessions = new Map();
for (const b of blobs) {
  const m = b.pathname.split('/').pop().match(/^([a-z0-9]+)_([a-z0-9]+)_p(\d+)of(\d+)(?:-[A-Za-z0-9]+)?\.zip$/i);
  if (!m) continue;
  const key = `${m[1]}_${m[2]}`, s = sessions.get(key) || { parts: Number(m[4]), have: new Set() };
  s.have.add(Number(m[3])); sessions.set(key, s);
}
const incomplete = [...sessions].filter(([, s]) => s.have.size < s.parts);
for (const [k, s] of incomplete) console.log(`INCOMPLETE session ${k}: has parts ${[...s.have].sort().join(',')} of ${s.parts}`);
console.log(`done: ${n} NEW recording zip(s) in ./collected_v5/; skipped ${skipped} already-pulled; ` +
            `${sessions.size} multi-part session(s), ${incomplete.length} incomplete`);
if (n) console.log('next: python ingest_v5.py (after QC) then retrain');
