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
    if (request.params.name === "gdrive_search") {
        const userQuery = request.params.arguments?.query;
        const escapedQuery = userQuery.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
        const formattedQuery = `fullText contains '${escapedQuery}'`;
        const res = await drive.files.list({
            q: formattedQuery,
            pageSize: 10,
            fields: "files(id, name, mimeType, modifiedTime, size)",
        });
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
    else if (request.params.name === "gdrive_read_file") {
        const fileId = request.params.arguments?.file_id;
        if (!fileId) {
            throw new McpError(ErrorCode.InvalidParams, "File ID is required");
        }
        try {
            const result = await readFileContent(fileId);
            return {
                content: [
                    {
                        type: "text",
                        text: result.content,
                    },
                ],
                isError: false,
            };
        }
        catch (error) {
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
    throw new Error("Tool not found");
});
const credentialsPath = process.env.MCP_GDRIVE_CREDENTIALS || path.join(process.cwd(), "credentials", ".gdrive-server-credentials.json");
async function authenticateAndSaveCredentials() {
    const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || path.join(process.cwd(), "credentials", "gcp-oauth.keys.json");
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
    if (!fs.existsSync(credentialsPath)) {
        console.error("Credentials not found. Please run with 'auth' argument first.");
        process.exit(1);
    }
    // Load OAuth client credentials (client_id, client_secret) for token refresh
    const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || path.join(process.cwd(), "credentials", "gcp-oauth.keys.json");
    const oauthKeys = JSON.parse(fs.readFileSync(keyPath, "utf-8"));
    const { client_id, client_secret, redirect_uris } = oauthKeys.installed || oauthKeys.web;
    // Load user credentials (access_token, refresh_token)
    const credentials = JSON.parse(fs.readFileSync(credentialsPath, "utf-8"));
    // Initialize OAuth2 client with client credentials so it can refresh tokens
    const auth = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
    auth.setCredentials(credentials);
    // Set up token refresh handler
    auth.on('tokens', (tokens) => {
        console.error('🔄 Token refreshed');
        if (tokens.refresh_token) {
            // If we got a new refresh_token, save it
            credentials.refresh_token = tokens.refresh_token;
        }
        // Update access_token and expiry
        credentials.access_token = tokens.access_token;
        credentials.expiry_date = tokens.expiry_date;
        // Save updated credentials to file
        try {
            fs.writeFileSync(credentialsPath, JSON.stringify(credentials, null, 2));
            console.error('✅ Updated credentials saved');
        }
        catch (error) {
            console.error('⚠️  Failed to save updated credentials:', error.message);
        }
    });
    google.options({ auth });
    const transport = new StdioServerTransport();
    await server.connect(transport);
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
