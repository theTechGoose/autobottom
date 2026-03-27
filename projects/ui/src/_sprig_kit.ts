/**
 * @sprig/kit stub — provides decorator type signatures for Sprig source files.
 * The Sprig transpiler processes these at build time; this stub enables
 * Deno type-checking and test execution without the transpiler.
 */

// deno-lint-ignore no-explicit-any
type Constructor = new (...args: any[]) => any;

interface ServiceOptions {
  scope?: "singleton" | "transient";
  onStartup?: string[];
}

interface ComponentOptions {
  template?: string;
  island?: boolean;
}

interface InputOptions {
  required?: boolean;
  alias?: string;
}

export function Service(
  _options?: ServiceOptions,
): (target: Constructor) => void {
  return (_target: Constructor) => {};
}

export function Component(
  _options?: ComponentOptions,
): (target: Constructor) => void {
  return (_target: Constructor) => {};
}

export function Input(
  _options?: InputOptions,
  // deno-lint-ignore no-explicit-any
): (target: any, propertyKey: string) => void {
  // deno-lint-ignore no-explicit-any
  return (_target: any, _propertyKey: string) => {};
}
