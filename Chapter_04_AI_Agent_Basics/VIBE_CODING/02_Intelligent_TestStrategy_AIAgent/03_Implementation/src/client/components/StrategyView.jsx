import React, { useMemo, useState } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

const PENDING = 'Pending Human Approval';

export function ApprovalGate({ result, busy, onApprove }) {
  const [approver, setApprover] = useState('');
  const approved = result.approvalStatus !== PENDING;

  return (
    <div className={`gate ${approved ? 'approved' : ''}`}>
      <div className="gate-head">
        <strong>Approval Status:</strong>
        <span className={`pill ${approved ? 'pill-ok' : 'pill-pending'}`}>{result.approvalStatus}</span>
      </div>
      {!approved && (
        <>
          <p className="small muted">
            Review the assumptions, unconfirmed information and open questions in Section 12. To request changes,
            describe them in the message box below. Approve only if you are authorized to do so.
          </p>
          <form className="gate-row" onSubmit={(e) => { e.preventDefault(); onApprove(approver.trim()); }}>
            <input value={approver} onChange={(e) => setApprover(e.target.value)} placeholder="Approver name" aria-label="Approver name" maxLength={80} />
            <button className="btn primary" type="submit" disabled={busy || approver.trim().length < 2}>Approve Strategy</button>
          </form>
        </>
      )}
    </div>
  );
}

export default function StrategyView({ markdown }) {
  const html = useMemo(() => DOMPurify.sanitize(marked.parse(markdown, { gfm: true })), [markdown]);
  return <article className="markdown" dangerouslySetInnerHTML={{ __html: html }} />;
}
