
import React from 'react';
import { Church } from '../types';

function safeUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const { protocol } = new URL(url.startsWith('http') ? url : `https://${url}`);
    return protocol === 'http:' || protocol === 'https:'
      ? (url.startsWith('http') ? url : `https://${url}`)
      : undefined;
  } catch {
    return undefined;
  }
}

interface ChurchCardProps {
  church: Church;
  onSelect: (church: Church) => void;
  isActive: boolean;
  isSelected: boolean;
  onToggleSelect: (id: string) => void;
}

const ChurchCard: React.FC<ChurchCardProps> = ({
  church, onSelect, isActive, isSelected, onToggleSelect
}) => {
  const getConfColor = (score: number = 0) => {
    if (score >= 80) return 'bg-emerald-100 text-emerald-800 border-emerald-200';
    if (score >= 55) return 'bg-blue-100 text-blue-800 border-blue-200';
    return 'bg-amber-100 text-amber-800 border-amber-200';
  };

  const stickyBg = isActive
    ? 'bg-blue-50'
    : isSelected
    ? 'bg-blue-50/50'
    : 'bg-white group-hover:bg-slate-50';

  const websiteUrl = safeUrl(church.website);
  const fbUrl = safeUrl(church.facebook);
  const igUrl = safeUrl(church.instagram);
  const ytUrl = safeUrl(church.youtube);

  return (
    <tr
      onClick={() => onSelect(church)}
      className={`group cursor-pointer transition-all border-b border-slate-300 hover:bg-slate-50 leading-tight ${
        isActive ? 'bg-blue-50' : isSelected ? 'bg-blue-50/50' : 'bg-white'
      }`}
    >
      {/* Checkbox */}
      <td
        className={`sticky left-0 z-30 px-4 py-0.5 border-r border-slate-200 w-[50px] text-center shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)] ${stickyBg}`}
        onClick={e => e.stopPropagation()}
      >
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => onToggleSelect(church.id)}
          className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
        />
      </td>

      {/* Name + Org Type */}
      <td className={`sticky left-[50px] z-30 px-4 py-0.5 border-r border-slate-200 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)] ${stickyBg}`}>
        <div className="flex items-center gap-1.5 whitespace-nowrap">
          <span className="text-sm font-bold text-slate-900 truncate max-w-[200px]">{church.name}</span>
          {church.confidenceScore !== undefined && (
            <span
              className={`text-[8px] px-1.5 py-0.5 rounded-full border font-black ${getConfColor(church.confidenceScore)}`}
              title="Data confidence score"
            >
              {church.confidenceScore}%
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 whitespace-nowrap text-[10px] text-slate-400">
          {church.organizationType && (
            <span className="font-bold text-slate-500 uppercase truncate max-w-[140px]">{church.organizationType}</span>
          )}
          {church.city && <span className="truncate max-w-[140px]">{church.city}</span>}
        </div>
      </td>

      {/* Address */}
      <td className="px-4 py-0.5 border-r border-slate-200">
        <span className="text-sm text-slate-700 truncate block max-w-full" title={church.address}>
          {church.address || '—'}
        </span>
        {(church.city || church.country) && (
          <span className="text-[10px] text-slate-400 font-medium truncate block max-w-full">
            {[church.city, church.country].filter(Boolean).join(', ')}
          </span>
        )}
        {church.serviceTimes && (
          <span className="text-[10px] text-slate-400 truncate block max-w-full" title={church.serviceTimes}>
            {church.serviceTimes}
          </span>
        )}
      </td>

      {/* Pastor */}
      <td className="px-4 py-0.5 border-r border-slate-200 whitespace-nowrap">
        <span className="text-sm font-medium text-slate-800 truncate inline-block max-w-[200px] align-middle">
          {church.pastor || '—'}
        </span>
        {church.founded && (
          <span className="text-[10px] text-slate-400 font-bold uppercase ml-1.5">Est. {church.founded}</span>
        )}
      </td>

      {/* Phone */}
      <td className="px-4 py-0.5 border-r border-slate-200 whitespace-nowrap">
        {church.phone ? (
          <a
            href={`tel:${church.phone}`}
            onClick={e => e.stopPropagation()}
            className="text-sm text-slate-700 hover:text-green-700"
          >
            {church.phone}
          </a>
        ) : (
          <span className="text-sm text-slate-400">—</span>
        )}
      </td>

      {/* Website */}
      <td className="px-4 py-0.5 border-r border-slate-200">
        {websiteUrl ? (
          <a
            href={websiteUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            className="text-sm text-blue-600 hover:underline truncate block max-w-full"
          >
            {websiteUrl.replace(/^https?:\/\//, '').split('/')[0]}
          </a>
        ) : (
          <span className="text-sm text-slate-400">—</span>
        )}
      </td>

      {/* Socials */}
      <td className="px-4 py-0.5 border-r border-slate-200">
        <div className="flex items-center gap-2">
          {fbUrl && (
            <a href={fbUrl} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="text-blue-600 hover:text-blue-800" title="Facebook">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
              </svg>
            </a>
          )}
          {igUrl && (
            <a href={igUrl} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="text-pink-600 hover:text-pink-800" title="Instagram">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
              </svg>
            </a>
          )}
          {ytUrl && (
            <a href={ytUrl} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="text-red-600 hover:text-red-800" title="YouTube">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
              </svg>
            </a>
          )}
          {!fbUrl && !igUrl && !ytUrl && <span className="text-xs text-slate-300 italic">—</span>}
        </div>
      </td>

      {/* Description */}
      <td className="px-4 py-0.5 border-r border-slate-200">
        <p className="text-xs text-slate-600 truncate max-w-full" title={church.description}>{church.description}</p>
      </td>

      {/* Inspect */}
      <td className="px-4 py-0.5 text-center">
        <button className="p-1.5 bg-slate-100 rounded border border-slate-300 hover:bg-blue-600 hover:text-white transition-colors shadow-sm">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </td>
    </tr>
  );
};

export default ChurchCard;
