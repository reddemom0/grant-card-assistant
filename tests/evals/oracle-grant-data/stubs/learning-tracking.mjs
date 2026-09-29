/**
 * Eval stand-in for src/database/learning-tracking.js — the "team notes used"
 * audit row is not written. Reads pass through to the real module.
 */

export * from '../../../../src/database/learning-tracking.js?real';

export async function saveLearningApplication() {
  return null;
}
