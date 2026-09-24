// Stand-in for src/tools/executor.js: only read-type tools run; every call is traced.
import * as real from '../../src/tools/executor.js?real';
export * from '../../src/tools/executor.js?real';

export const TRACE = [];

const isReadTool = name => name === 'load_skill'
  || /^(search|list|read|get)_/.test(name)
  || ['memory_recall', 'memory_list'].includes(name);

export async function executeToolCall(name, input, ...rest) {
  const allowed = isReadTool(name);
  TRACE.push({ name, input, allowed });
  console.log('[RO-TOOL]', allowed ? 'run  ' : 'BLOCK', name, JSON.stringify(input).slice(0, 160));
  if (!allowed) {
    return { success: false, error: 'Blocked: this is a read-only test run. Put the output in your reply instead.' };
  }
  return real.executeToolCall(name, input, ...rest);
}
