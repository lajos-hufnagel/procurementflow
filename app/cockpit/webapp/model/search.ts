/** Quote free-text terms for OData, while preserving explicit phrases and boolean operators. */
export function searchQuery(input: string): string | undefined {
  const tokens = input.trim().match(/"(?:\\.|[^"\\])*"|[()]|[^\s()]+/gu) ?? [];
  return tokens.map(token => {
    if (['AND', 'OR', 'NOT', '(', ')'].includes(token)) return token;
    if (token.startsWith('"') && token.endsWith('"')) {
      try { return JSON.stringify(JSON.parse(token)); } catch { /* Treat malformed quotes as literal text. */ }
    }
    return JSON.stringify(token);
  }).join(' ') || undefined;
}
