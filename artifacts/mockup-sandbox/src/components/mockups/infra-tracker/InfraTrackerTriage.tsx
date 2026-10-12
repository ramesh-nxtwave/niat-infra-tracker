import React, { useMemo, useState } from "react";
import {
  Activity, ArrowUpRight, Bell, Check, ChevronDown, CircleHelp,
  LayoutGrid, ListChecks, Plus, Search, Settings, ShieldAlert,
  SlidersHorizontal, Sparkles, X
} from "lucide-react";

type Campus = {
  name: string;
  city: string;
  code: string;
  score: number;
  blocker: string;
  owner: string;
  due: string;
  tone: "critical" | "watch" | "ready";
};

const campuses: Campus[] = [
  { name: "KL University", city: "Hyderabad", code: "KU", score: 42, blocker: "Network room drawings missing", owner: "AM", due: "Today", tone: "critical" },
  { name: "SRM Institute", city: "Chennai", code: "SI", score: 68, blocker: "ISP quotation awaiting approval", owner: "NS", due: "18 Jun", tone: "watch" },
  { name: "Lovely Professional", city: "Punjab", code: "LP", score: 81, blocker: "No active blockers", owner: "RK", due: "04 Jul", tone: "ready" },
  { name: "VIT Bhopal", city: "Bhopal", code: "VB", score: 57, blocker: "Lab access window not confirmed", owner: "PS", due: "21 Jun", tone: "watch" },
];

const filters = ["All campuses", "Needs owner", "Due this week"];

export default function InfraTrackerTriage() {
  const [selected, setSelected] = useState("KL University");
  const [filter, setFilter] = useState("All campuses");
  const [query, setQuery] = useState("");
  const [done, setDone] = useState<string[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState("");

  const visible = useMemo(() => campuses.filter((campus) => {
    const matchesSearch = `${campus.name} ${campus.city}`.toLowerCase().includes(query.toLowerCase());
    const matchesFilter = filter === "All campuses" || (filter === "Needs owner" && campus.owner === "PS") || (filter === "Due this week" && campus.due === "Today");
    return matchesSearch && matchesFilter;
  }), [filter, query]);
  const focus = campuses.find((campus) => campus.name === selected) ?? campuses[0];

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2400);
  };

  return (
    <div className="triage">
      <style>{`
        .triage{--ink:#19243a;--muted:#768197;--paper:#f4f6fa;--card:#fff;--line:#e3e8f0;--navy:#202d48;--cobalt:#385fea;--mint:#149780;--amber:#d89029;--coral:#d85361;min-height:100vh;background:var(--paper);color:var(--ink);font-family:"Plus Jakarta Sans",ui-sans-serif,system-ui,sans-serif;letter-spacing:-.015em}
        .triage *{box-sizing:border-box}.triage button{font:inherit}.triage-shell{display:grid;grid-template-columns:72px 1fr;min-height:100vh}
        .triage-rail{background:var(--navy);display:flex;flex-direction:column;align-items:center;padding:22px 0;color:#aab7d0}.triage-mark{width:36px;height:36px;border-radius:12px;background:#4b6df4;color:#fff;display:grid;place-items:center;box-shadow:0 8px 18px #121d3799;margin-bottom:45px}.triage-rail button{width:40px;height:40px;border:0;background:transparent;color:#8190ae;border-radius:11px;display:grid;place-items:center;cursor:pointer;margin-bottom:10px}.triage-rail button:hover,.triage-rail button.active{background:#354b80;color:#fff}.triage-rail .bottom{margin-top:auto}
        .triage-main{max-width:1450px;width:100%;padding:28px 42px 46px;margin:0 auto}.triage-header{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;margin-bottom:28px}.triage-eyebrow{color:var(--cobalt);font-weight:900;font-size:10px;text-transform:uppercase;letter-spacing:.16em;margin:0 0 8px}.triage h1{font-size:32px;letter-spacing:-.065em;line-height:1.05;margin:0}.triage-lede{color:var(--muted);font-size:12px;margin:9px 0 0}.triage-actions{display:flex;gap:8px;align-items:center}.triage-icon{width:36px;height:36px;border:1px solid var(--line);background:#fff;border-radius:10px;color:var(--muted);display:grid;place-items:center;cursor:pointer}.triage-icon:hover{color:var(--cobalt);border-color:#b7c6f9}.triage-primary{border:0;background:var(--cobalt);color:#fff;border-radius:9px;height:36px;padding:0 14px;font-size:11px;font-weight:800;display:flex;align-items:center;gap:7px;cursor:pointer}
        .triage-layout{display:grid;grid-template-columns:minmax(360px,.9fr) minmax(420px,1.25fr);gap:18px;align-items:start}.triage-panel{background:var(--card);border:1px solid var(--line);border-radius:15px;box-shadow:0 8px 24px #27385b08}.triage-list{padding:19px}.triage-panel-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:15px}.triage h2{font-size:14px;letter-spacing:-.035em;margin:0}.triage-caption{font-size:10px;color:var(--muted);margin:5px 0 0}.triage-filter{position:relative}.triage-filter select{appearance:none;border:1px solid var(--line);background:#fbfcfe;border-radius:7px;padding:7px 25px 7px 9px;font-size:10px;color:var(--muted);cursor:pointer}.triage-filter svg{position:absolute;right:7px;top:8px;pointer-events:none;color:var(--muted)}
        .triage-search{height:34px;border:1px solid var(--line);border-radius:8px;display:flex;align-items:center;gap:8px;padding:0 10px;color:#a1aabc;margin-bottom:12px}.triage-search input{border:0;outline:0;min-width:0;width:100%;font:inherit;font-size:11px;color:var(--ink);background:transparent}.triage-campus{width:100%;display:grid;grid-template-columns:36px 1fr auto;gap:11px;align-items:center;text-align:left;border:1px solid transparent;border-top-color:#edf0f5;background:transparent;padding:14px 2px;cursor:pointer}.triage-campus:first-of-type{border-top:0}.triage-campus:hover,.triage-campus.selected{background:#f7f9ff;border-color:#d6dffc;border-radius:10px;padding-left:9px;padding-right:9px}.triage-code{width:36px;height:36px;border-radius:10px;display:grid;place-items:center;background:#edf2ff;color:var(--cobalt);font-weight:900;font-size:10px}.triage-campus.selected .triage-code{background:var(--cobalt);color:#fff}.triage-campus strong{display:block;font-size:11px}.triage-campus small{display:block;font-size:9px;color:var(--muted);margin-top:4px}.triage-score{text-align:right}.triage-score b{font-size:14px}.triage-score span{display:block;font-size:9px;font-weight:800;margin-top:3px}.critical{color:var(--coral)}.watch{color:var(--amber)}.ready{color:var(--mint)}
        .triage-focus{overflow:hidden}.triage-focus-top{padding:21px 22px 19px;background:#23314f;color:#fff;position:relative}.triage-focus-top:after{content:"";position:absolute;right:-42px;top:-75px;width:210px;height:210px;border:1px solid #6175ad55;border-radius:50%;box-shadow:0 0 0 24px #6175ad12,0 0 0 49px #6175ad09}.triage-focus-top .triage-eyebrow{color:#9db2ff}.triage-focus-top h2{font-size:21px;letter-spacing:-.06em;position:relative;z-index:1}.triage-focus-top p{color:#b3c0da;font-size:11px;margin:6px 0 0;position:relative;z-index:1}.triage-focus-meta{display:flex;gap:28px;margin-top:20px;position:relative;z-index:1}.triage-focus-meta b{font-size:22px;letter-spacing:-.06em}.triage-focus-meta span{display:block;font-size:9px;color:#aebbd5;margin-top:3px}.triage-focus-body{padding:19px 22px}.triage-progress-label{display:flex;justify-content:space-between;align-items:center;font-size:10px;font-weight:800}.triage-progress-label span{color:var(--muted);font-weight:600}.triage-progress{height:8px;background:#e9edf4;border-radius:8px;overflow:hidden;margin:10px 0 21px}.triage-progress i{display:block;width:42%;height:100%;background:var(--cobalt);border-radius:8px}.triage-blocker{border:1px solid #f2d8d8;background:#fff8f8;padding:13px;border-radius:10px;display:flex;align-items:flex-start;gap:10px}.triage-blocker svg{color:var(--coral);flex:none;margin-top:1px}.triage-blocker b{display:block;font-size:11px}.triage-blocker p{font-size:10px;color:var(--muted);line-height:1.45;margin:4px 0 0}.triage-section-title{font-size:10px;text-transform:uppercase;letter-spacing:.12em;color:var(--muted);font-weight:900;margin:22px 0 10px}.triage-check{display:flex;align-items:center;gap:10px;padding:9px 0;border-top:1px solid #eef1f5;font-size:10px}.triage-check input{appearance:none;width:16px;height:16px;border:1px solid #c7cfdd;border-radius:5px;cursor:pointer;background:#fff;position:relative}.triage-check input:checked{background:var(--mint);border-color:var(--mint)}.triage-check input:checked:after{content:"✓";color:#fff;font-size:11px;position:absolute;left:3px;top:-1px}.triage-check.done span{text-decoration:line-through;color:#a1a9b8}.triage-owner{margin-left:auto;color:var(--muted);font-size:9px}.triage-footer{display:flex;justify-content:space-between;align-items:center;margin-top:18px}.triage-footer button{border:0;background:transparent;color:var(--cobalt);font-weight:800;font-size:10px;cursor:pointer}.triage-footer .triage-primary{color:#fff;background:var(--cobalt)}.triage-toast{position:fixed;right:22px;bottom:20px;background:#23314f;color:#fff;padding:12px 15px;border-radius:9px;font-size:11px;box-shadow:0 12px 28px #1b294544;animation:triage-in .2s ease-out;z-index:5}@keyframes triage-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}} 
        @media(max-width:800px){.triage-shell{grid-template-columns:1fr}.triage-rail{height:62px;flex-direction:row;padding:0 14px;gap:5px}.triage-mark{margin:0 12px 0 0}.triage-rail button{margin:0}.triage-rail .bottom{margin:0 0 0 auto}.triage-main{padding:24px 16px 35px}.triage-layout{grid-template-columns:1fr}.triage-header{margin-bottom:21px}.triage h1{font-size:27px}.triage-actions .triage-primary{font-size:0;width:36px;padding:0;justify-content:center}.triage-actions .triage-primary svg{margin:0}}
        @media(max-width:460px){.triage-header{display:block}.triage-actions{margin-top:16px}.triage-actions .triage-primary{font-size:11px;width:auto;padding:0 12px}.triage-focus-meta{gap:20px}.triage-layout{display:flex;flex-direction:column}.triage-panel{width:100%}}
      `}</style>
      <div className="triage-shell">
        <aside className="triage-rail">
          <div className="triage-mark"><Activity size={18} /></div>
          <button className="active" onClick={() => notify("Portfolio view is already open")} aria-label="Portfolio"><LayoutGrid size={17} /></button>
          <button onClick={() => notify("Master Tracker selected")} aria-label="Master tracker"><ListChecks size={17} /></button>
          <button onClick={() => notify("Evidence board selected")} aria-label="Evidence"><ShieldAlert size={17} /></button>
          <div className="bottom">
            <button onClick={() => notify("Settings are available to workspace admins")} aria-label="Settings"><Settings size={17} /></button>
            <button onClick={() => notify("Support desk opened")} aria-label="Support"><CircleHelp size={17} /></button>
          </div>
        </aside>
        <main className="triage-main">
          <header className="triage-header">
            <div>
              <p className="triage-eyebrow">Operations / Triage view</p>
              <h1>Make the next move obvious.</h1>
              <p className="triage-lede">A focused queue for the campuses that need an owner today.</p>
            </div>
            <div className="triage-actions">
              <button className="triage-icon" onClick={() => notify("No new notifications")} aria-label="Notifications"><Bell size={15} /></button>
              <button className="triage-icon" onClick={() => setMenuOpen((open) => !open)} aria-label="More actions">{menuOpen ? <X size={15} /> : <SlidersHorizontal size={15} />}</button>
              <button className="triage-primary" onClick={() => notify("New campus intake started")}><Plus size={14} /> Add campus</button>
            </div>
          </header>
          <div className="triage-layout">
            <section className="triage-panel triage-list">
              <div className="triage-panel-head">
                <div><h2>Campus queue</h2><p className="triage-caption">{visible.length} of 24 deployments shown</p></div>
                <div className="triage-filter"><select value={filter} onChange={(event) => setFilter(event.target.value)} aria-label="Filter campuses">{filters.map((item) => <option key={item}>{item}</option>)}</select><ChevronDown size={12} /></div>
              </div>
              <div className="triage-search"><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search campus or city" /></div>
              {visible.map((campus) => <button key={campus.name} className={`triage-campus ${selected === campus.name ? "selected" : ""}`} onClick={() => setSelected(campus.name)}>
                <div className="triage-code">{campus.code}</div><div><strong>{campus.name}</strong><small>{campus.city} · owner {campus.owner}</small></div><div className="triage-score"><b>{campus.score}%</b><span className={campus.tone}>{campus.due}</span></div>
              </button>)}
              {visible.length === 0 && <div style={{ padding: "24px 5px", color: "var(--muted)", fontSize: 11 }}>No campuses match that search.</div>}
            </section>
            <section className="triage-panel triage-focus">
              <div className="triage-focus-top"><p className="triage-eyebrow">Selected campus</p><h2>{focus.name}</h2><p>{focus.city} · Readiness plan in progress</p><div className="triage-focus-meta"><div><b>{focus.score}%</b><span>ready</span></div><div><b>{focus.due}</b><span>next deadline</span></div><div><b>{focus.owner}</b><span>owner</span></div></div></div>
              <div className="triage-focus-body">
                <div className="triage-progress-label"><span>Readiness completion</span><span>8 of 19 checks</span></div><div className="triage-progress"><i style={{ width: `${focus.score}%` }} /></div>
                <div className="triage-blocker"><ShieldAlert size={16} /><div><b>{focus.tone === "ready" ? "No blockers reported" : "One decision is holding the line"}</b><p>{focus.blocker}</p></div></div>
                <p className="triage-section-title">Today’s handoff</p>
                {["Confirm network room dimensions", "Attach procurement quote", "Assign installation lead"].map((item, index) => <label className={`triage-check ${done.includes(item) ? "done" : ""}`} key={item}><input type="checkbox" checked={done.includes(item)} onChange={() => setDone((current) => current.includes(item) ? current.filter((value) => value !== item) : [...current, item])} /><span>{item}</span><small className="triage-owner">{index === 0 ? "AM" : "Riteesh"}</small></label>)}
                <div className="triage-footer"><button onClick={() => notify("Campus details queued for export")}><ArrowUpRight size={12} style={{ verticalAlign: "middle" }} /> Open full record</button><button className="triage-primary" onClick={() => notify("Handoff note added")}><Check size={13} /> Mark handoff ready</button></div>
              </div>
            </section>
          </div>
        </main>
      </div>
      {toast && <div className="triage-toast"><Sparkles size={13} style={{ verticalAlign: "middle", marginRight: 6 }} />{toast}</div>}
    </div>
  );
}