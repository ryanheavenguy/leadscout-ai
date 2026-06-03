
import { Church, ChurchSearchParams, ChurchResearch, BatchChurchResearch, OutreachStatus } from '../types';

const BATCH_SIZE = 10;

export class ChurchService {
  private sanitizeInput(val: string, maxLen = 300): string {
    return val.trim().replace(/[<>]/g, '').slice(0, maxLen);
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

  async searchChurches(
    params: ChurchSearchParams,
    onProgress?: (percent: number) => void,
    preExcludeNames: string[] = []
  ): Promise<{ churches: Church[]; sources: any[] }> {
    const totalRequested = params.quantity;
    let allChurches: Church[] = [];
    let allSources: any[] = [];
    let attempts = 0;
    const maxAttempts = Math.ceil(totalRequested / (BATCH_SIZE * 0.8)) + 2;

    if (onProgress) onProgress(0);

    while (allChurches.length < totalRequested && attempts < maxAttempts) {
      attempts++;
      const remaining = totalRequested - allChurches.length;
      const currentBatch = Math.min(BATCH_SIZE, remaining);
      // Combine names found so far in this session + names from DB
      const excludeList = [...preExcludeNames, ...allChurches.map(c => c.name)].join(', ');

      const { churches: batch, sources: batchSources } = await this.fetchBatch(
        params, currentBatch, excludeList
      );

      if (batch.length === 0) break;

      allChurches = [...allChurches, ...batch];
      allSources = [...allSources, ...batchSources];

      const progress = Math.min(Math.round((allChurches.length / totalRequested) * 100), 100);
      if (onProgress) onProgress(progress);
    }

    if (onProgress) onProgress(100);

    return {
      churches: allChurches.slice(0, totalRequested),
      sources: allSources
    };
  }

  private async fetchBatch(
    params: ChurchSearchParams,
    batchSize: number,
    excludeList: string
  ): Promise<{ churches: Church[]; sources: any[] }> {
    return this.callWithRetry(async () => {
      const response = await fetch('/api/search-churches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          country: this.sanitizeInput(params.country),
          location: this.sanitizeInput(params.location),
          denomination: this.sanitizeInput(params.denomination),
          congregationSize: this.sanitizeInput(params.congregationSize),
          churchAge: this.sanitizeInput(params.churchAge),
          serviceStyle: this.sanitizeInput(params.serviceStyle),
          keywords: this.sanitizeInput(params.keywords),
          quantity: batchSize,
          excludeList: this.sanitizeInput(excludeList, 2000),
          batchSize
        })
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ message: response.statusText }));
        throw new Error(err.message || `HTTP ${response.status}`);
      }

      const { churches: raw, sources } = await response.json();
      const churches: Church[] = (Array.isArray(raw) ? raw : []).map((c: any, i: number) => ({
        ...c,
        id: `church-${Date.now()}-${i}-${Math.random().toString(36).substr(2, 5)}`
      }));
      return { churches, sources: sources || [] };
    });
  }

  async deepResearch(church: Church): Promise<ChurchResearch> {
    return this.callWithRetry(async () => {
      const response = await fetch('/api/research-church', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ church })
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ message: response.statusText }));
        throw new Error(err.message || `HTTP ${response.status}`);
      }

      return response.json() as Promise<ChurchResearch>;
    });
  }

  async getSavedChurchNames(): Promise<string[]> {
    try {
      const response = await fetch('/api/db/church-names', { credentials: 'include' });
      if (!response.ok) return [];
      return response.json();
    } catch { return []; }
  }

  async getSavedChurches(): Promise<Church[]> {
    const response = await fetch('/api/db/churches', { credentials: 'include' });
    if (!response.ok) throw new Error('Failed to load database.');
    return response.json();
  }

  async saveChurches(churches: Church[]): Promise<{ added: number; total: number }> {
    const response = await fetch('/api/db/churches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ churches })
    });
    if (!response.ok) throw new Error('Failed to save churches.');
    return response.json();
  }

  async updateOutreachStatus(id: string, outreachStatus: OutreachStatus): Promise<void> {
    const response = await fetch(`/api/db/churches/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ outreachStatus })
    });
    if (!response.ok) throw new Error('Failed to update status.');
  }

  async deleteChurch(id: string): Promise<void> {
    const response = await fetch(`/api/db/churches/${id}`, {
      method: 'DELETE',
      credentials: 'include'
    });
    if (!response.ok) throw new Error('Failed to delete church.');
  }

  async searchChurchesByLocation(
    params: ChurchSearchParams,
    onProgress?: (percent: number) => void
  ): Promise<{ churches: Church[] }> {
    if (onProgress) onProgress(20);

    const response = await fetch('/api/search-churches-places', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        location: this.sanitizeInput(params.location),
        denomination: this.sanitizeInput(params.denomination),
        quantity: params.quantity
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ message: response.statusText }));
      throw new Error(err.message || `HTTP ${response.status}`);
    }

    if (onProgress) onProgress(60);
    const { churches } = await response.json();
    return { churches: churches || [] };
  }

  async summarizeChurchesFromPlaces(churches: Church[]): Promise<Record<string, string>> {
    const response = await fetch('/api/summarize-churches-from-places', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ churches })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ message: response.statusText }));
      throw new Error(err.message || `HTTP ${response.status}`);
    }

    const { summaries } = await response.json();
    return summaries || {};
  }

  async summarizeBatch(
    churches: Church[],
    results: ChurchResearch[]
  ): Promise<Partial<BatchChurchResearch>> {
    return this.callWithRetry(async () => {
      const response = await fetch('/api/batch-summarize-churches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
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
