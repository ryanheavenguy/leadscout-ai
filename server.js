import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ path: '.env.local' });
dotenvConfig(); // fallback to .env (won't overwrite already-set vars)
import express from 'express';
import rateLimit from 'express-rate-limit';
import cors from 'cors';
import helmet from 'helmet';
import jwt from 'jsonwebtoken';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';
import { createClient } from '@supabase/supabase-js';
import { normalizePhone, formatPhone, sameNumber, toE164Digits } from './lib/phone.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Supabase admin client (service role bypasses RLS; auth enforced in requireAuth) ──
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

// Fix 5: Allowlist of fields that may be persisted — blocks arbitrary field injection
const ALLOWED_CHURCH_FIELDS = new Set([
  'id', 'name', 'organizationType', 'address', 'city', 'state', 'website', 'phone', 'email',
  'pastor', 'founded', 'congregationSize', 'serviceTimes', 'description', 'denomination',
  'facebook', 'instagram', 'youtube', 'confidenceScore', 'sourceEvidence', 'phoneCountryCode',
  'phoneIsWhatsApp', 'outreachStatus', 'savedAt',
  'industry', 'location', 'country'
]);
function pickAllowed(church) {
  return Object.fromEntries(
    Object.entries(church).filter(([k]) => ALLOWED_CHURCH_FIELDS.has(k))
  );
}

const app = express();
app.set('trust proxy', 1); // Fix 7: correct client IP behind reverse proxy
const PORT = process.env.PORT || 3001;
const MODEL_NAME = 'gemini-2.5-flash';

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });

// ─── Security headers ─────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      connectSrc: ["'self'"],
      imgSrc: ["'self'", "data:"],
      frameAncestors: ["'none'"],
    }
  }
}));

// ─── CORS ─────────────────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:4173',
  'https://db.theheavenguy.org',
  ...(process.env.VERCEL_URL ? [`https://${process.env.VERCEL_URL}`] : []),
];

app.use(cors({
  origin: (origin, callback) => {
    // same-origin requests (no Origin header) and allowed origins pass through
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    callback(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '200kb' })); // Fix 9: explicit body size cap

// ─── Rate limiting ────────────────────────────────────────────────────────────
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' }
});

app.use('/api', apiLimiter);

// ─── Input sanitization ───────────────────────────────────────────────────────
function sanitize(value, maxLen = 500) {
  if (typeof value !== 'string') return value;
  return value.trim().replace(/[<>]/g, '').slice(0, maxLen);
}

// ─── Prompt injection prevention ─────────────────────────────────────────────
// Newlines and common jailbreak tokens must not reach the prompt.
const INJECTION_RE = /[\n\r]|(ignore\s+previous|system\s*:|<\|im_start\||<\|endoftext\||instruction\s*:)/i;

function validatePromptField(value, fieldName) {
  if (INJECTION_RE.test(value)) {
    throw Object.assign(new Error(`Invalid characters in field: ${fieldName}.`), { status: 400 });
  }
}

// ─── Retry helper ─────────────────────────────────────────────────────────────
async function callWithRetry(fn, maxRetries = 3) {
  let lastError;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (error.status === 400) throw error;
      const isRateLimited = error.message?.includes('429') || error.status === 429;
      const isServerError = error.message?.includes('500') || error.status === 500;
      if (isRateLimited || isServerError || error.retryable) {
        const waitTime = Math.pow(2, i) * 1000 + Math.random() * 1000;
        console.warn(`[server] Gemini rate/server error (attempt ${i + 1}/${maxRetries}). Retrying in ${Math.round(waitTime)}ms...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

// ─── Robust JSON extraction ───────────────────────────────────────────────────
// Grounded Gemini calls (Google Search) cannot also set responseMimeType/responseSchema,
// so those endpoints get JSON as free text — often wrapped in ```json fences or with
// stray prose. Strip fences, then fall back to slicing the first JSON array/object.
function parseJsonResponse(text, fallback) {
  if (!text) return fallback;
  let cleaned = String(text).trim();
  const fenceMatch = cleaned.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenceMatch) cleaned = fenceMatch[1].trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.search(/[[{]/);
    const end = Math.max(cleaned.lastIndexOf(']'), cleaned.lastIndexOf('}'));
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        return fallback;
      }
    }
    return fallback;
  }
}

// ─── Salvage objects from a partial/truncated JSON array ──────────────────────
// A grounded reply that hits the token cap ends mid-array, so JSON.parse fails and
// every organization in the chunk loses its data. Scan for balanced {...} blocks so
// the objects that did come through are kept.
function extractJsonObjects(text) {
  const direct = parseJsonResponse(text, null);
  if (Array.isArray(direct)) return direct;
  if (direct && typeof direct === 'object') return [direct];

  const raw = String(text || '');
  const objects = [];
  let depth = 0, start = -1, inString = false, escaped = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      if (depth > 0 && --depth === 0 && start !== -1) {
        try { objects.push(JSON.parse(raw.slice(start, i + 1))); } catch { /* skip */ }
        start = -1;
      }
    }
  }
  return objects;
}

// ─── Enrichment field normalization ───────────────────────────────────────────
const PLACEHOLDER_RE = /^(n\/?a|na|none|null|nil|unknown|not\s+(found|listed|available|publicly\s+listed|specified)|unavailable|-{1,3})$/i;

function cleanField(value, maxLen = 500) {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) value = value[0];
  if (typeof value === 'object') return null;
  const s = String(value).trim().replace(/[<>]/g, '').slice(0, maxLen);
  if (!s || PLACEHOLDER_RE.test(s)) return null;
  return s;
}

// Models often drop the scheme, or park the church's own site in a social field.
function cleanUrl(value, requiredHost) {
  const s = cleanField(value, 300);
  if (!s) return null;
  const withScheme = /^https?:\/\//i.test(s) ? s : `https://${s.replace(/^\/+/, '')}`;
  let url;
  try { url = new URL(withScheme); } catch { return null; }
  const host = url.hostname.toLowerCase();
  if (requiredHost && !host.endsWith(requiredHost)) return null;
  // A bare domain with no handle/path carries no information.
  if (requiredHost && url.pathname.replace(/\/+$/, '') === '') return null;
  return url.toString();
}

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
function cleanEmail(value) {
  const s = cleanField(value, 254);
  if (!s) return null;
  const match = s.match(EMAIL_RE);
  return match ? match[0].toLowerCase() : null;
}

const normalizeName = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// ─── Auth middleware ──────────────────────────────────────────────────────────
async function requireAuth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !user) return res.status(401).json({ error: 'Invalid or expired token' });
    req.user = { sub: user.id, ...user };
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ─── Public routes ────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

// ─── Auth guard for all remaining /api routes ─────────────────────────────────
app.use('/api', requireAuth);

// ─── GET /api/db/churches ─────────────────────────────────────────────────────
app.get('/api/db/churches', async (req, res) => {
  try {
    const userId = req.user.sub;
    console.log('[/api/db/churches] userId:', userId);
    const { data, error } = await supabaseAdmin
      .from('churches')
      .select('*')
      .eq('userId', userId);
    console.log('[/api/db/churches] data length:', data?.length, 'error:', error);
    if (error) return res.status(500).json({ error: error.message || 'Failed to load churches.' });
    res.json(data);
  } catch (err) {
    console.error('[/api/db/churches] CAUGHT:', err);
    res.status(500).json({ error: err.message || 'Unexpected server error' });
  }
});

// ─── POST /api/db/churches ────────────────────────────────────────────────────
// Saves churches to the DB; skips duplicates (matched by name + city)
app.post('/api/db/churches', async (req, res) => {
  const { churches } = req.body;
  if (!Array.isArray(churches) || churches.length === 0) {
    return res.status(400).json({ error: 'churches must be a non-empty array.' });
  }
  if (churches.length > 200) {
    return res.status(400).json({ error: 'Maximum 200 churches per save.' });
  }

  const userId = req.user.sub;
  const rows = churches
    .filter(c => c && typeof c.name === 'string')
    .map(c => ({
      ...pickAllowed(c),
      userId,
      name: c.name.trim(),
      city: (c.city || '').trim(),
      savedAt: new Date().toISOString(),
      outreachStatus: 'not_contacted'
    }));

  // Get existing churches for this user to check for duplicates
  const { data: existing, error: existingError } = await supabaseAdmin
    .from('churches')
    .select('name,city')
    .eq('userId', userId);
  if (existingError) return res.status(500).json({ error: 'Failed to check existing churches.' });

  // Filter out duplicates (matching name + city)
  const existingSet = new Set((existing || []).map(c => `${c.name}|${c.city}`));
  const newRows = rows.filter(r => !existingSet.has(`${r.name}|${r.city}`));

  let data = [];
  let error = null;
  if (newRows.length > 0) {
    const result = await supabaseAdmin
      .from('churches')
      .insert(newRows)
      .select();
    data = result.data;
    error = result.error;
  }
  if (error) return res.status(500).json({ error: 'Failed to save churches.' });

  const { count } = await supabaseAdmin
    .from('churches')
    .select('*', { count: 'exact', head: true })
    .eq('userId', userId);
  res.json({ ok: true, added: (data || []).length, total: count || 0 });
});

// ─── PATCH /api/db/churches/:id ───────────────────────────────────────────────
// Accepts a partial update of any editable field (inline table editing) and/or
// the outreach status.
const EDITABLE_CHURCH_FIELDS = new Set([
  'name', 'organizationType', 'address', 'city', 'state', 'country', 'website',
  'phone', 'email', 'pastor', 'founded', 'congregationSize', 'serviceTimes',
  'description', 'facebook', 'instagram', 'youtube', 'outreachStatus'
]);

app.patch('/api/db/churches/:id', async (req, res) => {
  const { id } = req.params;
  const userId = req.user.sub;

  const updates = {};
  for (const [key, value] of Object.entries(req.body || {})) {
    if (!EDITABLE_CHURCH_FIELDS.has(key)) continue;
    updates[key] = typeof value === 'string' ? value.trim().slice(0, 2000) : value;
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No editable fields provided.' });
  }

  if ('outreachStatus' in updates) {
    const valid = ['not_contacted', 'contacted', 'responded', 'converted'];
    if (!valid.includes(updates.outreachStatus)) {
      return res.status(400).json({ error: 'Invalid outreachStatus.' });
    }
  }

  if ('name' in updates && !updates.name) {
    return res.status(400).json({ error: 'Name cannot be empty.' });
  }

  const { data, error } = await supabaseAdmin
    .from('churches')
    .update(updates)
    .eq('id', id)
    .eq('userId', userId)
    .select();
  if (error) return res.status(500).json({ error: 'Failed to update church.' });
  if (!data || data.length === 0) return res.status(404).json({ error: 'Church not found.' });
  res.json({ ok: true });
});

// ─── DELETE /api/db/churches/:id ─────────────────────────────────────────────
app.delete('/api/db/churches/:id', async (req, res) => {
  const { id } = req.params;
  const userId = req.user.sub;
  const { data, error } = await supabaseAdmin
    .from('churches')
    .delete()
    .eq('id', id)
    .eq('userId', userId)
    .select();
  if (error) return res.status(500).json({ error: 'Failed to delete church.' });
  if (!data || data.length === 0) return res.status(404).json({ error: 'Church not found.' });
  res.json({ ok: true });
});

// ─── POST /api/search-leads ───────────────────────────────────────────────────
app.post('/api/search-leads', async (req, res) => {
  try {
    let { industry, city, keywords, quantity, excludeList, batchSize } = req.body;

    if (!industry || !city || !keywords) {
      return res.status(400).json({ error: 'industry, city, and keywords are required.' });
    }
    quantity = Number(quantity);
    batchSize = Number(batchSize);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 200) {
      return res.status(400).json({ error: 'quantity must be an integer between 1 and 200.' });
    }
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 50) {
      return res.status(400).json({ error: 'batchSize must be an integer between 1 and 50.' });
    }

    industry = sanitize(industry);
    city = sanitize(city);
    keywords = sanitize(keywords);
    excludeList = typeof excludeList === 'string' ? sanitize(excludeList, 2000) : '';

    validatePromptField(industry, 'industry');
    validatePromptField(city, 'city');
    validatePromptField(keywords, 'keywords');
    // Fix 1: excludeList was missing injection validation — newlines can reach the prompt
    if (excludeList) validatePromptField(excludeList, 'excludeList');

    const result = await callWithRetry(async () => {
      // User inputs are wrapped in triple-quotes to delimit them from prompt instructions.
      const prompt = `Task: High-Accuracy Lead Discovery Research. Batch Size: ${batchSize}.

      Instructions:
      1. Discover exactly ${batchSize} fresh business leads in the sector """${industry}""" in the city """${city}""".
      2. IMPORTANT: DO NOT include any of the following already discovered companies: [${excludeList}].
      3. Verify the entity is active via business records or official site.
      4. Locate professional contact details for the primary decision maker (Founder/Owner/CEO).
      5. Provide LinkedIn URLs for both individual and company, plus Instagram and TikTok URLs if available.
      6. Scores: Calculate 'confidenceScore' (accuracy) and 'leadScore' (value based on keywords: """${keywords}""").

      Data Requirements:
      - companyName, website, address, description
      - contactName, contactTitle, contactEmail, contactPhone
      - linkedin, linkedinCompanyPage, twitter, facebook, instagram, tiktok
      - confidenceScore (0-100), leadScore (0-100)
      - sourceEvidence (where you found this)

      Constraint: Return ONLY a raw JSON array of objects — no markdown, no code fences, no prose. Avoid all hallucinations.`;

      // NOTE: Google Search grounding and responseMimeType/responseSchema are mutually
      // exclusive in the Gemini API, so JSON shape is enforced via the prompt and parsed
      // from text instead of via responseSchema.
      const response = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: prompt,
        config: {
          tools: [{ googleSearch: {} }]
        }
      });

      const parsed = parseJsonResponse(response.text, []);
      const leads = (Array.isArray(parsed) ? parsed : []).map((l, index) => ({
        ...l,
        id: `lead-${Date.now()}-${index}-${Math.random().toString(36).substr(2, 5)}`,
        industry,
        location: city
      }));
      const sources = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
      return { leads, sources };
    });

    res.json(result);
  } catch (err) {
    console.error('[/api/search-leads]', err);
    if (err.status === 400) return res.status(400).json({ error: err.message });
    res.status(500).json({ error: 'An internal error occurred.' });
  }
});

// ─── POST /api/research ───────────────────────────────────────────────────────
app.post('/api/research', async (req, res) => {
  try {
    const { lead } = req.body;

    if (!lead || !lead.companyName || !lead.website) {
      return res.status(400).json({ error: 'lead with companyName and website is required.' });
    }

    const companyName = sanitize(lead.companyName);
    const website = sanitize(lead.website);
    const contactName = lead.contactName ? sanitize(lead.contactName) : null;

    validatePromptField(companyName, 'companyName');
    validatePromptField(website, 'website');
    if (contactName) validatePromptField(contactName, 'contactName');

    const result = await callWithRetry(async () => {
      const prompt = `Act as an Investigative Business Analyst. Conduct deep-dive verification of """${companyName}""" ("""${website}""").

      Verification Steps:
      1. Confirm if the domain is currently active and belongs to the stated company.
      2. Analyze recent LinkedIn posts or press releases to confirm the current role of """${contactName || 'the CEO'}""".
      3. Verify the direct email address using common professional formats if not explicitly listed.
      4. Confirm the precise professional title for the primary contact.
      5. Evaluate the 'freshness' of the data found (last 6-12 months).

      Output ONLY a raw JSON object — no markdown, no code fences, no prose — with these keys: summary, keyContacts (array of strings), recentNews (array of strings), valueProposition, verifiedOwnerName, verifiedOwnerTitle, verifiedEmail, verifiedPhone, accuracyCheck (brief assessment of data freshness).`;

      // Google Search grounding can't be combined with responseMimeType/responseSchema;
      // JSON shape is enforced via the prompt and parsed from text.
      const response = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: prompt,
        config: {
          tools: [{ googleSearch: {} }]
        }
      });

      return parseJsonResponse(response.text, {});
    });

    res.json(result);
  } catch (err) {
    console.error('[/api/research]', err);
    if (err.status === 400) return res.status(400).json({ error: err.message });
    res.status(500).json({ error: 'An internal error occurred.' });
  }
});

// ─── POST /api/batch-summarize ────────────────────────────────────────────────
app.post('/api/batch-summarize', async (req, res) => {
  try {
    const { leads, results } = req.body;

    if (!Array.isArray(leads) || leads.length === 0) {
      return res.status(400).json({ error: 'leads must be a non-empty array.' });
    }
    if (!Array.isArray(results) || results.length === 0) {
      return res.status(400).json({ error: 'results must be a non-empty array.' });
    }
    if (leads.length !== results.length) {
      return res.status(400).json({ error: 'leads and results arrays must have the same length.' });
    }
    if (leads.length > 50) {
      return res.status(400).json({ error: 'Maximum batch size is 50.' });
    }

    const dataString = leads.map((l, i) => {
      const companyName = sanitize(l.companyName || '');
      const summary = sanitize(results[i].summary || '');
      return `Company: ${companyName}\nResearch Summary: ${summary}`;
    }).join('\n\n');

    const result = await callWithRetry(async () => {
      const prompt = `Analyze the following business research data for a cohort of ${leads.length} companies and provide a strategic synthesis.

      Data:
      ${dataString}

      Output JSON:
      - globalInsights: A paragraph summarizing common themes across these companies.
      - marketTrends: An array of 3-5 specific market trends observed in this group.
      - competitiveLandscape: A description of how these companies overlap or differentiate in the market.`;

      const response = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              globalInsights: { type: Type.STRING },
              marketTrends: { type: Type.ARRAY, items: { type: Type.STRING } },
              competitiveLandscape: { type: Type.STRING }
            },
            required: ['globalInsights', 'marketTrends', 'competitiveLandscape']
          }
        }
      });

      return JSON.parse(response.text || '{}');
    });

    res.json(result);
  } catch (err) {
    console.error('[/api/batch-summarize]', err);
    res.status(500).json({ error: 'An internal error occurred.' });
  }
});

// ─── POST /api/research-church ────────────────────────────────────────────────
app.post('/api/research-church', async (req, res) => {
  try {
    const { church } = req.body;

    if (!church || !church.name) {
      return res.status(400).json({ error: 'church with name is required.' });
    }

    const churchName = sanitize(church.name);
    const address = church.address ? sanitize(church.address) : '';
    const website = church.website ? sanitize(church.website) : '';

    validatePromptField(churchName, 'name');

    const result = await callWithRetry(async () => {
      const prompt = `Research the following church in depth using Google Search:

Church Name: """${churchName}"""
Address: """${address}"""
${website ? `Website: ${website}` : ''}

Find and return:
1. summary — 3-4 sentences describing this church's identity, theological tradition, and role in its community.
2. history — When it was founded, key milestones, how it has grown or changed.
3. ministries — List each ministry or program the church runs (youth, small groups, food pantry, missions, etc.).
4. leadership — Names and titles of senior pastor and any publicly listed staff.
5. recentNews — Any events, announcements, or news from the past 12 months.
6. missionStatement — The church's stated mission or vision if found on their site.
7. contactVerification — Brief note on how current the information appears (when you found it, how recently the site was updated, etc.).

Only report verified information. Do not invent details.

Return ONLY a raw JSON object — no markdown, no code fences, no prose — with these exact keys: summary (string), history (string), ministries (array of strings), leadership (array of strings), recentNews (array of strings), missionStatement (string), contactVerification (string).`;

      // Google Search grounding can't be combined with responseMimeType/responseSchema;
      // JSON shape is enforced via the prompt and parsed from text.
      const response = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: prompt,
        config: {
          tools: [{ googleSearch: {} }]
        }
      });

      return parseJsonResponse(response.text, {});
    });

    res.json(result);
  } catch (err) {
    console.error('[/api/research-church]', err);
    if (err.status === 400) return res.status(400).json({ error: err.message });
    res.status(500).json({ error: 'An internal error occurred.' });
  }
});

// ─── POST /api/search-churches-places ────────────────────────────────────────
// Finds real churches via Google Places Text Search API (no AI hallucination)
app.post('/api/search-churches-places', async (req, res) => {
  try {
    let { country, countryName, location, keywords, radius, includeChurches, includeMinistries, quantity } = req.body;

    location = location || '';
    keywords = keywords || '';

    const PLACES_KEY = process.env.GOOGLE_PLACES_API_KEY;
    if (!PLACES_KEY) {
      return res.status(500).json({ error: 'GOOGLE_PLACES_API_KEY is not configured on the server.' });
    }

    quantity = Math.min(Math.max(Number(quantity) || 20, 1), 60);

    // Radius (miles) → meters, applied as a locationBias circle around the geocoded location.
    // Google caps a searchText locationBias circle at 50,000 m, so clamp accordingly.
    const radiusMiles = Math.min(Math.max(Number(radius) || 0, 0), 50);
    const radiusMeters = Math.min(Math.round(radiusMiles * 1609.34), 50000);
    location = sanitize(location);
    validatePromptField(location, 'location');
    keywords = sanitize(keywords, 200);
    if (keywords) validatePromptField(keywords, 'keywords');

    // ISO 3166-1 Alpha-2 region code used to scope Places results to the selected country.
    const regionCode = typeof country === 'string' && /^[A-Za-z]{2}$/.test(country.trim())
      ? country.trim().toUpperCase()
      : null;
    countryName = countryName ? sanitize(countryName) : '';
    if (countryName) validatePromptField(countryName, 'country');

    // Build the geographic scope for the text query: "City, Country" when both are present.
    const place = [location, countryName].filter(Boolean).join(', ');

    const bothTypes = includeChurches && includeMinistries;
    const onlyMin = includeMinistries && !includeChurches;
    const baseQuery = bothTypes
      ? `Christian church or ministry organization in ${place}`
      : onlyMin
        ? `Christian ministry nonprofit organization in ${place}`
        : `Protestant Christian church in ${place}`;
    const textQuery = keywords ? `${baseQuery} focused on ${keywords}` : baseQuery;

    // When a location + radius are given, geocode the location to a center point so we can
    // bias Places results to a circle of that radius. Geocoding failures degrade gracefully
    // to the text-only "in {place}" query.
    let locationBias = null;
    if (location && radiusMeters > 0) {
      try {
        const geoUrl = new URL('https://maps.googleapis.com/maps/api/geocode/json');
        geoUrl.searchParams.set('address', place);
        geoUrl.searchParams.set('key', PLACES_KEY);
        if (regionCode) geoUrl.searchParams.set('region', regionCode);

        const geoResp = await fetch(geoUrl.toString());
        if (geoResp.ok) {
          const geo = await geoResp.json();
          const loc = geo.results?.[0]?.geometry?.location;
          if (loc && typeof loc.lat === 'number' && typeof loc.lng === 'number') {
            locationBias = {
              circle: { center: { latitude: loc.lat, longitude: loc.lng }, radius: radiusMeters }
            };
          }
        }
      } catch (geoErr) {
        console.error('[/api/search-churches-places] geocode failed', geoErr);
      }
    }

    const allPlaces = [];
    let nextPageToken = null;

    do {
      const body = {
        textQuery,
        maxResultCount: Math.min(20, quantity - allPlaces.length),
        ...(regionCode ? { regionCode } : {}),
        ...(locationBias ? { locationBias } : {}),
        ...(nextPageToken ? { pageToken: nextPageToken } : {})
      };

      const resp = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': PLACES_KEY,
          'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.addressComponents,places.nationalPhoneNumber,places.internationalPhoneNumber,places.websiteUri,nextPageToken'
        },
        body: JSON.stringify(body)
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error?.message || `Google Places API error: ${resp.status}`);
      }

      const data = await resp.json();
      allPlaces.push(...(data.places || []));
      nextPageToken = data.nextPageToken || null;

      if (!nextPageToken || allPlaces.length >= quantity) break;
      // Brief pause between paginated requests to respect API rate limits
      await new Promise(r => setTimeout(r, 100));
    } while (allPlaces.length < quantity);

    // Extract the city (locality) from a Places result's structured address components,
    // falling back through finer-to-coarser admin levels, then to the user-typed location.
    const extractCity = (p) => {
      const comps = Array.isArray(p.addressComponents) ? p.addressComponents : [];
      const byType = (type) => comps.find(c => Array.isArray(c.types) && c.types.includes(type));
      const match = byType('locality')
        || byType('postal_town')
        || byType('administrative_area_level_2')
        || byType('administrative_area_level_1');
      return match?.longText || match?.shortText || location || '';
    };

    // Extract the state/province (administrative_area_level_1) from a Places result.
    // Returns the short code (e.g. "CA", "TX", "ON") when available, otherwise long name.
    const extractState = (p) => {
      const comps = Array.isArray(p.addressComponents) ? p.addressComponents : [];
      const stateComp = comps.find(c => Array.isArray(c.types) && c.types.includes('administrative_area_level_1'));
      return stateComp?.shortText || stateComp?.longText || '';
    };

    // Extract the ISO country code from the Places result so the dial code
    // reflects where the number actually is, not just the searched region.
    const extractCountry = (p) => {
      const comps = Array.isArray(p.addressComponents) ? p.addressComponents : [];
      const comp = comps.find(c => Array.isArray(c.types) && c.types.includes('country'));
      return comp?.shortText || regionCode || '';
    };

    const churches = allPlaces.slice(0, quantity).map((p, i) => {
      const placeCountry = extractCountry(p);
      const { phone, phoneCountryCode } = normalizePhone({
        international: p.internationalPhoneNumber,
        national: p.nationalPhoneNumber,
        regionCode: placeCountry
      });

      return {
        id: `place-${Date.now()}-${i}-${Math.random().toString(36).substr(2, 5)}`,
        name: p.displayName?.text || 'Unknown Organization',
        organizationType: onlyMin ? 'Christian Ministry' : 'Protestant Church',
        address: p.formattedAddress || '',
        city: extractCity(p),
        state: extractState(p),
        country: placeCountry || regionCode,
        website: p.websiteUri || null,
        phone,
        phoneCountryCode,
        email: null,
        pastor: null,
        founded: null,
        congregationSize: null,
        serviceTimes: null,
        description: '',
        facebook: null,
        instagram: null,
        youtube: null,
        confidenceScore: 95,
        sourceEvidence: `Google Places ID: ${p.id}`
      };
    });

    res.json({ churches });
  } catch (err) {
    console.error('[/api/search-churches-places]', err);
    // Fix 4: don't leak raw Google API error messages to the client
    res.status(500).json({ error: 'An internal error occurred.' });
  }
});

// ─── POST /api/summarize-churches-from-places ─────────────────────────────────
// Generates plain-text summaries for Places results using Gemini WITHOUT grounding.
// One batch call for up to 60 churches — no per-query grounding charge.
app.post('/api/summarize-churches-from-places', async (req, res) => {
  try {
    const { churches } = req.body;

    if (!Array.isArray(churches) || churches.length === 0) {
      return res.status(400).json({ error: 'churches must be a non-empty array.' });
    }
    if (churches.length > 60) {
      return res.status(400).json({ error: 'Maximum 60 churches per batch.' });
    }

    const churchList = churches.map((c, i) => {
      const name = sanitize(c.name || '');
      const denom = c.denomination ? sanitize(c.denomination) : '';
      const address = c.address ? sanitize(c.address) : '';
      const website = c.website ? sanitize(c.website) : '';
      return `${i + 1}. "${name}"${denom ? `, ${denom}` : ''}${address ? `, ${address}` : ''}${website ? ` (${website})` : ''}`;
    }).join('\n');

    const result = await callWithRetry(async () => {
      const prompt = `For each church listed below, write exactly one concise 2-sentence description covering its likely identity, tradition, and community role. Use only the details provided — do not invent specifics like pastor names, founding dates, or programs. Return a JSON array of strings, one per church, in the same order as the input list.

Churches:
${churchList}`;

      const response = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.ARRAY,
            items: { type: Type.STRING }
          }
        }
      });

      const summaryArray = JSON.parse(response.text || '[]');
      const summaries = {};
      churches.forEach((c, i) => {
        summaries[c.id] = (Array.isArray(summaryArray) ? summaryArray[i] : '') || '';
      });
      return { summaries };
    });

    res.json(result);
  } catch (err) {
    console.error('[/api/summarize-churches-from-places]', err);
    res.status(500).json({ error: err.message || 'An internal error occurred.' });
  }
});

// ─── POST /api/enrich-churches-from-places ────────────────────────────────────
// Google Places returns no pastor/socials, so enrich verified Places results with a
// GROUNDED Gemini pass (Google Search) that looks up the lead pastor, social URLs, and a
// real description per church.
//
// Grounded calls are slow and lossy, so the work is chunked and each chunk is isolated:
// a chunk that fails, parses badly, or runs past the deadline only costs that chunk. Every
// id we could not enrich comes back in `skipped` so the client can retry just those.
const ENRICH_CHUNK_SIZE = 5;
const ENRICH_CONCURRENCY = 3;
// Vercel caps this function at 60s (vercel.json). Stop starting chunks with enough headroom
// to serialize what we already have instead of getting killed mid-flight and losing all of it.
const ENRICH_DEADLINE_MS = Number(process.env.ENRICH_DEADLINE_MS || 45000);

function buildEnrichPrompt(chunk) {
  const churchList = chunk.map((c, i) => {
    const name = sanitize(c.name || '');
    const address = c.address ? sanitize(c.address) : '';
    const website = c.website ? sanitize(c.website) : '';
    // The known phone lets the model tell us whether THAT line is the WhatsApp one.
    const phone = c.phone ? sanitize(formatPhone(c.phoneCountryCode, c.phone), 40) : '';
    return `${i + 1}. "${name}"${address ? `, ${address}` : ''}${website ? ` (${website})` : ''}${phone ? ` [listed phone: ${phone}]` : ''}`;
  }).join('\n');

  return `For each organization listed below, use Google Search to find publicly available details. Prefer the organization's own website (look at staff/leadership/about pages) and official social media accounts.

Organizations:
${churchList}

For each one, find:
1. pastor — the lead/senior pastor or primary leader's full name, if publicly listed.
2. email — the primary public contact email address (e.g. info@, office@, or a listed staff email), if publicly listed.
3. facebook — the official Facebook page URL.
4. instagram — the official Instagram profile URL.
5. youtube — the official YouTube channel URL.
6. description — a concise 2-sentence description of its identity, tradition, and community role.
7. whatsapp — a phone number that the organization PUBLICLY PRESENTS AS A WHATSAPP CONTACT, in international format (e.g. "+234 803 123 4567").

Rules:
- Use null for any field you cannot verify. NEVER invent or guess names, emails, or URLs.
- Only return an email or social URL that clearly belongs to this specific organization.
- For whatsapp, return a number ONLY when the source explicitly ties it to WhatsApp — a "Chat on WhatsApp" / "WhatsApp us" link (wa.me, api.whatsapp.com, chat.whatsapp.com), a number labelled "WhatsApp" on the site or social profile, or a WhatsApp click-to-chat button. Do NOT assume a number is on WhatsApp because it is a mobile number or because the country commonly uses WhatsApp. If no number is explicitly presented as WhatsApp, return null.
- Return an object for EVERY organization, including ones you found nothing for — use nulls rather than omitting it.
- Keep the objects in the same order as the list.

Each object must use exactly these keys: index, name, pastor, email, facebook, instagram, youtube, description, whatsapp — where "index" is the number from the list above and "name" is the organization name as listed, so the results can be matched back.

Return ONLY a raw JSON array — no markdown, no code fences, no prose.`;
}

// Turn the model's reported WhatsApp number into the fields the client stores.
// The flag describes the number we DISPLAY, so it is only set when the org's
// published WhatsApp line is the same line we already show. When a church has no
// phone at all, the published WhatsApp number becomes its phone.
function resolveWhatsApp(church, reported) {
  const raw = cleanField(reported, 40);
  if (!raw) return { phoneIsWhatsApp: false };

  const { phone, phoneCountryCode } = normalizePhone({
    international: raw,
    national: raw,
    regionCode: church.country
  });
  if (!phone) return { phoneIsWhatsApp: false };

  if (!church.phone) {
    return { phone, phoneCountryCode, phoneIsWhatsApp: true };
  }

  // Compare E.164 digits, not the formatted strings: that drops the national
  // trunk prefix, so a site listing "0803…" still matches a stored "+234 803…".
  const known = toE164Digits(church.phoneCountryCode || phoneCountryCode, church.phone);
  return { phoneIsWhatsApp: sameNumber(known, toE164Digits(phoneCountryCode, phone)) };
}

// Positional matching silently shifts every field onto the wrong church when the model
// drops or reorders an entry, so match on the echoed index/name first.
function alignEnrichments(chunk, items) {
  const byIndex = new Map();
  const byName = new Map();
  chunk.forEach((c, i) => byName.set(normalizeName(c.name), i));

  const leftovers = [];
  items.forEach((item, i) => {
    if (!item || typeof item !== 'object') return;
    const n = Number(item.index);
    let idx = Number.isInteger(n) && n >= 1 && n <= chunk.length ? n - 1 : -1;
    if (idx === -1 && item.name) {
      const named = byName.get(normalizeName(item.name));
      if (named !== undefined) idx = named;
    }
    if (idx === -1) leftovers.push({ item, i });
    else if (!byIndex.has(idx)) byIndex.set(idx, item);
  });

  // Anything the model did not label falls back to its position in the array.
  leftovers.forEach(({ item, i }) => {
    if (i < chunk.length && !byIndex.has(i)) byIndex.set(i, item);
  });

  return byIndex;
}

app.post('/api/enrich-churches-from-places', async (req, res) => {
  try {
    const { churches } = req.body;

    if (!Array.isArray(churches) || churches.length === 0) {
      return res.status(400).json({ error: 'churches must be a non-empty array.' });
    }
    if (churches.length > 60) {
      return res.status(400).json({ error: 'Maximum 60 churches per batch.' });
    }

    const startedAt = Date.now();
    const chunks = [];
    for (let offset = 0; offset < churches.length; offset += ENRICH_CHUNK_SIZE) {
      chunks.push(churches.slice(offset, offset + ENRICH_CHUNK_SIZE));
    }

    const enrichments = {};
    const skipped = [];
    let cursor = 0;

    const runChunk = async (chunk) => {
      const items = await callWithRetry(async () => {
        const response = await ai.models.generateContent({
          model: MODEL_NAME,
          contents: buildEnrichPrompt(chunk),
          config: {
            tools: [{ googleSearch: {} }]
          }
        });
        const parsed = extractJsonObjects(response.text);
        if (!parsed.length) {
          // Unparsable or empty — retry instead of writing a chunk of blanks.
          throw Object.assign(
            new Error('Enrichment response contained no usable JSON.'),
            { retryable: true }
          );
        }
        return parsed;
      });

      const aligned = alignEnrichments(chunk, items);
      chunk.forEach((c, i) => {
        const e = aligned.get(i) || {};
        enrichments[c.id] = {
          pastor: cleanField(e.pastor, 120),
          email: cleanEmail(e.email),
          facebook: cleanUrl(e.facebook, 'facebook.com'),
          instagram: cleanUrl(e.instagram, 'instagram.com'),
          youtube: cleanUrl(e.youtube, 'youtube.com') || cleanUrl(e.youtube, 'youtu.be'),
          description: cleanField(e.description, 1000) || '',
          ...resolveWhatsApp(c, e.whatsapp)
        };
      });
    };

    const worker = async () => {
      while (cursor < chunks.length) {
        const chunk = chunks[cursor++];
        if (Date.now() - startedAt > ENRICH_DEADLINE_MS) {
          skipped.push(...chunk.map(c => c.id));
          continue;
        }
        try {
          await runChunk(chunk);
        } catch (err) {
          // One bad chunk must not discard the chunks that succeeded.
          console.warn('[/api/enrich-churches-from-places] chunk failed:', err.message);
          skipped.push(...chunk.map(c => c.id));
        }
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(ENRICH_CONCURRENCY, chunks.length) }, worker)
    );

    res.json({ enrichments, skipped });
  } catch (err) {
    console.error('[/api/enrich-churches-from-places]', err);
    res.status(500).json({ error: 'An internal error occurred.' });
  }
});

// ─── POST /api/batch-summarize-churches ───────────────────────────────────────
app.post('/api/batch-summarize-churches', async (req, res) => {
  try {
    const { churches, results } = req.body;

    if (!Array.isArray(churches) || churches.length === 0) {
      return res.status(400).json({ error: 'churches must be a non-empty array.' });
    }
    if (!Array.isArray(results) || results.length !== churches.length) {
      return res.status(400).json({ error: 'results must match churches length.' });
    }
    if (churches.length > 50) {
      return res.status(400).json({ error: 'Maximum batch size is 50.' });
    }

    const dataString = churches.map((c, i) => {
      const name = sanitize(c.name || '');
      const orgType = sanitize(c.organizationType || '');
      const summary = sanitize(results[i]?.summary || '');
      return `Organization: ${name}${orgType ? ` (${orgType})` : ''}\nSummary: ${summary}`;
    }).join('\n\n');

    const result = await callWithRetry(async () => {
      const prompt = `Analyze this group of ${churches.length} Christian organizations and provide a collective summary.

Data:
${dataString}

Return:
- globalInsights: A paragraph summarizing common themes, shared values, or patterns across these organizations.
- trends: 3-5 notable trends observed in this group (programs, demographics, community focus, etc.).
- organizationalSpread: A brief description of the type and theological diversity in this group.`;

      const response = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              globalInsights:       { type: Type.STRING },
              trends:               { type: Type.ARRAY, items: { type: Type.STRING } },
              organizationalSpread: { type: Type.STRING }
            },
            required: ['globalInsights', 'trends', 'organizationalSpread']
          }
        }
      });

      return JSON.parse(response.text || '{}');
    });

    res.json(result);
  } catch (err) {
    console.error('[/api/batch-summarize-churches]', err);
    res.status(500).json({ error: 'An internal error occurred.' });
  }
});


// ─── Global JSON error handler (must be last) ────────────────────────────────
// Express 4 default error handler sends text/plain; override so all 4xx/5xx
// errors reach the client as parseable JSON instead of "Internal Server Error".
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  console.error('[express]', err);
  const status = typeof err.status === 'number' ? err.status : 500;
  res.status(status).json({ error: err.message || 'An internal error occurred.' });
});

// ─── Start (local dev only — Vercel handles listening in production) ──────────
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`[server] Proxy server listening on http://localhost:${PORT}`);
  });
}

export default app;
