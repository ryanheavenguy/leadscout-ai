
import { Church, ChurchSearchParams, ChurchResearch, BatchChurchResearch, OutreachStatus } from '../types';
import { supabase } from '../lib/supabase';
import { COUNTRIES } from '../constants/countries';

// ─── Local dev dummy data ─────────────────────────────────────────────────────
const IS_DEV = import.meta.env.DEV;

const DUMMY_CHURCHES: Church[] = [
  {
    id: 'dummy-1',
    name: 'Grace Community Church',
    organizationType: 'Protestant Church',
    address: '123 Main St, Nashville, TN 37201',
    city: 'Nashville',
    state: 'TN',
    country: 'US',
    website: 'https://gracenashville.org',
    phone: '(615) 555-0101',
    email: 'info@gracenashville.org',
    pastor: 'Pastor John Williams',
    founded: '1984',
    congregationSize: '800–1,200',
    serviceTimes: 'Sun 9:00 AM & 11:00 AM',
    description: 'A vibrant evangelical church committed to gospel-centered preaching, community outreach, and discipleship. Grace Community has served the Nashville area for over 40 years with a heart for missions both locally and globally.',
    facebook: 'https://facebook.com/gracenashville',
    instagram: 'https://instagram.com/gracenashville',
    youtube: 'https://youtube.com/@gracenashville',
    confidenceScore: 97,
    sourceEvidence: '[DEV] Dummy data',
    savedAt: new Date(Date.now() - 1 * 86400000).toISOString(),
    outreachStatus: 'not_contacted',
  },
  {
    id: 'dummy-2',
    name: 'Cornerstone Baptist Church',
    organizationType: 'Protestant Church',
    address: '456 Oak Ave, Franklin, TN 37064',
    city: 'Franklin',
    state: 'TN',
    country: 'US',
    website: 'https://cornerstonefranklin.com',
    phone: '(615) 555-0202',
    email: 'office@cornerstonefranklin.com',
    pastor: 'Rev. Sarah Mitchell',
    founded: '1972',
    congregationSize: '400–600',
    serviceTimes: 'Sun 10:30 AM, Wed 7:00 PM',
    description: 'Cornerstone Baptist is a multigenerational congregation focused on expository Bible teaching, children and youth ministry, and compassionate care for the surrounding Franklin community.',
    facebook: 'https://facebook.com/cornerstonefranklin',
    instagram: null,
    youtube: null,
    confidenceScore: 95,
    sourceEvidence: '[DEV] Dummy data',
    savedAt: new Date(Date.now() - 3 * 86400000).toISOString(),
    outreachStatus: 'contacted',
  },
  {
    id: 'dummy-3',
    name: 'Harvest Fellowship Ministries',
    organizationType: 'Christian Ministry',
    address: '789 Elm Blvd, Brentwood, TN 37027',
    city: 'Brentwood',
    state: 'TN',
    country: 'US',
    website: 'https://harvestfellowship.org',
    phone: '(615) 555-0303',
    email: 'connect@harvestfellowship.org',
    pastor: 'Dr. Marcus Green',
    founded: '2001',
    congregationSize: '1,500–2,500',
    serviceTimes: 'Sat 6:00 PM, Sun 8:30 AM, 10:00 AM & 12:00 PM',
    description: 'Harvest Fellowship is a non-denominational megachurch with a strong emphasis on contemporary worship, small groups, and citywide outreach initiatives including a weekly food pantry serving 300+ families.',
    facebook: 'https://facebook.com/harvestfellowship',
    instagram: 'https://instagram.com/harvestfellowship',
    youtube: 'https://youtube.com/@harvestfellowshiptn',
    confidenceScore: 98,
    sourceEvidence: '[DEV] Dummy data',
    savedAt: new Date(Date.now() - 7 * 86400000).toISOString(),
    outreachStatus: 'responded',
  },
  {
    id: 'dummy-4',
    name: 'St. Andrew\'s Presbyterian Church',
    organizationType: 'Protestant Church',
    address: '321 Church St, Murfreesboro, TN 37130',
    city: 'Murfreesboro',
    state: 'TN',
    country: 'US',
    website: 'https://standrewspca.org',
    phone: '(615) 555-0404',
    email: null,
    pastor: 'Pastor David Kim',
    founded: '1953',
    congregationSize: '200–350',
    serviceTimes: 'Sun 9:00 AM & 11:00 AM',
    description: 'A confessional Presbyterian congregation in the PCA tradition, known for its rich liturgical worship, classical Christian education programs, and deep roots in Rutherford County.',
    facebook: null,
    instagram: null,
    youtube: null,
    confidenceScore: 91,
    sourceEvidence: '[DEV] Dummy data',
    savedAt: new Date(Date.now() - 14 * 86400000).toISOString(),
    outreachStatus: 'converted',
  },
  {
    id: 'dummy-5',
    name: 'New Life Pentecostal Church',
    organizationType: 'Protestant Church',
    address: '555 Revival Rd, Smyrna, TN 37167',
    city: 'Smyrna',
    state: 'TN',
    country: 'US',
    website: 'https://newlifesmyrna.com',
    phone: '(615) 555-0505',
    email: 'info@newlifesmyrna.com',
    pastor: 'Bishop Tanya Brooks',
    founded: '1991',
    congregationSize: '600–900',
    serviceTimes: 'Sun 10:00 AM & 6:00 PM, Fri 7:30 PM',
    description: 'New Life Pentecostal is a Spirit-filled congregation with a passion for prayer, healing, and evangelism. Their Friday night prayer services regularly draw attendees from across Middle Tennessee.',
    facebook: 'https://facebook.com/newlifesmyrna',
    instagram: 'https://instagram.com/newlifesmyrna',
    youtube: null,
    confidenceScore: 93,
    sourceEvidence: '[DEV] Dummy data',
    savedAt: new Date(Date.now() - 10 * 86400000).toISOString(),
    outreachStatus: 'not_contacted',
  },
];

// In-memory state for dev — simulates DB mutations without touching Supabase
let devChurches: Church[] = [...DUMMY_CHURCHES];

const DUMMY_RESEARCH: ChurchResearch = {
  summary: '[DEV] This is a placeholder research summary generated locally. In production this would be a Gemini-powered deep-dive into the church\'s history, theology, and community role.',
  history: '[DEV] Founded in 1984, this church has grown from a small congregation of 50 families into a thriving community of over 1,000 members.',
  ministries: ['Youth Group (grades 6–12)', 'College & Young Adults', 'Food Pantry (weekly)', 'Missions Team', 'Small Groups', 'Worship Arts'],
  leadership: ['Senior Pastor: John Williams', 'Associate Pastor: Emily Torres', 'Worship Director: Mike Johnson', 'Youth Pastor: Chris Nguyen'],
  recentNews: ['Launched new community garden initiative (March 2025)', 'Short-term mission trip to Guatemala (April 2025)', 'Building expansion groundbreaking ceremony (May 2025)'],
  missionStatement: 'To love God, love people, and make disciples who make disciples.',
  contactVerification: '[DEV] Data is placeholder. In production, Gemini would verify contact info freshness via Google Search.',
};

export class ChurchService {
  private sanitizeInput(val: string, maxLen = 300): string {
    return val.trim().replace(/[<>]/g, '').slice(0, maxLen);
  }

  private async authedFetch(url: string, options: RequestInit = {}): Promise<Response> {
    const { data: { session } } = await supabase.auth.getSession();
    return fetch(url, {
      ...options,
      headers: {
        ...(options.headers as Record<string, string> || {}),
        ...(session ? { 'Authorization': `Bearer ${session.access_token}` } : {})
      }
    });
  }

  private async callWithRetry(fn: () => Promise<any>, maxRetries = 3): Promise<any> {
    let lastError: any;
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await fn();
      } catch (error: any) {
        lastError = error;
        const isRateLimited = error.message?.includes('429') || error.status === 429;
        const isServerError = error.message?.includes('500') || error.status === 500;
        if (isRateLimited || isServerError) {
          const waitTime = Math.pow(2, i) * 1000 + Math.random() * 1000;
          await new Promise(resolve => setTimeout(resolve, waitTime));
          continue;
        }
        throw error;
      }
    }
    throw lastError;
  }

  async deepResearch(church: Church): Promise<ChurchResearch> {
    if (IS_DEV) return { ...DUMMY_RESEARCH };
    return this.callWithRetry(async () => {
      const response = await this.authedFetch('/api/research-church', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ church })
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(err.error || err.message || `HTTP ${response.status}`);
      }

      return response.json() as Promise<ChurchResearch>;
    });
  }

  async getSavedChurches(): Promise<Church[]> {
    if (IS_DEV) return [...devChurches];
    const response = await this.authedFetch('/api/db/churches');
    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(err.error || `HTTP ${response.status}`);
    }
    return response.json();
  }

  async saveChurches(churches: Church[]): Promise<{ added: number; total: number }> {
    if (IS_DEV) {
      const before = devChurches.length;
      const toAdd = churches.filter(c => !devChurches.some(d => d.name === c.name && d.city === c.city));
      devChurches = [...devChurches, ...toAdd.map(c => ({ ...c, savedAt: new Date().toISOString(), outreachStatus: 'not_contacted' as OutreachStatus }))];
      return { added: toAdd.length, total: devChurches.length };
    }
    const response = await this.authedFetch('/api/db/churches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ churches })
    });
    if (!response.ok) throw new Error('Failed to save churches.');
    return response.json();
  }

  async updateOutreachStatus(id: string, outreachStatus: OutreachStatus): Promise<void> {
    if (IS_DEV) {
      devChurches = devChurches.map(c => c.id === id ? { ...c, outreachStatus } : c);
      return;
    }
    const response = await this.authedFetch(`/api/db/churches/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ outreachStatus })
    });
    if (!response.ok) throw new Error('Failed to update status.');
  }

  async updateChurch(id: string, patch: Partial<Church>): Promise<void> {
    if (IS_DEV) {
      devChurches = devChurches.map(c => c.id === id ? { ...c, ...patch } : c);
      return;
    }
    const response = await this.authedFetch(`/api/db/churches/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch)
    });
    if (!response.ok) throw new Error('Failed to update church.');
  }

  async deleteChurch(id: string): Promise<void> {
    if (IS_DEV) {
      devChurches = devChurches.filter(c => c.id !== id);
      return;
    }
    const response = await this.authedFetch(`/api/db/churches/${id}`, {
      method: 'DELETE'
    });
    if (!response.ok) throw new Error('Failed to delete church.');
  }

  async searchChurchesByLocation(
    params: ChurchSearchParams,
    onProgress?: (percent: number) => void
  ): Promise<{ churches: Church[] }> {
    if (IS_DEV) {
      if (onProgress) onProgress(20);
      await new Promise(r => setTimeout(r, 600));
      if (onProgress) onProgress(60);
      await new Promise(r => setTimeout(r, 400));
      if (onProgress) onProgress(100);
      return { churches: DUMMY_CHURCHES.map((c, i) => ({ ...c, id: `search-${Date.now()}-${i}` })) };
    }
    if (onProgress) onProgress(20);

    const countryCode = (params.country || '').trim().toUpperCase();
    const countryName = COUNTRIES.find(c => c.code === countryCode)?.name || '';

    const response = await this.authedFetch('/api/search-churches-places', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        country: countryCode,
        countryName,
        location: this.sanitizeInput(params.location || ''),
        radius: params.radius,
        includeChurches: params.includeChurches,
        includeMinistries: params.includeMinistries,
        quantity: params.quantity,
        filterJesus: params.filterJesus ?? true,
        filterEvangelical: params.filterEvangelical ?? true,
        filterChristian: params.filterChristian ?? true
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(err.error || err.message || `HTTP ${response.status}`);
    }

    if (onProgress) onProgress(60);
    const { churches } = await response.json();
    return { churches: churches || [] };
  }

  async summarizeChurchesFromPlaces(churches: Church[]): Promise<Record<string, string>> {
    const response = await this.authedFetch('/api/summarize-churches-from-places', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ churches })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(err.error || err.message || `HTTP ${response.status}`);
    }

    const { summaries } = await response.json();
    return summaries || {};
  }

  async enrichChurchesFromPlaces(
    churches: Church[]
  ): Promise<Record<string, { pastor: string | null; facebook: string | null; instagram: string | null; youtube: string | null; description: string }>> {
    if (IS_DEV) return {};
    const response = await this.authedFetch('/api/enrich-churches-from-places', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ churches })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(err.error || err.message || `HTTP ${response.status}`);
    }

    const { enrichments } = await response.json();
    return enrichments || {};
  }

  async summarizeBatch(
    churches: Church[],
    results: ChurchResearch[]
  ): Promise<Partial<BatchChurchResearch>> {
    if (IS_DEV) return {
      globalInsights: '[DEV] Batch summary placeholder. In production Gemini synthesizes themes across all selected churches.',
      trends: ['Growing youth and young adult programs', 'Increased focus on community food pantries', 'Multisite expansion across suburban areas'],
      organizationalSpread: '[DEV] Mix of Baptist, Pentecostal, Presbyterian, and non-denominational congregations ranging from 200 to 2,500 members.',
    };
    return this.callWithRetry(async () => {
      const response = await this.authedFetch('/api/batch-summarize-churches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ churches, results })
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ message: response.statusText }));
        throw new Error(err.message || `HTTP ${response.status}`);
      }

      return response.json() as Promise<Partial<BatchChurchResearch>>;
    });
  }
}

export const churchService = new ChurchService();
