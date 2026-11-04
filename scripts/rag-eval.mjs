#!/usr/bin/env node
/**
 * Granted Files search eval — runs the questions in tests/evals/granted-files/questions.json
 * through the same search Oracle's search_granted_files uses (src/services/rag/search.js)
 * and writes a markdown table: top 3 files per question, result count, timings, and a
 * blank Pass/Fail column for a person to fill in. Plus p50/p95 latency.
 *
 * Read-only: refuses to run unless the database session is read-only
 * (PGOPTIONS='-c default_transaction_read_only=on'). No asker access filter here —
 * the eval sees every indexed file, as writers@ would.
 *
 * The database has no public proxy, so run it in the container:
 *   PGOPTIONS='-c default_transaction_read_only=on' node scripts/rag-eval.mjs [--mode rerank|cosine|both] [--only 1,3] [--out file.md]
 *
 * The report names client files: keep it out of git.
 */

import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config({ path: new URL('../.env', import.meta.url).pathname, quiet: true });

const args = process.argv.slice(2);
const value = (name, fallback) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
const mode = value('--mode', 'both');
const only = value('--only', null)?.split(',').map(Number) ?? null;
const out = value('--out', `/tmp/rag-eval-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '')}.md`);
const WARMUPS = 2;

const pct = (xs, p) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
};
const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

async function main() {
  const { query } = await import('../src/database/connection.js');
  const readOnly = (await query(`SELECT current_setting('transaction_read_only') AS ro`)).rows[0].ro;
  if (readOnly !== 'on') {
    console.error('Refusing to run: the database session is not read-only. Set PGOPTIONS=\'-c default_transaction_read_only=on\'.');
    process.exit(1);
  }
  const { searchGrantedFiles, trimResults } = await import('../src/services/rag/search.js');
  const spec = JSON.parse(fs.readFileSync(new URL('../tests/evals/granted-files/questions.json', import.meta.url), 'utf8'));
  const questions = spec.questions.filter(q => q.question !== 'TODO' && (!only || only.includes(q.id)));
  const modes = mode === 'both' ? ['rerank', 'cosine'] : [mode];

  // Warm-ups (first queries pay connection and cache costs), reported separately.
  const warm = [];
  for (let i = 0; i < WARMUPS; i++) {
    const t0 = performance.now();
    const { stats } = await searchGrantedFiles(questions[i % questions.length].question, { rerank: false });
    warm.push({ ms: Math.round(performance.now() - t0), ms_sql: stats.ms_sql });
  }

  const runs = {};
  for (const m of modes) {
    runs[m] = [];
    for (const q of questions) {
      const t0 = performance.now();
      const { files, stats } = await searchGrantedFiles(q.question, { ...(q.filters || {}), rerank: m === 'rerank' });
      const results = trimResults(files);
      runs[m].push({ q, results, ms: Math.round(performance.now() - t0), stats });
    }
  }

  const lines = [];
  lines.push(`# Granted Files search eval — ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`, '');
  lines.push(`- Questions: ${questions.length} (TODO slots skipped: ${spec.questions.length - spec.questions.filter(q => q.question !== 'TODO').length})`);
  lines.push(`- Read-only proof: transaction_read_only = ${readOnly}`);
  lines.push(`- Warm-ups (not counted): ${warm.map(w => `${w.ms} ms total / ${w.ms_sql} ms SQL`).join('; ')}`);
  lines.push('- No asker access filter (the tool adds one); every indexed file is visible here.', '');
  for (const m of modes) {
    const r = runs[m];
    const ms = r.map(x => x.ms);
    const sql = r.map(x => x.stats.ms_sql);
    lines.push(`## ${m === 'rerank' ? 'Cosine + rerank (rerank-2.5-lite)' : 'Cosine only'}`, '');
    lines.push(`Latency — total p50 ${pct(ms, 50)} ms, p95 ${pct(ms, 95)} ms; SQL p50 ${pct(sql, 50)} ms, p95 ${pct(sql, 95)} ms. Tokens ${r.reduce((n, x) => n + x.stats.tokens, 0).toLocaleString()}.`, '');
    lines.push('| # | Question | Expect | Top 3 files (area year · locator · score) | Files | ms | Pass/Fail |');
    lines.push('|---|---|---|---|---|---|---|');
    for (const { q, results, ms: t } of r) {
      const top = results.slice(0, 3).map((f, i) => `${i + 1}. ${cell(f.name)} (${f.area}${f.year ? ` ${f.year}` : ''}${f.label ? `, ${f.label}` : ''} · ${cell(f.locators[0] || '-')} · ${f.score})`).join('<br>') || '— nothing —';
      lines.push(`| ${q.id} | ${cell(q.question)}${q.filters ? ` _(${Object.entries(q.filters).map(([k, v]) => `${k}=${v}`).join(', ')})_` : ''} | ${q.expect} | ${top} | ${results.length} | ${t} |  |`);
    }
    lines.push('');
  }
  const report = lines.join('\n');
  fs.writeFileSync(out, report);
  console.log(report);
  console.log(`\nReport written to ${out}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(`Eval failed: ${String(err?.code || err?.statusCode || err?.name || 'error').slice(0, 40)}`);
  process.exit(1);
});
