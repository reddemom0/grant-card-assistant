/**
 * Lead Notification Service
 *
 * Notifies internal team when a lead-gen conversation is finalized.
 * Channel adapter pattern: email today, Zoom (or others) plugged in later.
 *
 * Env vars:
 *   NOTIFY_CHANNELS  — comma-separated channel list (default: "email")
 *   NOTIFY_TIERS     — comma-separated tier filter (default: "hot,warm,cool")
 *   NOTIFY_EMAIL     — comma-separated recipient list (default: "writers@granted.ca")
 */

import { sendEmail } from '../email/sendEmail.js';

const HUBSPOT_PORTAL_ID = '21088260';

// ============================================================================
// Tier conversion: numeric lead_score → tier label
// ============================================================================

function resolveLeadTier(prospectData) {
  const raw = prospectData?.lead_score;
  if (!raw) return 'cool';

  // If already a string tier, pass through
  if (['hot', 'warm', 'cool'].includes(raw)) return raw;

  // Numeric score → tier
  const score = parseInt(raw, 10);
  if (isNaN(score)) return 'cool';
  if (score >= 10) return 'hot';
  if (score >= 5) return 'warm';
  return 'cool';
}

// ============================================================================
// Channel adapters
// ============================================================================

const adapters = {
  email: sendEmailNotification,
  // zoom: sendZoomNotification,  // future
};

// ============================================================================
// Orchestrator
// ============================================================================

/**
 * Notify internal team of a finalized lead.
 *
 * Reads channel/tier/recipient config from env vars.
 * All errors are caught and logged — never throws.
 *
 * @param {Object} opts
 * @param {string} opts.sessionId
 * @param {string} opts.trigger — 'contact_captured' | 'inactivity_timeout'
 * @param {Object} opts.session — full lead_gen_conversations row
 * @param {Object} opts.prospectData — merged prospect data
 * @param {Object|null} opts.enrichedSession — enriched session (may be null)
 * @param {string|null} opts.companyId — HubSpot company ID
 * @param {string|null} opts.contactId — HubSpot contact ID
 * @param {Object} opts.results — { company, contact, note } action results
 */
export async function notifyTeamOfLead({
  sessionId, trigger, session, prospectData,
  enrichedSession, companyId, contactId, results
}) {
  // Read config
  const enabledChannels = (process.env.NOTIFY_CHANNELS || 'email')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

  const enabledTiers = (process.env.NOTIFY_TIERS || 'hot,warm,cool')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

  // Resolve tier
  const tier = resolveLeadTier(prospectData);

  if (!enabledTiers.includes(tier)) {
    console.log(`ℹ️  Lead notification skipped — tier "${tier}" not in NOTIFY_TIERS [${enabledTiers.join(',')}]`);
    return;
  }

  // Build normalized payload once, shared across all adapters
  const payload = buildNotificationPayload({
    sessionId, trigger, session, prospectData,
    enrichedSession, companyId, contactId, results, tier
  });

  // Iterate adapters
  for (const channel of enabledChannels) {
    const adapter = adapters[channel];
    if (!adapter) {
      console.warn(`⚠️  Unknown notification channel: "${channel}" — skipping`);
      continue;
    }
    try {
      await adapter(payload);
      console.log(`✅ Lead notification sent via ${channel} for ${prospectData?.company_name || sessionId}`);
    } catch (err) {
      console.error(`❌ Lead notification failed via ${channel}:`, err.message);
    }
  }
}

/**
 * Notify internal team that a tailored summary superseded an earlier fallback
 * email (upgrade send). This is an EXISTING lead — not a new one — so the
 * NOTIFY_TIERS filter is deliberately not applied: upgrade sends are rare and
 * always worth seeing. Adapter errors bubble to the caller, which wraps this
 * call non-blocking.
 *
 * @param {Object} opts
 * @param {Object} opts.session — full lead_gen_conversations row
 * @param {Object} opts.prospectData — session.prospect_data
 */
export async function notifyTeamOfUpgrade({ session, prospectData }) {
  const enabledChannels = (process.env.NOTIFY_CHANNELS || 'email')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

  const payload = buildNotificationPayload({
    sessionId: session?.session_id,
    trigger: 'summary_upgrade',
    session,
    prospectData,
    enrichedSession: null,
    companyId: null,
    contactId: null,
    results: null,
    tier: resolveLeadTier(prospectData)
  });
  payload.isUpgrade = true;

  for (const channel of enabledChannels) {
    const adapter = adapters[channel];
    if (!adapter) {
      console.warn(`⚠️  Unknown notification channel: "${channel}" — skipping`);
      continue;
    }
    await adapter(payload);
    console.log(`✅ Upgrade notification sent via ${channel} for ${prospectData?.company_name || session?.session_id}`);
  }
}

// ============================================================================
// Payload builder
// ============================================================================

function buildNotificationPayload({
  sessionId, trigger, session, prospectData,
  enrichedSession, companyId, contactId, results, tier
}) {
  const pd = prospectData || {};
  const es = enrichedSession || {};

  // Programs: prefer auto_matched_grants, fall back through chain
  const programs = es.auto_matched_grants
    || es.matched_programs
    || (Array.isArray(session?.matched_programs) ? session.matched_programs : null)
    || pd.matched_programs
    || [];

  return {
    sessionId,
    trigger,
    tier,
    // Contact
    name:         session?.contact_name || pd.contact_name || null,
    email:        session?.contact_email || pd.contact_email || null,
    phone:        pd.phone || null,
    // Company
    companyName:  pd.company_name || session?.company_name || null,
    province:     pd.province || null,
    industry:     pd.industry || es.prospect_data?.industry || null,
    revenue:      pd.revenue_range || pd.revenue || null,
    employeeCount: pd.employee_count || null,
    companyWebsite: session?.company_website || pd.company_website || null,
    // Activities
    activities:   pd.activities_discussed || pd.activities || pd.planned_activities || null,
    // Funding
    estimatedFunding: es.estimated_funding || session?.estimated_funding || pd.estimated_funding || null,
    availableNowFunding: es.available_now_funding || pd.available_now_funding || null,
    // Programs (top 3 for the email, full list in payload)
    matchedPrograms: Array.isArray(programs) ? programs : [],
    // Summary
    prospectSummary: es.prospect_summary || pd.prospect_summary || null,
    // Metadata
    messageCount: session?.message_count || 0,
    messages:     session?.messages || [],
    companyId,
    contactId,
    results,
  };
}

// ============================================================================
// Email adapter
// ============================================================================

async function sendEmailNotification(payload) {
  const recipients = (process.env.NOTIFY_EMAIL || 'writers@granted.ca')
    .split(',').map(s => s.trim()).filter(Boolean);

  const subject = buildSubject(payload);
  const htmlBody = buildEmailHtml(payload);

  for (const to of recipients) {
    await sendEmail({ to, toName: '', subject, htmlBody });
  }
}

function buildSubject(payload) {
  const tierTag = (payload.tier || 'cool').toUpperCase();
  const company = payload.companyName || 'Unknown Company';
  const funding = payload.estimatedFunding || 'TBD';
  if (payload.isUpgrade) {
    return `[UPGRADE] Tailored summary sent: ${company} — ${funding}`;
  }
  return `[${tierTag}] New lead: ${company} — ${funding}`;
}

// ============================================================================
// Email HTML builder
// ============================================================================

function buildEmailHtml(p) {
  const tierConfig = {
    hot:  { badge: 'HOT 🔥', color: '#dc2626', bg: '#fef2f2' },
    warm: { badge: 'WARM 🟡', color: '#d97706', bg: '#fffbeb' },
    cool: { badge: 'COOL ⚪', color: '#6b7280', bg: '#f9fafb' },
  };
  const tc = tierConfig[p.tier] || tierConfig.cool;

  const triggerLabel = p.trigger === 'contact_captured'
    ? 'Contact captured (save_lead_data)'
    : p.trigger === 'summary_upgrade'
      ? 'Upgrade send (tailored summary superseded fallback email)'
      : 'Inactivity timeout (cron backup)';

  // Build links
  const appBase = process.env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
    : '';
  const adminLink = appBase
    ? `${appBase}/admin/conversations?session=${p.sessionId}`
    : `/admin/conversations?session=${p.sessionId}`;
  const hubspotCompanyLink = p.companyId
    ? `https://app.hubspot.com/contacts/${HUBSPOT_PORTAL_ID}/company/${p.companyId}`
    : null;

  // Top 3 programs
  const topPrograms = (p.matchedPrograms || []).slice(0, 3);

  // Transcript
  const transcriptHtml = buildTranscriptHtml(p.messages);

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<div style="max-width:640px;margin:20px auto;background:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb;">

  <!-- Tier badge -->
  <div style="background:${tc.bg};padding:16px 24px;border-bottom:2px solid ${tc.color};">
    <span style="display:inline-block;background:${tc.color};color:#fff;font-weight:700;font-size:14px;padding:4px 12px;border-radius:4px;letter-spacing:0.5px;">${tc.badge}</span>
    <span style="margin-left:12px;font-size:18px;font-weight:600;color:#111827;">${escHtml(p.companyName || 'Unknown Company')}</span>
  </div>

  ${p.isUpgrade ? `
  <!-- Upgrade banner -->
  <div style="background:#eff6ff;padding:12px 24px;border-bottom:1px solid #bfdbfe;font-size:13px;color:#1d4ed8;">
    <strong>Upgrade — existing lead, not a new one.</strong> This prospect previously received the generic fallback email; their tailored funding summary has now been sent. No new HubSpot records were created.
  </div>` : ''}

  <!-- Main content -->
  <div style="padding:24px;">

    <!-- Contact & Company -->
    <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
      <tbody>
        ${row('Name', p.name)}
        ${row('Email', p.email ? `<a href="mailto:${escHtml(p.email)}" style="color:#2563eb;">${escHtml(p.email)}</a>` : null)}
        ${row('Phone', p.phone)}
        ${row('Company', p.companyName)}
        ${row('Website', p.companyWebsite ? `<a href="${escHtml(p.companyWebsite)}" style="color:#2563eb;">${escHtml(p.companyWebsite)}</a>` : null)}
        ${row('Province', p.province)}
        ${row('Industry', p.industry)}
        ${row('Employees', p.employeeCount)}
        ${row('Revenue', p.revenue)}
      </tbody>
    </table>

    <!-- Activities -->
    ${p.activities ? section('Activities', `<p style="margin:0;color:#374151;">${escHtml(p.activities)}</p>`) : ''}

    <!-- Funding -->
    ${section('Funding Estimate', `
      <p style="margin:0 0 4px;font-size:20px;font-weight:700;color:#111827;">${escHtml(p.estimatedFunding || 'TBD')}</p>
      ${p.availableNowFunding && p.availableNowFunding !== p.estimatedFunding
        ? `<p style="margin:0;color:#6b7280;font-size:13px;">Available now: ${escHtml(p.availableNowFunding)}</p>`
        : ''}
    `)}

    <!-- Programs -->
    ${topPrograms.length > 0 ? section('Top Matched Programs', `
      <ul style="margin:0;padding-left:20px;color:#374151;">
        ${topPrograms.map(prog => `<li style="margin-bottom:4px;">${escHtml(typeof prog === 'string' ? prog : prog.name || JSON.stringify(prog))}</li>`).join('')}
      </ul>
      ${p.matchedPrograms.length > 3 ? `<p style="margin:8px 0 0;color:#6b7280;font-size:13px;">+ ${p.matchedPrograms.length - 3} more programs</p>` : ''}
    `) : ''}

    <!-- Prospect summary -->
    ${p.prospectSummary ? section('Prospect Summary', `<p style="margin:0;color:#374151;font-style:italic;">${escHtml(p.prospectSummary)}</p>`) : ''}

    <!-- Metadata -->
    <div style="margin-top:20px;padding:12px 16px;background:#f9fafb;border-radius:6px;font-size:13px;color:#6b7280;">
      <p style="margin:0 0 4px;">Trigger: <strong>${escHtml(triggerLabel)}</strong></p>
      <p style="margin:0 0 4px;">Messages: <strong>${p.messageCount}</strong></p>
      <p style="margin:0;">Session: <code style="font-size:12px;">${escHtml(p.sessionId)}</code></p>
    </div>

    <!-- Links -->
    <div style="margin-top:16px;display:flex;gap:12px;flex-wrap:wrap;">
      ${adminLink ? `<a href="${escHtml(adminLink)}" style="display:inline-block;padding:8px 16px;background:#2563eb;color:#fff;text-decoration:none;border-radius:5px;font-size:13px;font-weight:600;">View in Admin</a>` : ''}
      ${hubspotCompanyLink ? `<a href="${escHtml(hubspotCompanyLink)}" style="display:inline-block;padding:8px 16px;background:#ff5c35;color:#fff;text-decoration:none;border-radius:5px;font-size:13px;font-weight:600;">View in HubSpot</a>` : ''}
    </div>

  </div>

  <!-- Transcript -->
  ${transcriptHtml}

</div>
</body>
</html>`;
}

// ============================================================================
// Transcript HTML
// ============================================================================

function buildTranscriptHtml(messages) {
  if (!messages || messages.length === 0) return '';

  const rows = messages.map(msg => {
    const isUser = msg.role === 'user';
    const label = isUser ? 'User' : 'Agent';
    const labelColor = isUser ? '#2563eb' : '#059669';
    const bgColor = isUser ? '#eff6ff' : '#f0fdf4';

    // Format timestamp if available
    let timeStr = '';
    if (msg.timestamp) {
      try {
        const d = new Date(msg.timestamp);
        timeStr = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      } catch { /* ignore */ }
    }

    // Truncate very long agent messages
    let content = msg.content || '';
    if (content.length > 2000) {
      content = content.substring(0, 2000) + '… [truncated]';
    }

    return `
      <div style="margin-bottom:8px;padding:10px 14px;background:${bgColor};border-radius:6px;border-left:3px solid ${labelColor};">
        <div style="font-size:11px;color:#6b7280;margin-bottom:4px;">
          <strong style="color:${labelColor};">${label}</strong>${timeStr ? ` · ${timeStr}` : ''}
        </div>
        <div style="font-size:13px;color:#374151;white-space:pre-wrap;word-break:break-word;">${escHtml(content)}</div>
      </div>`;
  }).join('');

  return `
  <div style="border-top:1px solid #e5e7eb;padding:24px;">
    <h3 style="margin:0 0 16px;font-size:14px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Conversation Transcript (${messages.length} messages)</h3>
    ${rows}
  </div>`;
}

// ============================================================================
// HTML helpers
// ============================================================================

function escHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function row(label, value) {
  if (!value) return '';
  return `<tr>
    <td style="padding:4px 12px 4px 0;font-size:13px;color:#6b7280;white-space:nowrap;vertical-align:top;">${escHtml(label)}</td>
    <td style="padding:4px 0;font-size:13px;color:#111827;">${value}</td>
  </tr>`;
}

function section(title, content) {
  return `
    <div style="margin-bottom:16px;">
      <h3 style="margin:0 0 8px;font-size:13px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">${escHtml(title)}</h3>
      ${content}
    </div>`;
}
