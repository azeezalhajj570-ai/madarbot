from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse

router = APIRouter(prefix="/docs", tags=["docs"])

DOCS_CSS = """
:root {
  --bg: #0a0a0a;
  --surface: #1a1a1a;
  --surface-raised: #222222;
  --border: rgba(255,255,255,0.08);
  --text-primary: #f5f5f5;
  --text-secondary: #a0a0a0;
  --text-muted: #6b6b6b;
  --accent: #5b8def;
  --accent-dim: rgba(91,141,239,0.12);
  --accent-glow: rgba(91,141,239,0.25);
  --green: #3fb950;
  --green-dim: rgba(63,185,80,0.12);
  --orange: #f0883e;
  --orange-dim: rgba(240,136,62,0.12);
  --red: #f85149;
  --radius: 12px;
  --radius-sm: 8px;
  --font-sans: 'Geist Sans', system-ui, -apple-system, sans-serif;
  --font-mono: 'Geist Mono', 'SF Mono', monospace;
  --sidebar-width: 260px;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  background: var(--bg);
  color: var(--text-primary);
  font-family: var(--font-sans);
  line-height: 1.7;
  min-height: 100vh;
}
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }

.layout { display: flex; min-height: 100vh; }

.sidebar {
  width: var(--sidebar-width);
  min-width: var(--sidebar-width);
  background: var(--surface);
  border-right: 1px solid var(--border);
  padding: 24px 0;
  position: sticky;
  top: 0;
  height: 100vh;
  overflow-y: auto;
  z-index: 10;
}
.sidebar-logo {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 20px 20px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 16px;
  text-decoration: none;
  color: inherit;
}
.sidebar-logo:hover { text-decoration: none; }
.logo-mark {
  width: 32px;
  height: 32px;
  background: var(--accent);
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 13px;
  color: #fff;
}
.logo-text { font-size: 16px; font-weight: 600; }
.sidebar-section {
  padding: 4px 20px 8px;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  color: var(--text-muted);
  margin-top: 8px;
}
.sidebar-link {
  display: block;
  padding: 6px 20px;
  font-size: 13px;
  color: var(--text-secondary);
  text-decoration: none;
  transition: all 0.15s;
  border-left: 2px solid transparent;
}
.sidebar-link:hover {
  color: var(--text-primary);
  background: rgba(255,255,255,0.03);
  text-decoration: none;
}
.sidebar-link.active {
  color: var(--accent);
  background: var(--accent-dim);
  border-left-color: var(--accent);
}

.content {
  flex: 1;
  min-width: 0;
  padding: 40px 48px 96px;
  max-width: 860px;
}
.hero { padding: 48px 0 40px; }
.hero h1 {
  font-size: 36px;
  font-weight: 800;
  letter-spacing: -1px;
  margin-bottom: 12px;
  line-height: 1.2;
}
.hero h1 span { color: var(--accent); }
.hero-sub {
  font-size: 16px;
  color: var(--text-secondary);
  max-width: 560px;
  margin-bottom: 28px;
}
.hero-cta {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}
.btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 20px;
  border-radius: var(--radius-sm);
  font-size: 14px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.15s;
  text-decoration: none;
  border: none;
}
.btn:hover { text-decoration: none; }
.btn-primary {
  background: var(--accent);
  color: #fff;
  box-shadow: 0 2px 12px var(--accent-glow);
}
.btn-primary:hover { filter: brightness(1.1); }
.btn-secondary {
  background: var(--surface-raised);
  color: var(--text-primary);
  border: 1px solid var(--border);
}
.btn-secondary:hover { background: #2a2a2a; }

.features { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; margin: 48px 0; }
.feature-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 20px;
}
.feature-icon { font-size: 24px; margin-bottom: 10px; }
.feature-card h3 { font-size: 15px; font-weight: 600; margin-bottom: 6px; }
.feature-card p { font-size: 13px; color: var(--text-secondary); line-height: 1.6; }

h1 { font-size: 28px; font-weight: 700; letter-spacing: -0.5px; margin-bottom: 8px; }
h2 { font-size: 20px; font-weight: 600; margin: 32px 0 12px; color: var(--text-primary); }
h3 { font-size: 16px; font-weight: 600; margin: 24px 0 8px; color: var(--text-secondary); }
p { margin-bottom: 14px; color: var(--text-secondary); font-size: 14px; line-height: 1.75; }
ul, ol { margin: 0 0 14px 20px; color: var(--text-secondary); font-size: 14px; line-height: 1.8; }
li { margin-bottom: 4px; }

code {
  font-family: var(--font-mono);
  background: rgba(255,255,255,0.06);
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 13px;
  color: var(--accent);
}
pre {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 16px;
  overflow-x: auto;
  margin-bottom: 16px;
  font-size: 13px;
  line-height: 1.6;
}
pre code {
  background: none;
  padding: 0;
  color: var(--text-primary);
}

.badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-left: 8px;
}
.badge-get { background: var(--green-dim); color: var(--green); }
.badge-post { background: var(--orange-dim); color: var(--orange); }
.badge-delete { background: rgba(248,81,73,0.12); color: var(--red); }
.badge-patch { background: var(--orange-dim); color: var(--orange); }
.badge-ro { background: var(--green-dim); color: var(--green); }
.badge-rw { background: var(--orange-dim); color: var(--orange); }
.badge-del { background: rgba(248,81,73,0.12); color: var(--red); }

.endpoint {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 12px 16px;
  margin-bottom: 8px;
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.endpoint-method {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 700;
  padding: 3px 8px;
  border-radius: 4px;
  text-transform: uppercase;
}
.endpoint-path {
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--text-primary);
  flex: 1;
}
.endpoint-desc { font-size: 12px; color: var(--text-muted); min-width: 140px; }

.table-wrap { overflow-x: auto; margin-bottom: 16px; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th {
  text-align: left;
  padding: 10px 14px;
  border-bottom: 2px solid var(--border);
  font-weight: 600;
  color: var(--text-secondary);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
td {
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
  color: var(--text-secondary);
  vertical-align: top;
}
td code { font-size: 12px; }

.note {
  background: var(--accent-dim);
  border: 1px solid rgba(91,141,239,0.18);
  border-radius: var(--radius-sm);
  padding: 12px 16px;
  margin-bottom: 16px;
  font-size: 13px;
  color: var(--accent);
}
.note-warn {
  background: var(--orange-dim);
  border-color: rgba(240,136,62,0.18);
  color: var(--orange);
}

.separator {
  border: none;
  border-top: 1px solid var(--border);
  margin: 40px 0;
}

.mobile-menu { display: none; }

@media (max-width: 768px) {
  .sidebar {
    position: fixed;
    left: -100%;
    transition: left 0.3s;
    z-index: 100;
  }
  .sidebar.open { left: 0; }
  .mobile-menu {
    display: flex;
    position: fixed;
    top: 12px;
    left: 12px;
    z-index: 101;
    width: 36px;
    height: 36px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    align-items: center;
    justify-content: center;
    cursor: pointer;
    color: var(--text-primary);
    font-size: 18px;
  }
  .content { padding: 20px 16px 80px; }
  .hero h1 { font-size: 26px; }
  .features { grid-template-columns: 1fr; }
}
"""

SIDEBAR_NAV = r"""
<div class="sidebar-section">Documentation</div>
<a class="sidebar-link %s" href="/docs">Home</a>
<a class="sidebar-link %s" href="/docs/getting-started">Getting Started</a>
<a class="sidebar-link %s" href="/docs/accounts">Accounts & Setup</a>
<a class="sidebar-link %s" href="/docs/groups">Group Management</a>
<a class="sidebar-link %s" href="/docs/scraping">Scraping</a>
<a class="sidebar-link %s" href="/docs/campaigns">Bulk Campaigns</a>
<a class="sidebar-link %s" href="/docs/automation">Automation</a>
<a class="sidebar-link %s" href="/docs/leads">Leads</a>
<a class="sidebar-link %s" href="/docs/analytics">Analytics</a>
<a class="sidebar-link %s" href="/docs/subscription">Subscription</a>
<div class="sidebar-section">API & MCP</div>
<a class="sidebar-link %s" href="/docs/mcp">MCP Server</a>
<a class="sidebar-link %s" href="/docs/agents">AI Agent Docs</a>
<div class="sidebar-section">Resources</div>
<a class="sidebar-link %s" href="/docs/faq">FAQ</a>
<a class="sidebar-link %s" href="/legal/tos">Terms of Service</a>
<a class="sidebar-link %s" href="/legal/privacy">Privacy Policy</a>
"""


def active_class(page: str, target: str) -> str:
    return "active" if page == target else ""


def docs_page(page: str, title: str, description: str, content: str, jsonld: str = "") -> str:
    """Render a documentation page with sidebar navigation and SEO metadata."""
    sidebar = SIDEBAR_NAV % (
        active_class(page, "home"),
        active_class(page, "getting-started"),
        active_class(page, "accounts"),
        active_class(page, "groups"),
        active_class(page, "scraping"),
        active_class(page, "campaigns"),
        active_class(page, "automation"),
        active_class(page, "leads"),
        active_class(page, "analytics"),
        active_class(page, "subscription"),
        active_class(page, "mcp"),
        active_class(page, "agents"),
        active_class(page, "faq"),
        active_class(page, "legal-tos"),
        active_class(page, "legal-privacy"),
    )
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0a0a0a">
<meta name="description" content="{description}">
<meta name="robots" content="index, follow">
<link rel="canonical" href="https://madar.hamedco.com/docs/{"" if page == "home" else page}">
<meta property="og:title" content="{title} — MadarBot Docs">
<meta property="og:description" content="{description}">
<meta property="og:type" content="website">
<meta property="og:url" content="https://madar.hamedco.com/docs/{"" if page == "home" else page}">
<title>{title} — MadarBot Docs</title>
<link rel="preconnect" href="https://cdn.jsdelivr.net">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/geist@1.3.0/dist/fonts/geist-sans/style.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/geist@1.3.0/dist/fonts/geist-mono/style.css">
<style>{DOCS_CSS}</style>
{jsonld}
</head>
<body>
<div class="layout">
  <button class="mobile-menu" onclick="document.querySelector('.sidebar').classList.toggle('open')" aria-label="Menu">&#9776;</button>
  <nav class="sidebar" onclick="if(window.innerWidth<=768)this.classList.remove('open')">
    <a class="sidebar-logo" href="/docs">
      <div class="logo-mark">MB</div>
      <div class="logo-text">MadarBot Docs</div>
    </a>
    {sidebar}
  </nav>
  <main class="content">{content}</main>
</div>
</body>
</html>"""


# ═══════════════════════════════════════════════════════════════════════
# LANDING PAGE
# ═══════════════════════════════════════════════════════════════════════


@router.get("", response_class=HTMLResponse)
@router.get("/", response_class=HTMLResponse)
async def docs_home(request: Request) -> str:
    return docs_page(
        "home",
        "Documentation",
        "MadarBot — Telegram automation platform documentation for humans and AI agents.",
        """
<div class="hero">
  <h1>MadarBot <span>Documentation</span></h1>
  <p class="hero-sub">Automate Telegram groups — scrape members, run bulk campaigns, capture leads, and analyze engagement. Built for community managers and AI-powered workflows.</p>
  <div class="hero-cta">
    <a class="btn btn-primary" href="/webapp/agents">Launch WebApp</a>
    <a class="btn btn-secondary" href="/docs/getting-started">Get Started</a>
    <a class="btn btn-secondary" href="/docs/mcp">MCP Server</a>
  </div>
</div>

<div class="features">
  <div class="feature-card">
    <div class="feature-icon">&#128269;</div>
    <h3>Group Scraping</h3>
    <p>Extract members, messages, and analytics from any Telegram group you manage. Build rich member profiles and track engagement.</p>
  </div>
  <div class="feature-card">
    <div class="feature-icon">&#128172;</div>
    <h3>Bulk Messaging</h3>
    <p>Send targeted campaigns to group members with rate limiting, scheduling, and recurrence. Safe delivery with cooldown controls.</p>
  </div>
  <div class="feature-card">
    <div class="feature-icon">&#9881;</div>
    <h3>Automation</h3>
    <p>Auto-reply, welcome flows, lead capture, escalation alerts, and message forwarding. Set conditions and let MadarBot handle the rest.</p>
  </div>
  <div class="feature-card">
    <div class="feature-icon">&#128202;</div>
    <h3>Analytics</h3>
    <p>Dashboard analytics, lead tracking, notification feeds, and daily summaries. Know exactly what's happening in your groups.</p>
  </div>
  <div class="feature-card">
    <div class="feature-icon">&#129302;</div>
    <h3>MCP Server</h3>
    <p>Connect AI agents (Claude, ChatGPT, Cursor) directly to your Telegram accounts. 27+ tools for reading and managing your workspace.</p>
  </div>
  <div class="feature-card">
    <div class="feature-icon">&#127758;</div>
    <h3>Multi-Language</h3>
    <p>Full English and Arabic support. RTL-ready interface. Deploy across MENA and global communities with confidence.</p>
  </div>
</div>

<hr class="separator">

<h2>Quick Links</h2>
<div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:16px">
  <a class="btn btn-secondary" href="/docs/getting-started">Getting Started</a>
  <a class="btn btn-secondary" href="/docs/mcp">MCP Tools Reference</a>
  <a class="btn btn-secondary" href="/docs/automation">Automation Tasks</a>
  <a class="btn btn-secondary" href="/docs/campaigns">Bulk Campaigns</a>
  <a class="btn btn-secondary" href="/docs/faq">FAQ</a>
</div>
""",
    )


# ═══════════════════════════════════════════════════════════════════════
# GETTING STARTED
# ═══════════════════════════════════════════════════════════════════════


@router.get("/getting-started", response_class=HTMLResponse)
async def docs_getting_started(request: Request) -> str:
    return docs_page(
        "getting-started",
        "Getting Started",
        "Learn how to set up MadarBot and link your first Telegram account.",
        """
<h1>Getting Started</h1>
<p>Welcome to MadarBot! This guide will walk you through setting up your workspace, linking a Telegram account, and running your first operation.</p>

<h2>1. Access the Dashboard</h2>
<p>MadarBot is available as a Telegram WebApp and a browser dashboard:</p>
<ul>
  <li><strong>Telegram WebApp</strong>: Open <code>/webapp/agents</code> from within Telegram for the full miniapp experience with Telegram-native authentication.</li>
  <li><strong>Browser Dashboard</strong>: Visit <code>/dashboard</code> for the browser-based interface. Requires browser user credentials configured by the platform owner.</li>
</ul>

<h2>2. Link a Telegram Account</h2>
<p>MadarBot operates through linked Telegram accounts (called "agents"). Each agent can scrape groups, send messages, and run automations on your behalf.</p>
<ol>
  <li>Navigate to <strong>Settings</strong> in the dashboard.</li>
  <li>Click <strong>Link New Account</strong>.</li>
  <li>Enter a name and phone number in international format (e.g. <code>+966501234567</code>).</li>
  <li>Telegram will send a confirmation code — enter it in the wizard.</li>
  <li>If 2FA is enabled on the Telegram account, enter your 2FA password.</li>
  <li>Once linked, the agent status will show as <strong>Active</strong>.</li>
</ol>

<div class="note">Your Telegram credentials are stored securely and used only for the features you enable. You can delete linked accounts at any time from Settings.</div>

<h2>3. Understand the Dashboard</h2>
<p>The dashboard sidebar provides navigation to all features:</p>
<ul>
  <li><strong>Home</strong> — Overview and quick actions</li>
  <li><strong>Accounts</strong> — Manage linked Telegram accounts</li>
  <li><strong>Groups</strong> — View managed groups</li>
  <li><strong>Scraper</strong> — Scrape group members and messages</li>
  <li><strong>Leads</strong> — Captured leads from automations</li>
  <li><strong>Campaigns</strong> — Create and manage bulk campaigns</li>
  <li><strong>Automation</strong> — Configure automated tasks</li>
  <li><strong>Analytics</strong> — View metrics and reports</li>
  <li><strong>Subscription</strong> — Manage your plan</li>
  <li><strong>Settings</strong> — Account and platform settings</li>
</ul>

<h2>4. Scrape Your First Group</h2>
<p>To get started with a group:</p>
<ol>
  <li>Go to <strong>Scraper</strong> in the sidebar.</li>
  <li>Select your agent account and the group you want to scrape.</li>
  <li>Set a member limit (up to 50,000 per scrape).</li>
  <li>Optionally enable message scraping and set a max age.</li>
  <li>Click <strong>Queue Scrape</strong>.</li>
</ol>
<p>The scrape job runs in the background. You can monitor progress from the Scraper page. Once complete, members appear in the Groups section.</p>

<h2>5. Next Steps</h2>
<ul>
  <li>Set up <a href="/docs/automation">automation tasks</a> like auto-reply and lead capture.</li>
  <li>Create a <a href="/docs/campaigns">bulk messaging campaign</a> to engage members.</li>
  <li>Connect an AI agent via the <a href="/docs/mcp">MCP Server</a>.</li>
  <li>Check the <a href="/docs/faq">FAQ</a> for common questions.</li>
</ul>
""",
    )


# ═══════════════════════════════════════════════════════════════════════
# ACCOUNTS & SETUP
# ═══════════════════════════════════════════════════════════════════════


@router.get("/accounts", response_class=HTMLResponse)
async def docs_accounts(request: Request) -> str:
    return docs_page(
        "accounts",
        "Accounts & Setup",
        "Link and manage Telegram accounts as agents for automation.",
        """
<h1>Accounts & Setup</h1>
<p>Linked Telegram accounts (agents) are the backbone of MadarBot. Each agent can independently scrape groups, send messages, and run automations.</p>

<h2>Linking Accounts</h2>
<p>There are two ways to link a Telegram account:</p>

<h3>Method 1: Dashboard UI</h3>
<ol>
  <li>Go to Settings in the dashboard or miniapp.</li>
  <li>Click "Link New Account".</li>
  <li>Fill in account name and phone number in international format.</li>
  <li>Follow the Telegram authentication flow (code + optional 2FA password).</li>
</ol>

<h3>Method 2: API</h3>
<p>Use the agents API to link accounts programmatically:</p>

<pre><code>POST /webapp/agents/link
Content-Type: application/json

{
  "name": "My Bot",
  "phone_number": "+966501234567"
}</code></pre>

<p>Then start authentication:</p>
<pre><code>POST /webapp/agents/auth/start
Content-Type: application/json

{
  "agent_id": 123,
  "phone_number": "+966501234567"
}</code></pre>

<h2>Account States</h2>
<table>
  <tr><th>Status</th><th>Description</th></tr>
  <tr><td><code>active</code></td><td>Account is authenticated and ready for operations.</td></tr>
  <tr><td><code>inactive</code></td><td>Account is linked but not currently usable.</td></tr>
  <tr><td><code>pending_2fa</code></td><td>Waiting for 2FA password input.</td></tr>
  <tr><td><code>pending_code</code></td><td>Waiting for Telegram confirmation code.</td></tr>
  <tr><td><code>error</code></td><td>Authentication failed or session expired.</td></tr>
</table>

<h2>Account Settings</h2>
<p>Each agent has configurable safety limits:</p>
<ul>
  <li><strong>max_actions_per_hour</strong> — Max actions per hour (up to 500)</li>
  <li><strong>max_messages_per_day</strong> — Max messages per day (up to 5000)</li>
  <li><strong>min_delay_seconds</strong> — Minimum delay between actions (≥1.0s)</li>
  <li><strong>cooldown_minutes</strong> — Cooldown period between jobs (≥5 min)</li>
  <li><strong>safety_mode_enabled</strong> — Safety mode cannot be disabled via MCP</li>
</ul>

<div class="note-warn">Safety mode cannot be disabled once enabled. This prevents accidental high-frequency messaging.</div>

<h2>Account Limits by Plan</h2>
<table>
  <tr><th>Plan</th><th>Max Linked Accounts</th></tr>
  <tr><td>Free</td><td>0 (view only)</td></tr>
  <tr><td>Pro</td><td>1</td></tr>
  <tr><td>Business</td><td>Unlimited</td></tr>
</table>
""",
    )


# ═══════════════════════════════════════════════════════════════════════
# GROUPS
# ═══════════════════════════════════════════════════════════════════════


@router.get("/groups", response_class=HTMLResponse)
async def docs_groups(request: Request) -> str:
    return docs_page(
        "groups",
        "Group Management",
        "Manage Telegram groups, view members, and sync group data.",
        """
<h1>Group Management</h1>
<p>MadarBot helps you manage Telegram groups by providing member data, message history, and group insights extracted through scraping.</p>

<h2>Viewing Groups</h2>
<p>Groups are visible in the dashboard under <strong>Groups</strong>. Each group shows:</p>
<ul>
  <li>Group title and Telegram ID</li>
  <li>Member count</li>
  <li>Your role (admin, creator, member)</li>
  <li>Last scrape timestamp</li>
</ul>

<h2>Member Management</h2>
<p>Once a group is scraped, you can:</p>
<ul>
  <li><strong>Search members</strong> by name, username, or user ID.</li>
  <li><strong>Filter by role</strong> — admins, bots, or regular members.</li>
  <li><strong>View member messages</strong> — See recent messages from a specific member.</li>
  <li><strong>Export member data</strong> for analysis or CRM integration.</li>
</ul>

<h2>Group Insights</h2>
<p>After scraping, MadarBot generates:</p>
<ul>
  <li><strong>Member activity patterns</strong></li>
  <li><strong>AI-extracted knowledge</strong> from group conversations</li>
  <li><strong>Daily summaries</strong> of group activity</li>
  <li><strong>Conversation analysis</strong> with engagement metrics</li>
</ul>

<h2>API Endpoints</h2>
<div class="endpoint">
  <span class="endpoint-method" style="background:var(--green-dim);color:var(--green)">GET</span>
  <span class="endpoint-path">/webapp/scraper/groups</span>
  <span class="endpoint-desc">List scraped groups</span>
</div>
<div class="endpoint">
  <span class="endpoint-method" style="background:var(--green-dim);color:var(--green)">GET</span>
  <span class="endpoint-path">/webapp/scraper/groups/{id}</span>
  <span class="endpoint-desc">Get group details</span>
</div>
<div class="endpoint">
  <span class="endpoint-method" style="background:var(--green-dim);color:var(--green)">GET</span>
  <span class="endpoint-path">/webapp/scraper/groups/{id}/members</span>
  <span class="endpoint-desc">List group members (paginated)</span>
</div>
<div class="endpoint">
  <span class="endpoint-method" style="background:var(--green-dim);color:var(--green)">GET</span>
  <span class="endpoint-path">/webapp/scraper/groups/{id}/messages</span>
  <span class="endpoint-desc">List group messages</span>
</div>
""",
    )


# ═══════════════════════════════════════════════════════════════════════
# SCRAPING
# ═══════════════════════════════════════════════════════════════════════


@router.get("/scraping", response_class=HTMLResponse)
async def docs_scraping(request: Request) -> str:
    return docs_page(
        "scraping",
        "Scraping",
        "Extract members, messages, and group data from Telegram groups.",
        """
<h1>Group Scraping</h1>
<p>The scraping engine extracts members, messages, and metadata from Telegram groups. Data is stored in your workspace and available for analytics, campaigns, and AI processing.</p>

<h2>How Scraping Works</h2>
<ol>
  <li>A linked agent account joins or is already a member of the target group.</li>
  <li>The scraper reads group members and recent messages via the Telegram API.</li>
  <li>Data is persisted to your database with timestamps and metadata.</li>
  <li>AI analysis runs on the scraped data to extract knowledge and insights.</li>
</ol>

<h2>Scraping Limits</h2>
<table>
  <tr><th>Parameter</th><th>Default</th><th>Maximum</th></tr>
  <tr><td>Member limit</td><td>1,000</td><td>50,000</td></tr>
  <tr><td>Message limit</td><td>None (all)</td><td>Configurable</td></tr>
  <tr><td>Max message age (days)</td><td>None (all)</td><td>Configurable</td></tr>
  <tr><td>Cooldown per group</td><td>60 seconds</td><td>Fixed</td></tr>
</table>

<div class="note">Scraping respects Telegram's rate limits. A 60-second cooldown is enforced between scrape requests for the same group.</div>

<h2>Using the Scraper API</h2>
<pre><code>POST /webapp/scraper/scrape-members
Content-Type: application/json

{
  "agent_id": 123,
  "tg_group_id": -1001234567890,
  "limit": 5000
}</code></pre>

<pre><code>POST /webapp/scraper/scrape-messages
Content-Type: application/json

{
  "agent_id": 123,
  "tg_group_id": -1001234567890,
  "message_limit": 1000,
  "max_age_days": 30
}</code></pre>

<h2>Scraper Jobs</h2>
<p>Scraping runs as asynchronous jobs. You can monitor progress:</p>
<pre><code>GET /webapp/scraper/jobs
GET /webapp/scraper/jobs/{job_id}</code></pre>

<h2>Best Practices</h2>
<ul>
  <li>Start with small member limits (1000-5000) to test the pipeline.</li>
  <li>Use <code>max_age_days</code> to limit message volume for large groups.</li>
  <li>Schedule scrapes during off-peak hours for large groups.</li>
  <li>Only scrape groups where you have legitimate administrative interest.</li>
</ul>
""",
    )


# ═══════════════════════════════════════════════════════════════════════
# CAMPAIGNS
# ═══════════════════════════════════════════════════════════════════════


@router.get("/campaigns", response_class=HTMLResponse)
async def docs_campaigns(request: Request) -> str:
    return docs_page(
        "campaigns",
        "Bulk Campaigns",
        "Create, schedule, and track bulk messaging campaigns to group members.",
        """
<h1>Bulk Messaging Campaigns</h1>
<p>Campaigns let you send targeted messages to group members with scheduling, rate limiting, and progress tracking.</p>

<h2>Creating a Campaign</h2>
<ol>
  <li>Go to <strong>Campaigns</strong> in the dashboard.</li>
  <li>Select your agent account and source group.</li>
  <li>Choose recipients — all members, filtered by role, or specific users.</li>
  <li>Write your message template.</li>
  <li>Set delivery parameters (interval, threshold, skip bots).</li>
  <li>Preview and launch.</li>
</ol>

<h2>Campaign Parameters</h2>
<table>
  <tr><th>Parameter</th><th>Type</th><th>Description</th></tr>
  <tr><td><code>message</code></td><td>string</td><td>The message text to send (required)</td></tr>
  <tr><td><code>threshold</code></td><td>int</td><td>Max messages per batch (default 50)</td></tr>
  <tr><td><code>interval_seconds</code></td><td>float</td><td>Delay between messages in a batch (default 2.0)</td></tr>
  <tr><td><code>skip_bots</code></td><td>bool</td><td>Skip bot accounts (default true)</td></tr>
  <tr><td><code>selected_user_ids</code></td><td>int[]</td><td>Send only to these user IDs (optional)</td></tr>
</table>

<h2>Campaign Types</h2>
<p>Campaigns support scheduling and recurrence:</p>
<ul>
  <li><strong>One-time</strong> — Send now or schedule for a future date.</li>
  <li><strong>Recurring</strong> — Daily, weekly, or custom interval campaigns.</li>
  <li><strong>Trigger-based</strong> — Execute when conditions are met (via automation).</li>
</ul>

<h2>Monitoring Campaigns</h2>
<p>Track campaign progress in real-time:</p>
<ul>
  <li>Messages sent / total recipients</li>
  <li>Delivery success rate</li>
  <li>Failed deliveries with error details</li>
  <li>Execution history for recurring campaigns</li>
</ul>

<h2>API Endpoints</h2>
<div class="endpoint">
  <span class="endpoint-method" style="background:var(--orange-dim);color:var(--orange)">POST</span>
  <span class="endpoint-path">/webapp/agents/{id}/campaigns</span>
  <span class="endpoint-desc">Create a campaign</span>
</div>
<div class="endpoint">
  <span class="endpoint-method" style="background:var(--green-dim);color:var(--green)">GET</span>
  <span class="endpoint-path">/webapp/agents/{id}/campaigns</span>
  <span class="endpoint-desc">List campaigns</span>
</div>
<div class="endpoint">
  <span class="endpoint-method" style="background:var(--orange-dim);color:var(--orange)">POST</span>
  <span class="endpoint-path">/webapp/agents/{id}/campaigns/{c_id}/execute</span>
  <span class="endpoint-desc">Execute a campaign</span>
</div>

<div class="note-warn">Bulk messaging must comply with Telegram's Terms of Service and local anti-spam laws. Always respect opt-out requests and reasonable messaging hours.</div>
""",
    )


# ═══════════════════════════════════════════════════════════════════════
# AUTOMATION
# ═══════════════════════════════════════════════════════════════════════


@router.get("/automation", response_class=HTMLResponse)
async def docs_automation(request: Request) -> str:
    return docs_page(
        "automation",
        "Automation",
        "Set up automated tasks — auto-reply, lead capture, welcome flows, and more.",
        """
<h1>Automation Tasks</h1>
<p>Automation tasks run on linked agent accounts and respond to group activity based on conditions you define.</p>

<h2>Task Types</h2>

<h3>reply_message</h3>
<p>Auto-reply to messages matching conditions.</p>
<pre><code>Config:
  message_template (required) — Reply text (max 4096 chars)
  reply_mode — "public" or "private"
  reply_markup_type — "inline" or "reply"
  inline_buttons — [{text: "Label", url: "https://..."}]
  delete_after_seconds — Auto-delete reply</code></pre>

<h3>welcome_flow</h3>
<p>Welcome new group members.</p>
<pre><code>Config:
  message_template (required) — Welcome message
  scheduled_follow_up_message — Optional follow-up text
  follow_up_delay_seconds — Delay before follow-up</code></pre>

<h3>lead_capture</h3>
<p>Capture leads from group interactions.</p>
<pre><code>Config:
  ack_template (required) — Acknowledgment message
  lead_label — Category label for captured leads
  ask_contact — Request contact card</code></pre>

<h3>escalation_alert</h3>
<p>Alert on urgent messages.</p>
<pre><code>Config:
  message_template (required) — Alert message
  escalation_reason — Reason for escalation</code></pre>

<h3>notify_destination</h3>
<p>Forward messages to another chat.</p>
<pre><code>Config:
  destination (required) — Target chat/group ID
  delivery_mode — "text" or "forward"
  message_template — Custom forwarding template
  suggested_reply_template — Suggested reply</code></pre>

<h2>Task Conditions</h2>
<p>Conditions determine when a task triggers:</p>
<pre><code>{
  "rules": [
    {
      "key": "text_contains",
      "operator": "contains",
      "value": "help"
    }
  ]
}</code></pre>
<p>Supported operators: <code>contains</code>, <code>starts_with</code>, <code>ends_with</code>, <code>equals</code>.</p>

<h2>Creating Tasks via API</h2>
<pre><code>POST /webapp/agents/{id}/groups/{group_id}/tasks
Content-Type: application/json

{
  "task_key": "reply_message",
  "executor_type": "agent",
  "agent_id": 123,
  "enabled": true,
  "conditions": {
    "rules": [{"key": "text_contains", "operator": "contains", "value": "pricing"}]
  },
  "config": {
    "message_template": "Check our pricing at example.com/pricing",
    "reply_mode": "private"
  }
}</code></pre>

<h2>Task Execution</h2>
<ul>
  <li>Tasks run on the specified agent account (executor_type: agent) or bot (executor_type: bot).</li>
  <li>Agent-executed tasks require a linked account with active status.</li>
  <li>Tasks respect the agent's safety limits and rate constraints.</li>
  <li>Task activity is logged and visible in the dashboard.</li>
</ul>
""",
    )


# ═══════════════════════════════════════════════════════════════════════
# LEADS
# ═══════════════════════════════════════════════════════════════════════


@router.get("/leads", response_class=HTMLResponse)
async def docs_leads(request: Request) -> str:
    return docs_page(
        "leads",
        "Leads",
        "Manage captured leads from group interactions and automation.",
        """
<h1>Lead Management</h1>
<p>Leads are captured through automation tasks (lead_capture) and group scraping. Each lead is associated with a source group and a linked agent account.</p>

<h2>Lead Data</h2>
<table>
  <tr><th>Field</th><th>Description</th></tr>
  <tr><td><code>id</code></td><td>Unique lead identifier</td></tr>
  <tr><td><code>tg_user_id</code></td><td>Telegram user ID</td></tr>
  <tr><td><code>username</code></td><td>Telegram username</td></tr>
  <tr><td><code>first_name / last_name</code></td><td>Display name</td></tr>
  <tr><td><code>source_group_tg_id</code></td><td>Group where lead was captured</td></tr>
  <tr><td><code>status</code></td><td>new, contacted, qualified, converted, closed</td></tr>
  <tr><td><code>lead_label</code></td><td>Category label from automation</td></tr>
  <tr><td><code>confidence</code></td><td>AI-assigned confidence score</td></tr>
  <tr><td><code>notes</code></td><td>Manual notes</td></tr>
</table>

<h2>Managing Leads</h2>
<ul>
  <li><strong>Filter by status</strong> — Track leads through your pipeline.</li>
  <li><strong>Add notes</strong> — Document interactions and follow-ups.</li>
  <li><strong>Update status</strong> — Move leads through stages.</li>
  <li><strong>Export data</strong> — Download leads as CSV for CRM integration.</li>
</ul>

<h2>API Endpoints</h2>
<div class="endpoint">
  <span class="endpoint-method" style="background:var(--green-dim);color:var(--green)">GET</span>
  <span class="endpoint-path">/webapp/agents/{id}/leads</span>
  <span class="endpoint-desc">List leads with pagination and filters</span>
</div>
<div class="endpoint">
  <span class="endpoint-method" style="background:var(--orange-dim);color:var(--orange)">PATCH</span>
  <span class="endpoint-path">/webapp/agents/{id}/leads/{lead_id}</span>
  <span class="endpoint-desc">Update lead status or notes</span>
</div>
""",
    )


# ═══════════════════════════════════════════════════════════════════════
# ANALYTICS
# ═══════════════════════════════════════════════════════════════════════


@router.get("/analytics", response_class=HTMLResponse)
async def docs_analytics(request: Request) -> str:
    return docs_page(
        "analytics",
        "Analytics",
        "View metrics, reports, and analytics for your groups and accounts.",
        """
<h1>Analytics & Reporting</h1>
<p>MadarBot provides analytics at multiple levels — from per-agent summaries to group-level insights.</p>

<h2>Agent Analytics</h2>
<p>View analytics for a specific agent account:</p>
<ul>
  <li>Total actions performed</li>
  <li>Messages sent (today / total)</li>
  <li>Leads captured</li>
  <li>Active automations</li>
  <li>Group membership stats</li>
</ul>

<h2>Group Analytics</h2>
<p>For scraped groups, MadarBot provides:</p>
<ul>
  <li><strong>Member activity</strong> — Most active members, posting frequency</li>
  <li><strong>Message volume</strong> — Daily/weekly message counts</li>
  <li><strong>AI knowledge extraction</strong> — Topics, trends, and FAQs</li>
  <li><strong>Daily summaries</strong> — Auto-generated group digests</li>
  <li><strong>Conversation analysis</strong> — Sentiment and engagement metrics</li>
</ul>

<h2>API Endpoints</h2>
<div class="endpoint">
  <span class="endpoint-method" style="background:var(--green-dim);color:var(--green)">GET</span>
  <span class="endpoint-path">/webapp/agents/{id}/analytics</span>
  <span class="endpoint-desc">Get agent analytics</span>
</div>
<div class="endpoint">
  <span class="endpoint-method" style="background:var(--green-dim);color:var(--green)">GET</span>
  <span class="endpoint-path">/webapp/scraper/groups/{id}/daily-summaries</span>
  <span class="endpoint-desc">Get daily group summaries</span>
</div>
<div class="endpoint">
  <span class="endpoint-method" style="background:var(--green-dim);color:var(--green)">GET</span>
  <span class="endpoint-path">/webapp/scraper/groups/{id}/knowledge</span>
  <span class="endpoint-desc">Get AI-extracted knowledge</span>
</div>

<h2>Notifications</h2>
<p>Stay informed with real-time notifications:</p>
<ul>
  <li>Scrape job completion</li>
  <li>Campaign delivery status</li>
  <li>Automation task results</li>
  <li>Lead capture events</li>
  <li>Error and warning alerts</li>
</ul>
""",
    )


# ═══════════════════════════════════════════════════════════════════════
# SUBSCRIPTION
# ═══════════════════════════════════════════════════════════════════════


@router.get("/subscription", response_class=HTMLResponse)
async def docs_subscription(request: Request) -> str:
    return docs_page(
        "subscription",
        "Subscription",
        "Plans, billing, and upgrade information.",
        """
<h1>Subscription Plans</h1>
<p>MadarBot offers tiered plans to suit different needs — from individual group managers to enterprise teams.</p>

<h2>Plan Comparison</h2>
<table>
  <tr><th>Feature</th><th>Free</th><th>Pro</th><th>Business</th></tr>
  <tr><td>Linked accounts</td><td>0</td><td>1</td><td>Unlimited</td></tr>
  <tr><td>Group scraping</td><td>View only</td><td>Full access</td><td>Full access</td></tr>
  <tr><td>Bulk messaging</td><td>—</td><td>Yes</td><td>Yes</td></tr>
  <tr><td>Automation tasks</td><td>—</td><td>Up to 10</td><td>Unlimited</td></tr>
  <tr><td>Lead management</td><td>View only</td><td>Full access</td><td>Full access</td></tr>
  <tr><td>AI features</td><td>—</td><td>Standard</td><td>Advanced</td></tr>
  <tr><td>MCP Server access</td><td>—</td><td>Yes</td><td>Yes</td></tr>
  <tr><td>Data retention</td><td>7 days</td><td>30 days</td><td>90+ days</td></tr>
</table>

<h2>Managing Your Subscription</h2>
<ul>
  <li><strong>Upgrade</strong> — Available from the Settings page or via the Upgrade button.</li>
  <li><strong>Cancel</strong> — Cancel anytime; access continues until the billing period ends.</li>
  <li><strong>Promo codes</strong> — Redeem codes from the subscription panel.</li>
  <li><strong>Billing</strong> — Payments processed securely via Stripe.</li>
</ul>

<h2>Refunds</h2>
<p>Refunds are available for billing errors, duplicate charges, or prolonged service outages. See the <a href="/legal/refund">Refund Policy</a> for details.</p>
""",
    )


# ═══════════════════════════════════════════════════════════════════════
# MCP SERVER
# ═══════════════════════════════════════════════════════════════════════


@router.get("/mcp", response_class=HTMLResponse)
async def docs_mcp(request: Request) -> str:
    return docs_page(
        "mcp",
        "MCP Server",
        "Connect AI agents to MadarBot via the Model Context Protocol.",
        """
<h1>MCP Server</h1>
<p>The MCP (Model Context Protocol) server lets you connect AI agents like Claude, ChatGPT, and Cursor directly to your MadarBot workspace. With 27+ tools, AI agents can read group data, manage leads, run automations, and execute bulk campaigns on your behalf.</p>

<h2>Quick Start</h2>
<ol>
  <li>Enable the MCP server by setting <code>MCP_ENABLED=true</code> in your environment.</li>
  <li>Create an MCP token from the dashboard (Settings).</li>
  <li>Configure your AI client with the MCP endpoint.</li>
</ol>

<h2>Endpoint</h2>
<p>The MCP server is available at:</p>
<pre><code>POST https://madar.hamedco.com/mcp/
Authorization: Bearer YOUR_MCP_TOKEN</code></pre>

<p>Or using query parameter authentication:</p>
<pre><code>POST https://madar.hamedco.com/mcp/?token=YOUR_MCP_TOKEN</code></pre>

<h2>Authentication</h2>
<p>MCP supports two auth tiers:</p>
<ul>
  <li><strong>Scoped tokens</strong> — Created via the dashboard, linked to a specific Telegram user. Supports token expiration.</li>
  <li><strong>Static token</strong> — Set via <code>MCP_AUTH_TOKEN</code> env var for admin-level access.</li>
</ul>

<h2>Available Tools (27 total)</h2>

<h3>Health</h3>
<ul><li><code>madarbot_health</code> — Check server health and configuration</li></ul>

<h3>Accounts</h3>
<ul>
  <li><code>madarbot_list_accounts</code> — List linked Telegram accounts</li>
  <li><code>madarbot_get_account</code> — Get account details</li>
  <li><code>madarbot_update_account</code> — Update account settings</li>
  <li><code>madarbot_delete_account</code> — Delete an account (requires confirmation)</li>
</ul>

<h3>Groups</h3>
<ul>
  <li><code>madarbot_list_visible_groups</code> — List groups visible to the actor</li>
  <li><code>madarbot_get_group_members</code> — Get group members (paginated, up to 50k/page)</li>
  <li><code>madarbot_start_group_sync</code> — Start scraping group members and messages</li>
  <li><code>madarbot_get_sync_status</code> — Get last sync status for a group</li>
  <li><code>madarbot_get_member_messages</code> — Get messages from a specific member</li>
</ul>

<h3>Tasks</h3>
<ul>
  <li><code>madarbot_list_task_catalog</code> — List available task types with config schemas</li>
  <li><code>madarbot_list_tasks</code> — List tasks for a group</li>
  <li><code>madarbot_create_task</code> — Create or upsert a task</li>
  <li><code>madarbot_delete_task</code> — Delete a task (requires confirmation)</li>
</ul>

<h3>Leads</h3>
<ul>
  <li><code>madarbot_list_leads</code> — List leads with filters</li>
  <li><code>madarbot_get_lead</code> — Get lead details</li>
  <li><code>madarbot_update_lead_status</code> — Update lead status</li>
  <li><code>madarbot_add_lead_note</code> — Add a note to a lead</li>
  <li><code>madarbot_delete_lead</code> — Delete a lead</li>
</ul>

<h3>Notifications</h3>
<ul>
  <li><code>madarbot_list_notifications</code> — List notifications</li>
  <li><code>madarbot_mark_notifications_seen</code> — Mark all as seen</li>
  <li><code>madarbot_get_unseen_count</code> — Get unseen notification count</li>
</ul>

<h3>Analytics & Safety</h3>
<ul>
  <li><code>madarbot_get_analytics</code> — Get analytics summary</li>
  <li><code>madarbot_get_safety_settings</code> — Get safety settings for an agent</li>
  <li><code>madarbot_update_safety_settings</code> — Update safety settings (safety mode cannot be disabled)</li>
</ul>

<h3>Bulk Messaging</h3>
<ul>
  <li><code>madarbot_list_bulk_recipients</code> — List available recipients</li>
  <li><code>madarbot_send_bulk_message</code> — Send a bulk message campaign</li>
  <li><code>madarbot_list_bulk_jobs</code> — List bulk message jobs</li>
  <li><code>madarbot_get_bulk_job</code> — Get job status with sending progress</li>
</ul>

<h3>Subscription</h3>
<ul>
  <li><code>madarbot_get_subscription</code> — Get subscription details</li>
  <li><code>madarbot_list_subscriptions</code> — List all active subscriptions</li>
  <li><code>madarbot_grant_subscription</code> — Grant a subscription</li>
  <li><code>madarbot_cancel_subscription</code> — Cancel a subscription</li>
</ul>

<h2>Read-Only Mode</h2>
<p>When <code>MCP_READONLY=true</code> (default), write operations return an error. Tools are labeled:</p>
<ul>
  <li><span class="badge badge-ro">Read</span> Read-only — Always available</li>
  <li><span class="badge badge-rw">Write</span> Requires <code>MCP_READONLY=false</code></li>
  <li><span class="badge badge-del">Destructive</span> Requires <code>MCP_READONLY=false</code> + <code>confirm=true</code></li>
</ul>

<h2>Running Standalone</h2>
<pre><code>python -m bot.run_mcp_server --transport stdio
python -m bot.run_mcp_server --transport streamable-http --host 0.0.0.0 --port 8090</code></pre>

<h2>JSON-RPC Protocol</h2>
<p>The MCP endpoint accepts standard JSON-RPC 2.0 requests:</p>
<pre><code>{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "madarbot_list_leads",
    "arguments": { "agent_id": 123, "page": 1 }
  },
  "id": 1
}</code></pre>

<p>Supported methods:</p>
<ul>
  <li><code>initialize</code> — Handshake with capabilities</li>
  <li><code>tools/list</code> — List all available tools with schemas</li>
  <li><code>tools/call</code> — Invoke a tool by name</li>
  <li><code>resources/list</code> — Resources (empty for MadarBot)</li>
  <li><code>prompts/list</code> — Prompts (empty for MadarBot)</li>
</ul>
""",
    )


# ═══════════════════════════════════════════════════════════════════════
# AI AGENT DOCS (structured + JSON-LD)
# ═══════════════════════════════════════════════════════════════════════

AI_AGENTS_JSONLD = """<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "name": "MadarBot MCP Server",
  "applicationCategory": "DeveloperApplication",
  "description": "Model Context Protocol server for Telegram automation. Connect AI agents to manage groups, leads, campaigns, and analytics.",
  "url": "https://madar.hamedco.com/docs/agents",
  "offers": {
    "@type": "Offer",
    "price": "0",
    "priceCurrency": "USD"
  },
  "featureList": [
    "27 MCP tools across 8 functional areas",
    "Scoped token authentication",
    "Read-only safety mode",
    "Group member and message access",
    "Bulk messaging with rate limiting",
    "Lead and automation management",
    "Analytics and notifications"
  ]
}
</script>"""


@router.get("/agents", response_class=HTMLResponse)
async def docs_agents(request: Request) -> str:
    return docs_page(
        "agents",
        "AI Agent Documentation",
        "Machine-readable documentation and MCP tool reference for AI agents.",
        """
<h1>AI Agent Documentation</h1>
<p>This page provides machine-readable documentation designed for AI agents (LLMs, MCP clients, coding assistants) to understand and use the MadarBot MCP server.</p>

<div class="note">This page includes JSON-LD structured data for programmatic consumption by AI systems. Human-readable documentation is available at <a href="/docs/mcp">MCP Server Docs</a>.</div>

<h2>Quick Integration</h2>
<p>To connect an AI agent to MadarBot:</p>
<ol>
  <li>Obtain an MCP token from your dashboard or admin.</li>
  <li>Configure your MCP client with the endpoint: <code>https://madar.hamedco.com/mcp/</code></li>
  <li>Set the <code>Authorization: Bearer &lt;token&gt;</code> header.</li>
  <li>Call <code>initialize</code> to get server capabilities.</li>
  <li>Call <code>tools/list</code> to discover available tools with input schemas.</li>
</ol>

<h2>Tool Discovery Flow</h2>
<pre><code>1. initialize → server capabilities + protocol version
2. tools/list → 27 tools with full JSON schemas
3. tools/call → execute tool by name with arguments
4. Response → {content, structuredContent: {data, metadata}}</code></pre>

<h2>Response Structure</h2>
<p>All tool responses use the structured response format:</p>
<pre><code>{
  "content": "Human-readable summary string",
  "structuredContent": {
    "data": { /* tool-specific payload */ },
    "metadata": {
      "source": "madarbot-mcp",
      "version": "1.0"
    }
  }
}</code></pre>

<p>Error responses follow the same structure with <code>data: null</code> and an <code>error</code> block:</p>
<pre><code>{
  "content": "Error description",
  "structuredContent": {
    "data": null,
    "error": {
      "code": "READONLY_MODE",
      "message": "Write operations are disabled in read-only mode"
    }
  }
}</code></pre>

<h2>Common Error Codes</h2>
<table>
  <tr><th>Code</th><th>Meaning</th><th>Resolution</th></tr>
  <tr><td><code>READONLY_MODE</code></td><td>Write attempted in read-only mode</td><td>Set MCP_READONLY=false</td></tr>
  <tr><td><code>NOT_FOUND</code></td><td>Resource not found</td><td>Verify IDs are correct</td></tr>
  <tr><td><code>ACCESS_DENIED</code></td><td>Permission denied</td><td>Check actor permissions</td></tr>
  <tr><td><code>VALIDATION_ERROR</code></td><td>Invalid input parameters</td><td>Check tool schema</td></tr>
  <tr><td><code>CONFIRMATION_REQUIRED</code></td><td>Destructive operation</td><td>Add confirm=true</td></tr>
  <tr><td><code>RATE_LIMITED</code></td><td>Cooldown active</td><td>Wait and retry</td></tr>
</table>

<h2>Example: List Leads</h2>
<pre><code>{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "madarbot_list_leads",
    "arguments": {
      "agent_id": 123,
      "status": "new",
      "page": 1,
      "page_size": 25
    }
  },
  "id": 1
}</code></pre>

<h2>Example: Create Bulk Campaign</h2>
<pre><code>{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "madarbot_send_bulk_message",
    "arguments": {
      "agent_id": 123,
      "tg_group_id": -1001234567890,
      "message": "Hello from MadarBot! Check out our new features.",
      "threshold": 50,
      "interval_seconds": 2.0,
      "skip_bots": true
    }
  },
  "id": 2
}</code></pre>

<h2>Example: Create Automation Task</h2>
<pre><code>{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "madarbot_list_task_catalog",
    "arguments": {}
  },
  "id": 3
}</code></pre>

<p>After discovering task types, create a task:</p>
<pre><code>{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "madarbot_create_task",
    "arguments": {
      "tg_group_id": -1001234567890,
      "task_key": "reply_message",
      "executor_type": "agent",
      "agent_id": 123,
      "enabled": true,
      "conditions": {
        "rules": [{"key": "text_contains", "operator": "contains", "value": "help"}]
      },
      "config": {
        "message_template": "How can I help you?",
        "reply_mode": "private"
      }
    }
  },
  "id": 4
}</code></pre>

<h2>Tool Input Schema Convention</h2>
<p>All tools follow these conventions:</p>
<ul>
  <li>IDs are integers (<code>agent_id</code>, <code>tg_group_id</code>, <code>lead_id</code>, <code>job_id</code>).</li>
  <li>Pagination uses <code>page</code> (1-indexed) and <code>page_size</code>.</li>
  <li>Destructive operations require <code>confirm: true</code>.</li>
  <li>Optional parameters can be omitted or set to <code>null</code>.</li>
  <li>Telegram group IDs are negative integers (e.g., <code>-1001234567890</code>).</li>
</ul>

<h2>Environment Configuration</h2>
<table>
  <tr><th>Variable</th><th>Default</th><th>Description</th></tr>
  <tr><td><code>MCP_ENABLED</code></td><td><code>false</code></td><td>Enable MCP server</td></tr>
  <tr><td><code>MCP_READONLY</code></td><td><code>true</code></td><td>Read-only mode for safety</td></tr>
  <tr><td><code>MCP_AUTH_TOKEN</code></td><td><code>null</code></td><td>Static auth token</td></tr>
  <tr><td><code>MCP_DEFAULT_ACTOR_USER_ID</code></td><td><code>null</code></td><td>Fallback Telegram user ID</td></tr>
</table>
""",
        jsonld=AI_AGENTS_JSONLD,
    )


# ═══════════════════════════════════════════════════════════════════════
# FAQ
# ═══════════════════════════════════════════════════════════════════════


@router.get("/faq", response_class=HTMLResponse)
async def docs_faq(request: Request) -> str:
    return docs_page(
        "faq",
        "FAQ",
        "Frequently asked questions about MadarBot.",
        """
<h1>Frequently Asked Questions</h1>

<h2>General</h2>
<h3>What is MadarBot?</h3>
<p>MadarBot is a Telegram automation platform that helps community managers and businesses manage groups, send bulk messages, capture leads, and analyze engagement — all through a web dashboard and MCP server for AI agents.</p>

<h3>Is MadarBot free?</h3>
<p>MadarBot offers a free tier with view-only access. Pro and Business plans unlock full scraping, messaging, automation, and MCP features. See <a href="/docs/subscription">Subscription Plans</a>.</p>

<h3>Which Telegram groups can I manage?</h3>
<p>You can manage any group where your linked agent account is a member. Admin access provides the most functionality, but member-level scraping is also supported.</p>

<h2>Accounts</h2>
<h3>How many accounts can I link?</h3>
<p>Pro plan: 1 account. Business plan: unlimited accounts.</p>

<h3>Is it safe to link my Telegram account?</h3>
<p>Yes. Credentials are stored with encryption. You can delete linked accounts at any time. See our <a href="/legal/privacy">Privacy Policy</a>.</p>

<h3>What happens if my Telegram session expires?</h3>
<p>You'll need to re-authenticate the account through the dashboard. Notification events will alert you before sessions expire.</p>

<h2>Scraping</h2>
<h3>How many members can I scrape?</h3>
<p>Up to 50,000 members per scrape job. For larger groups, you can run multiple scrape jobs.</p>

<h3>Is scraping against Telegram's Terms?</h3>
<p>MadarBot uses official Telegram APIs at controlled rates. You are responsible for complying with Telegram's Terms of Service and group rules.</p>

<h3>How long is scraped data retained?</h3>
<p>Data retention depends on your plan: Free (7 days), Pro (30 days), Business (90+ days).</p>

<h2>Messaging</h2>
<h3>Can I send images or media?</h3>
<p>Currently, MadarBot supports text messages. Media messaging is planned for a future release.</p>

<h3>What are the rate limits?</h3>
<p>Rate limits are configurable per agent: max 500 actions/hour, 5000 messages/day, minimum 1 second delay between messages, and 5 minute cooldown between jobs.</p>

<h3>Can I schedule campaigns?</h3>
<p>Yes. Campaigns support one-time scheduling and recurring configurations (daily, weekly, custom intervals).</p>

<h2>MCP & AI</h2>
<h3>What is the MCP server?</h3>
<p>The MCP (Model Context Protocol) server lets AI agents like Claude, ChatGPT, and Cursor interact with your MadarBot workspace. AI agents can read groups, manage leads, send messages, and more. See <a href="/docs/mcp">MCP Server Docs</a>.</p>

<h3>How do I set up the MCP server?</h3>
<p>Set <code>MCP_ENABLED=true</code> in your environment, create an MCP token in the dashboard, and configure your AI client. See <a href="/docs/mcp">MCP Server Docs</a> for detailed instructions.</p>

<h3>Can I use the MCP server in read-only mode?</h3>
<p>Yes, <code>MCP_READONLY=true</code> is the default. AI agents can read all data but cannot modify anything. This is recommended for initial setup.</p>

<h2>Billing</h2>
<h3>How do I upgrade my plan?</h3>
<p>Go to Settings → Subscription in the dashboard and select your desired plan. Payments are processed via Stripe.</p>

<h3>Can I get a refund?</h3>
<p>Refunds are available for billing errors, duplicate charges, or prolonged service outages. See the <a href="/legal/refund">Refund Policy</a>.</p>

<h3>How do I cancel my subscription?</h3>
<p>Cancel from the Settings page at any time. Your access continues until the end of the current billing period.</p>
""",
    )
