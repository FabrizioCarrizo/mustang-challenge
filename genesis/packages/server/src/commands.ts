export interface CommandContext {
  values: Record<string, string | boolean | undefined>;
  worldsDir: string;
  worldName: string;
  brainMode: string;
}

/** Comandos adicionales de la CLI (se completan en fases posteriores). */
export const commands: Record<string, (ctx: CommandContext) => Promise<void>> = {};
