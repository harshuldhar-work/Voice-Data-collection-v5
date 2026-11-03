# Voice Data Collection, v5 (12-phrase command set)

A duplicate of the original collector (`../collect/`, deployed at voice-data-collection.vercel.app) adapted to
the v5 command set. **The original site and its repo are untouched.** This folder has no git history on
purpose, so nothing here can be pushed over the original by accident.

## What a speaker records

The intake asks for a name and whether the person recorded the earlier 7-command session.

| | Returning speaker (recorded before) | First-time speaker |
|---|---|---|
| New phrases | start walking, start training, start running, end workout (3 takes each); start cycling, start swimming, resume workout, continue workout (2 each) | all 12 phrases: start walking, start workout, start training, start running, stop workout, end workout (3 each); start cycling, start swimming, start indoor workout, pause workout, resume workout, continue workout (2 each) |
| Anchors | 1 take each of start workout, stop workout, pause workout, start indoor workout, start running workout | none |
| Negatives | 5 phrases from a 15-phrase pool (rotated per speaker), interleaved with the commands, plus one free sentence at the end | same |
| Total | 31 prompts (about 4 minutes) | 36 prompts (about 5 minutes) |

**Why these choices:**
- **3 takes for close-sounding pairs, 2 for the rest** (user directive): start walking vs start workout
  ("w..k" onset), start training vs start running (in natural speech the two t's of "start training" merge, so
  the pair differs by one vowel), start workout vs stop workout (only the first word differs), end workout
  ("end" is the shortest discriminating word and sounds like "and"). Research R4 (speakers matter far more than
  takes per speaker) supports keeping everything else at 2.
- **Takes are spread across rounds, never back to back,** each round with a different delivery: natural,
  slower and clearer, quick. Spread-out takes are more independent than four in a row.
- **Anchors:** returning speakers already gave 4 takes of each old phrase months ago. Recording one take of each
  old phrase in the new session means old and new phrases both appear under the new session's conditions
  (device, room, mood), so the model cannot learn "new session = new phrase" as a shortcut. Returning speakers
  are asked to use the same phone or laptop as last time.
- **"start running" vs "start running workout":** both mean the start_running intent; the 3-word form exists
  from the earlier session, the 2-word form is new.
- **Negatives** (`NEG_POOL`): complete phrases that share a word with a real command and then go elsewhere
  (start yoga / rowing / dancing / jogging / hiking / intervals, start outdoor workout, start working, post
  workout, pause music, stop music, stop timer, end call, resume music, continue reading). They are what users
  will actually say and must be silently rejected; they are recorded mainly as a real test set (training on
  them is decided by an A/B gated on command recall). The free sentence asks speakers to avoid every command
  word, since command words inside negatives teach the model to reject real commands.
- The prompt order is shuffled per speaker but deterministic (seeded by name + mode).

## Capture

Mic constraints (echoCancellation on, noiseSuppression and autoGainControl off), 16 kHz mono 16-bit WAV, and peak
normalization (0.95, gain capped at 12x) are **identical to the original**. Two things changed, both measured on
the existing data (`../research/T4_signal_qc2.json`):

- **Word edges.** In the original, 170 of 2,188 real command clips end mid-word (Stop tapped while still
  speaking, the audio buffer in flight discarded, or the auto-stop firing mid-word) and 47 start mid-word. Now:
  a 0.30 s pre-roll from before the tap (never taken while a take is playing back), a 0.35 s post-roll after
  Stop, and the auto-stop waits in 0.25 s steps (up to 1.0 s) while the speaker is still talking. A tap shorter
  than 0.25 s is treated as an accidental double tap and discarded.
- **Two files per take** (decision D4, research R4 section 6). The original resampler is plain 3:1 decimation on
  48 kHz devices (no anti-alias filter): a 13 kHz tone lands at 3 kHz at full strength (measured in `test/`),
  inside the MFCC band, and the clips of 54 of the 80 original speakers (68%) show no anti-alias roll-off at all
  (research R4, section 6.3). The primary file is anti-aliased
  (windowed sinc, like the board's band-limited PDM path); the twin `<file>__legacy.wav` is byte-for-byte the
  original resampler, from the same buffer. Training mixes the two so aliasing stays independent of label and
  session; the pairs measure the alias effect on real captures.

## Files in each upload

`<label>/real_<name>_v5_<tag>.wav` (anti-aliased) and `<label>/real_<name>_v5_<tag>__legacy.wav` (twin), with tag
`r1` / `r2` / `r3` (round), `anchor`, or `neg_*`, plus `meta.json`: name, mode, session id, chain, browser sample
rate, user agent, the capture settings the browser actually applied (`track`: device label, echo cancellation,
AGC, noise suppression, sample rate), timestamps, and per clip: phrase, duration, normalization gain, alias
metric, pre-roll, stop reason (tap / auto), auto-stop extension, whether speech was still active at the end.

Sessions are uploaded in parts of at most 4.0 MB (the Vercel function body limit is 4.5 MB); a take and its twin
always travel in the same part and every part carries its own `meta.json`. Blob names:
`recordings_v5/<name>_<session>_p<i>of<n>-<random>.zip`. If a part fails, "Retry" resumes from that part.

## Deploy (one time, done by the user: needs GitHub + Vercel accounts)

1. Create a NEW GitHub repo (for example `Voice-Data-collection-v5`) and push the contents of this folder
   (`index.html`, `api/`, `package.json`, `pull_recordings.mjs`, `.gitignore`, `README.md`, `test/`).
2. vercel.com: **Add New, Project**, import the new repo, **Deploy**. This gives a new URL; the original
   project stays as it is.
3. Vercel project: **Storage, Create Database, Blob**, then redeploy once so `BLOB_READ_WRITE_TOKEN` is picked up.
4. Open the URL on a phone and a laptop, record a few clips, confirm "All done" appears.

## Test locally before deploying

```bash
node test/test_core.mjs              # 84 unit checks: prompt plans, negative rotation, resamplers, WAV, capture
                                     # edges, upload parts (exact zip size, worst case split, every part valid)
python3 -m http.server 8000          # then open http://localhost:8000 (mic works on localhost);
                                     # upload fails locally by design, use "Download instead (.zip)"
```

Verified end to end on 2026-11-02 in headless Chrome with a fake microphone and a mock upload API: a full
31-prompt session including early Stop taps, auto-stop extensions, an accidental double tap, a redo, and a failed
part that Retry re-sent alone (62 WAVs + 2 meta files, durations and metadata as designed).

## Collect

```bash
npm install
BLOB_READ_WRITE_TOKEN=<token of the v5 Blob store> node pull_recordings.mjs   # -> collected_v5/, manifest pulled_manifest_v5.txt
```

The pull follows Blob list pagination and reports any session whose parts are not all present yet.
