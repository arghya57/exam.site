// api/ai.js — Vercel Serverless Function (Node)
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY, ANTHROPIC_API_KEY
// ঐচ্ছিক: AI_MODEL_FAST, AI_MODEL_SMART
const SB = process.env.SUPABASE_URL;
const SK = process.env.SUPABASE_SERVICE_KEY;
const AK = process.env.ANTHROPIC_API_KEY;
const FAST = process.env.AI_MODEL_FAST || 'claude-haiku-5-5';
const SMART = process.env.AI_MODEL_SMART || 'claude-sonnet-5-5';

async function sb(path, opt = {}) {
  const r = await fetch(SB + path, {
    ...opt,
    headers: { apikey: SK, Authorization: 'Bearer ' + SK, 'Content-Type': 'application/json', ...(opt.headers || {}) },
  });
  const t = await r.text();
  let j = null;
  try { j = t ? JSON.parse(t) : null; } catch (e) {}
  if (!r.ok) throw new Error((j && (j.message || j.error)) || 'DB ' + r.status);
  return j;
}
const rpc = (fn, args) => sb('/rest/v1/rpc/' + fn, { method: 'POST', body: JSON.stringify(args) });

async function authUser(req) {
  const t = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!t) return null;
  const r = await fetch(SB + '/auth/v1/user', { headers: { apikey: SK, Authorization: 'Bearer ' + t } });
  if (!r.ok) return null;
  const u = await r.json();
  return u && u.id ? u : null;
}
async function isAdmin(id) {
  const r = await sb('/rest/v1/admins?user_id=eq.' + id + '&select=user_id');
  return Array.isArray(r) && r.length > 0;
}

async function claude({ model, system, messages, max_tokens = 1200 }) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': AK, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model, max_tokens, system, messages }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error((j.error && j.error.message) || 'AI ত্রুটি ' + r.status);
  return (j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
}

const CLS = { 6: 'ষষ্ঠ', 7: 'সপ্তম', 8: 'অষ্টম', 9: 'নবম', 10: 'দশম', 11: 'একাদশ', 12: 'দ্বাদশ', 13: 'এডমিশন' };

const TUTOR_SYS = `তুমি "Exam Site by Arghya"-এর বন্ধুসুলভ AI টিউটর। বাংলাদেশের NCTB পাঠ্যক্রম অনুযায়ী সহজ বাংলায় শেখাও।
- আগে ধারণাটা বুঝিয়ে দাও, তারপর উদাহরণ। উত্তর ছোট ও পরিষ্কার রাখো (সাধারণত ২০০ শব্দের মধ্যে)।
- দরকারে ধাপে ধাপে দেখাও। শেষে চাইলে একটি ছোট অনুশীলন প্রশ্ন দিতে পারো।
- পড়াশোনার বাইরের বিষয় হলে বিনয়ের সঙ্গে পড়ার দিকে ফিরিয়ে আনো।
- নিশ্চিত না হলে সেটা বলো; তথ্য বানিয়ে বলো না।`;

const DOUBT_SYS = `তুমি একজন দক্ষ ডাউট সলভার। শিক্ষার্থীর সমস্যাটি ধাপে ধাপে সমাধান করো।
- প্রথমে কী চাওয়া হয়েছে এক লাইনে লেখো, তারপর ব্যবহৃত সূত্র/ধারণা, তারপর ধাপগুলো।
- শেষ লাইনে **চূড়ান্ত উত্তর** বোল্ডে দাও।
- ছবি থাকলে ছবির লেখা/চিত্র পড়ে সমাধান করো; ছবি অস্পষ্ট বা অসম্পূর্ণ হলে সেটা স্পষ্ট বলো।
- সহজ বাংলায় লেখো; ইংরেজি বিষয়ে প্রয়োজনে ইংরেজি ব্যবহার করো।`;

const GENQ_SYS = `তুমি বাংলাদেশের অভিজ্ঞ প্রশ্নপ্রণেতা। শুধু বৈধ JSON অ্যারে আউটপুট দাও — কোনো ভূমিকা, মার্কডাউন বা ব্যাখ্যা নয়।
প্রতিটি আইটেম: {"q":"প্রশ্ন","o":["অপশন১","অপশন২","অপশন৩","অপশন৪"],"a":সঠিক_অপশনের_ইনডেক্স(0-3),"m":1}
নিয়ম:
- বহুনির্বাচনি (MCQ); ঠিক একটি উত্তর সঠিক; বাকিগুলো বিশ্বাসযোগ্য ভুল (distractor)।
- অপশনে "ক)/খ)" ইত্যাদি লেবেল লিখবে না। প্রশ্ন একটি লাইনে।
- সঠিক উত্তরের অবস্থান (a) এলোমেলো রাখো।
- তথ্যগতভাবে নির্ভুল ও পাঠ্যবইভিত্তিক হবে; অস্পষ্ট বা দ্ব্যর্থক প্রশ্ন নয়।
- বাংলা বিষয়ে বাংলা সংখ্যা, ইংরেজি বিষয়ে ইংরেজিতে লেখো।
- "avoid" তালিকার প্রশ্নের মতো প্রশ্ন আবার করবে না।`;

function parseJSON(txt) {
  const a = txt.indexOf('['), b = txt.lastIndexOf(']');
  if (a < 0 || b <= a) throw new Error('AI সঠিক ফরম্যাটে উত্তর দেয়নি, আবার চেষ্টা করুন');
  return JSON.parse(txt.slice(a, b + 1));
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST দিন' });
  try {
    if (!SB || !SK) return res.status(500).json({ error: 'সার্ভারে SUPABASE_URL / SUPABASE_SERVICE_KEY সেট করা নেই' });
    const u = await authUser(req);
    if (!u) return res.status(401).json({ error: 'লগইন করুন' });
    const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const act = b.action;

    if (act === 'health') {
      if (!(await isAdmin(u.id))) return res.status(403).json({ error: 'শুধু অ্যাডমিন' });
      const has = (k) => !!process.env[k];
      return res.json({
        ok: true,
        env: Object.fromEntries(
          ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'ANTHROPIC_API_KEY', 'WA_TOKEN', 'WA_PHONE_ID', 'CRON_SECRET', 'SITE_URL'].map((k) => [k, has(k)])
        ),
      });
    }

    if (!AK) return res.status(500).json({ error: 'সার্ভারে ANTHROPIC_API_KEY সেট করা নেই' });

    if (act === 'genq') {
      if (!(await isAdmin(u.id))) return res.status(403).json({ error: 'শুধু অ্যাডমিন' });
      const n = Math.max(1, Math.min(8, parseInt(b.count) || 6));
      const avoid = (b.avoid || []).slice(-40).map((s) => String(s).slice(0, 80));
      const prompt = `শ্রেণি: ${CLS[b.class_level] || b.class_level || 'উল্লেখ নেই'}
বিষয়: ${String(b.subject || '').slice(0, 80)}
অধ্যায়/টপিক: ${String(b.chapter || '').slice(0, 120)}
কাঠিন্য: ${String(b.difficulty || 'বার্ষিক পরীক্ষার মান').slice(0, 40)}
প্রশ্নসংখ্যা: ${n}
${b.notes ? 'এই নোট/টেক্সটের ভিত্তিতে বানাও:\n' + String(b.notes).slice(0, 6000) : ''}
avoid: ${JSON.stringify(avoid)}`;
      const out = await claude({ model: SMART, system: GENQ_SYS, messages: [{ role: 'user', content: prompt }], max_tokens: 4500 });
      const arr = parseJSON(out)
        .filter((x) => x && typeof x.q === 'string' && Array.isArray(x.o) && x.o.length === 4 && x.o.every((o) => typeof o === 'string' && o.trim()) && Number.isInteger(x.a) && x.a >= 0 && x.a <= 3)
        .map((x) => ({ q: x.q.replace(/\s+/g, ' ').trim(), o: x.o.map((o) => o.replace(/\s+/g, ' ').trim()), a: x.a, m: Math.max(1, parseInt(x.m) || 1) }));
      return res.json({ questions: arr });
    }

    if (u.is_anonymous || !u.email) return res.status(403).json({ error: 'এই ফিচারের জন্য ইমেইল/Google অ্যাকাউন্টে লগইন করুন' });

    if (act === 'tutor') {
      let msgs = (b.messages || []).slice(-10).map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: String(m.content || '').slice(0, 2000),
      })).filter((m) => m.content);
      while (msgs.length && msgs[0].role !== 'user') msgs.shift();
      if (!msgs.length || msgs[msgs.length - 1].role !== 'user') return res.status(400).json({ error: 'প্রশ্ন লিখুন' });
      const how = await rpc('ai_charge', { p_user: u.id, p_kind: 'tutor' });
      if (how === 'none') return res.status(402).json({ error: 'আজকের ফ্রি টিউটর মেসেজ শেষ। কয়েন শপ থেকে "টিউটর বুস্ট" কিনুন অথবা কাল আবার আসুন।' });
      try {
        const sys = TUTOR_SYS + (b.class_level ? `\nশিক্ষার্থীর শ্রেণি: ${CLS[b.class_level] || b.class_level}` : '');
        const reply = await claude({ model: FAST, system: sys, messages: msgs, max_tokens: 1000 });
        return res.json({ reply, how });
      } catch (e) {
        await rpc('ai_refund', { p_user: u.id, p_kind: 'tutor', p_how: how }).catch(() => {});
        throw e;
      }
    }

    if (act === 'doubt') {
      const q = String(b.question || '').trim().slice(0, 3000);
      const img = typeof b.image === 'string' ? b.image : '';
      if (!q && !img) return res.status(400).json({ error: 'প্রশ্ন লিখুন বা ছবি দিন' });
      if (img.length > 3_000_000) return res.status(413).json({ error: 'ছবি বেশি বড়' });
      const how = await rpc('ai_charge', { p_user: u.id, p_kind: 'doubt' });
      if (how === 'none') return res.status(402).json({ error: 'আজকের ফ্রি ডাউট শেষ এবং যথেষ্ট কয়েন নেই। কয়েন শপ থেকে ডাউট প্যাক কিনুন।' });
      try {
        const content = [];
        if (img) content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: img } });
        content.push({ type: 'text', text: (b.subject ? 'বিষয়: ' + String(b.subject).slice(0, 60) + '\n' : '') + (q || 'ছবির প্রশ্নটি সমাধান করো।') });
        const ans = await claude({ model: SMART, system: DOUBT_SYS, messages: [{ role: 'user', content }], max_tokens: 1800 });
        await sb('/rest/v1/doubts', {
          method: 'POST',
          body: JSON.stringify({ user_id: u.id, subject: b.subject || null, question: q || '(ছবি)', answer: ans, had_image: !!img }),
        }).catch(() => {});
        return res.json({ answer: ans, how });
      } catch (e) {
        await rpc('ai_refund', { p_user: u.id, p_kind: 'doubt', p_how: how }).catch(() => {});
        throw e;
      }
    }

    return res.status(400).json({ error: 'অজানা action' });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
};
