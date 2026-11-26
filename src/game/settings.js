export const DIFFICULTIES = {
  easy: { max: 1.8, correctStep: 0.06, wrongStep: 0.16 },
  normal: { max: 2.0, correctStep: 0.08, wrongStep: 0.18 },
  crazy: { max: 2.4, correctStep: 0.12, wrongStep: 0.22 },
};

export function normalizeDifficulty(value) {
  return Object.hasOwn(DIFFICULTIES, value) ? value : 'normal';
}

// Original night colors are kept here as the reusable dark palette.
export const WORLD_THEMES = {
  night: { sky: 0x0b1020, road: 0x151c32, dash: 0x475569, rail: 0x38bdf8, emissive: 0x0284c7, ambient: 0xdbeafe, intensity: 0.95 },
  day: { sky: 0xc8e8fa, road: 0xb4bdc5, dash: 0xffffff, rail: 0x52788a, emissive: 0x000000, ambient: 0xffffff, intensity: 1.5 },
};
