// Deterministic contact extraction from an organization's own website.
//
// Google Places never returns an email, and asking a grounded model to "find the
// email" makes it guess or (more often, given the never-invent rules) return null.
// The church's own contact/staff pages carry the real address, phone, WhatsApp link
// and social handles in plain HTML — so read them directly and only fall back to a
// model for the things that genuinely require reading prose (pastor, description).
//
// Server-only: imported by server.js, never bundled into the client.

const FETCH_TIMEOUT_MS = Number(process.env.SCRAPE_TIMEOUT_MS || 6000);
const MAX_HTML_BYTES = 500_000;
const MAX_SUBPAGES = 3;
const MAX_TEXT_PER_PAGE = 3000;
const MAX_TEXT_TOTAL = 7000;

const UA = 'Mozilla/5.0 (compatible; LeadScoutBot/1.0; contact discovery)';

// ─── Fetching ─────────────────────────────────────────────────────────────────

function toUrl(value) {
  const s = String(value || '').trim();
  if (!s) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(s) ? s : `https://${s.replace(/^\/+/, '')}`);
    return /^https?:$/.test(url.protocol) ? url : null;
  } catch {
    return null;
  }
}

async function fetchHtml(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml' }
    });
    if (!resp.ok) return null;
    if (!/text\/html|application\/xhtml/i.test(resp.headers.get('content-type') || '')) return null;
    const body = await resp.text();
    return { url: resp.url || url, html: body.slice(0, MAX_HTML_BYTES) };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Page discovery ───────────────────────────────────────────────────────────
// The homepage rarely lists staff or a full contact block; the pages that do are
// linked from it under predictable names.
const PAGE_HINTS = [
  [/contact/i, 5],
  [/staff|leadership|our-?team|meet-the|elders|pastors\b|who-we-are/i, 4],
  [/about/i, 2],
  [/connect|visit|plan-your-visit/i, 1],
];

// Articles and sermons routinely contain these words ("…by a Redeemer pastor") and
// carry no contact detail, so they must not outrank the real staff page.
const PAGE_REJECT = /\/(blogs?|news|articles?|posts?|sermons?|series|events?|messages?|media|stor(y|ies)|resources?|devotionals?|videos?|podcasts?|\d{4})(\/|$)/i;

const ANCHOR_RE = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]{0,300}?)<\/a>/gi;

function sameSite(a, b) {
  const strip = (h) => h.toLowerCase().replace(/^www\./, '');
  return strip(a.hostname) === strip(b.hostname);
}

function discoverSubpages(base, html) {
  const scored = new Map();

  for (const match of html.matchAll(ANCHOR_RE)) {
    const href = match[1].trim();
    if (/^(mailto:|tel:|javascript:|#|data:)/i.test(href)) continue;
    if (/\.(pdf|jpe?g|png|gif|svg|zip|mp3|mp4|docx?)($|\?)/i.test(href)) continue;

    let url;
    try { url = new URL(href, base); } catch { continue; }
    if (!/^https?:$/.test(url.protocol) || !sameSite(url, base)) continue;

    url.hash = '';
    const key = url.toString();
    if (key === base.toString()) continue;

    const segments = url.pathname.split('/').filter(Boolean);
    if (segments.length > 3) continue;
    if (PAGE_REJECT.test(url.pathname)) continue;
    // Long slugs are article titles; real contact pages have terse paths.
    if ((segments[segments.length - 1] || '').length > 30) continue;

    const label = `${url.pathname} ${match[2].replace(/<[^>]+>/g, ' ')}`;
    let score = 0;
    for (const [re, weight] of PAGE_HINTS) if (re.test(label)) score += weight;
    if (score === 0) continue;

    scored.set(key, Math.max(scored.get(key) || 0, score));
  }

  const ranked = [...scored.entries()].sort((a, b) => b[1] - a[1]).map(([url]) => url);

  // Sites that hide navigation behind JS yield no anchors at all — guess the
  // conventional paths rather than giving up on the contact page.
  if (ranked.length < 2) {
    for (const path of ['/contact', '/contact-us', '/about']) {
      const guess = new URL(path, base).toString();
      if (!ranked.includes(guess)) ranked.push(guess);
    }
  }

  return ranked.slice(0, MAX_SUBPAGES);
}

// ─── Text extraction ──────────────────────────────────────────────────────────

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', ndash: '–', mdash: '—' };

function decodeEntities(s) {
  return s
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m)
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)));
}

function stripTags(html) {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h[1-6]|tr|section)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t ]+/g, ' ')
    // Markup-heavy pages produce hundreds of empty lines; left in, they eat the
    // whole text budget before any real copy is reached.
    .replace(/[ \n]*\n[ \n]*/g, '\n')
    .trim();
}

// ─── Emails ───────────────────────────────────────────────────────────────────

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,24}/g;
const MAILTO_RE = /mailto:([^"'?>\s]+)/gi;
// "info [at] church [dot] org" and friends — common anti-scrape obfuscation.
const OBFUSCATED_RE = /([A-Za-z0-9._%+-]+)\s*(?:\[at\]|\(at\)|\{at\}|\s+at\s+)\s*([A-Za-z0-9.-]+)\s*(?:\[dot\]|\(dot\)|\{dot\}|\s+dot\s+)\s*([A-Za-z]{2,24})/gi;

// Asset filenames, tracker/CMS boilerplate and templating leftovers all match the
// email shape; none of them are contactable.
const EMAIL_REJECT = [
  /\.(png|jpe?g|gif|webp|svg|css|js|ico|woff2?|ttf)$/i,
  /@(sentry|sentry-next)\b/i,
  /@[^@]*(sentry\.io|wixpress\.com|squarespace\.com|godaddy\.com|wordpress\.(org|com)|schema\.org|example\.(com|org|net)|yourdomain|your-domain|mysite\.com|domain\.com|email\.com|test\.com)$/i,
  /^(no-?reply|do-?not-?reply|donotreply|postmaster|abuse|bounce|mailer-daemon|unsubscribe|sentry)/i,
  /[{}%<>()\[\]\\]/,
  /^[0-9a-f]{16,}@/i, // hashed/tracking addresses
];

// Role addresses a church actually reads, ranked for outreach usefulness.
const ROLE_BOOST = [
  [/^(info|office|contact|hello|admin|church|enquir|inquir|welcome|reception|secretary|mail)/i, 3],
  [/^(connect|pastor|ministr|general|team|support|help)/i, 2],
];
const ROLE_DEMOTE = /^(webmaster|privacy|legal|press|media|careers?|jobs|donate|giving|finance|accounts?|billing|prayer|volunteer|events?|bookings?)/i;

function registrableHost(hostname) {
  return String(hostname || '').toLowerCase().replace(/^www\./, '');
}

/**
 * Rank candidate addresses by how likely they are to reach the office.
 * @param {Map<string, number>} found email → bonus already earned from its source page
 */
function rankEmails(found, siteHost) {
  const host = registrableHost(siteHost);
  const scored = [...found.entries()].map(([email, bonus]) => {
    const [local, domain] = email.split('@');
    let score = bonus;
    if (host && registrableHost(domain) === host) score += 5;
    else if (host && (host.endsWith(registrableHost(domain)) || registrableHost(domain).endsWith(host))) score += 3;
    for (const [re, weight] of ROLE_BOOST) if (re.test(local)) score += weight;
    if (ROLE_DEMOTE.test(local)) score -= 2;
    return { email, score };
  });
  return scored.sort((a, b) => b.score - a.score).map(e => e.email);
}

/**
 * @param {{url: string, html: string, text: string}[]} pages
 */
function collectEmails(pages, siteHost) {
  const found = new Map();

  const add = (raw, bonus) => {
    const value = decodeEntities(String(raw || '')).trim().toLowerCase().replace(/^mailto:/, '').split('?')[0];
    if (!value || !/^[^@\s]+@[^@\s]+\.[a-z]{2,24}$/i.test(value)) return;
    if (EMAIL_REJECT.some(re => re.test(value))) return;
    found.set(value, Math.max(found.get(value) ?? 0, bonus));
  };

  for (const page of pages) {
    // A church with a dozen ministry addresses ("childrens@", "youth@") usually puts
    // the one you should actually write to on the contact page.
    const bonus = /contact|connect/i.test(page.url) ? 4 : 0;
    for (const m of page.html.matchAll(MAILTO_RE)) {
      try { add(decodeURIComponent(m[1]), bonus); } catch { add(m[1], bonus); }
    }
    for (const m of page.text.matchAll(EMAIL_RE)) add(m[0], bonus);
    for (const m of page.text.matchAll(OBFUSCATED_RE)) add(`${m[1]}@${m[2]}.${m[3]}`, bonus);
  }

  return rankEmails(found, siteHost);
}

// ─── Phones & WhatsApp ────────────────────────────────────────────────────────

const TEL_RE = /tel:([+0-9][0-9()\s.\-]{5,25})/gi;
const WA_LINK_RE = /(?:wa\.me|api\.whatsapp\.com\/send|web\.whatsapp\.com\/send)[/?]([^"'\s<>]*)/gi;
// A number sitting next to the word WhatsApp is the org presenting it as such.
const WA_TEXT_RE = /whats\s?-?app[^0-9+]{0,30}(\+?[0-9][0-9()\s.\-]{6,22}[0-9])/gi;

function plausiblePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 15 ? String(raw).trim() : null;
}

function collectPhones(html, text) {
  const tels = [];
  for (const m of html.matchAll(TEL_RE)) {
    const value = plausiblePhone(decodeEntities(m[1]));
    if (value && !tels.includes(value)) tels.push(value);
  }

  const whatsapp = [];
  const addWa = (raw) => {
    const digits = String(raw || '').replace(/\D/g, '');
    if (digits.length < 8 || digits.length > 15) return;
    const value = `+${digits}`;
    if (!whatsapp.includes(value)) whatsapp.push(value);
  };

  for (const m of html.matchAll(WA_LINK_RE)) {
    const tail = m[1] || '';
    // Either "wa.me/<digits>" or "…/send?phone=<digits>".
    const paramMatch = tail.match(/phone=([+0-9]+)/i);
    addWa(paramMatch ? paramMatch[1] : tail.split(/[/?&#]/)[0]);
  }
  for (const m of text.matchAll(WA_TEXT_RE)) {
    const value = plausiblePhone(m[1]);
    // Text numbers are usually national form; keep them raw for region-aware parsing.
    if (value && !whatsapp.includes(value)) whatsapp.push(value);
  }

  return { tels, whatsapp };
}

// ─── Socials ──────────────────────────────────────────────────────────────────

// Reject patterns test the pathname. Pixels, share widgets and individual posts all
// live on the right domain but are not the organization's profile — "facebook.com/tr"
// is the tracking pixel every site embeds, and it would otherwise win every time.
const SOCIAL_PATTERNS = {
  facebook: {
    re: /https?:\/\/(?:[a-z0-9-]+\.)?facebook\.com\/[^"'\s<>]+/gi,
    reject: /^\/(tr|sharer|share|share\.php|dialog|plugins|login|policies|privacy|terms|help|business|ads|events|photo|photos|hashtag|profile\.php|permalink\.php|watch)(\/|$)/i,
  },
  instagram: {
    re: /https?:\/\/(?:[a-z0-9-]+\.)?instagram\.com\/[^"'\s<>]+/gi,
    reject: /^\/(p|reel|reels|tv|explore|stories|accounts|about|developer|legal|directory)(\/|$)/i,
  },
  youtube: {
    re: /https?:\/\/(?:[a-z0-9-]+\.)?(?:youtube\.com|youtu\.be)\/[^"'\s<>]+/gi,
    reject: /^\/(watch|embed|results|shorts|playlist|oembed|redirect|feed|about|howyoutubeworks|t|s)(\/|$)/i,
  },
};

function collectSocials(html) {
  const out = { facebook: null, instagram: null, youtube: null };

  for (const [key, { re, reject }] of Object.entries(SOCIAL_PATTERNS)) {
    for (const m of html.matchAll(re)) {
      const raw = decodeEntities(m[0]).replace(/[.,;)\]}'"]+$/, '');
      let url;
      try { url = new URL(raw); } catch { continue; }
      url.hash = '';
      url.search = '';
      const path = url.pathname.replace(/\/+$/, '');
      if (path.length < 3) continue;             // bare domain, or too short to be a handle
      if (reject.test(url.pathname)) continue;
      out[key] = url.toString();
      break;
    }
  }

  return out;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Fetch an organization's site (homepage + its contact/staff pages) and pull out
 * whatever contact detail is present in the markup.
 *
 * @param {string} websiteUrl
 * @returns {Promise<null | {
 *   url: string, email: string|null, emails: string[], phone: string|null,
 *   whatsapp: string|null, facebook: string|null, instagram: string|null,
 *   youtube: string|null, text: string, pages: string[]
 * }>} null when the site could not be reached at all.
 */
export async function scrapeSite(websiteUrl) {
  const base = toUrl(websiteUrl);
  if (!base) return null;

  let home = await fetchHtml(base.toString());
  if (!home) {
    // A bare apex that refuses connections often serves fine under www (or vice versa).
    const alt = new URL(base.toString());
    alt.hostname = alt.hostname.startsWith('www.') ? alt.hostname.slice(4) : `www.${alt.hostname}`;
    home = await fetchHtml(alt.toString());
  }
  if (!home) return null;

  const homeUrl = new URL(home.url);
  const subpages = discoverSubpages(homeUrl, home.html);
  const fetched = await Promise.all(subpages.map(u => fetchHtml(u)));
  const pages = [home, ...fetched.filter(Boolean)];

  // Email extraction runs over each page's FULL text so a long contact page cannot
  // push its own address past the per-page cap that only exists to bound the prompt.
  const extracted = pages.map(p => ({ url: p.url, html: p.html, text: stripTags(p.html) }));
  const html = pages.map(p => p.html).join('\n');
  const text = extracted.map(p => p.text.slice(0, MAX_TEXT_PER_PAGE)).join('\n\n').slice(0, MAX_TEXT_TOTAL);

  const emails = collectEmails(extracted, homeUrl.hostname);
  const { tels, whatsapp } = collectPhones(html, text);
  const socials = collectSocials(html);

  return {
    url: home.url,
    email: emails[0] || null,
    emails,
    phone: tels[0] || null,
    whatsapp: whatsapp[0] || null,
    ...socials,
    text,
    pages: pages.map(p => p.url),
  };
}
