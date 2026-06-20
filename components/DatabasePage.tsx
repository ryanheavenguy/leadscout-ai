
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Church, ChurchResearch, OutreachStatus } from '../types';
import { churchService } from '../services/churchService';
import { COUNTRIES } from '../constants/countries';
import ChurchResearchPanel from './ChurchResearchPanel';
import {
  CHURCH_COLUMNS,
  ChurchTableHeader,
  ChurchRow,
  STATUS_CONFIG,
  STATUS_ORDER,
} from '../constants/churchColumns';

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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectedChurch, setSelectedChurch] = useState<Church | null>(null);
  const [research, setResearch] = useState<ChurchResearch | null>(null);
  const [researchLoading, setResearchLoading] = useState(false);

  // ─── Resizable table columns (defs shared with the Search table) ─────────────
  const [colWidths, setColWidths] = useState<number[]>(() => CHURCH_COLUMNS.map(c => c.width));
  const resizeRef = useRef<{ index: number; startX: number; startWidth: number } | null>(null);

  const startResize = (index: number) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizeRef.current = { index, startX: e.clientX, startWidth: colWidths[index] };

    const onMove = (ev: MouseEvent) => {
      const ctx = resizeRef.current;
      if (!ctx) return;
      const next = Math.max(60, ctx.startWidth + (ev.clientX - ctx.startX));
      setColWidths(prev => {
        const copy = [...prev];
        copy[ctx.index] = next;
        return copy;
      });
    };
    const onUp = () => {
      resizeRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

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

  async function handleFieldChange(church: Church, field: keyof Church, value: string) {
    const prev = (church[field] ?? '') as string;
    if (value === prev) return;
    // Optimistic update; revert on failure.
    setChurches(cs => cs.map(c => c.id === church.id ? { ...c, [field]: value } : c));
    try {
      await churchService.updateChurch(church.id, { [field]: value } as Partial<Church>);
    } catch {
      setChurches(cs => cs.map(c => c.id === church.id ? { ...c, [field]: prev } : c));
      alert('Failed to save change.');
    }
  }

  async function handleDelete(church: Church) {
    if (!confirm(`Remove "${church.name}" from the database?`)) return;
    setDeletingId(church.id);
    try {
      await churchService.deleteChurch(church.id);
      setChurches(prev => prev.filter(c => c.id !== church.id));
      setSelectedIds(prev => { const n = new Set(prev); n.delete(church.id); return n; });
    } catch {
      alert('Failed to delete.');
    } finally {
      setDeletingId(null);
    }
  }

  async function handleInspectChurch(church: Church) {
    setSelectedChurch(church);
    setResearch(null);
    setResearchLoading(true);

    try {
      const result = await churchService.deepResearch(church);
      setResearch(result);
    } catch (err) {
      console.error('Research failed', err);
    } finally {
      setResearchLoading(false);
    }
  }

  // ─── Selection ───────────────────────────────────────────────────────────────
  const isAllSelected = filtered.length > 0 && filtered.every(c => selectedIds.has(c.id));

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelectedIds(isAllSelected ? new Set() : new Set(filtered.map(c => c.id)));
  };

  async function handleDeleteSelected() {
    const ids = filtered.filter(c => selectedIds.has(c.id)).map(c => c.id);
    if (ids.length === 0) return;
    if (!confirm(`Remove ${ids.length} record${ids.length > 1 ? 's' : ''} from the database?`)) return;
    try {
      await Promise.all(ids.map(id => churchService.deleteChurch(id)));
      setChurches(prev => prev.filter(c => !selectedIds.has(c.id)));
      setSelectedIds(new Set());
    } catch {
      alert('Failed to delete some records.');
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
          {selectedIds.size > 0 && (
            <button
              onClick={handleDeleteSelected}
              className="px-4 py-2 bg-red-600 text-white rounded font-bold text-xs hover:bg-red-700 transition-all uppercase shadow-md flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              Delete ({selectedIds.size})
            </button>
          )}
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
          <table className="text-left border-collapse table-fixed" style={{ width: colWidths.reduce((a, b) => a + b, 0) }}>
            <colgroup>
              {colWidths.map((w, i) => <col key={i} style={{ width: w }} />)}
            </colgroup>
            <ChurchTableHeader
              widths={colWidths}
              startResize={startResize}
              selectAll={{ checked: isAllSelected, onChange: toggleAll }}
            />
            <tbody>
              {filtered.map((church, i) => (
                <ChurchRow
                  key={church.id}
                  church={church}
                  widths={colWidths}
                  ctx={{
                    mode: 'database',
                    rowBg: i % 2 === 0 ? 'bg-white' : 'bg-slate-50',
                    isSelected: selectedIds.has(church.id),
                    onToggleSelect: toggleSelect,
                    onStatusChange: handleStatusChange,
                    onFieldChange: handleFieldChange,
                    onDelete: handleDelete,
                    onInspect: handleInspectChurch,
                    updating: updatingId === church.id,
                    deleting: deletingId === church.id,
                  }}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Detail view modal */}
      {selectedChurch && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-5xl w-full max-h-[90vh] overflow-auto shadow-2xl">
            <div className="sticky top-0 z-10 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
              <h3 className="text-lg font-black text-slate-900">{selectedChurch.name}</h3>
              <button
                onClick={() => setSelectedChurch(null)}
                className="text-slate-400 hover:text-slate-600 transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <ChurchResearchPanel
              church={selectedChurch}
              research={research}
              loading={researchLoading}
              onInspect={handleInspectChurch}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default DatabasePage;
