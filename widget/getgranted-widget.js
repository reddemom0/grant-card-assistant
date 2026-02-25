/**
 * GetGranted Chat Widget
 *
 * Embeddable chat widget for Granted Consulting
 * Supports two modes: floating (chat bubble) and inline (embedded in page)
 *
 * Usage:
 *   <script src="https://YOUR_RAILWAY_URL/widget/getgranted-widget.js"></script>
 *   <script>
 *     GetGrantedWidget.init({
 *       mode: 'floating',
 *       apiUrl: 'https://YOUR_RAILWAY_URL',
 *       greeting: true,
 *       greetingDelay: 3000,
 *       position: 'bottom-right'
 *     });
 *   </script>
 */

(function() {
  'use strict';

  // ============================================================================
  // CONFIGURATION & STATE
  // ============================================================================

  const BRAND_COLORS = {
    primary: '#008abf',
    primaryHover: '#006d99',
    primaryLight: '#e5f4fa',
    grey: '#6d7881',
    lightGrey: '#dde1e3',
    dark: '#1a2332',
    lightBg: '#f8fafb',
    white: '#ffffff'
  };

  const DEFAULT_CONFIG = {
    mode: 'floating',
    apiUrl: '',
    container: null,
    greeting: true,
    greetingDelay: 3000,
    greetingText: '👋 Curious what grant funding your company could qualify for? I can help you figure that out in a few minutes.',
    position: 'bottom-right',
    quickActions: []
  };

  let config = { ...DEFAULT_CONFIG };
  let sessionId = null;
  let isOpen = false;
  let shadowRoot = null;
  let messagesContainer = null;
  let inputField = null;
  let sendButton = null;
  let isWaitingForResponse = false;
  let isInitializing = false; // Guard to prevent duplicate initialization
  let formData = null; // Store form data after submission
  let showingForm = false; // Track if form is currently displayed

  // ============================================================================
  // UTILITY FUNCTIONS
  // ============================================================================

  function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function formatMessage(text) {
    // Convert newlines to <br> tags for display
    return escapeHtml(text).replace(/\n/g, '<br>');
  }

  // ============================================================================
  // STYLES
  // ============================================================================

  function getStyles() {
    return `
      <style>
        * {
          box-sizing: border-box;
          margin: 0;
          padding: 0;
        }

        :host {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          font-size: 15px;
          line-height: 1.5;
          color: ${BRAND_COLORS.dark};
        }

        /* =================================================================== */
        /* FLOATING WIDGET STYLES */
        /* =================================================================== */

        .gg-widget-floating {
          position: fixed;
          ${config.position === 'bottom-right' ? 'right: 24px; bottom: 24px;' : ''}
          ${config.position === 'bottom-left' ? 'left: 24px; bottom: 24px;' : ''}
          z-index: 999999;
        }

        .gg-chat-bubble {
          width: 62px;
          height: 62px;
          background: ${BRAND_COLORS.primary};
          border-radius: 50%;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
          transition: transform 0.2s ease, box-shadow 0.2s ease;
          animation: pulse 2s ease-in-out infinite;
        }

        .gg-chat-bubble:hover {
          transform: scale(1.05);
          box-shadow: 0 6px 20px rgba(0, 0, 0, 0.2);
          animation: none;
        }

        @keyframes pulse {
          0%, 100% {
            box-shadow: 0 4px 12px rgba(0, 138, 191, 0.15), 0 0 0 0 rgba(0, 138, 191, 0.4);
          }
          50% {
            box-shadow: 0 4px 12px rgba(0, 138, 191, 0.15), 0 0 0 8px rgba(0, 138, 191, 0);
          }
        }

        .gg-chat-bubble svg {
          width: 28px;
          height: 28px;
          fill: white;
        }

        .gg-greeting-tooltip {
          position: absolute;
          bottom: 80px;
          right: 0;
          background: white;
          padding: 16px;
          border-radius: 12px;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
          max-width: 280px;
          opacity: 0;
          transform: translateY(10px);
          transition: opacity 0.3s ease, transform 0.3s ease;
          pointer-events: none;
        }

        .gg-greeting-tooltip.visible {
          opacity: 1;
          transform: translateY(0);
          pointer-events: auto;
        }

        .gg-greeting-tooltip::after {
          content: '';
          position: absolute;
          bottom: -8px;
          right: 24px;
          width: 0;
          height: 0;
          border-left: 8px solid transparent;
          border-right: 8px solid transparent;
          border-top: 8px solid white;
        }

        .gg-greeting-tooltip p {
          margin: 0;
          font-size: 14px;
          line-height: 1.5;
          color: ${BRAND_COLORS.dark};
        }

        .gg-chat-panel {
          position: absolute;
          bottom: 80px;
          right: 0;
          width: 400px;
          height: 560px;
          background: white;
          border-radius: 12px;
          box-shadow: 0 8px 40px rgba(0, 0, 0, 0.15);
          display: flex;
          flex-direction: column;
          opacity: 0;
          transform: scale(0.9) translateY(20px);
          transform-origin: bottom right;
          transition: opacity 0.3s ease, transform 0.3s ease;
          pointer-events: none;
        }

        .gg-chat-panel.open {
          opacity: 1;
          transform: scale(1) translateY(0);
          pointer-events: auto;
        }

        @media (max-width: 480px) {
          .gg-chat-panel {
            width: calc(100vw - 32px);
            height: calc(100vh - 100px);
          }
        }

        /* =================================================================== */
        /* INLINE WIDGET STYLES */
        /* =================================================================== */

        .gg-widget-inline {
          width: 100%;
          max-width: 720px;
          margin: 0 auto;
          background: white;
          border-radius: 12px;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
          display: flex;
          flex-direction: column;
          min-height: 340px;
          height: 600px;
        }

        /* =================================================================== */
        /* SHARED CHAT UI STYLES */
        /* =================================================================== */

        .gg-chat-header {
          background: ${BRAND_COLORS.primary};
          color: white;
          padding: 20px;
          border-radius: 12px 12px 0 0;
          display: flex;
          align-items: center;
          gap: 12px;
          flex-shrink: 0;
        }

        .gg-chat-header-avatar {
          width: 40px;
          height: 40px;
          background: rgba(255, 255, 255, 0.2);
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: bold;
          font-size: 18px;
        }

        .gg-chat-header-text h3 {
          font-size: 16px;
          font-weight: 600;
          margin: 0 0 2px 0;
        }

        .gg-chat-header-text p {
          font-size: 13px;
          margin: 0;
          opacity: 0.9;
        }

        .gg-chat-header-status {
          width: 8px;
          height: 8px;
          background: #4ade80;
          border-radius: 50%;
          display: inline-block;
          margin-right: 6px;
        }

        .gg-chat-messages {
          flex: 1;
          overflow-y: auto;
          padding: 20px;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .gg-message {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          animation: slideUp 0.3s ease;
        }

        @keyframes slideUp {
          from {
            opacity: 0;
            transform: translateY(10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .gg-message-bot {
          align-self: flex-start;
        }

        .gg-message-user {
          align-self: flex-end;
          flex-direction: row-reverse;
        }

        .gg-message-avatar {
          width: 32px;
          height: 32px;
          background: ${BRAND_COLORS.primaryLight};
          color: ${BRAND_COLORS.primary};
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 600;
          font-size: 14px;
          flex-shrink: 0;
        }

        .gg-message-user .gg-message-avatar {
          background: ${BRAND_COLORS.lightGrey};
          color: ${BRAND_COLORS.grey};
        }

        .gg-message-content {
          max-width: 75%;
          padding: 12px 16px;
          border-radius: 12px;
          font-size: 14px;
          line-height: 1.5;
        }

        .gg-message-bot .gg-message-content {
          background: white;
          border: 1px solid ${BRAND_COLORS.lightGrey};
          color: ${BRAND_COLORS.dark};
        }

        .gg-message-user .gg-message-content {
          background: ${BRAND_COLORS.primary};
          color: white;
        }

        .gg-typing-indicator {
          display: flex;
          gap: 4px;
          padding: 12px 16px;
        }

        .gg-typing-indicator span {
          width: 8px;
          height: 8px;
          background: ${BRAND_COLORS.grey};
          border-radius: 50%;
          animation: bounce 1.4s infinite ease-in-out both;
        }

        .gg-typing-indicator span:nth-child(1) {
          animation-delay: -0.32s;
        }

        .gg-typing-indicator span:nth-child(2) {
          animation-delay: -0.16s;
        }

        @keyframes bounce {
          0%, 80%, 100% {
            transform: scale(0);
          }
          40% {
            transform: scale(1);
          }
        }

        .gg-error-message {
          background: #fee;
          border: 1px solid #fcc;
          color: #c33;
          padding: 12px 16px;
          margin: 12px 20px;
          border-radius: 8px;
          font-size: 14px;
        }

        .gg-quick-actions {
          padding: 0 20px 12px;
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          flex-shrink: 0;
        }

        .gg-quick-action {
          background: white;
          border: 1px solid ${BRAND_COLORS.lightGrey};
          color: ${BRAND_COLORS.dark};
          padding: 8px 16px;
          border-radius: 20px;
          font-size: 14px;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .gg-quick-action:hover {
          background: ${BRAND_COLORS.primaryLight};
          border-color: ${BRAND_COLORS.primary};
          color: ${BRAND_COLORS.primary};
        }

        .gg-chat-input-wrapper {
          padding: 16px 20px;
          border-top: 1px solid ${BRAND_COLORS.lightGrey};
          display: flex;
          gap: 10px;
          flex-shrink: 0;
        }

        .gg-chat-input {
          flex: 1;
          border: 1px solid ${BRAND_COLORS.lightGrey};
          border-radius: 8px;
          padding: 10px 12px;
          font-size: 14px;
          font-family: inherit;
          resize: none;
          min-height: 42px;
          max-height: 120px;
          outline: none;
          transition: border-color 0.2s ease;
        }

        .gg-chat-input:focus {
          border-color: ${BRAND_COLORS.primary};
        }

        .gg-chat-input:disabled {
          background: ${BRAND_COLORS.lightBg};
          cursor: not-allowed;
        }

        .gg-send-button {
          width: 42px;
          height: 42px;
          background: ${BRAND_COLORS.primary};
          border: none;
          border-radius: 8px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: background 0.2s ease;
          flex-shrink: 0;
        }

        .gg-send-button:hover:not(:disabled) {
          background: ${BRAND_COLORS.primaryHover};
        }

        .gg-send-button:disabled {
          background: ${BRAND_COLORS.lightGrey};
          cursor: not-allowed;
        }

        .gg-send-button svg {
          width: 20px;
          height: 20px;
          fill: white;
        }

        .gg-footer {
          padding: 12px 20px;
          text-align: center;
          font-size: 12px;
          color: ${BRAND_COLORS.grey};
          border-top: 1px solid ${BRAND_COLORS.lightGrey};
          flex-shrink: 0;
        }

        .gg-trust-badges {
          display: flex;
          justify-content: center;
          gap: 20px;
          padding: 16px 20px;
          font-size: 12px;
          color: ${BRAND_COLORS.grey};
          border-top: 1px solid ${BRAND_COLORS.lightGrey};
          flex-wrap: wrap;
        }

        .gg-trust-badge {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        /* Hide scrollbar for Chrome, Safari and Opera */
        .gg-chat-messages::-webkit-scrollbar {
          width: 6px;
        }

        .gg-chat-messages::-webkit-scrollbar-track {
          background: transparent;
        }

        .gg-chat-messages::-webkit-scrollbar-thumb {
          background: ${BRAND_COLORS.lightGrey};
          border-radius: 3px;
        }

        .gg-chat-messages::-webkit-scrollbar-thumb:hover {
          background: ${BRAND_COLORS.grey};
        }

        .gg-close-button {
          margin-left: auto;
          background: rgba(255, 255, 255, 0.2);
          border: none;
          width: 32px;
          height: 32px;
          border-radius: 6px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: background 0.2s ease;
        }

        .gg-close-button:hover {
          background: rgba(255, 255, 255, 0.3);
        }

        .gg-close-button svg {
          width: 16px;
          height: 16px;
          fill: white;
        }

        /* =================================================================== */
        /* PRE-CHAT FORM STYLES */
        /* =================================================================== */

        .gg-form-container {
          flex: 1;
          overflow-y: auto;
          padding: 24px;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .gg-form-container.hidden {
          display: none;
        }

        .gg-form-intro {
          margin-bottom: 8px;
        }

        .gg-form-intro h3 {
          font-size: 18px;
          font-weight: 600;
          margin: 0 0 8px 0;
          color: ${BRAND_COLORS.dark};
        }

        .gg-form-intro p {
          font-size: 14px;
          margin: 0;
          color: ${BRAND_COLORS.grey};
          line-height: 1.5;
        }

        .gg-form-field {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .gg-form-field label {
          font-size: 13px;
          font-weight: 600;
          color: ${BRAND_COLORS.dark};
        }

        .gg-form-field label .required {
          color: ${BRAND_COLORS.primary};
        }

        .gg-form-field input[type="text"],
        .gg-form-field input[type="email"],
        .gg-form-field input[type="url"] {
          border: 1px solid ${BRAND_COLORS.lightGrey};
          border-radius: 6px;
          padding: 10px 12px;
          font-size: 14px;
          font-family: inherit;
          outline: none;
          transition: border-color 0.2s ease;
        }

        .gg-form-field input:focus {
          border-color: ${BRAND_COLORS.primary};
        }

        .gg-form-field input.error {
          border-color: #dc2626;
        }

        .gg-form-field .error-message {
          font-size: 12px;
          color: #dc2626;
          display: none;
        }

        .gg-form-field input.error + .error-message {
          display: block;
        }

        .gg-form-checkbox {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 13px;
          color: ${BRAND_COLORS.grey};
          margin-top: 8px;
        }

        .gg-form-checkbox input[type="checkbox"] {
          width: 16px;
          height: 16px;
          cursor: pointer;
        }

        .gg-form-submit {
          margin-top: 8px;
          background: ${BRAND_COLORS.primary};
          color: white;
          border: none;
          border-radius: 8px;
          padding: 12px 24px;
          font-size: 15px;
          font-weight: 600;
          cursor: pointer;
          transition: background 0.2s ease;
        }

        .gg-form-submit:hover:not(:disabled) {
          background: ${BRAND_COLORS.primaryHover};
        }

        .gg-form-submit:disabled {
          background: ${BRAND_COLORS.lightGrey};
          cursor: not-allowed;
        }

        .gg-form-loading {
          display: none;
          text-align: center;
          padding: 20px;
          color: ${BRAND_COLORS.grey};
        }

        .gg-form-loading.visible {
          display: block;
        }

        .gg-chat-interface {
          display: flex;
          flex-direction: column;
          flex: 1;
          min-height: 0;
        }

        .gg-chat-interface.hidden {
          display: none;
        }
      </style>
    `;
  }

  // ============================================================================
  // UI COMPONENTS
  // ============================================================================

  function createFloatingWidget() {
    const container = document.createElement('div');
    container.className = 'gg-widget-floating';

    container.innerHTML = `
      <div class="gg-greeting-tooltip">
        <p>${config.greetingText}</p>
      </div>
      <div class="gg-chat-panel">
        ${createChatUI()}
        <div class="gg-footer">Powered by GetGranted</div>
      </div>
      <div class="gg-chat-bubble">
        <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/>
        </svg>
      </div>
    `;

    return container;
  }

  function createInlineWidget() {
    const container = document.createElement('div');
    container.className = 'gg-widget-inline';

    container.innerHTML = `
      ${createChatUI()}
      <div class="gg-trust-badges">
        <div class="gg-trust-badge">
          <span>🔒</span>
          <span>No data stored</span>
        </div>
        <div class="gg-trust-badge">
          <span>⚡</span>
          <span>Instant estimate</span>
        </div>
        <div class="gg-trust-badge">
          <span>🇨🇦</span>
          <span>30+ years grant expertise</span>
        </div>
      </div>
    `;

    return container;
  }

  function createChatUI() {
    const statusDot = config.mode === 'inline' ? '<span class="gg-chat-header-status"></span>' : '';
    const closeButton = config.mode === 'floating' ? `
      <button class="gg-close-button" aria-label="Close chat">
        <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
        </svg>
      </button>
    ` : '';

    return `
      <div class="gg-chat-header">
        <div class="gg-chat-header-avatar">G</div>
        <div class="gg-chat-header-text">
          <h3>GetGranted AI</h3>
          <p>${statusDot}Grant funding advisor</p>
        </div>
        ${closeButton}
      </div>

      <!-- Pre-Chat Form -->
      <div class="gg-form-container">
        <div class="gg-form-intro">
          <h3>Get Your Free Grant Estimate</h3>
          <p>Tell us a bit about your business and we'll show you what funding programs you could qualify for. Takes about 2 minutes.</p>
        </div>

        <div class="gg-form-field">
          <label for="gg-contact-name">Your Name <span class="required">*</span></label>
          <input type="text" id="gg-contact-name" required />
          <span class="error-message">Please enter your name</span>
        </div>

        <div class="gg-form-field">
          <label for="gg-contact-email">Email <span class="required">*</span></label>
          <input type="email" id="gg-contact-email" required />
          <span class="error-message">Please enter a valid email address</span>
        </div>

        <div class="gg-form-field">
          <label for="gg-company-name">Company Name <span class="required">*</span></label>
          <input type="text" id="gg-company-name" required />
          <span class="error-message">Please enter your company name</span>
        </div>

        <div class="gg-form-field">
          <label for="gg-company-website">Company Website</label>
          <input type="url" id="gg-company-website" placeholder="https://example.com" />
          <label class="gg-form-checkbox">
            <input type="checkbox" id="gg-no-website" />
            <span>I don't have a website yet</span>
          </label>
          <span class="error-message">Please enter a valid website URL</span>
        </div>

        <button type="button" class="gg-form-submit">Get My Grant Estimate</button>

        <div class="gg-form-loading">Connecting...</div>
      </div>

      <!-- Chat Interface (hidden until form submitted) -->
      <div class="gg-chat-interface hidden">
        <div class="gg-chat-messages"></div>
        ${config.quickActions.length > 0 ? '<div class="gg-quick-actions"></div>' : ''}
        <div class="gg-chat-input-wrapper">
          <textarea
            class="gg-chat-input"
            placeholder="Type your message..."
            rows="1"
            maxlength="500"
          ></textarea>
          <button class="gg-send-button" aria-label="Send message">
            <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
            </svg>
          </button>
        </div>
      </div>
    `;
  }

  function addUserMessage(text) {
    if (!messagesContainer) return;

    const messageDiv = document.createElement('div');
    messageDiv.className = 'gg-message gg-message-user';
    messageDiv.innerHTML = `
      <div class="gg-message-avatar">U</div>
      <div class="gg-message-content">${escapeHtml(text)}</div>
    `;

    messagesContainer.appendChild(messageDiv);
    scrollToBottom();
  }

  function createAssistantMessage(text) {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'gg-message gg-message-bot';
    messageDiv.innerHTML = `
      <div class="gg-message-avatar">G</div>
      <div class="gg-message-content">${escapeHtml(text)}</div>
    `;
    return messageDiv;
  }

  function createTypingIndicator() {
    const typingDiv = document.createElement('div');
    typingDiv.className = 'gg-message gg-message-bot';
    typingDiv.id = 'gg-typing-indicator';
    typingDiv.innerHTML = `
      <div class="gg-message-avatar">G</div>
      <div class="gg-message-content">
        <div class="gg-typing-indicator">
          <span></span>
          <span></span>
          <span></span>
        </div>
      </div>
    `;
    return typingDiv;
  }

  function addErrorMessage(text) {
    if (!messagesContainer) return;

    const errorDiv = document.createElement('div');
    errorDiv.className = 'gg-error-message';
    errorDiv.textContent = text;
    messagesContainer.appendChild(errorDiv);
    scrollToBottom();
  }

  function scrollToBottom() {
    if (messagesContainer) {
      setTimeout(() => {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
      }, 100);
    }
  }

  function showQuickActions() {
    if (config.quickActions.length === 0) return;

    const quickActionsContainer = shadowRoot?.querySelector('.gg-quick-actions');
    if (!quickActionsContainer) return;

    quickActionsContainer.innerHTML = config.quickActions
      .map(action => `<button class="gg-quick-action">${escapeHtml(action)}</button>`)
      .join('');

    // Add click handlers
    quickActionsContainer.querySelectorAll('.gg-quick-action').forEach(button => {
      button.addEventListener('click', () => {
        const message = button.textContent;
        sendMessage(message);
        quickActionsContainer.remove();
      });
    });
  }

  function setInputEnabled(enabled) {
    if (inputField) {
      inputField.disabled = !enabled;
    }
    if (sendButton) {
      sendButton.disabled = !enabled;
    }
  }

  // ============================================================================
  // API COMMUNICATION
  // ============================================================================

  async function sendMessage(message, isHidden = false) {
    if (!message || message.trim().length === 0) return;
    if (isWaitingForResponse) return;

    const trimmedMessage = message.trim();

    // Show user message in UI (skip for hidden init messages)
    if (!isHidden) {
      addUserMessage(trimmedMessage);
    }

    // Clear input
    if (inputField) {
      inputField.value = '';
      inputField.style.height = 'auto';
    }

    // Disable input while waiting
    isWaitingForResponse = true;
    setInputEnabled(false);

    // Show typing indicator
    const typingIndicator = createTypingIndicator();
    messagesContainer.appendChild(typingIndicator);
    scrollToBottom();

    let assistantWrapper = null;
    let assistantText = '';

    try {
      const body = { message: trimmedMessage };
      if (sessionId) body.session_id = sessionId;

      console.log('[Widget] Sending message. session_id:', sessionId || '(none — new session)');

      const response = await fetch(`${config.apiUrl}/api/lead-gen/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        typingIndicator.remove();
        const errData = await response.json().catch(() => ({}));
        addErrorMessage(errData.error || 'Something went wrong. Please try again.');
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop(); // keep incomplete line

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (!raw) continue;

          let parsed;
          try {
            parsed = JSON.parse(raw);
          } catch {
            continue;
          }

          // Session ID from server
          if (parsed.type === 'connected' && parsed.conversationId) {
            sessionId = parsed.conversationId;
            console.log('[Widget] session_id received from connected event:', sessionId);
          }

          // Streaming text
          if (parsed.type === 'text_delta' && parsed.text) {
            if (!assistantWrapper) {
              typingIndicator.remove();
              assistantWrapper = createAssistantMessage('');
              messagesContainer.appendChild(assistantWrapper);
            }
            assistantText += parsed.text;
            assistantWrapper.querySelector('.gg-message-content').textContent = assistantText;
            scrollToBottom();
          }

          // Done event
          if (parsed.type === 'done') {
            if (!assistantWrapper && assistantText === '') {
              typingIndicator.remove();
            }
          }

          // Error from server stream
          if (parsed.type === 'error') {
            typingIndicator.remove();
            addErrorMessage(parsed.message || 'An error occurred.');
          }
        }
      }

      // Flush remaining buffer
      if (buffer.startsWith('data: ')) {
        const raw = buffer.slice(6).trim();
        try {
          const parsed = JSON.parse(raw);
          if (parsed.type === 'text_delta' && parsed.text) {
            if (!assistantWrapper) {
              typingIndicator.remove();
              assistantWrapper = createAssistantMessage('');
              messagesContainer.appendChild(assistantWrapper);
            }
            assistantText += parsed.text;
            assistantWrapper.querySelector('.gg-message-content').textContent = assistantText;
          }
        } catch { /* ignore */ }
      }

      // If typing indicator is still there (no response came back), remove it
      if (typingIndicator.parentNode) {
        typingIndicator.remove();
      }

    } catch (error) {
      if (typingIndicator.parentNode) typingIndicator.remove();
      addErrorMessage('Connection error. Please check your connection and try again.');
      console.error('Chat error:', error);
    } finally {
      isWaitingForResponse = false;
      setInputEnabled(true);
      if (inputField) {
        inputField.focus();
      }
    }
  }


  // ============================================================================
  // FORM HANDLING
  // ============================================================================

  async function submitForm() {
    // Get form references
    const formContainer = shadowRoot?.querySelector('.gg-form-container');
    const chatInterface = shadowRoot?.querySelector('.gg-chat-interface');
    const formLoading = shadowRoot?.querySelector('.gg-form-loading');
    const submitBtn = shadowRoot?.querySelector('.gg-form-submit');

    // Get field values
    const contactName = shadowRoot?.getElementById('gg-contact-name').value.trim();
    const contactEmail = shadowRoot?.getElementById('gg-contact-email').value.trim();
    const companyName = shadowRoot?.getElementById('gg-company-name').value.trim();
    let companyWebsite = shadowRoot?.getElementById('gg-company-website').value.trim();
    const noWebsite = shadowRoot?.getElementById('gg-no-website').checked;

    // Clear previous errors
    shadowRoot?.querySelectorAll('.gg-form-field input').forEach(input => {
      input.classList.remove('error');
    });

    // Validate fields
    let hasError = false;

    if (!contactName) {
      shadowRoot?.getElementById('gg-contact-name').classList.add('error');
      hasError = true;
    }

    if (!contactEmail || !contactEmail.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
      shadowRoot?.getElementById('gg-contact-email').classList.add('error');
      hasError = true;
    }

    if (!companyName) {
      shadowRoot?.getElementById('gg-company-name').classList.add('error');
      hasError = true;
    }

    // Website validation: required unless "no website" is checked
    if (!noWebsite && !companyWebsite) {
      shadowRoot?.getElementById('gg-company-website').classList.add('error');
      hasError = true;
    }

    if (hasError) {
      return;
    }

    // If "no website" is checked, set website to null
    if (noWebsite) {
      companyWebsite = null;
    } else if (companyWebsite) {
      // Add https:// protocol if missing
      if (!companyWebsite.match(/^https?:\/\//i)) {
        companyWebsite = 'https://' + companyWebsite;
      }
    }

    // Prepare form data
    formData = {
      contact_name: contactName,
      email: contactEmail,
      company_name: companyName,
      company_website: companyWebsite
    };

    // Show loading, disable submit
    if (formLoading) formLoading.classList.add('visible');
    if (submitBtn) submitBtn.disabled = true;

    try {
      // Submit to /api/lead-gen/init
      const response = await fetch(`${config.apiUrl}/api/lead-gen/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to start session');
      }

      const data = await response.json();
      sessionId = data.session_id;

      console.log('[Widget] Form submitted, session created:', sessionId);

      // Transition: hide form, show chat
      if (formContainer) formContainer.classList.add('hidden');
      if (chatInterface) chatInterface.classList.remove('hidden');

      // Auto-init: send personalized instruction when form data exists (hidden from UI)
      setInputEnabled(false);
      if (formData && formData.contact_name && formData.company_name) {
        await sendMessage(`User submitted pre-chat form. Name: ${formData.contact_name}. Company: ${formData.company_name}. Greet them by name, reference their industry, and ask what's driving their interest in grants. Do NOT ask for their company name — you already have it.`, true);
      } else {
        await sendMessage('hello', true);
      }
      setInputEnabled(true);

      // Show quick actions for inline mode
      if (config.mode === 'inline') {
        showQuickActions();
      }

    } catch (error) {
      console.error('Form submission error:', error);
      alert('Something went wrong. Please try again.');
      if (formLoading) formLoading.classList.remove('visible');
      if (submitBtn) submitBtn.disabled = false;
    }
  }

  // ============================================================================
  // EVENT HANDLERS
  // ============================================================================

  function setupEventHandlers() {
    // Form submit handler
    const formSubmitBtn = shadowRoot?.querySelector('.gg-form-submit');
    if (formSubmitBtn) {
      formSubmitBtn.addEventListener('click', submitForm);
    }

    // "No website" checkbox handler
    const noWebsiteCheckbox = shadowRoot?.getElementById('gg-no-website');
    const websiteInput = shadowRoot?.getElementById('gg-company-website');
    if (noWebsiteCheckbox && websiteInput) {
      noWebsiteCheckbox.addEventListener('change', (e) => {
        websiteInput.disabled = e.target.checked;
        if (e.target.checked) {
          websiteInput.value = '';
          websiteInput.classList.remove('error');
        }
      });
    }

    if (config.mode === 'floating') {
      const bubble = shadowRoot?.querySelector('.gg-chat-bubble');
      const panel = shadowRoot?.querySelector('.gg-chat-panel');
      const closeBtn = shadowRoot?.querySelector('.gg-close-button');

      if (bubble) {
        bubble.addEventListener('click', () => {
          isOpen = !isOpen;
          if (panel) {
            panel.classList.toggle('open', isOpen);
          }

          // Hide greeting tooltip when opened
          const greeting = shadowRoot?.querySelector('.gg-greeting-tooltip');
          if (greeting && isOpen) {
            greeting.classList.remove('visible');
          }
        });
      }

      if (closeBtn) {
        closeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          isOpen = false;
          if (panel) {
            panel.classList.remove('open');
          }
        });
      }

      // Show greeting after delay
      if (config.greeting) {
        setTimeout(() => {
          const greeting = shadowRoot?.querySelector('.gg-greeting-tooltip');
          if (greeting && !isOpen) {
            greeting.classList.add('visible');

            // Hide after 10 seconds
            setTimeout(() => {
              greeting.classList.remove('visible');
            }, 10000);
          }
        }, config.greetingDelay);
      }
    }
    // Note: For inline mode, form shows automatically (no special handling needed)

    // Input field handlers
    if (inputField) {
      // Auto-resize textarea
      inputField.addEventListener('input', () => {
        inputField.style.height = 'auto';
        inputField.style.height = Math.min(inputField.scrollHeight, 120) + 'px';
      });

      // Enter to send, Shift+Enter for newline
      inputField.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          if (sendButton && !sendButton.disabled) {
            sendButton.click();
          }
        }
      });
    }

    // Send button handler
    if (sendButton) {
      sendButton.addEventListener('click', () => {
        if (inputField && !inputField.disabled) {
          sendMessage(inputField.value);
        }
      });
    }
  }

  // ============================================================================
  // INITIALIZATION
  // ============================================================================

  function init(userConfig) {
    // Merge user config with defaults
    config = { ...DEFAULT_CONFIG, ...userConfig };

    // Validate required config
    if (!config.apiUrl) {
      console.error('GetGranted Widget: apiUrl is required');
      return;
    }

    // Create host element
    let hostElement;

    if (config.mode === 'inline') {
      // Inline mode: use container specified by user
      if (!config.container) {
        console.error('GetGranted Widget: container is required for inline mode');
        return;
      }

      const containerEl = typeof config.container === 'string'
        ? document.querySelector(config.container)
        : config.container;

      if (!containerEl) {
        console.error('GetGranted Widget: container not found');
        return;
      }

      hostElement = document.createElement('div');
      containerEl.appendChild(hostElement);
    } else {
      // Floating mode: append to body
      // But check if we're on /get-started/ with inline widget present
      if (window.location.pathname.includes('get-started')) {
        const inlinePresent = document.querySelector('[data-getgranted-inline]');
        if (inlinePresent) {
          console.log('GetGranted Widget: Inline widget detected on /get-started/, hiding floating widget');
          return;
        }
      }

      hostElement = document.createElement('div');
      document.body.appendChild(hostElement);
    }

    // Create shadow DOM
    shadowRoot = hostElement.attachShadow({ mode: 'open' });

    // Inject styles
    const styleSheet = document.createElement('div');
    styleSheet.innerHTML = getStyles();
    shadowRoot.appendChild(styleSheet);

    // Create widget UI
    const widgetEl = config.mode === 'floating'
      ? createFloatingWidget()
      : createInlineWidget();

    shadowRoot.appendChild(widgetEl);

    // Store references to key elements
    messagesContainer = shadowRoot.querySelector('.gg-chat-messages');
    inputField = shadowRoot.querySelector('.gg-chat-input');
    sendButton = shadowRoot.querySelector('.gg-send-button');

    // Setup event handlers
    setupEventHandlers();

    console.log('GetGranted Widget initialized:', config.mode);
  }

  // ============================================================================
  // PUBLIC API
  // ============================================================================

  window.GetGrantedWidget = {
    init,
    version: '1.0.0'
  };

})();
