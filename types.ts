
export type OutreachStatus = 'not_contacted' | 'contacted' | 'responded' | 'converted';

export interface Church {
  id: string;
  name: string;
  organizationType?: string;
  address: string;
  city: string;
  website?: string;
  phone?: string;
  email?: string;
  pastor?: string;
  founded?: string;
  congregationSize?: string;
  serviceTimes?: string;
  description: string;
  facebook?: string;
  instagram?: string;
  youtube?: string;
  confidenceScore?: number;
  sourceEvidence?: string;
  savedAt?: string;
  outreachStatus?: OutreachStatus;
}

export interface ChurchSearchParams {
  country: string;
  location?: string;
  includeChurches: boolean;
  includeMinistries: boolean;
  keywords: string;
  quantity: number;
}

export interface ChurchResearch {
  summary: string;
  history: string;
  ministries: string[];
  leadership: string[];
  recentNews: string[];
  missionStatement: string;
  contactVerification: string;
}

export interface BatchChurchResearch {
  globalInsights: string;
  trends: string[];
  organizationalSpread: string;
  individualInsights: Record<string, ChurchResearch>;
}

export enum AppStatus {
  IDLE = 'IDLE',
  SEARCHING = 'SEARCHING',
  RESEARCHING = 'RESEARCHING',
  ERROR = 'ERROR'
}

export type ViewMode = 'GRID' | 'DETAIL' | 'BATCH_SUMMARY';
