import type { ApplicationService, Request } from '@sap/cds';

type Expression = { ref: string[] } | { val: string | boolean } | { func: string; args: Expression[] } | { xpr: Predicate };
type Predicate = Array<Expression | string>;

// SQLite's lower() handles ASCII only. Fold German characters explicitly so both databases agree.
function folded(column: string[]): Expression {
  let value: Expression = { ref: column };
  for (const [from, to] of [['Ä', 'ä'], ['Ö', 'ö'], ['Ü', 'ü'], ['ẞ', 'ss'], ['ß', 'ss']]) {
    value = { func: 'replace', args: [value, { val: from! }, { val: to! }] };
  }
  return { func: 'tolower', args: [value] };
}

export function searchPredicate(input: string, fields: string[][]): Predicate {
  const tokens = input.match(/"(?:\\.|[^"\\])*"|[()]|[^\s()]+/gu) ?? [];
  let index = 0;
  function term(value: string): Expression {
    if (value.startsWith('"') && value.endsWith('"')) {
      try { value = JSON.parse(value) as string; } catch { value = value.slice(1, -1); }
    }
    value = value.normalize('NFC').toLowerCase().replaceAll('ß', 'ss');
    if (!value.trim()) return { val: true };
    const alternatives: Predicate = [];
    for (const field of fields) {
      if (alternatives.length) alternatives.push('or');
      alternatives.push({ func: 'contains', args: [folded(field), { val: value }] });
    }
    return { xpr: alternatives };
  }
  function primary(): Expression {
    const token = tokens[index++];
    if (!token || ['AND', 'OR', ')'].includes(token)) throw new Error('Expected search term');
    if (token === 'NOT') return { xpr: ['not', primary()] };
    if (token === '(') {
      const expression = disjunction();
      if (tokens[index++] !== ')') throw new Error('Unclosed search group');
      return expression;
    }
    return term(token);
  }
  function conjunction(): Expression {
    const result: Predicate = [primary()];
    while (index < tokens.length && !['OR', ')'].includes(tokens[index]!)) {
      if (tokens[index] === 'AND') index++;
      result.push('and', primary());
    }
    return { xpr: result };
  }
  function disjunction(): Expression {
    const result: Predicate = [conjunction()];
    while (tokens[index] === 'OR') { index++; result.push('or', conjunction()); }
    return { xpr: result };
  }
  if (!tokens.length) return [];
  try {
    const result = disjunction();
    if (index !== tokens.length) throw new Error('Unexpected search token');
    return [result];
  } catch {
    // Incomplete expressions entered as free text remain literal, parameterized search terms.
    return [term(input)];
  }
}

export function applySearch(req: Request): void {
  const select = req.query?.SELECT;
  if (!select?.search || !req.target) return;
  const fields = Object.entries(req.target)
    .filter(([name, enabled]) => name.startsWith('@cds.search.') && enabled === true)
    .map(([name]) => name.slice('@cds.search.'.length).split('.'));
  if (!fields.length) return;
  const input = select.search.map(part => typeof part === 'object' && 'val' in part ? String(part.val ?? '') : String(part)).join(' ');
  const predicate = searchPredicate(input, fields);
  // CAP clones queries through prototypes; assigning shadows an inherited search clause.
  select.search = undefined;
  if (predicate.length) {
    // Keep authorization, draft, navigation and user filters intact; values remain SQL parameters.
    select.where = (select.where?.length ? [{ xpr: select.where }, 'and', { xpr: predicate }] : predicate) as typeof select.where;
  }
}

export function registerSearch(service: ApplicationService): void {
  service.before('READ', '*', applySearch);
}
