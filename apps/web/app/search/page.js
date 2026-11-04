'use client';
import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '../../lib/api';
import { Guard } from '../../components/Guard';
import { CONNECT_ROLES } from '../../lib/roles';

const TYPES = [
  ['', 'All'],
  ['course', 'Courses'],
  ['resource', 'Resources'],
  ['people', 'People'],
  ['post', 'Posts'],
  ['knowledge', 'Knowledge'],
];

function SearchInner() {
  const router = useRouter();
  const params = useSearchParams();
  const query = (params.get('q') || '').trim();
  const type = params.get('types') || '';
  const [draft, setDraft] = useState(query);
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => { setDraft(query); }, [query]);

  useEffect(() => {
    let active = true;
    if (query.length < 2) {
      setData(null);
      setMsg('');
      return undefined;
    }
    setBusy(true);
    setMsg('');
    const suffix = type ? `&types=${encodeURIComponent(type)}` : '';
    api(`/search?q=${encodeURIComponent(query)}${suffix}`)
      .then((result) => { if (active) setData(result); })
      .catch((error) => { if (active) { setData(null); setMsg(error.message); } })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [query, type]);

  function go(nextQuery, nextType = type) {
    const value = nextQuery.trim();
    if (value.length < 2) return;
    const suffix = nextType ? `&types=${encodeURIComponent(nextType)}` : '';
    router.push(`/search?q=${encodeURIComponent(value)}${suffix}`);
  }

  return (
    <div>
      <h1 style={{ margin: '4px 0' }}>Search</h1>
      <p style={{ color: '#64748b' }}>Find courses, verified resources, people, posts and approved knowledge you are allowed to see.</p>

      <form
        className="form-card"
        role="search"
        onSubmit={(event) => { event.preventDefault(); go(draft); }}
        style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}
      >
        <input
          type="text"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Search at least two characters…"
          aria-label="Search query"
          style={{ flex: 1, minWidth: 220 }}
        />
        <button className="btn" type="submit" disabled={draft.trim().length < 2 || busy}>Search</button>
      </form>

      <div className="tabs">
        {TYPES.map(([value, label]) => (
          <button
            key={value || 'all'}
            type="button"
            className={type === value ? 'on' : ''}
            onClick={() => { if (query.length >= 2) go(query, value); }}
          >
            {label}
          </button>
        ))}
      </div>

      {msg && <div className="alert-err">{msg}</div>}
      {busy && <div className="card"><div className="skeleton" style={{ height: 18, marginBottom: 8 }} /><div className="skeleton" style={{ height: 18, width: '70%' }} /></div>}
      {!busy && query.length < 2 && <div className="card"><p>Type at least two characters to search.</p></div>}
      {!busy && data && (
        <>
          <p style={{ color: '#64748b', fontSize: 13 }}>
            {data.total} result{data.total === 1 ? '' : 's'} for <b>{data.query}</b> · {data.tookMs} ms
            {data.facets && Object.keys(data.facets).length > 0 && (
              <> · {Object.entries(data.facets).map(([key, value]) => `${key}: ${value}`).join(' · ')}</>
            )}
          </p>
          {!data.results.length && (
            <div className="card">
              <h3>No matches</h3>
              <p>Try a course code such as MIS-352, a person’s name, or a broader phrase.</p>
              {data.suggestions?.length > 0 && (
                <div className="toolbar">
                  {data.suggestions.map((suggestion) => (
                    <button key={suggestion} type="button" className="btn-ghost btn-sm" onClick={() => { setDraft(suggestion); go(suggestion, ''); }}>
                      {suggestion}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <div className="grid">
            {data.results.map((result) => (
              <div className="card" key={`${result.type}-${result.id}`}>
                <span className="badge blue">{result.type}</span>
                <h3 style={{ marginTop: 8 }}>
                  <Link href={result.url || '/'} style={{ color: 'var(--navy)', textDecoration: 'none' }}>{result.title}</Link>
                </h3>
                {result.subtitle && <p>{result.subtitle}</p>}
                {result.snippet && <p style={{ fontSize: 13 }}>{result.snippet}</p>}
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 8 }}>
                  <Link className="go" href={result.url || '/'}>Open →</Link>
                  {result.type === 'resource' && result.meta?.url && (
                    <a className="go" href={result.meta.url} target="_blank" rel="noreferrer">External link ↗</a>
                  )}
                </div>
              </div>
            ))}
          </div>
          {data.suggestions?.length > 0 && (
            <div className="card" style={{ marginTop: 12 }}>
              <b>Related searches</b>
              <div className="toolbar">
                {data.suggestions.map((suggestion) => (
                  <button key={suggestion} type="button" className="btn-ghost btn-sm" onClick={() => { setDraft(suggestion); go(suggestion, ''); }}>
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function SearchPage() {
  return (
    <Guard roles={CONNECT_ROLES}>
      <Suspense fallback={<div className="card"><p>Loading search…</p></div>}>
        <SearchInner />
      </Suspense>
    </Guard>
  );
}
