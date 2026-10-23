import { fetchRawSnapshot, normalizeSnapshot, type NormalizedSnapshot, type RawSnapshot } from "@domino/engine";
import { useEffect, useState } from "react";
import fixtureUrl from "../../../fixtures/snapshot.json?url";

export type SnapshotState =
  | { status: "loading"; done: number; total: number; label: string }
  | { status: "ready"; snap: NormalizedSnapshot; live: boolean; error?: string }
  | { status: "error"; error: string };

async function loadFixture(): Promise<NormalizedSnapshot> {
  const raw = (await (await fetch(fixtureUrl)).json()) as RawSnapshot;
  return normalizeSnapshot(raw);
}

/** Live mainnet snapshot, falling back to the bundled fixture if Strike is unreachable (or ?fixture is set). */
export function useSnapshot(reloadKey: number): SnapshotState {
  const [state, setState] = useState<SnapshotState>({ status: "loading", done: 0, total: 1, label: "markets" });
  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading", done: 0, total: 1, label: "markets" });
    const forceFixture = new URLSearchParams(location.search).has("fixture");
    (async () => {
      if (!forceFixture) {
        try {
          const raw = await fetchRawSnapshot({
            onProgress: (done, total, label) => !cancelled && setState({ status: "loading", done, total, label }),
          });
          if (!cancelled) setState({ status: "ready", snap: normalizeSnapshot(raw), live: true });
          return;
        } catch (e) {
          if (cancelled) return;
          const snap = await loadFixture().catch(() => null);
          if (snap) setState({ status: "ready", snap, live: false, error: String(e) });
          else setState({ status: "error", error: String(e) });
          return;
        }
      }
      const snap = await loadFixture();
      if (!cancelled) setState({ status: "ready", snap, live: false });
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);
  return state;
}
