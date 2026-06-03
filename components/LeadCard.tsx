
import React from 'react';
import { Lead } from '../types';

function safeUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:' ? url : undefined;
  } catch {
    return undefined;
  }
}

interface LeadCardProps {
  lead: Lead;
  onSelect: (lead: Lead) => void;
  isActive: boolean;
  isSelected: boolean;
  onToggleSelect: (id: string) => void;
}

const LeadCard: React.FC<LeadCardProps> = ({ lead, onSelect, isActive, isSelected, onToggleSelect }) => {
  const getConfidenceColor = (score: number = 0) => {
    if (score >= 90) return 'bg-emerald-100 text-emerald-800 border-emerald-200';
    if (score >= 70) return 'bg-blue-100 text-blue-800 border-blue-200';
    return 'bg-amber-100 text-amber-800 border-amber-200';
  };

  const getScoreColor = (score: number = 0) => {
    if (score >= 80) return 'text-emerald-600';
    if (score >= 50) return 'text-blue-600';
    return 'text-amber-600';
  };

  // Determine the background color based on row state for sticky cells
  const stickyBgClass = isActive 
    ? 'bg-blue-50' 
    : isSelected 
      ? 'bg-blue-50/50' 
      : 'bg-white group-hover:bg-slate-50';

  return (
    <tr 
      onClick={() => onSelect(lead)}
      className={`group cursor-pointer transition-all border-b border-slate-300 hover:bg-slate-50 ${
        isActive ? 'bg-blue-50' : 'bg-white'
      } ${isSelected ? 'bg-blue-50/50' : ''}`}
    >
      <td 
        className={`sticky left-0 z-30 px-4 py-3 border-r border-slate-200 w-[50px] text-center shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)] ${stickyBgClass}`} 
        onClick={(e) => e.stopPropagation()}
      >
        <input 
          type="checkbox" 
          checked={isSelected} 
          onChange={() => onToggleSelect(lead.id)}
          className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
        />
      </td>
      <td className={`sticky left-[50px] z-30 px-4 py-3 border-r border-slate-200 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)] ${stickyBgClass}`}>
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-slate-900 truncate max-w-[160px]">
              {lead.companyName}
            </span>
          </div>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[10px] text-slate-500 font-bold uppercase truncate max-w-[120px]">
              {lead.industry}
            </span>
            {lead.confidenceScore !== undefined && (
              <span className={`text-[8px] px-1.5 py-0.5 rounded-full border font-black ${getConfidenceColor(lead.confidenceScore)}`} title="Confidence Score">
                {lead.confidenceScore}% ACC
              </span>
            )}
          </div>
        </div>
      </td>
      <td className="px-4 py-3 border-r border-slate-200 text-center">
        {lead.crmSynced ? (
          <span className="bg-emerald-100 text-emerald-800 text-[9px] font-black px-1.5 py-1 rounded-full uppercase tracking-tighter" title="Synced to CRM">
            Synced
          </span>
        ) : (
          <span className="bg-slate-100 text-slate-400 text-[9px] font-black px-1.5 py-1 rounded-full uppercase tracking-tighter">
            Pending
          </span>
        )}
      </td>
      <td className="px-4 py-3 border-r border-slate-200 text-center">
        <div className="flex flex-col items-center justify-center">
          <div className={`text-lg font-black ${getScoreColor(lead.leadScore)}`}>
            {lead.leadScore ?? '—'}
          </div>
          <div className="text-[8px] font-black text-slate-400 uppercase tracking-tighter">LEAD SCORE</div>
        </div>
      </td>
      <td className="px-4 py-3 border-r border-slate-200">
        <div className="text-sm text-slate-700 truncate max-w-[280px]" title={lead.address}>
          {lead.address || '—'}
        </div>
      </td>
      <td className="px-4 py-3 border-r border-slate-200">
        <div className="flex items-center gap-2 flex-wrap max-w-[100px]">
          {safeUrl(lead.linkedin) && (
            <a href={safeUrl(lead.linkedin)} title="Personal LinkedIn" target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="text-blue-700 hover:text-blue-900">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z"/></svg>
            </a>
          )}
          {safeUrl(lead.linkedinCompanyPage) && (
            <a href={safeUrl(lead.linkedinCompanyPage)} title="Company LinkedIn" target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="text-blue-500 hover:text-blue-700">
               <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M18.333 3h-12.666c-1.47 0-2.667 1.197-2.667 2.667v12.666c0 1.47 1.197 2.667 2.667 2.667h12.666c1.47 0 2.667-1.197 2.667-2.667v-12.666c0-1.47-1.197-2.667-2.667-2.667zm-9.333 13h-2v-6h2v6zm-1-6.891c-.642 0-1.163-.52-1.163-1.162 0-.642.521-1.162 1.163-1.162.641 0 1.162.52 1.162 1.162 0 .642-.521 1.162-1.162 1.162zm8.333 6.891h-2v-3.085c0-.735-.014-1.681-1.025-1.681-1.026 0-1.182.801-1.182 1.628v3.138h-2v-6h1.92v.821h.027c.267-.506.919-1.039 1.892-1.039 2.022 0 2.396 1.332 2.396 3.063v3.155z"/></svg>
            </a>
          )}
          {safeUrl(lead.twitter) && (
            <a href={safeUrl(lead.twitter)} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="text-slate-900 hover:text-black">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
            </a>
          )}
          {safeUrl(lead.facebook) && (
            <a href={safeUrl(lead.facebook)} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="text-blue-600 hover:text-blue-800">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
            </a>
          )}
          {safeUrl(lead.instagram) && (
            <a href={safeUrl(lead.instagram)} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="text-pink-600 hover:text-pink-800">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/></svg>
            </a>
          )}
          {safeUrl(lead.tiktok) && (
            <a href={safeUrl(lead.tiktok)} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="text-black hover:text-slate-700">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12.525.02c1.31 0 2.591.21 3.791.63V4.93c-1.14-.36-2.31-.54-3.51-.54-3.14 0-5.69 2.55-5.69 5.69s2.55 5.69 5.69 5.69c1.07 0 2.08-.31 2.94-.84v-5.22c.81.56 1.79.88 2.85.88 2.77 0 5.01-2.24 5.01-5.01V0h-3.41c0 2.15-1.74 3.9-3.9 3.9v-3.88c-.64-.13-1.3-.19-1.98-.19-4.88 0-8.83 3.95-8.83 8.83s3.95 8.83 8.83 8.83 8.83-3.95 8.83-8.83h-2.11c0 3.71-3.01 6.72-6.72 6.72s-6.72-3.01-6.72-6.72 3.01-6.72 6.72-6.72c1.24 0 2.4.34 3.4.92V.02h-2.11z"/></svg>
            </a>
          )}
          {!safeUrl(lead.linkedin) && !safeUrl(lead.linkedinCompanyPage) && !safeUrl(lead.twitter) && !safeUrl(lead.facebook) && !safeUrl(lead.instagram) && !safeUrl(lead.tiktok) && <span className="text-xs text-slate-300 italic">none</span>}
        </div>
      </td>
      <td className="px-4 py-3 border-r border-slate-200">
        {safeUrl(lead.website.startsWith('http') ? lead.website : `https://${lead.website}`) ? (
          <a
            href={safeUrl(lead.website.startsWith('http') ? lead.website : `https://${lead.website}`)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-sm text-blue-600 hover:underline truncate block max-w-[150px]"
          >
            {lead.website.replace(/^https?:\/\//, '').split('/')[0]}
          </a>
        ) : (
          <span className="text-sm text-slate-400 truncate block max-w-[150px]">{lead.website}</span>
        )}
      </td>
      <td className="px-4 py-3 border-r border-slate-200">
        <div className="flex flex-col">
          <span className="text-sm font-medium text-slate-800">{lead.contactName || '—'}</span>
          {lead.contactTitle && (
            <span className="text-[10px] text-slate-500 font-bold uppercase truncate max-w-[160px]" title={lead.contactTitle}>
              {lead.contactTitle}
            </span>
          )}
        </div>
      </td>
      <td className="px-4 py-3 border-r border-slate-200">
        {lead.contactEmail ? (
          <a 
            href={`mailto:${lead.contactEmail}`}
            onClick={(e) => e.stopPropagation()}
            className="text-sm text-slate-700 hover:text-blue-700 truncate block max-w-[200px]"
          >
            {lead.contactEmail}
          </a>
        ) : <span className="text-sm text-slate-400">—</span>}
      </td>
      <td className="px-4 py-3 border-r border-slate-200">
        {lead.contactPhone ? (
          <a 
            href={`tel:${lead.contactPhone}`}
            onClick={(e) => e.stopPropagation()}
            className="text-sm text-slate-700 hover:text-green-700"
          >
            {lead.contactPhone}
          </a>
        ) : <span className="text-sm text-slate-400">—</span>}
      </td>
      <td className="px-4 py-3 text-center">
        <button className="p-1.5 bg-slate-100 rounded border border-slate-300 hover:bg-blue-600 hover:text-white transition-colors shadow-sm">
           <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" /></svg>
        </button>
      </td>
    </tr>
  );
};

export default LeadCard;
