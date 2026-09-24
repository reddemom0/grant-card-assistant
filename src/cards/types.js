/**
 * Card types by name.
 *
 * A function, not an object literal: review-card.js imports update.js, which
 * imports this file, so the binding must be read when called, not while the
 * modules are still loading.
 */

import { reviewCard } from './review-card.js';
import { trackCard } from './track-card.js';
import { leadCard } from './lead-card.js';
import { meetCard } from './meet-card.js';
import { watchCard } from './watch-card.js';
import { introType } from './intro-card.js';
import { lessonCard } from './lesson-card.js';

export function cardTypeOf(cardOrType) {
  const type = typeof cardOrType === 'string' ? cardOrType : cardOrType?.card_type;
  switch (type) {
    case 'review': return reviewCard;
    case 'track': return trackCard;
    case 'lead': return leadCard;
    case 'meet': return meetCard;
    case 'watch': return watchCard;
    case 'intro': return introType;
    case 'lesson': return lessonCard;
    default: return null;
  }
}

/** Every card type — a function for the same reason as cardTypeOf. */
export function allCardTypes() {
  return [reviewCard, trackCard, leadCard, meetCard, watchCard, introType, lessonCard];
}
