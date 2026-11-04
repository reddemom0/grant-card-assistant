/**
 * Booking-URL detection shared by the lead-gen safety net
 * (src/api/booking-link-routing.js) and the memory reads that reach the
 * model (src/tools/memory.js).
 *
 * Kept import-free on purpose: memory.js is shared by every agent and must not
 * pull in the categorization data files that booking-link-routing.js loads.
 *
 * The lead-gen model should never see or write a real booking URL. It writes
 * the {{BOOKING_LINK}} sentinel and the server routes the link. Anything here
 * is a defence for when that contract slips.
 */

// Booking hosts the model could plausibly write. Each is anchored right after
// `//` so a lookalike such as `local.com` or `notcalendly.com` never matches.
const BOOKING_HOSTS = [
  'meetings\\.hubspot\\.com',
  '(?:www\\.|app\\.)?calendly\\.com',
  '(?:app\\.)?cal\\.com',
  'calendar\\.app\\.google'
];

/** Host alternation, for regexes that only need the host (no scheme or path). */
export const BOOKING_HOST_PATTERN = `(?:${BOOKING_HOSTS.join('|')})`;

/** Full URL, scheme through path. Stops at whitespace, quotes, angle brackets and `)`. */
export const BOOKING_URL_PATTERN = `https?:\\/\\/${BOOKING_HOST_PATTERN}(?:\\/[^\\s"'<>)]*)?`;

/** A fresh global regex for one pass; avoids shared lastIndex state. */
export function bookingUrlRegex() {
  return new RegExp(BOOKING_URL_PATTERN, 'gi');
}

/**
 * Remove every booking URL from a string. Non-strings pass through.
 * In a JSON value, `"booking_link":"https://…"` becomes `"booking_link":""`,
 * which still parses.
 */
export function redactBookingUrls(text) {
  if (typeof text !== 'string') return text;
  return text.replace(bookingUrlRegex(), '');
}

/**
 * Copy of a categorization or merged_estimate record without its booking
 * links, for writing to conversation_memory. `consultant_assignment` keeps
 * only the name the HubSpot Note shows. The input is not mutated.
 */
export function omitBookingLinks(record) {
  if (!record || typeof record !== 'object') return record;
  const { booking_link, ...rest } = record;
  if (rest.consultant_assignment && typeof rest.consultant_assignment === 'object') {
    rest.consultant_assignment = { name: rest.consultant_assignment.name ?? null };
  }
  return rest;
}
