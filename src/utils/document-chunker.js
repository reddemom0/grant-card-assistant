/**
 * Document Chunker for RAG
 *
 * Chunks documents by headings/sections to improve retrieval precision.
 * Based on Anthropic's RAG guide best practices.
 */

import { calculateRequestCost } from '../config/cost-settings.js';

/**
 * Chunk a document by headings
 * @param {string} content - Document text content
 * @param {string} fileName - Original file name
 * @returns {Array} Array of chunks with metadata
 */
export function chunkByHeadings(content, fileName) {
  if (!content || content.trim().length < 100) {
    // Document too short to chunk
    return [{
      chunkIndex: 0,
      heading: fileName,
      text: content || '',
      characterCount: content?.length || 0
    }];
  }

  const chunks = [];

  // Split by markdown headings (# ## ###) or common document headings
  // Match patterns like:
  // - "# Heading" (markdown)
  // - "HEADING:" (all caps with colon)
  // - "1. Section Name" (numbered sections)
  // - Multiple newlines followed by title case (paragraph breaks)

  const headingRegex = /(?:^|\n)(?:(#{1,6})\s+(.+)|([A-Z][A-Z\s]{3,}):|((?:\d+\.|\-|\*)\s+[A-Z][^\n]{10,}))/gm;

  let lastIndex = 0;
  let currentHeading = fileName;
  let chunkIndex = 0;
  let match;

  while ((match = headingRegex.exec(content)) !== null) {
    // Extract text before this heading (belongs to previous section)
    if (match.index > lastIndex) {
      const text = content.substring(lastIndex, match.index).trim();

      if (text.length > 50) { // Minimum chunk size
        chunks.push({
          chunkIndex: chunkIndex++,
          heading: currentHeading,
          text: text,
          characterCount: text.length
        });
      }
    }

    // Update current heading
    if (match[2]) {
      // Markdown heading (# Heading)
      currentHeading = match[2].trim();
    } else if (match[3]) {
      // All caps heading (HEADING:)
      currentHeading = match[3].trim();
    } else if (match[4]) {
      // Numbered/bulleted heading
      currentHeading = match[4].trim();
    }

    lastIndex = match.index + match[0].length;
  }

  // Add final chunk (after last heading)
  const finalText = content.substring(lastIndex).trim();
  if (finalText.length > 50) {
    chunks.push({
      chunkIndex: chunkIndex++,
      heading: currentHeading,
      text: finalText,
      characterCount: finalText.length
    });
  }

  // If no headings found, chunk by character limit (fallback)
  if (chunks.length === 0) {
    return chunkBySize(content, fileName, 3000); // 3K chars per chunk
  }

  // If chunks are too large, split them further
  const maxChunkSize = 5000; // 5K chars max
  const refinedChunks = [];

  chunks.forEach(chunk => {
    if (chunk.text.length <= maxChunkSize) {
      refinedChunks.push(chunk);
    } else {
      // Split large chunk by paragraphs
      const subChunks = splitLargeChunk(chunk, maxChunkSize);
      refinedChunks.push(...subChunks);
    }
  });

  return refinedChunks;
}

/**
 * Fallback: Chunk by character size
 */
function chunkBySize(content, fileName, chunkSize = 3000) {
  const chunks = [];
  let chunkIndex = 0;

  for (let i = 0; i < content.length; i += chunkSize) {
    const text = content.substring(i, i + chunkSize);

    chunks.push({
      chunkIndex: chunkIndex++,
      heading: `${fileName} (Part ${chunkIndex + 1})`,
      text: text.trim(),
      characterCount: text.length
    });
  }

  return chunks;
}

/**
 * Split a large chunk by paragraphs
 */
function splitLargeChunk(chunk, maxSize) {
  const paragraphs = chunk.text.split(/\n\n+/);
  const subChunks = [];
  let currentText = '';
  let subIndex = 0;

  paragraphs.forEach(para => {
    if ((currentText + para).length > maxSize && currentText.length > 0) {
      // Current accumulation is full, save it
      subChunks.push({
        chunkIndex: chunk.chunkIndex + subIndex / 100, // e.g., 0.01, 0.02
        heading: chunk.heading,
        text: currentText.trim(),
        characterCount: currentText.length
      });
      currentText = para;
      subIndex++;
    } else {
      currentText += (currentText ? '\n\n' : '') + para;
    }
  });

  // Add final sub-chunk
  if (currentText.trim().length > 0) {
    subChunks.push({
      chunkIndex: chunk.chunkIndex + subIndex / 100,
      heading: chunk.heading,
      text: currentText.trim(),
      characterCount: currentText.length
    });
  }

  return subChunks;
}

/**
 * Generate chunk summary using Claude
 * @param {string} heading - Chunk heading
 * @param {string} text - Chunk text
 * @param {Object} anthropic - Anthropic client
 * @returns {Promise<string>} 2-3 sentence summary
 */
export async function generateChunkSummary(heading, text, anthropic) {
  try {
    // Keep summary generation concise
    const promptText = `${heading}\n\n${text.substring(0, 2000)}`; // First 2K chars

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 150,
      messages: [{
        role: 'user',
        content: `Summarize this document section in 2-3 concise sentences. Focus on key information and main points.

Section: ${promptText}

Summary:`
      }]
    });

    // Log cost
    if (response.usage) {
      const cost = calculateRequestCost(response.usage, 'claude-haiku-4-5-20251001');
      console.log(`💰 [Document Chunker] Request cost: $${cost.toFixed(4)} (Heading: ${heading.substring(0, 50)})`);
    }

    return response.content[0].text.trim();
  } catch (error) {
    console.error('Summary generation failed:', error.message);
    // Fallback: use first 200 chars
    return text.substring(0, 200).trim() + '...';
  }
}

/**
 * Estimate token count (rough approximation)
 * @param {string} text - Text to estimate
 * @returns {number} Estimated tokens (~4 chars per token)
 */
export function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}
