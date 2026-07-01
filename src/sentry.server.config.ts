/**
 * Sentry Server Configuration — کارجو (karjoo).
 *
 * Node.js runtime init. Single-tenant: every event is tagged `tenant=karjoo`.
 * DSN + environment are read from `process.env` (secrets live in .env.local and
 * are NEVER hardcoded here). Structure + production-hardened noise filters are
 * mirrored from Fabric-Commerce, minus the multi-brand (cctvline/etc.) logic and
 * the OpenTelemetry boot (karjoo does not ship OTel).
 */

import * as Sentry from '@sentry/nextjs'

// Resolve DSN from either variable so a runtime that only wires the browser var
// still initialises server-side Sentry (mirrors NEXT_PUBLIC_POSTHOG_KEY).
const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN

Sentry.init({
  dsn: SENTRY_DSN,

  // Environment — production-pinned. SENTRY_ENVIRONMENT overrides at runtime.
  environment: process.env.SENTRY_ENVIRONMENT || 'production',

  // Performance traces — sample 10% in production, everything in dev.
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

  // Only enable when a DSN is configured (build must stay green without one).
  enabled: !!SENTRY_DSN,

  // Structured logs — surface console.error/console.warn as searchable Sentry
  // Logs (paired with consoleLoggingIntegration below) instead of Issues.
  enableLogs: true,

  // Release tag — falls back to a build-time git SHA if present. Enables Sentry
  // release health and "regression since version" alerting.
  release: process.env.SENTRY_RELEASE || process.env.NEXT_PUBLIC_SENTRY_RELEASE,

  // Integrations — HTTP + node-context give runtime context (release, env,
  // server name) and cover Drizzle/postgres queries that go through node http.
  // consoleLoggingIntegration mirrors server console.error/warn into Sentry Logs
  // (requires enableLogs: true).
  integrations: [
    Sentry.httpIntegration(),
    Sentry.nodeContextIntegration(),
    Sentry.consoleLoggingIntegration({ levels: ['error', 'warn'] }),
  ],

  // Tag every event with the single tenant so events are filterable in the UI.
  initialScope: {
    tags: {
      tenant: 'karjoo',
    },
  },

  // Expected, non-actionable errors — never worth an Issue.
  ignoreErrors: [
    // Next.js control-flow throws (expected).
    'NEXT_REDIRECT',
    'NEXT_NOT_FOUND',
    // Access control working as designed.
    'ForbiddenError',
    // Rate limiting (expected).
    'Rate limit exceeded',
    // Zod input validation (user error, not a bug).
    'ZodError',
    // Server-Action deploy skew & bot traffic (stale action IDs / scanners).
    'Failed to find Server Action',
    'Invalid Server Actions request',
  ],

  beforeSend(event, hint) {
    // Don't send in development.
    if (process.env.NODE_ENV === 'development') {
      console.log('[Sentry Server] Would send event:', event.message)
      return null
    }

    const error = hint.originalException

    // Never report auth redirects.
    if (error instanceof Error && error.message.includes('NEXT_REDIRECT')) {
      return null
    }

    // Drop smoke/test probes so they never reach the prod issue list.
    if (isSmokeEvent(event)) {
      return null
    }

    // Drop benign Next.js 16 RSC stream-abort noise ("Connection closed.").
    if (isReactServerDomConnectionClosed(event, error)) {
      return null
    }

    // Drop bot/scanner Server-Action JSON-decode noise (empty body → SyntaxError).
    if (isServerActionJsonParseNoise(event)) {
      return null
    }

    // Drop bot/scanner malformed-multipart noise (undici FormData decode fail).
    if (isFormDataParseNoise(event)) {
      return null
    }

    // Drop benign Next.js 16 PPR resume-fallback noise (React recovers).
    if (isPprResumableSlotsNoise(event)) {
      return null
    }

    // Drop the Node webstreams teardown TypeError on aborted RSC/Response streams.
    if (isWebStreamTransformAlgorithmNoise(event)) {
      return null
    }

    // Redact sensitive data.
    if (event.message) {
      event.message = redactSensitiveData(event.message)
    }
    if (event.contexts?.response?.data) {
      event.contexts.response.data = '[REDACTED]'
    }

    return event
  },

  // Drop the benign Next.js 16 RSC stream-abort transactions that arrive as
  // aborted `generateMetadata /<route>` spans when a client disconnects
  // mid-render. Surgically strip the offending child spans (keeping healthy
  // perf data) and drop the whole transaction only when it IS the artifact.
  beforeSendTransaction(event) {
    if (process.env.NODE_ENV === 'development') return event

    const isConnClosed = (s?: { description?: string; status?: string; op?: string }): boolean => {
      if (!s) return false
      const desc = s.description || ''
      return (
        desc.includes('Connection closed.') || s.status === 'aborted' || s.status === 'cancelled'
      )
    }
    const isGenerateMetadata = (name?: string): boolean =>
      typeof name === 'string' && name.startsWith('generateMetadata ')

    if (Array.isArray(event.spans)) {
      event.spans = event.spans.filter(
        (s) => !(isGenerateMetadata(s?.description) && isConnClosed(s))
      )
    }

    const traceCtx = event.contexts?.trace as
      | { status?: string; description?: string; op?: string }
      | undefined
    if (
      (isGenerateMetadata(event.transaction) || isGenerateMetadata(traceCtx?.description)) &&
      (isConnClosed(traceCtx) ||
        (typeof event.transaction === 'string' && event.transaction.includes('Connection closed.')))
    ) {
      return null
    }

    return event
  },

  // In SDK v10 beforeSendSpan MUST return a SpanJSON (null invalidates the trace
  // tree), so span-level dropping happens in beforeSendTransaction. Kept as the
  // documented seam; passes spans through unchanged.
  beforeSendSpan(span) {
    return span
  },

  beforeBreadcrumb(breadcrumb) {
    // Redact SQL query breadcrumbs.
    if (breadcrumb.category === 'query' && breadcrumb.message) {
      breadcrumb.message = redactSqlData(breadcrumb.message)
    }
    // Redact HTTP request bodies.
    if (breadcrumb.data?.body) {
      breadcrumb.data.body = '[REDACTED]'
    }
    return breadcrumb
  },
})

/**
 * Detect smoke/test events generated by verification scripts (incl. the
 * /api/internal/obs-smoke endpoint) so they never pollute the prod issue list.
 * Uses `includes()` (contains-match) so a synthesised `"{type}: {value}"`
 * message still matches.
 */
function isSmokeEvent(event: {
  message?: string
  exception?: { values?: Array<{ value?: string }> }
}): boolean {
  const candidates: string[] = []
  if (event.message) candidates.push(event.message)
  const values = event.exception?.values
  if (Array.isArray(values)) {
    for (const v of values) {
      if (v?.value) candidates.push(v.value)
    }
  }
  return candidates.some(
    (m) =>
      m.includes('VERIFY-') ||
      m.includes('VERIFY_') ||
      m.includes('ENV-VERIFY-') ||
      m.includes('ALERT TEST') ||
      m.includes('obs-smoke') ||
      m.includes('karjoo-smoke-') ||
      m.includes('Sentry Resend SMTP Test')
  )
}

/**
 * Detect the bot/scanner Server-Action decode error `SyntaxError: Unexpected
 * end of JSON input` thrown when Next.js decodes an empty POST body as a Server
 * Action. Discriminator: NO in-app frame (a genuine `JSON.parse('')` bug in our
 * own code always carries one).
 */
function isServerActionJsonParseNoise(event: {
  exception?: {
    values?: Array<{
      type?: string
      value?: string
      stacktrace?: {
        frames?: Array<{
          filename?: string
          module?: string
          function?: string
          in_app?: boolean
        }>
      }
    }>
  }
}): boolean {
  const values = event.exception?.values
  if (!Array.isArray(values) || values.length === 0) return false

  const v = values[values.length - 1]
  if (v?.type !== 'SyntaxError') return false
  if (!v?.value?.includes('Unexpected end of JSON input')) return false

  const frames = v.stacktrace?.frames
  if (Array.isArray(frames) && frames.some((f) => f?.in_app === true)) return false
  if (!Array.isArray(frames) || frames.length === 0) return true

  const hasRuntimeFrame = frames.some(
    (f) => (f?.filename || '').includes('next-server') || (f?.module || '').includes('next-server')
  )
  const hasJsonParse = frames.some((f) => (f?.function ?? '') === 'JSON.parse')
  const hasAnonymous = frames.some(
    (f) => (f?.filename ?? '') === '<anonymous>' || (f?.function ?? '') === 'JSON.parse'
  )
  return hasRuntimeFrame || hasJsonParse || hasAnonymous || frames.every((f) => f?.in_app !== true)
}

/**
 * Detect the bot/scanner malformed-multipart error `TypeError: Failed to parse
 * body as FormData.` thrown inside undici. We never control the incoming bytes,
 * so it is always a bad-request artifact. Match the exact message + undici throw
 * frame so a genuine in-app FormData bug still surfaces.
 */
function isFormDataParseNoise(event: {
  exception?: {
    values?: Array<{
      type?: string
      value?: string
      stacktrace?: {
        frames?: Array<{
          filename?: string
          module?: string
          function?: string
          in_app?: boolean
        }>
      }
    }>
  }
}): boolean {
  const values = event.exception?.values
  if (!Array.isArray(values) || values.length === 0) return false

  const v = values[values.length - 1]
  if (v?.type !== 'TypeError') return false
  if (!v?.value?.includes('Failed to parse body as FormData')) return false

  const frames = v.stacktrace?.frames
  if (!Array.isArray(frames) || frames.length === 0) return true

  return frames.some(
    (f) =>
      (f?.filename || '').includes('undici') ||
      (f?.module || '').includes('undici') ||
      (f?.function ?? '') === 'successSteps'
  )
}

/**
 * Detect the benign Next.js 16 PPR resume-fallback message "Couldn't find all
 * resumable slots by key/index during replaying…" — React's graceful recovery
 * when the prerendered shell can't be replayed. System-only stack is the
 * discriminator; a real in-app bug is never dropped.
 */
function isPprResumableSlotsNoise(event: {
  message?: string
  exception?: {
    values?: Array<{
      value?: string
      stacktrace?: { frames?: Array<{ in_app?: boolean }> }
    }>
  }
}): boolean {
  const texts: string[] = []
  if (event.message) texts.push(event.message)
  const values = event.exception?.values ?? []
  for (const v of values) if (v?.value) texts.push(v.value)
  const blob = texts.join(' ')
  if (!blob.includes("Couldn't find all resumable slots by key/index during replaying")) {
    return false
  }
  const frames = values[values.length - 1]?.stacktrace?.frames
  if (Array.isArray(frames) && frames.some((f) => f?.in_app === true)) return false
  return true
}

/**
 * Detect the Node webstreams teardown TypeError "controller[kState].transform
 * Algorithm is not a function" emitted when a TransformStream backing an
 * RSC/Response stream is torn down after the client aborted. Node-internals-only
 * stack ⇒ stream-teardown artifact, not an app bug.
 */
function isWebStreamTransformAlgorithmNoise(event: {
  exception?: {
    values?: Array<{
      type?: string
      value?: string
      stacktrace?: { frames?: Array<{ filename?: string; module?: string; in_app?: boolean }> }
    }>
  }
}): boolean {
  const values = event.exception?.values
  if (!Array.isArray(values) || values.length === 0) return false
  const v = values[values.length - 1]
  if (v?.type !== 'TypeError') return false
  if (!v?.value?.includes('transformAlgorithm is not a function')) return false
  const frames = v.stacktrace?.frames
  if (Array.isArray(frames) && frames.some((f) => f?.in_app === true)) return false
  return true
}

/**
 * Detect benign `Error: Connection closed.` from react-server-dom-* (Next.js 16
 * RSC streaming) when a client disconnects mid-stream. Match conservatively:
 * exact message AND a react-server-dom stack/module reference.
 */
function isReactServerDomConnectionClosed(
  event: {
    exception?: {
      values?: Array<{
        value?: string
        stacktrace?: { frames?: Array<{ filename?: string; module?: string }> }
      }>
    }
  },
  originalException: unknown
): boolean {
  const message =
    originalException instanceof Error
      ? originalException.message
      : event.exception?.values?.[0]?.value
  if (message !== 'Connection closed.') return false

  if (originalException instanceof Error && typeof originalException.stack === 'string') {
    if (originalException.stack.includes('react-server-dom')) return true
  }

  const values = event.exception?.values
  if (Array.isArray(values)) {
    for (const v of values) {
      const frames = v?.stacktrace?.frames
      if (!Array.isArray(frames)) continue
      for (const f of frames) {
        const filename = f?.filename || ''
        const mod = f?.module || ''
        if (filename.includes('react-server-dom') || mod.includes('react-server-dom')) {
          return true
        }
      }
    }
  }

  return false
}

/** Redact sensitive tokens/PII from a free-text string. */
function redactSensitiveData(text: string): string {
  return (
    text
      .replace(/[\w.-]+@[\w.-]+\.\w+/g, '[REDACTED_EMAIL]')
      .replace(/sk_[a-zA-Z0-9_]+/g, '[REDACTED_SK]')
      .replace(/pk_[a-zA-Z0-9_]+/g, '[REDACTED_PK]')
      .replace(/whsec_[a-zA-Z0-9_]+/g, '[REDACTED_WHSEC]')
      .replace(/postgresql:\/\/[^@]+@/g, 'postgresql://[REDACTED]@')
      .replace(/postgres:\/\/[^@]+@/g, 'postgres://[REDACTED]@')
      .replace(/Bearer\s+[\w.-]+/g, 'Bearer [REDACTED]')
      .replace(/"password"\s*:\s*"[^"]*"/g, '"password": "[REDACTED]"')
      .replace(/'password'\s*:\s*'[^']*'/g, "'password': '[REDACTED]'")
  )
}

/** Redact sensitive values from a SQL query breadcrumb. */
function redactSqlData(sql: string): string {
  return (
    sql
      .replace(/'[^']*@[^']*'/g, "'[REDACTED_EMAIL]'")
      .replace(/password\s*=\s*'[^']*'/gi, "password='[REDACTED]'")
      .replace(/token\s*=\s*'[^']*'/gi, "token='[REDACTED]'")
  )
}
