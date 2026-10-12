import React, { useState } from "react";
import {
  Activity, BarChart3, Bell, Building2, ChevronRight,
  CircleHelp, ClipboardCheck, LayoutDashboard, LogOut, Menu, Search,
  Settings, ShieldCheck, SlidersHorizontal, X
} from "lucide-react";
import "./InfraTrackerRail.css";

type NavKey = "Overview" | "Universities" | "Master Tracker" | "Evidence Board";

const campuses = [
  { name: "KL University", meta: "Hyderabad · Ready 18 Jun", score: "42%", issue: "3 blockers" },
  { name: "SRM Institute", meta: "Chennai · Ready 26 Jun", score: "68%", issue: "1 blocker" },
  { name: "Lovely Professional", meta: "Punjab · Ready 04 Jul", score: "81%", issue: "On track" },
];

const ranking = [
  ["Lovely Professional", "92%", "92%"], ["SRM Institute", "81%", "81%"],
  ["KL University", "68%", "68%"], ["VIT Bhopal", "57%", "57%"],
];

export default function InfraTrackerRail() {
  const [active, setActive] = useState<NavKey>("Overview");
  const [notice, setNotice] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);

  const nav: { label: NavKey; icon: React.ReactNode; count?: number }[] = [
    { label: "Overview", icon: <LayoutDashboard size={15} /> },
    { label: "Universities", icon: <Building2 size={15} /> },
    { label: "Master Tracker", icon: <ClipboardCheck size={15} /> },
    { label: "Evidence Board", icon: <ShieldCheck size={15} />, count: 4 },
  ] as const;

  return (
    <div className="itr">
      <div className="itr-shell">
        <aside className={`itr-rail ${mobileMenu ? "open" : ""}`}>
          <div className="itr-brand">
            <div className="itr-brandmark"><Activity size={18} /></div>
            <div><strong>InfraTracker</strong><span>NIAT operations</span></div>
          </div>
          <div className="itr-rail-label">Workspace</div>
          <nav className="itr-nav" aria-label="Primary navigation">
            {nav.map((item) => (
              <button key={item.label} className={active === item.label ? "active" : ""} onClick={() => { setActive(item.label); setMobileMenu(false); }}>
                {item.icon}<span>{item.label}</span>{item.count ? <span className="count">{item.count}</span> : null}
              </button>
            ))}
          </nav>
          <div className="itr-rail-label" style={{ marginTop: 27 }}>System</div>
          <nav className="itr-nav">
            <button onClick={() => setNotice(true)}><Settings size={15} /><span>Settings</span></button>
            <button onClick={() => setNotice(true)}><CircleHelp size={15} /><span>Support desk</span></button>
          </nav>
          <div className="itr-rail-foot">
            <div className="itr-avatar">RR</div><div><b>Riteesh Reddy</b><small>Executive admin</small></div>
            <LogOut size={14} style={{ marginLeft: "auto", color: "#8190ae" }} />
          </div>
        </aside>

        <main className="itr-main">
          <header className="itr-top">
            <div>
              <button className="itr-icon-btn itr-mobile-menu" onClick={() => setMobileMenu((v) => !v)} aria-label="Toggle navigation">
                {mobileMenu ? <X size={16} /> : <Menu size={16} />}
              </button>
              <p className="itr-kicker">Portfolio / {active}</p>
              <h1>Good morning, Riteesh.</h1>
              <p className="itr-sub">One view of every campus moving toward infrastructure readiness.</p>
            </div>
            <div className="itr-top-actions">
              <button className="itr-icon-btn" onClick={() => setNotice(true)} aria-label="Search"><Search size={16} /></button>
              <button className="itr-icon-btn" onClick={() => setNotice(true)} aria-label="Notifications"><Bell size={16} /></button>
              <button className="itr-icon-btn" onClick={() => setNotice(true)} aria-label="Filters"><SlidersHorizontal size={16} /></button>
            </div>
          </header>

          <div className="itr-grid">
            <section className="itr-card itr-overview">
              <div>
                <h2>Portfolio readiness</h2><p>Across 24 active university deployments</p>
                <div className="itr-progress" aria-label="68 percent ready"><i /></div>
                <div className="itr-stats">
                  <div className="itr-stat"><strong>24</strong><span>Campuses</span></div>
                  <div className="itr-stat"><strong>07</strong><span>Due this month</span></div>
                  <div className="itr-stat"><strong>12</strong><span>Open blockers</span></div>
                </div>
              </div>
              <div className="itr-overview-number"><strong>68%</strong><small>+6.4% from last week</small></div>
            </section>

            <section className="itr-card itr-section">
              <div className="itr-section-head"><h2>Needs attention</h2><button onClick={() => setActive("Universities")}>View all <ChevronRight size={11} style={{ verticalAlign: "middle" }} /></button></div>
              {campuses.map((campus) => (
                <button className="itr-campus" key={campus.name} onClick={() => setNotice(true)} style={{ width: "100%", background: "none", border: 0, textAlign: "left", cursor: "pointer" }}>
                  <div className="itr-campus-mark">{campus.name.slice(0, 2).toUpperCase()}</div>
                  <div><h3>{campus.name}</h3><p>{campus.meta}</p></div>
                  <aside><strong>{campus.score}</strong><span style={{ color: campus.issue === "On track" ? "var(--teal)" : undefined }}>{campus.issue}</span></aside>
                </button>
              ))}
            </section>

            <section className="itr-card itr-rank">
              <div className="itr-section-head"><h2>Readiness ranking</h2><BarChart3 size={16} color="#8d99ad" /></div>
              <div className="itr-rank-list">
                {ranking.map(([name, score, width], i) => <div className="itr-rank-item" key={name}><em>0{i + 1}</em><div><b>{name}</b><i style={{ "--score": width } as React.CSSProperties} /></div><span>{score}</span></div>)}
              </div>
            </section>

            <section className="itr-card itr-timeline">
              <div className="itr-section-head"><h2>Readiness pulse</h2><button onClick={() => setNotice(true)}>Last 30 days <ChevronRight size={11} style={{ verticalAlign: "middle" }} /></button></div>
              <div className="itr-timeline-list">
                <div className="itr-step"><div className="itr-step-dot" /><h4>Allocation</h4><p>18 campuses complete</p></div>
                <div className="itr-step"><div className="itr-step-dot" /><h4>Procurement</h4><p>14 campuses complete</p></div>
                <div className="itr-step warn"><div className="itr-step-dot" /><h4>Staffing</h4><p>6 campuses need owners</p></div>
                <div className="itr-step late"><div className="itr-step-dot" /><h4>Handover</h4><p>3 deadlines at risk</p></div>
              </div>
            </section>
          </div>
        </main>
      </div>
      {notice && <div className="itr-drawer"><strong>Command center note</strong><p>This preview keeps the InfraTracker workflow intact while reorganising it around a focused rail and a two-column action surface.</p><button onClick={() => setNotice(false)}>Dismiss</button></div>}
    </div>
  );
}