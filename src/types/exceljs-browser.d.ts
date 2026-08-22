/**
 * Type declaration for ExcelJS's prebuilt BROWSER bundle.
 *
 * The package ships types only for its Node entry (`exceljs/index.d.ts`). The
 * browser bundle exposes the same public API — it is the same library, built
 * without the Node-only zip/stream stack — so the Node types describe it
 * accurately for the small surface this codebase uses (Workbook + xlsx.load).
 *
 * We import that bundle explicitly because the Node entry pulls in
 * unzipper -> fstream, whose module-level `process.umask()` call is fatal on
 * Cloudflare Workers. See src/lib/ingestion/parse.ts for the full rationale and
 * the runtime evidence.
 */
declare module "exceljs/dist/exceljs.min.js" {
  export * from "exceljs";
}
