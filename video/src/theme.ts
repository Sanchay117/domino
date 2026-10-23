import { loadFont as loadMono } from "@remotion/google-fonts/IBMPlexMono";
import { loadFont as loadSans } from "@remotion/google-fonts/IBMPlexSans";

export const sans = loadSans("normal", { weights: ["400", "500", "600", "700"], subsets: ["latin"] }).fontFamily;
export const mono = loadMono("normal", { weights: ["400", "500", "600"], subsets: ["latin"] }).fontFamily;

/** The dashboard's palette, so footage and motion graphics read as one product. */
export const C = {
  bg: "#0a0a0a",
  panel: "#111111",
  panel2: "#161616",
  line: "#262626",
  text: "#ededed",
  muted: "#8a8a8a",
  dim: "#5c5c5c",
  mint: "#4efab0",
  red: "#ff5f5f",
  amber: "#ffb547",
  violet: "#b394ff",
};

export const W = 1920;
export const H = 1080;
export const FPS = 30;
