/**
 * Pure planner for the "Copy curl" action on the webhook inspector.
 *
 * Given the URL, method, headers, and body of a delivery, produce a
 * single-line shell-safe `curl` command that reproduces the request
 * byte-for-byte. The generated command runs unmodified in `bash` /
 * `zsh`; single quotes inside payload values are escaped via the
 * standard `'\''` close-and-reopen trick.
 */

export interface BuildCurlCommandInput {
  url: string;
  /** HTTP method. Defaults to POST (the worker only ever POSTs). */
  method?: string;
  headers: Readonly<Record<string, string>>;
  body: string;
}

export function buildCurlCommand(input: BuildCurlCommandInput): string {
  const method = (input.method ?? "POST").toUpperCase();
  const parts: string[] = ["curl", "-X", method, shellQuote(input.url)];

  const sortedHeaderKeys = Object.keys(input.headers).sort();
  for (const key of sortedHeaderKeys) {
    const value = input.headers[key]!;
    parts.push("-H", shellQuote(`${key}: ${value}`));
  }

  parts.push("--data-binary", shellQuote(input.body));
  return parts.join(" ");
}

/**
 * Wrap a value in single quotes for safe shell interpolation. Embedded
 * single quotes are split via `'\''` (close, escape, reopen) so even a
 * payload containing arbitrary user input cannot break out of the
 * quote.
 */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
