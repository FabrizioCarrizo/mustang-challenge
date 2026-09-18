import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

describe("determinismo", () => {
  it("el motor no usa Math.random ni la hora real", () => {
    const src = join(import.meta.dirname, "..", "src");
    const offenders: string[] = [];
    for (const file of walk(src)) {
      if (file.includes("/persistence/") || file.includes("/brain/")) continue; // I/O y llamadas externas sí pueden usar la hora real
      const text = readFileSync(file, "utf8");
      if (/Math\.random\(|Date\.now\(|new Date\(/.test(text)) offenders.push(file.replace(src, ""));
    }
    expect(offenders).toEqual([]);
  });
});
