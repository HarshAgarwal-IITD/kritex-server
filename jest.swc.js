// Shared @swc/jest transform for unit and e2e Jest configs.
// Decorator metadata is required for Nest dependency injection.
module.exports = [
  '@swc/jest',
  {
    jsc: {
      target: 'es2023',
      parser: { syntax: 'typescript', decorators: true },
      transform: { legacyDecorator: true, decoratorMetadata: true },
      keepClassNames: true,
    },
    module: { type: 'commonjs' },
    sourceMaps: 'inline',
  },
];
