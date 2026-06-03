
import { Lead, SearchParams, ResearchResult, BatchResearchResult } from "../types";

const BATCH_SIZE = 15; // Smaller batches ensure the model doesn't truncate output

export class GeminiService {

  private sanitizeInput(val: string | undefined | null, maxLen = 300): string {
    return (val ?? '')
      .trim()
      .replace(/[<>]/g, '')
      .slice(0, maxLen);
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
          console.warn(`[GeminiService] Rate limit or server error (Attempt ${i + 1}/${maxRetries}). Retrying in ${Math.round(waitTime)}ms...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
          continue;
        }
        throw error;
      }
    }
    throw lastError;
  }

  /**
   * Performs batched lead generation to reliably meet high-quantity requests.
   */
  async searchLeads(params: SearchParams, onProgress?: (percent: number) => void): Promise<{ leads: Lead[], sources: any[] }> {
    const totalRequested = params.quantity;
    let allLeads: Lead[] = [];
    let allSources: any[] = [];
    let attempts = 0;
    const maxAttempts = Math.ceil(totalRequested / (BATCH_SIZE * 0.8)) + 2; // Allow some buffer

    if (onProgress) onProgress(0);

    while (allLeads.length < totalRequested && attempts < maxAttempts) {
      attempts++;
      const remainingNeeded = totalRequested - allLeads.length;
      const currentBatchSize = Math.min(BATCH_SIZE, remainingNeeded);

      const excludeList = allLeads.map(l => l.companyName).join(", ");

      const { leads: batchLeads, sources: batchSources } = await this.fetchLeadBatch(params, currentBatchSize, excludeList);

      if (batchLeads.length === 0) break; // Model stopped returning leads

      allLeads = [...allLeads, ...batchLeads];
      allSources = [...allSources, ...batchSources];

      const progress = Math.min(Math.round((allLeads.length / totalRequested) * 100), 100);
      if (onProgress) onProgress(progress);

      console.log(`[GeminiService] Progress: ${allLeads.length}/${totalRequested}`);
    }

    if (onProgress) onProgress(100);

    return {
      leads: allLeads.slice(0, totalRequested),
      sources: allSources
    };
  }

  private async fetchLeadBatch(params: SearchParams, batchSize: number, excludeList: string): Promise<{ leads: Lead[], sources: any[] }> {
    return this.callWithRetry(async () => {
      const sanitizedIndustry = this.sanitizeInput(params.industry);
      const sanitizedCity = this.sanitizeInput(params.city);
      const sanitizedKeywords = this.sanitizeInput(params.keywords);
      const sanitizedExcludeList = this.sanitizeInput(excludeList, 2000);

      const response = await fetch('/api/search-leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          industry: sanitizedIndustry,
          city: sanitizedCity,
          keywords: sanitizedKeywords,
          quantity: batchSize,
          excludeList: sanitizedExcludeList,
          batchSize
        })
      });

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({ message: response.statusText }));
        throw new Error(errBody.message || `HTTP error! status: ${response.status}`);
      }

      const { leads: rawLeads, sources } = await response.json();

      const leads: Lead[] = (Array.isArray(rawLeads) ? rawLeads : []).map((l: any, index: number) => ({
        ...l,
        id: `lead-${Date.now()}-${index}-${Math.random().toString(36).substr(2, 5)}`,
        industry: params.industry,
        location: params.city
      }));

      return { leads, sources: sources || [] };
    });
  }

  async deepResearch(lead: Lead): Promise<ResearchResult> {
    return this.callWithRetry(async () => {
      const sanitizedCompanyName = this.sanitizeInput(lead.companyName);
      const sanitizedWebsite = this.sanitizeInput(lead.website);

      const response = await fetch('/api/research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          lead: {
            ...lead,
            companyName: sanitizedCompanyName,
            website: sanitizedWebsite
          }
        })
      });

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({ message: response.statusText }));
        throw new Error(errBody.message || `HTTP error! status: ${response.status}`);
      }

      return response.json() as Promise<ResearchResult>;
    });
  }

  async summarizeBatch(leads: Lead[], results: ResearchResult[]): Promise<Partial<BatchResearchResult>> {
    return this.callWithRetry(async () => {
      const response = await fetch('/api/batch-summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ leads, results })
      });

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({ message: response.statusText }));
        throw new Error(errBody.message || `HTTP error! status: ${response.status}`);
      }

      return response.json() as Promise<Partial<BatchResearchResult>>;
    });
  }
}

export const geminiService = new GeminiService();
