// =============================================================================
// The drawings say the same thing the numbers do
// =============================================================================
// Credentials-free and deterministic. It builds a study whose answers it knows,
// computes the expected aggregate BY HAND, renders each of the three new
// drawings to static markup, and reads the numbers back out of what was
// rendered.
//
// WHY THAT AND NOT A SNAPSHOT. A snapshot proves the output did not change; it
// proves nothing about whether the output was ever right. These assertions are
// about the CLAIM each drawing makes:
//
//   heat map   every cell shows the value of its own crossing, an unanswered
//              cell is drawn as empty rather than as the bottom of the scale,
//              and a withheld cell shows no colour at all;
//   bubbles    AREA is proportional to the value, so a value twice as large is
//              a circle with twice the area and NOT twice the radius;
//   treemap    each rectangle's area is its share of the total, the ordering is
//              deterministic, and nothing overlaps.
//
// And the compatibility rules the catalogue declares are asserted against the
// validator, because a treemap of averages is a picture of a claim nobody made.
// =============================================================================

import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

import { mean, percentage, DECIMALS } from "../src/lib/calc/metrics.ts";
import { CHART_SPECS } from "../src/lib/experience/charts.ts";
import { DEFAULT_SAMPLE_POLICY, LEGACY_SAMPLE_POLICY } from "../src/lib/experience/sample-policy.ts";
import { validateBlockQuery } from "../src/lib/experience/validate.ts";
import { HeatMap, BubbleChart, TreemapChart } from "../src/components/studio/experience/Charts.tsx";

let checks = 0;
const ok = (message) => {
  checks += 1;
  console.log(`  PASS  ${message}`);
};

const render = (element) => renderToStaticMarkup(element);
/** Every number in a fragment of markup, in document order. */
const numbersIn = (markup) =>
  (markup.replace(/<[^>]*>/g, " ").match(/-?[0-9]+[.,][0-9]+|[0-9]+/g) ?? []).map((value) =>
    Number(value.replace(",", ".")),
  );

// ---------------------------------------------------------------------------
// One crossing, with answers this file chose
// ---------------------------------------------------------------------------

/**
 * Two characteristics: three generations by two spheres. Every cell has a
 * different, hand-computable average, one cell has NO answers at all, and one
 * has a base of two so the legacy disclosure rule withholds it.
 */
const CELLS = {
  "X|Servicios": [5, 5, 4, 4],       // mean 4.5, n 4
  "X|Comercio": [1, 2],               // mean 1.5, n 2  → withheld under hide-below-5
  "Y|Servicios": [3, 3, 3, 3, 3],     // mean 3, n 5
  "Y|Comercio": [2, 4, 3, 5, 1],      // mean 3, n 5
  "Z|Servicios": [],                  // no answers at all
  "Z|Comercio": [5, 5, 5, 5, 5, 5],   // mean 5, n 6
};

const GENERATIONS = ["X", "Y", "Z"];
const SPHERES = ["Servicios", "Comercio"];

function crossing(aggregate) {
  return {
    blockId: "bk_test",
    metricLabel: "Satisfacción",
    unit: "score",
    decimals: DECIMALS.score ?? 1,
    categoryLabel: "Generación",
    seriesLabel: "Esfera",
    categories: GENERATIONS.map((value) => ({ key: value, label: value })),
    series: SPHERES.map((sphere) => ({
      key: sphere,
      label: sphere,
      cells: GENERATIONS.map((generation) => {
        const values = CELLS[`${generation}|${sphere}`];
        return {
          categoryKey: generation,
          value: values.length === 0 ? null : aggregate(values),
          n: values.length,
        };
      }),
    })),
    overall: { categoryKey: "", value: 3.5, n: 22 },
    omittedCategories: 0,
    detail: [],
  };
}

const averages = crossing((values) => mean(values, 1));
const counts = {
  ...crossing((values) => values.length),
  unit: "count",
  decimals: 0,
  metricLabel: "Respuestas",
};

// ---------------------------------------------------------------------------
console.log("\n[1] The heat map shows each crossing's own value");
// ---------------------------------------------------------------------------

{
  // Every cell, by hand.
  assert.equal(mean(CELLS["X|Servicios"], 1), 4.5);
  assert.equal(mean(CELLS["Y|Servicios"], 1), 3);
  assert.equal(mean(CELLS["Z|Comercio"], 1), 5);

  const markup = render(
    createElement(HeatMap, { data: averages, policy: DEFAULT_SAMPLE_POLICY }),
  );
  for (const [key, values] of Object.entries(CELLS)) {
    if (values.length === 0) continue;
    const expected = mean(values, 1);
    assert.ok(
      markup.includes(String(expected)),
      `the heat map must print ${expected} for ${key}`,
    );
  }
  ok("every populated cell prints the average of its own crossing");

  // A CELL WITH NO ANSWERS IS AN EMPTY CELL, NOT THE BOTTOM OF THE SCALE.
  assert.ok(
    markup.includes("sin respuestas"),
    "an unanswered crossing says so rather than being coloured",
  );
  /*
   * THE EMPTY CELL'S OWN CELL, checked rather than the whole document.
   *
   * Scoped deliberately: a blunt "no zero anywhere in the markup" would also
   * trip over a CSS percentage or a base of zero in the accessible table, and
   * a check that fails for the wrong reason gets relaxed until it fails for
   * none. The claim is precisely that the cell for an unanswered crossing
   * carries a dash and no number.
   */
  const emptyCell = [...markup.matchAll(/<td[^>]*sin respuestas[^>]*>(.*?)<\/td>/g)];
  assert.equal(emptyCell.length, 1, "exactly one crossing has no answers in this fixture");
  assert.equal(emptyCell[0][1].trim(), "—", "and its cell is a dash");
  assert.deepEqual(
    numbersIn(emptyCell[0][1]),
    [],
    "with no number in it at all — not a zero, not the bottom of the scale",
  );
  ok("a crossing nobody answered is drawn empty, never as a zero at the bottom of the scale");

  // A WITHHELD CELL SHOWS NO COLOUR, because the intensity would leak the very
  // number the disclosure rule suppressed.
  const withheld = render(
    createElement(HeatMap, { data: averages, policy: LEGACY_SAMPLE_POLICY }),
  );
  assert.ok(
    withheld.includes("muy pocas respuestas"),
    "a cell the rule withheld says so",
  );
  /*
   * SCOPED TO THE CELL, not to the document — `mt-1.5` is a class name, and an
   * assertion that reads CSS as data is one that will be relaxed the first
   * time somebody changes a margin.
   */
  const suppressedCells = [...withheld.matchAll(/<td[^>]*muy pocas respuestas[^>]*>(.*?)<\/td>/g)];
  assert.ok(suppressedCells.length >= 1, "the legacy rule withholds at least one cell here");
  for (const cell of suppressedCells) {
    assert.deepEqual(
      numbersIn(cell[1]),
      [],
      "a withheld cell carries no number at all",
    );
    assert.ok(
      !cell[0].includes("backgroundColor"),
      "and no fill, because the intensity would leak the number the rule suppressed",
    );
  }
  ok("a withheld cell shows neither its value nor an intensity that would imply it");

  // The legend states the range the colours span, in the result's own unit.
  assert.ok(markup.includes("Más intenso"), "the legend says what intensity means");
  assert.ok(markup.includes("1.5") && markup.includes("5"), "and names the range it spans");
  ok("the heat map's legend states what the colours mean and over what range");
}

// ---------------------------------------------------------------------------
console.log("\n[2] A bubble's AREA is proportional to its value");
// ---------------------------------------------------------------------------

{
  const markup = render(createElement(BubbleChart, { data: counts, policy: DEFAULT_SAMPLE_POLICY }));
  const radii = [...markup.matchAll(/r="([0-9.]+)"/g)].map((match) => Number(match[1]));
  assert.ok(radii.length >= 4, `the field draws a circle per answered crossing: ${radii.length}`);

  /*
   * THE PROPERTY THAT MATTERS, checked rather than described.
   *
   * `Z|Comercio` has 6 answers and `X|Servicios` has 4. Areas in that ratio
   * mean radii in the ratio of their square roots. A renderer that scaled the
   * RADIUS by the value would exaggerate the difference by the square, which
   * is the classic dishonesty of this chart — so the check is on the ratio,
   * not on any absolute size.
   */
  const sorted = [...radii].sort((a, b) => a - b);
  const smallest = sorted[0];
  const largest = sorted[sorted.length - 1];
  // The smallest drawn value is 2 (X|Comercio) and the largest is 6.
  const expectedRatio = Math.sqrt(6) / Math.sqrt(2);
  const wrongRatio = 6 / 2;
  const actualRatio = largest / smallest;
  assert.ok(
    Math.abs(actualRatio - expectedRatio) < Math.abs(actualRatio - wrongRatio),
    `radii must scale with the square root of the value (ratio ${actualRatio.toFixed(2)}, area-correct ${expectedRatio.toFixed(2)}, radius-scaled ${wrongRatio.toFixed(2)})`,
  );
  ok(`the radius ratio is ${actualRatio.toFixed(2)}, matching area proportionality rather than radius proportionality`);

  // A CROSSING WITH NO ANSWERS DRAWS NOTHING. The smallest visible circle still
  // has to mean a measured value.
  const answered = Object.values(CELLS).filter((values) => values.length > 0).length;
  assert.equal(radii.length, answered, "one circle per answered crossing, and none for the empty one");
  ok("a crossing nobody answered draws no bubble at all");

  // And the numbers are printed as well as drawn.
  assert.ok(markup.includes("ÁREA"), "the caption says what the size means");
  ok("the bubble field states that area, not radius, carries the value");
}

// ---------------------------------------------------------------------------
console.log("\n[3] A treemap's rectangles are shares of the total");
// ---------------------------------------------------------------------------

{
  const shares = {
    blockId: "bk_tree",
    metricLabel: "Respuestas",
    unit: "count",
    decimals: 0,
    categoryLabel: "Esfera",
    seriesLabel: null,
    categories: [
      { key: "a", label: "Servicios" },
      { key: "b", label: "Comercio" },
      { key: "c", label: "Eventos" },
      { key: "d", label: "Salud" },
    ],
    series: [
      {
        key: "",
        label: null,
        cells: [
          { categoryKey: "a", value: 50, n: 50 },
          { categoryKey: "b", value: 30, n: 30 },
          { categoryKey: "c", value: 20, n: 20 },
          { categoryKey: "d", value: 0, n: 0 },
        ],
      },
    ],
    overall: { categoryKey: "", value: 100, n: 100 },
    omittedCategories: 0,
    detail: [],
  };

  const markup = render(createElement(TreemapChart, { data: shares, policy: DEFAULT_SAMPLE_POLICY }));
  const rects = [...markup.matchAll(/width="([0-9.]+)" height="([0-9.]+)"/g)].map((match) => ({
    w: Number(match[1]),
    h: Number(match[2]),
  }));
  assert.equal(rects.length, 3, "one rectangle per category with a positive value");

  const areas = rects.map((rect) => rect.w * rect.h);
  const total = areas.reduce((sum, area) => sum + area, 0);
  const expected = [50, 30, 20];
  areas.forEach((area, index) => {
    const share = area / total;
    assert.ok(
      Math.abs(share - expected[index] / 100) < 0.06,
      `rectangle ${index} should hold about ${expected[index]} % of the area, holds ${(share * 100).toFixed(1)} %`,
    );
  });
  ok(`the three rectangles hold ${areas.map((area) => `${((area / total) * 100).toFixed(0)} %`).join(", ")} of the area, matching 50, 30 and 20`);

  // NOTHING OVERLAPS. Slice-and-dice, so every rectangle is disjoint.
  const boxes = [...markup.matchAll(/x="([0-9.]+)" y="([0-9.]+)" width="([0-9.]+)" height="([0-9.]+)"/g)]
    .map((match) => ({
      x: Number(match[1]),
      y: Number(match[2]),
      w: Number(match[3]),
      h: Number(match[4]),
    }));
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i];
      const b = boxes[j];
      const overlap =
        a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      assert.ok(!overlap, `rectangles ${i} and ${j} overlap`);
    }
  }
  ok("no two rectangles overlap");

  // DETERMINISTIC: the same data always draws the same picture.
  assert.equal(
    render(createElement(TreemapChart, { data: shares, policy: DEFAULT_SAMPLE_POLICY })),
    markup,
    "the same input renders identically",
  );
  ok("the layout is deterministic, so a report and a screen show the same rectangles");

  // A ZERO CATEGORY IS NOT A ZERO-AREA RECTANGLE NOBODY CAN SEE.
  assert.ok(!markup.includes("Salud") || markup.indexOf("Salud") > markup.indexOf("</svg>"),
    "a category with no positive value is not drawn as an invisible rectangle");
  ok("a category with nothing to show is left out of the drawing rather than drawn at zero size");
}

// ---------------------------------------------------------------------------
console.log("\n[4] The catalogue refuses what a drawing cannot say honestly");
// ---------------------------------------------------------------------------

{
  const registry = {
    scope: { tenantId: "t", studyId: "s" },
    registryVersion: "v",
    metrics: [
      {
        id: "sat",
        label: "Satisfacción",
        question: "",
        description: "",
        source: "",
        family: "satisfaction",
        unit: "score",
        format: { decimals: 1, suffix: "none", grouped: true },
        aggregations: ["average", "count", "sum", "share", "top_box", "net_score"],
        defaultAggregation: "average",
        charts: ["treemap", "bubble", "heatmap", "pie", "bar_horizontal"],
        filterEligible: false,
        journeyEligible: true,
        privacy: "aggregate_only",
        samplePolicy: { kind: "inherit" },
        publicationReady: true,
        responses: 22,
        scale: { minimum: 1, maximum: 5 },
        topBoxMinimum: 4,
      },
    ],
    dimensions: [
      {
        id: "gen",
        label: "Generación",
        description: "",
        source: "",
        kind: "segment",
        values: GENERATIONS.map((value) => ({ value, label: value })),
        filterEligible: true,
        journeyEligible: false,
        publicationReady: true,
      },
      {
        id: "esf",
        label: "Esfera",
        description: "",
        source: "",
        kind: "segment",
        values: SPHERES.map((value) => ({ value, label: value })),
        filterEligible: true,
        journeyEligible: false,
        publicationReady: true,
      },
    ],
  };

  const query = (aggregation, primary, secondary) => ({
    metricId: "sat",
    aggregation,
    primaryDimensionId: primary,
    secondaryDimensionId: secondary,
    fixedFilters: [],
    sort: { by: "value", direction: "desc" },
    topN: null,
    period: { kind: "latest", periodId: null },
    comparison: { kind: "none", target: null, targetMaximum: null, targetLabel: null },
    numberFormat: { decimals: 1, suffix: "none", grouped: true },
    samplePolicy: { kind: "inherit" },
  });

  // A TREEMAP OF AVERAGES IS A PICTURE OF A CLAIM NOBODY MADE.
  const treemapOfAverages = validateBlockQuery(query("average", "gen", null), registry, {
    blockId: "b",
    type: "chart",
    variant: "treemap",
  });
  assert.ok(
    treemapOfAverages.errors.some((issue) => issue.code === "impossible_schema"),
    `a treemap of averages is refused: ${JSON.stringify(treemapOfAverages.errors)}`,
  );
  assert.match(
    treemapOfAverages.errors[0].detail,
    /cantidad|suma|porcentaje/,
    "and the refusal names what it would accept instead",
  );
  const treemapOfCounts = validateBlockQuery(query("count", "gen", null), registry, {
    blockId: "b",
    type: "chart",
    variant: "treemap",
  });
  assert.deepEqual(treemapOfCounts.errors, [], "counting answers does divide a whole");
  ok("a treemap accepts only aggregations whose parts add up to the total");

  // AN NPS HAS NO AREA. It runs from -100.
  const bubbleOfNps = validateBlockQuery(query("net_score", "gen", "esf"), registry, {
    blockId: "b",
    type: "chart",
    variant: "bubble",
  });
  assert.ok(
    bubbleOfNps.errors.some((issue) => issue.code === "impossible_schema"),
    "a bubble field of net scores is refused: a negative value has no area",
  );
  const bubbleOfCounts = validateBlockQuery(query("count", "gen", "esf"), registry, {
    blockId: "b",
    type: "chart",
    variant: "bubble",
  });
  assert.deepEqual(bubbleOfCounts.errors, [], "counting answers does have a magnitude");
  ok("a bubble field accepts only magnitudes, because a negative value has no area");

  // A HEAT MAP NEEDS EXACTLY TWO CHARACTERISTICS.
  const flatHeatMap = validateBlockQuery(query("average", "gen", null), registry, {
    blockId: "b",
    type: "chart",
    variant: "heatmap",
  });
  assert.ok(
    flatHeatMap.errors.some((issue) => issue.code === "impossible_schema"),
    "a heat map with one characteristic is refused",
  );
  const realHeatMap = validateBlockQuery(query("average", "gen", "esf"), registry, {
    blockId: "b",
    type: "chart",
    variant: "heatmap",
  });
  assert.deepEqual(realHeatMap.errors, [], "and two characteristics is exactly what it needs");
  ok("a heat map needs two characteristics, and says so rather than drawing a bar chart");

  // AND NOTHING IS SILENTLY SUBSTITUTED ANY MORE.
  for (const variant of ["heatmap", "bubble", "treemap"]) {
    assert.equal(
      CHART_SPECS[variant].rendererImplemented,
      true,
      `${variant} is drawn for real in this build`,
    );
    assert.equal(
      CHART_SPECS[variant].alternative,
      null,
      `${variant} declares no substitute, because it no longer needs one`,
    );
  }
  ok("the three drawings that used to declare themselves undrawn are drawn, and declare no substitute");
}

console.log(`\nOK — ${checks} renderer-parity checks passed.`);
void percentage;
