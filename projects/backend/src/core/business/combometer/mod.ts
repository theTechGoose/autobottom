export interface ComboConfig {
  baseMs: number;
  bankPerEvent: number;
  maxBankMs: number;
}

// deno-lint-ignore no-explicit-any
export type ComboEvent<T = any> = { previous: number; new: number; data: T | null };

// deno-lint-ignore no-explicit-any
type Observer<T = any> = (e: ComboEvent<T>) => void;

export interface ComboConsumer<T = unknown> {
  onDrop: (e: ComboEvent<T>) => void;
  tiers: ((e: ComboEvent<T>) => void)[];
}

export class Combometer<T = unknown> {
  #config: ComboConfig;
  #combo = -1;
  #bank = 0;
  #observers = new Set<Observer<T>>();
  #timer: ReturnType<typeof setTimeout> | null = null;
  #lastTickAt = 0;

  constructor(config: ComboConfig) {
    this.#config = config;
  }

  get combo(): number {
    return this.#combo;
  }

  get bankRemaining(): number {
    if (this.#combo < 0 || this.#config.baseMs === 0) return 0;
    return Math.max(0, this.#bank - (Date.now() - this.#lastTickAt));
  }

  tick(data?: T): void {
    if (this.#combo >= 0 && this.#config.baseMs > 0) {
      const elapsed = Date.now() - this.#lastTickAt;
      this.#bank -= elapsed;
      if (this.#bank <= 0) {
        const from = this.#combo;
        this.#combo = -1;
        this.#bank = 0;
        this.#clearTimer();
        this.#emit({ previous: from, new: -1, data: null });
      }
    }

    const prev = this.#combo;
    this.#combo++;

    if (this.#config.baseMs > 0) {
      if (this.#combo === 0) {
        this.#bank = this.#config.baseMs;
      } else {
        this.#bank += this.#config.bankPerEvent;
      }

      if (this.#config.maxBankMs > 0) {
        this.#bank = Math.min(this.#bank, this.#config.maxBankMs);
      }

      this.#lastTickAt = Date.now();
      this.#startDrain();
    }

    this.#emit({ previous: prev, new: this.#combo, data: data ?? null });
  }

  reset(): void {
    const had = this.#combo;
    this.#combo = -1;
    this.#bank = 0;
    this.#clearTimer();
    if (had >= 0) {
      this.#emit({ previous: had, new: -1, data: null });
    }
  }

  observe(cb: Observer<T>): () => void {
    this.#observers.add(cb);
    return () => {
      this.#observers.delete(cb);
    };
  }

  consume(consumer: ComboConsumer<T>): () => void {
    return this.observe((e) => {
      if (e.new === -1) {
        consumer.onDrop(e);
      } else {
        const idx = Math.min(e.new, consumer.tiers.length - 1);
        consumer.tiers[idx](e);
      }
    });
  }

  destroy(): void {
    this.#clearTimer();
    this.#observers.clear();
  }

  #emit(e: ComboEvent<T>): void {
    for (const cb of this.#observers) {
      cb(e);
    }
  }

  #startDrain(): void {
    this.#clearTimer();
    if (this.#bank <= 0) return;

    this.#timer = setTimeout(() => {
      this.#timer = null;
      const prev = this.#combo;
      this.#combo = -1;
      this.#bank = 0;
      this.#emit({ previous: prev, new: -1, data: null });
    }, this.#bank);
  }

  #clearTimer(): void {
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
  }
}
