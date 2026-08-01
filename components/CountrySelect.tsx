import React, { useEffect, useMemo, useRef, useState } from 'react';
import { COUNTRIES } from '../constants/countries';

interface Props {
  value: string;
  onChange: (code: string) => void;
}

const CountrySelect: React.FC<Props> = ({ value, onChange }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const selectedName = COUNTRIES.find(c => c.code === value)?.name ?? '';

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return COUNTRIES;
    return COUNTRIES.filter(c => c.name.toLowerCase().includes(q) || c.code.toLowerCase() === q)
      .sort((a, b) => {
        const aStarts = a.name.toLowerCase().startsWith(q) ? 0 : 1;
        const bStarts = b.name.toLowerCase().startsWith(q) ? 0 : 1;
        return aStarts - bStarts || a.name.localeCompare(b.name);
      });
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) close();
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.children[highlight]?.scrollIntoView({ block: 'nearest' });
  }, [highlight, open]);

  const close = () => {
    setOpen(false);
    setQuery('');
  };

  const select = (code: string) => {
    onChange(code);
    close();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) { setOpen(true); return; }
      setHighlight(h => {
        const next = e.key === 'ArrowDown' ? h + 1 : h - 1;
        return Math.max(0, Math.min(matches.length - 1, next));
      });
    } else if (e.key === 'Enter') {
      if (open) {
        e.preventDefault();
        if (matches[highlight]) select(matches[highlight].code);
      }
    } else if (e.key === 'Escape') {
      close();
    }
  };

  return (
    <div ref={wrapRef} className="relative">
      <input
        type="text"
        value={open ? query : selectedName}
        placeholder="Type or pick a country"
        onChange={e => { setQuery(e.target.value); setHighlight(0); setOpen(true); }}
        onFocus={() => { setOpen(true); setQuery(''); setHighlight(0); }}
        onKeyDown={onKeyDown}
        onBlur={close}
        role="combobox"
        aria-expanded={open}
        className="w-full px-4 py-2.5 bg-slate-50 border border-slate-300 rounded-md text-sm font-medium text-slate-900 focus:ring-2 focus:ring-slate-400 outline-none"
      />
      {open && (
        <ul
          ref={listRef}
          className="absolute z-30 mt-1 w-full max-h-64 overflow-y-auto bg-white border border-slate-300 rounded-md shadow-lg"
        >
          {matches.length === 0 && (
            <li className="px-4 py-2.5 text-sm text-slate-400">No countries match</li>
          )}
          {matches.map((c, i) => (
            <li
              key={c.code}
              onMouseEnter={() => setHighlight(i)}
              onMouseDown={e => { e.preventDefault(); select(c.code); }}
              className={`px-4 py-2 text-sm cursor-pointer ${
                i === highlight ? 'bg-slate-100' : ''
              } ${c.code === value ? 'font-bold text-slate-900' : 'text-slate-700'}`}
            >
              {c.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default CountrySelect;
