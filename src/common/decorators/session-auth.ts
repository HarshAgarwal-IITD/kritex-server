/**
 * OpenAPI security scheme for Better Auth's session cookie (registered in `buildOpenApiDocument`).
 * Better Auth's default cookie is `better-auth.session_token`; over HTTPS it is sent as
 * `__Secure-better-auth.session_token`. Browsers send it automatically (`credentials: 'include'`).
 */
export const SESSION_SECURITY = 'session';
export const SESSION_COOKIE_NAME = 'better-auth.session_token';
