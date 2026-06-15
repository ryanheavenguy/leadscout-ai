
import { Church, ChurchSearchParams, ChurchResearch, BatchChurchResearch, OutreachStatus } from '../types';
import { supabase } from '../lib/supabase';
import { COUNTRIES } from '../constants/countries';

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
    const response = await this.authedFetch('/api/db/churches');
    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(err.error || `HTTP ${response.status}`);
    }
    return response.json();
  }

  async saveChurches(churches: Church[]): Promise<{ added: number; total: number }> {
    const response = await this.authedFetch('/api/db/churches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ churches })
    });
    if (!response.ok) throw new Error('Failed to save churches.');
    return response.json();
  }

  async updateOutreachStatus(id: string, outreachStatus: OutreachStatus): Promise<void> {
    const response = await this.authedFetch(`/api/db/churches/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ outreachStatus })
    });
    if (!response.ok) throw new Error('Failed to update status.');
  }

  async deleteChurch(id: string): Promise<void> {
    const response = await this.authedFetch(`/api/db/churches/${id}`, {
      method: 'DELETE'
    });
    if (!response.ok) throw new Error('Failed to delete church.');
  }

  async searchChurchesByLocation(
    params: ChurchSearchParams,
    onProgress?: (percent: number) => void
  ): Promise<{ churches: Church[] }> {
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
        includeChurches: params.includeChurches,
        includeMinistries: params.includeMinistries,
        quantity: params.quantity
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
