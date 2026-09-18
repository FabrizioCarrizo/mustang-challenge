import type { Sex } from "@genesis/protocol";
import { Rng, hashString } from "../rng.ts";
import type { CallType } from "../cognition/system2/schemas.ts";
import { emptyUsage, type BrainProvider, type BrainRequest, type BrainResponse } from "./provider.ts";

/**
 * Contexto estructurado que los constructores de prompts adjuntan a cada
 * pedido para que el MockBrain pueda responder con coherencia sin leer texto.
 */
export interface MockContext {
  tick: number;
  seed: number;
  agentName: string;
  sex: Sex;
  isChild: boolean;
  hasHome: boolean;
  knows: string[];
  inventory: Record<string, number>;
  needs: Record<string, number>;
  season: string;
  nearby: Array<{ id: number; name: string; affinity: number; knows: string[]; inventory: Record<string, number> }>;
  beliefs: string[];
  recentMemories: string[];
  partner?: { id: number; name: string; affinity: number; knows: string[]; inventory: Record<string, number>; beliefs: string[] };
  event?: { kind: string; tags: string[]; text: string };
  groupName?: string | null;
  /** para el historiador */
  facts?: string[];
}

const MOODS = ["sereno", "esperanzado", "ansioso", "triste", "enojado", "asustado", "agradecido", "orgulloso", "curioso", "cansado", "apasionado", "resignado"] as const;

const BELIEF_SEEDS: Array<{ tags: string[]; statement: string; kind: string }> = [
  { tags: ["tormenta", "cielo"], statement: "Las tormentas son la ira de algo que vive en el cielo", kind: "cosmologia" },
  { tags: ["muerte"], statement: "Los que mueren siguen caminando en la montaña", kind: "mito" },
  { tags: ["sequia", "hambre"], statement: "La sequía llega cuando alguien roba comida a los suyos", kind: "moral" },
  { tags: ["fuego"], statement: "El fuego es un ser vivo que hay que alimentar y respetar", kind: "cosmologia" },
  { tags: ["agua", "lluvia"], statement: "El agua escucha a quien le habla con respeto", kind: "practica" },
  { tags: ["voz"], statement: "Hay una voz que no viene de nadie y que sabe cosas", kind: "cosmologia" },
  { tags: ["invierno", "frio"], statement: "El invierno es una prueba que separa a los que comparten de los que no", kind: "moral" },
  { tags: ["nacimiento"], statement: "Cada niño trae de vuelta a alguien que murió", kind: "mito" },
];

/** Cerebro determinista para pruebas y corridas sin API. */
export class MockBrain implements BrainProvider {
  readonly name = "mock";
  readonly model = "mock";
  constructor(private readonly latencyMs = 0) {}

  async call<T>(req: BrainRequest<T>): Promise<BrainResponse<T>> {
    const started = Date.now();
    if (this.latencyMs > 0) await new Promise((r) => setTimeout(r, this.latencyMs));
    if (req.signal?.aborted) {
      return { status: "aborted", parsed: null, raw: null, usage: emptyUsage(), model: this.model, provider: this.name, latencyMs: Date.now() - started, usd: 0, error: "abortado" };
    }
    const ctx = (req.meta?.mock ?? null) as MockContext | null;
    const rng = new Rng(hashString(`${req.type}|${req.agentId}|${ctx?.tick ?? 0}|${ctx?.seed ?? 0}`));
    const obj = ctx ? generate(req.type, ctx, rng) : {};
    const parsed = req.schema.safeParse(obj);
    const raw = JSON.stringify(obj);
    const usage = { inputTokens: 300, cacheRead: 5000, cacheWrite: 0, outputTokens: Math.ceil(raw.length / 3.6) };
    return {
      status: parsed.success ? "ok" : "invalid",
      parsed: parsed.success ? parsed.data : null,
      raw,
      usage,
      model: this.model,
      provider: this.name,
      latencyMs: Date.now() - started,
      usd: 0,
      error: parsed.success ? null : parsed.error.message,
    };
  }
}

function pick<T>(rng: Rng, arr: readonly T[]): T {
  return arr[rng.int(arr.length)]!;
}

function generate(type: CallType, c: MockContext, rng: Rng): unknown {
  switch (type) {
    case "daily_plan":
      return dailyPlan(c, rng);
    case "reflection":
      return reflection(c, rng);
    case "dialogue":
      return dialogue(c, rng);
    case "reaction":
      return reaction(c, rng);
    case "create":
      return create(c, rng);
    case "govern":
      return govern(c, rng);
    case "heritage":
      return heritage(c, rng);
    case "historian":
      return historian(c, rng);
    case "bard":
      return { titulo: "Canto del río", poema: "El río corre, la gente sigue,\nel fuego vive donde alguien lo cuida,\nla nieve olvida, la tribu no.", heroe: c.nearby[0]?.name ?? null };
  }
}

function dailyPlan(c: MockContext, rng: Rng) {
  const objetivos: unknown[] = [];
  const food = c.inventory.comida ?? 0;
  const wood = c.inventory.madera ?? 0;
  const cold = c.season === "otoño" || c.season === "invierno";
  const push = (verbo: string, tipo: string, nombre: string, cantidad: number | null, prioridad: number, motivo: string) =>
    objetivos.push({ verbo, objetivo: { tipo, nombre }, cantidad, hasta_hora: null, prioridad, motivo });
  if (food < 3) push("recolectar", "recurso", "comida", 4, 5, "tengo poca comida");
  if (!c.hasHome) {
    if (wood >= 4) push("construir", "estructura", "refugio", null, 5, "necesito un techo");
    else push("juntar", "recurso", "madera", 4, 4, "junto madera para un refugio");
  } else if (cold && wood < 4) push("juntar", "recurso", "madera", 4, 4, "leña para el frío");
  if (cold && food < 6) push("acopiar", "recurso", "comida", 6, 3, "el invierno se acerca");
  const friend = c.nearby.find((n) => n.affinity > 0.1) ?? c.nearby[0];
  if (friend) push("conversar", "ser", friend.name, null, 2, `quiero hablar con ${friend.name}`);
  const teachable = c.nearby.find((n) => c.knows.some((k) => !n.knows.includes(k)));
  if (teachable && rng.chance(0.4)) push("enseñar", "ser", teachable.name, null, 2, "sé algo que le puede servir");
  if (c.beliefs.length && rng.chance(0.3)) push("rezar", "ninguno", "", null, 1, "necesito calma");
  if (rng.chance(0.5)) push("explorar", "lugar", pick(rng, ["bosque", "colinas", "pradera"]), null, 1, "quiero conocer el lugar");
  if (objetivos.length < 3) push("descansar", "ninguno", "", null, 1, "un rato de calma");
  return {
    resumen_interno: `Me llamo ${c.agentName}. ${food < 3 ? "La comida me preocupa." : "Hoy estoy bien."} ${c.hasHome ? "Tengo mi refugio." : "Quiero un techo."}`,
    estado_animo: pick(rng, MOODS),
    objetivos: objetivos.slice(0, 6),
    riesgo_percibido: cold ? "El frío de la noche." : "Que se acabe la comida cerca.",
    deseo_social: friend ? [{ ser: friend.name, motivo: "compañía" }] : [],
    nota_diario: `Otro día. ${friend ? `Vi a ${friend.name} cerca.` : "No había nadie cerca."} ${cold ? "Hace frío y hay que juntar leña." : "El tiempo acompaña."}`,
  };
}

function reflection(c: MockContext, rng: Rng) {
  const creencias_nuevas: unknown[] = [];
  const tagsSeen = new Set<string>();
  for (const m of c.recentMemories) {
    const low = m.toLowerCase();
    if (low.includes("tormenta")) tagsSeen.add("tormenta");
    if (low.includes("murió") || low.includes("muero")) tagsSeen.add("muerte");
    if (low.includes("sequía")) tagsSeen.add("sequia");
    if (low.includes("fuego")) tagsSeen.add("fuego");
    if (low.includes("voz del cielo")) tagsSeen.add("voz");
  }
  for (const seed of BELIEF_SEEDS) {
    if (seed.tags.some((t) => tagsSeen.has(t)) && !c.beliefs.includes(seed.statement) && rng.chance(0.5)) {
      creencias_nuevas.push({ enunciado: seed.statement, tipo: seed.kind, confianza: 0.4 + rng.float() * 0.3, explica: seed.tags });
      break;
    }
  }
  const friend = c.nearby[0];
  return {
    sueño: rng.chance(0.4) ? pick(rng, ["Soñé con un río que hablaba", "Soñé que el fuego se apagaba y nadie podía encenderlo", "Soñé con una montaña llena de gente que ya no está"]) : null,
    reflexiones: [
      { texto: pick(rng, ["Cuando junto leña antes de que anochezca, duermo mejor", "Los que comparten comida terminan mejor acompañados", "El agua está lejos; conviene vivir cerca del río", "No conviene salir solo cuando hay tormenta"]), importancia: 4 + rng.int(4) },
      ...(friend ? [{ texto: `${friend.name} parece alguien con quien se puede contar`, importancia: 4 }] : []),
    ],
    creencias_nuevas,
    creencias_revisadas: [],
    relaciones: friend ? [{ ser: friend.name, confianza: 0.05, afinidad: 0.05, etiqueta: friend.affinity > 0.4 ? "amigo" : null }] : [],
    intencion_manana: rng.chance(0.5) ? "Juntar más comida y hablar con alguien" : null,
  };
}

function dialogue(c: MockContext, rng: Rng) {
  const p = c.partner!;
  const a = c.agentName;
  const turnos = [
    { hablante: "A", texto: pick(rng, [`Hola, ${p.name}. ¿Cómo va el día?`, `${p.name}, ¿viste el cielo? No me gusta.`, `${p.name}, ¿te sobra algo de comida?`]) },
    { hablante: "B", texto: pick(rng, [`Va. Con hambre, como siempre.`, `Lo vi. Mejor juntar leña.`, `Algo tengo. ¿Qué me das a cambio?`]) },
  ];
  const acuerdos: unknown[] = [];
  const myFood = c.inventory.comida ?? 0;
  const myWood = c.inventory.madera ?? 0;
  const theirFood = p.inventory.comida ?? 0;
  const theirWood = p.inventory.madera ?? 0;
  if (myWood >= 3 && theirFood >= 3 && myFood < 2 && rng.chance(0.7)) {
    turnos.push({ hablante: "A", texto: "Te doy madera por comida." }, { hablante: "B", texto: "Hecho. Una por una." });
    acuerdos.push({ tipo: "intercambio", de: "A", a: "B", objeto: "madera", cantidad: 1, contra_objeto: "comida", contra_cantidad: 1, texto: null });
  } else if (theirWood >= 3 && myFood >= 3 && theirFood < 2 && rng.chance(0.7)) {
    turnos.push({ hablante: "B", texto: "Cambiame comida por madera." }, { hablante: "A", texto: "Dale, una por una." });
    acuerdos.push({ tipo: "intercambio", de: "B", a: "A", objeto: "madera", cantidad: 1, contra_objeto: "comida", contra_cantidad: 1, texto: null });
  } else if (myFood >= 4 && theirFood < 1 && rng.chance(0.5)) {
    turnos.push({ hablante: "A", texto: "Tomá, tengo de sobra." }, { hablante: "B", texto: "Gracias. Te lo debo." });
    acuerdos.push({ tipo: "regalo", de: "A", a: "B", objeto: "comida", cantidad: 1, contra_objeto: null, contra_cantidad: null, texto: null });
  }
  const teach = c.knows.find((k) => !p.knows.includes(k));
  if (teach && rng.chance(0.4)) {
    turnos.push({ hablante: "A", texto: `Mirá, te muestro cómo se hace: ${teach}.` }, { hablante: "B", texto: "A ver... creo que entendí." });
    acuerdos.push({ tipo: "enseñanza", de: "A", a: "B", objeto: teach, cantidad: null, contra_objeto: null, contra_cantidad: null, texto: null });
  }
  const belief = c.beliefs.find((b) => !p.beliefs.includes(b));
  if (belief && rng.chance(0.5)) {
    turnos.push({ hablante: "A", texto: `Yo creo que ${belief.toLowerCase()}.` }, { hablante: "B", texto: "Puede ser. Nunca lo había pensado." });
    acuerdos.push({ tipo: "transmision_creencia", de: "A", a: "B", objeto: null, cantidad: null, contra_objeto: null, contra_cantidad: null, texto: belief });
  }
  if (p.affinity > 0.5 && rng.chance(0.2)) {
    acuerdos.push({ tipo: "alianza", de: "A", a: "B", objeto: null, cantidad: null, contra_objeto: null, contra_cantidad: null, texto: "nos cuidamos" });
  }
  const d = 0.03 + rng.float() * 0.08;
  return {
    turnos: turnos.slice(0, 6),
    acuerdos,
    cambio_relacion: { A_hacia_B: { confianza: d, afinidad: d }, B_hacia_A: { confianza: d * 0.8, afinidad: d * 0.8 } },
    animo_A: pick(rng, MOODS),
    animo_B: pick(rng, MOODS),
    resumen_para_A: `Hablé con ${p.name}; ${acuerdos.length ? "quedamos en algo" : "nada nuevo"}.`,
    resumen_para_B: `Hablé con ${a}; ${acuerdos.length ? "quedamos en algo" : "nada nuevo"}.`,
  };
}

function reaction(c: MockContext, rng: Rng) {
  const ev = c.event ?? { kind: "", tags: [], text: "" };
  let creencia: unknown = null;
  if (!c.beliefs.length || rng.chance(0.4)) {
    const seed = BELIEF_SEEDS.find((b) => b.tags.some((t) => ev.tags.includes(t)));
    if (seed && !c.beliefs.includes(seed.statement)) creencia = { enunciado: seed.statement, tipo: seed.kind, confianza: 0.45, explica: seed.tags };
  }
  const flee = ev.kind === "attack" || ev.kind === "storm";
  return {
    interpretacion: `${ev.text}. ${creencia ? "Algo lo habrá provocado." : "No sé por qué pasó."}`,
    emocion: flee ? "asustado" : pick(rng, ["triste", "ansioso", "curioso", "enojado"]),
    intensidad: 0.5 + rng.float() * 0.5,
    accion_inmediata: flee ? { verbo: "ir_a", objetivo: { tipo: "lugar", nombre: "casa" } } : null,
    creencia,
    explica_evento: creencia !== null,
    nota_diario: `Hoy ${ev.text.toLowerCase()}. No lo voy a olvidar.`,
  };
}

function create(c: MockContext, rng: Rng) {
  const invent = rng.chance(0.35);
  if (invent) {
    const has = Object.keys(c.inventory);
    const target = pick(rng, ["herramienta", "cantaro", "ropa", "arma", "tablilla"]);
    return {
      tipo: "invento",
      titulo: `Intento de ${target}`,
      contenido: `Probé juntar ${has.slice(0, 2).join(" y ") || "lo que tenía"} para hacer ${target}.`,
      materiales: has.slice(0, 2),
      receta_propuesta: { resultado: target, ingredientes: has.slice(0, 2), proceso: "golpear y atar" },
      dedicado_a: null,
      nota_diario: "Hoy intenté inventar algo.",
    };
  }
  const tipo = pick(rng, ["arte", "canto", "relato", "ritual"] as const);
  return {
    tipo,
    titulo: pick(rng, ["El río de la mañana", "Canto de la leña", "Lo que dijo el viento", "La noche larga"]),
    contenido: pick(rng, [
      "Cuando el frío muerde, la leña canta. Cuando el río calla, la gente escucha.",
      "Había una vez un fuego que no quería apagarse, y una tribu que aprendió a alimentarlo.",
      "Dibujé en la piedra el agua y la montaña, para que alguien las recuerde.",
    ]),
    materiales: [],
    receta_propuesta: null,
    dedicado_a: c.nearby[0]?.name ?? null,
    nota_diario: "Hice algo que no sirve para comer y me hizo bien.",
  };
}

function govern(c: MockContext, rng: Rng) {
  const tipo = pick(rng, ["ley", "ritual", "ley"] as const);
  if (tipo === "ritual") {
    return {
      tipo,
      enunciado: "Cada ocho días nos juntamos al atardecer junto al fuego",
      regla: null,
      objetivo_grupo: null,
      ritual: { nombre: "la reunión del fuego", cada_dias: 8, creencia: c.beliefs[0] ?? null },
      discurso: "Gente mía: cada ocho días, al caer el sol, nos juntamos alrededor del fuego. Los que están, cuentan; los que faltan, se recuerdan.",
    };
  }
  return {
    tipo: "ley",
    enunciado: "Nadie roba comida a los suyos; quien lo haga será castigado",
    regla: { prohibe: ["robar"], castigo: "multa" },
    objetivo_grupo: null,
    ritual: null,
    discurso: "Escuchen. Entre nosotros no se roba. El que robe devuelve el doble. Así seguimos vivos.",
  };
}

function heritage(c: MockContext, rng: Rng) {
  return {
    enseñanzas: `Mis padres me enseñaron que la leña se junta antes de que anochezca, que la comida se comparte con los que ayudan y que ${c.beliefs[0] ? c.beliefs[0].toLowerCase() : "el mundo no explica nada por sí solo"}.`,
    valores: ["juntar antes del frío", "compartir con los que ayudan", pick(rng, ["honrar el fuego", "no confiar en desconocidos", "escuchar a los viejos"])],
    tabues: rng.chance(0.5) ? ["robar comida a los propios"] : [],
    relato_origen: c.groupName ? `Dicen que los primeros de ${c.groupName} llegaron con el primer deshielo.` : null,
  };
}

function historian(c: MockContext, rng: Rng) {
  const facts = c.facts ?? [];
  return {
    titulo_periodo: pick(rng, ["Los días del primer fuego", "Un invierno largo", "Cuando aprendimos a juntar"]),
    cronica: `En este período ${facts.length ? "pasaron cosas que la gente recuerda: " + facts.slice(0, 5).join("; ") + "." : "la vida siguió su curso sin hechos que destacar."} Los seres sobrevivieron como pudieron, juntando comida y leña, y hablando entre ellos cuando el frío lo permitía.`,
    temas: ["supervivencia", "fuego", "comunidad"],
    protagonistas: c.nearby.slice(0, 3).map((n) => n.name),
    nombre_epoca_sugerido: null,
  };
}
