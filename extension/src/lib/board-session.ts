/** Build Chrome match patterns for a board's root host and all subdomains. */
export function boardTabPatterns(origin: string): string[] {
  const url = new URL(origin);
  const hostname = url.hostname.replace(/^www\./, "");
  return [
    `${url.protocol}//${hostname}/*`,
    `${url.protocol}//*.${hostname}/*`,
  ];
}

