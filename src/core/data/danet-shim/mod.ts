/** Shim for @mrg-keystone/danet's index-page-builder.
 *  The JSR version uses Deno.readTextFileSync on a JSR URL which crashes.
 *  This provides a minimal HTML template inline instead. */

export class IndexPageBuilder {
  private prefix: string;
  constructor(options: { prefix?: string; particleCount?: number } = {}) {
    this.prefix = options.prefix ?? "/docs/";
  }
  private cleanName(name: string): string {
    return name.replace(/Module$/i, "");
  }
  build(names: string[]): string {
    const links = names.map((n) => {
      const clean = this.cleanName(n);
      return `<li><a href="${this.prefix}${clean.toLowerCase()}">${clean}</a></li>`;
    });
    return `<!DOCTYPE html><html><head><title>API Documentation</title></head><body><h1>API Documentation</h1><ul>${links.join("")}</ul></body></html>`;
  }
}
