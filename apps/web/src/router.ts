import { useEffect, useState } from "react";

export type Page = "radar" | "lab" | "xray" | "build";

export interface Route {
  page: Page;
  params: URLSearchParams;
}

function parse(): Route {
  const [path, query] = location.hash.replace(/^#\/?/, "").split("?");
  const page = (["radar", "lab", "xray", "build"].includes(path) ? path : "radar") as Page;
  return { page, params: new URLSearchParams(query ?? "") };
}

export function useRoute(): Route {
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const on = () => {
      setRoute(parse());
      window.scrollTo({ top: 0 });
    };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}

export function go(page: Page, params: Record<string, string | number> = {}): void {
  const q = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString();
  location.hash = `/${page}${q ? `?${q}` : ""}`;
}
