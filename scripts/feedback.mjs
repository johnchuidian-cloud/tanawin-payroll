// Developer side of the in-app feedback loop. Contains NO secrets — it reads
// the public URL/anon key from .env and the dev login from .env.local
// (gitignored):
//   DEV_LOGIN_EMAIL=...   a dedicated Supabase Auth user (made by Maya in
//   DEV_LOGIN_PIN=...     Dashboard -> Authentication -> Add user)
//
// Usage:
//   node scripts/feedback.mjs list            open + in-progress reports
//   node scripts/feedback.mjs list all        everything, newest first
//   node scripts/feedback.mjs reply <id> <done|in-progress|wont-do> "reply text"
//
// Claude runs `list` when John says to check Maya's reports, builds the fix,
// then `reply <id> done "..."` — the status chip and reply appear in her app.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const readEnv = (file) => {
  const out = {};
  let text = '';
  try {
    text = fs.readFileSync(path.join(root, file), 'utf8');
  } catch {
    return out;
  }
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/);
    if (m && !line.trim().startsWith('#')) out[m[1]] = m[2];
  }
  return out;
};

const env = { ...readEnv('.env'), ...readEnv('.env.local') };
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const email = env.DEV_LOGIN_EMAIL;
const pin = env.DEV_LOGIN_PIN;
if (!url || !anon) throw new Error('.env is missing the Supabase URL / anon key.');
if (!email || !pin) {
  throw new Error('No dev login yet: put DEV_LOGIN_EMAIL and DEV_LOGIN_PIN in .env.local (gitignored).');
}

const auth = await fetch(`${url}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: anon, 'content-type': 'application/json' },
  body: JSON.stringify({ email, password: pin }),
});
if (!auth.ok) throw new Error(`Dev sign-in failed (${auth.status}): ${await auth.text()}`);
const { access_token } = await auth.json();
const headers = { apikey: anon, authorization: `Bearer ${access_token}`, 'content-type': 'application/json' };

const [cmd = 'list', ...args] = process.argv.slice(2);

if (cmd === 'list') {
  const all = args[0] === 'all';
  const filter = all ? '' : '&status=in.(open,in-progress)';
  const r = await fetch(`${url}/rest/v1/feedback?select=*&order=created_at.desc&limit=100${filter}`, { headers });
  if (!r.ok) throw new Error(`List failed (${r.status}): ${await r.text()}`);
  const rows = await r.json();
  if (!rows.length) console.log(all ? 'No reports at all yet.' : 'No open reports. 🎉');
  for (const f of rows) {
    console.log(`--- ${f.id}`);
    console.log(`[${f.status}] ${f.kind} from ${f.author} at ${f.created_at}  ctx=${JSON.stringify(f.context)}`);
    console.log(f.message);
    if (f.reply) console.log(`reply: ${f.reply}`);
  }
} else if (cmd === 'reply') {
  const [id, status, ...rest] = args;
  const reply = rest.join(' ');
  if (!id || !['done', 'in-progress', 'wont-do', 'open'].includes(status)) {
    throw new Error('Usage: reply <id> <done|in-progress|wont-do|open> "reply text"');
  }
  const patch = { status, ...(reply ? { reply } : {}) };
  if (status === 'done' || status === 'wont-do') patch.resolved_at = new Date().toISOString();
  const r = await fetch(`${url}/rest/v1/feedback?id=eq.${id}`, {
    method: 'PATCH',
    headers: { ...headers, prefer: 'return=representation' },
    body: JSON.stringify(patch),
  });
  if (!r.ok) throw new Error(`Reply failed (${r.status}): ${await r.text()}`);
  const rows = await r.json();
  console.log(rows.length ? `Updated ${id} -> ${status}` : `No report with id ${id}`);
} else {
  throw new Error(`Unknown command: ${cmd}`);
}
