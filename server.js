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

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Supabase admin client (service role bypasses RLS; auth enforced in requireAuth) ──
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

// Fix 5: Allowlist of fields that may be persisted — blocks arbitrary field injection
const ALLOWED_CHURCH_FIELDS = new Set([
  'id', 'name', 'organizationType', 'address', 'city', 'website', 'phone', 'email',
  'pastor', 'founded', 'congregationSize', 'serviceTimes', 'description',
  'facebook', 'instagram', 'youtube', 'confidenceScore', 'sourceEvidence',
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
const MODEL_NAME = 'gemini-3-flash-preview';

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
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:4173'],
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
      if (isRateLimited || isServerError) {
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

// ─── Auth middleware ──────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    // Fix 2: decode and attach the payload so routes can scope to req.user.sub
    req.user = jwt.verify(token, process.env.SUPABASE_JWT_SECRET, { algorithms: ['HS256'] });
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
  const userId = req.user.sub;
  const { data, error } = await supabaseAdmin
    .from('churches')
    .select('*')
    .eq('userId', userId);
  if (error) return res.status(500).json({ error: 'Failed to load churches.' });
  res.json(data);
});

// ─── GET /api/db/church-names ─────────────────────────────────────────────────
// Returns names for the exclusion list when running a new search.
// Pass ?country=XX to scope results to that country only.
app.get('/api/db/church-names', async (req, res) => {
  const userId = req.user.sub;
  const country = typeof req.query.country === 'string' ? req.query.country.trim().toUpperCase() : null;
  let query = supabaseAdmin.from('churches').select('name, country').eq('userId', userId);
  if (country) query = query.or(`country.is.null,country.ilike.${country}`);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: 'Failed to load church names.' });
  res.json((data || []).map(c => c.name));
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

  const { data, error } = await supabaseAdmin
    .from('churches')
    .upsert(rows, { onConflict: 'userId,name,city', ignoreDuplicates: true })
    .select();
  if (error) return res.status(500).json({ error: 'Failed to save churches.' });

  const { count } = await supabaseAdmin
    .from('churches')
    .select('*', { count: 'exact', head: true })
    .eq('userId', userId);
  res.json({ ok: true, added: (data || []).length, total: count || 0 });
});

// ─── PATCH /api/db/churches/:id ───────────────────────────────────────────────
app.patch('/api/db/churches/:id', async (req, res) => {
  const { id } = req.params;
  const { outreachStatus } = req.body;
  const valid = ['not_contacted', 'contacted', 'responded', 'converted'];
  if (!valid.includes(outreachStatus)) {
    return res.status(400).json({ error: 'Invalid outreachStatus.' });
  }

  const userId = req.user.sub;
  const { data, error } = await supabaseAdmin
    .from('churches')
    .update({ outreachStatus })
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

      Constraint: Return ONLY valid JSON as a flat array of objects. Avoid all hallucinations.`;

      const response = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: prompt,
        config: {
          tools: [{ googleSearch: {} }],
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                companyName: { type: Type.STRING },
                website: { type: Type.STRING },
                address: { type: Type.STRING, nullable: true },
                description: { type: Type.STRING },
                contactName: { type: Type.STRING, nullable: true },
                contactTitle: { type: Type.STRING, nullable: true },
                contactEmail: { type: Type.STRING, nullable: true },
                contactPhone: { type: Type.STRING, nullable: true },
                linkedin: { type: Type.STRING, nullable: true },
                linkedinCompanyPage: { type: Type.STRING, nullable: true },
                twitter: { type: Type.STRING, nullable: true },
                facebook: { type: Type.STRING, nullable: true },
                instagram: { type: Type.STRING, nullable: true },
                tiktok: { type: Type.STRING, nullable: true },
                confidenceScore: { type: Type.NUMBER },
                leadScore: { type: Type.NUMBER },
                sourceEvidence: { type: Type.STRING }
              },
              required: ['companyName', 'website', 'description', 'confidenceScore', 'leadScore']
            }
          }
        }
      });

      const responseText = response.text || '[]';
      const parsed = JSON.parse(responseText);
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

      Output JSON: summary, keyContacts (array), recentNews (array), valueProposition, verifiedOwnerName, verifiedOwnerTitle, verifiedEmail, verifiedPhone, accuracyCheck (brief assessment of data freshness).`;

      const response = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: prompt,
        config: {
          tools: [{ googleSearch: {} }],
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              summary: { type: Type.STRING },
              keyContacts: { type: Type.ARRAY, items: { type: Type.STRING } },
              recentNews: { type: Type.ARRAY, items: { type: Type.STRING } },
              valueProposition: { type: Type.STRING },
              verifiedOwnerName: { type: Type.STRING },
              verifiedOwnerTitle: { type: Type.STRING },
              verifiedEmail: { type: Type.STRING },
              verifiedPhone: { type: Type.STRING },
              accuracyCheck: { type: Type.STRING }
            },
            required: ['summary', 'keyContacts', 'recentNews', 'valueProposition', 'verifiedOwnerName', 'verifiedOwnerTitle', 'verifiedEmail', 'verifiedPhone', 'accuracyCheck']
          }
        }
      });

      return JSON.parse(response.text || '{}');
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

// ─── POST /api/search-churches ───────────────────────────────────────────────
app.post('/api/search-churches', async (req, res) => {
  try {
    let { country, location, includeChurches, includeMinistries, keywords, quantity, excludeList, batchSize } = req.body;

    if (!location) {
      return res.status(400).json({ error: 'location is required.' });
    }
    quantity = Number(quantity);
    batchSize = Number(batchSize);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 200) {
      return res.status(400).json({ error: 'quantity must be an integer between 1 and 200.' });
    }
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 30) {
      return res.status(400).json({ error: 'batchSize must be an integer between 1 and 30.' });
    }

    const onlyMinistries = includeMinistries && !includeChurches;
    const onlyChurches = includeChurches && !includeMinistries;
    const both = includeChurches && includeMinistries;

    country = country ? sanitize(country) : '';
    location = sanitize(location);
    keywords = keywords ? sanitize(keywords) : '';
    excludeList = typeof excludeList === 'string' ? sanitize(excludeList, 2000) : '';

    validatePromptField(location, 'location');
    if (keywords) validatePromptField(keywords, 'keywords');
    // Fix 6: country was missing injection validation
    if (country) validatePromptField(country, 'country');
    // Fix 1: excludeList was missing injection validation
    if (excludeList) validatePromptField(excludeList, 'excludeList');

    const result = await callWithRetry(async () => {
      const locationLine = country
        ? `Location: """${location}""", Country: """${country}"""`
        : `Location: """${location}"""`;

      const keywordsClause = keywords
        ? `Focus / keywords: """${keywords}"""`
        : '';
      const excludeClause = excludeList
        ? `DO NOT include any of these already-found organizations: [${excludeList}].`
        : '';

      const filterLines = [keywordsClause, excludeClause]
        .filter(Boolean)
        .join('\n');

      let prompt;
      if (both) {
        prompt = `Task: Find ${batchSize} real, currently active Christian organizations — a mix of Protestant churches AND Christian ministry organizations (parachurch ministries, nonprofits, mission agencies, youth ministries, food/homeless ministries, counseling centers, campus ministries, etc.) — in the specified location. Use Google Search to verify each organization exists. Try to include a balanced mix of both churches and ministries.

${locationLine}
${filterLines}

Instructions:
1. Verify each organization has an active website, Google listing, or directory entry.
2. Find the lead pastor, executive director, or primary leader name if publicly listed.
3. Include the physical street address, phone number, and website URL.
4. Write a 2-3 sentence description of the organization's identity, mission, and community focus.
5. Include Facebook, Instagram, or YouTube page URLs if found.
6. Set confidenceScore 0-100 based on how much verified data you actually found.
7. In the organizationType field, describe what type of organization this is (e.g. "Baptist Church", "Non-Denominational Church", "Youth Ministry", "Missions Agency", "Food Pantry", "Campus Ministry").
8. NEVER invent or hallucinate addresses, phone numbers, or names. Only report what you find.

Return exactly ${batchSize} objects as a JSON array.`;
      } else if (onlyMinistries) {
        prompt = `Task: Find ${batchSize} real, currently active Christian ministry organizations (parachurch ministries, Christian nonprofits, mission agencies, youth ministries, food/homeless ministries, counseling centers, campus ministries, etc.) in the specified location. Use Google Search to verify each organization exists.

${locationLine}
${filterLines}

Instructions:
1. Search for real ministry organizations — verify each one has an active website, Google listing, or directory entry.
2. Find the executive director, president, or primary leader name if publicly listed.
3. Include the physical street address, phone number, and website URL.
4. Write a 2-3 sentence description of the ministry's mission, focus area, and community impact.
5. Include Facebook, Instagram, or YouTube page URLs if found.
6. Set confidenceScore 0-100 based on how much verified data you actually found.
7. In the organizationType field, describe what type of ministry this is (e.g. "Youth Ministry", "Missions Agency", "Food Pantry", "Campus Ministry", "Counseling Center").
8. NEVER invent or hallucinate addresses, phone numbers, or leader names. Only report what you find.

Return exactly ${batchSize} objects as a JSON array.`;
      } else {
        prompt = `Task: Find ${batchSize} real, currently active Protestant Christian churches in the specified location. Use Google Search to verify each church exists.

${locationLine}
${filterLines}

Instructions:
1. Search for real churches — verify each one has an active website, Google listing, or directory entry.
2. Find the lead pastor or senior pastor name if publicly listed.
3. Include the physical street address, phone number, and website URL.
4. Note congregation size if publicly mentioned anywhere.
5. Note typical service times if listed on their site or Google listing.
6. Write a 2-3 sentence description of the church's identity, worship style, and community focus.
7. Include Facebook, Instagram, or YouTube page URLs if found.
8. Set confidenceScore 0-100 based on how much verified data you actually found (100 = full details confirmed).
9. In the organizationType field, describe the church tradition (e.g. "Baptist Church", "Non-Denominational", "Methodist Church").
10. NEVER invent or hallucinate addresses, phone numbers, or pastor names. Only report what you find.

Return exactly ${batchSize} objects as a JSON array.`;
      }

      const response = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: prompt,
        config: {
          tools: [{ googleSearch: {} }],
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name:             { type: Type.STRING },
                organizationType: { type: Type.STRING },
                address:          { type: Type.STRING },
                city:             { type: Type.STRING },
                website:          { type: Type.STRING, nullable: true },
                phone:            { type: Type.STRING, nullable: true },
                email:            { type: Type.STRING, nullable: true },
                pastor:           { type: Type.STRING, nullable: true },
                founded:          { type: Type.STRING, nullable: true },
                congregationSize: { type: Type.STRING, nullable: true },
                serviceTimes:     { type: Type.STRING, nullable: true },
                description:      { type: Type.STRING },
                facebook:         { type: Type.STRING, nullable: true },
                instagram:        { type: Type.STRING, nullable: true },
                youtube:          { type: Type.STRING, nullable: true },
                confidenceScore:  { type: Type.NUMBER },
                sourceEvidence:   { type: Type.STRING, nullable: true }
              },
              required: ['name', 'organizationType', 'address', 'description', 'confidenceScore']
            }
          }
        }
      });

      const responseText = response.text || '[]';
      const parsed = JSON.parse(responseText);
      const churches = (Array.isArray(parsed) ? parsed : []).map((c, index) => ({
        ...c,
        id: `church-${Date.now()}-${index}-${Math.random().toString(36).substr(2, 5)}`,
        city: c.city || location,
        country: country || null
      }));
      const sources = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
      return { churches, sources };
    });

    res.json(result);
  } catch (err) {
    console.error('[/api/search-churches]', err);
    if (err.status === 400) return res.status(400).json({ error: err.message });
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

Only report verified information. Do not invent details.`;

      const response = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: prompt,
        config: {
          tools: [{ googleSearch: {} }],
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              summary:             { type: Type.STRING },
              history:             { type: Type.STRING },
              ministries:          { type: Type.ARRAY, items: { type: Type.STRING } },
              leadership:          { type: Type.ARRAY, items: { type: Type.STRING } },
              recentNews:          { type: Type.ARRAY, items: { type: Type.STRING } },
              missionStatement:    { type: Type.STRING },
              contactVerification: { type: Type.STRING }
            },
            required: ['summary', 'history', 'ministries', 'leadership', 'recentNews', 'missionStatement', 'contactVerification']
          }
        }
      });

      return JSON.parse(response.text || '{}');
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
    let { location, includeChurches, includeMinistries, quantity } = req.body;

    if (!location) {
      return res.status(400).json({ error: 'location is required.' });
    }

    const PLACES_KEY = process.env.GOOGLE_PLACES_API_KEY;
    if (!PLACES_KEY) {
      return res.status(500).json({ error: 'GOOGLE_PLACES_API_KEY is not configured on the server.' });
    }

    quantity = Math.min(Math.max(Number(quantity) || 20, 1), 60);
    location = sanitize(location);
    validatePromptField(location, 'location');

    const bothTypes = includeChurches && includeMinistries;
    const onlyMin = includeMinistries && !includeChurches;
    const textQuery = bothTypes
      ? `Christian church or ministry organization in ${location}`
      : onlyMin
        ? `Christian ministry nonprofit organization in ${location}`
        : `Protestant Christian church in ${location}`;

    const allPlaces = [];
    let nextPageToken = null;

    do {
      const body = {
        textQuery,
        maxResultCount: Math.min(20, quantity - allPlaces.length),
        ...(nextPageToken ? { pageToken: nextPageToken } : {})
      };

      const resp = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': PLACES_KEY,
          'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.websiteUri,nextPageToken'
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
      await new Promise(r => setTimeout(r, 500));
    } while (allPlaces.length < quantity);

    const churches = allPlaces.slice(0, quantity).map((p, i) => ({
      id: `place-${Date.now()}-${i}-${Math.random().toString(36).substr(2, 5)}`,
      name: p.displayName?.text || 'Unknown Organization',
      organizationType: onlyMin ? 'Christian Ministry' : 'Protestant Church',
      address: p.formattedAddress || '',
      city: location,
      website: p.websiteUri || null,
      phone: p.nationalPhoneNumber || null,
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
    }));

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


// ─── Start (local dev only — Vercel handles listening in production) ──────────
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`[server] Proxy server listening on http://localhost:${PORT}`);
  });
}

export default app;
