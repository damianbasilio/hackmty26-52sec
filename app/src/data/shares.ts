/**
 * Reparte `totalCents` en `count` partes iguales y da el sobrante de centavo en
 * centavo a quien llegó primero. Es la misma regla que `rebalance_split()` en
 * `db/schema.sql`, para que la app y la base nunca difieran por un peso.
 *
 * `sum(sharesFor(total, n)) === total` para todo `total >= 0`, `n > 0`.
 */
export function sharesFor(totalCents: number, count: number): number[] {
  if (count <= 0) return [];
  const base = Math.floor(totalCents / count);
  const remainder = totalCents - base * count;
  return Array.from({ length: count }, (_, index) => base + (index < remainder ? 1 : 0));
}
