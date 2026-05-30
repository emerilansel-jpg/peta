export function cleanInternalText(value: string | null | undefined) {
  if (!value) return '';

  return value
    .split(/\r?\n/)
    .map((line) => line
      .replace(/\bgeneration_provider\s*=\s*[^;\n,}"']+;?\s*/gi, '')
      .replace(/\bdraft_context_fetched\s*=\s*(yes|no);?\s*/gi, '')
      .replace(/\bcontext_fetched\s*=\s*(yes|no);?\s*/gi, '')
      .replace(/\bdeepseek\b/gi, 'draft assistant')
      .trim())
    .filter(Boolean)
    .join('\n');
}
