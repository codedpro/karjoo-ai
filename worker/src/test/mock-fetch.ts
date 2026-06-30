/**
 * A typed fetch mock helper for the API-client tests.
 *
 * Annotating the mock with the real fetch signature keeps the call tuple typed as
 * [input, init?] (not []), so strict `noUncheckedIndexedAccess` reads of
 * `mock.calls[0][1]` typecheck cleanly. The handler receives the request init so a
 * test can branch on body/headers if needed.
 */
import { vi, type Mock } from "vitest";

import type { FetchImpl } from "../lib/api-client.js";

/** A fetch mock typed as the real fetch, returning the given handler's Response. */
export function mockFetch(
  handler: (input: string, init?: RequestInit) => Promise<Response> | Response,
): Mock<FetchImpl> {
  return vi.fn(async (input: Parameters<FetchImpl>[0], init?: Parameters<FetchImpl>[1]) => {
    return handler(String(input), init as RequestInit | undefined);
  }) as unknown as Mock<FetchImpl>;
}

/** Read the RequestInit of the Nth recorded call (typed; throws if absent). */
export function callInit(mock: Mock<FetchImpl>, n: number): RequestInit {
  const call = mock.mock.calls[n];
  if (!call) throw new Error(`no fetch call at index ${n}`);
  return (call[1] ?? {}) as RequestInit;
}

/** Read the URL of the Nth recorded call. */
export function callUrl(mock: Mock<FetchImpl>, n: number): string {
  const call = mock.mock.calls[n];
  if (!call) throw new Error(`no fetch call at index ${n}`);
  return String(call[0]);
}

/** Parse the JSON body of the Nth recorded call. */
export function callBody(mock: Mock<FetchImpl>, n: number): Record<string, unknown> {
  const init = callInit(mock, n);
  return init.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : {};
}

/** Read the Headers of the Nth recorded call. */
export function callHeaders(mock: Mock<FetchImpl>, n: number): Headers {
  const init = callInit(mock, n);
  return init.headers as Headers;
}
