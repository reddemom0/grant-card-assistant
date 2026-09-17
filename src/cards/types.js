/**
 * Card types by name.
 *
 * A function, not an object literal: review-card.js imports update.js, which
 * imports this file, so the binding must be read when called, not while the
 * modules are still loading.
 */

import { reviewCard } from './review-card.js';

export function cardTypeOf(cardOrType) {
  const type = typeof cardOrType === 'string' ? cardOrType : cardOrType?.card_type;
  switch (type) {
    case 'review': return reviewCard;
    default: return null;
  }
}
