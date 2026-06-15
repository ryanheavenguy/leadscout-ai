
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Session } from '@supabase/supabase-js';
import { Church, ChurchSearchParams, ChurchResearch, BatchChurchResearch, AppStatus, ViewMode } from './types';
import { supabase, isSupabaseConfigured } from './lib/supabase';
import { churchService } from './services/churchService';
import ChurchCard from './components/ChurchCard';
import ChurchResearchPanel from './components/ChurchResearchPanel';
import DatabasePage from './components/DatabasePage';
import Login from './components/Login';
import { COUNTRIES } from './constants/countries';

const App: React.FC = () => {
  // ─── Auth state ─────────────────────────────────────────────────────────────
  const [session, setSession]             = useState<Session | null>(null);
  const [authLoading, setAuthLoading]     = useState(true);
  const [isRecovery, setIsRecovery]       = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setAuthLoading(false);
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      if (event === 'PASSWORD_RECOVERY') {
        setIsRecovery(true);
      } else if (event === 'USER_UPDATED') {
        setIsRecovery(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // ─── Routing ────────────────────────────────────────────────────────────────
  // Lightweight history-based routing (no router dependency).
  // '/database' shows the database; everything else ('/', '/search') shows search.
  const routeFromPath = (path: string): 'search' | 'database' =>
    path === '/database' ? 'database' : 'search';

  const [route, setRoute] = useState<'search' | 'database'>(() => routeFromPath(window.location.pathname));

  // Normalize the bare root to /search so the home page has its own URL.
  useEffect(() => {
    if (window.location.pathname === '/') {
      window.history.replaceState({}, '', '/search');
    }
  }, []);

  // Keep state in sync with browser back/forward navigation.
  useEffect(() => {
    const onPopState = () => setRoute(routeFromPath(window.location.pathname));
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigate = (path: '/search' | '/database') => {
    if (window.location.pathname !== path) {
      window.history.pushState({}, '', path);
    }
    setRoute(routeFromPath(path));
  };

  // ─── App state ─────────────────────────────────────────────────────────────
  const [status, setStatus]               = useState<AppStatus>(AppStatus.IDLE);
  const [viewMode, setViewMode]           = useState<ViewMode>('GRID');
  const [churches, setChurches]           = useState<Church[]>([]);
  const [selectedIds, setSelectedIds]     = useState<Set<string>>(new Set());
  const [selectedChurch, setSelectedChurch] = useState<Church | null>(null);
  const [research, setResearch]           = useState<ChurchResearch | null>(null);
  const [batchResearch, setBatchResearch] = useState<BatchChurchResearch | null>(null);
  const [researchLoading, setResearchLoading] = useState(false);
  const [searchProgress, setSearchProgress]   = useState(0);
  const [error, setError]                 = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [saveStatus, setSaveStatus]       = useState<string | null>(null);

  // ─── Resizable table columns ────────────────────────────────────────────────
  const COLUMN_DEFS = useMemo(() => ([
    { key: 'church',      label: 'Church',             width: 260, sticky: true },
    { key: 'address',     label: 'Address / Services', width: 380 },
    { key: 'pastor',      label: 'Pastor',             width: 220 },
    { key: 'phone',       label: 'Phone',              width: 160 },
    { key: 'website',     label: 'Website',            width: 240 },
    { key: 'socials',     label: 'Socials',            width: 110 },
    { key: 'description', label: 'Description',         width: 460 },
    { key: 'inspect',     label: 'Inspect',            width: 80, center: true },
  ]), []);
  const [colWidths, setColWidths] = useState<number[]>(() => COLUMN_DEFS.map(c => c.width));
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

  const initialForm: ChurchSearchParams = {
    country: 'US',
    location: '',
    includeChurches: true,
    includeMinistries: true,
    keywords: '',
    quantity: 20
  };
  const [form, setForm] = useState<ChurchSearchParams>(initialForm);

  const isAllSelected = useMemo(
    () => churches.length > 0 && churches.every(c => selectedIds.has(c.id)),
    [churches, selectedIds]
  );

  // ─── Places search ─────────────────────────────────────────────────────────
  const handlePlacesSearch = async () => {
    setStatus(AppStatus.SEARCHING);
    setViewMode('GRID');
    setChurches([]);
    setSearchProgress(0);
    setSelectedIds(new Set());
    setSelectedChurch(null);
    setResearch(null);
    setBatchResearch(null);
    setError(null);
    setSaveStatus(null);

    try {
      const { churches: found } = await churchService.searchChurchesByLocation(
        form,
        pct => setSearchProgress(Math.round(pct * 0.6)) // 0–60% for the Places fetch
      );

      setSearchProgress(65);

      if (found.length > 0) {
        // Google Places returns no pastor/socials — enrich verified results with a grounded
        // Gemini pass that looks up the lead pastor, social URLs, and a real description.
        const enrichments = await churchService.enrichChurchesFromPlaces(found);
        setSearchProgress(95);
        setChurches(found.map(c => {
          const e = enrichments[c.id];
          if (!e) return c;
          return {
            ...c,
            pastor: c.pastor ?? e.pastor ?? undefined,
            facebook: c.facebook ?? e.facebook ?? undefined,
            instagram: c.instagram ?? e.instagram ?? undefined,
            youtube: c.youtube ?? e.youtube ?? undefined,
            description: e.description || c.description
          };
        }));
      } else {
        setChurches([]);
      }

      setSearchProgress(100);
      setStatus(AppStatus.IDLE);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Places search failed. Check your GOOGLE_PLACES_API_KEY.');
      setStatus(AppStatus.ERROR);
    }
  };

  // ─── Search ────────────────────────────────────────────────────────────────
  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    handlePlacesSearch();
  };

  // ─── Save results to DB ────────────────────────────────────────────────────
  const handleSaveToDb = async () => {
    const toSave = selectedIds.size > 0
      ? churches.filter(c => selectedIds.has(c.id))
      : churches;
    if (toSave.length === 0) return;

    setSaveStatus('saving');
    try {
      const { added, total } = await churchService.saveChurches(toSave);
      setSaveStatus(added > 0 ? `Saved ${added} new (${total} total in DB)` : `All already in DB (${total} total)`);
    } catch {
      setSaveStatus('Save failed.');
    }
  };

  // ─── Select church → deep research ─────────────────────────────────────────
  const handleSelectChurch = async (church: Church) => {
    setSelectedChurch(church);
    setViewMode('DETAIL');
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
  };

  // ─── Batch research selected churches ──────────────────────────────────────
  const handleBatchResearch = async () => {
    if (selectedIds.size === 0) return;

    setStatus(AppStatus.RESEARCHING);
    setResearchLoading(true);
    setViewMode('BATCH_SUMMARY');
    setError(null);

    const selected = churches.filter(c => selectedIds.has(c.id));
    const individualResults: Record<string, ChurchResearch> = {};
    const resultsArray: ChurchResearch[] = [];

    try {
      await Promise.all(
        selected.map(async church => {
          const res = await churchService.deepResearch(church);
          individualResults[church.id] = res;
          resultsArray.push(res);
        })
      );

      const batchSummary = await churchService.summarizeBatch(selected, resultsArray);

      setBatchResearch({
        globalInsights: batchSummary.globalInsights || '',
        trends: batchSummary.trends || [],
        organizationalSpread: batchSummary.organizationalSpread || '',
        individualInsights: individualResults
      });

      setStatus(AppStatus.IDLE);
    } catch (err: any) {
      console.error('Batch research failed', err);
      setError('Batch research failed. Some lookups may have timed out.');
      setStatus(AppStatus.ERROR);
    } finally {
      setResearchLoading(false);
    }
  };

  // ─── Selection helpers ──────────────────────────────────────────────────────
  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelectedIds(isAllSelected ? new Set() : new Set(churches.map(c => c.id)));
  };

  // ─── CSV Export ─────────────────────────────────────────────────────────────
  const exportChurches = () => {
    const toExport = selectedIds.size > 0
      ? churches.filter(c => selectedIds.has(c.id))
      : churches;

    if (toExport.length === 0) {
      alert('No churches to export.');
      return;
    }

    const esc = (val: any) => {
      if (val === undefined || val === null) return '""';
      return `"${String(val).replace(/"/g, '""')}"`;
    };

    const headers = [
      'Name', 'Org Type', 'Address', 'City', 'Website',
      'Phone', 'Email', 'Pastor / Director', 'Founded', 'Size',
      'Service Times', 'Facebook', 'Instagram', 'YouTube',
      'Description', 'Confidence Score', 'Source Evidence'
    ];

    const rows = toExport.map(c => [
      esc(c.name), esc(c.organizationType), esc(c.address), esc(c.city),
      esc(c.website), esc(c.phone), esc(c.email), esc(c.pastor),
      esc(c.founded), esc(c.congregationSize), esc(c.serviceTimes),
      esc(c.facebook), esc(c.instagram), esc(c.youtube),
      esc(c.description), esc(c.confidenceScore), esc(c.sourceEvidence)
    ].join(','));

    const csv = [headers.join(','), ...rows].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const typeLabel = form.includeChurches && form.includeMinistries ? 'ChurchesAndMinistries' : form.includeMinistries ? 'Ministries' : 'Churches';
    link.download = `${typeLabel}_${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 100);
  };

  // ─── Auth gate ──────────────────────────────────────────────────────────────
  if (authLoading) {
    return (
      <div className="fixed inset-0 bg-slate-900 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!import.meta.env.DEV && !isSupabaseConfigured) {
    return (
      <div className="fixed inset-0 bg-slate-900 flex items-center justify-center p-8">
        <div className="bg-white/10 border border-white/20 rounded-2xl p-8 max-w-lg w-full text-center space-y-4">
          <div className="w-12 h-12 bg-yellow-400 rounded-xl flex items-center justify-center mx-auto text-2xl">⚙️</div>
          <h2 className="text-white font-black text-xl">Supabase Setup Required</h2>
          <p className="text-slate-300 text-sm leading-relaxed">
            Add your Supabase credentials to <code className="bg-slate-700 px-1.5 py-0.5 rounded text-yellow-300">.env</code> then restart the server:
          </p>
          <pre className="bg-slate-800 rounded-xl p-4 text-left text-xs text-green-300 leading-relaxed whitespace-pre-wrap">{`VITE_SUPABASE_URL=https://xxxx.supabase.co\nVITE_SUPABASE_ANON_KEY=eyJhbGc...\nSUPABASE_JWT_SECRET=your-jwt-secret`}</pre>
          <p className="text-slate-400 text-xs">Then run <code className="bg-slate-700 px-1.5 py-0.5 rounded text-slate-200">npm run dev:full</code></p>
        </div>
      </div>
    );
  }

  if (isSupabaseConfigured && (!session || isRecovery)) {
    return <Login isRecovery={isRecovery} onRecoveryComplete={() => setIsRecovery(false)} />;
  }

  // ─── Database view ──────────────────────────────────────────────────────────
  if (route === 'database') {
    return (
      <div className="flex h-screen bg-slate-200 overflow-hidden font-inter text-slate-900">
        <main className="flex-1 flex flex-col min-w-0 bg-white shadow-inner">
          {/* Top nav */}
          <div className="h-10 bg-slate-900 flex items-center px-4 gap-1 shrink-0">
            <button
              onClick={() => navigate('/search')}
              className="px-4 py-1 text-xs font-bold text-slate-400 hover:text-white transition-colors rounded"
            >
              SEARCH
            </button>
            <button
              className="px-4 py-1 text-xs font-bold text-white bg-slate-700 rounded"
            >
              DATABASE
            </button>
            <div className="ml-auto">
              <button
                onClick={() => supabase?.auth.signOut()}
                className="px-3 py-1 text-xs font-bold text-slate-400 hover:text-white transition-colors rounded flex items-center gap-1.5"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                LOGOUT
              </button>
            </div>
          </div>
          <DatabasePage onBack={() => navigate('/search')} />
        </main>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-slate-200 overflow-hidden font-inter text-slate-900">

      {/* ── Sidebar ── */}
      <aside className={`${isSidebarOpen ? 'w-80' : 'w-0'} border-r border-slate-400 bg-white flex flex-col shrink-0 z-20 transition-all duration-300 ease-in-out overflow-hidden shadow-xl`}>
        <div className="p-5 h-full flex flex-col min-w-[20rem]">

          {/* Logo */}
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 bg-slate-900 rounded flex items-center justify-center text-white font-bold text-base">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 2v4M12 2l-3 3M12 2l3 3M5 10h14M5 10v10a1 1 0 001 1h4v-4h4v4h4a1 1 0 001-1V10M5 10l-1-4h16l-1 4" />
                </svg>
              </div>
              <div>
                <h1 className="text-lg font-black text-slate-900 tracking-tighter leading-none">CHURCH FINDER</h1>
                <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">AI-Powered Search</span>
              </div>
            </div>
          </div>

          {/* Form label */}
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xs font-bold text-slate-600 uppercase tracking-widest">Search Filters</h2>
            <button onClick={() => setForm(initialForm)} className="text-xs text-blue-700 hover:underline font-bold">Reset</button>
          </div>

          <form onSubmit={handleSearch} className="space-y-5 flex-1 overflow-y-auto pr-2">

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1.5">Country</label>
              <select
                value={form.country}
                onChange={e => setForm(f => ({ ...f, country: e.target.value }))}
                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-300 rounded-md text-sm font-medium text-slate-900 focus:ring-2 focus:ring-slate-400 outline-none"
              >
                {COUNTRIES.map(c => (
                  <option key={c.code} value={c.code}>{c.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1.5">Location <span className="normal-case font-normal text-slate-400">(optional)</span></label>
              <input
                type="text"
                value={form.location ?? ''}
                onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
                placeholder="e.g. Nashville, TN or London"
                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-300 rounded-md text-sm font-medium text-slate-900 focus:ring-2 focus:ring-slate-400 outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1.5">Search For</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setForm(f => {
                    const next = !f.includeChurches;
                    // Prevent both being off
                    if (!next && !f.includeMinistries) return f;
                    return { ...f, includeChurches: next };
                  })}
                  className={`flex-1 py-2 text-[10px] font-bold uppercase tracking-wider rounded-md border transition-colors ${
                    form.includeChurches
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-500 border-slate-300 hover:bg-slate-100'
                  }`}
                >
                  <span className="flex items-center justify-center gap-1">
                    <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${form.includeChurches ? 'bg-white border-white' : 'bg-white border-slate-400'}`}>
                      {form.includeChurches && <svg className="w-2.5 h-2.5 text-slate-900" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3.5} d="M5 13l4 4L19 7" /></svg>}
                    </span>
                    ⛪ Churches
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setForm(f => {
                    const next = !f.includeMinistries;
                    if (!next && !f.includeChurches) return f;
                    return { ...f, includeMinistries: next };
                  })}
                  className={`flex-1 py-2 text-[10px] font-bold uppercase tracking-wider rounded-md border transition-colors ${
                    form.includeMinistries
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-500 border-slate-300 hover:bg-slate-100'
                  }`}
                >
                  <span className="flex items-center justify-center gap-1">
                    <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${form.includeMinistries ? 'bg-white border-white' : 'bg-white border-slate-400'}`}>
                      {form.includeMinistries && <svg className="w-2.5 h-2.5 text-slate-900" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3.5} d="M5 13l4 4L19 7" /></svg>}
                    </span>
                    ✝ Ministries
                  </span>
                </button>
              </div>
            </div>


            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1.5 flex justify-between">
                <span>Quantity</span>
                <span className="text-slate-900">{form.quantity}</span>
              </label>
              <input
                type="range"
                min="5"
                max="100"
                step="5"
                value={form.quantity}
                onChange={e => setForm(f => ({ ...f, quantity: parseInt(e.target.value) }))}
                className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-slate-900"
              />
              <div className="flex justify-between text-[10px] text-slate-400 font-bold mt-1">
                <span>5</span><span>100</span>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1.5">Keywords / Focus</label>
              <textarea
                value={form.keywords}
                onChange={e => setForm(f => ({ ...f, keywords: e.target.value }))}
                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-300 rounded-md text-sm font-medium text-slate-900 focus:ring-2 focus:ring-slate-400 outline-none h-20 resize-none"
                placeholder={form.includeMinistries && !form.includeChurches ? 'e.g. youth, missions, food pantry, counseling' : form.includeChurches && form.includeMinistries ? 'e.g. missions, youth, food pantry' : 'e.g. missions-focused, growing, family ministry'}
              />
            </div>
          </form>

          <div className="pt-6 border-t border-slate-200 space-y-2">
            <button
              disabled={status === AppStatus.SEARCHING}
              onClick={handleSearch}
              className="w-full bg-slate-900 hover:bg-black disabled:bg-slate-400 text-white font-bold py-4 rounded-lg text-base transition-all shadow-lg active:scale-95 flex items-center justify-center gap-2"
            >
              {status === AppStatus.SEARCHING ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  SEARCHING...
                </>
              ) : (form.includeChurches && form.includeMinistries) ? 'FIND CHURCHES & MINISTRIES' : form.includeMinistries ? 'FIND MINISTRIES' : 'FIND CHURCHES'}
            </button>
          </div>
        </div>
      </aside>

      {/* ── Main ── */}
      <main className="flex-1 flex flex-col min-w-0 bg-white shadow-inner">

        {/* Top nav bar */}
        <div className="h-10 bg-slate-900 flex items-center px-4 gap-1 shrink-0">
          <button
            className="px-4 py-1 text-xs font-bold text-white bg-slate-700 rounded"
          >
            SEARCH
          </button>
          <button
            onClick={() => navigate('/database')}
            className="px-4 py-1 text-xs font-bold text-slate-400 hover:text-white transition-colors rounded flex items-center gap-1.5"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
            </svg>
            DATABASE
          </button>
          <div className="ml-auto">
            <button
              onClick={() => supabase?.auth.signOut()}
              className="px-3 py-1 text-xs font-bold text-slate-400 hover:text-white transition-colors rounded flex items-center gap-1.5"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              LOGOUT
            </button>
          </div>
        </div>

        {/* Header bar */}
        <header className="h-16 border-b border-slate-300 flex items-center justify-between px-6 shrink-0 bg-slate-100/80 backdrop-blur-md">
          <div className="flex items-center gap-6">
            <button
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className="p-2 hover:bg-slate-200 rounded border border-slate-400 text-slate-800 transition-colors"
            >
              <svg className={`w-5 h-5 transition-transform ${isSidebarOpen ? '' : 'rotate-180'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M11 19l-7-7 7-7" />
              </svg>
            </button>

            {viewMode !== 'GRID' ? (
              <button
                onClick={() => setViewMode('GRID')}
                className="text-sm font-bold text-slate-700 hover:text-slate-900 flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M15 19l-7-7 7-7" />
                </svg>
                BACK TO LIST
              </button>
            ) : (
              <h2 className="text-sm font-black text-slate-900 uppercase tracking-widest border-l-4 border-slate-900 pl-4">
                {status === AppStatus.SEARCHING
                  ? 'SEARCHING...'
                  : `RESULTS: ${churches.length} ${(form.includeChurches && form.includeMinistries) ? 'RESULTS' : form.includeMinistries ? 'MINISTRIES' : 'CHURCHES'}`}
              </h2>
            )}
          </div>

          <div className="flex items-center gap-3">
            {/* Save status message */}
            {saveStatus && saveStatus !== 'saving' && (
              <span className="text-xs font-bold text-green-700 bg-green-50 border border-green-300 rounded px-3 py-1.5">
                {saveStatus}
              </span>
            )}

            {churches.length > 0 && viewMode === 'GRID' && (
              <button
                onClick={handleSaveToDb}
                disabled={saveStatus === 'saving'}
                className="px-4 py-2 bg-indigo-600 text-white rounded font-bold text-xs hover:bg-indigo-700 disabled:bg-slate-400 transition-all uppercase shadow-md flex items-center gap-2"
              >
                {saveStatus === 'saving' ? (
                  <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
                  </svg>
                )}
                {selectedIds.size > 0 ? `Save (${selectedIds.size})` : 'Save All'}
              </button>
            )}

            {churches.length > 0 && viewMode === 'GRID' && selectedIds.size > 0 && (
              <button
                onClick={handleBatchResearch}
                disabled={status === AppStatus.RESEARCHING}
                className="px-4 py-2 bg-blue-600 text-white rounded font-bold text-xs hover:bg-blue-700 transition-all uppercase shadow-md flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                Research ({selectedIds.size})
              </button>
            )}
            {churches.length > 0 && viewMode === 'GRID' && (
              <button
                onClick={exportChurches}
                className="px-4 py-2 bg-green-700 text-white rounded font-bold text-xs hover:bg-green-800 transition-all uppercase shadow-md flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                {selectedIds.size > 0 ? `Export (${selectedIds.size})` : 'Export All'}
              </button>
            )}
          </div>
        </header>

        {/* Content area */}
        <section className="flex-1 flex flex-col overflow-hidden">

          {/* Error banner */}
          {error && (
            <div className="m-6 p-4 bg-red-100 text-red-900 rounded border border-red-300 text-sm font-bold shadow-sm flex items-start gap-3 relative">
              <svg className="w-5 h-5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              <span>{error}</span>
              <button onClick={() => setError(null)} className="absolute right-2 top-2 text-red-400 hover:text-red-600">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          )}

          {/* GRID view */}
          {viewMode === 'GRID' && (
            <div className="flex-1 flex flex-col">
              {status === AppStatus.SEARCHING ? (
                <div className="flex-1 flex flex-col items-center justify-center bg-slate-50 p-10">
                  <div className="w-full max-w-xl space-y-8 text-center">
                    <div>
                      <h3 className="text-3xl font-black text-slate-900 mb-2">
                        {(form.includeChurches && form.includeMinistries) ? 'Finding Churches & Ministries' : form.includeMinistries ? 'Finding Ministries' : 'Finding Churches'}
                      </h3>
                      <p className="text-slate-500 font-medium">Searching the web and verifying results...</p>
                    </div>
                    <div className="relative">
                      <div className="h-4 w-full bg-slate-200 rounded-full overflow-hidden shadow-inner border border-slate-300">
                        <div
                          className="h-full bg-gradient-to-r from-blue-600 to-indigo-600 transition-all duration-500 ease-out"
                          style={{ width: `${searchProgress}%` }}
                        />
                      </div>
                      <div className="mt-4 flex flex-col items-center">
                        <span className="text-5xl font-black text-slate-900 tracking-tighter tabular-nums">{searchProgress}%</span>
                        <span className="text-[10px] font-black text-blue-600 uppercase tracking-[0.2em] mt-1">Search Progress</span>
                      </div>
                    </div>
                  </div>
                </div>
              ) : churches.length > 0 ? (
                <div className="flex-1 min-h-0 overflow-x-auto overflow-y-auto bg-slate-50">
                  <table className="text-left border-collapse table-fixed" style={{ width: 50 + colWidths.reduce((a, b) => a + b, 0) }}>
                    <colgroup>
                      <col style={{ width: 50 }} />
                      {colWidths.map((w, i) => <col key={i} style={{ width: w }} />)}
                    </colgroup>
                    <thead className="sticky top-0 z-40 bg-slate-200 border-b border-slate-400">
                      <tr>
                        <th className="sticky left-0 z-50 px-4 py-2 bg-slate-200 border-r border-slate-300 text-center shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">
                          <input type="checkbox" checked={isAllSelected} onChange={toggleAll} className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer" />
                        </th>
                        {COLUMN_DEFS.map((col, i) => (
                          <th
                            key={col.key}
                            className={`relative px-4 py-2 text-xs font-bold text-slate-700 uppercase ${i < COLUMN_DEFS.length - 1 ? 'border-r' : ''} ${col.center ? 'text-center' : ''} ${col.sticky ? 'sticky left-[50px] z-50 bg-slate-200 border-slate-400 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]' : 'border-slate-300'}`}
                          >
                            {col.label}
                            <div
                              onMouseDown={startResize(i)}
                              className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize select-none hover:bg-blue-400/60 active:bg-blue-500"
                              title="Drag to resize"
                            />
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {churches.map(church => (
                        <ChurchCard
                          key={church.id}
                          church={church}
                          isActive={selectedChurch?.id === church.id}
                          isSelected={selectedIds.has(church.id)}
                          onToggleSelect={toggleSelect}
                          onSelect={handleSelectChurch}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-slate-500 gap-4">
                  <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center border border-slate-300">
                    <svg className="w-10 h-10 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 2v4M5 10h14M5 10v10a1 1 0 001 1h4v-4h4v4h4a1 1 0 001-1V10M5 10l-1-4h16l-1 4" />
                    </svg>
                  </div>
                  <p className="text-base font-bold uppercase tracking-widest">
                    {(form.includeChurches && form.includeMinistries) ? 'Click Find Churches & Ministries to search' : form.includeMinistries ? 'Click Find Ministries to search' : 'Click Find Churches to search'}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* DETAIL view */}
          {viewMode === 'DETAIL' && (
            <div className="flex-1 overflow-auto bg-slate-200 p-6 md:p-10">
              <div className="max-w-5xl mx-auto bg-white rounded-lg border border-slate-400 shadow-2xl overflow-hidden">
                <ChurchResearchPanel
                  church={selectedChurch}
                  research={research}
                  loading={researchLoading}
                />
              </div>
            </div>
          )}

          {/* BATCH SUMMARY view */}
          {viewMode === 'BATCH_SUMMARY' && (
            <div className="flex-1 overflow-auto bg-slate-200 p-6 md:p-10">
              <div className="max-w-5xl mx-auto bg-white rounded-lg border border-slate-400 shadow-2xl overflow-hidden">
                {researchLoading && !batchResearch ? (
                  <div className="p-20 flex flex-col items-center justify-center text-center">
                    <div className="w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-6"></div>
                    <h3 className="text-2xl font-black text-slate-900 mb-2">Researching Selected Churches...</h3>
                    <p className="text-slate-500 max-w-md">Gemini is searching the web for each church's history, ministries, and recent activity.</p>
                  </div>
                ) : batchResearch && (
                  <div className="p-8">
                    <h2 className="text-2xl font-black text-slate-900 mb-6 border-b border-slate-200 pb-4">
                      Batch Summary — {churches.filter(c => selectedIds.has(c.id)).length} Churches
                    </h2>

                    <div className="space-y-6 mb-8">
                      <div>
                        <h3 className="text-xs font-black text-slate-900 uppercase tracking-widest mb-3">Global Insights</h3>
                        <p className="text-sm text-slate-700 leading-relaxed">{batchResearch.globalInsights}</p>
                      </div>

                      {batchResearch.organizationalSpread && (
                        <div>
                          <h3 className="text-xs font-black text-slate-900 uppercase tracking-widest mb-3">Organizational Spread</h3>
                          <p className="text-sm text-slate-700 leading-relaxed">{batchResearch.organizationalSpread}</p>
                        </div>
                      )}

                      {batchResearch.trends?.length > 0 && (
                        <div>
                          <h3 className="text-xs font-black text-slate-900 uppercase tracking-widest mb-3">Trends Observed</h3>
                          <ul className="space-y-2">
                            {batchResearch.trends.map((t, i) => (
                              <li key={i} className="text-sm text-slate-700 flex items-start gap-2">
                                <span className="text-blue-500 mt-0.5 shrink-0">›</span>
                                {t}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>

                    <h3 className="text-xs font-black text-slate-900 uppercase tracking-widest mb-4 border-t border-slate-200 pt-4">Individual Summaries</h3>
                    <div className="space-y-4">
                      {churches.filter(c => selectedIds.has(c.id)).map(church => {
                        const ind = batchResearch.individualInsights[church.id];
                        return (
                          <div key={church.id} className="bg-slate-50 rounded-lg p-4 border border-slate-200">
                            <div className="flex items-start justify-between gap-2 mb-2">
                              <div>
                                <span className="text-sm font-black text-slate-900">{church.name}</span>
                                {church.organizationType && (
                                  <span className="text-xs text-slate-500 ml-2">{church.organizationType}</span>
                                )}
                              </div>
                              <span className="text-[10px] text-slate-400 shrink-0">{church.city}</span>
                            </div>
                            {ind?.summary && (
                              <p className="text-xs text-slate-600 leading-relaxed">{ind.summary}</p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

        </section>
      </main>
    </div>
  );
};

export default App;
