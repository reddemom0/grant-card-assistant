/**
 * AgentInterface - Unified Frontend for All Agents
 *
 * Handles all common UI functionality:
 * - Chat interface (messages, streaming, file uploads)
 * - Conversation management (sidebar, history, switching)
 * - User authentication display
 * - URL detection and handling
 *
 * Agent-specific behavior is controlled via configuration object.
 */

class AgentInterface {
    constructor(config) {
        // Configuration
        this.config = {
            agentType: config.agentType,
            displayName: config.displayName || 'AI Assistant',
            placeholder: config.placeholder || 'Type a message...',
            welcomeTitle: config.welcomeTitle || config.displayName,
            welcomeSubtitle: config.welcomeSubtitle || '',
            quickActions: config.quickActions || [],
            enableURLDetection: config.enableURLDetection !== false, // Default true
            enableFileUploads: config.enableFileUploads !== false,   // Default true
            enableTaskSelection: config.enableTaskSelection || false,
            maxFileSize: config.maxFileSize || 10, // MB
            apiBase: window.location.hostname === 'localhost' ? 'http://localhost:3001' : ''
        };

        // State
        this.conversationId = null;
        this.isLoading = false;
        this.uploadedFiles = [];
        this.selectedTask = '';
        this.currentAbortController = null;
        this.isFirstMessage = true;
        this.hasStartedConversation = false;

        // Streaming state
        this.streamingMessageDiv = null;
        this.streamingContent = '';
        this.streamingThinkingDiv = null;
        this.streamingThinkingContent = '';

        // Initialize ChatClient
        this.chatClient = new ChatClient(this.config.apiBase);

        // Bind methods to preserve 'this' context
        this.sendMessage = this.sendMessage.bind(this);
        this.toggleSidebar = this.toggleSidebar.bind(this);
        this.toggleUserDropdown = this.toggleUserDropdown.bind(this);
    }

    /**
     * Initialize the agent interface
     * Call this after DOM is loaded
     */
    async initialize() {
        console.log(`🤖 Initializing ${this.config.displayName} interface...`);

        // Check authentication
        if (!this.checkAuth()) {
            return;
        }

        // Display user info
        const userInfo = this.getUserInfo();
        if (userInfo) {
            this.updateUserProfile(userInfo);
        }

        // Initialize conversation ID (async - load history if needed)
        await this.initializeConversationId();

        // Setup event listeners
        this.setupEventListeners();

        // Setup ChatClient callbacks
        this.setupChatClientCallbacks();

        // Load conversation list when sidebar opens
        // (Not automatically, only on user action)

        console.log(`✅ ${this.config.displayName} interface initialized`);
    }

    /**
     * Generate unique conversation ID
     */
    generateConversationId() {
        return crypto.randomUUID();
    }

    /**
     * Initialize conversation ID from URL or generate new
     */
    async initializeConversationId() {
        const path = window.location.pathname;

        // Check if URL contains /chat/{conversationId}
        if (path.includes('/chat/')) {
            const conversationId = path.split('/chat/')[1].split('?')[0];

            if (conversationId && conversationId !== 'new') {
                console.log('📖 Loading existing conversation:', conversationId);
                this.conversationId = conversationId;
                this.isFirstMessage = false;

                // Load conversation history from server
                const data = await this.loadConversationHistory();
                if (data && data.messages) {
                    console.log(`✅ Found ${data.messages.length} messages, restoring UI...`);
                    this.restoreConversationUI(data);
                }
                return;
            }
        }

        // New conversation
        console.log('✨ Starting new conversation');
        this.conversationId = null; // Will be created by backend
        this.isFirstMessage = true;
    }

    /**
     * Check authentication status
     */
    checkAuth() {
        const cookies = document.cookie.split(';');
        const authCookie = cookies.find(c => c.trim().startsWith('granted_session='));

        if (!authCookie) {
            console.log('❌ No authentication found, redirecting to login...');
            window.location.href = '/login';
            return false;
        }

        return true;
    }

    /**
     * Get user info from JWT token in cookie
     */
    getUserInfo() {
        const cookies = document.cookie.split(';');
        const authCookie = cookies.find(c => c.trim().startsWith('granted_session='));

        if (!authCookie) {
            console.log('No auth cookie found');
            return null;
        }

        const token = authCookie.split('=')[1];
        try {
            const payload = token.split('.')[1];
            // JWT uses base64url, convert to base64
            const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
            // Add padding if needed
            const padded = base64 + '==='.slice((base64.length + 3) % 4);
            const decoded = JSON.parse(atob(padded));

            // Check if token is expired
            if (decoded.exp && decoded.exp * 1000 < Date.now()) {
                console.log('Token expired, redirecting to login...');
                window.location.href = '/login';
                return null;
            }

            return decoded;
        } catch (e) {
            console.error('Failed to decode token:', e);
            // Clear bad token and redirect
            document.cookie = 'granted_session=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
            window.location.href = '/';
            return null;
        }
    }

    /**
     * Update user profile display
     */
    updateUserProfile(userInfo) {
        if (!userInfo) return;

        window.currentUser = userInfo;

        const userNameDisplay = document.getElementById('user-name-display');
        const userAvatar = document.getElementById('user-avatar');

        if (userNameDisplay) {
            userNameDisplay.textContent = userInfo.name || userInfo.email?.split('@')[0] || 'User';
        }

        if (userAvatar && userInfo.picture) {
            userAvatar.src = userInfo.picture;
            userAvatar.style.display = 'block';
        }

        const dropdownUserName = document.getElementById('dropdown-user-name');
        const dropdownUserEmail = document.getElementById('dropdown-user-email');

        if (dropdownUserName) {
            dropdownUserName.textContent = userInfo.name || 'User';
        }

        if (dropdownUserEmail) {
            dropdownUserEmail.textContent = userInfo.email || '';
        }
    }

    /**
     * Setup all event listeners
     */
    setupEventListeners() {
        const messageInput = document.getElementById('message-input');
        const sendButton = document.getElementById('send-button');
        const fileInput = document.getElementById('file-input');
        const stopButton = document.getElementById('stop-generation-btn');

        // Send button
        if (sendButton) {
            sendButton.addEventListener('click', (e) => {
                e.preventDefault();
                this.sendMessage();
            });
        }

        // Message input - Enter key
        if (messageInput) {
            messageInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    this.sendMessage();
                }
            });

            // Auto-resize textarea
            messageInput.addEventListener('input', () => {
                messageInput.style.height = 'auto';
                messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';

                // Check for URLs if enabled
                if (this.config.enableURLDetection) {
                    this.checkForURLs(messageInput.value);
                }
            });
        }

        // File input
        if (fileInput) {
            fileInput.addEventListener('change', (e) => this.handleFileSelect(e));
        }

        // Stop generation button
        if (stopButton) {
            stopButton.addEventListener('click', () => this.stopGeneration());
        }

        // Drag and drop file upload
        const inputBox = document.getElementById('input-box');
        if (inputBox && this.config.enableFileUploads) {
            inputBox.addEventListener('dragover', (e) => {
                e.preventDefault();
                inputBox.classList.add('drag-over');
            });

            inputBox.addEventListener('dragleave', () => {
                inputBox.classList.remove('drag-over');
            });

            inputBox.addEventListener('drop', (e) => {
                e.preventDefault();
                inputBox.classList.remove('drag-over');
                const files = Array.from(e.dataTransfer.files);
                this.handleFileDrop(files);
            });
        }

        // Close dropdown when clicking outside
        document.addEventListener('click', (event) => {
            const userProfile = document.querySelector('.user-profile');
            const dropdown = document.getElementById('user-dropdown');

            if (userProfile && !userProfile.contains(event.target)) {
                dropdown?.classList.remove('show');
            }
        });

        // Sidebar overlay click
        const overlay = document.getElementById('sidebar-overlay');
        if (overlay) {
            overlay.addEventListener('click', () => this.toggleSidebar());
        }

        console.log('✅ Event listeners setup complete');
    }

    /**
     * Setup ChatClient callbacks for streaming
     */
    setupChatClientCallbacks() {
        this.chatClient.onConnected = (data) => {
            console.log('✓ Connected to agent:', data);
            // Capture conversationId from backend
            if (data.conversationId && !this.conversationId) {
                this.conversationId = data.conversationId;
                console.log('✓ Captured conversationId from backend:', this.conversationId);

                // Update URL to include conversationId (for future refreshes)
                if (this.isFirstMessage) {
                    const agentPath = window.location.pathname.split('/')[1];
                    const newUrl = `/${agentPath}/chat/${this.conversationId}`;
                    window.history.pushState({}, '', newUrl);
                    console.log('✓ Updated URL to:', newUrl);
                    this.isFirstMessage = false;
                }

                // Dispatch custom event for feedback panel initialization
                window.dispatchEvent(new CustomEvent('conversationReady', {
                    detail: { conversationId: this.conversationId }
                }));
            }
        };

        this.chatClient.onTextDelta = (text) => {
            this.streamingContent += text;
            this.updateStreamingMessage(this.streamingMessageDiv, this.streamingContent, false);
        };

        this.chatClient.onThinkingDelta = (thinking) => {
            this.streamingThinkingContent += thinking;
            this.updateThinkingContent(this.streamingThinkingDiv, this.streamingThinkingContent);
        };

        this.chatClient.onToolUse = (toolName, input) => {
            console.log(`🔧 Tool used: ${toolName}`, input);
        };

        this.chatClient.onComplete = () => {
            this.updateStreamingMessage(this.streamingMessageDiv, this.streamingContent, true);
            this.hideStopButton();
            this.loadConversationsList(); // Refresh sidebar
        };

        this.chatClient.onError = (error) => {
            console.error('Chat error:', error);
            this.updateStreamingMessage(this.streamingMessageDiv, `Error: ${error}`, true);
            this.hideStopButton();
        };
    }

    /**
     * Toggle sidebar visibility
     */
    toggleSidebar() {
        const sidebar = document.getElementById('sidebar');
        const overlay = document.getElementById('sidebar-overlay');

        if (sidebar && overlay) {
            sidebar.classList.toggle('open');
            overlay.classList.toggle('visible');

            // Load conversations when opening
            if (sidebar.classList.contains('open')) {
                this.loadConversationsList();
            }
        }
    }

    /**
     * Toggle user dropdown
     */
    toggleUserDropdown() {
        const dropdown = document.getElementById('user-dropdown');
        dropdown.classList.toggle('show');
    }

    /**
     * Load conversations list from API
     */
    async loadConversationsList() {
        const conversationList = document.getElementById('conversation-list');
        if (!conversationList) return;

        try {
            const response = await fetch(`${this.config.apiBase}/api/conversations?agentType=${this.config.agentType}`, {
                credentials: 'include'
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();

            if (data.conversations && data.conversations.length > 0) {
                this.renderConversationsList(data.conversations);
            } else {
                conversationList.innerHTML = '<div class="empty-conversations">No conversations yet.<br>Start chatting to create one!</div>';
            }
        } catch (error) {
            console.error('Failed to load conversations:', error);
            conversationList.innerHTML = '<div class="empty-conversations">Failed to load conversations</div>';
        }
    }

    /**
     * Render conversations list in sidebar
     */
    renderConversationsList(conversations) {
        const conversationList = document.getElementById('conversation-list');
        if (!conversationList) return;

        conversationList.innerHTML = conversations.map(conv => {
            const isActive = conv.id === this.conversationId;
            const date = new Date(conv.updatedAt);
            const dateStr = this.formatDate(date);

            return `
                <div class="conversation-item ${isActive ? 'active' : ''}" onclick="window.agentInterface.switchConversation('${conv.id}')">
                    <div class="conversation-title">${this.escapeHtml(conv.title)}</div>
                    <div class="conversation-meta">
                        <span>${conv.messageCount} messages</span>
                        <span class="conversation-date">${dateStr}</span>
                    </div>
                    <button class="conversation-delete" onclick="event.stopPropagation(); window.agentInterface.deleteConversation('${conv.id}')" title="Delete conversation">
                        🗑️
                    </button>
                </div>
            `;
        }).join('');
    }

    /**
     * Format date for display
     */
    formatDate(date) {
        const now = new Date();
        const diff = now - date;
        const minutes = Math.floor(diff / 60000);
        const hours = Math.floor(diff / 3600000);
        const days = Math.floor(diff / 86400000);

        if (minutes < 1) return 'Just now';
        if (minutes < 60) return `${minutes}m ago`;
        if (hours < 24) return `${hours}h ago`;
        if (days < 7) return `${days}d ago`;

        return date.toLocaleDateString();
    }

    /**
     * Escape HTML to prevent XSS
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Switch to a different conversation
     */
    switchConversation(newConversationId) {
        if (newConversationId === this.conversationId) {
            this.toggleSidebar();
            return;
        }

        console.log('Switching to conversation:', newConversationId);

        // Navigate to the conversation URL (this will reload the page)
        const agentPath = window.location.pathname.split('/')[1];
        window.location.href = `/${agentPath}/chat/${newConversationId}`;
    }

    /**
     * Delete a conversation
     */
    async deleteConversation(convId) {
        if (!confirm('Delete this conversation? This cannot be undone.')) {
            return;
        }

        try {
            const response = await fetch(`${this.config.apiBase}/api/conversations/${convId}`, {
                method: 'DELETE',
                credentials: 'include'
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            console.log('✅ Conversation deleted:', convId);

            // If deleted conversation was active, start new
            if (convId === this.conversationId) {
                const agentPath = window.location.pathname.split('/')[1];
                window.location.href = `/${agentPath}`;
            }

            // Reload conversations list
            await this.loadConversationsList();

        } catch (error) {
            console.error('Delete conversation error:', error);
            alert('Failed to delete conversation. Please try again.');
        }
    }

    /**
     * Send message to agent
     */
    async sendMessage() {
        const messageInput = document.getElementById('message-input');
        const sendButton = document.getElementById('send-button');

        const message = messageInput ? messageInput.value.trim() : '';

        if (!message && this.uploadedFiles.length === 0) return;
        if (this.isLoading) return;

        this.hideWelcomeElements();

        // Handle files and message together
        let userMessageContent = message || '';
        const filesToDisplay = this.uploadedFiles.length > 0 ? [...this.uploadedFiles] : [];

        if (filesToDisplay.length > 0) {
            this.addMessage('user', userMessageContent, false, filesToDisplay);
        } else if (userMessageContent) {
            this.addMessage('user', userMessageContent);
        }

        this.isLoading = true;
        if (sendButton) sendButton.disabled = true;
        this.addLoadingMessage();

        try {
            // Convert files to base64 attachments
            const attachments = [];
            for (const file of this.uploadedFiles) {
                const base64Data = await this.fileToBase64(file);

                // Determine attachment type
                let attachmentType;
                if (file.type.startsWith('image/')) {
                    attachmentType = 'image';
                } else if (file.type === 'application/pdf') {
                    attachmentType = 'pdf';
                } else {
                    attachmentType = 'document';
                }

                attachments.push({
                    type: attachmentType,
                    mimeType: file.type,
                    data: base64Data.split(',')[1] // Remove data:mime;base64, prefix
                });
            }

            this.removeLoadingMessage();
            this.streamingMessageDiv = this.addStreamingMessage('assistant');
            this.streamingContent = '';

            // Setup ChatClient callbacks
            this.setupChatClientCallbacks();

            // Send message
            await this.chatClient.sendMessage({
                message: message || '',
                agentType: this.config.agentType,
                conversationId: this.isFirstMessage ? null : this.conversationId,
                attachments: attachments
            });

        } catch (error) {
            console.error('Send message error:', error);
            this.removeLoadingMessage();
            this.addMessage('assistant', `I apologize, but I'm having trouble connecting. Please try again.\n\nError: ${error.message}`, false);
        } finally {
            // ALWAYS re-enable UI
            this.isLoading = false;
            if (sendButton) sendButton.disabled = false;
            if (messageInput) {
                messageInput.value = '';
                messageInput.style.height = '44px';
                messageInput.placeholder = this.config.placeholder;
            }

            this.uploadedFiles = [];
            this.resetInputBox();
            this.selectedTask = '';

            this.currentAbortController = null;
            this.loadConversationsList();
        }
    }

    /**
     * Process markdown content using marked.js
     */
    processMarkdown(content) {
        if (!content) return '';

        // Strip thinking tags (Claude's internal reasoning)
        let processedContent = content.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');

        // Use marked.js if available, otherwise fall back to basic processing
        if (typeof marked !== 'undefined') {
            try {
                // Configure marked for better rendering
                marked.setOptions({
                    breaks: true,  // Convert \n to <br>
                    gfm: true,     // GitHub Flavored Markdown (tables, etc.)
                    headerIds: false,
                    mangle: false
                });
                return marked.parse(processedContent);
            } catch (e) {
                console.warn('Marked.js parsing error:', e);
                // Fall through to basic processing
            }
        }

        // Fallback: Basic markdown processing
        processedContent = processedContent.replace(/\n/g, '<br>');
        processedContent = processedContent.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        processedContent = processedContent.replace(/\*(.*?)\*/g, '<em>$1</em>');
        processedContent = processedContent.replace(/`(.*?)`/g, '<code>$1</code>');

        return processedContent;
    }

    /**
     * Add message to chat
     */
    async addMessage(role, content, shouldAnimate = false, files = null) {
        const messagesContainer = document.getElementById('messages');
        if (!messagesContainer) return;

        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${role}`;

        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';

        // Process markdown
        const processedContent = this.processMarkdown(content || '');

        // Add file attachments if present (for user messages)
        if (files && files.length > 0 && role === 'user') {
            const filesHTML = await this.createFileAttachmentsHTML(files);
            contentDiv.innerHTML = filesHTML + (processedContent ? '<div style="margin-top: 0.5rem;">' + processedContent + '</div>' : '');
        } else {
            contentDiv.innerHTML = processedContent;
        }

        messageDiv.appendChild(contentDiv);
        messagesContainer.appendChild(messageDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    /**
     * Add streaming message placeholder
     */
    addStreamingMessage(role) {
        const messagesContainer = document.getElementById('messages');
        if (!messagesContainer) return null;

        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${role}`;

        // Create thinking container (collapsible)
        const thinkingContainer = document.createElement('div');
        thinkingContainer.className = 'thinking-container';
        thinkingContainer.style.display = 'none'; // Hidden until thinking starts

        const thinkingHeader = document.createElement('div');
        thinkingHeader.className = 'thinking-header';
        thinkingHeader.innerHTML = `
            <svg class="thinking-icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2zm0 11a5 5 0 1 1 0-10 5 5 0 0 1 0 10z" fill="currentColor"/>
                <path d="M8 7a1 1 0 0 1 1 1v3a1 1 0 1 1-2 0V8a1 1 0 0 1 1-1zM8 5a1 1 0 1 0 0-2 1 1 0 0 0 0 2z" fill="currentColor"/>
            </svg>
            <span>Extended Thinking</span>
            <svg class="chevron-icon" width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M2 4l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
        `;

        const thinkingContent = document.createElement('div');
        thinkingContent.className = 'thinking-content';

        thinkingHeader.onclick = () => {
            thinkingContainer.classList.toggle('expanded');
        };

        thinkingContainer.appendChild(thinkingHeader);
        thinkingContainer.appendChild(thinkingContent);

        // Create main content container
        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';
        contentDiv.innerHTML = '<span class="typing-cursor">▎</span>';

        messageDiv.appendChild(thinkingContainer);
        messageDiv.appendChild(contentDiv);
        messagesContainer.appendChild(messageDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;

        // Store reference to thinking content div
        this.streamingThinkingDiv = thinkingContent;
        this.streamingThinkingContent = '';

        // Store a temporary message index (will be updated with real ID if available)
        const messageIndex = messagesContainer.querySelectorAll('.message.assistant').length - 1;
        messageDiv.setAttribute('data-message-index', messageIndex);

        return contentDiv;
    }

    /**
     * Update streaming message
     */
    updateStreamingMessage(messageDiv, content, isComplete = false) {
        if (!messageDiv) return;

        // NOTE: Don't strip thinking tags anymore - they're handled separately

        // Process markdown
        const processedContent = this.processMarkdown(content);

        if (isComplete) {
            messageDiv.innerHTML = processedContent;

            // Add feedback buttons to assistant messages only
            const parentMessage = messageDiv.closest('.message');
            if (parentMessage && parentMessage.classList.contains('assistant')) {
                this.addFeedbackButtons(messageDiv);
            }
        } else {
            messageDiv.innerHTML = processedContent + '<span class="typing-cursor">▎</span>';
        }

        const messagesContainer = document.getElementById('messages');
        if (messagesContainer) {
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
    }

    /**
     * Add feedback buttons (thumbs up/down) to message
     */
    addFeedbackButtons(messageDiv) {
        // Create feedback buttons container
        const feedbackContainer = document.createElement('div');
        feedbackContainer.className = 'message-feedback-buttons';
        feedbackContainer.innerHTML = `
            <button class="feedback-btn feedback-btn-up" data-rating="positive" title="Good response">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path d="M8 12V5M8 5L5 8M8 5L11 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
            </button>
            <button class="feedback-btn feedback-btn-down" data-rating="negative" title="Bad response">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path d="M8 4V11M8 11L5 8M8 11L11 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
            </button>
        `;

        // Add click handlers
        const upBtn = feedbackContainer.querySelector('.feedback-btn-up');
        const downBtn = feedbackContainer.querySelector('.feedback-btn-down');

        upBtn.addEventListener('click', () => this.handleMessageFeedback('positive', upBtn, downBtn));
        downBtn.addEventListener('click', () => this.handleMessageFeedback('negative', upBtn, downBtn));

        messageDiv.appendChild(feedbackContainer);
    }

    /**
     * Handle message-level feedback (thumbs up/down)
     */
    async handleMessageFeedback(rating, upBtn, downBtn) {
        // Check if feedback panel exists and has rateConversation method
        if (!window.feedbackPanel) {
            console.warn('Feedback panel not initialized');
            return;
        }

        // Get the message element and its index
        const messageDiv = upBtn.closest('.message');
        const messageIndex = parseInt(messageDiv.getAttribute('data-message-index'));

        // Check if this specific message has been rated
        const isRated = messageDiv.hasAttribute('data-rated');
        if (isRated) {
            return;
        }

        // Call the feedback panel's rateConversation method with message index
        const success = await window.feedbackPanel.rateConversation(rating, messageIndex);

        if (success) {
            // Mark this message as rated
            messageDiv.setAttribute('data-rated', 'true');

            // Visual feedback: highlight the selected button
            if (rating === 'positive') {
                upBtn.classList.add('selected');
                downBtn.disabled = true;
            } else {
                downBtn.classList.add('selected');
                upBtn.disabled = true;
            }
        }
    }

    /**
     * Update thinking content in the collapsible section
     */
    updateThinkingContent(thinkingDiv, content) {
        if (!thinkingDiv || !content) return;

        // Show the thinking container when we receive thinking content
        // But keep it collapsed (not expanded) by default
        const thinkingContainer = thinkingDiv.closest('.thinking-container');
        if (thinkingContainer) {
            thinkingContainer.style.display = 'block';
            // Remove 'expanded' class to keep it collapsed initially
            thinkingContainer.classList.remove('expanded');
        }

        // Process thinking content (basic formatting)
        let processedContent = content;
        processedContent = processedContent.replace(/\n/g, '<br>');

        thinkingDiv.innerHTML = processedContent;

        const messagesContainer = document.getElementById('messages');
        if (messagesContainer) {
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
    }

    /**
     * Add loading message
     */
    addLoadingMessage(customMessage = 'analyzing') {
        const messagesContainer = document.getElementById('messages');
        if (!messagesContainer) return;

        const messageDiv = document.createElement('div');
        messageDiv.className = 'message assistant';
        messageDiv.id = 'loading-message';

        const loadingDiv = document.createElement('div');
        loadingDiv.className = 'loading';
        loadingDiv.innerHTML = `<div class="spinner"></div><span>${customMessage}...</span>`;

        messageDiv.appendChild(loadingDiv);
        messagesContainer.appendChild(messageDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    /**
     * Remove loading message
     */
    removeLoadingMessage() {
        const loadingMessage = document.getElementById('loading-message');
        if (loadingMessage) {
            loadingMessage.remove();
        }
    }

    /**
     * Hide welcome elements when chat starts
     */
    hideWelcomeElements() {
        if (!this.hasStartedConversation) {
            this.hasStartedConversation = true;
            const welcomeSection = document.getElementById('welcome-section');
            const welcomeMessage = document.getElementById('welcome-message');
            const chatContainer = document.getElementById('chat-container');
            const container = document.querySelector('.container');

            if (welcomeSection) welcomeSection.style.display = 'none';
            if (welcomeMessage) welcomeMessage.classList.add('hidden');
            if (chatContainer) chatContainer.classList.add('expanded');
            if (container) container.classList.add('chat-active');
        }
    }

    /**
     * Check for URLs in message
     */
    checkForURLs(text) {
        if (!this.config.enableURLDetection) return;

        const urlRegex = /(https?:\/\/[^\s]+)/g;
        const urls = text.match(urlRegex);
        const messageInput = document.getElementById('message-input');

        if (messageInput) {
            if (urls && urls.length > 0) {
                messageInput.style.borderLeftColor = 'var(--granted-blue)';
            } else {
                messageInput.style.borderLeftColor = 'transparent';
            }
        }
    }

    /**
     * Handle file selection
     */
    async handleFileSelect(event) {
        const files = Array.from(event.target.files);
        if (files.length > 0) {
            this.uploadedFiles = [...this.uploadedFiles, ...files];
            await this.updateFileDisplay();
            const messageInput = document.getElementById('message-input');
            if (messageInput) messageInput.focus();
        }
    }

    /**
     * Handle file drop
     */
    async handleFileDrop(files) {
        const allowedTypes = ['.pdf', '.doc', '.docx', '.txt', '.md', '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tiff'];
        const validFiles = files.filter(file => {
            const fileExtension = '.' + file.name.split('.').pop().toLowerCase();
            return allowedTypes.includes(fileExtension);
        });

        if (validFiles.length > 0) {
            this.uploadedFiles = [...this.uploadedFiles, ...validFiles];
            await this.updateFileDisplay();
        }

        if (validFiles.length !== files.length) {
            this.showNotification('Some files were skipped. Supported: PDF, DOCX, TXT, MD, JPG, PNG', 'error');
        }
    }

    /**
     * Update file display
     */
    async updateFileDisplay() {
        const inputBox = document.getElementById('input-box');
        const messageInput = document.getElementById('message-input');

        if (this.uploadedFiles.length === 0) {
            this.resetInputBox();
            return;
        }

        let totalSize = 0;
        this.uploadedFiles.forEach(file => totalSize += file.size);
        const fileSize = (totalSize / 1024).toFixed(1);
        const fileSizeUnit = fileSize > 1024 ? `${(fileSize / 1024).toFixed(1)} MB` : `${fileSize} KB`;

        inputBox.classList.add('has-file');

        // Create file grid HTML
        let fileGridHTML = '<div class="file-grid">';

        for (let i = 0; i < this.uploadedFiles.length; i++) {
            const file = this.uploadedFiles[i];
            const thumbnail = await this.generateFileThumbnail(file);
            const truncatedName = file.name.length > 15 ? file.name.substring(0, 12) + '...' : file.name;

            fileGridHTML += `
                <div class="file-grid-item">
                    ${thumbnail}
                    <div class="file-name">${truncatedName}</div>
                    <button class="file-remove-btn" onclick="window.agentInterface.removeFile(${i})">×</button>
                </div>
            `;
        }

        fileGridHTML += '</div>';

        // Create file display container
        let fileDisplay = inputBox.querySelector('.file-display');
        if (!fileDisplay) {
            fileDisplay = document.createElement('div');
            fileDisplay.className = 'file-display';
            fileDisplay.style.cssText = `
                padding: 8px 16px;
                border-bottom: 1px solid var(--border);
                background: rgba(0, 138, 191, 0.05);
            `;
            inputBox.insertBefore(fileDisplay, inputBox.firstChild);
        }

        fileDisplay.innerHTML = `
            <div style="color: #008ABF; font-weight: 500; font-size: 0.8rem; margin-bottom: 0.5rem;">
                ${this.uploadedFiles.length} file${this.uploadedFiles.length !== 1 ? 's' : ''} ready (${fileSizeUnit})
            </div>
            ${fileGridHTML}
        `;

        messageInput.placeholder = `${this.uploadedFiles.length} file${this.uploadedFiles.length !== 1 ? 's' : ''} ready - Add message or click Send`;
    }

    /**
     * Generate file thumbnail
     */
    generateFileThumbnail(file) {
        return new Promise((resolve) => {
            const fileExtension = '.' + file.name.split('.').pop().toLowerCase();
            const imageTypes = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tiff'];

            if (imageTypes.includes(fileExtension)) {
                // Generate image thumbnail
                const reader = new FileReader();
                reader.onload = (e) => {
                    const img = document.createElement('img');
                    img.className = 'file-thumbnail';
                    img.src = e.target.result;
                    img.alt = file.name;
                    resolve(img.outerHTML);
                };
                reader.readAsDataURL(file);
            } else {
                // Generate file type icon
                const icon = this.getFileTypeIcon(fileExtension);
                const iconHtml = `<div class="file-icon-large">${icon}</div>`;
                resolve(iconHtml);
            }
        });
    }

    /**
     * Get file type icon
     */
    getFileTypeIcon(extension) {
        const icons = {
            '.pdf': '📄',
            '.doc': '📝',
            '.docx': '📝',
            '.txt': '📄',
            '.md': '📄'
        };
        return icons[extension] || '📄';
    }

    /**
     * Remove file from selection
     */
    removeFile(index) {
        this.uploadedFiles.splice(index, 1);
        const fileInput = document.getElementById('file-input');
        if (fileInput) fileInput.value = '';
        this.updateFileDisplay();
    }

    /**
     * Reset input box to default state
     */
    resetInputBox() {
        const inputBox = document.getElementById('input-box');
        const messageInput = document.getElementById('message-input');

        inputBox.classList.remove('has-file');
        const fileDisplay = inputBox.querySelector('.file-display');
        if (fileDisplay) {
            fileDisplay.remove();
        }

        if (messageInput) {
            messageInput.placeholder = this.config.placeholder;
        }

        const fileInput = document.getElementById('file-input');
        if (fileInput) fileInput.value = '';
    }

    /**
     * Create file attachments HTML for messages
     */
    async createFileAttachmentsHTML(files) {
        if (!files || files.length === 0) return '';

        let html = '<div class="file-grid" style="margin-bottom: 0.75rem;">';

        for (const file of files) {
            const fileExtension = '.' + file.name.split('.').pop().toLowerCase();
            const imageTypes = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tiff'];
            const isImage = imageTypes.includes(fileExtension);

            // Create data URL for files
            const dataUrl = await new Promise((resolve) => {
                const reader = new FileReader();
                reader.onload = (e) => resolve(e.target.result);
                reader.readAsDataURL(file);
            });

            const truncatedName = file.name.length > 15 ? file.name.substring(0, 12) + '...' : file.name;

            if (isImage) {
                html += `
                    <a href="${dataUrl}" target="_blank" style="text-decoration: none; color: inherit;">
                        <div class="file-grid-item">
                            <img class="file-thumbnail" src="${dataUrl}" alt="${file.name}" />
                            <div class="file-name">${truncatedName}</div>
                        </div>
                    </a>
                `;
            } else {
                const icon = this.getFileTypeIcon(fileExtension);
                html += `
                    <a href="${dataUrl}" download="${file.name}" style="text-decoration: none; color: inherit;">
                        <div class="file-grid-item">
                            <div class="file-icon-large">${icon}</div>
                            <div class="file-name">${truncatedName}</div>
                        </div>
                    </a>
                `;
            }
        }

        html += '</div>';
        return html;
    }

    /**
     * Convert file to base64
     */
    fileToBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    /**
     * Show notification
     */
    showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;

        document.body.appendChild(notification);

        setTimeout(() => {
            notification.style.opacity = '0';
            notification.style.transform = 'translateX(100%)';
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, 300);
        }, 3000);
    }

    /**
     * Stop generation
     */
    stopGeneration() {
        console.log('Stop generation requested');

        if (this.currentAbortController) {
            try {
                this.currentAbortController.abort();
                console.log('Fetch aborted');
            } catch (error) {
                console.error('Error aborting fetch:', error);
            }
            this.currentAbortController = null;
        }

        this.cleanupAfterStream();
    }

    /**
     * Show stop button
     */
    showStopButton() {
        const stopButton = document.getElementById('stop-button');
        const sendButton = document.getElementById('send-button');
        if (stopButton) stopButton.classList.add('visible');
        if (sendButton) sendButton.style.display = 'none';
    }

    /**
     * Hide stop button
     */
    hideStopButton() {
        const stopButton = document.getElementById('stop-button');
        const sendButton = document.getElementById('send-button');
        if (stopButton) stopButton.classList.remove('visible');
        if (sendButton) sendButton.style.display = 'flex';
    }

    /**
     * Cleanup after streaming
     */
    cleanupAfterStream() {
        const messageInput = document.getElementById('message-input');
        const sendButton = document.getElementById('send-button');

        this.removeLoadingMessage();

        const typingCursor = document.querySelector('.typing-cursor');
        if (typingCursor) {
            typingCursor.remove();
        }

        this.isLoading = false;
        if (sendButton) sendButton.disabled = false;
        if (messageInput) {
            messageInput.value = '';
            messageInput.style.height = '44px';
            messageInput.placeholder = this.config.placeholder;
        }

        this.uploadedFiles = [];
        this.resetInputBox();
        this.hideStopButton();

        this.currentAbortController = null;
    }

    /**
     * Load conversation history from backend
     */
    async loadConversationHistory() {
        if (!this.conversationId) return null;

        try {
            console.log('📥 Loading conversation history:', this.conversationId);
            const response = await fetch(`${this.config.apiBase}/api/conversations/${this.conversationId}`, {
                credentials: 'include'
            });

            if (!response.ok) {
                if (response.status === 401) {
                    console.warn('⚠️ Unauthorized - user not logged in');
                    return null;
                }
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();
            console.log('✅ Loaded conversation:', data.messageCount, 'messages');
            return data;
        } catch (error) {
            console.error('❌ Failed to load conversation:', error);
            return null;
        }
    }

    /**
     * Restore conversation UI from loaded data
     */
    restoreConversationUI(conversationData) {
        if (!conversationData || !conversationData.messages || conversationData.messages.length === 0) {
            console.log('📭 No conversation history to restore');
            return;
        }

        console.log('🔄 Restoring conversation UI...');
        this.hideWelcomeElements();

        conversationData.messages.forEach(msg => {
            const role = msg.role;
            let content = '';

            if (Array.isArray(msg.content)) {
                msg.content.forEach(block => {
                    if (block.type === 'text') {
                        content += block.text;
                    }
                });
            } else if (typeof msg.content === 'string') {
                content = msg.content;
            }

            if (content) {
                this.addMessage(role, content);
            }
        });

        this.hasStartedConversation = true;
        this.isFirstMessage = false;
        console.log('✅ Conversation restored:', conversationData.messageCount, 'messages');
    }

    /**
     * Logout user
     */
    async logout() {
        try {
            // Clear session cookie
            document.cookie = 'granted_session=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';

            // Redirect to login
            window.location.href = '/login';
        } catch (error) {
            console.error('Logout error:', error);
        }
    }
}

// Export for use in HTML
window.AgentInterface = AgentInterface;
