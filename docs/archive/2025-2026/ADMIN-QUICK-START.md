# Admin Dashboard - Quick Start Guide

## 🚀 Deploy in 3 Steps (5 minutes)

### Step 1: Run Migrations
```bash
node scripts/run-admin-migrations.js
```

### Step 2: Create Admin User
```bash
node scripts/create-admin.js your-email@granted.com
```

### Step 3: Deploy
```bash
git add .
git commit -m "feat: Add admin dashboard"
git push origin railway-migration
```

---

## ✅ Verify Deployment

1. Visit `https://your-app.railway.app/login`
2. Login with your Google account
3. Navigate to `https://your-app.railway.app/admin`
4. You should see the admin dashboard!

---

## 📊 What You Get

### Dashboard Sections

1. **Overview** - Stats at a glance
   - Total users, conversations, errors, tokens
   - Agent usage breakdown
   - Recent activity

2. **Users** - Manage all users
   - Search, filter by role/status
   - Edit user roles (admin, user, client, guest)
   - View conversation counts

3. **Conversations** - Search & manage conversations
   - Filter by user, agent, date
   - View full transcripts
   - Delete conversations

4. **Analytics** - Usage insights
   - Cost estimates & projections
   - Top users by activity
   - Token usage trends

5. **Errors** - Monitor system errors
   - Filter by type, agent, time
   - View stack traces
   - Error trends

6. **System** - Health monitoring
   - Database status & size
   - Connection pool stats
   - System health

7. **Audit Log** - Admin actions
   - Who did what, when
   - Complete transparency

---

## 🔐 Access Control

**Admin Users:**
- Can access `/admin` dashboard
- Can call `/api/admin/*` endpoints
- Actions are logged in audit trail

**Regular Users:**
- Cannot access admin features
- Get 403 Forbidden if they try
- Can use all normal features

---

## 📝 Common Admin Tasks

### Promote User to Admin
```bash
node scripts/create-admin.js user@email.com
```

### Change User Role (via UI)
1. Go to `/admin` → Users
2. Find the user
3. Click "Edit"
4. Enter new role: admin, user, client, or guest

### Find User's Conversations
1. Go to `/admin` → Conversations
2. Enter user's name/email in search
3. Click "View" to see full conversation

### Check System Costs
1. Go to `/admin` → Analytics
2. See "Cost Estimates" card
3. Shows 30-day costs and projections

### View Recent Errors
1. Go to `/admin` → Errors
2. Filter by time range (24h, 7d, 30d)
3. Click "View" for stack traces

---

## 🐛 Troubleshooting

**Can't access admin dashboard:**
```bash
# Check if you're an admin
psql $DATABASE_URL -c "SELECT email, role FROM users WHERE email = 'your-email@granted.com';"

# If not admin, promote yourself
node scripts/create-admin.js your-email@granted.com
```

**Migrations fail:**
```bash
# Check if DATABASE_URL is set
echo $DATABASE_URL

# If empty, check Railway dashboard for connection string
```

**Dashboard shows "Failed to load stats":**
```bash
# Verify migrations ran
psql $DATABASE_URL -c "\d users"

# Should show 'role', 'is_active', 'last_login' columns
```

---

## 📚 Full Documentation

- **Complete Guide:** `ADMIN-DEPLOYMENT-GUIDE.md`
- **Implementation Details:** `ADMIN-IMPLEMENTATION-COMPLETE.md`
- **Roadmap:** `ADMIN-IMPLEMENTATION-ROADMAP.md`

---

## 🎯 Success!

You now have:
- ✅ User management with roles
- ✅ Conversation search & viewer
- ✅ Cost tracking & analytics
- ✅ Error monitoring
- ✅ System health dashboard
- ✅ Audit logging

**Time saved:** 3-5 hours per week on admin tasks!
