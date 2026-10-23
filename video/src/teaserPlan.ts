// The teaser's beat grid, shared by the music (scripts/sfx.ts) and the picture (src/Teaser.tsx),
// so every cut lands on a beat.

export const TEASER = {
  seconds: 35,
  bpm: 120,
  /** Drums come in here, on the first type card. */
  drop: 3.5,
  /** Drums stop and the end card begins. */
  end: 29,
};

export const BEAT = 60 / TEASER.bpm;
