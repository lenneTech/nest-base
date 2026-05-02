/**
 * Browser-only ambient module declarations so TypeScript stops
 * complaining about non-JavaScript side-effect imports the bundler
 * understands (CSS, remote ESM URLs).
 *
 * The dev-portal SPA imports `tokens.css` + `globals.css` at the
 * entry point so Bun emits the matching stylesheets next to
 * `main.js`. Mermaid is loaded via a CDN URL in `ErdPage.tsx`. Both
 * are resolved at runtime by the bundler / browser; TypeScript needs
 * an explicit declaration for the editor / typecheck pass.
 */

declare module "*.css";
declare module "https://cdn.jsdelivr.net/npm/mermaid*";
declare module "mermaid" {
  interface MermaidApi {
    initialize(opts: unknown): void;
    render(id: string, src: string): Promise<{ svg: string }>;
  }
  const mermaid: MermaidApi;
  export default mermaid;
}
