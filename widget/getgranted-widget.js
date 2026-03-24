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

  // Dropdown options for form
  const PROVINCES = [
    "Alberta", "British Columbia", "Manitoba", "New Brunswick",
    "Newfoundland & Labrador", "Nova Scotia", "Ontario",
    "Prince Edward Island", "Quebec", "Saskatchewan",
    "Northwest Territories", "Nunavut", "Yukon"
  ];

  // Canonical industry list matching rate tables exactly (from data/rates/industry-groups.json)
  const INDUSTRIES = {
    categories: [
      {
        header: "Professional Services & Services",
        industries: [
          "Accounting",
          "Advertising/Marketing",
          "Alternative Medicine",
          "Arts & Culture",
          "Association",
          "Auto Repairs & Auto Parts",
          "Automotive Dealers",
          "Auxiliary Services",
          "Charity/Non-Profit",
          "Consulting - Business",
          "Consumer Services",
          "Educational Services",
          "Esthetics & Spas",
          "Film/Music/Entertainment",
          "Financial",
          "Healthcare",
          "Healthcare - Dental",
          "Healthcare - Physio",
          "Hospitality/Lodging/Tourism",
          "Insurance",
          "Legal",
          "Media - Broadcast",
          "Media - Podcast",
          "Media - Print/Publishing",
          "Public Relations",
          "Real Estate",
          "Recreation",
          "Restaurants/Cafes",
          "Retail",
          "Social Enterprise",
          "Travel",
          "Utilities",
          "Veterinary",
          "Warehousing",
          "Wellness",
          "Wellness - Counselling/Therapy",
          "Wellness - Fitness",
          "Wellness - Registered Practitioner",
          "Wholesaling"
        ]
      },
      {
        header: "Agriculture",
        industries: [
          "Agriculture - Crop",
          "Agriculture - Dairy",
          "Agriculture - Livestock",
          "Agriculture - Tree Fruit",
          "Agriculture - Vineyard/Wine"
        ]
      },
      {
        header: "Construction & Supply Chain",
        industries: [
          "Architecture/Design",
          "Construction",
          "Construction Supplier",
          "Engineering",
          "Logistics/Trucking"
        ]
      },
      {
        header: "Manufacturing",
        industries: [
          "Apparel/Textiles (Manufacturing)",
          "Consumer Goods (Manufacturing)",
          "Electronic (Manufacturing)",
          "Food Processing",
          "Food/Beverage (Manufacturing)",
          "Healthcare - Manufacturing",
          "Industrial (Manufacturing)",
          "Manufacturing",
          "Metal (Manufacturing)",
          "Paper/Print (Manufacturing)",
          "Plastics (Manufacturing)",
          "Wood Products (Manufacturing)"
        ]
      },
      {
        header: "Natural Resources / CleanTech",
        industries: [
          "Environmental - Education",
          "Environmental - Green Technologies",
          "Environmental - Waste Management",
          "Fishery",
          "Forestry",
          "Mining/Quarrying",
          "Oil & Gas Extraction",
          "Ship Building & Repair/Maritime Operations"
        ]
      },
      {
        header: "Technology",
        industries: [
          "Animation",
          "Aviation & Aerospace",
          "Biotechnology",
          "Computer/Network Security",
          "E-Commerce",
          "Healthcare - Technology",
          "Tech - AI",
          "Tech - Hardware",
          "Tech - Software/Web Development",
          "Technology",
          "Video Games"
        ]
      },
      {
        header: "Other",
        industries: [
          "Other"
        ]
      }
    ]
  };

  const REVENUE_RANGES = [
    "Pre-revenue",
    "Under $500K",
    "$500K – $2.5M",
    "$2.5M – $5M",
    "$5M+"
  ];

  const EMPLOYEE_RANGES = [
    "Just me",
    "1 – 4",
    "5 – 19",
    "20 – 49",
    "50 – 99",
    "100 – 499",
    "500+"
  ];

  const HIRING_OPTIONS = [
    "Not hiring right now",
    "1 – 2 people",
    "3 – 5 people",
    "6 – 10 people",
    "10+"
  ];

  const BUDGET_OPTIONS = [
    "None planned",
    "Under $10K",
    "$10K – $25K",
    "$25K – $50K",
    "$50K – $100K",
    "$100K+"
  ];

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
  let currentPage = 1; // Form page state (1 or 2)
  let hasReceivedFirstMessage = false; // Track first agent message for quick actions
  let lastSuggestions = []; // Store parsed suggestions from agent's last response

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

  function sanitizeHtml(html) {
    // Whitelist safe HTML tags for assistant messages
    // Agent uses <strong>, <br>, <a href>, and inline styles
    const div = document.createElement('div');
    div.innerHTML = html;

    // Remove all script tags
    const scripts = div.querySelectorAll('script');
    scripts.forEach(s => s.remove());

    // Remove event handler attributes
    div.querySelectorAll('*').forEach(el => {
      for (let attr of el.attributes) {
        if (attr.name.startsWith('on')) {
          el.removeAttribute(attr.name);
        }
      }
    });

    // Add target="_blank" and rel="noopener noreferrer" to all links
    // so they open in new tab instead of navigating away from chat
    div.querySelectorAll('a').forEach(link => {
      link.setAttribute('target', '_blank');
      link.setAttribute('rel', 'noopener noreferrer');
    });

    return div.innerHTML;
  }

  function formatMessage(text) {
    // Convert newlines to <br> tags for display
    return escapeHtml(text).replace(/\n/g, '<br>');
  }

  function parseSuggestions(html) {
    // Parse and extract suggestions metadata from agent response
    // Format: <!--suggestions:["q1","q2","q3"]-->
    const suggestionRegex = /<!--suggestions:\s*(\[.*?\])\s*-->/;
    const match = html.match(suggestionRegex);

    if (match && match[1]) {
      try {
        const suggestions = JSON.parse(match[1]);
        if (Array.isArray(suggestions)) {
          lastSuggestions = suggestions;
          // Remove the suggestions metadata from the text
          return html.replace(suggestionRegex, '');
        }
      } catch (e) {
        console.error('Failed to parse suggestions:', e);
      }
    }

    return html;
  }

  function formatAssistantMessage(html) {
    // Assistant messages may contain safe HTML like <strong>, <br>, <a>
    // First parse and remove suggestions metadata
    html = parseSuggestions(html);
    // Then sanitize but don't escape - allow whitelisted tags to render
    return sanitizeHtml(html).replace(/\n/g, '<br>');
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
          min-width: 250px;
          max-width: 300px;
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
          width: 440px;
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
          padding: 12px 20px;
          border-radius: 12px 12px 0 0;
          display: flex;
          align-items: center;
          gap: 12px;
          flex-shrink: 0;
        }

        .gg-chat-header-avatar {
          width: 32px;
          height: 32px;
          background: rgba(255, 255, 255, 0.2);
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: bold;
          font-size: 16px;
        }

        .gg-chat-header-text h3 {
          font-size: 15px;
          font-weight: 600;
          margin: 0 0 2px 0;
        }

        .gg-chat-header-text p {
          font-size: 12px;
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

        .gg-loading-dots {
          display: inline-block;
        }

        .gg-loading-dots span {
          animation: loadingFade 1.4s infinite;
          opacity: 0;
        }

        .gg-loading-dots span:nth-child(1) {
          animation-delay: 0s;
        }

        .gg-loading-dots span:nth-child(2) {
          animation-delay: 0.2s;
        }

        .gg-loading-dots span:nth-child(3) {
          animation-delay: 0.4s;
        }

        @keyframes loadingFade {
          0%, 100% {
            opacity: 0;
          }
          50% {
            opacity: 1;
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

        .gg-summary-bar {
          padding: 8px 20px 12px 20px;
          border-top: 1px solid ${BRAND_COLORS.lightGrey};
          flex-shrink: 0;
          display: flex;
          justify-content: center;
        }

        .gg-summary-button {
          max-width: 280px;
          padding: 8px 14px;
          background: white;
          border: 1.5px solid ${BRAND_COLORS.primary};
          border-radius: 8px;
          color: ${BRAND_COLORS.primary};
          font-size: 14px;
          font-weight: 600;
          font-family: inherit;
          cursor: pointer;
          transition: all 0.2s ease;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
        }

        .gg-summary-button:hover:not(:disabled) {
          background: ${BRAND_COLORS.primaryLight};
        }

        .gg-summary-button:disabled {
          border-color: ${BRAND_COLORS.lightGrey};
          color: ${BRAND_COLORS.grey};
          cursor: not-allowed;
          background: ${BRAND_COLORS.lightBg};
        }

        .gg-summary-button.sent {
          background: #f0fdf4;
          border-color: #22c55e;
          color: #16a34a;
          cursor: default;
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
        .gg-form-field input[type="url"],
        .gg-form-field textarea {
          border: 1px solid ${BRAND_COLORS.lightGrey};
          border-radius: 6px;
          padding: 10px 12px;
          font-size: 14px;
          font-family: inherit;
          outline: none;
          transition: border-color 0.2s ease;
        }

        .gg-form-field textarea {
          resize: vertical;
          min-height: 70px;
          line-height: 1.5;
        }

        .gg-form-field input:focus,
        .gg-form-field textarea:focus {
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

        /* =================================================================== */
        /* TWO-PAGE FORM STYLES */
        /* =================================================================== */

        .gg-step-indicator {
          display: flex;
          justify-content: center;
          gap: 8px;
          margin-bottom: 20px;
        }

        .gg-step {
          height: 4px;
          background: ${BRAND_COLORS.lightGrey};
          border-radius: 2px;
          transition: all 0.3s ease;
        }

        .gg-step.inactive {
          width: 32px;
        }

        .gg-step.active {
          width: 48px;
          background: ${BRAND_COLORS.primary};
        }

        .gg-form-page {
          display: none;
        }

        .gg-form-page.active {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .gg-form-field select {
          border: 1px solid ${BRAND_COLORS.lightGrey};
          border-radius: 6px;
          padding: 10px 12px;
          font-size: 14px;
          font-family: inherit;
          outline: none;
          transition: border-color 0.2s ease;
          background: white;
          cursor: pointer;
          appearance: none;
          background-image: url("data:image/svg+xml,%3Csvg width='12' height='8' viewBox='0 0 12 8' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1L6 6L11 1' stroke='%236d7881' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
          background-repeat: no-repeat;
          background-position: right 12px center;
          padding-right: 36px;
        }

        .gg-form-field select:focus {
          border-color: ${BRAND_COLORS.primary};
        }

        .gg-form-field select.error {
          border-color: #dc2626;
        }

        .gg-form-field select option:first-child {
          color: ${BRAND_COLORS.grey};
        }

        .gg-form-field select[multiple] {
          min-height: 120px;
          padding: 8px;
        }

        .gg-form-field select[multiple] option {
          padding: 6px 8px;
          border-radius: 4px;
          margin-bottom: 2px;
        }

        .gg-form-field select[multiple] option:checked {
          background: ${BRAND_COLORS.primaryLight};
          color: ${BRAND_COLORS.primary};
          font-weight: 600;
        }

        /* Combobox (searchable dropdown) styles */
        .gg-combobox-wrapper {
          position: relative;
        }

        .gg-combobox-input {
          width: 100%;
          border: 1px solid ${BRAND_COLORS.lightGrey};
          border-radius: 6px;
          padding: 10px 36px 10px 12px;
          font-size: 14px;
          font-family: inherit;
          outline: none;
          transition: border-color 0.2s ease;
          cursor: text;
          background: white;
          background-image: url("data:image/svg+xml,%3Csvg width='12' height='8' viewBox='0 0 12 8' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1L6 6L11 1' stroke='%236d7881' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
          background-repeat: no-repeat;
          background-position: right 12px center;
        }

        .gg-combobox-input:focus {
          border-color: ${BRAND_COLORS.primary};
        }

        .gg-combobox-input.error {
          border-color: #dc2626;
        }

        .gg-combobox-input[aria-expanded="true"] {
          border-bottom-left-radius: 0;
          border-bottom-right-radius: 0;
          border-bottom-color: ${BRAND_COLORS.primary};
        }

        .gg-combobox-dropdown {
          position: absolute;
          top: 100%;
          left: 0;
          right: 0;
          max-height: 320px;
          overflow-y: auto;
          background: white;
          border: 1px solid ${BRAND_COLORS.primary};
          border-top: none;
          border-radius: 0 0 6px 6px;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
          z-index: 1000;
          display: none;
        }

        .gg-combobox-dropdown.open {
          display: block;
        }

        .gg-industry-header {
          padding: 8px 12px 6px 12px;
          font-size: 12px;
          font-weight: 600;
          color: ${BRAND_COLORS.grey};
          text-transform: uppercase;
          letter-spacing: 0.5px;
          background: ${BRAND_COLORS.lightBg};
          border-bottom: 1px solid ${BRAND_COLORS.lightGrey};
          cursor: default;
          user-select: none;
        }

        .gg-industry-header:not(:first-child) {
          border-top: 1px solid ${BRAND_COLORS.lightGrey};
        }

        .gg-industry-option {
          padding: 10px 12px;
          font-size: 14px;
          color: ${BRAND_COLORS.dark};
          cursor: pointer;
          transition: background 0.15s ease;
          user-select: none;
        }

        .gg-industry-option:hover {
          background: ${BRAND_COLORS.primaryLight};
          color: ${BRAND_COLORS.primary};
        }

        .gg-industry-option.selected {
          background: ${BRAND_COLORS.primaryLight};
          color: ${BRAND_COLORS.primary};
          font-weight: 600;
        }

        .gg-industry-option.hidden {
          display: none;
        }

        .gg-combobox-dropdown::-webkit-scrollbar {
          width: 6px;
        }

        .gg-combobox-dropdown::-webkit-scrollbar-track {
          background: transparent;
        }

        .gg-combobox-dropdown::-webkit-scrollbar-thumb {
          background: ${BRAND_COLORS.lightGrey};
          border-radius: 3px;
        }

        .gg-combobox-dropdown::-webkit-scrollbar-thumb:hover {
          background: ${BRAND_COLORS.grey};
        }

        /* Mobile: full-height dropdown on small screens */
        @media (max-width: 480px) {
          .gg-combobox-dropdown {
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: calc(100vw - 32px);
            max-height: 70vh;
            border-radius: 12px;
            border-top: 1px solid ${BRAND_COLORS.primary};
          }

          .gg-combobox-input[aria-expanded="true"] {
            border-radius: 6px;
          }
        }

        .gg-conditional-fields {
          display: none;
          flex-direction: column;
          gap: 16px;
          margin-top: 12px;
          padding: 16px;
          background: ${BRAND_COLORS.lightBg};
          border-radius: 6px;
          border: 1px solid ${BRAND_COLORS.lightGrey};
        }

        .gg-conditional-fields.visible {
          display: flex;
        }

        .gg-form-hint {
          font-size: 12px;
          color: ${BRAND_COLORS.grey};
          margin-top: -2px;
        }

        .gg-form-section-label {
          font-size: 12px;
          font-weight: 600;
          color: ${BRAND_COLORS.grey};
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin-top: 8px;
          padding-bottom: 8px;
          border-bottom: 1px solid ${BRAND_COLORS.lightGrey};
        }

        .gg-form-info-banner {
          background: ${BRAND_COLORS.primaryLight};
          border: 1px solid rgba(0, 138, 191, 0.2);
          border-radius: 6px;
          padding: 12px;
          font-size: 13px;
          color: ${BRAND_COLORS.dark};
          display: flex;
          gap: 8px;
          align-items: flex-start;
        }

        .gg-form-info-banner-icon {
          font-size: 16px;
          flex-shrink: 0;
        }

        .gg-form-buttons {
          display: flex;
          gap: 10px;
          margin-top: 8px;
        }

        .gg-form-back {
          flex: 1;
          background: ${BRAND_COLORS.lightBg};
          color: ${BRAND_COLORS.grey};
          border: 1px solid ${BRAND_COLORS.lightGrey};
          border-radius: 8px;
          padding: 12px 24px;
          font-size: 15px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .gg-form-back:hover {
          background: ${BRAND_COLORS.lightGrey};
        }

        .gg-form-next,
        .gg-form-submit.in-page-2 {
          flex: 2;
        }

        .gg-form-privacy {
          text-align: center;
          font-size: 12px;
          color: ${BRAND_COLORS.grey};
          margin-top: 4px;
        }
      </style>
    `;
  }

  // ============================================================================
  // UI COMPONENTS
  // ============================================================================

  function createDropdownOptions(options, placeholder = "Select...") {
    let html = `<option value="" disabled selected>${placeholder}</option>`;
    options.forEach(option => {
      html += `<option value="${escapeHtml(option)}">${escapeHtml(option)}</option>`;
    });
    return html;
  }

  function createIndustryCombobox() {
    // Return empty dropdown - industries will be lazy-loaded on first interaction
    return `
      <div class="gg-combobox-wrapper">
        <input
          type="text"
          id="gg-industry-input"
          class="gg-combobox-input"
          placeholder="Search industries..."
          autocomplete="off"
          role="combobox"
          aria-expanded="false"
          aria-autocomplete="list"
        />
        <input type="hidden" id="gg-industry" />
        <div class="gg-combobox-dropdown" id="gg-industry-dropdown" role="listbox">
          <!-- Industries loaded on first interaction -->
        </div>
      </div>
    `;
  }

  function loadIndustryOptions(dropdown) {
    // Generate HTML for all industries
    let optionsHtml = '';

    INDUSTRIES.categories.forEach(category => {
      // Add category header (not selectable)
      optionsHtml += `<div class="gg-industry-header">${escapeHtml(category.header)}</div>`;

      // Add industries in this category
      category.industries.forEach(industry => {
        optionsHtml += `
          <div class="gg-industry-option" data-value="${escapeHtml(industry)}" data-category="${escapeHtml(category.header)}">
            ${escapeHtml(industry)}
          </div>
        `;
      });
    });

    dropdown.innerHTML = optionsHtml;
  }

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
        <div class="gg-step-indicator">
          <div class="gg-step active" id="gg-step-1"></div>
          <div class="gg-step inactive" id="gg-step-2"></div>
        </div>

        <div class="gg-form-intro">
          <h3>Get Your Free Grant Estimate</h3>
          <p>Tell us about your company, then our AI Grant Advisor will give you an instant funding estimate.</p>
        </div>

        <!-- PAGE 1: Contact + Company -->
        <div class="gg-form-page active" id="gg-form-page-1">
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

          <div class="gg-form-field">
            <label for="gg-industry-input">Industry <span class="required">*</span></label>
            ${createIndustryCombobox()}
            <span class="error-message">Please select your industry</span>
          </div>

          <button type="button" class="gg-form-submit gg-form-next" id="gg-form-next" disabled>Next →</button>
        </div>

        <!-- PAGE 2: Business Profile + Plans -->
        <div class="gg-form-page" id="gg-form-page-2">
          <p style="font-size: 14px; color: ${BRAND_COLORS.grey}; margin-bottom: 8px;">Almost there — a few details about your plans so we can match you to the right programs.</p>

          <div class="gg-form-section-label">Your Business</div>

          <div class="gg-form-field">
            <label for="gg-province">Province(s) <span class="required">*</span></label>
            <div class="gg-form-hint">Select all provinces where your company operates</div>
            <select id="gg-province" multiple>
              ${createDropdownOptions(PROVINCES, "Select provinces...")}
            </select>
            <span class="error-message">Please select at least one province</span>
          </div>

          <div class="gg-form-field">
            <label for="gg-revenue">Annual Revenue <span class="required">*</span></label>
            <div class="gg-form-hint">Last completed fiscal year</div>
            <select id="gg-revenue">
              ${createDropdownOptions(REVENUE_RANGES)}
            </select>
            <span class="error-message">Please select your revenue range</span>
          </div>

          <div class="gg-form-field">
            <label for="gg-employees">Full-Time Employees <span class="required">*</span></label>
            <select id="gg-employees">
              ${createDropdownOptions(EMPLOYEE_RANGES)}
            </select>
            <span class="error-message">Please select your employee count</span>
          </div>

          <div class="gg-form-section-label">Your Plans (Next 12 Months)</div>

          <div class="gg-form-info-banner">
            <div class="gg-form-info-banner-icon">💡</div>
            <div>Don't worry about exact numbers. Your AI Grant Advisor will refine the estimate with you after.</div>
          </div>

          <div class="gg-form-field">
            <label for="gg-hiring">Hiring Plans <span class="required">*</span></label>
            <div class="gg-form-hint">Full-time positions you plan to add</div>
            <select id="gg-hiring">
              ${createDropdownOptions(HIRING_OPTIONS)}
            </select>
            <span class="error-message">Please select your hiring plans</span>
          </div>

          <div class="gg-form-field">
            <label for="gg-training">Training Budget</label>
            <div class="gg-form-hint">External courses, certifications, professional development</div>
            <select id="gg-training">
              ${createDropdownOptions(BUDGET_OPTIONS)}
            </select>
          </div>

          <div class="gg-form-field">
            <label for="gg-expansion">Market Expansion</label>
            <div class="gg-form-hint">International sales, trade shows, entering new markets</div>
            <select id="gg-expansion">
              ${createDropdownOptions(BUDGET_OPTIONS)}
            </select>
          </div>

          <div class="gg-form-field">
            <label for="gg-planned-activities">Any specific projects or activities you're looking to get funded?</label>
            <textarea
              id="gg-planned-activities"
              placeholder="e.g., attending a trade show in Europe, hiring a marketing coordinator, buying new equipment, training our team on AI tools..."
              rows="3"
            ></textarea>
            <div class="gg-form-hint">Optional — helps us tailor your estimate</div>
          </div>

          <div class="gg-form-buttons">
            <button type="button" class="gg-form-back" id="gg-form-back">← Back</button>
            <button type="button" class="gg-form-submit in-page-2" id="gg-form-final-submit" disabled>Get My Free Estimate →</button>
          </div>

          <div class="gg-form-privacy">No commitment · Your info stays private</div>
        </div>

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
        <div class="gg-summary-bar">
          <button class="gg-summary-button" id="gg-summary-button" aria-label="Send funding summary to email">
            📧 Send me the funding summary
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
      <div class="gg-message-content">${formatAssistantMessage(text)}</div>
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

  function createEstimateLoadingMessage() {
    const loadingDiv = document.createElement('div');
    loadingDiv.className = 'gg-message gg-message-bot';
    loadingDiv.id = 'gg-estimate-loading';
    loadingDiv.innerHTML = `
      <div class="gg-message-avatar">G</div>
      <div class="gg-message-content">
        Crunching your numbers<span class="gg-loading-dots"><span>.</span><span>.</span><span>.</span></span>
      </div>
    `;
    return loadingDiv;
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
    const quickActionsContainer = shadowRoot?.querySelector('.gg-quick-actions');
    if (!quickActionsContainer) return;

    // Use dynamically parsed suggestions from agent's response
    // If no suggestions were parsed, don't show any quick actions
    if (!lastSuggestions || lastSuggestions.length === 0) {
      quickActionsContainer.innerHTML = '';
      return;
    }

    quickActionsContainer.innerHTML = lastSuggestions
      .map(action => `<button class="gg-quick-action">${escapeHtml(action)}</button>`)
      .join('');

    // Add click handlers
    quickActionsContainer.querySelectorAll('.gg-quick-action').forEach(button => {
      button.addEventListener('click', () => {
        const message = button.textContent;
        sendMessage(message);
        // Quick actions will be removed by sendMessage automatically
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

    // Show user message in UI (skip for hidden init messages and system messages)
    const isSystemMessage = trimmedMessage.startsWith('[SYSTEM:');
    if (!isHidden && !isSystemMessage) {
      addUserMessage(trimmedMessage);
    }

    // Hide quick actions after any user message (manual or quick action click)
    if (!isHidden && !isSystemMessage) {
      const quickActionsContainer = shadowRoot?.querySelector('.gg-quick-actions');
      if (quickActionsContainer) {
        quickActionsContainer.remove();
      }
    }

    // Clear input
    if (inputField) {
      inputField.value = '';
      inputField.style.height = 'auto';
    }

    // Disable input while waiting
    isWaitingForResponse = true;
    setInputEnabled(false);

    // Show typing indicator or estimate loading message
    // For the first hidden "Hi" message, show custom loading text
    const isFirstMessage = (trimmedMessage === 'Hi' && isHidden === true);
    const typingIndicator = isFirstMessage ? createEstimateLoadingMessage() : createTypingIndicator();
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
            // Use innerHTML with sanitization to allow safe HTML tags like <strong>, <br>
            assistantWrapper.querySelector('.gg-message-content').innerHTML = formatAssistantMessage(assistantText);
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
            // Use innerHTML with sanitization to allow safe HTML tags like <strong>, <br>
            assistantWrapper.querySelector('.gg-message-content').innerHTML = formatAssistantMessage(assistantText);
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

      // Show quick actions after every agent message (using parsed suggestions)
      if (assistantText) {
        setTimeout(() => {
          showQuickActions();
        }, 500); // Small delay for smoother UX
      }
    }
  }


  // ============================================================================
  // FORM HANDLING
  // ============================================================================

  function validatePage1() {
    const contactName = shadowRoot?.getElementById('gg-contact-name').value.trim();
    const contactEmail = shadowRoot?.getElementById('gg-contact-email').value.trim();
    const companyName = shadowRoot?.getElementById('gg-company-name').value.trim();
    const companyWebsite = shadowRoot?.getElementById('gg-company-website').value.trim();
    const noWebsite = shadowRoot?.getElementById('gg-no-website').checked;
    const industry = shadowRoot?.getElementById('gg-industry').value;

    let isValid = true;

    // Name validation
    if (!contactName) {
      isValid = false;
    }

    // Email validation
    if (!contactEmail || !contactEmail.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
      isValid = false;
    }

    // Company name validation
    if (!companyName) {
      isValid = false;
    }

    // Website validation (optional if "no website" is checked)
    if (!noWebsite && !companyWebsite) {
      isValid = false;
    }

    // Industry validation (always required)
    if (!industry) {
      isValid = false;
    }

    return isValid;
  }

  function validatePage2() {
    const provinceSelect = shadowRoot?.getElementById('gg-province');
    const selectedProvinces = provinceSelect ? Array.from(provinceSelect.selectedOptions).map(opt => opt.value) : [];
    const revenue = shadowRoot?.getElementById('gg-revenue').value;
    const employees = shadowRoot?.getElementById('gg-employees').value;
    const hiring = shadowRoot?.getElementById('gg-hiring').value;

    return selectedProvinces.length > 0 && revenue && employees && hiring;
  }

  function updateNextButtonState() {
    const nextBtn = shadowRoot?.getElementById('gg-form-next');
    if (nextBtn) {
      nextBtn.disabled = !validatePage1();
    }
  }

  function updateFinalSubmitButtonState() {
    const submitBtn = shadowRoot?.getElementById('gg-form-final-submit');
    if (submitBtn) {
      submitBtn.disabled = !validatePage2();
    }
  }

  function goToPage2() {
    // Validate page 1
    if (!validatePage1()) {
      // Show errors on page 1
      const contactName = shadowRoot?.getElementById('gg-contact-name').value.trim();
      const contactEmail = shadowRoot?.getElementById('gg-contact-email').value.trim();
      const companyName = shadowRoot?.getElementById('gg-company-name').value.trim();
      const companyWebsite = shadowRoot?.getElementById('gg-company-website').value.trim();
      const noWebsite = shadowRoot?.getElementById('gg-no-website').checked;
      const industry = shadowRoot?.getElementById('gg-industry').value;

      if (!contactName) {
        shadowRoot?.getElementById('gg-contact-name').classList.add('error');
      }
      if (!contactEmail || !contactEmail.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
        shadowRoot?.getElementById('gg-contact-email').classList.add('error');
      }
      if (!companyName) {
        shadowRoot?.getElementById('gg-company-name').classList.add('error');
      }
      if (!noWebsite && !companyWebsite) {
        shadowRoot?.getElementById('gg-company-website').classList.add('error');
      }
      if (!industry) {
        // Show error on visible input, not hidden
        shadowRoot?.getElementById('gg-industry-input')?.classList.add('error');
      }

      return;
    }

    // Switch pages
    currentPage = 2;
    shadowRoot?.getElementById('gg-form-page-1')?.classList.remove('active');
    shadowRoot?.getElementById('gg-form-page-2')?.classList.add('active');
    shadowRoot?.getElementById('gg-step-1')?.classList.remove('active');
    shadowRoot?.getElementById('gg-step-1')?.classList.add('inactive');
    shadowRoot?.getElementById('gg-step-2')?.classList.remove('inactive');
    shadowRoot?.getElementById('gg-step-2')?.classList.add('active');

    // Update submit button state
    updateFinalSubmitButtonState();
  }

  function goToPage1() {
    currentPage = 1;
    shadowRoot?.getElementById('gg-form-page-2')?.classList.remove('active');
    shadowRoot?.getElementById('gg-form-page-1')?.classList.add('active');
    shadowRoot?.getElementById('gg-step-2')?.classList.remove('active');
    shadowRoot?.getElementById('gg-step-2')?.classList.add('inactive');
    shadowRoot?.getElementById('gg-step-1')?.classList.remove('inactive');
    shadowRoot?.getElementById('gg-step-1')?.classList.add('active');
  }

  async function submitForm() {
    // Validate page 2
    if (!validatePage2()) {
      // Show errors
      const provinceSelect = shadowRoot?.getElementById('gg-province');
      const selectedProvinces = provinceSelect ? Array.from(provinceSelect.selectedOptions).map(opt => opt.value) : [];
      const revenue = shadowRoot?.getElementById('gg-revenue').value;
      const employees = shadowRoot?.getElementById('gg-employees').value;
      const hiring = shadowRoot?.getElementById('gg-hiring').value;

      if (selectedProvinces.length === 0) {
        shadowRoot?.getElementById('gg-province').classList.add('error');
      }
      if (!revenue) {
        shadowRoot?.getElementById('gg-revenue').classList.add('error');
      }
      if (!employees) {
        shadowRoot?.getElementById('gg-employees').classList.add('error');
      }
      if (!hiring) {
        shadowRoot?.getElementById('gg-hiring').classList.add('error');
      }

      return;
    }

    // Get form references
    const formContainer = shadowRoot?.querySelector('.gg-form-container');
    const chatInterface = shadowRoot?.querySelector('.gg-chat-interface');
    const formLoading = shadowRoot?.querySelector('.gg-form-loading');
    const submitBtn = shadowRoot?.getElementById('gg-form-final-submit');

    // Get all field values from both pages
    const contactName = shadowRoot?.getElementById('gg-contact-name').value.trim();
    const contactEmail = shadowRoot?.getElementById('gg-contact-email').value.trim();
    const companyName = shadowRoot?.getElementById('gg-company-name').value.trim();
    let companyWebsite = shadowRoot?.getElementById('gg-company-website').value.trim();
    const noWebsite = shadowRoot?.getElementById('gg-no-website').checked;
    const provinceSelect = shadowRoot?.getElementById('gg-province');
    const selectedProvinces = provinceSelect ? Array.from(provinceSelect.selectedOptions).map(opt => opt.value) : [];
    const province = selectedProvinces.join(', '); // Join multiple provinces with comma separator
    const industry = shadowRoot?.getElementById('gg-industry').value;

    // Page 2 fields
    const revenue = shadowRoot?.getElementById('gg-revenue').value;
    const employees = shadowRoot?.getElementById('gg-employees').value;
    const hiring = shadowRoot?.getElementById('gg-hiring').value;
    const training = shadowRoot?.getElementById('gg-training').value;
    const expansion = shadowRoot?.getElementById('gg-expansion').value;
    const plannedActivities = shadowRoot?.getElementById('gg-planned-activities').value.trim();

    // If "no website" is checked, set website to null
    if (noWebsite) {
      companyWebsite = null;
    } else {
      // Add https:// protocol if missing
      if (companyWebsite && !companyWebsite.match(/^https?:\/\//i)) {
        companyWebsite = 'https://' + companyWebsite;
      }
    }

    // Prepare form data with all fields
    formData = {
      contact_name: contactName,
      email: contactEmail,
      company_name: companyName,
      company_website: companyWebsite,
      province: province, // Always required from form (page 2)
      industry: industry, // Always required from form (page 1)
      revenue_range: revenue,
      employee_count: employees,
      hiring_plans: hiring,
      training_budget: training || null,
      expansion_budget: expansion || null,
      planned_activities: plannedActivities || null
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

      // Auto-init: send simple greeting (form data already in system prompt via <lead_info>)
      setInputEnabled(false);
      await sendMessage('Hi', true);
      setInputEnabled(true);

      // Quick actions will be shown after first agent response completes

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
    // Next button handler (page 1 → page 2)
    const nextBtn = shadowRoot?.getElementById('gg-form-next');
    if (nextBtn) {
      nextBtn.addEventListener('click', goToPage2);
    }

    // Back button handler (page 2 → page 1)
    const backBtn = shadowRoot?.getElementById('gg-form-back');
    if (backBtn) {
      backBtn.addEventListener('click', goToPage1);
    }

    // Final submit button handler (page 2)
    const finalSubmitBtn = shadowRoot?.getElementById('gg-form-final-submit');
    if (finalSubmitBtn) {
      finalSubmitBtn.addEventListener('click', submitForm);
    }

    // Page 1 field validation listeners
    const page1Fields = [
      shadowRoot?.getElementById('gg-contact-name'),
      shadowRoot?.getElementById('gg-contact-email'),
      shadowRoot?.getElementById('gg-company-name'),
      shadowRoot?.getElementById('gg-company-website')
    ];

    page1Fields.forEach(field => {
      if (field) {
        field.addEventListener('input', () => {
          field.classList.remove('error');
          updateNextButtonState();
        });
        if (field.tagName === 'SELECT') {
          field.addEventListener('change', () => {
            field.classList.remove('error');
            updateNextButtonState();
          });
        }
      }
    });

    // Note: Industry combobox validation handled separately below

    // Page 2 field validation listeners
    const page2Fields = [
      shadowRoot?.getElementById('gg-province'),
      shadowRoot?.getElementById('gg-revenue'),
      shadowRoot?.getElementById('gg-employees'),
      shadowRoot?.getElementById('gg-hiring'),
      shadowRoot?.getElementById('gg-training'),
      shadowRoot?.getElementById('gg-expansion')
    ];

    page2Fields.forEach(field => {
      if (field) {
        field.addEventListener('change', () => {
          field.classList.remove('error');
          updateFinalSubmitButtonState();
        });
      }
    });

    // "No website" checkbox handler
    const noWebsiteCheckbox = shadowRoot?.getElementById('gg-no-website');
    const websiteInput = shadowRoot?.getElementById('gg-company-website');

    if (noWebsiteCheckbox && websiteInput) {
      noWebsiteCheckbox.addEventListener('change', (e) => {
        const isChecked = e.target.checked;

        // Toggle website field
        websiteInput.disabled = isChecked;
        if (isChecked) {
          websiteInput.value = '';
          websiteInput.classList.remove('error');
        }

        updateNextButtonState();
      });
    }

    // Industry combobox handlers with lazy-loading
    const industryInput = shadowRoot?.getElementById('gg-industry-input');
    const industryHidden = shadowRoot?.getElementById('gg-industry');
    const industryDropdown = shadowRoot?.getElementById('gg-industry-dropdown');

    if (industryInput && industryHidden && industryDropdown) {
      let industriesLoaded = false;

      // Helper function to filter industries
      function filterIndustries(query) {
        const normalizedQuery = query.toLowerCase().trim();
        const options = industryDropdown.querySelectorAll('.gg-industry-option');
        const headers = industryDropdown.querySelectorAll('.gg-industry-header');

        if (!normalizedQuery) {
          // Show all
          options.forEach(opt => opt.classList.remove('hidden'));
          headers.forEach(hdr => hdr.style.display = 'block');
          return;
        }

        // Track which categories have visible options
        const visibleCategories = new Set();

        // Filter options
        options.forEach(option => {
          const text = option.textContent.toLowerCase();
          const category = option.getAttribute('data-category');

          if (text.includes(normalizedQuery)) {
            option.classList.remove('hidden');
            visibleCategories.add(category);
          } else {
            option.classList.add('hidden');
          }
        });

        // Hide category headers with no visible options
        headers.forEach(header => {
          const categoryName = header.textContent;
          if (visibleCategories.has(categoryName)) {
            header.style.display = 'block';
          } else {
            header.style.display = 'none';
          }
        });
      }

      // Setup click handlers for industry options (called after lazy-load)
      function setupIndustryOptionHandlers() {
        const industryOptions = industryDropdown.querySelectorAll('.gg-industry-option');
        industryOptions.forEach(option => {
          option.addEventListener('click', () => {
            const value = option.getAttribute('data-value');

            // Update hidden input and display input
            industryHidden.value = value;
            industryInput.value = value;

            // Clear error state
            industryInput.classList.remove('error');

            // Update selected state visually
            industryOptions.forEach(opt => opt.classList.remove('selected'));
            option.classList.add('selected');

            // Close dropdown
            industryInput.setAttribute('aria-expanded', 'false');
            industryDropdown.classList.remove('open');

            // Update validation
            updateNextButtonState();
          });
        });
      }

      // Open dropdown on focus (lazy-load on first open)
      industryInput.addEventListener('focus', () => {
        // Lazy-load industries on first interaction
        if (!industriesLoaded) {
          loadIndustryOptions(industryDropdown);
          setupIndustryOptionHandlers();
          industriesLoaded = true;
        }

        industryInput.setAttribute('aria-expanded', 'true');
        industryDropdown.classList.add('open');
        filterIndustries(''); // Show all initially
      });

      // Prevent click on input from closing dropdown (stop propagation)
      industryInput.addEventListener('mousedown', (e) => {
        // If dropdown is already open, don't let the click close it
        if (industryDropdown.classList.contains('open')) {
          e.stopPropagation();
        }
      });

      // Filter as user types
      industryInput.addEventListener('input', (e) => {
        const query = e.target.value;
        filterIndustries(query);

        // Clear selection if user is typing
        if (industryHidden.value) {
          industryHidden.value = '';
          updateNextButtonState();
        }
      });

      // Close dropdown when clicking outside (listen within shadow root)
      // Use mousedown to catch clicks before they can interfere with focus
      const clickOutsideHandler = (e) => {
        // Get the composedPath to see the actual click target across shadow boundaries
        const path = e.composedPath ? e.composedPath() : [e.target];
        const wrapper = shadowRoot?.querySelector('.gg-combobox-wrapper');

        // Check if click is outside the wrapper using composedPath
        const clickedOutside = wrapper && !path.includes(wrapper) && !wrapper.contains(e.target);

        if (clickedOutside && industryDropdown.classList.contains('open')) {
          industryInput.setAttribute('aria-expanded', 'false');
          industryDropdown.classList.remove('open');
        }
      };

      // Listen on document for clicks outside shadow DOM
      document.addEventListener('mousedown', clickOutsideHandler);

      // Also listen within shadow root for clicks inside shadow DOM
      if (shadowRoot) {
        shadowRoot.addEventListener('mousedown', clickOutsideHandler);
      }
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

    // Summary button handler
    const summaryButton = shadowRoot?.getElementById('gg-summary-button');
    if (summaryButton) {
      summaryButton.addEventListener('click', async () => {
        if (summaryButton.disabled || summaryButton.classList.contains('sent')) {
          return;
        }

        // Disable button and show "Sending..." state
        summaryButton.disabled = true;
        summaryButton.textContent = '⏳ Sending...';

        try {
          // Send system message (hidden from UI)
          await sendMessage('[SYSTEM: User requested email summary]', true);

          // Update button to "sent" state
          summaryButton.classList.add('sent');
          summaryButton.textContent = '✓ Summary sent!';
          summaryButton.disabled = true;

        } catch (error) {
          console.error('Summary request failed:', error);
          // Reset button on error
          summaryButton.disabled = false;
          summaryButton.textContent = '📧 Send me the funding summary';
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
