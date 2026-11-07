// 変異試験（N120 の 7）。試験が変異（条件の反転など）を見つけられるかを確かめる。
// 対象は、判定と返金の計算に絞る（全部の sim に掛けると時間がかかるため）。
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
const config = {
  testRunner: 'vitest',
  mutate: ['src/sim/crew.ts', 'src/sim/cableLength.ts', 'src/sim/invariants.ts'],
  reporters: ['clear-text', 'progress'],
  checkers: [],
  coverageAnalysis: 'off',
  thresholds: { high: 80, low: 60, break: null },
  tempDirName: '.stryker-tmp',
};
export default config;
