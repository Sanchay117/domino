import { useEffect, useState } from "react";
import { useSnapshot } from "./data.ts";
import { ago } from "./format.ts";
import Build from "./pages/Build.tsx";
import Lab from "./pages/Lab.tsx";
import Radar from "./pages/Radar.tsx";
import XRay from "./pages/XRay.tsx";
import { go, useRoute, type Page } from "./router.ts";

const TABS: { page: Page; label: string }[] = [
  { page: "radar", label: "Risk Radar" },
  { page: "lab", label: "Cascade Lab" },
  { page: "xray", label: "Position X-Ray" },
  { page: "build", label: "Guardian & API" },
];

function Logo() {
  return (
    <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden>
      <rect x="4" y="9" width="9" height="18" rx="2" fill="#4efab0" transform="rotate(-14 8 18)" />
      <rect x="17" y="5" width="9" height="22" rx="2" fill="#ededed" />
    </svg>
  );
}

export default function App() {
  const route = useRoute();
  const [reload, setReload] = useState(0);
  const state = useSnapshot(reload);
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((x) => x + 1), 5000);
    return () => clearInterval(id);
  }, []);

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <Logo />
          Domino <small>stress lab for Strike</small>
        </div>
        <nav className="tabs">
          {TABS.map((t) => (
            <button key={t.page} className={`tab ${route.page === t.page ? "active" : ""}`} onClick={() => go(t.page)}>
              {t.label}
            </button>
          ))}
        </nav>
        <div className="status">
          {state.status === "ready" ? (
            <>
              <span className={`dot ${state.live ? "" : "off"}`} />
              <span>
                {state.live ? "Live Strike mainnet" : "Offline fixture"} · {ago(state.snap.fetchedAt)}
              </span>
              <button className="btn" style={{ height: 28, fontSize: 12 }} onClick={() => setReload((x) => x + 1)}>
                Refresh
              </button>
            </>
          ) : (
            <span>Connecting to Strike…</span>
          )}
        </div>
      </header>
      <main>
        {state.status === "loading" && (
          <div className="loading">
            <div>
              <div style={{ fontSize: 16, color: "var(--text)" }}>Reading Strike mainnet</div>
              <div className="bar">
                <i style={{ width: `${Math.round((100 * state.done) / Math.max(1, state.total))}%` }} />
              </div>
              <div className="num" style={{ fontSize: 12 }}>
                every live position, margin tier and order book · {state.label}
              </div>
            </div>
          </div>
        )}
        {state.status === "error" && <div className="loading">Could not reach Strike: {state.error}</div>}
        {state.status === "ready" && (
          <>
            {route.page === "radar" && <Radar snap={state.snap} />}
            {route.page === "lab" && <Lab snap={state.snap} params={route.params} />}
            {route.page === "xray" && <XRay snap={state.snap} params={route.params} />}
            {route.page === "build" && <Build snap={state.snap} />}
          </>
        )}
      </main>
      <footer className="footer">
        Domino reads Strike's public APIs only (live positions, margin tiers, order books, candles, vaults) and replays the documented liquidation engine
        locally. It is a model, not an official Strike tool. Open source · MIT.
      </footer>
    </>
  );
}
