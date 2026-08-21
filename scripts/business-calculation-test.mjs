import {
  beCommunityNps,
  churnRate,
  churnRiskIndex,
  criBand,
  csatBand,
  npsBand,
  processUnawarenessRate,
  retentionRate,
  touchpointCsat,
} from "../src/lib/calc/business-metrics.ts";
import { sampleVisibility } from "../src/lib/calc/disclosure.ts";

let failures = 0;
const ok = (message) => console.log("  ✓", message);
const bad = (message) => { console.error("  ✗ FAIL:", message); failures++; };
const eq = (label, actual, expected) => (
  Object.is(actual, expected)
    ? ok(`${label} = ${String(expected)}`)
    : bad(`${label}: expected ${String(expected)}, got ${String(actual)}`)
);
const throws = (label, fn) => {
  try { fn(); bad(`${label}: expected an exception`); }
  catch { ok(`${label} rejects inconsistent input`); }
};

console.log("Be Community — confirmed business calculation gate");

console.log("\n[1] NPS and CSAT");
const historicalNps = beCommunityNps([
  ...Array(24).fill(9),
  ...Array(3).fill(8),
  ...Array(2).fill(6),
]);
eq("NPS 24 promoters, 3 passives, 2 detractors", historicalNps.nps, 75.9);
eq("passives remain in denominator", historicalNps.total, 29);
eq("passives counted", historicalNps.passives, 3);
eq("0 is invalid on the confirmed 1–10 scale", beCommunityNps([0, 9]).total, 1);
eq("fractional NPS responses are invalid", beCommunityNps([8.5, 9]).total, 1);
eq("NPS without valid responses is no data", beCommunityNps([0, 11]), null);

const csat = touchpointCsat([5, 4, 3, 2, 1]);
eq("CSAT 4–5 over all valid 1–5", csat.csat, 40);
eq("CSAT denominator retains 1–3", csat.total, 5);
eq("CSAT excludes out-of-scale values", touchpointCsat([5, 0, 6]).total, 1);
eq("fractional CSAT responses are invalid", touchpointCsat([4.5, 4]).total, 1);
eq("CSAT without valid responses is no data", touchpointCsat([0, 6]), null);

console.log("\n[2] TDP and CRI");
const tdp = processUnawarenessRate(3, 10);
eq("TDP 3 unknown of 10 total", tdp.value, 30);
eq("TDP denominator includes unknown responses", tdp.denominator, 10);
eq("TDP empty population is no data", processUnawarenessRate(0, 0).value, null);

const cri = churnRiskIndex(["nada", "algo", "extremadamente"]);
eq("CRI [Nada, Algo, Extremadamente]", cri.value, 50);
eq("CRI weighted numerator", cri.numerator, 150);
eq("CRI empty population is no data", churnRiskIndex([]).value, null);

console.log("\n[3] Retention and churn");
eq("retention (94 ending - 20 new) / 100 starting", retentionRate(100, 94, 20).value, 74);
eq("churn 26 lost / 100 starting", churnRate(100, 26).value, 26);
eq("retention empty starting population is no data", retentionRate(0, 0, 0).value, null);
throws("TDP unknown > total", () => processUnawarenessRate(4, 3));
throws("retention new > ending", () => retentionRate(10, 2, 3));
throws("churn lost > starting", () => churnRate(2, 3));

console.log("\n[4] Presentation bands");
eq("NPS 59.9 red", npsBand(59.9), "red");
eq("NPS 60 yellow", npsBand(60), "yellow");
eq("NPS 80 green", npsBand(80), "green");
eq("CSAT 59.9 red", csatBand(59.9), "red");
eq("CSAT 60 yellow", csatBand(60), "yellow");
eq("CSAT 75 green", csatBand(75), "green");
eq("CRI 30 safe", criBand(30), "safe");
eq("CRI 30.1 alert", criBand(30.1), "alert");
eq("CRI 60 alert", criBand(60), "alert");
eq("CRI 60.1 danger", criBand(60.1), "danger");

console.log("\n[5] Sample-size disclosure policy");
eq("n=0 is no data", sampleVisibility(0), "no-data");
eq("n=1 is suppressed", sampleVisibility(1), "suppressed");
eq("n=4 is suppressed", sampleVisibility(4), "suppressed");
eq("n=5 carries a small-base caution", sampleVisibility(5), "caution");
eq("n=29 carries a small-base caution", sampleVisibility(29), "caution");
eq("n=30 is standard", sampleVisibility(30), "standard");
throws("negative sample size", () => sampleVisibility(-1));
throws("invalid policy ordering", () => sampleVisibility(10, { minimum: 20, cautionBelow: 5 }));

console.log("\n" + "=".repeat(60));
if (failures > 0) {
  console.error(`RESULT: ${failures} failure(s) — business calculation gate blocked.`);
  process.exit(1);
}
console.log("RESULT: confirmed business formulas match hand-computed values.");
