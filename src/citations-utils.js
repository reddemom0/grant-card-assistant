/**
 * Citations Utilities
 * Helper functions for working with Claude's citations feature
 */

/**
 * Format citations for human-readable display
 * @param {array} citations - Array of citation objects
 * @returns {string} Formatted citations text
 */
export function formatCitations(citations) {
  if (!citations || citations.length === 0) {
    return '';
  }

  let formatted = '\n\n## Citations\n\n';

  citations.forEach((item, index) => {
    const { citation, text } = item;

    formatted += `**[${index + 1}]** "${text}"\n`;
    formatted += `   Source: ${citation.document_title || 'Untitled'}\n`;

    // Format location based on citation type
    if (citation.type === 'page_location') {
      formatted += `   Pages: ${citation.start_page_number}-${citation.end_page_number - 1}\n`;
    } else if (citation.type === 'char_location') {
      formatted += `   Characters: ${citation.start_char_index}-${citation.end_char_index}\n`;
    } else if (citation.type === 'content_block_location') {
      formatted += `   Blocks: ${citation.start_block_index}-${citation.end_block_index - 1}\n`;
    }

    if (citation.cited_text) {
      formatted += `   Cited: "${citation.cited_text.substring(0, 100)}${citation.cited_text.length > 100 ? '...' : ''}"\n`;
    }

    formatted += '\n';
  });

  return formatted;
}

/**
 * Extract unique source documents from citations
 * @param {array} citations - Array of citation objects
 * @returns {array} Array of unique document references
 */
export function getSourceDocuments(citations) {
  if (!citations || citations.length === 0) {
    return [];
  }

  const documents = new Map();

  citations.forEach(item => {
    const { citation } = item;
    const docIndex = citation.document_index;

    if (!documents.has(docIndex)) {
      documents.set(docIndex, {
        index: docIndex,
        title: citation.document_title || 'Untitled',
        citationCount: 0,
        citationType: citation.type
      });
    }

    documents.get(docIndex).citationCount++;
  });

  return Array.from(documents.values());
}

/**
 * Group citations by document
 * @param {array} citations - Array of citation objects
 * @returns {object} Citations grouped by document index
 */
export function groupCitationsByDocument(citations) {
  if (!citations || citations.length === 0) {
    return {};
  }

  const grouped = {};

  citations.forEach(item => {
    const docIndex = item.citation.document_index;

    if (!grouped[docIndex]) {
      grouped[docIndex] = {
        documentTitle: item.citation.document_title || 'Untitled',
        citations: []
      };
    }

    grouped[docIndex].citations.push(item);
  });

  return grouped;
}

/**
 * Create a citation summary
 * @param {array} citations - Array of citation objects
 * @returns {object} Citation summary statistics
 */
export function getCitationSummary(citations) {
  if (!citations || citations.length === 0) {
    return {
      totalCitations: 0,
      uniqueDocuments: 0,
      citationTypes: {}
    };
  }

  const types = {};
  const documents = new Set();

  citations.forEach(item => {
    const { citation } = item;

    // Count citation types
    types[citation.type] = (types[citation.type] || 0) + 1;

    // Track unique documents
    documents.add(citation.document_index);
  });

  return {
    totalCitations: citations.length,
    uniqueDocuments: documents.size,
    citationTypes: types
  };
}

/**
 * Validate citation structure
 * @param {object} citation - Citation object to validate
 * @returns {object} Validation result
 */
export function validateCitation(citation) {
  const errors = [];

  // Check required fields
  if (!citation.type) {
    errors.push('Missing citation type');
  }

  if (citation.document_index === undefined) {
    errors.push('Missing document index');
  }

  // Type-specific validation
  if (citation.type === 'page_location') {
    if (!citation.start_page_number || !citation.end_page_number) {
      errors.push('Missing page numbers');
    }
  } else if (citation.type === 'char_location') {
    if (citation.start_char_index === undefined || citation.end_char_index === undefined) {
      errors.push('Missing character indices');
    }
  } else if (citation.type === 'content_block_location') {
    if (citation.start_block_index === undefined || citation.end_block_index === undefined) {
      errors.push('Missing block indices');
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Convert citations to markdown format with footnotes
 * @param {string} text - Main text content
 * @param {array} citations - Array of citation objects
 * @returns {string} Text with markdown footnotes
 */
export function toMarkdownWithFootnotes(text, citations) {
  if (!citations || citations.length === 0) {
    return text;
  }

  let result = text;
  let footnotes = '\n\n---\n\n';

  citations.forEach((item, index) => {
    const { citation } = item;
    const footnoteNum = index + 1;

    // Add footnote reference (if not already in text)
    // This is simplified - in production you'd want more sophisticated insertion

    // Build footnote
    footnotes += `[^${footnoteNum}]: ${citation.document_title || 'Untitled'}`;

    if (citation.type === 'page_location') {
      footnotes += `, p. ${citation.start_page_number}`;
      if (citation.end_page_number > citation.start_page_number + 1) {
        footnotes += `-${citation.end_page_number - 1}`;
      }
    }

    if (citation.cited_text) {
      footnotes += ` - "${citation.cited_text.substring(0, 100)}${citation.cited_text.length > 100 ? '...' : ''}"`;
    }

    footnotes += '\n\n';
  });

  return result + footnotes;
}

/**
 * Create inline citations in APA style
 * @param {array} citations - Array of citation objects
 * @returns {string} Inline citation text
 */
export function toAPAInlineCitations(citations) {
  if (!citations || citations.length === 0) {
    return '';
  }

  const docs = getSourceDocuments(citations);
  const titles = docs.map(doc => doc.title);

  if (titles.length === 1) {
    const pages = citations
      .filter(c => c.citation.type === 'page_location')
      .map(c => c.citation.start_page_number);

    if (pages.length > 0) {
      return `(${titles[0]}, p. ${pages.join(', ')})`;
    }
    return `(${titles[0]})`;
  }

  return `(${titles.join('; ')})`;
}

export default {
  formatCitations,
  getSourceDocuments,
  groupCitationsByDocument,
  getCitationSummary,
  validateCitation,
  toMarkdownWithFootnotes,
  toAPAInlineCitations
};
