import "./_group.css";

/**
 * Status-led hypothesis:
 * The operational state and missing target date are the first scan targets.
 * This remains a static, read-only summary: the quiet hover treatment adds
 * depth without making any surface look actionable.
 */
export default function StatusLed() {
  return (
    <>
      <style>{`
        .pending-status-led-preview {
          --status-ink: #19263a;
          --status-muted: #66768b;
          --status-line: #d7e0e8;
          --status-panel: #f8fafb;
          --status-paper: #ffffff;
          --status-urgent-wash: #fff6ea;
          --status-urgent-ink: #9a581f;
          --status-navy: #203f59;
          box-sizing: border-box;
          width: 100%;
          min-height: 560px;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 22px 16px;
          background:
            linear-gradient(115deg, rgba(220, 230, 235, .45), transparent 43%),
            #edf2f5;
          color: var(--status-ink);
          font-family: "Outfit", "Manrope", system-ui, sans-serif;
          -webkit-font-smoothing: antialiased;
        }

        .pending-status-led-card {
          width: min(728px, 100%);
          overflow: hidden;
          border: 1px solid rgba(180, 195, 205, .8);
          border-radius: 12px;
          background: var(--status-paper);
          box-shadow: 0 16px 34px rgba(43, 63, 78, .11);
        }

        .pending-status-led-heading {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 20px;
          padding: 19px 24px 17px;
          border-bottom: 1px solid var(--status-line);
        }

        .pending-status-led-university,
        .pending-status-led-count {
          margin: 0;
          line-height: 1.2;
        }

        .pending-status-led-university {
          font-size: 21px;
          font-weight: 700;
          letter-spacing: -.025em;
        }

        .pending-status-led-count {
          color: var(--status-muted);
          font-size: 16px;
          font-weight: 500;
          white-space: nowrap;
        }

        .pending-status-led-content {
          padding: 21px 24px 23px;
        }

        .pending-status-led-signal-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
          margin-bottom: 22px;
        }

        .pending-status-led-signal {
          min-height: 91px;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          padding: 14px 16px 13px;
          border: 1px solid var(--status-line);
          border-radius: 8px;
          background: var(--status-panel);
          transition: border-color 160ms ease, background-color 160ms ease;
        }

        .pending-status-led-signal:hover {
          border-color: #b7c7d2;
          background: #f4f8f9;
        }

        .pending-status-led-signal--date {
          border-color: #e9d4bc;
          background: var(--status-urgent-wash);
        }

        .pending-status-led-signal--date:hover {
          border-color: #dfbf9c;
          background: #fff2df;
        }

        .pending-status-led-label {
          color: var(--status-muted);
          font-size: 12px;
          font-weight: 700;
          letter-spacing: .095em;
          line-height: 1.2;
          text-transform: uppercase;
        }

        .pending-status-led-value {
          display: flex;
          align-items: center;
          gap: 9px;
          color: var(--status-navy);
          font-size: 21px;
          font-weight: 700;
          letter-spacing: -.02em;
          line-height: 1.15;
        }

        .pending-status-led-signal--date .pending-status-led-value {
          color: var(--status-urgent-ink);
          font-size: 18px;
        }

        .pending-status-led-dot {
          width: 9px;
          height: 9px;
          flex: 0 0 auto;
          border: 2px solid #73899b;
          border-radius: 50%;
          background: transparent;
        }

        .pending-status-led-item {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 160px;
          gap: 22px;
          align-items: start;
          padding: 0 0 17px;
          border-bottom: 1px solid var(--status-line);
        }

        .pending-status-led-name {
          margin: 0;
          font-size: 22px;
          font-weight: 700;
          letter-spacing: -.025em;
          line-height: 1.23;
        }

        .pending-status-led-category {
          display: block;
          margin-top: 5px;
          color: var(--status-muted);
          font-size: 16px;
          line-height: 1.3;
        }

        .pending-status-led-location {
          margin: 2px 0 0;
          color: var(--status-muted);
          font-size: 15px;
          line-height: 1.35;
        }

        .pending-status-led-location strong {
          color: var(--status-ink);
          font-weight: 700;
        }

        .pending-status-led-remarks {
          margin: 16px 0 0;
          padding: 13px 15px;
          border-left: 3px solid #c6d1d9;
          background: #f4f7f8;
          color: var(--status-muted);
          font-size: 15px;
          line-height: 1.4;
        }

        .pending-status-led-remarks strong {
          color: var(--status-ink);
          font-weight: 700;
        }

        @media (max-width: 540px) {
          .pending-status-led-preview {
            min-height: 100dvh;
            align-items: flex-start;
            padding: 10px;
          }

          .pending-status-led-heading {
            align-items: flex-start;
            flex-direction: column;
            gap: 7px;
            padding: 18px 18px 16px;
          }

          .pending-status-led-content {
            padding: 18px;
          }

          .pending-status-led-signal-grid {
            grid-template-columns: 1fr;
            gap: 9px;
            margin-bottom: 19px;
          }

          .pending-status-led-signal {
            min-height: 76px;
          }

          .pending-status-led-item {
            grid-template-columns: 1fr;
            gap: 8px;
          }

          .pending-status-led-name {
            font-size: 20px;
          }
        }
      `}</style>

      <main className="pending-status-led-preview">
        <article className="pending-status-led-card" aria-label="Pending infrastructure item">
          <header className="pending-status-led-heading">
            <p className="pending-status-led-university">Geeta University</p>
            <p className="pending-status-led-count">47 pending items</p>
          </header>

          <section className="pending-status-led-content" aria-labelledby="pending-status-led-item-name">
            <div className="pending-status-led-signal-grid" aria-label="Operational signals">
              <div className="pending-status-led-signal" aria-label="Status: Yet to start">
                <span className="pending-status-led-label">Status</span>
                <span className="pending-status-led-value">
                  <span className="pending-status-led-dot" aria-hidden="true" />
                  Yet to start
                </span>
              </div>
              <div className="pending-status-led-signal pending-status-led-signal--date" aria-label="Target Date: No target date provided">
                <span className="pending-status-led-label">Target date</span>
                <span className="pending-status-led-value">No target date provided</span>
              </div>
            </div>

            <div className="pending-status-led-item">
              <div>
                <h1 className="pending-status-led-name" id="pending-status-led-item-name">
                  3D Printing Table / Assembly Table
                </h1>
                <span className="pending-status-led-category">(Furniture)</span>
              </div>
              <p className="pending-status-led-location">
                <strong>Location:</strong><br />
                5.0 Lab
              </p>
            </div>

            <p className="pending-status-led-remarks">
              <strong>Remarks:</strong> No remarks provided
            </p>
          </section>
        </article>
      </main>
    </>
  );
}