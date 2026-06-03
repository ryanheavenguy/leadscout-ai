
import React from 'react';
import { Lead, BatchResearchResult } from '../types';

interface BatchResearchSummaryProps {
  leads: Lead[];
  batchResult: BatchResearchResult;
}

const BatchResearchSummary: React.FC<BatchResearchSummaryProps> = ({ leads, batchResult }) => {
  return (
    <div className="p-8 bg-white h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto space-y-12">
        <header>
          <div className="flex items-center gap-4 mb-2">
            <span className="bg-blue-600 text-white text-[10px] font-black px-2 py-1 rounded tracking-widest uppercase">
              Cohort Intelligence Report
            </span>
            <span className="text-slate-400 text-sm font-medium">{leads.length} Companies Analyzed</span>
          </div>
          <h1 className="text-4xl font-black text-slate-900 tracking-tight">Market Segment Synthesis</h1>
        </header>

        <section className="bg-slate-900 rounded-3xl p-10 text-white shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 right-0 p-8 opacity-5">
            <svg className="w-64 h-64" fill="currentColor" viewBox="0 0 20 20">
              <path d="M2 11a1 1 0 011-1h2a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1v-5zM8 7a1 1 0 011-1h2a1 1 0 011 1v9a1 1 0 01-1 1H9a1 1 0 01-1-1V7zM14 4a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1h-2a1 1 0 01-1-1V4z" />
            </svg>
          </div>
          <div className="relative z-10">
            <h2 className="text-blue-400 text-xs font-black uppercase tracking-widest mb-4">Global Insights</h2>
            <p className="text-2xl font-medium leading-relaxed italic text-blue-50">
              "{batchResult.globalInsights}"
            </p>
          </div>
        </section>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
          <section className="bg-slate-50 p-8 rounded-3xl border border-slate-200">
            <h3 className="text-slate-900 text-sm font-black uppercase tracking-widest mb-6 flex items-center gap-2">
              <svg className="w-5 h-5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
              </svg>
              Observed Market Trends
            </h3>
            <ul className="space-y-4">
              {batchResult.marketTrends.map((trend, i) => (
                <li key={i} className="flex items-start gap-4 text-slate-700 font-medium">
                  <span className="w-6 h-6 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">{i+1}</span>
                  {trend}
                </li>
              ))}
            </ul>
          </section>

          <section className="bg-slate-50 p-8 rounded-3xl border border-slate-200">
            <h3 className="text-slate-900 text-sm font-black uppercase tracking-widest mb-6 flex items-center gap-2">
              <svg className="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
              Competitive Landscape
            </h3>
            <p className="text-slate-700 leading-relaxed font-medium">
              {batchResult.competitiveLandscape}
            </p>
          </section>
        </div>

        <section>
          <h3 className="text-slate-900 text-sm font-black uppercase tracking-widest mb-8 border-b border-slate-200 pb-4">Individual Company Deep-Dives</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {leads.map(lead => {
              const res = batchResult.individualInsights[lead.id];
              return (
                <div key={lead.id} className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm hover:shadow-md transition-shadow flex flex-col h-full">
                  <div className="flex items-center justify-between mb-4">
                    <h4 className="font-black text-slate-900 truncate">{lead.companyName}</h4>
                    <span className="text-[10px] bg-blue-50 text-blue-600 font-black px-1.5 py-0.5 rounded border border-blue-100">
                      {lead.confidenceScore}%
                    </span>
                  </div>
                  <p className="text-sm text-slate-600 line-clamp-3 mb-4 flex-1 italic">
                    "{res?.summary}"
                  </p>
                  <div className="space-y-2 pt-4 border-t border-slate-100">
                    <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest">Key Pitch Angle</p>
                    <p className="text-xs text-slate-800 font-bold line-clamp-2">{res?.valueProposition}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
};

export default BatchResearchSummary;
