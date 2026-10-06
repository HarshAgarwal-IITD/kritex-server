/**
 * OpenAPI security scheme for Better Auth's session cookie (registered in `buildOpenApiDocument`).
 * Confirmed in AUTH-1: the cookie is `better-auth.session_token` (`advanced.cookiePrefix`); with
 * `useSecureCookies` (production) it is `__Secure-better-auth.session_token`. Browsers send it
 * automatically (`credentials: 'include'`).
 */
export const SESSION_SECURITY = 'session';
export const SESSION_COOKIE_NAME = 'better-auth.session_token';
