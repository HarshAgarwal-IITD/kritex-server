// Placeholder env so config validation passes on machines/CI without a .env.
// Real values (if present) win. Imported first by export-openapi.ts.
process.env.NODE_ENV ??= 'development';
process.env.DATABASE_URL ??= 'postgresql://openapi:openapi@localhost:5432/openapi';
process.env.LOG_LEVEL ??= 'silent';
