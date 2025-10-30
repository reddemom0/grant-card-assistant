# Admin Dashboard Implementation Roadmap

## 🎯 Goal
Build admin foundation with role-based access control, user management, conversation search, and basic analytics.

**Time Estimate:** 8-12 hours
**Branch:** `admin-dashboard`

---

## 📋 Phase 1: Database Schema (30 minutes)

### 1.1 Add User Roles
```sql
-- Migration: 005_add_admin_roles.sql
ALTER TABLE users ADD COLUMN role VARCHAR(20) DEFAULT 'user';
ALTER TABLE users ADD COLUMN is_active BOOLEAN DEFAULT true;
ALTER TABLE users ADD COLUMN last_login TIMESTAMP;

CREATE INDEX idx_users_role ON users(role);
COMMENT ON COLUMN users.role IS 'User role: admin, user, client, guest';
```

### 1.2 Add Usage Tracking
```sql
-- Migration: 006_add_usage_tracking.sql
CREATE TABLE conversation_stats (
  id SERIAL PRIMARY KEY,
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  tokens_used INTEGER DEFAULT 0,
  tool_calls_count INTEGER DEFAULT 0,
  error_count INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(conversation_id)
);

CREATE INDEX idx_conversation_stats_conversation_id ON conversation_stats(conversation_id);
```

### 1.3 Add Error Logging
```sql
-- Migration: 007_add_error_logging.sql
CREATE TABLE error_logs (
  id SERIAL PRIMARY KEY,
  user_id UUID,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  agent_type VARCHAR(100),
  error_type VARCHAR(100),
  error_message TEXT,
  stack_trace TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_error_logs_user_id ON error_logs(user_id);
CREATE INDEX idx_error_logs_created_at ON error_logs(created_at);
CREATE INDEX idx_error_logs_agent_type ON error_logs(agent_type);
```

### 1.4 Add Admin Activity Audit Log
```sql
-- Migration: 008_add_audit_log.sql
CREATE TABLE admin_audit_log (
  id SERIAL PRIMARY KEY,
  admin_user_id INTEGER REFERENCES users(id),
  action VARCHAR(100) NOT NULL,
  target_type VARCHAR(50),
  target_id VARCHAR(255),
  details JSONB,
  ip_address VARCHAR(45),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_audit_log_admin_user_id ON admin_audit_log(admin_user_id);
CREATE INDEX idx_audit_log_created_at ON admin_audit_log(created_at);
CREATE INDEX idx_audit_log_action ON admin_audit_log(action);
```

---

## 📋 Phase 2: Backend API (2-3 hours)

### 2.1 Admin Middleware (`src/middleware/admin.js`)
```javascript
// Check if user is admin
export function requireAdmin(req, res, next)

// Log admin actions
export function auditLog(action, details)
```

### 2.2 Admin API Endpoints (`src/api/admin.js`)
```
GET  /api/admin/stats          - Dashboard statistics
GET  /api/admin/users          - List all users with pagination
PUT  /api/admin/users/:id      - Update user (role, active status)
GET  /api/admin/conversations  - Search conversations with filters
GET  /api/admin/conversation/:id - Get full conversation details
DELETE /api/admin/conversation/:id - Delete conversation
GET  /api/admin/errors         - Recent errors with filtering
GET  /api/admin/audit-log      - Admin activity log
GET  /api/admin/health         - System health metrics
```

### 2.3 Analytics Service (`src/services/analytics.js`)
```javascript
// Calculate dashboard stats
export async function getDashboardStats()

// Get usage trends
export async function getUsageTrends(days)

// Get cost estimates
export async function getCostEstimates()
```

---

## 📋 Phase 3: Frontend Admin Dashboard (3-4 hours)

### 3.1 Admin Dashboard Page (`admin.html`)
```
Layout:
- Sidebar navigation
- Main content area
- Top header with user info
```

**Sections:**
1. **Overview Dashboard**
   - Total users
   - Active conversations today
   - Total conversations
   - Error count (last 24h)
   - Top 5 agents by usage
   - Recent activity timeline

2. **User Management**
   - User list table (sortable, searchable)
   - Columns: Name, Email, Role, Last Login, Status, Actions
   - Actions: Edit Role, Deactivate/Activate, View Conversations
   - Filters: Role, Active/Inactive, Last Login

3. **Conversation Search**
   - Search by: User, Agent, Date Range, Keywords
   - Results table: User, Agent, Title, Date, Messages, Actions
   - Actions: View, Export, Delete
   - Conversation viewer modal (full transcript)

4. **System Health**
   - Database status
   - Google Drive connection
   - HubSpot API status
   - Recent errors list

5. **Analytics** (Basic)
   - Conversations per day (7-day chart)
   - Agent usage breakdown (pie chart)
   - User activity heatmap

### 3.2 Admin JavaScript (`public/js/admin.js`)
```javascript
// API client functions
class AdminAPI {
  async getStats()
  async getUsers(page, filters)
  async updateUser(userId, data)
  async searchConversations(filters)
  async getConversation(id)
  async deleteConversation(id)
  async getErrors(filters)
}

// UI Components
class Dashboard { render() }
class UserManagement { render() }
class ConversationSearch { render() }
class SystemHealth { render() }
```

### 3.3 Admin Styling (`public/css/admin.css`)
```css
/* Modern admin dashboard design */
- Sidebar navigation
- Cards for stats
- Tables for lists
- Modal dialogs
- Toast notifications
```

---

## 📋 Phase 4: Integration & Testing (1-2 hours)

### 4.1 Update Authentication
- Modify `src/middleware/auth.js` to load user role
- Add role to JWT token or fetch from DB

### 4.2 Add Admin Route to Server
```javascript
// In server.js
import adminRouter from './src/api/admin.js';
app.use('/api/admin', authenticateUser, requireAdmin, adminRouter);

app.get('/admin', authenticateUser, requireAdmin, (req, res) => {
  res.sendFile('admin.html', { root: '.' });
});
```

### 4.3 Create Initial Admin User
```javascript
// Script: scripts/create-admin.js
// Set first user as admin or specific email
```

### 4.4 Testing Checklist
- [ ] Non-admin cannot access `/admin`
- [ ] Non-admin cannot access `/api/admin/*`
- [ ] Admin can view dashboard stats
- [ ] Admin can list and filter users
- [ ] Admin can change user roles
- [ ] Admin can search conversations
- [ ] Admin can view conversation details
- [ ] Admin can delete conversations
- [ ] Admin actions are logged
- [ ] Error logs are captured

---

## 📂 File Structure

```
grant-card-assistant/
├── migrations/
│   ├── 005_add_admin_roles.sql
│   ├── 006_add_usage_tracking.sql
│   ├── 007_add_error_logging.sql
│   └── 008_add_audit_log.sql
│
├── src/
│   ├── middleware/
│   │   └── admin.js (NEW)
│   │
│   ├── api/
│   │   └── admin.js (NEW)
│   │
│   ├── services/
│   │   └── analytics.js (NEW)
│   │
│   └── database/
│       └── admin-queries.js (NEW)
│
├── public/
│   ├── js/
│   │   └── admin.js (NEW)
│   │
│   └── css/
│       └── admin.css (NEW)
│
├── scripts/
│   └── create-admin.js (NEW)
│
└── admin.html (NEW)
```

---

## 🚀 Implementation Order

### Step 1: Database Foundation (30 min)
1. Create migration files
2. Run migrations on Railway
3. Verify tables created

### Step 2: Backend Core (2 hours)
1. Create admin middleware
2. Create admin queries module
3. Create basic admin API endpoints
4. Test with curl/Postman

### Step 3: Admin Dashboard UI (3 hours)
1. Create admin.html structure
2. Build dashboard overview section
3. Add user management table
4. Add conversation search
5. Style with CSS

### Step 4: Integration (1 hour)
1. Wire up admin routes in server.js
2. Create admin user script
3. Test end-to-end flow

### Step 5: Polish & Error Handling (1 hour)
1. Add loading states
2. Add error messages
3. Add success notifications
4. Test edge cases

---

## 🎨 UI Design Approach

### Colors
- Primary: #2563eb (blue)
- Success: #10b981 (green)
- Warning: #f59e0b (orange)
- Danger: #ef4444 (red)
- Gray scale for backgrounds

### Components
- **Cards**: For dashboard stats
- **Tables**: For users/conversations lists
- **Modals**: For conversation viewer, confirmations
- **Forms**: For user editing
- **Charts**: Simple bar/line charts using Chart.js

### Responsive
- Mobile-friendly sidebar (collapsible)
- Responsive tables (horizontal scroll on mobile)
- Touch-friendly buttons

---

## 🔐 Security Considerations

1. **Authorization:**
   - Every admin endpoint checks role
   - Audit log for all admin actions

2. **Data Protection:**
   - Don't expose sensitive user data
   - Redact API keys in health checks
   - Limit conversation search results

3. **Rate Limiting:**
   - Apply stricter limits to admin endpoints
   - Prevent brute force on user updates

4. **Input Validation:**
   - Validate all role changes
   - Sanitize search queries
   - Validate conversation IDs

---

## 📊 Success Metrics

After implementation, you should be able to:

✅ See total users and active users at a glance
✅ Find any user's conversation in <10 seconds
✅ Change a user's role in <5 seconds
✅ View error logs and trends
✅ Track which agents are most used
✅ See system health status
✅ Audit all admin actions

---

## 🔄 Future Enhancements (Phase 2)

1. **Advanced Analytics:**
   - Token usage tracking
   - Cost per conversation
   - User engagement scores
   - Agent performance metrics

2. **User Communication:**
   - Email users directly from admin
   - Broadcast announcements
   - Send usage reports

3. **Agent Management:**
   - Edit agent prompts via UI
   - Enable/disable agents
   - A/B test prompts
   - View agent error rates

4. **Automation:**
   - Auto-archive old conversations
   - Auto-disable inactive users
   - Scheduled reports
   - Alert system for errors

---

**Ready to start implementation!**

**First Task:** Create database migrations for admin roles and tracking.
