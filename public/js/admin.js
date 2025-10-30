/**
 * Admin Dashboard JavaScript
 */

// ============================================================================
// STATE
// ============================================================================

const state = {
  currentSection: 'overview',
  currentUser: null,
  users: {
    data: [],
    page: 1,
    totalPages: 1,
    filters: { role: '', isActive: '', search: '' }
  },
  conversations: {
    data: [],
    page: 1,
    totalPages: 1,
    filters: { agentType: '', startDate: '', endDate: '', search: '' }
  },
  audit: {
    data: [],
    page: 1,
    totalPages: 1,
    filters: { action: '' }
  }
};

// ============================================================================
// API CLIENT
// ============================================================================

class AdminAPI {
  constructor() {
    this.baseURL = '/api/admin';
  }

  async request(endpoint, options = {}) {
    try {
      const response = await fetch(`${this.baseURL}${endpoint}`, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...options.headers
        }
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Request failed');
      }

      return data;
    } catch (error) {
      console.error('API Error:', error);
      throw error;
    }
  }

  // Stats
  async getStats() {
    return this.request('/stats');
  }

  // Users
  async getUsers(page = 1, filters = {}) {
    const params = new URLSearchParams({
      page,
      limit: 50,
      ...filters
    });
    return this.request(`/users?${params}`);
  }

  async getUserById(userId) {
    return this.request(`/users/${userId}`);
  }

  async updateUser(userId, updates) {
    return this.request(`/users/${userId}`, {
      method: 'PUT',
      body: JSON.stringify(updates)
    });
  }

  // Conversations
  async searchConversations(page = 1, filters = {}) {
    const params = new URLSearchParams({
      page,
      limit: 50,
      ...filters
    });
    return this.request(`/conversations?${params}`);
  }

  async getConversation(conversationId) {
    return this.request(`/conversations/${conversationId}`);
  }

  async deleteConversation(conversationId) {
    return this.request(`/conversations/${conversationId}`, {
      method: 'DELETE'
    });
  }

  // Errors
  async getErrors(filters = {}) {
    const params = new URLSearchParams(filters);
    return this.request(`/errors?${params}`);
  }

  // Audit Log
  async getAuditLog(page = 1, filters = {}) {
    const params = new URLSearchParams({
      page,
      limit: 100,
      ...filters
    });
    return this.request(`/audit-log?${params}`);
  }

  // Analytics
  async getUsageTrends(days = 7) {
    return this.request(`/analytics/usage-trends?days=${days}`);
  }

  async getCostEstimates(days = 30) {
    return this.request(`/analytics/costs?days=${days}`);
  }

  async getTopUsers(limit = 10, days = 30) {
    return this.request(`/analytics/top-users?limit=${limit}&days=${days}`);
  }

  async getActivityHeatmap(days = 7) {
    return this.request(`/analytics/activity-heatmap?days=${days}`);
  }

  // System
  async getSystemHealth() {
    return this.request('/system/health');
  }

  async getDatabaseStats() {
    return this.request('/system/database');
  }
}

const api = new AdminAPI();

// ============================================================================
// INITIALIZATION
// ============================================================================

document.addEventListener('DOMContentLoaded', async () => {
  await loadCurrentUser();
  setupNavigation();
  setupEventListeners();
  await loadOverviewSection();
});

// ============================================================================
// USER INFO
// ============================================================================

async function loadCurrentUser() {
  try {
    const response = await fetch('/api/current-user');
    if (response.ok) {
      const data = await response.json();
      state.currentUser = data.user;
      document.getElementById('userName').textContent = data.user.name || data.user.email;
      document.getElementById('userAvatar').src = data.user.picture || '/public/images/default-avatar.png';
    }
  } catch (error) {
    console.error('Failed to load current user:', error);
  }
}

// ============================================================================
// NAVIGATION
// ============================================================================

function setupNavigation() {
  const navItems = document.querySelectorAll('.nav-item');

  navItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();

      const section = item.dataset.section;

      // Update active nav item
      navItems.forEach(nav => nav.classList.remove('active'));
      item.classList.add('active');

      // Show section
      showSection(section);
    });
  });
}

async function showSection(section) {
  state.currentSection = section;

  // Hide all sections
  document.querySelectorAll('.dashboard-section').forEach(s => {
    s.classList.remove('active');
  });

  // Show current section
  document.getElementById(`${section}-section`).classList.add('active');

  // Update title
  const titles = {
    overview: 'Overview',
    users: 'User Management',
    conversations: 'Conversations',
    analytics: 'Analytics',
    errors: 'Error Logs',
    system: 'System Health',
    audit: 'Audit Log'
  };
  document.getElementById('sectionTitle').textContent = titles[section];

  // Load section data
  switch (section) {
    case 'overview':
      await loadOverviewSection();
      break;
    case 'users':
      await loadUsersSection();
      break;
    case 'conversations':
      await loadConversationsSection();
      break;
    case 'analytics':
      await loadAnalyticsSection();
      break;
    case 'errors':
      await loadErrorsSection();
      break;
    case 'system':
      await loadSystemSection();
      break;
    case 'audit':
      await loadAuditSection();
      break;
  }
}

// ============================================================================
// EVENT LISTENERS
// ============================================================================

function setupEventListeners() {
  // Refresh button
  document.getElementById('refreshBtn').addEventListener('click', () => {
    showSection(state.currentSection);
    showToast('Refreshed', 'success');
  });

  // User filters
  document.getElementById('userSearch').addEventListener('input', debounce(async (e) => {
    state.users.filters.search = e.target.value;
    state.users.page = 1;
    await loadUsersSection();
  }, 500));

  document.getElementById('roleFilter').addEventListener('change', async (e) => {
    state.users.filters.role = e.target.value;
    state.users.page = 1;
    await loadUsersSection();
  });

  document.getElementById('activeFilter').addEventListener('change', async (e) => {
    state.users.filters.isActive = e.target.value;
    state.users.page = 1;
    await loadUsersSection();
  });

  // Conversation filters
  document.getElementById('conversationSearch').addEventListener('input', debounce(async (e) => {
    state.conversations.filters.search = e.target.value;
    state.conversations.page = 1;
    await loadConversationsSection();
  }, 500));

  document.getElementById('agentTypeFilter').addEventListener('change', async (e) => {
    state.conversations.filters.agentType = e.target.value;
    state.conversations.page = 1;
    await loadConversationsSection();
  });

  document.getElementById('startDateFilter').addEventListener('change', async (e) => {
    state.conversations.filters.startDate = e.target.value;
    state.conversations.page = 1;
    await loadConversationsSection();
  });

  document.getElementById('endDateFilter').addEventListener('change', async (e) => {
    state.conversations.filters.endDate = e.target.value;
    state.conversations.page = 1;
    await loadConversationsSection();
  });

  // Audit filter
  document.getElementById('auditActionFilter').addEventListener('change', async (e) => {
    state.audit.filters.action = e.target.value;
    state.audit.page = 1;
    await loadAuditSection();
  });

  // Modal close buttons
  document.querySelectorAll('.modal-close').forEach(btn => {
    btn.addEventListener('click', () => {
      btn.closest('.modal').classList.remove('active');
    });
  });

  // Close modals on background click
  document.querySelectorAll('.modal').forEach(modal => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.classList.remove('active');
      }
    });
  });
}

// ============================================================================
// OVERVIEW SECTION
// ============================================================================

async function loadOverviewSection() {
  try {
    const { data: stats } = await api.getStats();

    // Update stat cards
    document.getElementById('totalUsers').textContent = stats.users.total;
    document.getElementById('activeUsers').textContent = stats.users.active;
    document.getElementById('totalConversations').textContent = stats.conversations.total;
    document.getElementById('todayConversations').textContent = stats.conversations.today;
    document.getElementById('errorCount').textContent = stats.errors.last24h;
    document.getElementById('totalTokens').textContent = formatNumber(stats.tokens.last30Days);

    // Render agent usage
    renderAgentUsage(stats.agentUsage);

    // Load recent activity (top conversations)
    await loadRecentActivity();
  } catch (error) {
    console.error('Failed to load overview:', error);
    showToast('Failed to load dashboard stats', 'error');
  }
}

function renderAgentUsage(agentUsage) {
  const container = document.getElementById('agentUsageList');

  if (agentUsage.length === 0) {
    container.innerHTML = '<div class="loading">No agent usage data</div>';
    return;
  }

  container.innerHTML = agentUsage.map(agent => `
    <div class="agent-usage-item">
      <strong>${formatAgentName(agent.agent_type)}</strong>
      <span>${agent.conversation_count} conversations • ${agent.unique_users} users</span>
    </div>
  `).join('');
}

async function loadRecentActivity() {
  try {
    const { data } = await api.searchConversations(1, { limit: 5 });
    const container = document.getElementById('recentActivityList');

    if (data.conversations.length === 0) {
      container.innerHTML = '<div class="loading">No recent activity</div>';
      return;
    }

    container.innerHTML = data.conversations.map(conv => `
      <div class="activity-item">
        <div>
          <strong>${conv.user_name || conv.user_email || 'Unknown'}</strong>
          <span> • ${formatAgentName(conv.agent_type)}</span>
        </div>
        <span>${formatTimeAgo(conv.created_at)}</span>
      </div>
    `).join('');
  } catch (error) {
    console.error('Failed to load recent activity:', error);
  }
}

// ============================================================================
// USERS SECTION
// ============================================================================

async function loadUsersSection() {
  try {
    const { data } = await api.getUsers(state.users.page, state.users.filters);

    state.users.data = data.users;
    state.users.totalPages = data.totalPages;

    renderUsersTable(data.users);
    renderPagination('users', state.users.page, data.totalPages);
  } catch (error) {
    console.error('Failed to load users:', error);
    showToast('Failed to load users', 'error');
  }
}

function renderUsersTable(users) {
  const tbody = document.getElementById('usersTableBody');

  if (users.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="loading">No users found</td></tr>';
    return;
  }

  tbody.innerHTML = users.map(user => `
    <tr>
      <td>
        <div style="display: flex; align-items: center; gap: 8px;">
          <img src="${user.picture || '/public/images/default-avatar.png'}"
               alt="${user.name}"
               style="width: 32px; height: 32px; border-radius: 50%;">
          <strong>${user.name || 'Unknown'}</strong>
        </div>
      </td>
      <td>${user.email}</td>
      <td><span class="badge badge-${user.role}">${user.role || 'user'}</span></td>
      <td>
        <span class="badge badge-${user.is_active ? 'active' : 'inactive'}">
          ${user.is_active ? 'Active' : 'Inactive'}
        </span>
      </td>
      <td>${user.last_login ? formatDateTime(user.last_login) : 'Never'}</td>
      <td>${user.conversation_count || 0}</td>
      <td>
        <div class="action-buttons">
          <button class="btn btn-secondary btn-small"
                  onclick="editUser(${user.id}, '${user.role}', ${user.is_active})">
            Edit
          </button>
        </div>
      </td>
    </tr>
  `).join('');
}

window.editUser = async function(userId, currentRole, isActive) {
  const newRole = prompt(`Edit role for user ${userId}:\n\nOptions: admin, user, client, guest`, currentRole);

  if (!newRole || newRole === currentRole) {
    return;
  }

  if (!['admin', 'user', 'client', 'guest'].includes(newRole)) {
    showToast('Invalid role', 'error');
    return;
  }

  try {
    await api.updateUser(userId, { role: newRole });
    showToast('User updated successfully', 'success');
    await loadUsersSection();
  } catch (error) {
    showToast('Failed to update user', 'error');
  }
};

// ============================================================================
// CONVERSATIONS SECTION
// ============================================================================

async function loadConversationsSection() {
  try {
    const { data } = await api.searchConversations(state.conversations.page, state.conversations.filters);

    state.conversations.data = data.conversations;
    state.conversations.totalPages = data.totalPages;

    renderConversationsTable(data.conversations);
    renderPagination('conversations', state.conversations.page, data.totalPages);

    // Populate agent filter
    populateAgentFilter(data.conversations);
  } catch (error) {
    console.error('Failed to load conversations:', error);
    showToast('Failed to load conversations', 'error');
  }
}

function renderConversationsTable(conversations) {
  const tbody = document.getElementById('conversationsTableBody');

  if (conversations.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="loading">No conversations found</td></tr>';
    return;
  }

  tbody.innerHTML = conversations.map(conv => `
    <tr>
      <td>${conv.user_name || conv.user_email || 'Unknown'}</td>
      <td>${formatAgentName(conv.agent_type)}</td>
      <td>${conv.title || 'Untitled'}</td>
      <td>${conv.message_count || 0}</td>
      <td>${formatNumber(conv.tokens_used || 0)}</td>
      <td>${formatDateTime(conv.created_at)}</td>
      <td>
        <div class="action-buttons">
          <button class="btn btn-secondary btn-small"
                  onclick="viewConversation('${conv.id}')">
            View
          </button>
          <button class="btn btn-danger btn-small"
                  onclick="deleteConversation('${conv.id}')">
            Delete
          </button>
        </div>
      </td>
    </tr>
  `).join('');
}

function populateAgentFilter(conversations) {
  const filter = document.getElementById('agentTypeFilter');
  const agents = [...new Set(conversations.map(c => c.agent_type))];

  const currentValue = filter.value;
  filter.innerHTML = '<option value="">All Agents</option>' +
    agents.map(agent => `<option value="${agent}">${formatAgentName(agent)}</option>`).join('');
  filter.value = currentValue;
}

window.viewConversation = async function(conversationId) {
  try {
    const { data: conversation } = await api.getConversation(conversationId);

    const modalBody = document.getElementById('conversationModalBody');
    modalBody.innerHTML = `
      <div style="margin-bottom: 24px;">
        <h4>${conversation.title || 'Untitled'}</h4>
        <p style="color: var(--gray-600); font-size: 13px;">
          ${conversation.user_name || conversation.user_email} •
          ${formatAgentName(conversation.agent_type)} •
          ${formatDateTime(conversation.created_at)}
        </p>
      </div>

      <div style="max-height: 500px; overflow-y: auto;">
        ${conversation.messages.map(msg => `
          <div style="margin-bottom: 16px; padding: 12px; background: ${msg.role === 'user' ? 'var(--gray-100)' : 'white'}; border-radius: 8px; border: 1px solid var(--gray-200);">
            <div style="font-weight: 600; margin-bottom: 4px; text-transform: capitalize;">${msg.role}</div>
            <div style="white-space: pre-wrap; font-size: 14px;">${escapeHtml(msg.content.substring(0, 500))}${msg.content.length > 500 ? '...' : ''}</div>
          </div>
        `).join('')}
      </div>
    `;

    document.getElementById('conversationModal').classList.add('active');
  } catch (error) {
    showToast('Failed to load conversation', 'error');
  }
};

window.deleteConversation = async function(conversationId) {
  if (!confirm('Are you sure you want to delete this conversation? This action cannot be undone.')) {
    return;
  }

  try {
    await api.deleteConversation(conversationId);
    showToast('Conversation deleted', 'success');
    await loadConversationsSection();
  } catch (error) {
    showToast('Failed to delete conversation', 'error');
  }
};

// ============================================================================
// ANALYTICS SECTION
// ============================================================================

async function loadAnalyticsSection() {
  try {
    const [costs, topUsers] = await Promise.all([
      api.getCostEstimates(30),
      api.getTopUsers(10, 30)
    ]);

    renderCostEstimates(costs.data);
    renderTopUsers(topUsers.data);
  } catch (error) {
    console.error('Failed to load analytics:', error);
  }
}

function renderCostEstimates(costs) {
  const container = document.getElementById('costEstimates');

  container.innerHTML = `
    <div class="cost-item">
      <div class="cost-label">Total Cost (${costs.period})</div>
      <div class="cost-value">$${costs.totalCost.toFixed(2)}</div>
    </div>
    <div class="cost-item">
      <div class="cost-label">Average Daily Cost</div>
      <div class="cost-value">$${costs.avgDailyCost.toFixed(2)}</div>
    </div>
    <div class="cost-item">
      <div class="cost-label">Projected Monthly Cost</div>
      <div class="cost-value">$${costs.projectedMonthlyCost.toFixed(2)}</div>
    </div>
    <div class="cost-item">
      <div class="cost-label">Total Tokens</div>
      <div class="cost-value">${formatNumber(costs.totalTokens)}</div>
    </div>
  `;
}

function renderTopUsers(users) {
  const container = document.getElementById('topUsersList');

  if (users.length === 0) {
    container.innerHTML = '<div class="loading">No user data</div>';
    return;
  }

  container.innerHTML = users.map((user, index) => `
    <div class="top-user-item">
      <div>
        <strong>#${index + 1} ${user.name || user.email}</strong>
        <br>
        <span>${user.conversationCount} conversations • ${formatNumber(user.totalTokens)} tokens</span>
      </div>
    </div>
  `).join('');
}

// ============================================================================
// ERRORS SECTION
// ============================================================================

async function loadErrorsSection() {
  try {
    const { data: errors } = await api.getErrors({ limit: 100 });

    renderErrorsTable(errors);
  } catch (error) {
    console.error('Failed to load errors:', error);
  }
}

function renderErrorsTable(errors) {
  const tbody = document.getElementById('errorsTableBody');

  if (errors.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="loading">No errors found</td></tr>';
    return;
  }

  tbody.innerHTML = errors.map(err => `
    <tr>
      <td>${formatDateTime(err.created_at)}</td>
      <td>${err.user_name || err.user_email || 'Anonymous'}</td>
      <td>${formatAgentName(err.agent_type) || 'N/A'}</td>
      <td><span class="badge badge-user">${err.error_type || 'unknown'}</span></td>
      <td>${escapeHtml(err.error_message.substring(0, 100))}${err.error_message.length > 100 ? '...' : ''}</td>
      <td>
        <button class="btn btn-secondary btn-small" onclick="viewError('${err.id}', ${JSON.stringify(escapeHtml(err.error_message)).replace(/'/g, "\\'")}, ${JSON.stringify(escapeHtml(err.stack_trace || '')).replace(/'/g, "\\'")})">
          View
        </button>
      </td>
    </tr>
  `).join('');
}

window.viewError = function(errorId, message, stackTrace) {
  const modalBody = document.getElementById('errorModalBody');

  modalBody.innerHTML = `
    <div style="margin-bottom: 16px;">
      <h4>Error Message</h4>
      <pre style="background: var(--gray-100); padding: 12px; border-radius: 6px; overflow-x: auto; font-size: 13px;">${message}</pre>
    </div>
    ${stackTrace ? `
      <div>
        <h4>Stack Trace</h4>
        <pre style="background: var(--gray-100); padding: 12px; border-radius: 6px; overflow-x: auto; font-size: 11px; max-height: 300px;">${stackTrace}</pre>
      </div>
    ` : ''}
  `;

  document.getElementById('errorModal').classList.add('active');
};

// ============================================================================
// SYSTEM SECTION
// ============================================================================

async function loadSystemSection() {
  try {
    const [health, dbStats] = await Promise.all([
      api.getSystemHealth(),
      api.getDatabaseStats()
    ]);

    renderSystemHealth(health.data);
    renderDatabaseStats(dbStats.data);
  } catch (error) {
    console.error('Failed to load system health:', error);
  }
}

function renderSystemHealth(health) {
  const container = document.getElementById('systemHealth');

  const statusClass = health.status === 'healthy' ? 'healthy' : health.status === 'degraded' ? 'degraded' : 'unhealthy';

  container.innerHTML = `
    <div class="health-item">
      <span>
        <span class="status-indicator ${statusClass}"></span>
        System Status
      </span>
      <strong>${health.status.toUpperCase()}</strong>
    </div>
    <div class="health-item">
      <span>Database Connection</span>
      <strong>${health.database.connected ? 'Connected' : 'Disconnected'}</strong>
    </div>
    <div class="health-item">
      <span>Recent Errors (1h)</span>
      <strong>${health.errors.lastHour}</strong>
    </div>
    <div class="health-item">
      <span>Pool - Total</span>
      <strong>${health.database.poolStats.totalCount || 'N/A'}</strong>
    </div>
    <div class="health-item">
      <span>Pool - Idle</span>
      <strong>${health.database.poolStats.idleCount || 'N/A'}</strong>
    </div>
  `;
}

function renderDatabaseStats(stats) {
  const container = document.getElementById('databaseStats');

  container.innerHTML = `
    <div class="db-stat-item">
      <span>Database Size</span>
      <strong>${stats.size}</strong>
    </div>
    <div class="db-stat-item">
      <span>Users</span>
      <strong>${formatNumber(stats.tables.users)}</strong>
    </div>
    <div class="db-stat-item">
      <span>Conversations</span>
      <strong>${formatNumber(stats.tables.conversations)}</strong>
    </div>
    <div class="db-stat-item">
      <span>Messages</span>
      <strong>${formatNumber(stats.tables.messages)}</strong>
    </div>
    <div class="db-stat-item">
      <span>Error Logs</span>
      <strong>${formatNumber(stats.tables.errorLogs)}</strong>
    </div>
  `;
}

// ============================================================================
// AUDIT LOG SECTION
// ============================================================================

async function loadAuditSection() {
  try {
    const { data } = await api.getAuditLog(state.audit.page, state.audit.filters);

    state.audit.data = data.logs;
    state.audit.totalPages = data.totalPages;

    renderAuditTable(data.logs);
    renderPagination('audit', state.audit.page, data.totalPages);
  } catch (error) {
    console.error('Failed to load audit log:', error);
  }
}

function renderAuditTable(logs) {
  const tbody = document.getElementById('auditTableBody');

  if (logs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="loading">No audit logs found</td></tr>';
    return;
  }

  tbody.innerHTML = logs.map(log => `
    <tr>
      <td>${formatDateTime(log.created_at)}</td>
      <td>${log.admin_name || log.admin_email || 'Unknown'}</td>
      <td><span class="badge badge-user">${log.action}</span></td>
      <td>${log.target_type || 'N/A'} #${log.target_id || 'N/A'}</td>
      <td>${log.details ? JSON.stringify(log.details).substring(0, 100) : 'No details'}</td>
    </tr>
  `).join('');
}

// ============================================================================
// PAGINATION
// ============================================================================

function renderPagination(section, currentPage, totalPages) {
  const container = document.getElementById(`${section}Pagination`);

  if (totalPages <= 1) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = `
    <button ${currentPage === 1 ? 'disabled' : ''} onclick="changePage('${section}', ${currentPage - 1})">
      Previous
    </button>
    <span class="page-info">Page ${currentPage} of ${totalPages}</span>
    <button ${currentPage === totalPages ? 'disabled' : ''} onclick="changePage('${section}', ${currentPage + 1})">
      Next
    </button>
  `;
}

window.changePage = async function(section, page) {
  state[section].page = page;

  switch (section) {
    case 'users':
      await loadUsersSection();
      break;
    case 'conversations':
      await loadConversationsSection();
      break;
    case 'audit':
      await loadAuditSection();
      break;
  }
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function formatNumber(num) {
  return new Intl.NumberFormat().format(num);
}

function formatDateTime(dateString) {
  const date = new Date(dateString);
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

function formatTimeAgo(dateString) {
  const date = new Date(dateString);
  const now = new Date();
  const seconds = Math.floor((now - date) / 1000);

  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;

  return formatDateTime(dateString);
}

function formatAgentName(agentType) {
  const names = {
    'grant-cards': 'Grant Card Generator',
    'grant-card-generator': 'Grant Card Generator',
    'etg-writer': 'ETG Business Case',
    'bcafe-writer': 'BCAFE Application',
    'canexport-claims': 'CanExport Claims',
    'canexport-writer': 'CanExport Writer',
    'readiness-strategist': 'Readiness Strategist',
    'internal-oracle': 'Internal Oracle',
    'orchestrator': 'Orchestrator'
  };

  return names[agentType] || agentType;
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function debounce(func, wait) {
  let timeout;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

function showToast(message, type = 'info') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast ${type}`;
  toast.classList.add('active');

  setTimeout(() => {
    toast.classList.remove('active');
  }, 3000);
}
