import "./_group.css";

const detailRows = [
  { label: "Location", value: "5.0 Lab" },
  { label: "Target date", value: "No target date provided" },
];

export default function ExpandableDetail() {
  return (
    <main className="pending-expandable-preview">
      <article
        className="pending-expandable-card"
        aria-label="Pending infrastructure item"
      >
        <header className="pending-expandable-header">
          <div>
            <p className="pending-expandable-kicker">Infrastructure pending report</p>
            <p className="pending-expandable-university">Geeta University</p>
          </div>
          <p className="pending-expandable-count">
            <strong>47</strong>
            <span>pending items</span>
          </p>
        </header>

        <section className="pending-expandable-body">
          <div className="pending-expandable-title-row">
            <div>
              <h1 className="pending-expandable-name">
                3D Printing Table / Assembly Table
              </h1>
              <p className="pending-expandable-category">Furniture</p>
            </div>
            <span className="pending-expandable-status">Yet to start</span>
          </div>

          <div className="pending-expandable-scanline" aria-label="Item status">
            <span className="pending-expandable-scan-label">Status</span>
            <span className="pending-expandable-scan-value">Yet to start</span>
          </div>

          <details className="pending-expandable-details">
            <summary>
              <span>View item details</span>
              <span className="pending-expandable-summary-hint">2 fields + remarks</span>
            </summary>
            <div className="pending-expandable-detail-grid">
              {detailRows.map((row) => (
                <div className="pending-expandable-detail" key={row.label}>
                  <dt>{row.label}</dt>
                  <dd>{row.value}</dd>
                </div>
              ))}
              <div className="pending-expandable-remarks">
                <dt>Remarks</dt>
                <dd>No remarks provided</dd>
              </div>
            </div>
          </details>
        </section>

        <footer className="pending-expandable-footer">
          <span>Shared pending-item summary</span>
          <span className="pending-expandable-rule" aria-hidden="true" />
          <span>NIAT InfraTracker</span>
        </footer>
      </article>

      <style>{`
        .pending-expandable-preview {
          --expand-ink: #192a38;
          --expand-muted: #667887;
          --expand-faint: #e5ecee;
          --expand-canvas: #eef3f1;
          --expand-surface: #fbfcfa;
          --expand-accent: #b65f3e;
          --expand-accent-soft: #f4e7de;
          box-sizing: border-box;
          width: 100%;
          min-height: 560px;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 26px 18px;
          background:
            linear-gradient(135deg, rgba(255, 255, 255, 0.42), transparent 42%),
            var(--expand-canvas);
          color: var(--expand-ink);
          font-family: "Outfit", "Manrope", system-ui, sans-serif;
          -webkit-font-smoothing: antialiased;
        }

        .pending-expandable-card {
          width: min(710px, 100%);
          overflow: hidden;
          border: 1px solid rgba(25, 42, 56, 0.1);
          border-radius: 12px;
          background: var(--expand-surface);
          box-shadow: 0 11px 28px rgba(42, 66, 72, 0.09);
        }

        .pending-expandable-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 22px;
          padding: 19px 25px 18px;
          border-bottom: 1px solid var(--expand-faint);
          background: rgba(255, 255, 255, 0.7);
        }

        .pending-expandable-kicker,
        .pending-expandable-university,
        .pending-expandable-count,
        .pending-expandable-footer {
          margin: 0;
        }

        .pending-expandable-kicker {
          margin-bottom: 5px;
          color: var(--expand-accent);
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.12em;
          line-height: 1;
          text-transform: uppercase;
        }

        .pending-expandable-university {
          font-size: 23px;
          font-weight: 700;
          letter-spacing: -0.025em;
          line-height: 1.1;
        }

        .pending-expandable-count {
          display: flex;
          align-items: baseline;
          gap: 7px;
          color: var(--expand-muted);
          white-space: nowrap;
        }

        .pending-expandable-count strong {
          color: var(--expand-ink);
          font-size: 27px;
          font-weight: 700;
          letter-spacing: -0.04em;
        }

        .pending-expandable-count span {
          font-size: 14px;
          font-weight: 500;
        }

        .pending-expandable-body {
          padding: 25px 25px 20px;
        }

        .pending-expandable-title-row {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
        }

        .pending-expandable-name {
          max-width: 515px;
          margin: 0;
          font-size: 24px;
          font-weight: 700;
          letter-spacing: -0.025em;
          line-height: 1.2;
        }

        .pending-expandable-category {
          margin: 7px 0 0;
          color: var(--expand-muted);
          font-size: 15px;
          line-height: 1.2;
        }

        .pending-expandable-status {
          flex: 0 0 auto;
          margin-top: 2px;
          padding: 6px 9px;
          border: 1px solid #dfc5b8;
          border-radius: 999px;
          background: var(--expand-accent-soft);
          color: #8a4c36;
          font-size: 12px;
          font-weight: 700;
          line-height: 1;
          white-space: nowrap;
        }

        .pending-expandable-scanline {
          display: flex;
          align-items: baseline;
          gap: 14px;
          margin-top: 24px;
          padding: 12px 0 13px;
          border-top: 1px solid var(--expand-faint);
          border-bottom: 1px solid var(--expand-faint);
        }

        .pending-expandable-scan-label,
        .pending-expandable-detail dt {
          color: var(--expand-muted);
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.095em;
          text-transform: uppercase;
        }

        .pending-expandable-scan-value {
          font-size: 15px;
          font-weight: 600;
        }

        .pending-expandable-details {
          margin-top: 15px;
        }

        .pending-expandable-details summary {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          cursor: pointer;
          list-style: none;
          color: var(--expand-ink);
          font-size: 14px;
          font-weight: 700;
          outline: none;
        }

        .pending-expandable-details summary::-webkit-details-marker {
          display: none;
        }

        .pending-expandable-details summary::after {
          width: 7px;
          height: 7px;
          margin-left: auto;
          border-right: 1.5px solid var(--expand-accent);
          border-bottom: 1.5px solid var(--expand-accent);
          content: "";
          transform: rotate(45deg) translateY(-2px);
          transition: transform 160ms ease;
        }

        .pending-expandable-details[open] summary::after {
          transform: rotate(225deg) translate(-1px, -1px);
        }

        .pending-expandable-details summary:focus-visible {
          border-radius: 4px;
          box-shadow: 0 0 0 3px rgba(182, 95, 62, 0.22);
        }

        .pending-expandable-details summary:hover span:first-child {
          color: var(--expand-accent);
        }

        .pending-expandable-summary-hint {
          color: var(--expand-muted);
          font-size: 12px;
          font-weight: 500;
        }

        .pending-expandable-detail-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 13px 28px;
          padding: 17px 0 2px;
        }

        .pending-expandable-detail,
        .pending-expandable-remarks {
          min-width: 0;
        }

        .pending-expandable-detail dt,
        .pending-expandable-detail dd,
        .pending-expandable-remarks dt,
        .pending-expandable-remarks dd {
          margin: 0;
        }

        .pending-expandable-detail dd,
        .pending-expandable-remarks dd {
          margin-top: 5px;
          color: var(--expand-ink);
          font-size: 14px;
          line-height: 1.35;
        }

        .pending-expandable-remarks {
          grid-column: 1 / -1;
          padding: 12px 13px;
          border-left: 3px solid var(--expand-accent);
          background: #f4f6f3;
        }

        .pending-expandable-footer {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 12px 25px;
          border-top: 1px solid var(--expand-faint);
          color: var(--expand-muted);
          font-size: 11px;
          letter-spacing: 0.04em;
        }

        .pending-expandable-rule {
          width: 3px;
          height: 3px;
          border-radius: 50%;
          background: var(--expand-accent);
        }

        @media (max-width: 540px) {
          .pending-expandable-preview {
            min-height: 100dvh;
            padding: 12px 10px;
          }

          .pending-expandable-header {
            align-items: flex-start;
            flex-direction: column;
            gap: 13px;
            padding: 18px 18px;
          }

          .pending-expandable-body {
            padding: 21px 18px 18px;
          }

          .pending-expandable-title-row {
            display: block;
          }

          .pending-expandable-status {
            display: inline-block;
            margin-top: 13px;
          }

          .pending-expandable-name {
            font-size: 21px;
          }

          .pending-expandable-detail-grid {
            grid-template-columns: 1fr;
            gap: 14px;
          }

          .pending-expandable-remarks {
            grid-column: auto;
          }

          .pending-expandable-footer {
            padding-inline: 18px;
            font-size: 10px;
          }
        }
      `}</style>
    </main>
  );
}