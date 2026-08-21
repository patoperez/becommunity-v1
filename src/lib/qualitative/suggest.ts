const RULES: { theme: string; words: string[] }[] = [
  { theme: "atencion_y_servicio", words: ["atencion", "trato", "servicio", "amable", "personal"] },
  { theme: "comunicacion", words: ["comunicacion", "informacion", "aviso", "respuesta", "mensaje"] },
  { theme: "instalaciones", words: ["instalacion", "salon", "limpieza", "espacio", "infraestructura"] },
  { theme: "docentes", words: ["maestro", "maestra", "docente", "profesor", "clase"] },
  { theme: "precio_y_valor", words: ["precio", "costo", "colegiatura", "caro", "valor"] },
  { theme: "seguridad", words: ["seguridad", "seguro", "riesgo", "vigilancia"] },
];

function normalize(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es-MX");
}

export function normalizeTheme(value: string): string {
  return normalize(value).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 120);
}

/** Deterministic first-pass suggestion. A human must confirm every result. */
export function suggestTheme(quote: string, sourceTheme?: string | null): string {
  const normalizedQuote = normalize(quote);
  let best: { theme: string; score: number } | null = null;
  for (const rule of RULES) {
    const score = rule.words.reduce((total, word) => total + (normalizedQuote.includes(word) ? 1 : 0), 0);
    if (score > 0 && (!best || score > best.score)) best = { theme: rule.theme, score };
  }
  return best?.theme ?? (normalizeTheme(sourceTheme ?? "") || "sin_clasificar");
}
