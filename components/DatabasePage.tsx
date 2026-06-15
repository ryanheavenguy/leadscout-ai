
import React, { useState, useEffect, useMemo } from 'react';
import { Church, OutreachStatus } from '../types';
import { churchService } from '../services/churchService';
import { COUNTRIES } from '../constants/countries';

const STATUS_CONFIG: Record<OutreachStatus, { label: string; color: string }> = {
  not_contacted: { label: 'Not Contacted', color: 'bg-slate-100 text-slate-600 border-slate-300' },
  contacted:     { label: 'Contacted',     color: 'bg-blue-100 text-blue-700 border-blue-300' },
  responded:     { label: 'Responded',     color: 'bg-yellow-100 text-yellow-700 border-yellow-300' },
  converted:     { label: 'Converted',     color: 'bg-green-100 text-green-700 border-green-300' },
};

const STATUS_ORDER: OutreachStatus[] = ['not_contacted', 'contacted', 'responded', 'converted'];

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

interface Props {
  onBack: () => void;
}

const DatabasePage: React.FC<Props> = ({ onBack }) => {
  const [churches, setChurches] = useState<Church[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<OutreachStatus | 'all'>('all');
  const [filterCountry, setFilterCountry] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await churchService.getSavedChurches();
      setChurches(data.sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || '')));
    } catch (e: any) {
      setError(e.message || 'Failed to load database.');
    } finally {
      setLoading(false);
    }
  }

  // Build list of countries that actually have records
  const availableCountries = useMemo(() => {
    const codes = new Set(churches.map(c => (c.country || '').toUpperCase()).filter(Boolean));
    return COUNTRIES.filter(c => codes.has(c.code)).sort((a, b) => a.name.localeCompare(b.name));
  }, [churches]);

  const filtered = useMemo(() => {
    return churches.filter(c => {
      const matchStatus = filterStatus === 'all' || c.outreachStatus === filterStatus;
      const matchCountry = filterCountry === 'all' || (c.country || '').toUpperCase() === filterCountry;
      const q = searchQuery.toLowerCase();
      const matchSearch = !q ||
        c.name.toLowerCase().includes(q) ||
        (c.city || '').toLowerCase().includes(q) ||
        (c.organizationType || '').toLowerCase().includes(q);
      return matchStatus && matchCountry && matchSearch;
    });
  }, [churches, filterStatus, filterCountry, searchQuery]);

  const counts = useMemo(() => {
    const base = filterCountry === 'all' ? churches : churches.filter(c => (c.country || '').toUpperCase() === filterCountry);
    const out: Record<string, number> = { all: base.length };
    for (const s of STATUS_ORDER) {
      out[s] = base.filter(c => c.outreachStatus === s).length;
    }
    return out;
  }, [churches, filterCountry]);

  async function handleStatusChange(church: Church, next: OutreachStatus) {
    setUpdatingId(church.id);
    try {
      await churchService.updateOutreachStatus(church.id, next);
      setChurches(prev => prev.map(c => c.id === church.id ? { ...c, outreachStatus: next } : c));
    } catch {
      alert('Failed to update status.');
    } finally {
      setUpdatingId(null);
    }
  }

  async function handleDelete(church: Church) {
    if (!confirm(`Remove "${church.name}" from the database?`)) return;
    setDeletingId(church.id);
    try {
      await churchService.deleteChurch(church.id);
      setChurches(prev => prev.filter(c => c.id !== church.id));
    } catch {
      alert('Failed to delete.');
    } finally {
      setDeletingId(null);
    }
  }

  function exportCsv() {
    const esc = (v: any) => v == null ? '""' : `"${String(v).replace(/"/g, '""')}"`;
    const headers = ['Name','Org Type','City','Country','Address','Pastor / Director','Phone','Website','Outreach Status','Saved At'];
    const rows = filtered.map(c => [
      esc(c.name), esc(c.organizationType), esc(c.city),
      esc(COUNTRIES.find(x => x.code === (c.country || '').toUpperCase())?.name || c.country),
      esc(c.address), esc(c.pastor), esc(c.phone), esc(c.website),
      esc(STATUS_CONFIG[c.outreachStatus || 'not_contacted']?.label),
      esc(c.savedAt ? new Date(c.savedAt).toLocaleDateString() : '')
    ].join(','));
    const csv = [headers.join(','), ...rows].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `ChurchDB_${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 100);
  }

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <header className="h-16 border-b border-slate-300 flex items-center justify-between px-6 shrink-0 bg-slate-100/80 backdrop-blur-md">
        <div className="flex items-center gap-6">
          <button
            onClick={onBack}
            className="text-sm font-bold text-slate-700 hover:text-slate-900 flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M15 19l-7-7 7-7" />
            </svg>
            BACK TO SEARCH
          </button>
          <h2 className="text-sm font-black text-slate-900 uppercase tracking-widest border-l-4 border-slate-900 pl-4">
            DATABASE — {churches.length} RECORDS
          </h2>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={exportCsv}
            disabled={filtered.length === 0}
            className="px-4 py-2 bg-green-700 text-white rounded font-bold text-xs hover:bg-green-800 disabled:bg-slate-400 transition-all uppercase shadow-md flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Export CSV ({filtered.length})
          </button>
        </div>
      </header>

      {/* Filters */}
      <div className="border-b border-slate-200 px-6 py-3 flex items-center gap-4 bg-slate-50 shrink-0 flex-wrap">
        {/* Status tabs */}
        <div className="flex items-center gap-1">
          {([['all', 'All'], ...STATUS_ORDER.map(s => [s, STATUS_CONFIG[s as OutreachStatus].label])] as [string, string][]).map(([val, label]) => (
            <button
              key={val}
              onClick={() => setFilterStatus(val as OutreachStatus | 'all')}
              className={`px-3 py-1.5 rounded text-xs font-bold border transition-all ${
                filterStatus === val
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-600 border-slate-300 hover:border-slate-400'
              }`}
            >
              {label} <span className="opacity-70">({counts[val] ?? 0})</span>
            </button>
          ))}
        </div>

        {/* Country filter */}
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-slate-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064" />
          </svg>
          <select
            value={filterCountry}
            onChange={e => setFilterCountry(e.target.value)}
            className="px-3 py-1.5 border border-slate-300 rounded text-xs font-bold text-slate-700 bg-white focus:ring-2 focus:ring-slate-400 outline-none cursor-pointer"
          >
            <option value="all">All Countries ({churches.length})</option>
            {availableCountries.map(c => (
              <option key={c.code} value={c.code}>
                {c.name} ({churches.filter(ch => (ch.country || '').toUpperCase() === c.code).length})
              </option>
            ))}
          </select>
        </div>

        {/* Search box */}
        <input
          type="text"
          placeholder="Search by name, city, org type..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="ml-auto px-3 py-1.5 border border-slate-300 rounded text-sm text-slate-900 bg-white focus:ring-2 focus:ring-slate-400 outline-none w-64"
        />
      </div>

      {/* Showing count */}
      {!loading && !error && churches.length > 0 && (
        <div className="px-6 py-2 bg-white border-b border-slate-100 text-xs text-slate-500 shrink-0">
          Showing <span className="font-bold text-slate-700">{filtered.length}</span> of{' '}
          <span className="font-bold text-slate-700">{churches.length}</span> records
          {filterCountry !== 'all' && (
            <> — <span className="font-semibold text-slate-700">{availableCountries.find(c => c.code === filterCountry)?.name}</span></>
          )}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-x-auto overflow-y-auto bg-slate-50">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="w-10 h-10 border-4 border-slate-900 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : error ? (
          <div className="m-6 p-4 bg-red-100 text-red-900 rounded border border-red-300 text-sm font-bold">{error}</div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-500 gap-3">
            <svg className="w-16 h-16 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
            </svg>
            <p className="font-bold uppercase tracking-widest text-sm">
              {churches.length === 0 ? 'No records saved yet — run a search and save results' : 'No records match your filters'}
            </p>
          </div>
        ) : (
          <table className="w-full text-left border-collapse" style={{ minWidth: '1400px' }}>
            <thead className="sticky top-0 z-10 bg-slate-200 border-b border-slate-400">
              <tr>
                <th className="sticky left-0 z-20 bg-slate-200 px-4 py-1 text-xs font-bold text-slate-700 uppercase border-r border-slate-300 w-[220px]">Name / Type</th>
                <th className="px-4 py-1 text-xs font-bold text-slate-700 uppercase border-r border-slate-300 w-[200px]">Address</th>
                <th className="px-4 py-1 text-xs font-bold text-slate-700 uppercase border-r border-slate-300 w-[130px]">City</th>
                <th className="px-4 py-1 text-xs font-bold text-slate-700 uppercase border-r border-slate-300 w-[120px]">Country</th>
                <th className="px-4 py-1 text-xs font-bold text-slate-700 uppercase border-r border-slate-300 w-[150px]">Pastor</th>
                <th className="px-4 py-1 text-xs font-bold text-slate-700 uppercase border-r border-slate-300 w-[140px]">Phone</th>
                <th className="px-4 py-1 text-xs font-bold text-slate-700 uppercase border-r border-slate-300 w-[160px]">Website</th>
                <th className="px-4 py-1 text-xs font-bold text-slate-700 uppercase border-r border-slate-300 w-[100px]">Socials</th>
                <th className="px-4 py-1 text-xs font-bold text-slate-700 uppercase border-r border-slate-300 w-[260px]">Description</th>
                <th className="px-4 py-1 text-xs font-bold text-slate-700 uppercase border-r border-slate-300 w-[90px]">Saved</th>
                <th className="px-4 py-1 text-xs font-bold text-slate-700 uppercase border-r border-slate-300 w-[170px]">Outreach Status</th>
                <th className="px-4 py-1 text-xs font-bold text-slate-700 uppercase w-[60px] text-center">Del</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((church, i) => {
                const status = church.outreachStatus || 'not_contacted';
                const cfg = STATUS_CONFIG[status];
                const websiteUrl = safeUrl(church.website);
                const fbUrl = safeUrl(church.facebook);
                const igUrl = safeUrl(church.instagram);
                const ytUrl = safeUrl(church.youtube);
                const countryName = COUNTRIES.find(c => c.code === (church.country || '').toUpperCase())?.name || church.country || '—';
                const rowBg = i % 2 === 0 ? 'bg-white' : 'bg-slate-50/60';
                return (
                  <tr key={church.id} className={`border-b border-slate-200 ${rowBg} hover:bg-blue-50/40 transition-colors`}>
                    {/* Name + Org Type — sticky */}
                    <td className={`sticky left-0 z-10 px-4 py-1 border-r border-slate-200 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.06)] ${rowBg}`}>
                      <span className="font-bold text-sm text-slate-900 leading-tight block truncate max-w-[190px]">{church.name}</span>
                      {church.organizationType && (
                        <span className="text-[10px] font-bold text-slate-500 uppercase truncate block max-w-[190px]">
                          {church.organizationType}
                        </span>
                      )}
                    </td>
                    {/* Address */}
                    <td className="px-4 py-1 border-r border-slate-200">
                      <span className="text-xs text-slate-600 truncate block max-w-[180px]" title={church.address}>{church.address || '—'}</span>
                      {church.serviceTimes && (
                        <span className="text-[10px] text-slate-400 truncate block max-w-[180px]">{church.serviceTimes}</span>
                      )}
                    </td>
                    {/* City */}
                    <td className="px-4 py-1 border-r border-slate-200 text-sm text-slate-600">{church.city || '—'}</td>
                    {/* Country */}
                    <td className="px-4 py-1 border-r border-slate-200 text-sm text-slate-600">{countryName}</td>
                    {/* Pastor */}
                    <td className="px-4 py-1 border-r border-slate-200">
                      <span className="text-sm text-slate-700 truncate block max-w-[130px]">{church.pastor || '—'}</span>
                      {church.founded && (
                        <span className="text-[10px] text-slate-400 font-bold uppercase">Est. {church.founded}</span>
                      )}
                    </td>
                    {/* Phone */}
                    <td className="px-4 py-1 border-r border-slate-200">
                      {church.phone ? (
                        <a href={`tel:${church.phone}`} className="text-sm text-slate-700 hover:text-green-700">{church.phone}</a>
                      ) : <span className="text-sm text-slate-400">—</span>}
                    </td>
                    {/* Website */}
                    <td className="px-4 py-1 border-r border-slate-200">
                      {websiteUrl ? (
                        <a href={websiteUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline truncate block max-w-[150px]">
                          {websiteUrl.replace(/^https?:\/\//, '').split('/')[0]}
                        </a>
                      ) : <span className="text-sm text-slate-400">—</span>}
                    </td>
                    {/* Socials */}
                    <td className="px-4 py-1 border-r border-slate-200">
                      <div className="flex items-center gap-2">
                        {fbUrl && (
                          <a href={fbUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-800" title="Facebook">
                            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                              <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
                            </svg>
                          </a>
                        )}
                        {igUrl && (
                          <a href={igUrl} target="_blank" rel="noopener noreferrer" className="text-pink-600 hover:text-pink-800" title="Instagram">
                            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                              <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
                            </svg>
                          </a>
                        )}
                        {ytUrl && (
                          <a href={ytUrl} target="_blank" rel="noopener noreferrer" className="text-red-600 hover:text-red-800" title="YouTube">
                            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                              <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
                            </svg>
                          </a>
                        )}
                        {!fbUrl && !igUrl && !ytUrl && <span className="text-xs text-slate-300">—</span>}
                      </div>
                    </td>
                    {/* Description */}
                    <td className="px-4 py-1 border-r border-slate-200">
                      <p className="text-xs text-slate-600 line-clamp-2 max-w-[240px]">{church.description || '—'}</p>
                    </td>
                    {/* Saved */}
                    <td className="px-4 py-1 border-r border-slate-200 text-xs text-slate-500 whitespace-nowrap">
                      {church.savedAt ? new Date(church.savedAt).toLocaleDateString() : '—'}
                    </td>
                    {/* Outreach Status */}
                    <td className="px-4 py-1 border-r border-slate-200">
                      <select
                        value={status}
                        disabled={updatingId === church.id}
                        onChange={e => handleStatusChange(church, e.target.value as OutreachStatus)}
                        className={`w-full text-xs font-bold border rounded px-2 py-1 cursor-pointer focus:outline-none focus:ring-2 focus:ring-slate-400 appearance-none ${cfg.color} ${updatingId === church.id ? 'opacity-50' : ''}`}
                      >
                        {STATUS_ORDER.map(s => (
                          <option key={s} value={s}>{STATUS_CONFIG[s].label}</option>
                        ))}
                      </select>
                    </td>
                    {/* Delete */}
                    <td className="px-4 py-1 text-center">
                      <button
                        onClick={() => handleDelete(church)}
                        disabled={deletingId === church.id}
                        className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors disabled:opacity-50"
                        title="Remove from database"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default DatabasePage;
