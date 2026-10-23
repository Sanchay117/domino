import { correlatedScenario, simulate, type CurvePoint, type NormalizedSnapshot, type SimParams } from "@domino/engine";
import { useEffect, useState } from "react";

/** Compute the BTC-led stress curve one scenario at a time so the chart draws progressively without blocking. */
export function useStressCurve(snap: NormalizedSnapshot, shocks: number[], params: Partial<SimParams> = {}): { points: CurvePoint[]; done: boolean } {
  const [points, setPoints] = useState<CurvePoint[]>([]);
  const key = JSON.stringify([snap.fetchedAt, shocks, params]);
  useEffect(() => {
    let cancelled = false;
    setPoints([]);
    // Alternate down/up from the centre outwards so both halves grow together.
    const order = [...shocks].sort((a, b) => Math.abs(a) - Math.abs(b));
    let i = 0;
    const next = () => {
      if (cancelled || i >= order.length) return;
      const shock = order[i++];
      const result = simulate(snap, correlatedScenario(snap, shock), params).totals;
      setPoints((p) => [...p, { shock, result }]);
      setTimeout(next, 16);
    };
    const id = setTimeout(next, 30);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return { points, done: points.length === shocks.length };
}
