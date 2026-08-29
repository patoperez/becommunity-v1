/**
 * What an operator is allowed to type into a composed page.
 *
 * A composer is, structurally, a place where a person's words end up in a
 * document that later renders on somebody else's screen. That is the exact
 * shape of an injection surface, so the boundary is drawn once, here, and every
 * authored string in the definition passes through it.
 *
 * THE RULE: authored text is TEXT. Not markup, not a template, not a query, not
 * a style. React escapes it on the way out and the product has no
 * `dangerouslySetInnerHTML` anywhere; this module is the second layer, and it
 * refuses the input rather than relying on the renderer to neutralize it.
 *
 * The detector is deliberately conservative about what it REJECTS: it looks for
 * the syntax of the four languages that could matter — HTML, JavaScript, CSS
 * and SQL — rather than trying to guess intent. A consultant writing about "el
 * 40 % de las <100 respuestas" is writing prose that happens to contain a less
 * than sign, so the patterns require the shape of a construct, not a character.
 */

/** Every construct an authored string may not contain, with a name. */
const FORBIDDEN: { code: string; pattern: RegExp }[] = [
  { code: "html_tag", pattern: /<\s*\/?\s*[a-z][a-z0-9-]*(\s[^<>]*)?>/i },
  { code: "html_entity_script", pattern: /&lt;\s*script/i },
  { code: "script_url", pattern: /\b(?:javascript|vbscript|data)\s*:/i },
  { code: "event_handler", pattern: /\bon[a-z]{3,20}\s*=/i },
  { code: "template_expression", pattern: /\$\{|\{\{|<%|%>/ },
  { code: "css_at_rule", pattern: /@(?:import|media|font-face|charset)\b/i },
  { code: "css_expression", pattern: /\b(?:expression|url)\s*\(/i },
  { code: "sql_statement", pattern: /\b(?:select|insert|update|delete|drop|alter|truncate|grant|revoke)\b[\s\S]{0,40}\b(?:from|into|table|set|schema|role|policy)\b/i },
  { code: "sql_union", pattern: /\bunion\b[\s\S]{0,20}\bselect\b/i },
  { code: "sql_comment", pattern: /(?:--\s|\/\*|\*\/|;\s*--)/ },
  { code: "code_block", pattern: /\bfunction\s*\(|=>\s*\{|\brequire\s*\(|\bimport\s*\(/ },
];

export type TextRejection = { code: string; sample: string };

/**
 * Why a string may not be stored, or null when it may be.
 *
 * `sample` is a short excerpt of what was matched, so a person is told what to
 * remove instead of being told "invalid".
 */
export function rejectAuthoredText(value: string): TextRejection | null {
  for (const rule of FORBIDDEN) {
    const found = rule.pattern.exec(value);
    if (found) return { code: rule.code, sample: found[0].slice(0, 40) };
  }
  // A control character has no place in authored prose and is a classic way to
  // smuggle something past a later reader. Tab, newline and carriage return are
  // ordinary text; the rest are not.
  const control = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.exec(value);
  if (control) return { code: "control_character", sample: "" };
  return null;
}

export function isSafeAuthoredText(value: string): boolean {
  return rejectAuthoredText(value) === null;
}

/**
 * The same question for a value the operator did not type but did CHOOSE — a
 * stored segment value carried into a filter default, for instance. It is held
 * to the same standard, because "the product put it there" is exactly what an
 * attacker who reached the import would be counting on.
 */
export function isSafeStoredValue(value: string): boolean {
  return value.length <= 240 && isSafeAuthoredText(value);
}
