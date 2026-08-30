/**
 * The ceilings the Experience Composer refuses to cross.
 *
 * A composer is an authoring surface, and an authoring surface without limits
 * is a way for one operator to build a page nobody can load. Every bound below
 * is DECLARED here and enforced by the schema, so a limit can be raised by
 * changing one number and re-running the gate rather than by discovering, in
 * production, which one was implicit.
 *
 * Two of them are not about size at all:
 *
 *   `containerDepth` is 1 because V1 blocks do not nest. A block never contains
 *   another block, so no recursive parse exists and no depth can be exhausted.
 *   Nesting is a V2 question, and the answer will have to arrive with a bound.
 *
 *   `serializedBytes` bounds the whole definition after serialization. Field
 *   limits multiply; the product of every maximum is far larger than anything a
 *   real experience needs, and the byte ceiling is what actually stops a
 *   pathological-but-schema-valid document from being stored or published.
 */

export const EXPERIENCE_LIMITS = {
  /** Pages in one experience. */
  pages: 24,
  /** Blocks on one page. */
  blocksPerPage: 60,
  /** Blocks in the whole experience, across every page. */
  blocks: 300,
  /** Filter definitions in one experience. */
  filterDefinitions: 24,
  /** Filter-to-block connections in one experience. */
  filterConnections: 200,
  /** Blocks one connection may name. */
  blocksPerConnection: 300,
  /** Filters one block may answer to. */
  filterRefsPerBlock: 12,
  /** Default values one filter may pre-select. */
  defaultValuesPerFilter: 50,
  /** Independent journeys in one experience. */
  journeys: 8,
  /** Ordered moments in one journey. */
  momentsPerJourney: 24,
  /**
   * How deep a block may nest inside another block. One means "not at all":
   * a page holds blocks, a block holds no blocks, and the parse is flat.
   */
  containerDepth: 1,
  /** The grid every breakpoint is laid out on. */
  gridColumns: 12,
  /** Characters in a title, a label or a short caption. */
  titleLength: 120,
  /** Characters in a paragraph of authored copy. */
  bodyLength: 4000,
  /** Rows a chart may show before the ranking becomes the point. */
  topN: 50,
  /**
   * Distinct values a dimension may carry into one visual. Above this the
   * chart is not crowded, it is unreadable, and the composer refuses instead of
   * drawing 128 bars nobody can compare.
   */
  dimensionCardinality: 60,
  /**
   * Distinct values a dimension may carry into one FILTER CONTROL, which is a
   * different question and deserves a different number.
   *
   * A chart with 72 bars is unreadable; a select with 72 options is an
   * ordinary control, and the deployed dashboard already offers exactly that
   * over every `seg_` column a study imported. Holding a filter to the chart's
   * legibility ceiling made the adapter drop a filter the product ships, which
   * is the one thing a compatibility layer may not do. The ceiling that
   * actually binds a control is how long a list a person can scan, and it is
   * far above sixty.
   */
  filterOptions: 500,
  /** The serialized definition, in bytes. */
  serializedBytes: 512 * 1024,
} as const;

export type ExperienceLimits = typeof EXPERIENCE_LIMITS;
