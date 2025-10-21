# Frontend Migration Guide

## Overview

This guide shows how to update existing HTML pages to use the new direct Claude API with SSE streaming.

**Status**: Backend deployed ✅ | Frontend ready to migrate ⏳

---

## What Changed

### Old API (Agent SDK):
```javascript
// POST /api/process-grant/stream
// FormData with files
// Custom SSE format: data: {chunk: "text"}
```

### New API (Direct Claude):
```javascript
// POST /api/chat
// JSON body
// Standard SSE format with multiple event types
```

---

## Migration Steps

### Step 1: Add ChatClient Library

Add to `<head>` section of each HTML page:

```html
<!-- Add before closing </head> -->
<script src="/public/js/chat-client.js"></script>
```

### Step 2: Update JavaScript Constants

**Old:**
```javascript
const API_BASE = '';  // or window.location.origin
```

**New:**
```javascript
const API_BASE = '';  // Keep the same
const chatClient = new ChatClient(API_BASE);
```

### Step 3: Update sendMessage Function

**Old Code** (grant-cards.html line ~2236):
```javascript
async function sendMessage() {
    // ... setup code ...

    const formData = new FormData();
    formData.append('message', message);
    formData.append('task', detectedTask);
    formData.append('conversationId', conversationId);
    formData.append('agentType', 'grant-cards');

    const response = await fetch(`${API_BASE}/api/process-grant/stream`, {
        method: 'POST',
        body: formData
    });

    const streamingMessageDiv = addStreamingMessage('assistant');
    await handleStreamingResponse(response, streamingMessageDiv);
}
```

**New Code:**
```javascript
async function sendMessage() {
    // ... same setup code ...

    // Create streaming message div
    const streamingMessageDiv = addStreamingMessage('assistant');
    let fullContent = '';

    // Setup callbacks
    chatClient.onTextDelta = (text) => {
        fullContent += text;
        updateStreamingMessage(streamingMessageDiv, fullContent, false);
    };

    chatClient.onToolUse = (toolName, input) => {
        console.log(`🔧 Using tool: ${toolName}`, input);
        // Optionally show tool use in UI
    };

    chatClient.onComplete = () => {
        updateStreamingMessage(streamingMessageDiv, fullContent, true);
        hideStopButton();
    };

    chatClient.onError = (error) => {
        console.error('Stream error:', error);
        updateStreamingMessage(streamingMessageDiv, `Error: ${error.message}`, true);
        hideStopButton();
    };

    chatClient.onConnected = (event) => {
        // Update conversationId if it was newly created
        if (event.conversationId && !conversationId) {
            conversationId = event.conversationId;
        }
    };

    // Send message
    try {
        await chatClient.sendMessage({
            message: message,
            agentType: 'grant-card-generator',  // Change per page
            conversationId: conversationId,
            userId: getCurrentUserId(),  // From your auth system
            attachments: []  // TODO: Convert file uploads
        });

        // Redirect to permanent URL after first message
        if (isFirstMessage) {
            const currentPath = window.location.pathname;
            if (currentPath.endsWith('/new')) {
                window.history.replaceState({}, '', `/grant-cards/chat/${conversationId}`);
                isFirstMessage = false;
                loadConversationsList();
            }
        }
    } catch (error) {
        console.error('Send message error:', error);
        addMessage('assistant', `Error: ${error.message}`, false);
    }
}
```

### Step 4: Remove Old handleStreamingResponse Function

**Delete this function** (lines ~1680-1750):
```javascript
async function handleStreamingResponse(response, messageDiv) {
    // ... entire function can be removed ...
    // Logic is now in ChatClient
}
```

### Step 5: Update Agent Type Per Page

For each HTML page, change the `agentType` parameter:

- `grant-cards.html` → `'grant-card-generator'`
- `etg-agent.html` → `'etg-writer'`
- `bcafe-agent.html` → `'bcafe-writer'`
- `canexport-claims.html` → `'canexport-claims'`

---

## File Upload Handling

### Converting Files to Base64

The new API expects base64-encoded attachments:

```javascript
async function prepareAttachments(files) {
    const attachments = [];

    for (const file of files) {
        const base64 = await fileToBase64(file);

        attachments.push({
            type: file.type.startsWith('image/') ? 'image' : 'pdf',
            mimeType: file.type,
            data: base64
        });
    }

    return attachments;
}

function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            // Remove data:xxx;base64, prefix
            const base64 = reader.result.split(',')[1];
            resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}
```

Then use in sendMessage:

```javascript
const attachments = await prepareAttachments(uploadedFiles);

await chatClient.sendMessage({
    message: message,
    agentType: 'grant-card-generator',
    conversationId: conversationId,
    userId: getCurrentUserId(),
    attachments: attachments  // ← Add attachments
});
```

---

## Conversation Loading (Sidebar)

### Update API Endpoints

**Old:**
```javascript
const response = await fetch(`${API_BASE}/api/conversations?agent_type=grant-cards`);
```

**New:**
```javascript
const response = await fetch(`${API_BASE}/api/conversations?userId=${userId}&agentType=grant-card-generator`);
```

**Old:**
```javascript
const response = await fetch(`${API_BASE}/api/conversation/${conversationId}`);
```

**New:**
```javascript
const response = await fetch(`${API_BASE}/api/conversations/${conversationId}`);
```

---

## Optional Features

### 1. Show Token Usage

Add to `chatClient.onUsage`:

```javascript
chatClient.onUsage = (usage) => {
    console.log('📊 Tokens:', {
        input: usage.input_tokens,
        output: usage.output_tokens,
        cached: usage.cache_read_input_tokens
    });

    // Optional: Show in UI
    showTokenUsage(usage);
};
```

### 2. Show Tool Use

Add visual indicator when tools are used:

```javascript
chatClient.onToolUse = (toolName, input) => {
    addToolUseIndicator(toolName, input);
};

function addToolUseIndicator(toolName, input) {
    const indicator = document.createElement('div');
    indicator.className = 'tool-use-indicator';
    indicator.innerHTML = `
        <span class="tool-icon">🔧</span>
        <span class="tool-name">${toolName}</span>
    `;
    chatContainer.appendChild(indicator);
}
```

### 3. Show Thinking Process

If you want to show Claude's thinking:

```javascript
chatClient.onThinkingDelta = (thinking) => {
    updateThinkingDisplay(thinking);
};
```

---

## Complete Integration Example

Here's a minimal complete example:

```html
<!DOCTYPE html>
<html>
<head>
    <title>Grant Card Assistant</title>
    <!-- ... existing styles ... -->
    <script src="/public/js/chat-client.js"></script>
</head>
<body>
    <!-- ... existing HTML ... -->

    <script>
        // Initialize
        const API_BASE = '';
        const chatClient = new ChatClient(API_BASE);
        let conversationId = null;
        let fullContent = '';

        // Send message function
        async function sendMessage() {
            const message = messageInput.value.trim();
            if (!message) return;

            // Add user message to UI
            addMessage('user', message);
            messageInput.value = '';

            // Create streaming message
            const streamingDiv = addStreamingMessage('assistant');
            fullContent = '';

            // Setup handlers
            chatClient.onTextDelta = (text) => {
                fullContent += text;
                updateStreamingMessage(streamingDiv, fullContent, false);
            };

            chatClient.onComplete = () => {
                updateStreamingMessage(streamingDiv, fullContent, true);
            };

            chatClient.onError = (error) => {
                addMessage('assistant', `Error: ${error.message}`, true);
            };

            chatClient.onConnected = (event) => {
                if (event.conversationId) {
                    conversationId = event.conversationId;
                }
            };

            // Send
            try {
                await chatClient.sendMessage({
                    message,
                    agentType: 'grant-card-generator',
                    conversationId,
                    userId: 'current-user-id'
                });
            } catch (error) {
                console.error(error);
            }
        }

        // Helper functions (keep your existing ones)
        function addMessage(role, content) {
            // ... your existing code ...
        }

        function addStreamingMessage(role) {
            // ... your existing code ...
        }

        function updateStreamingMessage(div, content, isComplete) {
            // ... your existing code ...
        }
    </script>
</body>
</html>
```

---

## Testing Checklist

After migrating each page:

- [ ] Page loads without errors
- [ ] Can send a message
- [ ] Text streams in real-time
- [ ] Conversation ID is created
- [ ] Messages are saved (refresh page)
- [ ] Tool use shows in console
- [ ] Error handling works
- [ ] File uploads work (if applicable)
- [ ] Sidebar shows conversations
- [ ] Can load previous conversation

---

## Migration Order (Recommended)

1. **grant-cards.html** (most complex - do first)
2. **etg-agent.html**
3. **bcafe-agent.html**
4. **canexport-claims.html**
5. **index.html** (dashboard - minimal changes)

---

## Rollback Plan

If issues occur:

1. Keep old Agent SDK endpoint running (`POST /api/agent`)
2. Frontend can fallback to old endpoint
3. Add feature flag to switch between APIs

```javascript
const USE_NEW_API = true;  // Toggle for testing

if (USE_NEW_API) {
    // Use ChatClient
} else {
    // Use old fetch approach
}
```

---

## Next Steps

1. ✅ Chat client library created (`public/js/chat-client.js`)
2. ⏳ Migrate `grant-cards.html` first (test thoroughly)
3. ⏳ Migrate other agent pages
4. ⏳ Test with real users
5. ⏳ Remove old API endpoint once stable

---

## Getting Help

**Test the backend first:**
```bash
curl -X POST https://your-app.railway.app/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "agentType": "grant-card-generator",
    "message": "Hello",
    "userId": "test"
  }'
```

**Check browser console:**
- Look for SSE connection errors
- Check network tab for `/api/chat` request
- Verify event types are being received

**Common Issues:**
- CORS errors → Check Railway CORS settings
- 404 on `/api/chat` → Backend not deployed
- No streaming → Check SSE headers
- Conversation not saving → Check userId/conversationId

---

**Ready to migrate?** Start with `grant-cards.html` and test thoroughly before moving to other pages! 🚀
