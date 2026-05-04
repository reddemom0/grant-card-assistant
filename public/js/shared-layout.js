/**
 * Granted AI Hub - Shared Layout Component
 * Injects sidebar and header into all agent pages
 */

(function() {
    'use strict';

    // Single source of truth for agents shown in the hub UI.
    // Used to render history filter buttons, map URL slug ↔ backend agent_type,
    // and look up display names. When adding a new agent, only add it here.
    // `inHistoryFilter: false` keeps an agent out of the filter bar but still
    // resolves its display name when its conversations show up under "All".
    const AGENTS_REGISTRY = [
        { urlSlug: 'oracle',               backendType: 'internal-oracle',       displayName: 'Team Oracle',           filterLabel: 'Oracle',     inHistoryFilter: true  },
        { urlSlug: 'grant-cards',          backendType: 'grant-card-generator',  displayName: 'Grant Cards',           filterLabel: 'Grant Cards', inHistoryFilter: true  },
        { urlSlug: 'canexport-claims',     backendType: 'canexport-claims',      displayName: 'Claims Auditor',        filterLabel: 'Claims',     inHistoryFilter: true  },
        { urlSlug: 'etg-writer',           backendType: 'etg-writer',            displayName: 'ETG Business Case',     filterLabel: 'ETG',        inHistoryFilter: true  },
        { urlSlug: 'bcafe-writer',         backendType: 'bcafe-writer',          displayName: 'BCAFE Applications',    filterLabel: 'BCAFE',      inHistoryFilter: true  },
        { urlSlug: 'buybc-writer',         backendType: 'buybc-writer',          displayName: 'Buy BC Partnership',    filterLabel: 'Buy BC',     inHistoryFilter: true  },
        { urlSlug: 'canexport-writer',     backendType: 'canexport-writer',      displayName: 'CanExport Applications', filterLabel: 'CanExport', inHistoryFilter: true  },
        { urlSlug: 'readiness-strategist', backendType: 'readiness-strategist',  displayName: 'Grant Readiness',       filterLabel: 'Readiness',  inHistoryFilter: true  },
        { urlSlug: 'getgranted-ai',        backendType: 'getgranted-ai',         displayName: 'GetGrantedAI',          filterLabel: 'GetGrantedAI', inHistoryFilter: true  },
    ];
    const REGISTRY_BY_BACKEND = Object.fromEntries(AGENTS_REGISTRY.map(a => [a.backendType, a]));
    const REGISTRY_BY_SLUG = Object.fromEntries(AGENTS_REGISTRY.map(a => [a.urlSlug, a]));
    // Expose for unified-agents.html and other pages so they can stay in sync.
    window.AGENTS_REGISTRY = AGENTS_REGISTRY;
    window.getAgentByBackendType = (t) => REGISTRY_BY_BACKEND[t] || null;
    window.getAgentByUrlSlug = (s) => REGISTRY_BY_SLUG[s] || null;

    // Sidebar HTML Template
    const sidebarHTML = `
        <aside class="sidebar">
            <div class="sidebar-header">
                <div class="logo">
                    <img src="/public/images/granted-logo.png" alt="Granted AI" class="logo-image" style="width: 32px; height: 32px; border-radius: 8px;">
                    <div class="logo-text">Granted AI</div>
                </div>
            </div>

            <nav class="nav-section">
                <a href="#" class="nav-item" data-agent="oracle" onclick="window.switchAgent && switchAgent('oracle'); return false;">
                    <svg class="nav-icon" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                    </svg>
                    <span class="nav-label">Oracle</span>
                </a>

                <div class="nav-divider"></div>

                <a href="#" class="nav-item" data-agent="grant-cards" onclick="window.switchAgent && switchAgent('grant-cards'); return false;">
                    <svg class="nav-icon" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                    </svg>
                    <span class="nav-label">Grant Cards</span>
                </a>

                <a href="#" class="nav-item" data-agent="canexport-claims" onclick="window.switchAgent && switchAgent('canexport-claims'); return false;">
                    <svg class="nav-icon" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
                    </svg>
                    <span class="nav-label">Claims</span>
                </a>

                <a href="#" class="nav-item" data-agent="etg-writer" onclick="window.switchAgent && switchAgent('etg-writer'); return false;">
                    <svg class="nav-icon" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                    </svg>
                    <span class="nav-label">ETG</span>
                </a>

                <a href="#" class="nav-item" data-agent="bcafe-writer" onclick="window.switchAgent && switchAgent('bcafe-writer'); return false;">
                    <svg class="nav-icon" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" />
                    </svg>
                    <span class="nav-label">BCAFE</span>
                </a>

                <a href="#" class="nav-item" data-agent="buybc-writer" onclick="window.switchAgent && switchAgent('buybc-writer'); return false;">
                    <svg class="nav-icon" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 00-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 00-16.536-1.84M7.5 14.25L5.106 5.272M6 20.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm12.75 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
                    </svg>
                    <span class="nav-label">Buy BC</span>
                </a>

                <a href="#" class="nav-item" data-agent="canexport-writer" onclick="window.switchAgent && switchAgent('canexport-writer'); return false;">
                    <svg class="nav-icon" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M20.893 13.393l-1.135-1.135a2.252 2.252 0 01-.421-.585l-1.08-2.16a.414.414 0 00-.663-.107.827.827 0 01-.812.21l-1.273-.363a.89.89 0 00-.738 1.595l.587.39c.59.395.674 1.23.172 1.732l-.2.2c-.212.212-.33.498-.33.796v.41c0 .409-.11.809-.32 1.158l-1.315 2.191a2.11 2.11 0 01-1.81 1.025 1.055 1.055 0 01-1.055-1.055v-1.172c0-.92-.56-1.747-1.414-2.089l-.655-.261a2.25 2.25 0 01-1.383-2.46l.007-.042a2.25 2.25 0 01.29-.787l.09-.15a2.25 2.25 0 012.37-1.048l1.178.236a1.125 1.125 0 001.302-.795l.208-.73a1.125 1.125 0 00-.578-1.315l-.665-.332-.091.091a2.25 2.25 0 01-1.591.659h-.18c-.249 0-.487.1-.662.274a.931.931 0 01-1.458-1.137l1.411-2.353a2.25 2.25 0 00.286-.76m11.928 9.869A9 9 0 008.965 3.525m11.928 9.868A9 9 0 118.965 3.525" />
                    </svg>
                    <span class="nav-label">CanExport</span>
                </a>

                <a href="#" class="nav-item" data-agent="readiness-strategist" onclick="window.switchAgent && switchAgent('readiness-strategist'); return false;">
                    <svg class="nav-icon" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span class="nav-label">Readiness</span>
                </a>

                <a href="#" class="nav-item" data-agent="getgranted-ai" onclick="window.switchAgent && switchAgent('getgranted-ai'); return false;">
                    <svg class="nav-icon" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 01-1.043 3.296 3.745 3.745 0 01-3.296 1.043A3.745 3.745 0 0112 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 01-3.296-1.043 3.745 3.745 0 01-1.043-3.296A3.745 3.745 0 013 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 011.043-3.296 3.746 3.746 0 013.296-1.043A3.746 3.746 0 0112 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 013.296 1.043 3.746 3.746 0 011.043 3.296A3.745 3.745 0 0121 12z" />
                    </svg>
                    <span class="nav-label">GetGrantedAI</span>
                </a>

                <div class="nav-divider"></div>

                <a href="/admin/conversations" class="nav-item">
                    <svg class="nav-icon" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5M9 11.25v1.5M12 9v3.75m3-6v6" />
                    </svg>
                    <span class="nav-label">Lead Gen Dashboard</span>
                </a>

                <div class="nav-divider"></div>

                <a href="#" class="nav-item" onclick="showHistory(); return false;">
                    <svg class="nav-icon" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span class="nav-label">History</span>
                </a>

                <a href="/usage-analytics" class="nav-item">
                    <svg class="nav-icon" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
                    </svg>
                    <span class="nav-label">Analytics</span>
                </a>

                <a href="/feedback-metrics" class="nav-item">
                    <svg class="nav-icon" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
                    </svg>
                    <span class="nav-label">Feedback</span>
                </a>
            </nav>

            <div class="sidebar-footer">
                <div class="user-profile-wrapper" style="position: relative;">
                    <div class="user-profile" onclick="toggleUserMenu(event)">
                        <img class="user-avatar" id="shared-user-avatar" src="" alt="">
                        <div class="user-info">
                            <div class="user-name" id="shared-user-name">Loading...</div>
                            <div class="user-role">Pro</div>
                        </div>
                        <svg class="user-menu-chevron" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="width: 14px; height: 14px; color: var(--text-tertiary); flex-shrink: 0;">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
                        </svg>
                    </div>
                    <div id="user-menu-dropdown" class="user-menu-dropdown" style="display: none; position: absolute; bottom: calc(100% + 4px); left: 0.75rem; right: 0.75rem; background: var(--surface, #fff); border: 1px solid var(--border, #e5e5e5); border-radius: 10px; box-shadow: 0 8px 24px rgba(0,0,0,0.12); padding: 0.25rem; z-index: 1000;">
                        <button type="button" class="user-menu-item" onclick="logout()" style="display: flex; align-items: center; gap: 0.625rem; width: 100%; padding: 0.625rem 0.75rem; background: none; border: none; border-radius: 6px; color: var(--text-primary, #111); font-size: 0.875rem; text-align: left; cursor: pointer;">
                            <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="width: 16px; height: 16px;">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
                            </svg>
                            <span>Sign out</span>
                        </button>
                    </div>
                </div>
            </div>
        </aside>
    `;

    // Header HTML Template
    const headerHTML = `
        <header class="app-header">
            <div class="header-left">
                <button class="new-chat-btn" onclick="startNewChat()">
                    <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="width: 16px; height: 16px;">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                    </svg>
                    New Chat
                </button>
            </div>
            <div class="header-right">
                <button class="theme-toggle" onclick="toggleTheme()">
                    <svg class="sun-icon" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" />
                    </svg>
                    <svg class="moon-icon" style="display: none;" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z" />
                    </svg>
                </button>
            </div>
        </header>
    `;

    // History Modal HTML Template
    const historyModalHTML = `
        <div id="history-modal" class="history-modal" style="display: none;">
            <div class="history-modal-backdrop" onclick="closeHistory()"></div>
            <div class="history-modal-content">
                <div class="history-modal-header">
                    <h2>Conversation History</h2>
                    <button class="history-modal-close" onclick="closeHistory()">
                        <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="width: 20px; height: 20px;">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>
                <div class="history-modal-filters">
                    <button class="history-filter-btn active" onclick="filterHistory('all', event)">All</button>
                    ${AGENTS_REGISTRY.filter(a => a.inHistoryFilter).map(a =>
                        `<button class="history-filter-btn" onclick="filterHistory('${a.backendType}', event)">${a.filterLabel}</button>`
                    ).join('')}
                </div>
                <div id="history-conversations" class="history-conversations">
                    <div class="history-loading">
                        <div class="history-spinner"></div>
                        <div>Loading conversations...</div>
                    </div>
                </div>
            </div>
        </div>
    `;

    // Initialize when DOM is ready
    function init() {
        // Inject sidebar and header
        const body = document.body;

        // Wrap existing content
        const existingContent = body.innerHTML;
        body.innerHTML = '';

        // Create container
        const container = document.createElement('div');
        container.className = 'app-container';

        // Add sidebar
        container.innerHTML = sidebarHTML;

        // Create main content wrapper
        const mainContent = document.createElement('div');
        mainContent.className = 'main-content';

        // Add header
        mainContent.innerHTML = headerHTML;

        // Add original content
        const contentWrapper = document.createElement('div');
        contentWrapper.className = 'page-content';
        contentWrapper.innerHTML = existingContent;
        mainContent.appendChild(contentWrapper);

        container.appendChild(mainContent);
        body.appendChild(container);

        // Add history modal to body
        const historyModalContainer = document.createElement('div');
        historyModalContainer.innerHTML = historyModalHTML;
        body.appendChild(historyModalContainer.firstElementChild);

        // Load user info
        loadUserInfo();

        // Set active nav item
        updateActiveNav();

        // Load theme preference
        loadTheme();
    }

    // User info
    function loadUserInfo() {
        const cookies = document.cookie.split(';');
        const authCookie = cookies.find(c => c.trim().startsWith('granted_session='));
        if (!authCookie) return;

        const token = authCookie.split('=')[1];
        try {
            const payload = token.split('.')[1];
            const userInfo = JSON.parse(atob(payload));

            const userName = document.getElementById('shared-user-name');
            const userAvatar = document.getElementById('shared-user-avatar');

            if (userName) {
                userName.textContent = userInfo.name || userInfo.email;
            }

            if (userAvatar && userInfo.picture) {
                userAvatar.src = userInfo.picture;
            }
        } catch (e) {
            console.error('Error loading user info:', e);
        }
    }

    // Update active nav item
    window.updateActiveNav = function() {
        const path = window.location.pathname;
        const agentType = path.split('/')[1] || 'oracle';

        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.remove('active');
            const itemAgent = item.getAttribute('data-agent');
            if (itemAgent === agentType) {
                item.classList.add('active');
            }
        });
    };

    // Theme functions
    window.toggleTheme = function() {
        const body = document.body;
        const sunIcon = document.querySelector('.sun-icon');
        const moonIcon = document.querySelector('.moon-icon');

        body.classList.toggle('light-mode');
        const isLight = body.classList.contains('light-mode');

        if (sunIcon && moonIcon) {
            sunIcon.style.display = isLight ? 'none' : 'block';
            moonIcon.style.display = isLight ? 'block' : 'none';
        }

        localStorage.setItem('theme', isLight ? 'light' : 'dark');
    };

    function loadTheme() {
        const savedTheme = localStorage.getItem('theme');
        if (savedTheme === 'light') {
            window.toggleTheme();
        }
    }

    // Other global functions
    window.startNewChat = function() {
        const currentAgent = window.location.pathname.split('/')[1];
        if (currentAgent) {
            window.location.href = `/${currentAgent}/new`;
        } else {
            window.location.href = '/oracle/new';
        }
    };

    window.showHistory = async function() {
        const modal = document.getElementById('history-modal');
        modal.style.display = 'flex';

        // Load conversations
        await loadConversations();
    };

    window.closeHistory = function() {
        const modal = document.getElementById('history-modal');
        modal.style.display = 'none';
    };

    let allConversations = [];
    let currentFilter = 'all';

    async function loadConversations() {
        const container = document.getElementById('history-conversations');
        container.innerHTML = '<div class="history-loading"><div class="history-spinner"></div><div>Loading conversations...</div></div>';

        try {
            console.log('📥 Fetching conversations from /api/conversations');
            const response = await fetch('/api/conversations', {
                credentials: 'include'
            });

            console.log('📥 Response status:', response.status, response.statusText);

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
                console.error('❌ Failed to load conversations:', errorData);
                throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();
            console.log('✅ Loaded conversations:', data);
            allConversations = data.conversations || [];

            renderConversations();
        } catch (error) {
            console.error('Error loading conversations:', error);
            container.innerHTML = `<div class="history-error">Failed to load conversations: ${error.message}<br><br>Please check console for details.</div>`;
        }
    }

    window.filterHistory = function(agentType, evt) {
        currentFilter = agentType;

        // Update active filter button
        document.querySelectorAll('.history-filter-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        const target = (evt && evt.target) || (typeof event !== 'undefined' && event.target);
        if (target) target.classList.add('active');

        renderConversations();
    };

    function renderConversations() {
        const container = document.getElementById('history-conversations');

        // Filter conversations
        const filtered = currentFilter === 'all'
            ? allConversations
            : allConversations.filter(c => c.agentType === currentFilter);

        if (filtered.length === 0) {
            container.innerHTML = '<div class="history-empty">No conversations found.</div>';
            return;
        }

        // Group by agent type
        const grouped = {};
        filtered.forEach(conv => {
            if (!grouped[conv.agentType]) {
                grouped[conv.agentType] = [];
            }
            grouped[conv.agentType].push(conv);
        });

        // Render
        let html = '';
        Object.keys(grouped).forEach(agentType => {
            const agentName = getAgentDisplayName(agentType);
            const conversations = grouped[agentType];

            html += `<div class="history-group">`;
            if (currentFilter === 'all') {
                html += `<div class="history-group-title">${agentName}</div>`;
            }

            conversations.forEach((conv, index) => {
                const timeAgo = formatTimeAgo(conv.updatedAt || conv.createdAt);
                const delay = index * 0.05; // Stagger by 50ms
                html += `
                    <div class="history-item" onclick="loadHistoryConversation('${conv.id}', '${conv.agentType}')" style="animation-delay: ${delay}s">
                        <div class="history-item-title">${conv.title}</div>
                        <div class="history-item-meta">
                            <span>${conv.messageCount} messages</span>
                            <span>•</span>
                            <span>${timeAgo}</span>
                        </div>
                    </div>
                `;
            });

            html += `</div>`;
        });

        container.innerHTML = html;
    }

    window.loadHistoryConversation = function(conversationId, agentType) {
        const entry = REGISTRY_BY_BACKEND[agentType];
        if (!entry) {
            console.warn('[HISTORY] Unknown agent type, cannot resume conversation:', agentType);
            alert(`Cannot open this conversation — unknown agent type "${agentType}". This usually means the agent has been renamed or removed.`);
            return;
        }
        closeHistory();
        window.location.href = `/${entry.urlSlug}/chat/${conversationId}`;
    };

    function getAgentDisplayName(agentType) {
        const entry = REGISTRY_BY_BACKEND[agentType];
        return entry ? entry.displayName : agentType;
    }

    function formatTimeAgo(timestamp) {
        const date = new Date(timestamp);
        const now = new Date();
        const seconds = Math.floor((now - date) / 1000);

        if (seconds < 60) return 'just now';
        if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
        if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
        if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;

        return date.toLocaleDateString();
    }

    window.toggleUserMenu = function(evt) {
        if (evt) evt.stopPropagation();
        const dropdown = document.getElementById('user-menu-dropdown');
        if (!dropdown) return;
        const isOpen = dropdown.style.display !== 'none';
        dropdown.style.display = isOpen ? 'none' : 'block';
        if (!isOpen) {
            // Close on outside click — registered after this tick so the opening click doesn't immediately close it.
            setTimeout(() => {
                document.addEventListener('click', closeUserMenuOnce, { once: true });
            }, 0);
        }
    };

    function closeUserMenuOnce(evt) {
        const dropdown = document.getElementById('user-menu-dropdown');
        const wrapper = dropdown && dropdown.closest('.user-profile-wrapper');
        if (dropdown && wrapper && !wrapper.contains(evt.target)) {
            dropdown.style.display = 'none';
        }
    }

    window.logout = async function() {
        try {
            await fetch('/api/logout', { method: 'POST', credentials: 'include' });
        } catch (e) {
            console.error('[LOGOUT] Request failed:', e);
        }
        // Best-effort client-side cookie clear in case the server response was lost.
        document.cookie = 'granted_session=; Path=/; Max-Age=0; SameSite=Lax';
        window.location.href = '/login';
    };

    // Run init when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
