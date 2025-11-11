/**
 * Memory File Generator
 *
 * Converts analyzed feedback patterns into structured memory files
 * that agents can read to improve their performance.
 */

import { handleMemoryTool } from '../../api/memory-tool-handler.js';

/**
 * Generate and write learned patterns to agent memory
 * @param {string} agentType - Agent type
 * @param {Object} learningReport - Report from analyzer
 * @returns {Promise<Object>} Result of memory write operations
 */
export async function writeLearnedPatterns(agentType, learningReport) {
  console.log(`📝 Writing learned patterns for ${agentType}...`);

  const results = {
    agentType,
    filesWritten: [],
    errors: []
  };

  // 1. Write success patterns
  if (learningReport.successPatterns.count > 0) {
    try {
      const content = formatSuccessPatterns(learningReport);
      const path = `/memories/agents/${agentType}/learned-patterns.md`;

      const result = await handleMemoryTool('create', {
        path,
        file_text: content
      });

      if (result.success) {
        results.filesWritten.push(path);
        console.log(`✅ Wrote success patterns to ${path}`);
      } else {
        // If file exists, try to update it instead
        if (result.error.includes('already exists')) {
          const updateResult = await handleMemoryTool('str_replace', {
            path,
            old_str: '<!-- AUTO-GENERATED -->',
            new_str: content
          });

          if (updateResult.success) {
            results.filesWritten.push(`${path} (updated)`);
            console.log(`✅ Updated success patterns at ${path}`);
          } else {
            results.errors.push({ path, error: updateResult.error });
          }
        } else {
          results.errors.push({ path, error: result.error });
        }
      }
    } catch (error) {
      results.errors.push({ path: 'learned-patterns.md', error: error.message });
    }
  }

  // 2. Write error patterns
  if (learningReport.errorPatterns.count > 0) {
    try {
      const content = formatErrorPatterns(learningReport);
      const path = `/memories/agents/${agentType}/common-errors.md`;

      const result = await handleMemoryTool('create', {
        path,
        file_text: content
      });

      if (result.success) {
        results.filesWritten.push(path);
        console.log(`✅ Wrote error patterns to ${path}`);
      } else {
        if (result.error.includes('already exists')) {
          // Try to replace entire file content
          const viewResult = await handleMemoryTool('view', { path });
          if (viewResult.success) {
            const updateResult = await handleMemoryTool('str_replace', {
              path,
              old_str: viewResult.content,
              new_str: content
            });

            if (updateResult.success) {
              results.filesWritten.push(`${path} (updated)`);
              console.log(`✅ Updated error patterns at ${path}`);
            }
          }
        } else {
          results.errors.push({ path, error: result.error });
        }
      }
    } catch (error) {
      results.errors.push({ path: 'common-errors.md', error: error.message });
    }
  }

  // 3. Write user corrections
  if (learningReport.corrections.count > 0) {
    try {
      const content = formatUserCorrections(learningReport);
      const path = `/memories/agents/${agentType}/user-corrections.md`;

      const result = await handleMemoryTool('create', {
        path,
        file_text: content
      });

      if (result.success) {
        results.filesWritten.push(path);
        console.log(`✅ Wrote user corrections to ${path}`);
      } else {
        if (result.error.includes('already exists')) {
          const viewResult = await handleMemoryTool('view', { path });
          if (viewResult.success) {
            const updateResult = await handleMemoryTool('str_replace', {
              path,
              old_str: viewResult.content,
              new_str: content
            });

            if (updateResult.success) {
              results.filesWritten.push(`${path} (updated)`);
              console.log(`✅ Updated user corrections at ${path}`);
            }
          }
        } else {
          results.errors.push({ path, error: result.error });
        }
      }
    } catch (error) {
      results.errors.push({ path: 'user-corrections.md', error: error.message });
    }
  }

  // 4. Write summary/index file
  try {
    const content = formatSummary(learningReport);
    const path = `/memories/agents/${agentType}/README.md`;

    const result = await handleMemoryTool('create', {
      path,
      file_text: content
    });

    if (result.success) {
      results.filesWritten.push(path);
      console.log(`✅ Wrote summary to ${path}`);
    } else {
      if (result.error.includes('already exists')) {
        const viewResult = await handleMemoryTool('view', { path });
        if (viewResult.success) {
          const updateResult = await handleMemoryTool('str_replace', {
            path,
            old_str: viewResult.content,
            new_str: content
          });

          if (updateResult.success) {
            results.filesWritten.push(`${path} (updated)`);
            console.log(`✅ Updated summary at ${path}`);
          }
        }
      }
    }
  } catch (error) {
    results.errors.push({ path: 'README.md', error: error.message });
  }

  console.log(`✅ Wrote ${results.filesWritten.length} memory files for ${agentType}`);
  if (results.errors.length > 0) {
    console.warn(`⚠️  ${results.errors.length} errors occurred during memory write`);
  }

  return results;
}

/**
 * Format success patterns as markdown
 */
function formatSuccessPatterns(report) {
  const { successPatterns, generatedAt } = report;

  let md = `# Learned Success Patterns

**Agent**: ${report.agentType}
**Generated**: ${new Date(generatedAt).toLocaleString()}
**Based on**: ${successPatterns.count} high-quality responses (avg score: ${successPatterns.averageQuality.toFixed(2)})

---

## Top Themes

These themes appear most frequently in highly-rated responses:

`;

  successPatterns.topThemes.forEach((theme, i) => {
    md += `${i + 1}. **${theme.theme}** (${theme.count} occurrences)\n`;
  });

  md += `\n## Successful Approaches\n\n`;

  if (successPatterns.examples.length > 0) {
    successPatterns.examples.forEach((example, i) => {
      md += `### Example ${i + 1} (Quality: ${example.qualityScore.toFixed(2)})\n\n`;
      md += `**Approach**: ${example.approach}\n\n`;
      if (example.userNote) {
        md += `**User Feedback**: ${example.userNote}\n\n`;
      }
      md += `---\n\n`;
    });
  } else {
    md += `No detailed examples available yet.\n\n`;
  }

  md += `\n*Last updated: ${new Date(generatedAt).toLocaleString()}*\n`;

  return md;
}

/**
 * Format error patterns as markdown
 */
function formatErrorPatterns(report) {
  const { errorPatterns, generatedAt } = report;

  let md = `# Common Errors to Avoid

**Agent**: ${report.agentType}
**Generated**: ${new Date(generatedAt).toLocaleString()}
**Based on**: ${errorPatterns.count} negative responses (avg score: ${errorPatterns.averageQuality.toFixed(2)})

---

## Error Categories

`;

  errorPatterns.commonErrors.forEach((error, i) => {
    md += `${i + 1}. **${error.type}** (${error.count} occurrences)\n`;
  });

  md += `\n## Specific Error Examples\n\n`;

  if (errorPatterns.examples.length > 0) {
    errorPatterns.examples.forEach((example, i) => {
      md += `### Error ${i + 1}: ${example.errorType}\n\n`;
      md += `**Issue**: ${example.issue}\n\n`;
      md += `**Context**: ${example.context}\n\n`;
      md += `**Quality Score**: ${example.qualityScore.toFixed(2)}\n\n`;
      md += `---\n\n`;
    });
  } else {
    md += `No detailed error examples available.\n\n`;
  }

  md += `\n*Last updated: ${new Date(generatedAt).toLocaleString()}*\n`;

  return md;
}

/**
 * Format user corrections as markdown
 */
function formatUserCorrections(report) {
  const { corrections, generatedAt } = report;

  let md = `# User Corrections

**Agent**: ${report.agentType}
**Generated**: ${new Date(generatedAt).toLocaleString()}
**Based on**: ${corrections.count} user corrections

---

`;

  // Factual corrections
  if (corrections.factual.length > 0) {
    md += `## Factual Corrections\n\nThese corrections indicate incorrect information that was provided:\n\n`;
    corrections.factual.forEach((correction, i) => {
      md += `${i + 1}. ${correction.issue}\n`;
      md += `   *Context*: ${correction.context}\n\n`;
    });
  }

  // Procedural corrections
  if (corrections.procedural.length > 0) {
    md += `## Procedural Corrections\n\nThese corrections relate to process, steps, or methodology:\n\n`;
    corrections.procedural.forEach((correction, i) => {
      md += `${i + 1}. ${correction.issue}\n`;
      md += `   *Context*: ${correction.context}\n\n`;
    });
  }

  // Formatting corrections
  if (corrections.formatting.length > 0) {
    md += `## Formatting Corrections\n\nThese corrections relate to structure, layout, or presentation:\n\n`;
    corrections.formatting.forEach((correction, i) => {
      md += `${i + 1}. ${correction.issue}\n`;
      md += `   *Context*: ${correction.context}\n\n`;
    });
  }

  md += `\n*Last updated: ${new Date(generatedAt).toLocaleString()}*\n`;

  return md;
}

/**
 * Format summary/index as markdown
 */
function formatSummary(report) {
  const { agentType, generatedAt, stats, summary } = report;

  let md = `# Learning Summary: ${agentType}

**Last Updated**: ${new Date(generatedAt).toLocaleString()}

---

## Statistics

- **Total Feedback**: ${stats.totalFeedback || 0} responses
- **Positive Rate**: ${((stats.positiveRate || 0) * 100).toFixed(1)}%
- **Average Quality**: ${(stats.averageQuality || 0).toFixed(2)}
- **Total Messages**: ${stats.totalMessages || 0}

---

## Available Learning Files

`;

  if (summary.hasLearnings) {
    if (report.successPatterns.count > 0) {
      md += `### [learned-patterns.md](./learned-patterns.md)
- ${report.successPatterns.count} high-quality responses analyzed
- ${report.successPatterns.topThemes.length} key themes identified
- ${report.successPatterns.examples.length} detailed examples

`;
    }

    if (report.errorPatterns.count > 0) {
      md += `### [common-errors.md](./common-errors.md)
- ${report.errorPatterns.count} negative responses analyzed
- ${report.errorPatterns.commonErrors.length} error categories identified
- ${report.errorPatterns.examples.length} specific error examples

`;
    }

    if (report.corrections.count > 0) {
      md += `### [user-corrections.md](./user-corrections.md)
- ${report.corrections.count} user corrections documented
- ${report.corrections.factual.length} factual corrections
- ${report.corrections.procedural.length} procedural corrections
- ${report.corrections.formatting.length} formatting corrections

`;
    }
  } else {
    md += `*No learning data available yet. As users provide feedback, patterns will be automatically extracted and documented here.*\n\n`;
  }

  md += `---

## How to Use

These files are automatically generated from user feedback to help improve agent performance:

1. **Before starting a task**, review learned-patterns.md for successful approaches
2. **Avoid mistakes** documented in common-errors.md
3. **Apply corrections** from user-corrections.md to prevent repeat issues

Files are updated automatically as new feedback is collected.

*This is an automatically generated file. Do not edit manually.*
`;

  return md;
}
