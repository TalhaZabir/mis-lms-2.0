'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function GlobalSearch() {
  const router = useRouter();
  const [q, setQ] = useState('');

  function submit(event) {
    event.preventDefault();
    const value = q.trim();
    if (value.length < 2) return;
    router.push(`/search?q=${encodeURIComponent(value)}`);
  }

  return (
    <form className="nav-search" role="search" onSubmit={submit}>
      <input
        type="text"
        value={q}
        onChange={(event) => setQ(event.target.value)}
        placeholder="Search…"
        aria-label="Search courses, people, posts and resources"
      />
      <button type="submit" aria-label="Search">Go</button>
    </form>
  );
}
