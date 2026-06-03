'use strict';

require('dotenv').config();

const express = require('express');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const helmet = require('helmet');
const session = require('express-session');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { GoogleGenAI, Type } = require('@google/genai');

// ─── Simple JSON file database ────────────────────────────────────────────────
const DB_PATH = path.join(__dirname, 'churches-db.json');

function readDb() {
  try {
    if (!fs.existsSync(DB_PATH)) return [];
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch { return []; }
}

function writeDb(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
}

const app = express();
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

// ─── Session ──────────────────────────────────────────────────────────────────
if (!process.env.SESSION_SECRET) {
  console.error('[server] FATAL: SESSION_SECRET environment variable is not set. Set it in your .env file.');
  process.exit(1);
}

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 8 * 60 * 60 * 1000 // 8 hours
  }
}));

// ─── CORS (credentials: true so session cookie is forwarded through Vite proxy)
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:4173'],
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type'],
  credentials: true
}));

app.use(express.json());

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
  if (req.session?.authenticated) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

// ─── Public routes (must be defined before the requireAuth middleware) ────────
app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const envUser = process.env.APP_USERNAME;
  const envPass = process.env.APP_PASSWORD;

  if (!envUser || !envPass) {
    return res.status(500).json({ error: 'Authentication not configured on server.' });
  }

  const usernameMatch = typeof username === 'string' &&
    username.trim().toLowerCase() === envUser.toLowerCase();
  const passwordMatch = typeof password === 'string' &&
    password.length === envPass.length &&
    crypto.timingSafeEqual(Buffer.from(password.trim()), Buffer.from(envPass));

  if (usernameMatch && passwordMatch) {
    req.session.authenticated = true;
    req.session.username = username.trim();
    return res.json({ ok: true, username: username.trim() });
  }

  res.status(401).json({ error: 'Invalid username or password.' });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', (req, res) => {
  if (req.session?.authenticated) {
    return res.json({ authenticated: true, username: req.session.username });
  }
  res.json({ authenticated: false });
});

// ─── Auth guard for all remaining /api routes ─────────────────────────────────
app.use('/api', requireAuth);

// ─── GET /api/db/churches ─────────────────────────────────────────────────────
app.get('/api/db/churches', (req, res) => {
  res.json(readDb());
});

// ─── GET /api/db/church-names ─────────────────────────────────────────────────
// Returns just names for the exclusion list when running a new search
app.get('/api/db/church-names', (req, res) => {
  const db = readDb();
  res.json(db.map(c => c.name));
});

// ─── POST /api/db/churches ────────────────────────────────────────────────────
// Saves churches to the DB; skips duplicates (matched by name + city)
app.post('/api/db/churches', (req, res) => {
  const { churches } = req.body;
  if (!Array.isArray(churches) || churches.length === 0) {
    return res.status(400).json({ error: 'churches must be a non-empty array.' });
  }
  if (churches.length > 200) {
    return res.status(400).json({ error: 'Maximum 200 churches per save.' });
  }

  const db = readDb();
  let added = 0;
  for (const church of churches) {
    if (!church || typeof church.name !== 'string') continue;
    const key = `${church.name.toLowerCase().trim()}|${(church.city || '').toLowerCase().trim()}`;
    const exists = db.some(c =>
      `${c.name.toLowerCase().trim()}|${(c.city || '').toLowerCase().trim()}` === key
    );
    if (!exists) {
      db.push({
        ...church,
        savedAt: new Date().toISOString(),
        outreachStatus: 'not_contacted'
      });
      added++;
    }
  }
  writeDb(db);
  res.json({ ok: true, added, total: db.length });
});

// ─── PATCH /api/db/churches/:id ───────────────────────────────────────────────
app.patch('/api/db/churches/:id', (req, res) => {
  const { id } = req.params;
  const { outreachStatus } = req.body;
  const valid = ['not_contacted', 'contacted', 'responded', 'converted'];
  if (!valid.includes(outreachStatus)) {
    return res.status(400).json({ error: 'Invalid outreachStatus.' });
  }

  const db = readDb();
  const idx = db.findIndex(c => c.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Church not found.' });
  db[idx].outreachStatus = outreachStatus;
  writeDb(db);
  res.json({ ok: true });
});

// ─── DELETE /api/db/churches/:id ─────────────────────────────────────────────
app.delete('/api/db/churches/:id', (req, res) => {
  const { id } = req.params;
  const db = readDb();
  const idx = db.findIndex(c => c.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Church not found.' });
  db.splice(idx, 1);
  writeDb(db);
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
    let { country, location, denomination, congregationSize, churchAge, serviceStyle, keywords, quantity, excludeList, batchSize } = req.body;

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

    country = country ? sanitize(country) : '';
    location = sanitize(location);
    denomination = denomination ? sanitize(denomination) : '';
    congregationSize = congregationSize ? sanitize(congregationSize) : '';
    churchAge = churchAge ? sanitize(churchAge) : '';
    serviceStyle = serviceStyle ? sanitize(serviceStyle) : '';
    keywords = keywords ? sanitize(keywords) : '';
    excludeList = typeof excludeList === 'string' ? sanitize(excludeList, 2000) : '';

    validatePromptField(location, 'location');
    if (denomination) validatePromptField(denomination, 'denomination');
    if (congregationSize) validatePromptField(congregationSize, 'congregationSize');
    if (churchAge) validatePromptField(churchAge, 'churchAge');
    if (serviceStyle) validatePromptField(serviceStyle, 'serviceStyle');
    if (keywords) validatePromptField(keywords, 'keywords');

    const result = await callWithRetry(async () => {
      const excludeClause = excludeList
        ? `DO NOT include any of these already-found churches: [${excludeList}].`
        : '';

      const locationLine = country
        ? `Location: """${location}""", Country: """${country}"""`
        : `Location: """${location}"""`;

      const isAnyDenom = !denomination || denomination === 'Any Protestant';
      const denomClause = isAnyDenom
        ? `Denomination: Any Protestant denomination (exclude Catholic and Orthodox)`
        : `Denomination or tradition: """${denomination}"""`;

      const sizeClause = congregationSize && congregationSize !== 'Any Size'
        ? `Congregation size: """${congregationSize}"""`
        : '';
      const ageClause = churchAge && churchAge !== 'Any Age'
        ? `Church age / founding era: """${churchAge}"""`
        : '';
      const styleClause = serviceStyle && serviceStyle !== 'Any Style'
        ? `Service style: """${serviceStyle}"""`
        : '';
      const keywordsClause = keywords
        ? `Additional filters/focus: """${keywords}"""`
        : '';

      const filterLines = [denomClause, sizeClause, ageClause, styleClause, keywordsClause, excludeClause]
        .filter(Boolean)
        .join('\n');

      const prompt = `Task: Find ${batchSize} real, currently active Protestant Christian churches in the specified location. Use Google Search to verify each church exists.

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
9. NEVER invent or hallucinate addresses, phone numbers, or pastor names. Only report what you find.

Return exactly ${batchSize} objects as a JSON array.`;

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
                denomination:     { type: Type.STRING },
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
              required: ['name', 'denomination', 'address', 'description', 'confidenceScore']
            }
          }
        }
      });

      const responseText = response.text || '[]';
      const parsed = JSON.parse(responseText);
      const churches = (Array.isArray(parsed) ? parsed : []).map((c, index) => ({
        ...c,
        id: `church-${Date.now()}-${index}-${Math.random().toString(36).substr(2, 5)}`,
        city: c.city || location
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
    let { location, denomination, quantity } = req.body;

    if (!location) {
      return res.status(400).json({ error: 'location is required.' });
    }

    const PLACES_KEY = process.env.GOOGLE_PLACES_API_KEY;
    if (!PLACES_KEY) {
      return res.status(500).json({ error: 'GOOGLE_PLACES_API_KEY is not configured on the server.' });
    }

    quantity = Math.min(Math.max(Number(quantity) || 20, 1), 60);
    location = sanitize(location);
    denomination = denomination ? sanitize(denomination) : '';
    validatePromptField(location, 'location');

    const denomTerm = denomination && denomination !== 'Any Protestant' ? denomination : 'Protestant Christian';
    const textQuery = `${denomTerm} church in ${location}`;

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
      name: p.displayName?.text || 'Unknown Church',
      denomination: denomination && denomination !== 'Any Protestant' ? denomination : 'Protestant',
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
    res.status(500).json({ error: err.message || 'An internal error occurred.' });
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
      const denom = sanitize(c.denomination || '');
      const summary = sanitize(results[i]?.summary || '');
      return `Church: ${name} (${denom})\nSummary: ${summary}`;
    }).join('\n\n');

    const result = await callWithRetry(async () => {
      const prompt = `Analyze this group of ${churches.length} churches and provide a collective summary.

Data:
${dataString}

Return:
- globalInsights: A paragraph summarizing common themes, shared values, or patterns across these churches.
- trends: 3-5 notable trends observed in this group (worship styles, community programs, demographics, etc.).
- denominationalSpread: A brief description of the denominational or theological diversity in this group.`;

      const response = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              globalInsights:      { type: Type.STRING },
              trends:              { type: Type.ARRAY, items: { type: Type.STRING } },
              denominationalSpread: { type: Type.STRING }
            },
            required: ['globalInsights', 'trends', 'denominationalSpread']
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


// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[server] Proxy server listening on http://localhost:${PORT}`);
});
