// Records footage of the real Domino app, frame by frame, under Playwright's fake clock: every timer,
// requestAnimationFrame and Date.now in the page advances exactly 1/30 s per captured frame, so playback,
// charts and progressive simulations come out smooth and deterministic. A drawn cursor shows where the
// (real) mouse events go. Actions are scheduled against the narration timing (src/generated/timing.json).
//
// Usage: npm run capture [-- scene...]   (needs the web app running, default http://localhost:5180/)
// Writes public/clips/<scene>.mp4.

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { chromium, type Page } from "playwright";

const BASE = process.env.DOMINO_URL ?? "http://localhost:5180/";
const W = 1600;
const H = 900;
const DSF = 1.5; // 2400×1350 frames: crisp when the composition zooms in
const FPS = 30;
const DT = 1000 / FPS;

const timing = JSON.parse(readFileSync(new URL("../src/generated/timing.json", import.meta.url), "utf8")) as {
  scenes: { id: string; seconds: number; lines: { start: number; seconds: number }[] }[];
};
const facts = JSON.parse(readFileSync(new URL("../src/generated/facts.json", import.meta.url), "utf8"));
const scene = (id: string) => timing.scenes.find((s) => s.id === id)!;
const lineStart = (id: string, i: number) => scene(id).lines[i].start;

const ease = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2);

const CURSOR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 26 26"><path d="M4 2 L4 21 L9 16.5 L12.5 24 L15.5 22.6 L12 15.2 L19 15.2 Z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>`;

class Recorder {
  frame = 0;
  x = W * 0.62;
  y = H * 0.72;
  private pressed = 0;
  constructor(
    private page: Page,
    private dir: string,
  ) {}

  get t(): number {
    return this.frame / FPS;
  }

  async installCursor(): Promise<void> {
    await this.page.evaluate((svg) => {
      document.getElementById("__cursor")?.remove();
      const el = document.createElement("div");
      el.id = "__cursor";
      el.innerHTML = svg;
      Object.assign(el.style, { position: "fixed", left: "0", top: "0", zIndex: "2147483647", pointerEvents: "none", transformOrigin: "4px 2px" });
      document.body.appendChild(el);
    }, CURSOR_SVG);
  }

  /** Let React flush work it scheduled through MessageChannel (not faked) before the screenshot. */
  private async settle(): Promise<void> {
    await this.page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          let n = 0;
          const ch = new MessageChannel();
          ch.port1.onmessage = () => (++n >= 3 ? resolve() : ch.port2.postMessage(0));
          ch.port2.postMessage(0);
        }),
    );
  }

  async tick(): Promise<void> {
    await this.page.clock.runFor(DT);
    await this.settle();
    const scale = this.pressed > 0 ? 0.82 : 1;
    if (this.pressed > 0) this.pressed--;
    await this.page.evaluate(
      ([x, y, s]) => {
        const el = document.getElementById("__cursor");
        if (el) el.style.transform = `translate(${x - 4}px, ${y - 2}px) scale(${s})`;
      },
      [this.x, this.y, scale],
    );
    await this.page.screenshot({ path: `${this.dir}/${String(this.frame).padStart(5, "0")}.jpg`, type: "jpeg", quality: 92 });
    this.frame++;
  }

  async until(t: number): Promise<void> {
    while (this.t < t - 1e-9) await this.tick();
  }

  async hold(seconds: number): Promise<void> {
    await this.until(this.t + seconds);
  }

  async moveTo(x: number, y: number, seconds = 0.8): Promise<void> {
    const [x0, y0] = [this.x, this.y];
    const n = Math.max(1, Math.round(seconds * FPS));
    for (let i = 1; i <= n; i++) {
      const u = ease(i / n);
      this.x = x0 + (x - x0) * u;
      this.y = y0 + (y - y0) * u;
      await this.page.mouse.move(this.x, this.y);
      await this.tick();
    }
  }

  async click(): Promise<void> {
    await this.page.mouse.move(this.x, this.y);
    this.pressed = 5;
    await this.page.mouse.down();
    await this.page.mouse.up();
    await this.tick();
  }

  async scrollTo(y: number, seconds = 1): Promise<void> {
    const y0 = await this.page.evaluate(() => window.scrollY);
    const n = Math.max(1, Math.round(seconds * FPS));
    for (let i = 1; i <= n; i++) {
      const target = y0 + (y - y0) * ease(i / n);
      await this.page.evaluate((v) => window.scrollTo(0, v), target);
      await this.tick();
    }
  }

  /** Centre of an element in viewport coordinates. */
  async center(selector: string, dx = 0, dy = 0): Promise<[number, number]> {
    const box = await this.page.locator(selector).first().boundingBox();
    if (!box) throw new Error(`not visible: ${selector}`);
    return [box.x + box.width / 2 + dx, box.y + box.height / 2 + dy];
  }

  /** Document y of an element's top. */
  async top(selector: string): Promise<number> {
    return this.page.locator(selector).first().evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
  }
}

/** Point on the Radar stress curve for a given shock (chart margins mirror StressCurve.tsx). */
async function curvePoint(page: Page, shock: number, yFrac = 0.62): Promise<[number, number]> {
  const box = await page.locator(".panel svg").first().boundingBox();
  if (!box) throw new Error("stress curve not visible");
  const l = 58;
  const r = 14;
  return [box.x + l + ((shock + 0.4) / 0.8) * (box.width - l - r), box.y + box.height * yFrac];
}

async function open(page: Page, url: string, waitFor: string): Promise<void> {
  await page.goto(url);
  await page.getByText(waitFor).first().waitFor({ timeout: 30_000 });
}

const SCENES: Record<string, (rec: Recorder, page: Page) => Promise<void>> = {
  async radar(rec, page) {
    const id = "radar";
    await open(page, `${BASE}?fixture#/radar`, "How hard can Strike fall?");
    await rec.installCursor();
    await rec.hold(0.4);
    const [sx, sy] = await curvePoint(page, 0.12, 0.55);
    await rec.moveTo(sx, sy, 1.6);
    await rec.until(lineStart(id, 1) + 0.1);
    const [px, py] = await curvePoint(page, -0.2, 0.6);
    await rec.moveTo(px, py, 1.1);
    await rec.until(lineStart(id, 2) - 0.2);
    const table = await rec.top("table");
    await rec.moveTo(W * 0.5, H * 0.86, 0.5);
    await rec.scrollTo(table - 150, 1.4);
    const [rx, ry] = await rec.center("tbody tr", -250);
    await rec.moveTo(rx, ry, 0.9);
    await rec.until(scene(id).seconds);
  },

  async lab(rec, page) {
    const id = "lab";
    await open(page, `${BASE}?fixture&play=30#/radar`, "How hard can Strike fall?");
    // Let the stress curve finish drawing before the scene starts.
    await page.clock.runFor(2500);
    await rec.installCursor();
    const [sx, sy] = await curvePoint(page, -0.1, 0.5);
    rec.x = sx;
    rec.y = sy;
    await rec.hold(0.3);
    const [px, py] = await curvePoint(page, -0.2, 0.6);
    await rec.moveTo(px, py, 0.9);
    await rec.hold(0.25);
    await rec.click();
    await rec.hold(0.4);
    await rec.moveTo(W * 0.93, H * 0.45, 1.2);
    // Chart and ladder together while the cascade is still running.
    await rec.until(lineStart(id, 0) + 3.4);
    const chart = await rec.top("text=mark vs index");
    await rec.scrollTo(chart - 70, 1.4);
    await rec.until(lineStart(id, 2) - 0.5);
    const log = await rec.top("text=Domino log");
    await rec.scrollTo(log - 420, 1.3);
    await rec.until(scene(id).seconds);
  },

  async catch(rec, page) {
    const id = "catch";
    await open(page, `${BASE}?fixture&play=12#/lab?mode=corr&symbol=ADA-USD&shock=-0.30`, "Shock the external index");
    await page.clock.runFor(13_000); // run the replay (it starts on a timer), finish its playback, compute the plan
    await page.getByText("Catch the ADA cascade").waitFor();
    await rec.installCursor();
    await rec.hold(0.6);
    const panel = await rec.top("text=Catch the ADA cascade");
    await rec.scrollTo(panel - 90, 1.3);
    const [tx, ty] = await rec.center("text=vs mark");
    await rec.moveTo(tx - 120, ty + 60, 1.0);
    await rec.until(lineStart(id, 2) + 0.4);
    const [bx, by] = await rec.center("text=Replay with these orders in the book");
    await rec.moveTo(bx, by, 0.9);
    await rec.hold(0.2);
    await rec.click();
    await rec.hold(0.3);
    await rec.scrollTo(0, 1.2);
    await rec.moveTo(W * 0.55, H * 0.32, 0.8);
    await rec.until(scene(id).seconds);
  },

  async xray(rec, page) {
    const id = "xray";
    await open(page, `${BASE}?fixture#/xray`, "Position X-Ray");
    await rec.installCursor();
    await rec.hold(0.3);
    const [ix, iy] = await rec.center("input[placeholder^='addr1']", -260);
    await rec.moveTo(ix, iy, 0.7);
    await rec.click();
    await page.locator("input[placeholder^='addr1']").fill(facts.xray.address);
    await rec.hold(0.35);
    const [bx, by] = await rec.center("button[type=submit]");
    await rec.moveTo(bx, by, 0.5);
    await rec.click();
    await rec.until(lineStart(id, 1) + 0.2);
    const positions = await rec.top("text=Cascade survival =");
    await rec.scrollTo(positions - 150, 1.2);
    const [cx, cy] = await rec.center("text=Reduce by", 120, 0);
    await rec.moveTo(cx, cy, 1.0);
    await rec.until(scene(id).seconds);
  },
};

async function encode(dir: string, out: string): Promise<void> {
  const r = spawnSync(
    "ffmpeg",
    ["-y", "-loglevel", "error", "-framerate", String(FPS), "-i", `${dir}/%05d.jpg`, "-c:v", "libx264", "-preset", "slow", "-crf", "14", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out],
    { stdio: "inherit" },
  );
  if (r.status !== 0) throw new Error(`ffmpeg failed for ${out}`);
}

const wanted = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SCENES);
const browser = await chromium.launch({ channel: "chrome" });
mkdirSync(new URL("../public/clips/", import.meta.url), { recursive: true });
for (const id of wanted) {
  const run = SCENES[id];
  if (!run) throw new Error(`unknown scene ${id}`);
  const dir = new URL(`../build/frames/${id}`, import.meta.url).pathname;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DSF, colorScheme: "dark" });
  const page = await context.newPage();
  // Start the page clock 90 s after the snapshot was taken, and only let it move when a frame is captured.
  await page.clock.install({ time: facts.fetchedAt + 90_000 });
  await page.clock.pauseAt(facts.fetchedAt + 91_000);
  const rec = new Recorder(page, dir);
  const t0 = Date.now();
  await run(rec, page);
  await context.close();
  const out = new URL(`../public/clips/${id}.mp4`, import.meta.url).pathname;
  await encode(dir, out);
  console.log(`${id}: ${rec.frame} frames (${(rec.frame / FPS).toFixed(1)}s) in ${((Date.now() - t0) / 1000).toFixed(0)}s → ${out}`);
}
await browser.close();
