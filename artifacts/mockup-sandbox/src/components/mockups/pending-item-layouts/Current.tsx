import "./_group.css";

export default function Current() {
  return (
    <main className="pending-item-preview">
      <article className="pending-item-card" aria-label="Pending infrastructure item">
        <header className="pending-item-header">
          <p className="pending-item-university">Geeta University</p>
          <p className="pending-item-count">47 pending items</p>
        </header>

        <section className="pending-item-body">
          <h1 className="pending-item-name">3D Printing Table / Assembly Table</h1>
          <span className="pending-item-category">(Furniture)</span>

          <p className="pending-item-detail">
            <strong>Status:</strong> Yet to start
          </p>
          <p className="pending-item-detail">
            <strong>Location:</strong> 5.0 Lab
          </p>
          <p className="pending-item-detail">
            <strong>Target Date:</strong> No target date provided
          </p>
          <p className="pending-item-remarks">
            <strong>Remarks:</strong> No remarks provided
          </p>
        </section>
      </article>
    </main>
  );
}