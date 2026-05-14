/**
 * check_blog_coverage + get_recent_granted_ca_post tools
 *
 * Wraps the granted.ca WordPress REST API. Two surfaces:
 *
 * - check_blog_coverage: targeted lookup (topic, slug, modified_after, category).
 *   Use when "is X covered?" is the question.
 * - get_recent_granted_ca_post: time-window scan sorted by recency.
 *   Use when "what got published lately?" is the question — answers slug-lookup
 *   workflows in EMAILS / LINKEDIN ("which blog?" / "which success story?").
 *
 * Both wrap the same WP REST endpoint to replace the pattern of instructing
 * the model to hand-build web_fetch URLs — a pattern that was reliably skipped.
 *
 * Schemas live in src/tools/definitions.js (ORACLE_TOOLS); this file is
 * implementation only — no orphan schema exports.
 */

const WP_POSTS_URL = 'https://granted.ca/wp-json/wp/v2/posts';
const REQUEST_TIMEOUT_MS = 10000;

function stripHtml(s) {
  if (typeof s !== 'string') return '';
  return s.replace(/<[^>]*>/g, '').trim();
}

export async function checkBlogCoverage({ topic, slug, modified_after, category } = {}) {
  if (!topic && !slug && !modified_after && category === undefined) {
    return {
      success: false,
      error: 'At least one of topic, slug, modified_after, or category is required'
    };
  }

  const params = new URLSearchParams();
  if (topic) params.append('search', topic);
  if (slug) params.append('slug', slug);
  if (modified_after) params.append('modified_after', modified_after);
  if (category !== undefined && category !== null) params.append('categories', String(category));
  params.append('per_page', '5');
  params.append('_fields', 'id,slug,title,modified,excerpt,link');

  const url = `${WP_POSTS_URL}?${params.toString()}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    console.log(`   📚 check_blog_coverage: ${url}`);
    const response = await fetch(url, { signal: controller.signal });

    if (!response.ok) {
      throw new Error(`granted.ca WP REST API ${response.status} ${response.statusText}`);
    }

    const raw = await response.json();
    if (!Array.isArray(raw)) {
      throw new Error(`Unexpected response shape: expected array, got ${typeof raw}`);
    }

    const posts = raw.map(p => ({
      id: p.id,
      slug: p.slug,
      title: stripHtml(p.title?.rendered),
      modified: p.modified,
      excerpt: stripHtml(p.excerpt?.rendered),
      link: p.link
    }));

    return {
      success: true,
      count: posts.length,
      query: { topic, slug, modified_after, category },
      posts
    };
  } catch (error) {
    const isAbort = error.name === 'AbortError';
    const message = isAbort
      ? `granted.ca WP REST API timed out after ${REQUEST_TIMEOUT_MS}ms`
      : error.message;
    console.error('❌ check_blog_coverage error:', message);
    return {
      success: false,
      error: message,
      query: { topic, slug, modified_after, category }
    };
  } finally {
    clearTimeout(timer);
  }
}

const DEFAULT_DAYS = 30;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 20;

function isoDateNDaysAgo(days, today = new Date()) {
  // WP REST API requires full ISO 8601 datetime for modified_after; date-only
  // (YYYY-MM-DD) is rejected with rest_invalid_date. Anchor at midnight UTC.
  const ms = today.getTime() - days * 24 * 60 * 60 * 1000;
  return new Date(ms).toISOString().slice(0, 19); // YYYY-MM-DDTHH:MM:SS
}

export async function getRecentGrantedCaPost({ category, days, limit } = {}) {
  const effectiveDays = Number.isFinite(days) && days > 0 ? Math.floor(days) : DEFAULT_DAYS;
  let effectiveLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : DEFAULT_LIMIT;
  if (effectiveLimit > MAX_LIMIT) effectiveLimit = MAX_LIMIT;

  const windowStart = isoDateNDaysAgo(effectiveDays);

  const params = new URLSearchParams();
  params.append('orderby', 'modified');
  params.append('order', 'desc');
  params.append('per_page', String(effectiveLimit));
  params.append('modified_after', windowStart);
  if (category !== undefined && category !== null) {
    params.append('categories', String(category));
  }
  params.append('_fields', 'id,slug,title,modified,excerpt,link');

  const url = `${WP_POSTS_URL}?${params.toString()}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    console.log(`   📚 get_recent_granted_ca_post: ${url}`);
    const response = await fetch(url, { signal: controller.signal });

    if (!response.ok) {
      throw new Error(`granted.ca WP REST API ${response.status} ${response.statusText}`);
    }

    const raw = await response.json();
    if (!Array.isArray(raw)) {
      throw new Error(`Unexpected response shape: expected array, got ${typeof raw}`);
    }

    const posts = raw.map(p => ({
      id: p.id,
      slug: p.slug,
      title: stripHtml(p.title?.rendered),
      modified: p.modified,
      excerpt: stripHtml(p.excerpt?.rendered),
      link: p.link
    }));

    return {
      success: true,
      count: posts.length,
      query: { category, days: effectiveDays, limit: effectiveLimit },
      window_start: windowStart,
      posts
    };
  } catch (error) {
    const isAbort = error.name === 'AbortError';
    const message = isAbort
      ? `granted.ca WP REST API timed out after ${REQUEST_TIMEOUT_MS}ms`
      : error.message;
    console.error('❌ get_recent_granted_ca_post error:', message);
    return {
      success: false,
      error: message,
      query: { category, days: effectiveDays, limit: effectiveLimit },
      window_start: windowStart
    };
  } finally {
    clearTimeout(timer);
  }
}
