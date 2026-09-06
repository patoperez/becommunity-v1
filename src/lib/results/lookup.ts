/**
 * Indices over a record set, built once per calculation.
 *
 * Deterministic by construction: every list preserves the order the adapter
 * delivered, which is the source's own order, so no result ever depends on how
 * a hash iterated.
 */

import { normalizeToken } from "../ingestion/canonical-package/values";
import type {
  CanonicalResultSource,
  ResultAnswer,
  ResultBandScheme,
  ResultDomain,
  ResultItem,
  ResultMetricDefinition,
  ResultParticipant,
  ResultScaleOption,
  ResultSession,
} from "./source";

export type ResultLookup = {
  participantById: Map<string, ResultParticipant>;
  participantsByCohort: Map<string, ResultParticipant[]>;
  sessionById: Map<string, ResultSession>;
  sessionsByInstrument: Map<string, ResultSession[]>;
  answersByItem: Map<string, ResultAnswer[]>;
  itemByKey: Map<string, ResultItem>;
  itemsByInstrument: Map<string, ResultItem[]>;
  itemsByDomain: Map<string, ResultItem[]>;
  domainByKey: Map<string, ResultDomain>;
  optionByScaleAndToken: Map<string, ResultScaleOption>;
  bandSchemeByKey: Map<string, ResultBandScheme>;
  metricByKey: Map<string, ResultMetricDefinition>;
};

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

export function buildLookup(source: CanonicalResultSource): ResultLookup {
  const participantById = new Map<string, ResultParticipant>();
  const participantsByCohort = new Map<string, ResultParticipant[]>();
  for (const participant of source.participants) {
    participantById.set(participant.participantId, participant);
    push(participantsByCohort, participant.cohortKey, participant);
  }

  const sessionById = new Map<string, ResultSession>();
  const sessionsByInstrument = new Map<string, ResultSession[]>();
  for (const session of source.sessions) {
    sessionById.set(session.sessionId, session);
    push(sessionsByInstrument, session.instrumentKey, session);
  }

  const answersByItem = new Map<string, ResultAnswer[]>();
  for (const answer of source.answers) push(answersByItem, answer.itemKey, answer);

  const itemByKey = new Map<string, ResultItem>();
  const itemsByInstrument = new Map<string, ResultItem[]>();
  const itemsByDomain = new Map<string, ResultItem[]>();
  for (const item of source.items) {
    itemByKey.set(item.key, item);
    push(itemsByInstrument, item.instrumentKey, item);
    if (item.domainKey) push(itemsByDomain, item.domainKey, item);
  }

  const domainByKey = new Map<string, ResultDomain>();
  for (const domain of source.domains) domainByKey.set(domain.key, domain);

  const optionByScaleAndToken = new Map<string, ResultScaleOption>();
  for (const option of source.scaleOptions) {
    optionByScaleAndToken.set(`${option.scaleKey}|${normalizeToken(option.rawValue)}`, option);
  }

  const bandSchemeByKey = new Map<string, ResultBandScheme>();
  for (const scheme of source.bandSchemes) bandSchemeByKey.set(scheme.key, scheme);

  const metricByKey = new Map<string, ResultMetricDefinition>();
  for (const metric of source.metricDefinitions) metricByKey.set(metric.key, metric);

  return {
    participantById,
    participantsByCohort,
    sessionById,
    sessionsByInstrument,
    answersByItem,
    itemByKey,
    itemsByInstrument,
    itemsByDomain,
    domainByKey,
    optionByScaleAndToken,
    bandSchemeByKey,
    metricByKey,
  };
}

/** The scope one calculation runs over: which people, and whether a filter made it. */
export type ResultScope = {
  participantIds: Set<string>;
  filtered: boolean;
};

export function scopeSessions(
  lookup: ResultLookup,
  scope: ResultScope,
  instrumentKey: string,
): ResultSession[] {
  return (lookup.sessionsByInstrument.get(instrumentKey) ?? []).filter((session) =>
    scope.participantIds.has(session.participantId),
  );
}

/** Participants of a cohort that survived the filter, in source order. */
export function scopeParticipants(
  lookup: ResultLookup,
  scope: ResultScope,
  cohortKeys: string[],
): ResultParticipant[] {
  const out: ResultParticipant[] = [];
  // Cohort order is the CALLER's, not the map's, so a scope that pools two
  // cohorts always presents them in the order the specification declares.
  for (const cohortKey of cohortKeys) {
    for (const participant of lookup.participantsByCohort.get(cohortKey) ?? []) {
      if (scope.participantIds.has(participant.participantId)) out.push(participant);
    }
  }
  return out;
}
