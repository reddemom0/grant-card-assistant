/**
 * Google Chat message splitting and the notes about unreadable attachments
 *
 * The splitter's contract: every chunk Chat receives must render on its own.
 * A chunk that ends inside a code fence renders as an unterminated block and the
 * next one renders as literal backticks — silently, which is why this is tested
 * rather than eyeballed.
 *
 * Run with: NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/chat-split.test.js
 */

import {
  splitForChat,
  markdownToChat,
  normalizeChatEvent,
  withAttachmentNotes
} from '../../src/api/chat-google.js';

const LIMIT = 3500;

/** Fence lines in a chunk; an odd count means it renders broken. */
const fenceCount = (chunk) => (chunk.match(/^\s*```/gm) || []).length;
const allBalanced = (chunks) => chunks.every(c => fenceCount(c) % 2 === 0);

const codeBlock = (lines, lang = 'js') =>
  '```' + lang + '\n' +
  Array.from({ length: lines }, (_, i) => `  const line${i} = compute(${i});  // step ${i}`).join('\n') +
  '\n```';

describe('short messages are left alone', () => {
  test('a message under the limit is one unchanged chunk', () => {
    const text = 'Short answer.\n\nWith a second paragraph.';
    expect(splitForChat(text)).toEqual([text]);
  });

  test('empty input produces no chunks', () => {
    expect(splitForChat('')).toEqual([]);
  });
});

describe('code fences survive the boundary', () => {
  const text = `Here is the script:\n\n${codeBlock(120)}\n\nThat is the whole thing.`;

  test('the sample actually crosses the limit', () => {
    expect(text.length).toBeGreaterThan(LIMIT);
  });

  test('every chunk is independently balanced', () => {
    const chunks = splitForChat(text);
    expect(chunks.length).toBeGreaterThan(1);
    expect(allBalanced(chunks)).toBe(true);
    chunks.forEach(c => expect(c.length).toBeLessThanOrEqual(LIMIT));
  });

  test('the continuation reopens with the same language tag', () => {
    const chunks = splitForChat(text);
    expect(chunks[1].startsWith('```js')).toBe(true);
    expect(chunks[0].trimEnd().endsWith('```')).toBe(true);
  });

  test('no code line is lost across the split', () => {
    const rejoined = splitForChat(text).join('\n');
    for (const i of [0, 1, 59, 83, 84, 119]) {
      expect(rejoined).toContain(`const line${i} = compute(${i});`);
    }
  });

  test('a fence with no language tag reopens as a bare fence', () => {
    const chunks = splitForChat(`Intro\n\n${codeBlock(120, '')}`);
    expect(allBalanced(chunks)).toBe(true);
    expect(chunks[1].startsWith('```')).toBe(true);
  });

  test('no trailing chunk that is only a reopened fence', () => {
    for (const lines of [60, 90, 120, 150]) {
      const chunks = splitForChat(`Intro\n\n${codeBlock(lines)}`);
      expect(chunks[chunks.length - 1].trim()).not.toBe('```js');
      expect(allBalanced(chunks)).toBe(true);
    }
  });
});

describe('prose and lists split at readable seams', () => {
  test('a long list splits between items, never mid-item', () => {
    const items = Array.from({ length: 200 }, (_, i) => `- Item ${i}: ${'detail '.repeat(4)}`);
    const chunks = splitForChat(items.join('\n'));

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      for (const line of chunk.split('\n')) {
        // Every line is a complete item, not a fragment of one.
        expect(line.startsWith('- Item ')).toBe(true);
        expect(line.trimEnd().endsWith('detail')).toBe(true);
      }
    }
  });

  test('paragraphs break on blank lines', () => {
    const paras = Array.from({ length: 60 }, (_, i) => `Paragraph ${i}. ${'word '.repeat(20)}`);
    const chunks = splitForChat(paras.join('\n\n'));

    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach(c => {
      expect(c.length).toBeLessThanOrEqual(LIMIT);
      expect(c.trimStart().startsWith('Paragraph ')).toBe(true);
    });
  });

  test('a single over-long line is still cut mid-line, as a last resort', () => {
    const chunks = splitForChat('x'.repeat(LIMIT * 2 + 100));
    expect(chunks.length).toBe(3);
    chunks.forEach(c => expect(c.length).toBeLessThanOrEqual(LIMIT));
    expect(chunks.join('').length).toBe(LIMIT * 2 + 100);
  });
});

describe('the Stage 0.1 gate text still posts intact', () => {
  test('a confirmation notice after a long reply survives splitting', () => {
    const summary = 'Update HubSpot deal 12345: amount → $50,000, dealstage → Submitted';
    const long = Array.from({ length: 60 }, (_, i) => `Finding ${i}. ${'context '.repeat(15)}`).join('\n\n');
    const reply = `${long}\n\n**Confirm before I run this:**\n${summary}\n\nReply "yes" and I'll do exactly that.`;

    const chunks = splitForChat(markdownToChat(reply));
    const last = chunks[chunks.length - 1];

    expect(last).toContain('**Confirm before I run this:**');
    expect(last).toContain(summary);
    expect(last).toContain('Reply "yes"');
    expect(allBalanced(chunks)).toBe(true);
  });

  test('a short "Done:" reply stays a single message', () => {
    const done = 'Done: Update HubSpot deal 12345: amount → $50,000';
    expect(splitForChat(markdownToChat(done))).toEqual([done]);
  });
});

describe('attachment detection — presence only', () => {
  const withMessage = (message) => ({ chat: { messagePayload: { message, space: { name: 'spaces/AAA' } } } });

  test('add-on shape: a file is detected', () => {
    const evt = normalizeChatEvent(withMessage({
      text: 'what does this say?',
      sender: { email: 'a@granted.ca', type: 'HUMAN' },
      attachment: [{ name: 'spaces/AAA/messages/BBB/attachments/CCC', contentName: 'budget.pdf' }]
    }));
    expect(evt.hasAttachments).toBe(true);
    expect(evt.attachmentCount).toBe(1);
    expect(evt.text).toBe('what does this say?');
  });

  test('classic shape: a file is detected', () => {
    const evt = normalizeChatEvent({
      type: 'MESSAGE',
      message: { text: 'review this', attachment: [{ contentName: 'a.pdf' }, { contentName: 'b.pdf' }] },
      space: { name: 'spaces/AAA' }
    });
    expect(evt.hasAttachments).toBe(true);
    expect(evt.attachmentCount).toBe(2);
  });

  test('a single object rather than a list is tolerated', () => {
    const evt = normalizeChatEvent(withMessage({ text: 'hi', attachment: { contentName: 'x.pdf' } }));
    expect(evt.hasAttachments).toBe(true);
  });

  test('a file added from Drive is not counted — Oracle can read it', () => {
    const evt = normalizeChatEvent(withMessage({
      text: 'The RA is here:',
      attachment: [{
        contentName: 'RTRI Readiness Assessment',
        source: 'DRIVE_FILE',
        driveDataRef: { driveFileId: '1gm2pf5TLQWOX3evPPxYeUyMrfFSCucgzgdm5nmHWo2o' }
      }]
    }));
    expect(evt.hasAttachments).toBe(false);
    expect(evt.attachmentCount).toBe(0);
  });

  test('a driveDataRef alone marks a Drive file, even without source', () => {
    const evt = normalizeChatEvent(withMessage({
      text: 'see attached',
      attachment: { contentName: 'Budget', driveDataRef: { driveFileId: 'abc123' } }
    }));
    expect(evt.hasAttachments).toBe(false);
  });

  test('an uploaded file still counts when a Drive file comes with it', () => {
    const evt = normalizeChatEvent(withMessage({
      text: 'both of these',
      attachment: [
        { contentName: 'scan.pdf', source: 'UPLOADED_CONTENT', attachmentDataRef: { resourceName: 'r' } },
        { contentName: 'Plan', source: 'DRIVE_FILE', driveDataRef: { driveFileId: 'xyz' } }
      ]
    }));
    expect(evt.hasAttachments).toBe(true);
    expect(evt.attachmentCount).toBe(1);
  });

  test('a plain message reports no attachments', () => {
    const evt = normalizeChatEvent(withMessage({ text: 'just a question' }));
    expect(evt.hasAttachments).toBe(false);
    expect(evt.attachmentCount).toBe(0);
  });

  test('an unrecognized payload still has the fields', () => {
    const evt = normalizeChatEvent({ nonsense: true });
    expect(evt.hasAttachments).toBe(false);
    expect(evt.attachmentCount).toBe(0);
  });
});

describe('notes about unreadable files', () => {
  const NOTE = "I couldn't read archive.zip — that file type isn't supported.";

  test('are prepended once, and land in the first chunk only', () => {
    const long = Array.from({ length: 60 }, (_, i) => `Paragraph ${i}. ${'word '.repeat(20)}`).join('\n\n');
    const chunks = splitForChat(withAttachmentNotes([NOTE], long));

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].startsWith(NOTE)).toBe(true);
    const total = chunks.join('\n').split(NOTE).length - 1;
    expect(total).toBe(1);
  });

  test('are absent when every file was read', () => {
    expect(withAttachmentNotes([], 'answer')).toBe('answer');
    expect(withAttachmentNotes(null, 'answer')).toBe('answer');
  });
});

