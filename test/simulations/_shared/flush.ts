export async function flushMicrotasks(rounds = 5): Promise<void> {
  const n = Number.isFinite(rounds) && rounds > 0 ? Math.floor(rounds) : 5
  for (let i = 0; i < n; i++) {
    await new Promise<void>((r) => setTimeout(r, 0))
  }
}
