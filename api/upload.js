// v5 collector (2026-11): same as the original upload function, but stores under recordings_v5/ so v5 sessions
// never mix with the original 7-command collection (even if the same Blob store is used).
// Requires a Blob store linked to the project (Vercel injects BLOB_READ_WRITE_TOKEN automatically).
import { put, head } from '@vercel/blob';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' });
    return;
  }
  // Clear, actionable error if the Blob store hasn't been created yet.
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    res.status(503).json({
      error: 'storage-not-configured',
      hint: 'In Vercel: Storage → Create → Blob, then Redeploy once.',
    });
    return;
  }
  try {
    const raw = (req.query && req.query.name) ? String(req.query.name) : 'anon';
    const name = raw.replace(/[^a-z0-9]/gi, '').slice(0, 24) || 'anon';
    // Multi-part sessions (the client splits sessions over 4.0 MB): <name>_<session>_p<i>of<n>.zip.
    const q = req.query || {};
    const session = String(q.session || '').replace(/[^a-z0-9]/gi, '').slice(0, 12);
    const part = parseInt(q.part, 10), parts = parseInt(q.parts, 10);
    const isPart = !!session && Number.isInteger(part) && Number.isInteger(parts) && parts >= 1 && parts <= 20 && part >= 1 && part <= parts;
    const base = isPart ? `${name}_${session}_p${part}of${parts}` : name;

    // Read the raw request body robustly (Vercel may hand us a Buffer, a string, or a stream).
    let body;
    if (Buffer.isBuffer(req.body)) body = req.body;
    else if (req.body instanceof Uint8Array) body = Buffer.from(req.body);
    else if (typeof req.body === 'string' && req.body.length) body = Buffer.from(req.body);
    else {
      const chunks = [];
      for await (const c of req) chunks.push(typeof c === 'string' ? Buffer.from(c) : c);
      body = Buffer.concat(chunks);
    }
    if (!body || !body.length) { res.status(400).json({ error: 'empty body' }); return; }

    const blob = await put(`recordings_v5/${base}.zip`, body, {
      access: 'public',
      contentType: 'application/zip',
      addRandomSuffix: true,
    });
    // Verify it actually landed in the store before telling the client it's saved.
    const meta = await head(blob.url);
    const confirmed = !!(meta && meta.size > 0);
    res.status(confirmed ? 200 : 500).json({ ok: confirmed, confirmed, url: blob.url, size: meta && meta.size });
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
}
