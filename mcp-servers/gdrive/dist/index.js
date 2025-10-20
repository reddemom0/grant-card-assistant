#!/usr/bin/env node
import { authenticate } from "@google-cloud/local-auth";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListResourcesRequestSchema, ListToolsRequestSchema, ReadResourceRequestSchema, ErrorCode, McpError, } from "@modelcontextprotocol/sdk/types.js";
import fs from "fs";
import { google } from "googleapis";
import path from "path";
const drive = google.drive("v3");
const server = new Server({
    name: "gdrive",
    version: "0.1.0",
}, {
    capabilities: {
        resources: {},
        tools: {},
    },
});
server.setRequestHandler(ListResourcesRequestSchema, async (request) => {
    const pageSize = 10;
    const params = {
        pageSize,
        fields: "nextPageToken, files(id, name, mimeType)",
    };
    if (request.params?.cursor) {
        params.pageToken = request.params.cursor;
    }
    const res = await drive.files.list(params);
    const files = res.data.files;
    return {
        resources: files.map((file) => ({
            uri: `gdrive:///${file.id}`,
            mimeType: file.mimeType,
            name: file.name,
        })),
        nextCursor: res.data.nextPageToken,
    };
});
async function readFileContent(fileId) {
    // First get file metadata to check mime type
    const file = await drive.files.get({
        fileId,
        fields: "mimeType",
    });
    // For Google Docs/Sheets/etc we need to export
    if (file.data.mimeType?.startsWith("application/vnd.google-apps")) {
        let exportMimeType;
        switch (file.data.mimeType) {
            case "application/vnd.google-apps.document":
                exportMimeType = "text/markdown";
                break;
            case "application/vnd.google-apps.spreadsheet":
                exportMimeType = "text/csv";
                break;
            case "application/vnd.google-apps.presentation":
                exportMimeType = "text/plain";
                break;
            case "application/vnd.google-apps.drawing":
                exportMimeType = "image/png";
                break;
            default:
                exportMimeType = "text/plain";
        }
        const res = await drive.files.export({ fileId, mimeType: exportMimeType }, { responseType: "text" });
        return {
            mimeType: exportMimeType,
            content: res.data,
        };
    }
    // For regular files download content
    const res = await drive.files.get({ fileId, alt: "media" }, { responseType: "arraybuffer" });
    const mimeType = file.data.mimeType || "application/octet-stream";
    if (mimeType.startsWith("text/") || mimeType === "application/json") {
        return {
            mimeType: mimeType,
            content: Buffer.from(res.data).toString("utf-8"),
        };
    }
    else {
        return {
            mimeType: mimeType,
            content: Buffer.from(res.data).toString("base64"),
        };
    }
}
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const fileId = request.params.uri.replace("gdrive:///", "");
    const result = await readFileContent(fileId);
    return {
        contents: [
            {
                uri: request.params.uri,
                mimeType: result.mimeType,
                text: result.content,
            },
        ],
    };
});
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: "gdrive_search",
                description: "Search for files specifically in your Google Drive account (don't use exa nor brave to search for files)",
                inputSchema: {
                    type: "object",
                    properties: {
                        query: {
                            type: "string",
                            description: "Search query",
                        },
                    },
                    required: ["query"],
                },
            },
            {
                name: "gdrive_read_file",
                description: "Read a file from Google Drive using its Google Drive file ID (don't use exa nor brave to read files)",
                inputSchema: {
                    type: "object",
                    properties: {
                        file_id: {
                            type: "string",
                            description: "The ID of the file to read",
                        },
                    },
                    required: ["file_id"],
                },
            },
        ],
    };
});
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    console.error(`🔧 [MCP] Tool call received: ${request.params.name}`);
    console.error(`   Arguments:`, JSON.stringify(request.params.arguments));
    if (request.params.name === "gdrive_search") {
        try {
            const userQuery = request.params.arguments?.query;
            console.error(`🔍 [MCP] Searching Google Drive for: "${userQuery}"`);
            const escapedQuery = userQuery.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
            const formattedQuery = `fullText contains '${escapedQuery}'`;
            console.error(`   Formatted query: ${formattedQuery}`);
            const res = await drive.files.list({
                q: formattedQuery,
                pageSize: 10,
                fields: "files(id, name, mimeType, modifiedTime, size)",
            });
            console.error(`✅ [MCP] Search successful! Found ${res.data.files?.length ?? 0} files`);
            const fileList = res.data.files
                ?.map((file) => `${file.name} (${file.mimeType}) - ID: ${file.id}`)
                .join("\n");
            return {
                content: [
                    {
                        type: "text",
                        text: `Found ${res.data.files?.length ?? 0} files:\n${fileList}`,
                    },
                ],
                isError: false,
            };
        }
        catch (error) {
            console.error(`❌ [MCP] Search failed:`, error.message);
            console.error(`   Error code:`, error.code);
            console.error(`   Error details:`, error);
            return {
                content: [
                    {
                        type: "text",
                        text: `Error searching Google Drive: ${error.message}`,
                    },
                ],
                isError: true,
            };
        }
    }
    else if (request.params.name === "gdrive_read_file") {
        const fileId = request.params.arguments?.file_id;
        if (!fileId) {
            console.error(`❌ [MCP] Read file failed: No file ID provided`);
            throw new McpError(ErrorCode.InvalidParams, "File ID is required");
        }
        try {
            console.error(`📖 [MCP] Reading file: ${fileId}`);
            const result = await readFileContent(fileId);
            const contentStr = String(result.content);
            console.error(`✅ [MCP] File read successful! Size: ${contentStr.length} chars`);
            return {
                content: [
                    {
                        type: "text",
                        text: contentStr,
                    },
                ],
                isError: false,
            };
        }
        catch (error) {
            console.error(`❌ [MCP] Read file failed:`, error.message);
            console.error(`   Error code:`, error.code);
            console.error(`   Error details:`, error);
            return {
                content: [
                    {
                        type: "text",
                        text: `Error reading file: ${error.message}`,
                    },
                ],
                isError: true,
            };
        }
    }
    console.error(`❌ [MCP] Unknown tool: ${request.params.name}`);
    throw new Error("Tool not found");
});
// Resolve credentials path - can be absolute or relative
// If relative, resolve relative to this script's directory, not cwd
const credentialsPath = process.env.MCP_GDRIVE_CREDENTIALS
    ? (path.isAbsolute(process.env.MCP_GDRIVE_CREDENTIALS)
        ? process.env.MCP_GDRIVE_CREDENTIALS
        : path.resolve(process.cwd(), process.env.MCP_GDRIVE_CREDENTIALS))
    : path.join(path.dirname(new URL(import.meta.url).pathname), "credentials", ".gdrive-server-credentials.json");
async function authenticateAndSaveCredentials() {
    const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
        ? (path.isAbsolute(process.env.GOOGLE_APPLICATION_CREDENTIALS)
            ? process.env.GOOGLE_APPLICATION_CREDENTIALS
            : path.resolve(process.cwd(), process.env.GOOGLE_APPLICATION_CREDENTIALS))
        : path.join(path.dirname(new URL(import.meta.url).pathname), "credentials", "gcp-oauth.keys.json");
    console.log("Looking for keys at:", keyPath);
    console.log("Will save credentials to:", credentialsPath);
    const auth = await authenticate({
        keyfilePath: keyPath,
        scopes: ["https://www.googleapis.com/auth/drive.readonly"],
    });
    fs.writeFileSync(credentialsPath, JSON.stringify(auth.credentials));
    console.log("Credentials saved. You can now run the server.");
}
async function loadCredentialsAndRunServer() {
    try {
        console.error('🚀 [MCP] Starting Google Drive MCP server...');
        console.error('🔍 [MCP] Environment variables:');
        console.error(`   GOOGLE_APPLICATION_CREDENTIALS=${process.env.GOOGLE_APPLICATION_CREDENTIALS}`);
        console.error(`   MCP_GDRIVE_CREDENTIALS=${process.env.MCP_GDRIVE_CREDENTIALS}`);
        console.error(`   NODE_ENV=${process.env.NODE_ENV}`);
        console.error(`   CWD=${process.cwd()}`);
        console.error(`🔍 [MCP] Resolved credentials path: ${credentialsPath}`);
        console.error(`🔍 [MCP] Credentials file exists: ${fs.existsSync(credentialsPath)}`);
        if (!fs.existsSync(credentialsPath)) {
            console.error(`❌ [MCP] Credentials not found at: ${credentialsPath}`);
            console.error("   Please run with 'auth' argument first.");
            process.exit(1);
        }
        // Load OAuth client credentials (client_id, client_secret) for token refresh
        const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
            ? (path.isAbsolute(process.env.GOOGLE_APPLICATION_CREDENTIALS)
                ? process.env.GOOGLE_APPLICATION_CREDENTIALS
                : path.resolve(process.cwd(), process.env.GOOGLE_APPLICATION_CREDENTIALS))
            : path.join(path.dirname(new URL(import.meta.url).pathname), "credentials", "gcp-oauth.keys.json");
        console.error(`🔍 [MCP] Resolved OAuth keys path: ${keyPath}`);
        console.error(`🔍 [MCP] OAuth keys file exists: ${fs.existsSync(keyPath)}`);
        if (!fs.existsSync(keyPath)) {
            console.error(`❌ [MCP] OAuth keys not found at: ${keyPath}`);
            process.exit(1);
        }
        console.error('📖 [MCP] Reading OAuth keys...');
        const oauthKeys = JSON.parse(fs.readFileSync(keyPath, "utf-8"));
        const { client_id, client_secret, redirect_uris } = oauthKeys.installed || oauthKeys.web;
        console.error(`✅ [MCP] OAuth keys loaded (client_id: ${client_id?.substring(0, 20)}...)`);
        console.error('📖 [MCP] Reading user credentials...');
        const credentials = JSON.parse(fs.readFileSync(credentialsPath, "utf-8"));
        console.error(`✅ [MCP] User credentials loaded (has access_token: ${!!credentials.access_token})`);
        console.error(`   Token expiry: ${credentials.expiry_date ? new Date(credentials.expiry_date).toISOString() : 'unknown'}`);
        // Initialize OAuth2 client with client credentials so it can refresh tokens
        console.error('🔐 [MCP] Initializing OAuth2 client...');
        const auth = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
        auth.setCredentials(credentials);
        console.error('✅ [MCP] OAuth2 client initialized');
        // Set up token refresh handler
        auth.on('tokens', (tokens) => {
            console.error('🔄 [MCP] Token refresh event received');
            if (tokens.refresh_token) {
                console.error('   New refresh_token received');
                credentials.refresh_token = tokens.refresh_token;
            }
            // Update access_token and expiry
            credentials.access_token = tokens.access_token;
            credentials.expiry_date = tokens.expiry_date;
            console.error(`   New token expiry: ${tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : 'unknown'}`);
            // Save updated credentials to file
            try {
                fs.writeFileSync(credentialsPath, JSON.stringify(credentials, null, 2));
                console.error('✅ [MCP] Updated credentials saved');
            }
            catch (error) {
                console.error('⚠️  [MCP] Failed to save updated credentials:', error.message);
            }
        });
        google.options({ auth });
        console.error('✅ [MCP] Google API client configured');
        console.error('🧪 [MCP] Testing Google Drive API access...');
        try {
            const testRes = await drive.files.list({
                pageSize: 1,
                fields: "files(id, name)",
            });
            console.error(`✅ [MCP] Google Drive API test successful! Found ${testRes.data.files?.length || 0} files`);
            if (testRes.data.files && testRes.data.files.length > 0) {
                console.error(`   Sample file: ${testRes.data.files[0].name}`);
            }
        }
        catch (error) {
            console.error(`❌ [MCP] Google Drive API test FAILED:`, error.message);
            console.error(`   Error code: ${error.code}`);
            console.error(`   Error details:`, error);
            throw error;
        }
        console.error('🔌 [MCP] Connecting to STDIO transport...');
        const transport = new StdioServerTransport();
        await server.connect(transport);
        console.error('✅ [MCP] Server connected and ready!');
    }
    catch (error) {
        console.error('❌ [MCP] Fatal error during initialization:', error.message);
        console.error('   Stack trace:', error.stack);
        throw error;
    }
}
if (process.argv[2] === "auth") {
    authenticateAndSaveCredentials().catch(console.error);
}
else {
    loadCredentialsAndRunServer().catch((error) => {
        process.stderr.write(`Error: ${error}\n`);
        process.exit(1);
    });
}
