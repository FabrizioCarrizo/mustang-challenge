import { z } from "zod";

/**
 * Schemas de las llamadas System 2. Claves en español porque es lo que ven
 * los seres. Sin recursión ni límites numéricos estrictos (los validamos
 * después, con tolerancia).
 */

export const CALL_TYPES = ["daily_plan", "reflection", "dialogue", "reaction", "create", "govern", "heritage", "historian", "bard"] as const;
export type CallType = (typeof CALL_TYPES)[number];

export const PLAN_VERBS = [
  "recolectar",
  "juntar",
  "cazar",
  "ir_a",
  "construir",
  "fabricar",
  "ofrecer_trueque",
  "regalar",
  "conversar",
  "enseñar",
  "leer",
  "escribir",
  "rezar",
  "ritual",
  "crear",
  "explorar",
  "acopiar",
  "sembrar",
  "cuidar",
  "descansar",
  "reclamar",
  "atacar",
  "robar",
  "castigar",
  "cargar_agua",
] as const;

export const TARGET_KINDS = ["recurso", "ser", "lugar", "estructura", "objeto", "ninguno"] as const;

export const MOODS = [
  "sereno",
  "esperanzado",
  "ansioso",
  "triste",
  "enojado",
  "asustado",
  "agradecido",
  "orgulloso",
  "curioso",
  "cansado",
  "apasionado",
  "resignado",
] as const;

export const ObjectiveSchema = z.object({
  tipo: z.enum(TARGET_KINDS),
  /** nombre del recurso, del ser, del lugar ("casa", "agua", "bosque", "colinas", "tribu", "x,y") o de la estructura */
  nombre: z.string(),
});

export const PlanStepSchema = z.object({
  verbo: z.enum(PLAN_VERBS),
  objetivo: ObjectiveSchema,
  cantidad: z.number().nullable(),
  hasta_hora: z.number().nullable(),
  prioridad: z.number(),
  motivo: z.string(),
});

export const DailyPlanSchema = z.object({
  resumen_interno: z.string(),
  estado_animo: z.enum(MOODS),
  objetivos: z.array(PlanStepSchema),
  riesgo_percibido: z.string(),
  deseo_social: z.array(z.object({ ser: z.string(), motivo: z.string() })),
  nota_diario: z.string(),
});
export type DailyPlan = z.infer<typeof DailyPlanSchema>;

export const BELIEF_KINDS = ["cosmologia", "moral", "practica", "identidad", "mito", "norma"] as const;

export const ReflectionSchema = z.object({
  sueño: z.string().nullable(),
  reflexiones: z.array(z.object({ texto: z.string(), importancia: z.number() })),
  creencias_nuevas: z.array(
    z.object({
      enunciado: z.string(),
      tipo: z.enum(BELIEF_KINDS),
      confianza: z.number(),
      explica: z.array(z.string()),
    }),
  ),
  creencias_revisadas: z.array(z.object({ enunciado: z.string(), confianza: z.number() })),
  relaciones: z.array(z.object({ ser: z.string(), confianza: z.number(), afinidad: z.number(), etiqueta: z.string().nullable() })),
  intencion_manana: z.string().nullable(),
});
export type Reflection = z.infer<typeof ReflectionSchema>;

export const AGREEMENT_KINDS = [
  "intercambio",
  "regalo",
  "promesa",
  "alianza",
  "enseñanza",
  "transmision_creencia",
  "invitacion",
  "amenaza",
  "reconciliacion",
  "union",
  "deuda",
  "ninguno",
] as const;

export const DialogueSchema = z.object({
  turnos: z.array(z.object({ hablante: z.enum(["A", "B"]), texto: z.string() })),
  acuerdos: z.array(
    z.object({
      tipo: z.enum(AGREEMENT_KINDS),
      de: z.enum(["A", "B"]),
      a: z.enum(["A", "B"]),
      objeto: z.string().nullable(),
      cantidad: z.number().nullable(),
      contra_objeto: z.string().nullable(),
      contra_cantidad: z.number().nullable(),
      texto: z.string().nullable(),
    }),
  ),
  cambio_relacion: z.object({
    A_hacia_B: z.object({ confianza: z.number(), afinidad: z.number() }),
    B_hacia_A: z.object({ confianza: z.number(), afinidad: z.number() }),
  }),
  animo_A: z.enum(MOODS),
  animo_B: z.enum(MOODS),
  resumen_para_A: z.string(),
  resumen_para_B: z.string(),
});
export type Dialogue = z.infer<typeof DialogueSchema>;

export const ReactionSchema = z.object({
  interpretacion: z.string(),
  emocion: z.enum(MOODS),
  intensidad: z.number(),
  accion_inmediata: z.object({ verbo: z.enum(PLAN_VERBS), objetivo: ObjectiveSchema }).nullable(),
  creencia: z
    .object({
      enunciado: z.string(),
      tipo: z.enum(BELIEF_KINDS),
      confianza: z.number(),
      explica: z.array(z.string()),
    })
    .nullable(),
  explica_evento: z.boolean(),
  nota_diario: z.string(),
});
export type Reaction = z.infer<typeof ReactionSchema>;

export const CREATION_KINDS = ["arte", "texto", "canto", "invento", "ritual", "relato"] as const;

export const CreateSchema = z.object({
  tipo: z.enum(CREATION_KINDS),
  titulo: z.string(),
  contenido: z.string(),
  materiales: z.array(z.string()),
  receta_propuesta: z
    .object({
      resultado: z.string(),
      ingredientes: z.array(z.string()),
      proceso: z.string(),
    })
    .nullable(),
  dedicado_a: z.string().nullable(),
  nota_diario: z.string(),
});
export type Creation = z.infer<typeof CreateSchema>;

export const DECREE_KINDS = ["ley", "tratado", "guerra", "paz", "ritual", "tributo", "nombramiento", "exilio", "migracion"] as const;
export const PUNISHMENTS = ["exilio", "multa", "golpe", "nada"] as const;

export const GovernSchema = z.object({
  tipo: z.enum(DECREE_KINDS),
  enunciado: z.string(),
  regla: z
    .object({
      prohibe: z.array(z.enum(PLAN_VERBS)),
      castigo: z.enum(PUNISHMENTS),
    })
    .nullable(),
  objetivo_grupo: z.string().nullable(),
  ritual: z.object({ nombre: z.string(), cada_dias: z.number(), creencia: z.string().nullable() }).nullable(),
  discurso: z.string(),
});
export type Govern = z.infer<typeof GovernSchema>;

export const HeritageSchema = z.object({
  enseñanzas: z.string(),
  valores: z.array(z.string()),
  tabues: z.array(z.string()),
  relato_origen: z.string().nullable(),
});
export type Heritage = z.infer<typeof HeritageSchema>;

export const HistorianSchema = z.object({
  titulo_periodo: z.string(),
  cronica: z.string(),
  temas: z.array(z.string()),
  protagonistas: z.array(z.string()),
  nombre_epoca_sugerido: z.string().nullable(),
});
export type Historian = z.infer<typeof HistorianSchema>;

export const BardSchema = z.object({
  titulo: z.string(),
  poema: z.string(),
  heroe: z.string().nullable(),
});
export type Bard = z.infer<typeof BardSchema>;

export const SCHEMAS = {
  daily_plan: DailyPlanSchema,
  reflection: ReflectionSchema,
  dialogue: DialogueSchema,
  reaction: ReactionSchema,
  create: CreateSchema,
  govern: GovernSchema,
  heritage: HeritageSchema,
  historian: HistorianSchema,
  bard: BardSchema,
} as const;

export type SchemaOf<T extends CallType> = (typeof SCHEMAS)[T];
export type OutputOf<T extends CallType> = z.infer<SchemaOf<T>>;

/** Tope de tokens de salida por tipo de llamada. */
export const MAX_TOKENS: Record<CallType, number> = {
  daily_plan: 900,
  reflection: 1000,
  dialogue: 1300,
  reaction: 500,
  create: 1000,
  govern: 900,
  heritage: 800,
  historian: 3000,
  bard: 1200,
};

/** Ruta por defecto de cada llamada. */
export const DEFAULT_ROUTE: Record<CallType, "routine" | "epochal"> = {
  daily_plan: "routine",
  reflection: "routine",
  dialogue: "routine",
  reaction: "routine",
  create: "routine",
  govern: "epochal",
  heritage: "epochal",
  historian: "epochal",
  bard: "epochal",
};
