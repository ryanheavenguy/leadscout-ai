
import React from 'react';
import { Lead, ResearchResult } from '../types';

interface ResearchPanelProps {
  lead: Lead | null;
  research: ResearchResult | null;
  loading: boolean;
}

const ResearchPanel: React.FC<ResearchPanelProps> = ({ lead, research, loading }) => {
  if (!lead) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-slate-400 p-8 text-center">
        <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-4">
          <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        </div>
        <p className="text-lg font-medium">Select a lead to see AI insights</p>
        <p className="text-sm">We'll perform deep research using real-time search</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-8 space-y-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-slate-200 rounded w-1/3"></div>
          <div className="h-4 bg-slate-200 rounded w-full"></div>
          <div className="h-4 bg-slate-200 rounded w-full"></div>
          <div className="h-4 bg-slate-200 rounded w-3/4"></div>
          <div className="h-48 bg-slate-100 rounded-2xl mt-8"></div>
        </div>
        <div className="flex flex-col items-center py-10">
          <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-4"></div>
          <p className="text-slate-600 font-bold text-lg">Verifying with active business records...</p>
          <p className="text-slate-400 text-sm">Cross-referencing domain, LinkedIn, and social presence</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 overflow-y-auto h-full bg-white">
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-3xl font-extrabold text-slate-900 tracking-tight">{lead.companyName}</h2>
            {lead.confidenceScore && (
              <span className="bg-slate-900 text-white text-[10px] px-2 py-1 rounded font-black tracking-widest uppercase">
                {lead.confidenceScore}% ACCURACY
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-2">
            <a
              href={lead.website.startsWith('http') ? lead.website : `https://${lead.website}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:text-blue-700 font-bold text-base flex items-center gap-1"
            >
              {lead.website.replace(/^https?:\/\//, '')}
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
            <span className="text-slate-300">|</span>
            <span className="text-slate-600 text-base font-bold">{lead.location}</span>
          </div>
          
          <div className="flex items-center gap-3 mt-4 flex-wrap">
             {lead.linkedin && (
                <a href={lead.linkedin} title="Contact Person LinkedIn" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 rounded-lg text-blue-700 font-bold text-sm hover:bg-blue-50">
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z"/></svg>
                  Personal
                </a>
             )}
             {lead.linkedinCompanyPage && (
                <a href={lead.linkedinCompanyPage} title="Official Company LinkedIn" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 rounded-lg text-blue-500 font-bold text-sm hover:bg-blue-50">
                   <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M18.333 3h-12.666c-1.47 0-2.667 1.197-2.667 2.667v12.666c0 1.47 1.197 2.667 2.667 2.667h12.666c1.47 0 2.667-1.197 2.667-2.667v-12.666c0-1.47-1.197-2.667-2.667-2.667zm-9.333 13h-2v-6h2v6zm-1-6.891c-.642 0-1.163-.52-1.163-1.162 0-.642.521-1.162 1.163-1.162.641 0 1.162.52 1.162 1.162 0 .642-.521 1.162-1.162 1.162zm8.333 6.891h-2v-3.085c0-.735-.014-1.681-1.025-1.681-1.026 0-1.182.801-1.182 1.628v3.138h-2v-6h1.92v.821h.027c.267-.506.919-1.039 1.892-1.039 2.022 0 2.396 1.332 2.396 3.063v3.155z"/></svg>
                  Company
                </a>
             )}
             {lead.twitter && (
                <a href={lead.twitter} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 rounded-lg text-slate-900 font-bold text-sm hover:bg-slate-200">
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                  Twitter
                </a>
             )}
             {lead.facebook && (
                <a href={lead.facebook} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 rounded-lg text-blue-600 font-bold text-sm hover:bg-blue-50">
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
                  Facebook
                </a>
             )}
             {lead.instagram && (
                <a href={lead.instagram} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 rounded-lg text-pink-600 font-bold text-sm hover:bg-pink-50">
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/></svg>
                  Instagram
                </a>
             )}
             {lead.tiktok && (
                <a href={lead.tiktok} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 rounded-lg text-black font-bold text-sm hover:bg-slate-200">
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12.525.02c1.31 0 2.591.21 3.791.63V4.93c-1.14-.36-2.31-.54-3.51-.54-3.14 0-5.69 2.55-5.69 5.69s2.55 5.69 5.69 5.69c1.07 0 2.08-.31 2.94-.84v-5.22c.81.56 1.79.88 2.85.88 2.77 0 5.01-2.24 5.01-5.01V0h-3.41c0 2.15-1.74 3.9-3.9 3.9v-3.88c-.64-.13-1.3-.19-1.98-.19-4.88 0-8.83 3.95-8.83 8.83s3.95 8.83 8.83 8.83 8.83-3.95 8.83-8.83h-2.11c0 3.71-3.01 6.72-6.72 6.72s-6.72-3.01-6.72-6.72 3.01-6.72 6.72-6.72c1.24 0 2.4.34 3.4.92V.02h-2.11z"/></svg>
                  TikTok
                </a>
             )}
          </div>
        </div>
        <div className="flex gap-2">
          <button className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-6 py-3 rounded-xl font-bold transition-all text-sm uppercase tracking-widest border border-slate-300">
            Save Draft
          </button>
        </div>
      </div>

      {research && (
        <div className="space-y-10 pb-20">
          {/* Data Freshness Alert */}
          {research.accuracyCheck && (
            <div className="bg-indigo-50 border border-indigo-100 p-4 rounded-xl flex items-start gap-3">
              <svg className="w-5 h-5 text-indigo-600 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div>
                <p className="text-xs font-black text-indigo-900 uppercase tracking-widest mb-1">AI Accuracy Assessment</p>
                <p className="text-sm text-indigo-700 font-medium">{research.accuracyCheck}</p>
                {lead.sourceEvidence && (
                  <p className="text-[10px] text-indigo-500 mt-2 italic">Evidence: {lead.sourceEvidence}</p>
                )}
              </div>
            </div>
          )}

          {/* Verified Contact Card */}
          <section className="bg-slate-900 rounded-2xl p-8 text-white shadow-2xl relative overflow-hidden">
            <div className="absolute top-0 right-0 p-4 opacity-10">
              <svg className="w-32 h-32" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" /></svg>
            </div>
            
            <h3 className="text-xs font-black uppercase tracking-widest text-blue-400 mb-6 flex items-center gap-2">
              <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></span>
              Verified Decision Maker Details
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 relative z-10">
              <div className="space-y-2">
                <p className="text-slate-400 text-xs font-bold uppercase tracking-widest">Primary Contact / Owner</p>
                <div className="flex flex-col">
                  <p className="text-2xl font-black text-white">{research.verifiedOwnerName || lead.contactName || 'Not Found'}</p>
                  <p className="text-blue-400 text-sm font-bold uppercase tracking-tight">
                    {research.verifiedOwnerTitle || lead.contactTitle || 'Title Not Verified'}
                  </p>
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-slate-400 text-xs font-bold uppercase tracking-widest">Direct Email</p>
                {research.verifiedEmail || lead.contactEmail ? (
                  <a href={`mailto:${research.verifiedEmail || lead.contactEmail}`} className="text-xl font-bold text-blue-300 hover:text-blue-200 truncate block">
                    {research.verifiedEmail || lead.contactEmail}
                  </a>
                ) : (
                  <p className="text-xl font-bold text-slate-500 italic">Not Disclosed</p>
                )}
              </div>
              <div className="space-y-2">
                <p className="text-slate-400 text-xs font-bold uppercase tracking-widest">Phone Number</p>
                {research.verifiedPhone || lead.contactPhone ? (
                  <a href={`tel:${research.verifiedPhone || lead.contactPhone}`} className="text-xl font-bold text-green-400 hover:text-green-300 truncate block">
                    {research.verifiedPhone || lead.contactPhone}
                  </a>
                ) : (
                  <p className="text-xl font-bold text-slate-500 italic">Not Disclosed</p>
                )}
              </div>
            </div>
          </section>

          <section>
            <h3 className="text-xs font-black uppercase tracking-widest text-slate-400 mb-4">Strategic Business Summary</h3>
            <p className="text-slate-800 leading-relaxed text-xl font-medium">{research.summary}</p>
          </section>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <section className="bg-slate-50 p-8 rounded-2xl border border-slate-200 shadow-sm">
              <h3 className="text-xs font-black uppercase tracking-widest text-slate-500 mb-6 flex items-center gap-2">
                <svg className="w-4 h-4 text-blue-500" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
                </svg>
                Organizational Structure
              </h3>
              <ul className="space-y-4">
                {research.keyContacts.map((contact, i) => (
                  <li key={i} className="text-slate-800 flex items-start gap-3 text-base font-medium leading-snug">
                    <span className="w-2 h-2 bg-blue-400 rounded-full mt-2 shrink-0"></span> {contact}
                  </li>
                ))}
              </ul>
            </section>

            <section className="bg-slate-50 p-8 rounded-2xl border border-slate-200 shadow-sm">
              <h3 className="text-xs font-black uppercase tracking-widest text-slate-500 mb-6 flex items-center gap-2">
                <svg className="w-4 h-4 text-amber-500" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
                </svg>
                Market Intelligence
              </h3>
              <ul className="space-y-4">
                {research.recentNews.map((news, i) => (
                  <li key={i} className="text-slate-800 flex items-start gap-3 text-base italic leading-snug">
                    <span className="w-2 h-2 bg-amber-400 rounded-full mt-2 shrink-0"></span> {news}
                  </li>
                ))}
              </ul>
            </section>
          </div>

          <section className="bg-gradient-to-br from-blue-50 via-indigo-50 to-white p-10 rounded-3xl border border-blue-100 shadow-lg">
            <h3 className="text-xs font-black uppercase tracking-widest text-blue-600 mb-6 tracking-widest">The "Perfect Pitch" Angle</h3>
            <p className="text-slate-900 font-bold leading-relaxed text-2xl italic">
              "{research.valueProposition}"
            </p>
            <div className="mt-8 flex gap-4">
              <button className="bg-white border border-slate-300 text-slate-800 font-bold text-sm flex items-center gap-2 hover:bg-slate-50 px-4 py-2 rounded-xl transition-all shadow-sm">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2" /></svg>
                Copy Outreach Script
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
};

export default ResearchPanel;
