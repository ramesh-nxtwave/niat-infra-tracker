import "./_group.css";

const compactScanStyles = `
  .compact-scan-preview {
    --scan-ink: #172236;
    --scan-muted: #68778b;
    --scan-rule: #d8e1ea;
    --scan-panel: #ffffff;
    --scan-canvas: #edf2f6;
    --scan-accent: #1f5d61;
    --scan-accent-soft: #e4f0ef;
    width: 100%;
    min-height: 560px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 18px 10px;
    background:
      linear-gradient(115deg, rgba(31, 93, 97, 0.035), transparent 42%),
      var(--scan-canvas);
    color: var(--scan-ink);
    font-family: "Outfit", "Manrope", system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
  }

  .compact-scan-card {
    width: min(740px, 100%);
    overflow: hidden;
    border: 1px solid var(--scan-rule);
    border-radius: 10px;
    background: var(--scan-panel);
    box-shadow: 0 12px 28px rgba(23, 34, 54, 0.07);
  }

  .compact-scan-topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 18px;
    min-height: 66px;
    padding: 0 22px;
    border-bottom: 1px solid var(--scan-rule);
    background: #f8fafb;
  }

  .compact-scan-kicker {
    margin: 0 0 4px;
    color: var(--scan-muted);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: .12em;
    line-height: 1;
    text-transform: uppercase;
  }

  .compact-scan-university {
    margin: 0;
    font-size: 21px;
    font-weight: 700;
    letter-spacing: -.025em;
    line-height: 1.2;
  }

  .compact-scan-count {
    flex: 0 0 auto;
    margin: 0;
    color: var(--scan-muted);
    font-size: 15px;
    font-weight: 600;
    white-space: nowrap;
  }

  .compact-scan-count strong {
    color: var(--scan-accent);
    font-size: 20px;
    font-weight: 700;
    letter-spacing: -.03em;
  }

  .compact-scan-label {
    display: block;
    margin-bottom: 9px;
    color: var(--scan-muted);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: .1em;
    line-height: 1;
    text-transform: uppercase;
  }

  .compact-scan-row {
    display: grid;
    grid-template-columns: minmax(0, 2.2fr) minmax(112px, .75fr) minmax(104px, .72fr);
    gap: 20px;
    align-items: center;
    padding: 23px 22px 20px;
  }

  .compact-scan-name {
    margin: 0;
    font-size: 20px;
    font-weight: 700;
    letter-spacing: -.025em;
    line-height: 1.22;
  }

  .compact-scan-category {
    display: block;
    margin-top: 6px;
    color: var(--scan-muted);
    font-size: 14px;
    line-height: 1.25;
  }

  .compact-scan-status {
    display: inline-flex;
    align-items: center;
    width: fit-content;
    margin: 0;
    padding: 6px 9px;
    border: 1px solid #b9d4d1;
    border-radius: 4px;
    background: var(--scan-accent-soft);
    color: var(--scan-accent);
    font-size: 13px;
    font-weight: 700;
    line-height: 1;
    white-space: nowrap;
  }

  .compact-scan-status::before {
    width: 6px;
    height: 6px;
    margin-right: 7px;
    border-radius: 50%;
    background: #8aa5a3;
    content: "";
  }

  .compact-scan-value {
    margin: 0;
    color: var(--scan-ink);
    font-size: 15px;
    font-weight: 600;
    line-height: 1.25;
  }

  .compact-scan-rule {
    height: 1px;
    margin: 0 22px;
    background: var(--scan-rule);
  }

  .compact-scan-meta {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px 28px;
    padding: 18px 22px 20px;
  }

  .compact-scan-meta-item {
    min-width: 0;
  }

  .compact-scan-meta-item dt {
    margin-bottom: 5px;
    color: var(--scan-muted);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: .08em;
    text-transform: uppercase;
  }

  .compact-scan-meta-item dd {
    margin: 0;
    color: var(--scan-ink);
    font-size: 15px;
    line-height: 1.3;
  }

  .compact-scan-remarks {
    margin: 0 22px 22px;
    padding: 13px 14px;
    border-left: 3px solid #b7c9d3;
    background: #f4f7f9;
    color: var(--scan-muted);
    font-size: 14px;
    line-height: 1.35;
  }

  .compact-scan-remarks strong {
    color: var(--scan-ink);
    font-weight: 700;
  }

  .compact-scan-card:focus-within {
    outline: 3px solid rgba(31, 93, 97, .18);
    outline-offset: 3px;
  }

  @media (max-width: 540px) {
    .compact-scan-preview {
      min-height: 100dvh;
      padding: 10px;
      align-items: flex-start;
    }

    .compact-scan-topbar {
      align-items: flex-start;
      flex-direction: column;
      gap: 8px;
      padding: 17px 17px 15px;
    }

    .compact-scan-row {
      grid-template-columns: 1fr 1fr;
      gap: 17px 14px;
      padding: 19px 17px 17px;
    }

    .compact-scan-primary {
      grid-column: 1 / -1;
    }

    .compact-scan-name {
      font-size: 19px;
    }

    .compact-scan-rule {
      margin: 0 17px;
    }

    .compact-scan-meta {
      gap: 15px 17px;
      padding: 17px;
    }

    .compact-scan-remarks {
      margin: 0 17px 17px;
    }
  }
`;

export default function CompactScan() {
  return (
    <main className="compact-scan-preview">
      <style>{compactScanStyles}</style>
      <article className="compact-scan-card" aria-label="Pending infrastructure item">
        <header className="compact-scan-topbar">
          <div>
            <p className="compact-scan-kicker">Pending infrastructure</p>
            <p className="compact-scan-university">Geeta University</p>
          </div>
          <p className="compact-scan-count"><strong>47</strong> pending items</p>
        </header>

        <section className="compact-scan-row" aria-labelledby="compact-scan-item-name">
          <div className="compact-scan-primary">
            <span className="compact-scan-label">Item</span>
            <h1 className="compact-scan-name" id="compact-scan-item-name">
              3D Printing Table / Assembly Table
            </h1>
            <span className="compact-scan-category">(Furniture)</span>
          </div>
          <div>
            <span className="compact-scan-label">Status</span>
            <p className="compact-scan-status">Yet to start</p>
          </div>
          <div>
            <span className="compact-scan-label">Location</span>
            <p className="compact-scan-value">5.0 Lab</p>
          </div>
        </section>

        <div className="compact-scan-rule" />

        <dl className="compact-scan-meta">
          <div className="compact-scan-meta-item">
            <dt>Target Date</dt>
            <dd>No target date provided</dd>
          </div>
        </dl>

        <p className="compact-scan-remarks">
          <strong>Remarks:</strong> No remarks provided
        </p>
      </article>
    </main>
  );
}