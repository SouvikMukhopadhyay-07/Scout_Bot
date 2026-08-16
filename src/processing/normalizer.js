import { computeContentHash } from '../storage/dedup.js';

/**
 * Strip HTML tags, script elements, styles, and unescape common XML/HTML entities
 */
export function cleanHtml(rawHtml) {
  if (!rawHtml) return '';
  return rawHtml
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Clean academic and newsletter boilerplate text (e.g. arXiv copyright notices, Substack footer links)
 */
export function cleanAcademicBoilerplate(text) {
  if (!text) return '';
  let cleaned = text
    .replace(/arXiv:\d+\.\d+(?:v\d+)?\s*\[[a-zA-Z\.\-]+\]/gi, '')
    .replace(/comments:\s*\d+\s*pages.*/gi, '')
    .replace(/subjects:\s*[a-zA-Z\.\-;\s]+/gi, '')
    .replace(/doi:\s*10\.\d+\/[^\s]+/gi, '')
    .replace(/subscribe to.*for more.*/gi, '')
    .replace(/share this post.*/gi, '')
    .replace(/view in browser.*/gi, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned;
}

/**
 * Normalize raw input from any source into standard document format
 */
export function normalizeDocument(rawDoc) {
  const cleanedTitle = cleanHtml(rawDoc.title || 'Untitled Document');
  const rawAbstract = rawDoc.abstract || rawDoc.description || rawDoc.summary || '';
  const cleanedAbstract = cleanAcademicBoilerplate(cleanHtml(rawAbstract));
  const rawText = cleanHtml(rawDoc.content || rawDoc.raw_text || rawAbstract);

  const hash = computeContentHash(cleanedTitle + ' ' + cleanedAbstract, rawDoc.url || rawDoc.id);

  let authors = [];
  if (Array.isArray(rawDoc.authors)) {
    authors = rawDoc.authors.map(a => (typeof a === 'string' ? a.trim() : (a.name || '').trim())).filter(Boolean);
  } else if (typeof rawDoc.authors === 'string') {
    authors = rawDoc.authors.split(/,|and/).map(a => a.trim()).filter(Boolean);
  } else if (rawDoc.author) {
    authors = [String(rawDoc.author).trim()];
  }

  let publishedAt = new Date().toISOString();
  if (rawDoc.published_at || rawDoc.pubDate || rawDoc.published) {
    try {
      publishedAt = new Date(rawDoc.published_at || rawDoc.pubDate || rawDoc.published).toISOString();
    } catch {
      publishedAt = new Date().toISOString();
    }
  }

  return {
    id: rawDoc.id || `doc-${Date.now()}-${Math.random().toString(36).substr(2, 7)}`,
    title: cleanedTitle,
    abstract: cleanedAbstract,
    clean_text: rawText,
    source_type: rawDoc.source_type || 'web',
    url: rawDoc.url || rawDoc.link || '',
    authors: authors.slice(0, 10),
    published_at: publishedAt,
    category: rawDoc.category || rawDoc.primary_category || 'General AI',
    hash: hash
  };
}
