/**
 * check_blog_coverage tool
 *
 * Wraps the granted.ca WordPress REST API so Oracle can check existing blog
 * coverage on a topic before recommending new posts or refreshes. Replaces
 * the prior pattern of instructing the model to hand-build web_fetch URLs
 * against /wp-json/wp/v2/posts — a pattern that was reliably skipped.
 *
 * Schema lives in src/tools/definitions.js (ORACLE_TOOLS); this file is
 * implementation only — no orphan schema export.
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
