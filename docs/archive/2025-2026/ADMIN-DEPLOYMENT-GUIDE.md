# Admin Dashboard - Deployment & Testing Guide

## ✅ Implementation Status: COMPLETE

All admin dashboard features have been implemented and are ready for deployment to Railway.

---

## 📦 What Was Built

### Database Layer
- ✅ `migrations/005_add_admin_roles.sql` - User roles and permissions
- ✅ `migrations/006_add_usage_tracking.sql` - Token and usage tracking
- ✅ `migrations/007_add_error_logging.sql` - Centralized error logging
- ✅ `migrations/008_add_audit_log.sql` - Admin action auditing

### Backend Layer
- ✅ `src/middleware/admin.js` - Admin authorization middleware
- ✅ `src/middleware/auth.js` - Updated to load user roles from DB
- ✅ `src/database/admin-queries.js` - Database query functions
- ✅ `src/services/analytics.js` - Dashboard analytics service
- ✅ `src/api/admin.js` - Complete admin API (17 endpoints)
- ✅ `server.js` - Integrated admin routes

### Frontend Layer
- ✅ `admin.html` - Admin dashboard UI (7 sections)
- ✅ `public/css/admin.css` - Modern dashboard styling
- ✅ `public/js/admin.js` - Full admin functionality

### Utilities
- ✅ `scripts/run-admin-migrations.js` - Migration runner
- ✅ `scripts/create-admin.js` - Admin user promotion script

---

## 🚀 Deployment Steps

### Step 1: Run Migrations on Railway

SSH into your Railway deployment or use Railway CLI:

```bash
# Option A: Using Railway CLI locally
railway run node scripts/run-admin-migrations.js

# Option B: Using Railway dashboard
# Navigate to your service → Connect → Open Shell
# Then run:
node scripts/run-admin-migrations.js
```

Expected output:
```
🚀 Starting admin migrations...
🔌 Testing database connection...
✅ Connected to database at 2025-10-30...

📄 Running migration: 005_add_admin_roles.sql
✅ 005_add_admin_roles.sql completed successfully

📄 Running migration: 006_add_usage_tracking.sql
✅ 006_add_usage_tracking.sql completed successfully

📄 Running migration: 007_add_error_logging.sql
✅ 007_add_error_logging.sql completed successfully

📄 Running migration: 008_add_audit_log.sql
✅ 008_add_audit_log.sql completed successfully

✅ All migrations completed successfully!
```

### Step 2: Create Your First Admin User

```bash
node scripts/create-admin.js your-email@granted.com
```

Expected output:
```
🔍 Looking for user with email: your-email@granted.com
✅ Found user: Your Name (your-email@granted.com)
   Current role: user

✅ User promoted to admin successfully!

📧 your-email@granted.com can now access:
   - Admin dashboard at /admin
   - Admin API endpoints at /api/admin/*
```

**Important:** The user must have logged in at least once before you can promote them to admin.

### Step 3: Deploy to Railway

```bash
# Commit changes
git add .
git commit -m "feat: Add comprehensive admin dashboard with RBAC, analytics, and monitoring"

# Push to Railway branch
git push origin railway-migration
```

Railway will automatically redeploy your application.

### Step 4: Verify Deployment

Visit your Railway URL and test:

1. **Login as Admin**
   - Go to `https://your-app.railway.app/login`
   - Login with your Google account (the one you promoted to admin)

2. **Access Admin Dashboard**
   - Go to `https://your-app.railway.app/admin`
   - Should load the admin dashboard (non-admins will get 403 error)

---

## 🧪 Testing Checklist

### Access Control Tests

- [ ] **Non-admin cannot access admin dashboard**
  - Login as a regular user
  - Navigate to `/admin`
  - Expected: Redirected or 403 Forbidden

- [ ] **Non-admin cannot access admin API**
  ```bash
  curl -X GET https://your-app.railway.app/api/admin/stats
  # Expected: 401 Unauthorized or 403 Forbidden
  ```

- [ ] **Admin can access admin dashboard**
  - Login as admin user
  - Navigate to `/admin`
  - Expected: Dashboard loads successfully

### Dashboard Functionality Tests

**Overview Section:**
- [ ] Stats cards display correct numbers
  - Total Users
  - Active Users (7 days)
  - Total Conversations
  - Conversations Today
  - Errors (24h)
  - Tokens (30 days)

- [ ] Agent usage list shows top agents
- [ ] Recent activity displays recent conversations

**User Management:**
- [ ] User list loads with pagination
- [ ] Search users by name/email works
- [ ] Filter by role works (admin, user, client, guest)
- [ ] Filter by active status works
- [ ] Can edit user role
- [ ] User role change is logged in audit log

**Conversation Search:**
- [ ] Conversations list loads
- [ ] Search by keyword works
- [ ] Filter by agent type works
- [ ] Filter by date range works
- [ ] Can view full conversation in modal
- [ ] Can delete conversation
- [ ] Deletion is logged in audit log

**Analytics:**
- [ ] Cost estimates display correctly
- [ ] Top users list shows high-usage users
- [ ] Charts render (if implemented)

**Error Logs:**
- [ ] Recent errors display
- [ ] Filter by error type works
- [ ] Filter by agent works
- [ ] Filter by time range works
- [ ] Can view error details in modal

**System Health:**
- [ ] System status displays (healthy/degraded/unhealthy)
- [ ] Database connection status shown
- [ ] Pool statistics visible
- [ ] Database size and table counts display

**Audit Log:**
- [ ] Admin actions are logged
- [ ] Can filter by action type
- [ ] Shows admin user, action, target, and details

---

## 🔧 API Endpoints Reference

All endpoints require authentication + admin role.

### Dashboard Stats
```
GET /api/admin/stats
```

### User Management
```
GET    /api/admin/users              # List users (with pagination)
GET    /api/admin/users/:id          # Get user details
PUT    /api/admin/users/:id          # Update user role/status
```

### Conversation Management
```
GET    /api/admin/conversations      # Search conversations
GET    /api/admin/conversations/:id  # Get full conversation
DELETE /api/admin/conversations/:id  # Delete conversation
```

### Error Monitoring
```
GET /api/admin/errors                # Get recent errors
```

### Audit Log
```
GET /api/admin/audit-log             # Get admin activity log
```

### Analytics
```
GET /api/admin/analytics/usage-trends      # Usage trends over time
GET /api/admin/analytics/costs             # Cost estimates
GET /api/admin/analytics/error-stats       # Error statistics
GET /api/admin/analytics/activity-heatmap  # Activity heatmap
GET /api/admin/analytics/top-users         # Top users by activity
```

### System Health
```
GET /api/admin/system/health         # System health status
GET /api/admin/system/database       # Database statistics
```

---

## 🐛 Troubleshooting

### Issue: "Failed to load dashboard stats"

**Possible Causes:**
1. Migrations not run
2. Database connection issues
3. User not authenticated

**Solution:**
```bash
# Check migrations
psql $DATABASE_URL -c "SELECT column_name FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'role';"

# If empty, run migrations:
node scripts/run-admin-migrations.js
```

### Issue: "Admin access required" error

**Cause:** User is not promoted to admin

**Solution:**
```bash
node scripts/create-admin.js your-email@example.com
```

### Issue: "User ID from JWT not found in database"

**Cause:** User hasn't logged in yet (no record in users table)

**Solution:**
1. Login to the app at `/login`
2. Then run the create-admin script

### Issue: Admin dashboard UI not loading

**Possible Causes:**
1. Static file not being served
2. CSS/JS files missing
3. Browser cache

**Solution:**
```bash
# Verify files exist
ls -la admin.html
ls -la public/css/admin.css
ls -la public/js/admin.js

# Clear browser cache and hard reload (Cmd+Shift+R)
```

---

## 📊 Database Schema Changes

### users table (modified)
```sql
ALTER TABLE users ADD COLUMN role VARCHAR(20) DEFAULT 'user';
ALTER TABLE users ADD COLUMN is_active BOOLEAN DEFAULT true;
ALTER TABLE users ADD COLUMN last_login TIMESTAMP;
```

### conversation_stats table (new)
```sql
CREATE TABLE conversation_stats (
  id SERIAL PRIMARY KEY,
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  tokens_used INTEGER DEFAULT 0,
  tool_calls_count INTEGER DEFAULT 0,
  error_count INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### error_logs table (new)
```sql
CREATE TABLE error_logs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  agent_type VARCHAR(100),
  error_type VARCHAR(100),
  error_message TEXT,
  stack_trace TEXT,
  request_path VARCHAR(255),
  user_agent TEXT,
  ip_address VARCHAR(45),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### admin_audit_log table (new)
```sql
CREATE TABLE admin_audit_log (
  id SERIAL PRIMARY KEY,
  admin_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(100) NOT NULL,
  target_type VARCHAR(50),
  target_id VARCHAR(255),
  details JSONB,
  ip_address VARCHAR(45),
  user_agent TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

---

## 🔐 Security Features

1. **Role-Based Access Control (RBAC)**
   - Only users with `role = 'admin'` can access admin features
   - Checked at both middleware and application level

2. **Audit Logging**
   - All admin actions are logged with:
     - Admin user ID
     - Action performed
     - Target entity
     - Before/after details
     - IP address and user agent

3. **Authentication**
   - JWT token verification on every request
   - Role loaded fresh from database on each request

4. **Authorization**
   - `requireAdmin()` middleware on all admin routes
   - Non-admins receive 403 Forbidden

---

## 📈 Usage Tracking

The system now tracks:

1. **Token Usage** - Claude API tokens per conversation
2. **Tool Calls** - Number of tool invocations
3. **Errors** - Error count per conversation
4. **User Activity** - Last login timestamps
5. **Admin Actions** - Full audit trail

---

## 🎯 Success Metrics

After deployment, you should be able to:

✅ See total users and active users at a glance
✅ Find any user's conversation in <10 seconds
✅ Change a user's role in <5 seconds
✅ View error logs and trends
✅ Track which agents are most used
✅ See system health status
✅ Audit all admin actions
✅ Estimate Claude API costs
✅ Identify top users by activity

---

## 🚧 Known Limitations

1. **No real-time updates** - Dashboard requires manual refresh
2. **Basic charts** - Usage trends chart requires Chart.js library (not yet added)
3. **No email notifications** - Admin alerts require manual checking
4. **Limited search** - Full-text search across messages not implemented

---

## 🔄 Next Steps (Future Enhancements)

1. **Real-time Dashboard**
   - WebSocket connection for live updates
   - Auto-refresh every 30 seconds

2. **Advanced Analytics**
   - Interactive charts with Chart.js
   - Cost breakdowns per user/agent
   - Usage forecasting

3. **Alerting System**
   - Email alerts for critical errors
   - Slack/Discord integration
   - Threshold-based notifications

4. **Knowledge Base Management**
   - Upload/update documents via admin UI
   - View cached documents
   - Manual cache refresh

5. **Agent Management**
   - Edit agent prompts via UI
   - Enable/disable agents
   - A/B test different prompts

---

## 📞 Support

If you encounter issues during deployment:

1. Check Railway logs:
   ```bash
   railway logs
   ```

2. Check database migrations:
   ```sql
   psql $DATABASE_URL -c "\d users"
   ```

3. Verify admin user:
   ```sql
   psql $DATABASE_URL -c "SELECT id, email, role FROM users WHERE role = 'admin';"
   ```

---

**Ready to deploy!** 🚀

Start with Step 1: Run migrations, then create your admin user, and deploy to Railway.
