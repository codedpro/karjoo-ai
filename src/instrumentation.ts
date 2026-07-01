/**
 * Instrumentation — کارجو (karjoo). Next.js 16 (register + onRequestError).
 *
 * Loaded once when a Next.js server instance boots. Initialises the correct
 * Sentry runtime config (node vs edge) and wires server-error capture. No
 * OpenTelemetry (karjoo does not ship OTel). Never crashes the app: every
 * Sentry load is guarded and the process continues without Sentry if the DSN is
 * absent or an import fails.
 */

import type { Instrumentation } from 'next'
import * as Sentry from '@sentry/nextjs'

export async function register(): Promise<void> {
  // Only load Sentry if a DSN is configured. NEXT_PUBLIC_SENTRY_DSN is checked
  // first (the browser-inlined var); SENTRY_DSN is the server-only fallback.
  const sentryDsn = process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN
  if (!sentryDsn) {
    console.log('[Instrumentation] Sentry disabled — no DSN configured')
    return
  }

  try {
    if (process.env.NEXT_RUNTIME === 'nodejs') {
      await import('./sentry.server.config')
    }
    if (process.env.NEXT_RUNTIME === 'edge') {
      await import('./sentry.edge.config')
    }
  } catch (error) {
    console.error('[Instrumentation] Failed to load Sentry:', error)
    // Continue without Sentry rather than crashing the server.
  }
}

// Paths hit exclusively by external scanners / WordPress probes. Errors from
// these resolve to `/_not-found`; the only "errors" are `Connection closed.`
// when the scanner hangs up mid-404. Shipping them buries the real signal.
const BOT_PROBE_PREFIXES = [
  '/wp-admin',
  '/wp-content',
  '/wp-includes',
  '/wp-login',
  '/wordpress',
  '/xmlrpc.php',
  '/.env',
  '/.git',
  '/.well-known/acme-challenge',
  '/static/admin',
  '/admin/login',
  '/phpmyadmin',
]

function isBotProbe(path: string, routePath: string, errMessage: string): boolean {
  if (routePath !== '/_not-found') return false
  if (errMessage === 'Connection closed.') return true
  return BOT_PROBE_PREFIXES.some((p) => path.startsWith(p))
}

/**
 * Server-error hook. Next.js 16 invokes this for every server-side error. We
 * silence known bot/scanner + RSC-stream-abort noise at source, log a compact
 * line, then hand the error to Sentry via the SDK-native
 * `Sentry.captureRequestError` (which enriches the event with the request +
 * router context automatically). Guarded so a Sentry failure never bubbles.
 */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  const path = typeof request?.path === 'string' ? request.path : ''
  const routePath = typeof context?.routePath === 'string' ? context.routePath : ''
  const message = err instanceof Error ? err.message : String(err)

  // Silently drop bot-probe errors.
  if (isBotProbe(path, routePath, message)) {
    return
  }

  // Silently drop RSC stream-abort noise (client navigated away / closed tab).
  if (
    message === 'Connection closed.' &&
    (context?.renderSource === 'react-server-components' ||
      context?.renderSource === 'react-server-components-payload')
  ) {
    return
  }

  console.error('[Error]', {
    message,
    path,
    method: request?.method,
    routePath,
    routeType: context?.routeType,
  })

  // Only capture when a DSN is configured (mirrors register()).
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN && !process.env.SENTRY_DSN) {
    return
  }

  try {
    // SDK-native capture — attaches request + router context and respects the
    // beforeSend noise filters in the runtime config.
    Sentry.captureRequestError(err, request, context)
  } catch (captureError) {
    console.error('[Instrumentation] Failed to capture error with Sentry:', captureError)
    // Continue without Sentry.
  }
}
