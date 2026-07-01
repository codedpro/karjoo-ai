/**
 * Sentry Client Instrumentation — کارجو (karjoo). Next.js 16 + Turbopack.
 *
 * In Next.js 16 the build defaults to Turbopack, which only picks up the
 * client-side Sentry config when it lives at `instrumentation-client.{js,ts}`
 * under the project root / `src` folder. The legacy `sentry.client.config.ts`
 * filename is ignored by Turbopack, which would silently drop the browser SDK.
 *
 * Single-tenant `karjoo`, DSN/env from process.env (NEXT_PUBLIC_* are inlined
 * into the browser bundle at build time). Structure + noise filters mirrored
 * from Fabric-Commerce, minus the multi-brand tracePropagationTargets.
 */

import * as Sentry from '@sentry/nextjs'

/**
 * Session latch: flipped true the moment ANY third-party DOM mutation (Google
 * Translate / grammar / form-fill extension) is observed. React hydration
 * recovery transiently wipes the live markers, so a point-in-time DOM query in
 * `beforeSend` races and misses them. This latch doesn't — once set it stays set
 * for the session. `isThirdPartyHydrationNoise` consults it to drop the resulting
 * React #418/#423/#425 noise while still letting a genuine app hydration bug —
 * which also fires in a CLEAN DOM — report. Especially relevant for karjoo: a
 * Persian/RTL site is a prime Google-Translate target.
 */
let thirdPartyDomMutationSeen = false
if (typeof window !== 'undefined' && typeof MutationObserver !== 'undefined') {
  const scan = (): void => {
    if (thirdPartyDomMutationSeen) return
    try {
      const html = document.documentElement
      if (
        html.classList.contains('translated-ltr') ||
        html.classList.contains('translated-rtl') ||
        document.querySelector('font[style*="vertical-align"]') !== null ||
        document.querySelector(
          '.skiptranslate, grammarly-extension, [data-gr-ext-installed], [data-lt-installed], [fdprocessedid]'
        ) !== null ||
        document.body?.hasAttribute('data-new-gr-c-s-check-loaded') === true
      ) {
        thirdPartyDomMutationSeen = true
      }
    } catch {
      /* defensive: never let detection throw */
    }
  }
  const start = (): void => {
    scan()
    try {
      new MutationObserver(() => scan()).observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'fdprocessedid', 'data-gr-ext-installed'],
      })
    } catch {
      /* defensive */
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true })
  } else {
    start()
  }
}

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Environment — production-pinned; NEXT_PUBLIC_SENTRY_ENVIRONMENT overrides.
  environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || 'production',

  // Performance traces + Web Vitals via browserTracingIntegration below.
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

  // Trace propagation — attach sentry-trace/baggage headers so browser spans
  // stitch to the backend transaction (distributed tracing). Single-domain app:
  // allow the karjoo apex + subdomains and same-origin (relative) requests.
  tracePropagationTargets: [/^https?:\/\/([^/]*\.)?itmaster\.uk/, /^\//],

  // Structured logs — forward browser console.error/warn into Sentry Logs
  // (searchable) rather than turning each into an Issue.
  enableLogs: true,

  // Session replay.
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,

  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Release tag — must match server release for symbolication + regression alerts.
  release: process.env.NEXT_PUBLIC_SENTRY_RELEASE,

  // Tag every event with the single tenant.
  initialScope: {
    tags: {
      tenant: 'karjoo',
    },
  },

  integrations: [
    Sentry.replayIntegration({
      maskAllText: true,
      blockAllMedia: true,
    }),
    Sentry.browserTracingIntegration(),
    Sentry.feedbackIntegration({
      colorScheme: 'system',
      autoInject: false,
    }),
    // Mirror browser console.error/warn into the Sentry LOGS product (searchable),
    // NOT as Issues (captureConsoleIntegration would spam the issue stream).
    Sentry.consoleLoggingIntegration({ levels: ['error', 'warn'] }),
  ],

  ignoreErrors: [
    // Browser extension errors.
    /^chrome-extension:\/\//,
    /^moz-extension:\/\//,
    // Expected network errors.
    'Network request failed',
    'NetworkError',
    'AbortError',
    'ChunkLoadError',
    'Load failed',
    'Failed to fetch',
    'The operation was aborted',
    // Third-party script errors.
    /^Script error\.?$/,
  ],

  sendDefaultPii: false,

  beforeSend(event) {
    if (process.env.NODE_ENV === 'development') {
      console.log('[Sentry] Would send event:', event)
      return null
    }

    // Drop smoke/test probes.
    if (isSmokeEvent(event)) {
      return null
    }

    // Drop recoverable React hydration errors caused by a THIRD-PARTY DOM
    // mutation before hydration (overwhelmingly Google Translate). Not app bugs.
    if (isThirdPartyHydrationNoise(event)) {
      return null
    }

    // Drop the production-stripped generic Server Components render wrapper — it
    // carries no actionable client-side detail; the real error is captured
    // server-side via instrumentation.ts onRequestError (correlate by digest).
    if (isOmittedServerComponentsRenderError(event)) {
      return null
    }

    if (event.message) {
      event.message = redactSensitiveData(event.message)
    }

    return event
  },

  beforeBreadcrumb(breadcrumb) {
    if (breadcrumb.data?.url) {
      breadcrumb.data.url = redactUrlParams(breadcrumb.data.url)
    }
    return breadcrumb
  },
})

/**
 * Required by Sentry SDK 10 on Next.js 15.3+ — wires
 * `Sentry.captureRouterTransitionStart` to Next.js' `onRouterTransitionStart`
 * hook so App Router navigations create proper navigation spans.
 */
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart

/**
 * The production client emits a generic wrapper error "An error occurred in the
 * Server Components render. The specific message is omitted in production
 * builds…" with no actionable detail. The real error is captured server-side
 * (instrumentation.ts onRequestError), so the client copy is duplicate noise.
 */
function isOmittedServerComponentsRenderError(event: {
  message?: string
  exception?: { values?: Array<{ value?: string }> }
}): boolean {
  const texts: string[] = []
  if (event.message) texts.push(event.message)
  for (const v of event.exception?.values ?? []) if (v?.value) texts.push(v.value)
  const blob = texts.join(' ')
  return (
    blob.includes('An error occurred in the Server Components render') &&
    blob.includes('omitted in production builds')
  )
}

/**
 * Detect React hydration errors (#418/#423/#425) caused by a THIRD-PARTY browser
 * DOM mutation before hydration — overwhelmingly Google Translate (wraps text
 * nodes in `<font style="vertical-align:inherit">`, adds `html.translated-*`),
 * plus grammar/form-fill extensions. The server HTML is correct; the browser
 * rewrote it and React recovers by re-rendering. We drop ONLY when third-party
 * mutation is detectable (latch or live DOM) OR the mismatch is unattributable
 * (no in-app frame), so a genuine app hydration bug still reports.
 */
function isThirdPartyHydrationNoise(event: {
  message?: string
  exception?: {
    values?: Array<{
      value?: string
      type?: string
      stacktrace?: { frames?: Array<{ in_app?: boolean }> }
    }>
  }
}): boolean {
  const texts: string[] = []
  if (event.message) texts.push(event.message)
  for (const v of event.exception?.values ?? []) {
    if (v?.value) texts.push(v.value)
    if (v?.type) texts.push(v.type)
  }
  const blob = texts.join(' ')
  const isHydration =
    /Minified React error #(418|423|425)\b/.test(blob) ||
    /hydrat/i.test(blob) ||
    /server rendered HTML didn't match|did not match the client/i.test(blob)
  if (!isHydration) return false

  // Unattributable backstop: no in-app frame ⇒ React couldn't pin it to our
  // code (the generic "Hydration Error" group). Proven third-party; drop it.
  const frames = event.exception?.values?.at(-1)?.stacktrace?.frames
  const hasInAppFrame = Array.isArray(frames) && frames.some((f) => f?.in_app === true)
  if (!hasInAppFrame) return true

  // Persisted latch first — robust to React recovery wiping the live markers.
  if (thirdPartyDomMutationSeen) return true

  // Best-effort live re-check fallback.
  if (typeof document === 'undefined') return false
  try {
    const html = document.documentElement
    const translated =
      html.classList.contains('translated-ltr') ||
      html.classList.contains('translated-rtl') ||
      document.querySelector('font[style*="vertical-align"]') !== null ||
      document.querySelector('.skiptranslate, #goog-gt-tt, .goog-te-spinner-pos') !== null
    const extensionMutated =
      document.querySelector(
        'grammarly-extension, [data-gr-ext-installed], [data-lt-installed]'
      ) !== null ||
      document.body?.hasAttribute('data-new-gr-c-s-check-loaded') === true ||
      document.querySelector('[fdprocessedid]') !== null
    return translated || extensionMutated
  } catch {
    return false
  }
}

/**
 * Detect smoke/test events generated by verification scripts (incl.
 * /api/internal/obs-smoke). Contains-match so a synthesised `"{type}: {value}"`
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

/** Redact sensitive tokens/PII from a free-text string. */
function redactSensitiveData(text: string): string {
  return (
    text
      .replace(/[\w.-]+@[\w.-]+\.\w+/g, '[REDACTED_EMAIL]')
      .replace(/sk_[a-zA-Z0-9]+/g, '[REDACTED_SK]')
      .replace(/pk_[a-zA-Z0-9]+/g, '[REDACTED_PK]')
      .replace(/whsec_[a-zA-Z0-9]+/g, '[REDACTED_WHSEC]')
      .replace(/Bearer\s+[\w.-]+/g, 'Bearer [REDACTED]')
  )
}

/** Redact sensitive URL query params from a breadcrumb URL. */
function redactUrlParams(url: string): string {
  try {
    const parsed = new URL(url)
    const sensitiveParams = ['token', 'password', 'secret', 'key', 'api_key', 'code']
    sensitiveParams.forEach((param) => {
      if (parsed.searchParams.has(param)) {
        parsed.searchParams.set(param, '[REDACTED]')
      }
    })
    return parsed.toString()
  } catch {
    return url
  }
}
