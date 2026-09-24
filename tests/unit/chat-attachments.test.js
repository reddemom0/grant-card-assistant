/**
 * Files attached in Google Chat
 *
 * What gets read, what is refused and why, the 10 MB cap on the download stream,
 * and the rule that file text is never stored. No network: the Chat client is a
 * stand-in, and Drive attachments are not exercised here.
 *
 * Run with: NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/chat-attachments.test.js
 */

import { Readable } from 'stream';
import * as XLSX from 'xlsx';
import {
  attachmentsOf,
  downloadChatAttachment,
  readAttachments,
  unreadableLine,
  attachmentPlaceholder,
  attachmentBlockText
} from '../../src/tools/chat-attachments.js';
import { extractFileText, fileKind, MAX_DOWNLOAD_BYTES } from '../../src/tools/google-drive.js';
import { normalizeChatEvent, withAttachmentNotes, FILE_ONLY_MESSAGE } from '../../src/api/chat-google.js';
import { userContentToStore, toolResultsToStore } from '../../src/claude/client.js';

const PDF_TYPE = 'application/pdf';
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** A one-page PDF with a line of text, built by hand so no fixture file is needed. */
function tinyPdf(text) {
  const stream = `BT /F1 18 Tf 20 100 Td (${text}) Tj ET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ];
  let out = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`
    + offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')
    + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}

function tinyXlsx() {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Line item', 'Cost'], ['Metrology', 120000]]), 'Budget');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

/** A Chat client stand-in whose media.download streams the given bytes. */
function fakeChat(bytesByResource) {
  const calls = [];
  return {
    calls,
    media: {
      download: async ({ resourceName }) => {
        calls.push(resourceName);
        const data = bytesByResource[resourceName];
        const chunks = [];
        for (let i = 0; i < data.length; i += 1024 * 1024) chunks.push(data.subarray(i, i + 1024 * 1024));
        return { data: Readable.from(chunks) };
      }
    }
  };
}

describe('which files a message carries', () => {
  test('uploads and Drive attachments are both listed; GIFs are not files', () => {
    const files = attachmentsOf({
      attachment: [
        { contentName: 'scan.pdf', contentType: PDF_TYPE, source: 'UPLOADED_CONTENT', attachmentDataRef: { resourceName: 'r1' } },
        { contentName: 'Plan', source: 'DRIVE_FILE', driveDataRef: { driveFileId: 'abc' } }
      ],
      attachedGifs: [{ uri: 'https://example.com/x.gif' }]
    });
    expect(files).toEqual([
      { kind: 'upload', name: 'scan.pdf', contentType: PDF_TYPE, resourceName: 'r1' },
      { kind: 'drive', name: 'Plan', fileId: 'abc' }
    ]);
  });

  test('a single attachment object rather than a list is tolerated', () => {
    expect(attachmentsOf({ attachment: { contentName: 'a.txt', contentType: 'text/plain', attachmentDataRef: { resourceName: 'r' } } }))
      .toHaveLength(1);
  });

  test('normalizeChatEvent exposes the files, and upload detection is unchanged', () => {
    const evt = normalizeChatEvent({
      chat: {
        messagePayload: {
          message: {
            text: 'what does this say?',
            attachment: [{ contentName: 'budget.xlsx', contentType: XLSX_TYPE, attachmentDataRef: { resourceName: 'r' } }]
          },
          space: { name: 'spaces/AAA' }
        }
      }
    });
    expect(evt.files).toEqual([{ kind: 'upload', name: 'budget.xlsx', contentType: XLSX_TYPE, resourceName: 'r' }]);
    expect(evt.hasAttachments).toBe(true);
  });

  test('an unrecognized payload has an empty file list', () => {
    expect(normalizeChatEvent({ nonsense: true }).files).toEqual([]);
  });
});

describe('the shared parsers', () => {
  test('file kind comes from the type, or the name when the type is generic', () => {
    expect(fileKind(PDF_TYPE)).toBe('pdf');
    expect(fileKind('application/octet-stream', 'Budget.XLSX')).toBe('xlsx');
    expect(fileKind('', 'notes.txt')).toBe('text');
    expect(fileKind('application/zip', 'archive.zip')).toBeNull();
  });

  test('a PDF is read', async () => {
    const r = await extractFileText({ buffer: tinyPdf('Hello tariff'), mimeType: PDF_TYPE });
    expect(r.supported).toBe(true);
    expect(r.content).toMatch(/Hello tariff/);
  });

  test('an Excel workbook is read sheet by sheet', async () => {
    const r = await extractFileText({ buffer: tinyXlsx(), mimeType: XLSX_TYPE });
    expect(r.content).toMatch(/=== Sheet: Budget ===/);
    expect(r.content).toMatch(/Metrology,120000/);
  });

  test('an unsupported type is reported, not parsed', async () => {
    expect(await extractFileText({ buffer: Buffer.from('PK'), mimeType: 'application/zip' }))
      .toEqual({ supported: false, content: '' });
  });
});

describe('downloading within the 10 MB limit', () => {
  test('a small file comes back whole', async () => {
    const chat = fakeChat({ r: Buffer.from('hello') });
    const d = await downloadChatAttachment(chat, 'r');
    expect(d.buffer.toString()).toBe('hello');
  });

  test('a file over the limit stops downloading and is reported as too large', async () => {
    const chat = fakeChat({ big: Buffer.alloc(MAX_DOWNLOAD_BYTES + 1024 * 1024) });
    expect(await downloadChatAttachment(chat, 'big')).toEqual({ tooLarge: true });
  });
});

describe('reading a message\'s files', () => {
  test('readable, unsupported, and too-large files each get the right outcome', async () => {
    const chat = fakeChat({
      pdf: tinyPdf('Quarterly tariff impact'),
      big: Buffer.alloc(MAX_DOWNLOAD_BYTES + 1)
    });
    const results = await readAttachments([
      { kind: 'upload', name: 'impact.pdf', contentType: PDF_TYPE, resourceName: 'pdf' },
      { kind: 'upload', name: 'archive.zip', contentType: 'application/zip', resourceName: 'zip' },
      { kind: 'upload', name: 'huge.pdf', contentType: PDF_TYPE, resourceName: 'big' }
    ], { chat, userEmail: null });

    expect(results[0]).toMatchObject({ name: 'impact.pdf', ok: true });
    expect(results[0].content).toMatch(/Quarterly tariff impact/);
    expect(results[1]).toEqual({ name: 'archive.zip', ok: false, reason: 'unsupported' });
    expect(results[2]).toEqual({ name: 'huge.pdf', ok: false, reason: 'too_large' });
    // The unsupported file was never downloaded.
    expect(chat.calls).toEqual(['pdf', 'big']);
  });

  test('a download failure becomes a plain outcome, not a thrown error', async () => {
    const chat = { media: { download: async () => { throw Object.assign(new Error('boom'), { code: 403 }); } } };
    const [r] = await readAttachments([{ kind: 'upload', name: 'a.pdf', contentType: PDF_TYPE, resourceName: 'x' }], { chat });
    expect(r).toEqual({ name: 'a.pdf', ok: false, reason: 'error' });
  });

  test('the user-facing lines are short and say why', () => {
    expect(unreadableLine({ name: 'archive.zip', reason: 'unsupported' })).toMatch(/archive\.zip.*isn't supported/);
    expect(unreadableLine({ name: 'huge.pdf', reason: 'too_large' })).toMatch(/huge\.pdf is over 10 MB/);
    expect(unreadableLine({ name: 'a.pdf', reason: 'error' })).toMatch(/couldn't open a\.pdf/);
  });
});

describe('notes in the reply', () => {
  test('are prepended once, before the answer', () => {
    expect(withAttachmentNotes(['I couldn\'t read x.zip — that file type isn\'t supported.'], 'Answer'))
      .toBe('I couldn\'t read x.zip — that file type isn\'t supported.\n\nAnswer');
  });

  test('leave the reply alone when every file was read', () => {
    expect(withAttachmentNotes([], 'Answer')).toBe('Answer');
    expect(withAttachmentNotes(undefined, 'Answer')).toBe('Answer');
  });

  test('a files-only message says what happened rather than inventing a question', () => {
    expect(FILE_ONLY_MESSAGE).toMatch(/without a message/);
  });
});

describe('file text is never stored', () => {
  test('attachment blocks in the user turn are saved as a placeholder', () => {
    const block = { type: 'text', text: attachmentBlockText({ name: 'impact.pdf', content: 'confidential figures' }) };
    const question = { type: 'text', text: 'summarize this' };
    const stored = userContentToStore([block, question], new Map([[0, 'impact.pdf']]));
    expect(stored).toEqual([{ type: 'text', text: attachmentPlaceholder('impact.pdf') }, question]);
    expect(JSON.stringify(stored)).not.toMatch(/confidential figures/);
  });

  test('a turn with no Chat files is saved unchanged', () => {
    const content = [{ type: 'text', text: 'hello' }];
    expect(userContentToStore(content, new Map())).toEqual(content);
  });

  test('read_chat_attachments results are saved as a placeholder; other tools are not touched', () => {
    const results = [
      { type: 'tool_result', tool_use_id: 't1', content: 'file text' },
      { type: 'tool_result', tool_use_id: 't2', content: 'hubspot data' }
    ];
    const names = new Map([['t1', 'read_chat_attachments'], ['t2', 'search_hubspot_companies']]);
    const stored = toolResultsToStore(results, names);
    expect(stored[0].content).toBe(attachmentPlaceholder('files read from this thread'));
    expect(stored[1]).toEqual(results[1]);
  });
});
