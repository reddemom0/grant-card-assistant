/**
 * Tool Registry and Executor
 * Central system for managing and executing tools for Claude API
 */

import { readFile } from './read.js';
import { writeFile } from './write.js';
import { editFile } from './edit.js';
import { executeBash } from './bash.js';
import { globFiles } from './glob.js';
import { grepContent } from './grep.js';
import { webSearch } from './web-search.js';
import { webFetch } from './web-fetch.js';
import { todoWrite } from './todo-write.js';
import { hubspotQuery } from './hubspot.js';
import { createAdvancedBudgetTool } from './google-sheets-advanced.js';
import { createAdvancedDocumentTool } from './google-docs-advanced.js';

/**
 * Tool Definitions for Claude Function Calling
 * Each tool has: name, description, input_schema, and execute function
 */
export const TOOLS = {
  read_file: {
    name: 'read_file',
    description: 'Read contents of a file from the filesystem. Returns file content with line numbers. Supports reading full files or specific line ranges.',
    input_schema: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Absolute path to the file to read'
        },
        offset: {
          type: 'number',
          description: 'Optional line number to start reading from (1-indexed)'
        },
        limit: {
          type: 'number',
          description: 'Optional number of lines to read'
        }
      },
      required: ['file_path']
    },
    execute: readFile
  },

  write_file: {
    name: 'write_file',
    description: 'Write content to a new file or overwrite an existing file. Creates directories if they don\'t exist.',
    input_schema: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Absolute path where the file should be written'
        },
        content: {
          type: 'string',
          description: 'Content to write to the file'
        }
      },
      required: ['file_path', 'content']
    },
    execute: writeFile
  },

  edit_file: {
    name: 'edit_file',
    description: 'Edit a file by replacing exact text. The old_string must match exactly (including whitespace and indentation). If replace_all is true, replaces all occurrences; otherwise only replaces if match is unique.',
    input_schema: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Absolute path to the file to edit'
        },
        old_string: {
          type: 'string',
          description: 'Exact text to find and replace (must match exactly including whitespace)'
        },
        new_string: {
          type: 'string',
          description: 'New text to replace old_string with'
        },
        replace_all: {
          type: 'boolean',
          description: 'If true, replace all occurrences. If false, only replace if match is unique. Default: false'
        }
      },
      required: ['file_path', 'old_string', 'new_string']
    },
    execute: editFile
  },

  bash: {
    name: 'bash',
    description: 'Execute a bash command and return the output. Use for git, npm, testing, building, etc. Commands timeout after 2 minutes. Working directory is /app on Railway.',
    input_schema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The bash command to execute'
        },
        timeout: {
          type: 'number',
          description: 'Optional timeout in milliseconds (max 600000 = 10 minutes). Default: 120000 (2 minutes)'
        }
      },
      required: ['command']
    },
    execute: executeBash
  },

  glob: {
    name: 'glob',
    description: 'Find files matching a glob pattern. Supports patterns like "**/*.js", "src/**/*.ts", etc. Returns sorted list of file paths.',
    input_schema: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Glob pattern to match files (e.g., "**/*.js", "src/**/*.md")'
        },
        path: {
          type: 'string',
          description: 'Optional directory to search in. Defaults to current working directory.'
        }
      },
      required: ['pattern']
    },
    execute: globFiles
  },

  grep: {
    name: 'grep',
    description: 'Search for text patterns in files using regex. Returns matching lines with context. Output modes: content (shows matching lines), files_with_matches (shows only file paths), count (shows match counts).',
    input_schema: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Regular expression pattern to search for'
        },
        path: {
          type: 'string',
          description: 'File or directory to search in. Defaults to current directory.'
        },
        output_mode: {
          type: 'string',
          enum: ['content', 'files_with_matches', 'count'],
          description: 'Output format: content (matching lines), files_with_matches (file paths only), count (match counts). Default: files_with_matches'
        },
        case_insensitive: {
          type: 'boolean',
          description: 'Perform case-insensitive search. Default: false'
        },
        context_before: {
          type: 'number',
          description: 'Number of lines to show before each match (requires output_mode: content)'
        },
        context_after: {
          type: 'number',
          description: 'Number of lines to show after each match (requires output_mode: content)'
        }
      },
      required: ['pattern']
    },
    execute: grepContent
  },

  web_search: {
    name: 'web_search',
    description: 'Search the web for current information. Returns search results with titles, URLs, and snippets. Useful for researching grant programs, finding documentation, or getting current information.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query'
        },
        num_results: {
          type: 'number',
          description: 'Number of results to return (1-10). Default: 5'
        }
      },
      required: ['query']
    },
    execute: webSearch
  },

  web_fetch: {
    name: 'web_fetch',
    description: 'Fetch and parse content from a URL. Converts HTML to readable text, extracts main content, and returns it. Useful for reading documentation, grant program pages, or any web content.',
    input_schema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'URL to fetch (must be a valid http:// or https:// URL)'
        }
      },
      required: ['url']
    },
    execute: webFetch
  },

  todo_write: {
    name: 'todo_write',
    description: 'Manage a task list for tracking progress on multi-step workflows. Tasks have status: pending, in_progress, or completed. Use this to organize complex tasks and show progress to the user.',
    input_schema: {
      type: 'object',
      properties: {
        todos: {
          type: 'array',
          description: 'Array of todo items',
          items: {
            type: 'object',
            properties: {
              content: {
                type: 'string',
                description: 'Task description (imperative form, e.g., "Run tests")'
              },
              status: {
                type: 'string',
                enum: ['pending', 'in_progress', 'completed'],
                description: 'Task status'
              },
              activeForm: {
                type: 'string',
                description: 'Present continuous form for display (e.g., "Running tests")'
              }
            },
            required: ['content', 'status', 'activeForm']
          }
        }
      },
      required: ['todos']
    },
    execute: todoWrite
  },

  hubspot_query: {
    name: 'hubspot_query',
    description: 'Query HubSpot CRM for live customer data. Can search contacts, get deal information, retrieve company details, and view recent activities. Useful for personalizing grant applications based on real customer data.',
    input_schema: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['search_contacts', 'get_deal', 'get_company', 'get_activities'],
          description: 'Operation to perform'
        },
        query: {
          type: 'string',
          description: 'Search query or ID depending on operation'
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results to return. Default: 10'
        }
      },
      required: ['operation', 'query']
    },
    execute: hubspotQuery
  },

  create_advanced_budget: {
    name: 'create_advanced_budget',
    description: 'Create an advanced, program-specific budget spreadsheet in Google Sheets. Supports pre-built templates for CanExport SMEs, RTRI, and BCAFE programs with multiple sheets, detailed categories, instructions, and reference sheets. Can also dynamically generate budgets for new programs based on program guidelines.',
    input_schema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Title for the budget spreadsheet (e.g., "CanExport SMEs Budget Template")'
        },
        grantProgram: {
          type: 'string',
          description: 'Grant program name (e.g., "CanExport SMEs", "RTRI", "BCAFE"). Used to select template or generate dynamic budget.'
        },
        budgetData: {
          type: 'object',
          description: 'Optional: Pre-filled budget data. For dynamic budgets, should include: { programName, eligibleCategories: [{name, description, items: []}], ineligibleExpenses: [], instructions: "" }',
        },
        parentFolderId: {
          type: 'string',
          description: 'Optional: Google Drive folder ID to create the sheet in. If not provided, creates in root.'
        }
      },
      required: ['title', 'grantProgram']
    },
    execute: createAdvancedBudgetTool
  },

  create_advanced_document: {
    name: 'create_advanced_document',
    description: 'Create a properly formatted Google Doc from template configuration using Google Docs API v1 (NOT markdown). Supports Readiness Assessments, Interview Questions, and Evaluation Rubrics for hiring, market-expansion, training, rd, loan, and investment grant types. Documents include branded formatting, structured tables, callouts, and placeholders for client data.',
    input_schema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Document title (e.g., "CanExport Readiness Assessment - Acme Corp")'
        },
        grantType: {
          type: 'string',
          enum: ['hiring', 'market-expansion', 'training', 'rd', 'loan', 'investment'],
          description: 'Type of grant program'
        },
        documentType: {
          type: 'string',
          enum: ['readiness-assessment', 'interview-questions', 'evaluation-rubric'],
          description: 'Type of document to create'
        },
        data: {
          type: 'object',
          description: 'Optional: Data to populate template placeholders (e.g., { client_name: "Acme Corp", program_name: "CanExport SMEs" }). Each template has default placeholders that can be overridden.'
        },
        parentFolderId: {
          type: 'string',
          description: 'Optional: Google Drive folder ID to create the document in. If not provided, creates in user\'s root Drive.'
        }
      },
      required: ['title', 'grantType', 'documentType']
    },
    execute: createAdvancedDocumentTool
  }
};

/**
 * Get tool definitions for Claude API
 * Filters tools based on allowed tool list
 * @param {string[]} allowedTools - Array of tool names to include (e.g., ['read_file', 'write_file'])
 * @returns {array} Array of tool definitions for Claude API
 */
export function getToolDefinitions(allowedTools) {
  if (!allowedTools || allowedTools.length === 0) {
    // Return all tools if no filter specified
    return Object.values(TOOLS).map(tool => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.input_schema
    }));
  }

  // Map friendly names to tool names
  const nameMapping = {
    'Read': 'read_file',
    'Write': 'write_file',
    'Edit': 'edit_file',
    'Bash': 'bash',
    'Glob': 'glob',
    'Grep': 'grep',
    'WebSearch': 'web_search',
    'WebFetch': 'web_fetch',
    'TodoWrite': 'todo_write',
    'HubSpot': 'hubspot_query',
    'CreateAdvancedBudget': 'create_advanced_budget',
    'create_advanced_budget': 'create_advanced_budget',
    'CreateAdvancedDocument': 'create_advanced_document',
    'create_advanced_document': 'create_advanced_document'
  };

  // Filter tools based on allowed list
  const filteredTools = allowedTools
    .map(friendlyName => nameMapping[friendlyName] || friendlyName)
    .filter(toolName => TOOLS[toolName])
    .map(toolName => ({
      name: TOOLS[toolName].name,
      description: TOOLS[toolName].description,
      input_schema: TOOLS[toolName].input_schema
    }));

  return filteredTools;
}

/**
 * Execute a tool based on Claude's function call
 * @param {string} toolName - Name of the tool to execute
 * @param {object} toolInput - Input parameters from Claude
 * @param {object} context - Additional context (conversationId, userId, etc.)
 * @returns {Promise<object>} Tool execution result
 */
export async function executeTool(toolName, toolInput, context = {}) {
  const tool = TOOLS[toolName];

  if (!tool) {
    return {
      success: false,
      error: `Unknown tool: ${toolName}`
    };
  }

  try {
    console.log(`🔧 Executing tool: ${toolName}`);
    console.log(`📥 Input:`, JSON.stringify(toolInput, null, 2));

    const result = await tool.execute(toolInput, context);

    console.log(`✅ Tool execution complete: ${toolName}`);
    return {
      success: true,
      result
    };
  } catch (error) {
    console.error(`❌ Tool execution error (${toolName}):`, error);
    return {
      success: false,
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    };
  }
}

export default {
  TOOLS,
  getToolDefinitions,
  executeTool
};
