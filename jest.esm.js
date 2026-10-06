// better-auth (and a few of its dependencies) ship ESM only. Jest's CommonJS runtime can't
// require() them, so those packages are compiled to CommonJS with swc like our own sources.
// Shared by jest.config.js and test/jest-e2e.config.js.
const ESM_PACKAGES = [
  'better-auth',
  '@better-auth',
  'better-call',
  '@better-fetch',
  'rou3',
  'jose',
  'nanostores',
  'defu',
  'uncrypto',
  '@noble',
  'kysely',
  '@standard-schema',
];

module.exports = {
  moduleFileExtensions: ['js', 'mjs', 'cjs', 'json', 'ts'],
  transform: {
    '^.+\\.ts$': require('./jest.swc.js'),
    '^.+\\.m?js$': [
      '@swc/jest',
      { jsc: { target: 'es2023' }, module: { type: 'commonjs' }, sourceMaps: false },
    ],
  },
  transformIgnorePatterns: [`/node_modules/(?!(${ESM_PACKAGES.join('|')})/)`],
};
