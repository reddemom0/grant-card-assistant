// Loads the read-only hooks for scripts in this folder. See run-honesty-checks.mjs.
import { register } from 'node:module';
register('./hooks.mjs', import.meta.url);
