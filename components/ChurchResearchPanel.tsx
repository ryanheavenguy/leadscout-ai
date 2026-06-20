
import React from 'react';
import { Church, ChurchResearch } from '../types';

interface Props {
  church: Church | null;
  research: ChurchResearch | null;
  loading: boolean;
  onInspect: (church: Church) => void;
}

const ChurchResearchPanel: React.FC<Props> = ({ church, research, loading, onInspect }) => {
  if (!church) return null;

  const websiteUrl = church.website
    ? (church.website.startsWith('http') ? church.website : `https://${church.website}`)
    : null;

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="bg-slate-900 text-white p-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <span className="text-xs font-black uppercase tracking-widest bg-white/10 px-3 py-1 rounded-full">
                {church.denomination}
              </span>
              {church.founded && (
                <span className="text-xs text-slate-400 font-bold">Est. {church.founded}</span>
              )}
              {church.confidenceScore !== undefined && (
                <span className={`text-xs font-black px-2 py-0.5 rounded-full ${
                  church.confidenceScore >= 80
                    ? 'bg-emerald-500/20 text-emerald-300'
                    : church.confidenceScore >= 55
                    ? 'bg-blue-500/20 text-blue-300'
                    : 'bg-amber-500/20 text-amber-300'
                }`}>
                  {church.confidenceScore}% confidence
                </span>
              )}
            </div>
            <h2 className="text-3xl font-black tracking-tight mb-1">{church.name}</h2>
            <p className="text-slate-400 text-sm">{church.address}</p>
          </div>
        </div>

        {/* Quick facts row */}
        <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-4">
          {church.pastor && (
            <div>
              <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-0.5">Pastor</div>
              <div className="text-sm font-bold text-white">{church.pastor}</div>
            </div>
          )}
          {church.phone && (
            <div>
              <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-0.5">Phone</div>
              <a href={`tel:${church.phone}`} className="text-sm font-bold text-white hover:text-blue-300">
                {church.phone}
              </a>
            </div>
          )}
          {church.email && (
            <div>
              <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-0.5">Email</div>
              <a href={`mailto:${church.email}`} className="text-sm font-bold text-white hover:text-blue-300 truncate block">
                {church.email}
              </a>
            </div>
          )}
          {websiteUrl && (
            <div>
              <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-0.5">Website</div>
              <a href={websiteUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-bold text-blue-300 hover:underline truncate block">
                {websiteUrl.replace(/^https?:\/\//, '').split('/')[0]}
              </a>
            </div>
          )}
          {church.congregationSize && (
            <div>
              <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-0.5">Congregation</div>
              <div className="text-sm font-bold text-white">{church.congregationSize}</div>
            </div>
          )}
          {church.serviceTimes && (
            <div>
              <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-0.5">Services</div>
              <div className="text-sm font-bold text-white">{church.serviceTimes}</div>
            </div>
          )}
        </div>

        {/* Description from search */}
        <p className="mt-4 text-slate-300 text-sm leading-relaxed">{church.description}</p>
      </div>

      {/* Research body */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 bg-slate-50">
          <div className="w-12 h-12 border-4 border-slate-900 border-t-transparent rounded-full animate-spin mb-4"></div>
          <p className="text-slate-500 font-bold text-sm uppercase tracking-widest">Researching church...</p>
          <p className="text-slate-400 text-xs mt-1">Searching web for history, ministries, and recent news</p>
        </div>
      ) : research ? (
        <div className="flex flex-col">
          {/* Inspect button in header */}
          <div className="bg-white border-b border-slate-200 px-8 py-4 flex items-center justify-between">
            <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest">Research Results</h3>
            <button
              onClick={() => onInspect(church)}
              className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-black uppercase tracking-widest text-xs px-4 py-2 rounded transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" />
              </svg>
              Re-inspect
            </button>
          </div>
          <div className="p-8 bg-slate-50 grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* Left column */}
            <div className="space-y-6">
              <Section title="Summary">
                <p className="text-sm text-slate-700 leading-relaxed">{research.summary}</p>
              </Section>

              {research.missionStatement && (
                <Section title="Mission Statement">
                  <blockquote className="border-l-4 border-slate-900 pl-4 italic text-sm text-slate-700 leading-relaxed">
                    "{research.missionStatement}"
                  </blockquote>
                </Section>
              )}

              <Section title="History">
                <p className="text-sm text-slate-700 leading-relaxed">{research.history}</p>
              </Section>

              {research.contactVerification && (
                <Section title="Data Freshness">
                  <p className="text-xs text-slate-500 leading-relaxed">{research.contactVerification}</p>
                </Section>
              )}
            </div>

            {/* Right column */}
            <div className="space-y-6">
              {research.leadership.length > 0 && (
                <Section title="Leadership">
                  <ul className="space-y-1">
                    {research.leadership.map((person, i) => (
                      <li key={i} className="text-sm text-slate-700 flex items-start gap-2">
                        <span className="text-slate-400 mt-0.5">•</span>
                        {person}
                      </li>
                    ))}
                  </ul>
                </Section>
              )}

              {research.ministries.length > 0 && (
                <Section title="Ministries & Programs">
                  <div className="flex flex-wrap gap-2">
                    {research.ministries.map((m, i) => (
                      <span key={i} className="text-xs font-bold bg-slate-200 text-slate-700 px-2.5 py-1 rounded-full">
                        {m}
                      </span>
                    ))}
                  </div>
                </Section>
              )}

              {research.recentNews.length > 0 && (
                <Section title="Recent News & Events">
                  <ul className="space-y-2">
                    {research.recentNews.map((item, i) => (
                      <li key={i} className="text-sm text-slate-700 flex items-start gap-2">
                        <span className="text-blue-500 mt-0.5 shrink-0">›</span>
                        {item}
                      </li>
                    ))}
                  </ul>
                </Section>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-20 bg-slate-50 gap-5">
          <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center border border-slate-300">
            <svg className="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" />
            </svg>
          </div>
          <p className="text-slate-500 text-sm text-center max-w-xs">
            Click Inspect to research this {church.denomination ? 'organization' : 'church'} — history, leadership, ministries, and recent news.
          </p>
          <button
            onClick={() => onInspect(church)}
            className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-black uppercase tracking-widest text-xs px-6 py-3 rounded shadow-sm transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" />
            </svg>
            Inspect
          </button>
        </div>
      )}
    </div>
  );
};

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div>
    <h3 className="text-xs font-black text-slate-900 uppercase tracking-widest mb-3 border-b border-slate-200 pb-2">
      {title}
    </h3>
    {children}
  </div>
);

export default ChurchResearchPanel;
