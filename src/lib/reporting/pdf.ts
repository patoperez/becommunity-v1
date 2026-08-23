import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";
import {
  computeStageMetric,
  computeStudyMetrics,
  type LongRow,
} from "@/lib/calc/engine";
import { sampleVisibility } from "@/lib/calc/disclosure";
import { formatScore } from "@/lib/calc/format";
import type { JourneyStage } from "@/lib/calc/journey";
import { DEFAULT_DASHBOARD_SECTIONS, type DashboardSections } from "@/lib/dashboard/config";
import {
  summarizeConfirmedQualitative,
  type ConfirmedQualitative,
} from "@/lib/qualitative/published";
import type { SegmentFilters } from "@/lib/calc/filters";
import { DEFAULT_BRAND, hexToRgb, type BrandConfig } from "@/lib/branding/config";

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 48;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const CONTENT_TOP = PAGE_HEIGHT - MARGIN;
// Footer geometry. CONTENT_BOTTOM is the lowest the body cursor may reach, so
// every page keeps a real gap between its last line of text and the footer rule
// instead of running the text down onto it.
const FOOTER_RULE_Y = 42;
const FOOTER_TEXT_Y = 27;
const CONTENT_BOTTOM = 72;
const FOOTER_CLEARANCE = CONTENT_BOTTOM - FOOTER_RULE_Y;

const INK = rgb(0.11, 0.12, 0.15);
const MUTED = rgb(0.38, 0.4, 0.45);
const LINE = rgb(0.86, 0.87, 0.9);
const WARNING = rgb(0.64, 0.38, 0.04);
const WARNING_LIGHT = rgb(1, 0.97, 0.86);

/**
 * Pagination facts measured while the report is written. Exposed so layout
 * invariants (footer clearance, an orphaned closing section) can be asserted
 * deterministically instead of eyeballing the rendered file.
 */
export type ReportLayout = {
  pages: number;
  contentTop: number;
  contentBottom: number;
  footerRuleY: number;
  footerClearance: number;
  /** Lowest body cursor reached on each page. */
  pageLowestY: number[];
  /** Number of drawn body blocks on each page. */
  pageBlocks: number[];
  /** Page (1-based) each section heading was placed on. */
  sectionPages: { section: string; page: number }[];
  /** First and last page of each keep-together block; equal when unsplit. */
  groupPages: { startPage: number; endPage: number }[];
};

export type StudyPdfInput = {
  tenantName: string;
  brand?: BrandConfig;
  study: {
    id: string;
    name: string;
    period: string | null;
    status: string;
  };
  rows: LongRow[];
  journeyStages: JourneyStage[];
  qualitative: ConfirmedQualitative[];
  filters: SegmentFilters;
  sections?: DashboardSections;
  generatedAt?: Date;
};

function safeText(value: string): string {
  return value
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\u2026/g, "...")
    .replace(/\u2265/g, ">=")
    .replace(/\u2264/g, "<=")
    .replace(/\u00b7/g, "-")
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");
}

function humanize(value: string): string {
  return value.replace(/_/g, " ");
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = safeText(text).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let line = words[0];
  for (const word of words.slice(1)) {
    const candidate = `${line} ${word}`;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) line = candidate;
    else {
      lines.push(line);
      line = word;
    }
  }
  lines.push(line);
  return lines;
}

class ReportWriter {
  private page!: PDFPage;
  private y = 0;
  private pageIndex = -1;
  // Dry mode measures a block's height without drawing it or breaking a page,
  // which is what makes keep-together (`group`) possible.
  private dry = false;
  private readonly lowest: number[] = [];
  private readonly blocks: number[] = [];
  private readonly sections: { section: string; page: number }[] = [];
  private readonly groups: { startPage: number; endPage: number }[] = [];

  constructor(
    private readonly pdf: PDFDocument,
    private readonly regular: PDFFont,
    private readonly bold: PDFFont,
    private readonly studyName: string,
    private readonly brandColor: ReturnType<typeof rgb>,
    private readonly brandLight: ReturnType<typeof rgb>,
  ) {
    this.addPage();
  }

  private addPage() {
    this.page = this.pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    this.y = CONTENT_TOP;
    this.pageIndex += 1;
    this.lowest[this.pageIndex] = CONTENT_TOP;
    this.blocks[this.pageIndex] = 0;
  }

  private mark() {
    if (this.dry) return;
    this.lowest[this.pageIndex] = Math.min(this.lowest[this.pageIndex], this.y);
    this.blocks[this.pageIndex] += 1;
  }

  private ensure(height: number) {
    if (this.dry) return;
    if (this.y - height < CONTENT_BOTTOM) this.addPage();
  }

  /**
   * Keeps a whole block on one page. The block is measured first; if it does
   * not fit in the room left on the current page it starts on the next one, so
   * a closing section never strands a single paragraph on its own.
   */
  group(render: () => void) {
    const startY = this.y;
    this.dry = true;
    render();
    const height = startY - this.y;
    this.dry = false;
    this.y = startY;
    // A block taller than a whole page has to flow anyway; forcing a break
    // there would waste a page without keeping anything together.
    if (height <= CONTENT_TOP - CONTENT_BOTTOM) this.ensure(height);
    const startPage = this.pageIndex + 1;
    render();
    this.groups.push({ startPage, endPage: this.pageIndex + 1 });
  }

  gap(points: number) {
    this.y -= points;
  }

  rule() {
    this.ensure(10);
    if (this.dry) {
      this.y -= 10;
      return;
    }
    this.page.drawLine({
      start: { x: MARGIN, y: this.y },
      end: { x: PAGE_WIDTH - MARGIN, y: this.y },
      thickness: 0.7,
      color: LINE,
    });
    this.y -= 10;
  }

  text(
    value: string,
    options: {
      size?: number;
      color?: ReturnType<typeof rgb>;
      bold?: boolean;
      indent?: number;
      maxWidth?: number;
      lineHeight?: number;
    } = {},
  ) {
    const size = options.size ?? 10;
    const font = options.bold ? this.bold : this.regular;
    const indent = options.indent ?? 0;
    const lineHeight = options.lineHeight ?? size * 1.35;
    const lines = wrap(value, font, size, options.maxWidth ?? CONTENT_WIDTH - indent);
    this.ensure(lines.length * lineHeight + 2);
    for (const line of lines) {
      if (!this.dry) {
        this.page.drawText(line, {
          x: MARGIN + indent,
          y: this.y - size,
          size,
          font,
          color: options.color ?? INK,
        });
      }
      this.y -= lineHeight;
    }
    this.y -= 2;
    this.mark();
  }

  title(value: string) {
    this.text(value, { size: 24, bold: true, color: this.brandColor, lineHeight: 29 });
  }

  section(value: string) {
    // Reserve the lead-in gap, the heading, its rule and one body line so a
    // section title can never be stranded at the foot of a page.
    this.ensure(8 + 19 + 2 + 10 + 15);
    this.y -= 8;
    if (!this.dry) this.sections.push({ section: value, page: this.pageIndex + 1 });
    this.text(value, { size: 15, bold: true, color: this.brandColor, lineHeight: 19 });
    this.rule();
  }

  subheading(value: string) {
    // Keep a subsection title with at least the first result card.
    this.ensure(68);
    this.text(value, { size: 11, bold: true, lineHeight: 15 });
  }

  callout(value: string, warning = false) {
    const fontSize = 9.5;
    const lines = wrap(value, this.regular, fontSize, CONTENT_WIDTH - 24);
    const height = lines.length * 13 + 18;
    this.ensure(height + 4);
    if (this.dry) {
      this.y -= height + 6;
      return;
    }
    this.page.drawRectangle({
      x: MARGIN,
      y: this.y - height,
      width: CONTENT_WIDTH,
      height,
      color: warning ? WARNING_LIGHT : this.brandLight,
    });
    let lineY = this.y - 13;
    for (const line of lines) {
      this.page.drawText(line, {
        x: MARGIN + 12,
        y: lineY,
        size: fontSize,
        font: this.regular,
        color: warning ? WARNING : this.brandColor,
      });
      lineY -= 13;
    }
    this.y -= height + 6;
    this.mark();
  }

  metric(label: string, value: string, detail: string, suppressed = false) {
    this.ensure(42);
    if (this.dry) {
      this.y -= 42;
      return;
    }
    this.page.drawRectangle({
      x: MARGIN,
      y: this.y - 35,
      width: CONTENT_WIDTH,
      height: 35,
      borderColor: LINE,
      borderWidth: 0.7,
      color: rgb(0.985, 0.985, 0.99),
    });
    this.page.drawText(safeText(label), {
      x: MARGIN + 10,
      y: this.y - 14,
      size: 9,
      font: this.bold,
      color: MUTED,
    });
    this.page.drawText(safeText(suppressed ? "Muestra insuficiente" : value), {
      x: MARGIN + 10,
      y: this.y - 29,
      size: suppressed ? 10 : 13,
      font: this.bold,
      color: suppressed ? WARNING : INK,
    });
    if (!suppressed) {
      const detailWidth = this.regular.widthOfTextAtSize(safeText(detail), 8.5);
      this.page.drawText(safeText(detail), {
        x: Math.max(MARGIN + 180, PAGE_WIDTH - MARGIN - detailWidth - 10),
        y: this.y - 24,
        size: 8.5,
        font: this.regular,
        color: MUTED,
      });
    }
    this.y -= 42;
    this.mark();
  }

  layout(): ReportLayout {
    return {
      pages: this.pdf.getPageCount(),
      contentTop: CONTENT_TOP,
      contentBottom: CONTENT_BOTTOM,
      footerRuleY: FOOTER_RULE_Y,
      footerClearance: FOOTER_CLEARANCE,
      pageLowestY: [...this.lowest],
      pageBlocks: [...this.blocks],
      sectionPages: [...this.sections],
      groupPages: [...this.groups],
    };
  }

  finalize() {
    const pages = this.pdf.getPages();
    pages.forEach((page, index) => {
      page.drawLine({
        start: { x: MARGIN, y: FOOTER_RULE_Y },
        end: { x: PAGE_WIDTH - MARGIN, y: FOOTER_RULE_Y },
        thickness: 0.5,
        color: LINE,
      });
      page.drawText(safeText(`Be Community - ${this.studyName}`), {
        x: MARGIN,
        y: FOOTER_TEXT_Y,
        size: 7.5,
        font: this.regular,
        color: MUTED,
      });
      const pageLabel = `Pagina ${index + 1} de ${pages.length}`;
      const width = this.regular.widthOfTextAtSize(pageLabel, 7.5);
      page.drawText(pageLabel, {
        x: PAGE_WIDTH - MARGIN - width,
        y: FOOTER_TEXT_Y,
        size: 7.5,
        font: this.regular,
        color: MUTED,
      });
    });
  }
}

function distinctUnits(rows: LongRow[], qualitative: ConfirmedQualitative[]): number {
  return new Set([
    ...rows.map((row) => `r:${row.respondent_id}`),
    ...qualitative.map((row) => (row.respondent_id ? `r:${row.respondent_id}` : `o:${row.id}`)),
  ]).size;
}

export async function buildStudyPdf(input: StudyPdfInput): Promise<Uint8Array> {
  return (await buildStudyReport(input)).bytes;
}

export async function buildStudyReport(
  input: StudyPdfInput,
): Promise<{ bytes: Uint8Array; layout: ReportLayout }> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const generatedAt = input.generatedAt ?? new Date();
  const brand = input.brand ?? DEFAULT_BRAND;
  const [red, green, blue] = hexToRgb(brand.primaryColor);
  const [accentRed, accentGreen, accentBlue] = hexToRgb(brand.accentColor);
  const brandColor = rgb(red, green, blue);
  const brandLight = rgb(
    0.9 + accentRed * 0.1,
    0.9 + accentGreen * 0.1,
    0.9 + accentBlue * 0.1,
  );
  const writer = new ReportWriter(pdf, regular, bold, input.study.name, brandColor, brandLight);
  const metrics = computeStudyMetrics(input.rows);
  const units = distinctUnits(input.rows, input.qualitative);
  const selectionVisibility = sampleVisibility(units);
  const selectionSuppressed = selectionVisibility === "suppressed";
  const sections = input.sections ?? DEFAULT_DASHBOARD_SECTIONS;

  pdf.setTitle(safeText(`${input.study.name} - Informe Be Community`));
  pdf.setAuthor("Be Community");
  pdf.setSubject("Informe de resultados agregado");
  pdf.setCreator("Be Community server PDF export");
  pdf.setCreationDate(generatedAt);

  writer.text(brand.displayName ?? "BE COMMUNITY", { size: 9, bold: true, color: brandColor });
  writer.title(input.study.name);
  if (brand.displayName !== input.tenantName) writer.text(input.tenantName, { size: 12, bold: true });
  if (brand.tagline) writer.text(brand.tagline, { size: 9, color: MUTED });
  writer.text(
    [input.study.period, `Estado: ${input.study.status}`].filter(Boolean).join(" - "),
    { size: 9, color: MUTED },
  );
  writer.text(
    `Generado el ${new Intl.DateTimeFormat("es-MX", { dateStyle: "long", timeStyle: "short", timeZone: "America/Chihuahua" }).format(generatedAt)}`,
    { size: 8.5, color: MUTED },
  );

  const activeFilters = Object.entries(input.filters).filter(([, value]) => Boolean(value));
  if (activeFilters.length) {
    writer.gap(6);
    writer.callout(`Filtros aplicados: ${activeFilters.map(([key, value]) => `${humanize(key)} = ${value}`).join("; ")}`);
  }

  if (sections.metrics) {
  writer.section("1. Resumen ejecutivo");
  if (units === 0) {
    writer.callout("No hay respuestas para esta seleccion.", true);
  } else if (selectionSuppressed) {
    writer.callout("Muestra insuficiente. El informe no revela resultados de una seleccion con menos de cinco unidades de respuesta.", true);
  } else {
    if (selectionVisibility === "caution") {
      writer.callout(`Base pequena (n=${units}). Interprete los resultados con cautela.`, true);
    }
    writer.metric("Unidades de respuesta", String(units), "Base cuantitativa y cualitativa distinta");
    if (metrics.nps) {
      const hidden = sampleVisibility(metrics.nps.total) === "suppressed";
      writer.metric(
        "NPS",
        String(metrics.nps.nps),
        `${metrics.nps.promoters} promotores - ${metrics.nps.passives} pasivos - ${metrics.nps.detractors} detractores - n=${metrics.nps.total}`,
        hidden,
      );
    }
    for (const item of metrics.csat) {
      const hidden = sampleVisibility(item.result.total) === "suppressed";
      writer.metric(
        `CSAT ${humanize(item.metric_key)}`,
        `${item.result.csat}%`,
        `Top-box >=${item.result.satisfiedMin} - ${item.result.satisfied}/${item.result.total}`,
        hidden,
      );
    }
    for (const average of metrics.averages) {
      writer.metric(
        humanize(average.metric_key),
        formatScore(average.average),
        `Promedio - n=${average.n}`,
        sampleVisibility(average.n) === "suppressed",
      );
    }
  }

  }

  if (sections.journey) {
  writer.section("2. Journey");
  if (selectionSuppressed) {
    writer.text("Resultados suprimidos por privacidad.", { color: WARNING });
  } else if (input.journeyStages.length === 0) {
    writer.text("Este estudio no tiene etapas de journey configuradas.", { color: MUTED });
  } else {
    for (const [index, stage] of input.journeyStages.entries()) {
      const result = computeStageMetric(input.rows, stage.metric);
      const visibility = sampleVisibility(result.n);
      writer.subheading(`${index + 1}. ${stage.label}`);
      if (stage.description) writer.text(stage.description, { size: 9, color: MUTED });
      writer.metric(
        humanize(stage.metric),
        result.value == null ? "Sin datos" : formatScore(result.value),
        result.detail.length ? `${result.detail.map((item) => `${item.label}: ${item.value}`).join(" - ")} - n=${result.n}` : `n=${result.n}`,
        visibility === "suppressed",
      );
      const stageQualitative = input.qualitative.filter((row) => row.stage_key === stage.id);
      const qualitativeSummary = summarizeConfirmedQualitative(stageQualitative);
      const visibleThemes = qualitativeSummary.themes.filter((theme) => theme.visibility !== "suppressed");
      if (visibleThemes.length) {
        writer.text(`Temas confirmados: ${visibleThemes.map((theme) => `${humanize(theme.theme)} (${theme.count})`).join(", ")}`, { size: 9 });
      }
      for (const quote of qualitativeSummary.quotes.slice(0, 2)) {
        const theme = quote.themeVisibility === "suppressed" ? "" : ` [${humanize(quote.theme)}]`;
        writer.text(`"${quote.quote}"${theme}`, { size: 9, color: MUTED, indent: 12, maxWidth: CONTENT_WIDTH - 12 });
      }
    }
  }

  }

  if (sections.segments) {
  writer.section("3. Insights por segmento");
  if (selectionSuppressed) {
    writer.text("Resultados suprimidos por privacidad.", { color: WARNING });
  } else if (!metrics.crossSegment || metrics.crosses.length === 0) {
    writer.text("No hay dimensiones de segmento disponibles para este estudio.", { color: MUTED });
  } else {
    writer.text(`Cruce principal: ${humanize(metrics.crossSegment)}`, { size: 9, color: MUTED });
    for (const cross of metrics.crosses) {
      writer.subheading(humanize(cross.metric_key));
      for (const row of cross.rows) {
        writer.metric(
          row.segment,
          formatScore(row.average),
          `Promedio - n=${row.n}`,
          sampleVisibility(row.n) === "suppressed",
        );
      }
    }
  }

  }

  if (sections.qualitative) {
  writer.section("4. Hallazgos cualitativos confirmados");
  if (selectionSuppressed) {
    writer.text("Resultados suprimidos por privacidad.", { color: WARNING });
  } else {
    const summary = summarizeConfirmedQualitative(input.qualitative);
    const visibleThemes = summary.themes.filter((theme) => theme.visibility !== "suppressed");
    if (visibleThemes.length === 0 && summary.quotes.length === 0) {
      writer.text("No hay temas o citas confirmados para esta seleccion.", { color: MUTED });
    }
    for (const theme of visibleThemes) {
      writer.metric(
        humanize(theme.theme),
        `${theme.count} menciones`,
        `Base distinta n=${theme.n}${theme.visibility === "caution" ? " - base pequena" : ""}`,
      );
    }
    if (summary.themes.some((theme) => theme.visibility === "suppressed")) {
      writer.callout("Existen temas con muestra insuficiente; su identidad y magnitud no se muestran.", true);
    }
    for (const quote of summary.quotes) {
      const theme = quote.themeVisibility === "suppressed" ? "" : ` - ${humanize(quote.theme)}`;
      writer.text(`"${quote.quote}"${theme}`, { size: 9.5, color: MUTED, indent: 12, maxWidth: CONTENT_WIDTH - 12 });
    }
  }

  }

  // The closing section reads as one statement, so it is placed as one block:
  // either it fits where it falls, or it starts on the next page complete.
  writer.group(() => {
    writer.section("Metodologia y lectura");
    writer.text("Este informe fue generado en el servidor desde el modelo canonico del estudio y con la sesion autenticada del usuario. La seguridad por filas limita la consulta al cliente correspondiente.", { size: 9.5 });
    writer.text("Los indicadores usan las mismas funciones canonicas del dashboard. Los valores se redondean una sola vez en la frontera de presentacion; el PDF no recalcula con formulas alternativas.", { size: 9.5 });
    writer.text("Control de divulgacion: n=0 se presenta como sin datos; n=1-4 se suprime; n=5-29 se muestra con advertencia de base pequena; n>=30 se muestra de forma estandar. La regla se vuelve a aplicar despues de los filtros.", { size: 9.5 });
    writer.text("Los hallazgos cualitativos proceden exclusivamente de decisiones humanas confirmadas. Solo se incluyen citas aprobadas de manera independiente; el texto crudo y las sugerencias automaticas no forman parte del informe.", { size: 9.5 });
    writer.text("Documento informativo. La interpretacion final y las recomendaciones de negocio requieren criterio profesional y el contexto del estudio.", { size: 9.5, color: MUTED });
  });

  writer.finalize();
  return { bytes: await pdf.save(), layout: writer.layout() };
}
