import type { ItemKind } from "@genesis/protocol";

export interface TradeRecord {
  tick: number;
  aId: number;
  bId: number;
  gave: Record<string, number>;
  got: Record<string, number>;
}

export interface CurrencyVerdict {
  item: ItemKind | null;
  acceptance: number;
  distinctGoods: number;
  holdersShare: number;
  consumptionRatio: number;
  trades: number;
}

/**
 * Moneda emergente: un bien que aparece en muchos trueques, compra bienes
 * distintos, lo tiene mucha gente y casi no se consume.
 */
export function detectCurrency(
  trades: TradeRecord[],
  holders: Map<string, number>,
  population: number,
  consumed: Map<string, number>,
  opts = { minTrades: 20, minAcceptance: 0.3, minDistinct: 2, minHolders: 0.3, maxConsumption: 0.2 },
): CurrencyVerdict {
  const n = trades.length;
  const none: CurrencyVerdict = { item: null, acceptance: 0, distinctGoods: 0, holdersShare: 0, consumptionRatio: 0, trades: n };
  if (n < opts.minTrades) return none;
  const appearances = new Map<string, number>();
  const counterparts = new Map<string, Set<string>>();
  const traded = new Map<string, number>();
  for (const t of trades) {
    const sides = [Object.keys(t.gave), Object.keys(t.got)] as const;
    const items = new Set([...sides[0], ...sides[1]]);
    for (const it of items) appearances.set(it, (appearances.get(it) ?? 0) + 1);
    for (const g of sides[0]) for (const h of sides[1]) {
      if (g === h) continue;
      (counterparts.get(g) ?? counterparts.set(g, new Set()).get(g)!).add(h);
      (counterparts.get(h) ?? counterparts.set(h, new Set()).get(h)!).add(g);
    }
    for (const [it, q] of Object.entries(t.gave)) traded.set(it, (traded.get(it) ?? 0) + q);
    for (const [it, q] of Object.entries(t.got)) traded.set(it, (traded.get(it) ?? 0) + q);
  }
  let best: CurrencyVerdict = none;
  for (const [item, count] of appearances) {
    const acceptance = count / n;
    const distinct = counterparts.get(item)?.size ?? 0;
    const holdersShare = population > 0 ? (holders.get(item) ?? 0) / population : 0;
    const tradedUnits = traded.get(item) ?? 0;
    const consumptionRatio = tradedUnits > 0 ? (consumed.get(item) ?? 0) / tradedUnits : 1;
    const verdict: CurrencyVerdict = { item: item as ItemKind, acceptance, distinctGoods: distinct, holdersShare, consumptionRatio, trades: n };
    const ok = acceptance >= opts.minAcceptance && distinct >= opts.minDistinct && holdersShare >= opts.minHolders && consumptionRatio <= opts.maxConsumption;
    if (ok && acceptance > best.acceptance) best = verdict;
  }
  return best;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const v = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid]! : (v[mid - 1]! + v[mid]!) / 2;
}

/**
 * Precios implícitos con la comida como numerario (o la moneda, si existe):
 * mediana de los ratios de intercambio, con un salto a través de un bien puente.
 */
export function priceIndex(trades: TradeRecord[], numeraire: string = "comida"): Map<string, number> {
  const ratios = new Map<string, number[]>(); // "x/y" → unidades de y por unidad de x
  const add = (x: string, qx: number, y: string, qy: number) => {
    if (x === y || qx <= 0 || qy <= 0) return;
    (ratios.get(`${x}/${y}`) ?? ratios.set(`${x}/${y}`, []).get(`${x}/${y}`)!).push(qy / qx);
    (ratios.get(`${y}/${x}`) ?? ratios.set(`${y}/${x}`, []).get(`${y}/${x}`)!).push(qx / qy);
  };
  for (const t of trades) {
    for (const [g, qg] of Object.entries(t.gave)) for (const [h, qh] of Object.entries(t.got)) add(g, qg, h, qh);
  }
  const prices = new Map<string, number>();
  prices.set(numeraire, 1);
  const goods = new Set<string>();
  for (const k of ratios.keys()) goods.add(k.split("/")[0]!);
  // directos
  for (const g of goods) {
    const r = ratios.get(`${g}/${numeraire}`);
    if (r && r.length) prices.set(g, median(r));
  }
  // un salto
  for (const g of goods) {
    if (prices.has(g)) continue;
    const candidates: number[] = [];
    for (const bridge of goods) {
      const pb = prices.get(bridge);
      const r = ratios.get(`${g}/${bridge}`);
      if (pb && r && r.length) candidates.push(median(r) * pb);
    }
    if (candidates.length) prices.set(g, median(candidates));
  }
  return prices;
}

export function cpi(prices: Map<string, number>, baseline: Map<string, number>): number {
  let logSum = 0;
  let n = 0;
  for (const [g, p] of prices) {
    const b = baseline.get(g);
    if (!b || b <= 0 || p <= 0) continue;
    logSum += Math.log(p / b);
    n++;
  }
  return n ? Math.exp(logSum / n) : 1;
}
