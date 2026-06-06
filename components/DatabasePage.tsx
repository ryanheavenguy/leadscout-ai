
import React, { useState, useEffect, useMemo } from 'react';
import { Church, OutreachStatus } from '../types';
import { churchService } from '../services/churchService';

const STATUS_CONFIG: Record<OutreachStatus, { label: string; color: string }> = {
  not_contacted: { label: 'Not Contacted', color: 'bg-slate-100 text-slate-600 border-slate-300' },
  contacted:     { label: 'Contacted',     color: 'bg-blue-100 text-blue-700 border-blue-300' },
  responded:     { label: 'Responded',     color: 'bg-yellow-100 text-yellow-700 border-yellow-300' },
  converted:     { label: 'Converted',     color: 'bg-green-100 text-green-700 border-green-300' },
};

const STATUS_ORDER: OutreachStatus[] = ['not_contacted', 'contacted', 'responded', 'converted'];

interface Props {
  onBack: () => void;
}

const DatabasePage: React.FC<Props> = ({ onBack }) => {
  const [churches, setChurches] = useState<Church[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<OutreachStatus | 'all'>('all');
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

  const filtered = useMemo(() => {
    return churches.filter(c => {
      const matchStatus = filterStatus === 'all' || c.outreachStatus === filterStatus;
      const q = searchQuery.toLowerCase();
      const matchSearch = !q || c.name.toLowerCase().includes(q) || (c.city || '').toLowerCase().includes(q) || (c.organizationType || '').toLowerCase().includes(q);
      return matchStatus && matchSearch;
    });
  }, [churches, filterStatus, searchQuery]);

  const counts = useMemo(() => {
    const out: Record<string, number> = { all: churches.length };
    for (const s of STATUS_ORDER) {
      out[s] = churches.filter(c => c.outreachStatus === s).length;
    }
    return out;
  }, [churches]);

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
    const headers = ['Name','Org Type','City','Address','Pastor / Director','Phone','Website','Outreach Status','Saved At'];
    const rows = filtered.map(c => [
      esc(c.name), esc(c.organizationType), esc(c.city), esc(c.address),
      esc(c.pastor), esc(c.phone), esc(c.website),
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
            DATABASE — {counts.all} RECORDS
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
            Export CSV
          </button>
        </div>
      </header>

      {/* Filters */}
      <div className="border-b border-slate-200 px-6 py-3 flex items-center gap-4 bg-slate-50 shrink-0 flex-wrap">
        {/* Status tabs */}
        <div className="flex items-center gap-1">
          {([['all', 'All'], ...STATUS_ORDER.map(s => [s, STATUS_CONFIG[s].label])] as [string, string][]).map(([val, label]) => (
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

        {/* Search box */}
        <input
          type="text"
          placeholder="Search by name, city, org type..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="ml-auto px-3 py-1.5 border border-slate-300 rounded text-sm text-slate-900 bg-white focus:ring-2 focus:ring-slate-400 outline-none w-64"
        />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto bg-slate-50">
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
          <table className="w-full text-left border-collapse min-w-[1100px]">
            <thead className="sticky top-0 z-10 bg-slate-200 border-b border-slate-400">
              <tr>
                <th className="px-4 py-3 text-xs font-bold text-slate-700 uppercase border-r border-slate-300 w-[220px]">Name</th>
                <th className="px-4 py-3 text-xs font-bold text-slate-700 uppercase border-r border-slate-300 w-[160px]">Org Type</th>
                <th className="px-4 py-3 text-xs font-bold text-slate-700 uppercase border-r border-slate-300 w-[180px]">City</th>
                <th className="px-4 py-3 text-xs font-bold text-slate-700 uppercase border-r border-slate-300 w-[150px]">Pastor</th>
                <th className="px-4 py-3 text-xs font-bold text-slate-700 uppercase border-r border-slate-300 w-[140px]">Phone</th>
                <th className="px-4 py-3 text-xs font-bold text-slate-700 uppercase border-r border-slate-300 w-[160px]">Website</th>
                <th className="px-4 py-3 text-xs font-bold text-slate-700 uppercase border-r border-slate-300 w-[100px]">Saved</th>
                <th className="px-4 py-3 text-xs font-bold text-slate-700 uppercase border-r border-slate-300 w-[170px]">Outreach Status</th>
                <th className="px-4 py-3 text-xs font-bold text-slate-700 uppercase w-[60px] text-center">Del</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((church, i) => {
                const status = church.outreachStatus || 'not_contacted';
                const cfg = STATUS_CONFIG[status];
                return (
                  <tr key={church.id} className={`border-b border-slate-200 ${i % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'} hover:bg-blue-50/40 transition-colors`}>
                    <td className="px-4 py-3 border-r border-slate-200">
                      <span className="font-bold text-sm text-slate-900 leading-tight block">{church.name}</span>
                    </td>
                    <td className="px-4 py-3 border-r border-slate-200 text-sm text-slate-600">{church.organizationType || '—'}</td>
                    <td className="px-4 py-3 border-r border-slate-200 text-sm text-slate-600">{church.city}</td>
                    <td className="px-4 py-3 border-r border-slate-200 text-sm text-slate-600">{church.pastor || '—'}</td>
                    <td className="px-4 py-3 border-r border-slate-200 text-sm text-slate-600">{church.phone || '—'}</td>
                    <td className="px-4 py-3 border-r border-slate-200">
                      {church.website ? (
                        <a href={church.website} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline text-xs font-medium truncate block max-w-[150px]">
                          {church.website.replace(/^https?:\/\//, '')}
                        </a>
                      ) : <span className="text-slate-400 text-sm">—</span>}
                    </td>
                    <td className="px-4 py-3 border-r border-slate-200 text-xs text-slate-500">
                      {church.savedAt ? new Date(church.savedAt).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-4 py-3 border-r border-slate-200">
                      <div className="relative">
                        <select
                          value={status}
                          disabled={updatingId === church.id}
                          onChange={e => handleStatusChange(church, e.target.value as OutreachStatus)}
                          className={`w-full text-xs font-bold border rounded px-2 py-1.5 cursor-pointer focus:outline-none focus:ring-2 focus:ring-slate-400 appearance-none ${cfg.color} ${updatingId === church.id ? 'opacity-50' : ''}`}
                        >
                          {STATUS_ORDER.map(s => (
                            <option key={s} value={s}>{STATUS_CONFIG[s].label}</option>
                          ))}
                        </select>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => handleDelete(church)}
                        disabled={deletingId === church.id}
                        className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors disabled:opacity-50"
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
