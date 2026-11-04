'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '../../lib/api';
import { Guard } from '../../components/Guard';
import { CONNECT_ROLES } from '../../lib/roles';

function AssistantInner() {
  const [status, setStatus] = useState(null);
  const [statusError, setStatusError] = useState('');
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');

  useEffect(() => {
    let active = true;
    api('/ai/status')
      .then((value) => { if (active) setStatus(value); })
      .catch((error) => { if (active) setStatusError(error.message); });
    return () => { active = false; };
  }, []);

  async function ask(event) {
    event.preventDefault();
    const value = question.trim();
    if (value.length < 3) return;
    setBusy(true);
    setMsg('');
    setAnswer(null);
    setFeedback('');
    try {
      const result = await api('/ai/ask', { method: 'POST', body: JSON.stringify({ question: value }) });
      setAnswer(result);
    } catch (error) {
      setMsg(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function sendFeedback(helpful) {
    if (!answer?.usageId) return;
    try {
      await api('/ai/feedback', {
        method: 'POST',
        body: JSON.stringify({ usageId: answer.usageId, helpful, rating: helpful ? 5 : 1 }),
      });
      setFeedback(helpful ? 'Thanks — marked as helpful.' : 'Thanks — feedback recorded.');
    } catch (error) {
      setFeedback(error.message);
    }
  }

  return (
    <div>
      <h1 style={{ margin: '4px 0' }}>Assistant</h1>
      <p style={{ color: '#64748b' }}>An optional, read-only academic assistant grounded in approved institutional knowledge.</p>

      {statusError && <div className="alert-err">{statusError}</div>}

      {!status && !statusError && <div className="card"><div className="skeleton" style={{ height: 18, width: '60%' }} /></div>}

      {status && !status.enabled && (
        <div className="card">
          <span className="badge gold">Disabled</span>
          <h3 style={{ marginTop: 8 }}>The assistant is switched off on this deployment</h3>
          <p>AI is behind a feature flag (<span className="kbd">AI_ENABLED</span>). It stays disabled by default and no external provider is called until an administrator explicitly enables it.</p>
          <p>You can still use <Link href="/search">Search</Link> to find courses, resources and approved knowledge.</p>
        </div>
      )}

      {status && status.enabled && (
        <>
          <div className="card">
            <span className="badge green">Read-only</span>
            <span className="badge blue" style={{ marginLeft: 6 }}>{status.provider} · {status.model}</span>
            <p style={{ marginTop: 8 }}>{status.notice}</p>
            <p style={{ fontSize: 13 }}>
              It can explain recorded information and retrieve authorized sources. It cannot change grades, publish results, delete records or change permissions.
            </p>
            {status.readOnlyTools?.length > 0 && (
              <div className="toolbar">
                {status.readOnlyTools.map((tool) => (
                  <span className="badge" key={tool.name || tool}>{tool.name || tool}</span>
                ))}
              </div>
            )}
            <p style={{ fontSize: 12 }}>Daily limit: {status.limits?.dailyRequests} requests per user. Answers are advisory, not official policy.</p>
          </div>

          <form className="form-card" onSubmit={ask}>
            <label htmlFor="assistant-question"><b>Ask about your courses, policies or approved materials</b></label>
            <textarea
              id="assistant-question"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="e.g. What is the assessment breakdown for MIS-352?"
              style={{ width: '100%', marginTop: 8 }}
            />
            <div className="toolbar">
              <button className="btn" type="submit" disabled={busy || question.trim().length < 3}>{busy ? 'Thinking…' : 'Ask assistant'}</button>
              <span style={{ fontSize: 12, color: '#64748b' }}>{question.length}/2000</span>
            </div>
          </form>

          {msg && <div className="alert-err">{msg}</div>}
          {answer && (
            <div className="card" aria-live="polite" style={{ marginTop: 12 }}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <span className={`badge ${answer.blocked ? 'red' : answer.grounded ? 'green' : 'gold'}`}>
                  {answer.blocked ? 'Blocked by guardrail' : answer.grounded ? 'Grounded answer' : 'No authorized sources'}
                </span>
                {answer.provider && <span className="badge">{answer.provider} · {answer.model}</span>}
              </div>
              <p style={{ whiteSpace: 'pre-wrap', fontSize: 14.5, lineHeight: 1.55 }}>{answer.answer}</p>
              {answer.citations?.length > 0 && <p style={{ fontSize: 13 }}>Citations: {answer.citations.map((citation) => `[${citation}]`).join(' ')}</p>}
              {answer.sources?.length > 0 && (
                <>
                  <h3>Sources</h3>
                  {answer.sources.map((source) => (
                    <div key={source.chunkId || source.documentId} style={{ borderTop: '1px solid var(--line)', padding: '10px 0' }}>
                      <b>[{source.marker}] {source.title}</b>
                      <span className="badge" style={{ marginLeft: 6 }}>{source.kind || 'DOC'} · {source.visibility}</span>
                      {source.excerpt && <p style={{ fontSize: 13 }}>{source.excerpt}</p>}
                      {source.sourceUrl && <a href={source.sourceUrl} target="_blank" rel="noreferrer">Open source ↗</a>}
                    </div>
                  ))}
                </>
              )}
              {answer.usageId && (
                <div className="toolbar">
                  <button type="button" className="btn-ghost btn-sm" onClick={() => sendFeedback(true)}>Helpful</button>
                  <button type="button" className="btn-ghost btn-sm" onClick={() => sendFeedback(false)}>Not helpful</button>
                  {feedback && <span style={{ fontSize: 12, color: '#64748b' }}>{feedback}</span>}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function AssistantPage() {
  return (
    <Guard roles={CONNECT_ROLES}>
      <AssistantInner />
    </Guard>
  );
}
