// Unit tests for the pure logic in index.html (<script id="core">). Run: node test/test_core.mjs
import fs from "node:fs"; import vm from "node:vm"; import os from "node:os"; import path from "node:path";
import { execFileSync } from "node:child_process";
const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const m = html.match(/<script id="core">([\s\S]*?)<\/script>/); if (!m) throw new Error("core script not found");
const ctx = vm.createContext({ TextEncoder, Blob, console, Math, Uint8Array, Float32Array, Uint32Array, ArrayBuffer, DataView });
vm.runInContext(m[1] + "\n;globalThis.__c={PHRASES,PLAN,ROUNDS,NEG_POOL,NEG_PER_SPEAKER,NEG_FREE,CHAIN,twinKey,seededRng,shuffle,buildPrompts,clipKey,resampleLegacy,resampleAA,diffDb,peakNormalize,encodeWav,makeZip,crc32,PRE_ROLL_S,POST_ROLL_S,EXT_STEP_S,EXT_MAX_S,ringPush,tailActive,MAX_PART_BYTES,zipSize,splitParts};", ctx);
const C = ctx.__c; let fails = 0, passes = 0;
const ok = (cond, msg) => { if (cond) { passes++; console.log("  PASS", msg); } else { fails++; console.log("  FAIL", msg); } };

console.log("T1 prompt plans");
for (const [mode, expected] of [["returning", 31], ["newcomer", 36]]) {
  const P = C.buildPrompts(mode, "ravi"), plan = C.PLAN[mode];
  ok(P.length === expected, `${mode}: ${P.length} prompts (expected ${expected})`);
  const keys = P.map(p => C.clipKey(p, "ravi")); ok(new Set(keys).size === keys.length, `${mode}: all clip file names unique`);
  let maxRun = 0; for (let i = 1; i < P.length; i++) if (P[i].label !== "unknown" && P[i].label === P[i - 1].label) maxRun++;
  ok(maxRun === 0, `${mode}: no two takes of the same phrase back to back`);
  for (const [l, n] of Object.entries(plan.takes)) ok(P.filter(p => p.label === l && p.tag !== "anchor").length === n, `${mode}: ${l} x${n}`);
  for (const l of plan.anchors) ok(P.filter(p => p.label === l && p.tag === "anchor").length === 1, `${mode}: anchor ${l} x1`);
  const negs = P.filter(p => p.kind === "neg");
  ok(negs.length === C.NEG_PER_SPEAKER + 1 && P[P.length - 1].tag === "neg_free" && P[0].kind === "cmd", `${mode}: ${C.NEG_PER_SPEAKER} hard negatives + the free sentence last, session starts with a command`);
  ok(negs.slice(0, -1).every(n => C.NEG_POOL.some(([t, s]) => t === n.tag && s === n.say)) && new Set(negs.map(n => n.tag)).size === negs.length, `${mode}: hard negatives come from the pool, no repeats`);
  ok(P.findIndex(p => p.kind === "neg") < P.length - C.NEG_PER_SPEAKER - 1 || P.slice(0, -1).some((p, i, a) => p.kind === "neg" && i < a.length - 1 && a[i + 1].kind === "cmd"), `${mode}: hard negatives are interleaved, not all at the end`);
  ok(P.every(p => p.kind === "neg" || C.PHRASES[p.label] === p.say), `${mode}: every command prompt text matches its label`);
  const again = C.buildPrompts(mode, "ravi").map(p => p.label + p.tag).join(), other = C.buildPrompts(mode, "anika").map(p => p.label + p.tag).join();
  ok(again === P.map(p => p.label + p.tag).join(), `${mode}: order deterministic per name`);
  ok(other !== again, `${mode}: order differs across names`);
}
const newLabels = Object.keys(C.PLAN.newcomer.takes).sort().join();
ok(newLabels === "continue_workout,end_workout,pause_workout,resume_workout,start_cycling,start_indoor_workout,start_running,start_swimming,start_training,start_walking,start_workout,stop_workout", "newcomer plan covers exactly the 12 v5 phrases");
ok(!JSON.stringify(C.PLAN).match(/hike|hiking|interval|finish/), "no dropped commands (hike/intervals/finish run) among the positives");
ok(/start, stop, pause, resume, continue, end, workout, running, walking, training, cycling, swimming/.test(C.NEG_FREE[2]), "free-speech negative tells speakers to avoid every command word");
ok(C.NEG_POOL.every(([, s]) => !Object.values(C.PHRASES).includes(s)), "no hard negative is identical to a command phrase");
{ const seen = {}; for (let k = 0; k < 300; k++) for (const p of C.buildPrompts("returning", "spk" + k)) if (p.kind === "neg" && p.tag !== "neg_free") seen[p.tag] = (seen[p.tag] || 0) + 1;
  const c = Object.values(seen); ok(Object.keys(seen).length === C.NEG_POOL.length && Math.min(...c) > 0.5 * 300 * C.NEG_PER_SPEAKER / C.NEG_POOL.length, `rotation covers all ${C.NEG_POOL.length} hard negatives over 300 speakers (min ${Math.min(...c)}, max ${Math.max(...c)}, ideal ${300 * C.NEG_PER_SPEAKER / C.NEG_POOL.length})`); }
ok(C.CHAIN === "aa+legacy" && C.twinKey("start_walking/real_ravi_v5_r1.wav") === "start_walking/real_ravi_v5_r1__legacy.wav", "dual output: anti-aliased primary + legacy twin naming");

console.log("T2 resamplers (tones)");
const tone = (sr, f, sec = 1, a = 0.5) => { const x = new Float32Array(Math.round(sr * sec)); for (let i = 0; i < x.length; i++) x[i] = a * Math.sin(2 * Math.PI * f * i / sr); return x; };
const goertzelDb = (x, f, sr = 16000) => { const lo = Math.floor(x.length * 0.2), hi = Math.floor(x.length * 0.8), N = hi - lo; const k = 2 * Math.cos(2 * Math.PI * f / sr); let s1 = 0, s2 = 0; for (let i = lo; i < hi; i++) { const s = x[i] + k * s1 - s2; s2 = s1; s1 = s; } const p = s1 * s1 + s2 * s2 - k * s1 * s2; return 10 * Math.log10(Math.max(1e-30, 4 * p / (N * N) / 0.25)); };  // dB re amplitude 0.5
for (const sr of [48000, 44100]) {
  const pass = C.resampleAA(tone(sr, 1000), sr); ok(Math.abs(goertzelDb(pass, 1000)) < 0.1, `${sr}: AA passes 1 kHz (${goertzelDb(pass, 1000).toFixed(3)} dB)`);
  const fHi = sr === 48000 ? 13000 : 12550, fAl = sr === 48000 ? 3000 : 16000 - 12550;
  const leg = C.resampleLegacy(tone(sr, fHi), sr), aa = C.resampleAA(tone(sr, fHi), sr);
  const legDb = goertzelDb(leg, fAl), aaDb = goertzelDb(aa, fAl);
  console.log(`      ${fHi} Hz tone -> alias at ${fAl} Hz: legacy ${legDb.toFixed(1)} dB, AA ${aaDb.toFixed(1)} dB`);
  ok(aaDb < -60, `${sr}: AA rejects the ${fHi} Hz alias by > 60 dB`);
}
const legA = C.resampleLegacy(tone(48000, 13000), 48000); ok(goertzelDb(legA, 3000) > -6, "48000: confirms the original (legacy) chain aliases 13 kHz into 3 kHz (inside the MFCC band)");

console.log("T3 WAV encoding");
const w = C.encodeWav(Float32Array.from([0, 1.5, -1.5, 0.25]));
const dv = new DataView(w.buffer);
ok(w.length === 44 + 8 && String.fromCharCode(...w.slice(0, 4)) === "RIFF" && String.fromCharCode(...w.slice(8, 12)) === "WAVE", "header RIFF/WAVE, size 44+2n");
ok(dv.getUint16(22, true) === 1 && dv.getUint32(24, true) === 16000 && dv.getUint16(34, true) === 16, "mono, 16000 Hz, 16-bit");
ok(dv.getInt16(46, true) === 32767 && dv.getInt16(48, true) === -32768 && dv.getInt16(50, true) === Math.trunc(0.25 * 32767), "samples clamp at full scale and convert correctly");

console.log("T4 upload parts: exact zip size, worst-case sessions (every take + its legacy twin) split under the limit, every part valid (Python zipfile)");
const rndFiles = Array.from({ length: 7 }, (_, i) => ({ name: `x/clip_${i}_é.wav`, data: Uint8Array.from({ length: 100 + 37 * i }, () => (Math.random() * 256) | 0) }));
ok(rndFiles.every((_, k) => C.zipSize(rndFiles.slice(0, k + 1)) === C.makeZip(rndFiles.slice(0, k + 1)).size), "zipSize() equals the real makeZip() size exactly (incl. a UTF-8 name)");
const worstSession = (mode) => {                   // every clip at its maximum length: pre-roll + full extension + post-roll
  const P = C.buildPrompts(mode, "testuser"), files = [];
  for (const p of P) { const n = Math.round((p.dur + C.PRE_ROLL_S + C.EXT_MAX_S + C.POST_ROLL_S) * 16000); const x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = (Math.random() * 2 - 1) * 0.3; const w = C.encodeWav(x); files.push([{ name: C.clipKey(p, "testuser"), data: w }, { name: C.twinKey(C.clipKey(p, "testuser")), data: w }]); }
  return files;                                    // units: [take, its legacy twin]
};
for (const mode of ["returning", "newcomer"]) {
  const units = worstSession(mode), files = units.flat(), enc = new TextEncoder();
  const metaFor = (arr, i = 99, n = 99) => enc.encode(JSON.stringify({ schema: "v5-collector-2", part: i, parts: n, partClips: arr.map(f => f.name), clips: files.map(f => ({ file: f.name, label: "x", dur_s: 3.123, legacy_vs_aa_diff_db: -12.345 })) }, null, 1));
  const total = C.zipSize(files);
  const groups = C.splitParts(units, arr => metaFor(arr));
  ok(units.every(u => groups.some(g => u.every(f => g.includes(f)))), `${mode}: every take and its legacy twin land in the same part`);
  const zips = groups.map((g, k) => C.makeZip(g.concat([{ name: "meta.json", data: metaFor(g, k + 1, groups.length) }])));
  ok(zips.every(z => z.size <= C.MAX_PART_BYTES), `${mode}: worst case ${(total / 1e6).toFixed(2)} MB -> ${groups.length} part(s), largest ${(Math.max(...zips.map(z => z.size)) / 1e6).toFixed(2)} MB <= ${C.MAX_PART_BYTES / 1e6} MB`);
  ok(groups.flat().map(f => f.name).join() === files.map(f => f.name).join(), `${mode}: parts cover every clip once, in order`);
  for (let k = 0; k < zips.length; k++) {
    const buf = Buffer.from(await zips[k].arrayBuffer()); const f = path.join(os.tmpdir(), `kwsv5_${mode}_p${k + 1}.zip`); fs.writeFileSync(f, buf);
    const out = execFileSync("python3", ["-c", "import sys,zipfile,json;z=zipfile.ZipFile(sys.argv[1]);print(z.testzip());n=z.namelist();print(len(n));m=json.loads(z.read('meta.json'));print(m['part'],m['parts'],len(m['partClips']))", f]).toString().trim().split("\n");
    ok(out[0] === "None" && Number(out[1]) === groups[k].length + 1 && out[2] === `${k + 1} ${groups.length} ${groups[k].length}`, `${mode}: part ${k + 1}/${groups.length} valid zip, ${groups[k].length} clips + its own meta.json`);
  }
}

console.log("T6 capture edges (pre-roll ring, still-talking detector)");
{ const ring = [], max = Math.round(C.PRE_ROLL_S * 48000); let last;
  for (let k = 0; k < 40; k++) { last = new Float32Array(2048).fill(k); C.ringPush(ring, last, max); }
  const n = ring.reduce((a, c) => a + c.length, 0);
  ok(n >= max && n < max + 2048 && ring[ring.length - 1] === last, `ring keeps the most recent ${n} samples (>= ${max}, < ${max} + one chunk)`); }
const chunksOf = (x, c = 2048) => { const out = []; for (let i = 0; i < x.length; i += c) out.push(x.slice(i, i + c)); return out; };
const cat2 = (...xs) => { const n = xs.reduce((a, x) => a + x.length, 0), o = new Float32Array(n); let p = 0; for (const x of xs) { o.set(x, p); p += x.length; } return o; };
const sil = (sr, sec, a = 0) => Float32Array.from({ length: Math.round(sr * sec) }, () => a * (Math.random() * 2 - 1));
for (const sr of [48000, 44100]) {
  const t = tone(sr, 300, 1.0);
  ok(C.tailActive(chunksOf(cat2(sil(sr, 0.3), t)), sr) === true, `${sr}: speech running to the end -> still talking`);
  ok(C.tailActive(chunksOf(cat2(sil(sr, 0.3), t, sil(sr, 0.5))), sr) === false, `${sr}: speech then 0.5 s silence -> finished`);
  ok(C.tailActive(chunksOf(cat2(t, sil(sr, 0.5, 0.005))), sr) === false, `${sr}: speech then -40 dB room noise -> finished`);
  ok(C.tailActive(chunksOf(sil(sr, 1.5)), sr) === false, `${sr}: digital silence -> not talking`);
  ok(C.tailActive(chunksOf(cat2(t, sil(sr, 0.35))), sr, 0.1) === false && C.tailActive(chunksOf(t), sr, 0.1) === true, `${sr}: end check after the post-roll (0.1 s window)`);
}

console.log("T5 normalization + alias metric");
const quiet = Float32Array.from({ length: 1000 }, (_, i) => 0.02 * Math.sin(i / 7)); const g = C.peakNormalize(quiet);
ok(Math.abs(g - 12) < 1e-9, "quiet clip: gain capped at 12x (as original)");
const loud = Float32Array.from({ length: 1000 }, (_, i) => 0.5 * Math.sin(i / 7)); C.peakNormalize(loud);
ok(Math.abs(Math.max(...loud.map(Math.abs)) - 0.95) < 1e-3, "normal clip: peak normalized to 0.95");
const s1k = tone(48000, 1000); ok(C.diffDb(C.resampleLegacy(s1k, 48000), C.resampleAA(s1k, 48000)) < -30, "alias metric small for a clean in-band tone");
console.log(`\n${passes} passed, ${fails} failed`); process.exit(fails ? 1 : 0);
