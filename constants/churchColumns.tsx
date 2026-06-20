
import React, { useState, useRef, useEffect } from 'react';
import { Church, OutreachStatus } from '../types';
import { COUNTRIES } from './countries';

/**
 * ─── SINGLE SOURCE OF TRUTH FOR TABLE COLUMNS ──────────────────────────────────
 *
 * Both the Search results table (App.tsx) and the Database table (DatabasePage.tsx)
 * render from CHURCH_COLUMNS + <ChurchTableHeader> + <ChurchRow> below.
 *
 * To add, rename, reorder, resize, or re-render a column, edit it HERE ONCE and
 * both tables update together. Add a `case` in renderCell() for any new key.
 */

export interface ColumnDef {
  key: string;
  label: string;
  width: number;
  sticky?: boolean;
  center?: boolean;
}

export const CHURCH_COLUMNS: ColumnDef[] = [
  { key: 'select',      label: '',                     width: 48,  sticky: true, center: true },
  { key: 'name',        label: 'Church / Ministry',    width: 240, sticky: true },
  { key: 'address',     label: 'Address',              width: 280 },
  { key: 'city',        label: 'City',                 width: 120 },
  { key: 'state',       label: 'State / Province',     width: 130 },
  { key: 'country',     label: 'Country',              width: 120 },
  { key: 'pastor',      label: 'Pastor / Leader',      width: 170 },
  { key: 'phone',       label: 'Phone',                width: 150 },
  { key: 'email',       label: 'Email',                width: 200 },
  { key: 'website',     label: 'Website',              width: 200 },
  { key: 'socials',     label: 'Socials',              width: 110 },
  { key: 'description', label: 'Description',          width: 300 },
  { key: 'saved',       label: 'Saved',                width: 100 },
  { key: 'status',      label: 'Outreach Status',      width: 170 },
  { key: 'actions',     label: '',                     width: 80,  center: true },
];

export const STATUS_CONFIG: Record<OutreachStatus, { label: string; color: string }> = {
  not_contacted: { label: 'Not Contacted', color: 'bg-slate-100 text-slate-600 border-slate-300' },
  contacted:     { label: 'Contacted',     color: 'bg-blue-100 text-blue-700 border-blue-300' },
  responded:     { label: 'Responded',     color: 'bg-yellow-100 text-yellow-700 border-yellow-300' },
  converted:     { label: 'Converted',     color: 'bg-green-100 text-green-700 border-green-300' },
};

export const STATUS_ORDER: OutreachStatus[] = ['not_contacted', 'contacted', 'responded', 'converted'];

export function safeUrl(url: string | null | undefined): string | undefined {
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

/** Cumulative left offset (px) for each sticky column, based on the live widths. */
function stickyLefts(widths: number[]): number[] {
  const lefts: number[] = [];
  let acc = 0;
  CHURCH_COLUMNS.forEach((col, i) => {
    lefts[i] = acc;
    if (col.sticky) acc += widths[i];
  });
  return lefts;
}

// ─── Header (shared) ──────────────────────────────────────────────────────────

interface HeaderProps {
  widths: number[];
  startResize: (index: number) => (e: React.MouseEvent) => void;
  /** When provided, the `select` column header shows a select-all checkbox. */
  selectAll?: { checked: boolean; onChange: () => void };
}

export const ChurchTableHeader: React.FC<HeaderProps> = ({ widths, startResize, selectAll }) => {
  const lefts = stickyLefts(widths);
  return (
    <thead className="sticky top-0 z-40 bg-slate-200 border-b border-slate-400">
      <tr>
        {CHURCH_COLUMNS.map((col, i) => (
          <th
            key={col.key}
            style={col.sticky ? { left: lefts[i] } : undefined}
            className={`relative px-4 py-2 text-xs font-bold text-slate-700 uppercase whitespace-nowrap overflow-hidden text-ellipsis ${
              i < CHURCH_COLUMNS.length - 1 ? 'border-r' : ''
            } ${col.center ? 'text-center' : ''} ${
              col.sticky
                ? 'sticky z-50 bg-slate-200 border-slate-400 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]'
                : 'border-slate-300'
            }`}
          >
            {col.key === 'select' && selectAll ? (
              <input
                type="checkbox"
                checked={selectAll.checked}
                onChange={selectAll.onChange}
                className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
              />
            ) : (
              col.label
            )}
            <div
              onMouseDown={startResize(i)}
              className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize select-none hover:bg-blue-400/60 active:bg-blue-500"
              title="Drag to resize"
            />
          </th>
        ))}
      </tr>
    </thead>
  );
};

// ─── Row (shared) ─────────────────────────────────────────────────────────────

export interface ChurchRowContext {
  mode: 'search' | 'database';
  /** Background class for the row and its sticky cells (e.g. alternating stripes). */
  rowBg: string;
  isSelected: boolean;
  isActive?: boolean;
  onToggleSelect: (id: string) => void;
  /** Search: open deep-research detail for this church. */
  onRowClick?: (church: Church) => void;
  /** Database: change the outreach status. */
  onStatusChange?: (church: Church, next: OutreachStatus) => void;
  /** Database: inline-edit any text field. */
  onFieldChange?: (church: Church, field: keyof Church, value: string) => void;
  /** Database: delete this record. */
  onDelete?: (church: Church) => void;
  /** Database: inspect/research this church. */
  onInspect?: (church: Church) => void;
  updating?: boolean;
  deleting?: boolean;
}

// ─── Inline-editable cell (database mode) ─────────────────────────────────────
// Double-click the value to edit it; Enter or blur saves, Escape cancels.
interface EditableCellProps {
  church: Church;
  field: keyof Church;
  type: 'text' | 'country';
  onSave: (church: Church, field: keyof Church, value: string) => void;
  children: React.ReactNode;
}

const EditableCell: React.FC<EditableCellProps> = ({ church, field, type, onSave, children }) => {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const ref = useRef<HTMLInputElement & HTMLSelectElement>(null);

  useEffect(() => {
    if (editing && ref.current) {
      ref.current.focus();
      if (ref.current.select) ref.current.select();
    }
  }, [editing]);

  const begin = (e: React.MouseEvent) => {
    e.stopPropagation();
    setValue(((church[field] as string) ?? '').toString());
    setEditing(true);
  };

  const current = ((church[field] as string) ?? '').toString();

  const commit = () => {
    setEditing(false);
    const next = value.trim();
    if (next !== current) onSave(church, field, next);
  };

  const cancel = () => setEditing(false);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  };

  if (editing) {
    const cls = 'w-full text-sm border border-blue-400 rounded px-1.5 py-1 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-400';
    if (type === 'country') {
      return (
        <select
          ref={ref}
          value={value}
          onClick={e => e.stopPropagation()}
          onChange={e => setValue(e.target.value)}
          onBlur={commit}
          onKeyDown={onKeyDown}
          className={`${cls} cursor-pointer`}
        >
          <option value="">—</option>
          {COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
        </select>
      );
    }
    return (
      <input
        ref={ref}
        type="text"
        value={value}
        onClick={e => e.stopPropagation()}
        onChange={e => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
        className={cls}
      />
    );
  }

  return (
    <div
      onDoubleClick={begin}
      title="Double-click to edit"
      className="group/edit relative cursor-text rounded -mx-1 px-1 hover:bg-blue-50/70 hover:ring-1 hover:ring-blue-200 transition-colors"
    >
      {children}
      <svg
        className="absolute top-1/2 -translate-y-1/2 right-0.5 w-3 h-3 text-blue-400 opacity-0 group-hover/edit:opacity-100 pointer-events-none"
        fill="none" stroke="currentColor" viewBox="0 0 24 24"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
      </svg>
    </div>
  );
};

/** Which columns can be inline-edited in database mode, and with what input. */
const EDITABLE_COLUMNS: Partial<Record<string, { field: keyof Church; type: 'text' | 'country' }>> = {
  name:        { field: 'name',        type: 'text' },
  address:     { field: 'address',     type: 'text' },
  city:        { field: 'city',        type: 'text' },
  state:       { field: 'state',       type: 'text' },
  country:     { field: 'country',     type: 'country' },
  pastor:      { field: 'pastor',      type: 'text' },
  phone:       { field: 'phone',       type: 'text' },
  email:       { field: 'email',       type: 'text' },
  website:     { field: 'website',     type: 'text' },
  description: { field: 'description', type: 'text' },
};

const getConfColor = (score = 0) => {
  if (score >= 80) return 'bg-emerald-100 text-emerald-800 border-emerald-200';
  if (score >= 55) return 'bg-blue-100 text-blue-800 border-blue-200';
  return 'bg-amber-100 text-amber-800 border-amber-200';
};

function renderCell(col: ColumnDef, church: Church, ctx: ChurchRowContext): React.ReactNode {
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  switch (col.key) {
    case 'select':
      return (
        <input
          type="checkbox"
          checked={ctx.isSelected}
          onChange={() => ctx.onToggleSelect(church.id)}
          onClick={stop}
          className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
        />
      );

    case 'name':
      return (
        <>
          <div className="flex items-center gap-1.5 whitespace-nowrap">
            <span className="text-sm font-bold text-slate-900 truncate max-w-full">{church.name}</span>
            {church.confidenceScore !== undefined && (
              <span
                className={`text-[8px] px-1.5 py-0.5 rounded-full border font-black shrink-0 ${getConfColor(church.confidenceScore)}`}
                title="Data confidence score"
              >
                {church.confidenceScore}%
              </span>
            )}
          </div>
        </>
      );

    case 'address':
      return <span className="text-sm text-slate-700 truncate block max-w-full" title={church.address}>{church.address || '—'}</span>;

    case 'city':
      return <span className="text-sm text-slate-600">{church.city || '—'}</span>;

    case 'state':
      return <span className="text-sm text-slate-600">{church.state || '—'}</span>;

    case 'country': {
      const name = COUNTRIES.find(c => c.code === (church.country || '').toUpperCase())?.name || church.country || '—';
      return <span className="text-sm text-slate-600">{name}</span>;
    }

    case 'pastor':
      return <span className="text-sm text-slate-700 truncate block max-w-full">{church.pastor || '—'}</span>;

    case 'phone':
      return church.phone ? (
        <div className="flex items-center gap-2">
          <a
            href={church.phoneIsWhatsApp ? `https://wa.me/${church.phone.replace(/\D/g, '')}` : `tel:${church.phone}`}
            onClick={stop}
            target={church.phoneIsWhatsApp ? '_blank' : undefined}
            rel={church.phoneIsWhatsApp ? 'noopener noreferrer' : undefined}
            className="text-sm text-slate-700 hover:text-green-700"
          >
            {church.phoneCountryCode && <span className="font-semibold">{church.phoneCountryCode} </span>}
            {church.phone}
          </a>
          {church.phoneIsWhatsApp && (
            <svg className="w-4 h-4 text-green-600" fill="currentColor" viewBox="0 0 24 24" title="WhatsApp">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.076 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421-7.403h-.004a9.87 9.87 0 00-4.951 1.263 9.87 9.87 0 00-3.197 2.663A9.87 9.87 0 001.05 12.011c0 5.445 4.557 9.854 10.154 9.854a10.11 10.11 0 007.157-2.863 9.87 9.87 0 002.863-7.157c0-5.453-4.557-9.854-10.154-9.854z"/>
            </svg>
          )}
        </div>
      ) : (
        <span className="text-sm text-slate-400">—</span>
      );

    case 'email':
      return church.email ? (
        <a href={`mailto:${church.email}`} onClick={stop} className="text-sm text-blue-600 hover:underline truncate block max-w-full">
          {church.email}
        </a>
      ) : (
        <span className="text-sm text-slate-400">—</span>
      );

    case 'website': {
      const websiteUrl = safeUrl(church.website);
      return websiteUrl ? (
        <a
          href={websiteUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={stop}
          className="text-xs text-blue-600 hover:underline truncate block max-w-full"
        >
          {websiteUrl.replace(/^https?:\/\//, '').split('/')[0]}
        </a>
      ) : (
        <span className="text-sm text-slate-400">—</span>
      );
    }

    case 'socials': {
      const fbUrl = safeUrl(church.facebook);
      const igUrl = safeUrl(church.instagram);
      const ytUrl = safeUrl(church.youtube);
      return (
        <div className="flex items-center gap-2">
          {fbUrl && (
            <a href={fbUrl} target="_blank" rel="noopener noreferrer" onClick={stop} className="text-blue-600 hover:text-blue-800" title="Facebook">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
              </svg>
            </a>
          )}
          {igUrl && (
            <a href={igUrl} target="_blank" rel="noopener noreferrer" onClick={stop} className="text-pink-600 hover:text-pink-800" title="Instagram">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
              </svg>
            </a>
          )}
          {ytUrl && (
            <a href={ytUrl} target="_blank" rel="noopener noreferrer" onClick={stop} className="text-red-600 hover:text-red-800" title="YouTube">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
              </svg>
            </a>
          )}
          {!fbUrl && !igUrl && !ytUrl && <span className="text-xs text-slate-300">—</span>}
        </div>
      );
    }

    case 'description':
      return <p className="text-xs text-slate-600 truncate max-w-full" title={church.description}>{church.description || '—'}</p>;

    case 'saved':
      return (
        <span className="text-xs text-slate-500 whitespace-nowrap">
          {church.savedAt ? new Date(church.savedAt).toLocaleDateString() : '—'}
        </span>
      );

    case 'status': {
      const status = church.outreachStatus || 'not_contacted';
      const cfg = STATUS_CONFIG[status];
      // In search results the church isn't saved yet, so show a read-only badge.
      if (ctx.mode === 'search' || !ctx.onStatusChange) {
        return (
          <span className={`inline-block text-xs font-bold border rounded px-2 py-1 ${cfg.color}`}>
            {cfg.label}
          </span>
        );
      }
      return (
        <select
          value={status}
          disabled={ctx.updating}
          onClick={stop}
          onChange={e => ctx.onStatusChange!(church, e.target.value as OutreachStatus)}
          className={`w-full text-xs font-bold border rounded px-2 py-1 cursor-pointer focus:outline-none focus:ring-2 focus:ring-slate-400 appearance-none ${cfg.color} ${ctx.updating ? 'opacity-50' : ''}`}
        >
          {STATUS_ORDER.map(s => (
            <option key={s} value={s}>{STATUS_CONFIG[s].label}</option>
          ))}
        </select>
      );
    }

    case 'actions':
      if (ctx.mode === 'database') {
        return (
          <div className="flex items-center gap-1.5">
            <button
              onClick={e => { stop(e); ctx.onInspect?.(church); }}
              className="p-1 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
              title="Inspect & Research"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </button>
            <button
              onClick={e => { stop(e); ctx.onDelete?.(church); }}
              disabled={ctx.deleting}
              className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors disabled:opacity-50"
              title="Remove from database"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
        );
      }
      // Search: inspect → open deep research.
      return (
        <button
          onClick={e => { stop(e); ctx.onRowClick?.(church); }}
          className="p-1.5 bg-slate-100 rounded border border-slate-300 hover:bg-blue-600 hover:text-white transition-colors shadow-sm"
          title="Inspect"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      );

    default:
      return null;
  }
}

interface RowProps {
  church: Church;
  widths: number[];
  ctx: ChurchRowContext;
}

export const ChurchRow: React.FC<RowProps> = ({ church, widths, ctx }) => {
  const lefts = stickyLefts(widths);
  const trBg = ctx.isActive ? 'bg-blue-50' : ctx.isSelected ? 'bg-blue-100' : ctx.rowBg;
  const clickable = ctx.mode === 'search' && ctx.onRowClick;
  const canEdit = ctx.mode === 'database' && !!ctx.onFieldChange;

  return (
    <tr
      onClick={clickable ? () => ctx.onRowClick!(church) : undefined}
      className={`border-b border-slate-200 ${trBg} hover:bg-blue-50/40 transition-colors leading-tight ${
        clickable ? 'cursor-pointer' : ''
      }`}
    >
      {CHURCH_COLUMNS.map((col, i) => {
        const editable = canEdit ? EDITABLE_COLUMNS[col.key] : undefined;
        const content = renderCell(col, church, ctx);
        return (
          <td
            key={col.key}
            style={col.sticky ? { left: lefts[i] } : undefined}
            className={`px-4 py-0.5 whitespace-nowrap overflow-hidden ${i < CHURCH_COLUMNS.length - 1 ? 'border-r border-slate-200' : ''} ${
              col.center ? 'text-center' : ''
            } ${col.sticky ? `sticky z-10 ${trBg} shadow-[2px_0_5px_-2px_rgba(0,0,0,0.06)]` : ''}`}
          >
            {editable ? (
              <EditableCell church={church} field={editable.field} type={editable.type} onSave={ctx.onFieldChange!}>
                {content}
              </EditableCell>
            ) : (
              content
            )}
          </td>
        );
      })}
    </tr>
  );
};
