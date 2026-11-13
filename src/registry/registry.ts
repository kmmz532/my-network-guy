// ID で引く定義の登録表。登録は起動の時だけで、凍結の後は変えられない。
export class UnknownIdError extends Error {
  constructor(readonly kind: string, readonly id: string) {
    super(`未登録の${kind}: ${id}`);
    this.name = 'UnknownIdError';
  }
}

export class Registry<T extends { id: string }> {
  private readonly entries = new Map<string, T>();
  private frozen = false;

  constructor(private readonly kind: string) {}

  register(entry: T): void {
    if (this.frozen) throw new Error(`凍結済みの${this.kind}の登録表には登録できない: ${entry.id}`);
    if (this.entries.has(entry.id)) throw new Error(`${this.kind}の ID が重複している: ${entry.id}`);
    this.entries.set(entry.id, entry);
  }

  freeze(): void {
    this.frozen = true;
  }

  get(id: string): T {
    const entry = this.entries.get(id);
    if (entry === undefined) throw new UnknownIdError(this.kind, id);
    return entry;
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  all(): readonly T[] {
    return [...this.entries.values()];
  }
}
