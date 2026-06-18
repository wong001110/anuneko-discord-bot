export class CooldownStore {
  private readonly lastUsedAtByKey = new Map<string, number>();

  constructor(private readonly cooldownMs: number) {}

  getRemainingMs(key: string, now = Date.now()): number {
    const lastUsedAt = this.lastUsedAtByKey.get(key);

    if (!lastUsedAt) {
      return 0;
    }

    return Math.max(0, this.cooldownMs - (now - lastUsedAt));
  }

  markUsed(key: string, now = Date.now()): void {
    this.lastUsedAtByKey.set(key, now);
  }
}
