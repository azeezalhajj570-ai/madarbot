    const mockDb = {
      auth: {
        user: {
          id: 1,
          username: "owner",
          first_name: "Combot",
          last_name: "Owner",
          language_code: "en",
        },
        is_bot_owner: true,
        subscription_required: false,
        subscription_request: null,
        groups: [
          { id: 101, title: "Growth Ops Room", tg_group_id: -100101, role: "owner" },
          { id: 202, title: "Support Escalations", tg_group_id: -100202, role: "admin" },
        ],
      },
      overview: {
        101: {
          group: { id: 101, title: "Growth Ops Room", tg_group_id: -100101 },
          stats: {
            configured_settings: 18,
            enabled_plugins: 6,
            total_warnings: 7,
            total_leads: 32,
            active_moderators: 4,
            member_growth: { tracked_admin_accounts: 4 },
            message_activity: {
              "2026-03-28": 41,
              "2026-03-29": 58,
              "2026-03-30": 45,
              "2026-03-31": 62,
              "2026-04-01": 39,
            },
          },
          recent_actions: [
            {
              action: "warn",
              reason: "Repeated invite links",
              moderator_id: 1,
              created_at: new Date(Date.now() - 3 * 60 * 1000).toISOString(),
              details: { target_user_id: 4001 },
            },
            {
              action: "mute_user",
              reason: "Flooding",
              moderator_id: 2,
              created_at: new Date(Date.now() - 36 * 60 * 1000).toISOString(),
              details: { target_user_id: 4002 },
            },
            {
              action: "ban_user",
              reason: "Scam links",
              moderator_id: 1,
              created_at: new Date(Date.now() - 90 * 60 * 1000).toISOString(),
              details: { target_user_id: 4003 },
            },
          ],
        },
      },
      settingsSchema: {
        anti_links: [
          { key: "anti_links_enabled", type: "toggle", category: "general", label_key: "Anti links", default: true },
          { key: "anti_links_warn_limit", type: "number", category: "general", label_key: "Warn limit", min: 1, max: 10, default: 3 },
        ],
        anti_spam: [
          { key: "anti_spam_enabled", type: "toggle", category: "moderation", label_key: "Anti spam", default: true },
          { key: "anti_spam_threshold", type: "number", category: "moderation", label_key: "Spam threshold", min: 1, max: 100, default: 12 },
        ],
        semantic_assistant: [
          { key: "semantic_assistant_enabled", type: "toggle", category: "automation", label_key: "Semantic assistant", default: false },
          { key: "semantic_assistant_prompt", type: "text", category: "automation", label_key: "Prompt", default: "Reply concisely." },
        ],
      },
      settings: {
        101: {
          anti_links_enabled: true,
          anti_links_warn_limit: 3,
          anti_spam_enabled: true,
          anti_spam_threshold: 12,
          semantic_assistant_enabled: false,
          semantic_assistant_prompt: "Reply concisely.",
        },
      },
      accessGate: {
        101: {
          group_id: 101,
          required_group_tg_ids: [-100202],
          candidates: [{ id: 202, title: "Support Escalations", tg_group_id: -100202, role: "admin" }],
        },
      },
      joinRequestSettings: {
        101: {
          group_id: 101,
          enabled: true,
          required_group_tg_ids: [-100202],
        },
      },
      joinRequests: {
        101: {
          group_id: 101,
          pending_count: 2,
          items: [
            {
              id: 501,
              user_tg_id: 9001,
              first_name: "Lina",
              username: "lina_ops",
              created_at: new Date(Date.now() - 35 * 60 * 1000).toISOString(),
              required_groups: [
                { tg_id: -100202, title: "Support Escalations", joined: true },
              ],
              verified_count: 1,
              required_count: 1,
              all_verified: true,
            },
            {
              id: 502,
              user_tg_id: 9002,
              first_name: "Rami",
              username: "rami_queue",
              created_at: new Date(Date.now() - 11 * 60 * 1000).toISOString(),
              required_groups: [
                { tg_id: -100202, title: "Support Escalations", joined: false },
              ],
              verified_count: 0,
              required_count: 1,
              all_verified: false,
            },
          ],
        },
      },
      warnings: {
        101: [
          { user_id: 4001, count: 2, reason: "Repeated invite links", issued_by: 1, created_at: new Date(Date.now() - 3 * 60 * 1000).toISOString() },
          { user_id: 4012, count: 1, reason: "Off-topic ads", issued_by: 2, created_at: new Date(Date.now() - 120 * 60 * 1000).toISOString() },
        ],
      },
      logs: {
        101: [
          { action: "warn", target_user_id: 4001, moderator_id: 1, reason: "Repeated invite links", details: {}, created_at: new Date(Date.now() - 3 * 60 * 1000).toISOString() },
          { action: "mute_user", target_user_id: 4002, moderator_id: 2, reason: "Flooding", details: {}, created_at: new Date(Date.now() - 36 * 60 * 1000).toISOString() },
          { action: "lead_captured", target_user_id: 4021, moderator_id: null, reason: "Pricing request", details: { lead_label: "sales" }, created_at: new Date(Date.now() - 240 * 60 * 1000).toISOString() },
        ],
      },
      members: {
        101: [
          { user_id: 1, role: "owner", username: "owner", full_name: "Combot Owner" },
          { user_id: 2, role: "admin", username: "opsmod", full_name: "Ops Mod" },
          { user_id: 3, role: "moderator", username: "queuewatch", full_name: "Queue Watch" },
        ],
      },
      taskCatalog: [
        {
          key: "reply_message",
          title: "Reply Message",
          description: "Send a templated reply when a message matches conditions.",
          trigger: "message.received",
          config_schema: [
            { key: "template", type: "string", label: "Template", description: "Supports {text}, {group_title}, {user_id}." },
          ],
        },
        {
          key: "notify_destination",
          title: "Notify Destination",
          description: "Forward or copy lead activity to another destination.",
          trigger: "message.received",
          config_schema: [
            { key: "destination", type: "string", label: "Destination", description: "Chat ID, username, or destination identifier." },
            { key: "delivery_mode", type: "string", label: "Delivery Mode", description: "text, forward, copy, text_and_forward, text_and_copy" },
            { key: "template", type: "string", label: "Template", description: "Optional notification text." },
          ],
        },
      ],
      tasks: {
        101: [
          {
            assignment_id: "task-a1",
            task_key: "reply_message",
            executor_type: "bot",
            enabled: true,
            conditions: { text_contains_any: "pricing,demo" },
            config: { template: "Thanks for reaching out. We will follow up shortly." },
            agent_id: null,
          },
        ],
      },
      scheduledMessages: {
        101: [
          {
            id: "sched-1",
            text: "Weekly rollout summary at 16:00 UTC.",
            send_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
            status: "pending",
            cron: "0 16 * * 1",
            delete_after_seconds: null,
          },
        ],
      },
      agents: {
        101: [
          {
            id: 11,
            group_id: 101,
            telegram_user_id: 9011,
            phone_number: "+12025550101",
            external_account_id: "ops.agent",
            status: "healthy",
            auth_state: "authorized",
            metadata: { username: "ops_agent", linked_at: new Date(Date.now() - 3 * 86400000).toISOString(), last_active_at: new Date(Date.now() - 3600000).toISOString(), jobs_count: 4 },
          },
        ],
      },
      agentJobs: {
        11: [
          { id: 701, agent_id: 11, job_type: "send_message", job_payload: { text: "follow up" }, status: "completed" },
          { id: 702, agent_id: 11, job_type: "reply_message", job_payload: { text: "response" }, status: "queued" },
        ],
      },
      ownerStats: {
        total_groups: 14,
        active_groups: 12,
        tracked_admins: 28,
        moderation_actions: 642,
        open_warnings: 18,
        enabled_plugins: 41,
        linked_agents: 6,
        pending_agent_jobs: 3,
      },
      ownerGroups: [
        {
          id: 101,
          title: "Growth Ops Room",
          tg_group_id: -100101,
          is_active: true,
          created_at: "2026-03-01T10:00:00+00:00",
          admin_count: 4,
          warning_count: 7,
          plugin_count: 6,
          agent_count: 1,
          last_activity_at: new Date(Date.now() - 3600000).toISOString(),
        },
        {
          id: 202,
          title: "Support Escalations",
          tg_group_id: -100202,
          is_active: false,
          created_at: "2026-02-16T09:30:00+00:00",
          admin_count: 3,
          warning_count: 1,
          plugin_count: 3,
          agent_count: 0,
          last_activity_at: new Date(Date.now() - 86400000).toISOString(),
        },
      ],
      ownerSubscriptions: [
        {
          id: 31,
          tg_user_id: 5501,
          username: "newadmin",
          full_name: "New Admin",
          language_code: "en",
          message: "Need access for rollout support.",
          status: "pending",
          response: null,
          response_by: null,
          created_at: new Date(Date.now() - 6 * 3600000).toISOString(),
          updated_at: new Date(Date.now() - 6 * 3600000).toISOString(),
        },
        {
          id: 32,
          tg_user_id: 5502,
          username: "opslead",
          full_name: "Ops Lead",
          language_code: "en",
          message: "Production owner access.",
          status: "approved",
          response: "Approved",
          response_by: 1,
          created_at: new Date(Date.now() - 24 * 3600000).toISOString(),
          updated_at: new Date(Date.now() - 20 * 3600000).toISOString(),
        },
      ],
      ownerPrivateAccessGate: {
        required_group_tg_ids: [-100101],
        candidates: [
          { id: 101, title: "Growth Ops Room", tg_group_id: -100101, is_active: true },
          { id: 202, title: "Support Escalations", tg_group_id: -100202, is_active: true },
        ],
      },
      ownerAudit: [
        {
          id: 1,
          actor_id: 1,
          action: "disable_group",
          target_type: "group",
          target_id: "202",
          detail: { reason: "chargeback" },
          created_at: new Date(Date.now() - 86400000).toISOString(),
        },
        {
          id: 2,
          actor_id: 1,
          action: "approve_subscription",
          target_type: "subscription",
          target_id: "31",
          detail: { response: "Approved" },
          created_at: new Date(Date.now() - 3 * 3600000).toISOString(),
        },
      ],
    };
    async function mockRequest(path, options = {}) {
      const method = (options.method || "GET").toUpperCase();
      const body = options.body ? JSON.parse(options.body) : null;

      if (path === "/webapp/auth/me") return structuredClone(mockDb.auth);
      if (path === "/webapp/subscription-request" && method === "POST") {
        mockDb.auth.subscription_required = true;
        mockDb.auth.subscription_request = {
          id: Date.now(),
          status: "pending",
          message: body.message || "",
          response: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        return { status: "ok", request: structuredClone(mockDb.auth.subscription_request) };
      }
      if (path === "/webapp/auth/language" && method === "PATCH") {
        mockDb.auth.user.language_code = body.language_code || "en";
        return { status: "ok", language_code: mockDb.auth.user.language_code };
      }
      if (path === "/settings/schema") return structuredClone(mockDb.settingsSchema);
      if (path === "/webapp/owner/stats") return structuredClone(mockDb.ownerStats);
      if (path === "/webapp/owner/groups") return structuredClone(mockDb.ownerGroups);
      if (path === "/webapp/owner/subscriptions") return structuredClone(mockDb.ownerSubscriptions);
      if (path === "/webapp/owner/private-access-gate") return structuredClone(mockDb.ownerPrivateAccessGate);
      if (path.startsWith("/webapp/owner/audit-log")) return structuredClone(mockDb.ownerAudit);
      if (path.startsWith("/webapp/scraper/groups?")) {
        const url = new URL(path, "http://mock.local");
        const tgGroupId = Number(url.searchParams.get("tg_group_id") || 0);
        return structuredClone(
          tgGroupId
            ? [
                {
                  id: 900 + Math.abs(tgGroupId % 100),
                  tg_group_id: tgGroupId,
                  title: "Mock Scraped Group",
                  username: "mock_group",
                  group_type: "supergroup",
                  member_count: 128,
                  description: "Mock scraper output",
                  created_at: new Date(Date.now() - 3600_000).toISOString(),
                  updated_at: new Date().toISOString(),
                },
              ]
            : []
        );
      }
      if (path.match(/\/webapp\/scraper\/groups\/\d+\/members/)) {
        return structuredClone({
          members: [
            { id: 1, tg_user_id: 1001, username: "alice", first_name: "Alice", last_name: "", full_name: "Alice", phone: null, is_bot: false, is_premium: true, role: "admin", joined_date: new Date(Date.now() - 86400_000).toISOString(), scraped_at: new Date().toISOString() },
            { id: 2, tg_user_id: 1002, username: "bob", first_name: "Bob", last_name: "", full_name: "Bob", phone: null, is_bot: false, is_premium: false, role: "member", joined_date: new Date(Date.now() - 172800_000).toISOString(), scraped_at: new Date().toISOString() },
          ],
          total: 2,
          page: 1,
          page_size: 20,
        });
      }
      if (path.match(/\/webapp\/scraper\/groups\/\d+\/messages/)) {
        return structuredClone({
          messages: [
            { id: 1, message_id: 501, sender_user_id: 1001, sender_username: "alice", sender_first_name: "Alice", sender_last_name: "", message_text: "First scraped message", message_date: new Date(Date.now() - 1800_000).toISOString(), message_type: "text", media_file_id: null, media_url: null, reply_to_message_id: null, forward_from_user_id: null, scraped_at: new Date().toISOString() },
            { id: 2, message_id: 502, sender_user_id: 1002, sender_username: "bob", sender_first_name: "Bob", sender_last_name: "", message_text: "Second scraped message", message_date: new Date(Date.now() - 900_000).toISOString(), message_type: "text", media_file_id: null, media_url: null, reply_to_message_id: null, forward_from_user_id: null, scraped_at: new Date().toISOString() },
          ],
          total: 2,
          page: 1,
          page_size: 20,
        });
      }
      if (path.match(/\/webapp\/join-requests\/\d+\/action/) && method === "POST") {
        const approvalId = Number((path.match(/\/webapp\/join-requests\/(\d+)\/action/) || [])[1] || 0);
        Object.keys(mockDb.joinRequests || {}).forEach((groupId) => {
          const payload = mockDb.joinRequests[groupId];
          if (!payload) return;
          payload.items = (payload.items || []).filter((item) => Number(item.id) !== approvalId);
          payload.pending_count = payload.items.length;
        });
        return { status: body.action === "approve" ? "approved" : "declined", approval_id: approvalId };
      }
      if (path.startsWith("/webapp/scraper/scrape/") && method === "POST") {
        return { job_id: Date.now(), status: "pending", message: "Scraping job dispatched successfully" };
      }
      if (path === "/webapp/bot/install-groups") {
        return structuredClone(
          (mockDb.auth?.groups || [])
            .filter((group) => ["owner", "admin"].includes(String(group.role || "").toLowerCase()))
            .map((group) => ({
              managed_group_id: group.id,
              tg_group_id: group.tg_group_id,
              title: group.title,
              role: group.role || "admin",
              is_managed: true,
            }))
        );
      }
      if (path === "/webapp/bot/install-links" && method === "POST") {
        return {
          bot_username: "combot_test_bot",
          permissions: body.permissions || [],
          manual_confirmation_required: true,
          links: (body.groups || []).map((group) => ({
            group_id: group.managed_group_id || null,
            tg_group_id: group.tg_group_id,
            title: group.title,
            url: "https://t.me/combot_test_bot?startgroup=true",
          })),
        };
      }
      if (path === "/webapp/tasks/catalog") return structuredClone(mockDb.taskCatalog);
      if (path.startsWith("/webapp/moderation/activity")) {
        const url = new URL(path, "http://mock.local");
        const groupId = Number(url.searchParams.get("group_id") || 0);
        const family = String(url.searchParams.get("family") || "");
        const allRows = Object.entries(mockDb.logs).flatMap(([rawGroupId, rows]) => {
          const group = (mockDb.groups || []).find((item) => Number(item.id) === Number(rawGroupId));
          return (rows || []).map((row, index) => ({
            id: Number(`${rawGroupId}${index + 1}`),
            group_id: Number(rawGroupId),
            group_title: group ? group.title : `Group ${rawGroupId}`,
            group_tg_id: group ? group.tg_group_id : null,
            action: row.action,
            family: String(row.action || "").startsWith("delete_")
              ? "delete"
              : String(row.action || "").startsWith("mute_") || row.action === "unmute_user"
                ? "mute"
                : String(row.action || "").startsWith("ban_") || ["remove_warn_limit", "unban_user"].includes(String(row.action || ""))
                  ? "ban"
                  : ["warn", "warn_spam", "clear_warnings", "approve_warning", "warnings_reset"].includes(String(row.action || ""))
                    ? "warning"
                    : "other",
            target_user_id: row.target_user_id,
            moderator_id: row.moderator_id,
            reason: row.reason,
            details: row.details || {},
            created_at: row.created_at,
          }));
        });
        return structuredClone(
          allRows.filter((row) => (!groupId || Number(row.group_id) === groupId) && (!family || row.family === family))
        );
      }

      const groupIdMatch = path.match(/\/webapp\/groups\/(\d+)/);
      const agentMatch = path.match(/\/webapp\/agents\/(\d+)/);
      const ownerGroupMatch = path.match(/\/webapp\/owner\/groups\/(\d+)/);

      if (groupIdMatch) {
        const groupId = Number(groupIdMatch[1]);
        if (path.endsWith("/overview")) return structuredClone(mockDb.overview[groupId] || mockDb.overview[101]);
        if (path.endsWith("/settings") && method === "GET") return { group_id: groupId, settings: structuredClone(mockDb.settings[groupId] || {}) };
        if (path.endsWith("/settings") && method === "PATCH") {
          mockDb.settings[groupId] = { ...(mockDb.settings[groupId] || {}), ...(body.settings || {}) };
          return { status: "ok", group_id: groupId, changed: body.settings || {} };
        }
        if (path.endsWith("/access-gate") && method === "GET") return structuredClone(mockDb.accessGate[groupId] || mockDb.accessGate[101]);
        if (path.endsWith("/access-gate") && method === "PATCH") {
          mockDb.accessGate[groupId].required_group_tg_ids = body.required_group_tg_ids || [];
          return { status: "ok", group_id: groupId, required_group_tg_ids: body.required_group_tg_ids || [] };
        }
        if (path.endsWith("/join-request-settings") && method === "GET") {
          return structuredClone(mockDb.joinRequestSettings[groupId] || { group_id: groupId, enabled: false, required_group_tg_ids: [] });
        }
        if (path.endsWith("/join-request-settings") && method === "PATCH") {
          mockDb.joinRequestSettings[groupId] = {
            group_id: groupId,
            enabled: Boolean(body.settings?.enabled ?? body.settings?.join_request_verify ?? false),
            required_group_tg_ids: structuredClone((mockDb.accessGate[groupId] || mockDb.accessGate[101] || {}).required_group_tg_ids || []),
          };
          return { status: "ok", group_id: groupId };
        }
        if (path.endsWith("/join-requests") && method === "GET") {
          return structuredClone(mockDb.joinRequests[groupId] || { group_id: groupId, pending_count: 0, items: [] });
        }
        if (path.endsWith("/moderation/warnings") && method === "GET") return structuredClone(mockDb.warnings[groupId] || []);
        if (path.endsWith("/moderation/warnings") && method === "POST") {
          mockDb.warnings[groupId] = mockDb.warnings[groupId] || [];
          mockDb.warnings[groupId].unshift({
            user_id: body.user_id,
            count: body.count || 1,
            reason: body.reason || "",
            issued_by: state.user.id,
            created_at: new Date().toISOString(),
          });
          return { status: "ok" };
        }
        if (path.includes("/moderation/warnings/") && method === "DELETE") {
          const userId = Number(path.split("/").pop());
          mockDb.warnings[groupId] = (mockDb.warnings[groupId] || []).filter((item) => item.user_id !== userId);
          return { status: "ok", deleted: 1 };
        }
        if (path.endsWith("/moderation/actions") && method === "POST") {
          mockDb.logs[groupId] = mockDb.logs[groupId] || [];
          mockDb.logs[groupId].unshift({
            action: body.action === "mute" ? "mute_user" : body.action === "ban" ? "ban_user" : body.action,
            target_user_id: body.user_id,
            moderator_id: state.user.id,
            reason: body.reason || "",
            details: {},
            created_at: new Date().toISOString(),
          });
          return { status: "ok", action: body.action };
        }
        if (path.includes("/members/") && path.endsWith("/role") && method === "POST") {
          return { status: "ok" };
        }
        if (path.endsWith("/members")) return structuredClone(mockDb.members[groupId] || []);
        if (path.endsWith("/logs")) return structuredClone(mockDb.logs[groupId] || []);
        if (path.endsWith("/tasks") && method === "GET") return structuredClone(mockDb.tasks[groupId] || []);
        if (path.endsWith("/tasks") && method === "POST") {
          mockDb.tasks[groupId] = mockDb.tasks[groupId] || [];
          const assignment = { ...body, assignment_id: body.assignment_id || Math.random().toString(36).slice(2, 10) };
          mockDb.tasks[groupId].push(assignment);
          return { status: "ok", assignment };
        }
        if (path.includes("/tasks/") && method === "PATCH") {
          const assignmentId = path.split("/").pop();
          mockDb.tasks[groupId] = (mockDb.tasks[groupId] || []).map((task) => task.assignment_id === assignmentId ? { ...task, ...body, assignment_id: assignmentId } : task);
          return { status: "ok", assignment: mockDb.tasks[groupId].find((task) => task.assignment_id === assignmentId) };
        }
        if (path.includes("/tasks/") && method === "DELETE") {
          const assignmentId = path.split("/").pop();
          mockDb.tasks[groupId] = (mockDb.tasks[groupId] || []).filter((task) => task.assignment_id !== assignmentId);
          return { status: "ok", deleted: true };
        }
        if (path.endsWith("/scheduled-messages") && method === "GET") return structuredClone(mockDb.scheduledMessages[groupId] || []);
        if (path.endsWith("/scheduled-messages") && method === "POST") {
          const entry = { id: "sched-" + Math.random().toString(36).slice(2, 7), text: body.text, status: "pending", send_at: new Date(Date.now() + 3600000).toISOString(), cron: body.schedule.includes(" ") ? body.schedule : null, delete_after_seconds: body.delete_after_seconds || null };
          mockDb.scheduledMessages[groupId] = [entry, ...(mockDb.scheduledMessages[groupId] || [])];
          return { status: "ok", scheduled_message: entry };
        }
      }

      if (path.startsWith("/webapp/agents?group_id=")) {
        const groupId = Number(new URL("https://local" + path).searchParams.get("group_id"));
        return structuredClone(mockDb.agents[groupId] || []);
      }

      if (agentMatch && path.endsWith("/groups")) {
        return [
          { id: 101, tg_group_id: -1002001, title: "Growth Ops", managed_title: "Growth Ops", can_add_members: true },
          { id: 102, tg_group_id: -1002002, title: "Support Hub", managed_title: "Support Hub", can_add_members: true },
          { id: null, tg_group_id: -1002998, title: "Read Only Feed", managed_title: null, can_add_members: false },
        ];
      }

      if (path === "/webapp/agents/link" || path === "/webapp/agents/auth/start") {
        const agent = {
          id: Math.floor(Math.random() * 1000) + 20,
          group_id: body.group_id,
          telegram_user_id: null,
          phone_number: body.phone_number || null,
          external_account_id: body.external_account_id || "new.agent",
          status: "unknown",
          auth_state: "pending_code",
          metadata: { username: null, linked_at: new Date().toISOString(), jobs_count: 0 },
        };
        mockDb.agents[body.group_id] = [agent, ...(mockDb.agents[body.group_id] || [])];
        return { status: "ok", agent };
      }

      if (agentMatch && path.endsWith("/auth/code")) {
        const agentId = Number(agentMatch[1]);
        for (const groupId of Object.keys(mockDb.agents)) {
          mockDb.agents[groupId] = mockDb.agents[groupId].map((agent) => agent.id === agentId ? { ...agent, auth_state: body.code === "0000" ? "pending_2fa" : "active", status: "healthy", metadata: { ...(agent.metadata || {}), username: "linked_agent" } } : agent);
        }
        return { status: "ok", agent: Object.values(mockDb.agents).flat().find((agent) => agent.id === agentId) };
      }

      if (agentMatch && path.endsWith("/auth/password")) {
        const agentId = Number(agentMatch[1]);
        for (const groupId of Object.keys(mockDb.agents)) {
          mockDb.agents[groupId] = mockDb.agents[groupId].map((agent) => agent.id === agentId ? { ...agent, auth_state: "active", status: "healthy", metadata: { ...(agent.metadata || {}), username: "linked_agent" } } : agent);
        }
        return { status: "ok", agent: Object.values(mockDb.agents).flat().find((agent) => agent.id === agentId) };
      }

      if (agentMatch && path.endsWith("/jobs") && method === "POST") {
        const agentId = Number(agentMatch[1]);
        const job = {
          id: Math.floor(Math.random() * 100000) + 100,
          agent_id: agentId,
          job_type: body.job_type,
          job_payload: body.job_payload || {},
          status: "pending",
        };
        mockDb.agentJobs[agentId] = [job, ...(mockDb.agentJobs[agentId] || [])];
        for (const groupId of Object.keys(mockDb.agents)) {
          mockDb.agents[groupId] = mockDb.agents[groupId].map((agent) =>
            agent.id === agentId
              ? {
                  ...agent,
                  metadata: {
                    ...(agent.metadata || {}),
                    jobs_count: Number(agent.metadata?.jobs_count || 0) + 1,
                    last_active_at: new Date().toISOString(),
                  },
                }
              : agent
          );
        }
        return { status: "ok", job };
      }

      if (agentMatch && path.endsWith("/jobs")) {
        const agentId = Number(agentMatch[1]);
        return structuredClone(mockDb.agentJobs[agentId] || []);
      }

      if (agentMatch && path.endsWith("/member-adds") && method === "POST") {
        return {
          status: "queued",
          queued_count: Array.isArray(body.user_ids) ? body.user_ids.length : 0,
          job_ids: Array.isArray(body.user_ids)
            ? body.user_ids.map(() => "membership-" + Math.random().toString(36).slice(2, 10))
            : [],
        };
      }

      if (agentMatch && method === "PATCH") {
        return { status: "ok", agent: { id: Number(agentMatch[1]), ...body } };
      }

      if (agentMatch && method === "DELETE") {
        return { status: "ok", deleted: true };
      }

      if (ownerGroupMatch) {
        const groupId = Number(ownerGroupMatch[1]);
        if (method === "GET") return structuredClone(mockDb.ownerGroups.find((group) => group.id === groupId));
        if (path.endsWith("/disable") && method === "POST") {
          mockDb.ownerGroups = mockDb.ownerGroups.map((group) => group.id === groupId ? { ...group, is_active: false } : group);
          mockDb.ownerAudit.unshift({ id: Date.now(), actor_id: 1, action: "disable_group", target_type: "group", target_id: String(groupId), detail: null, created_at: new Date().toISOString() });
          return { status: "disabled", group: mockDb.ownerGroups.find((group) => group.id === groupId) };
        }
        if (path.endsWith("/leave") && method === "POST") {
          mockDb.ownerGroups = mockDb.ownerGroups.map((group) => group.id === groupId ? { ...group, is_active: false } : group);
          mockDb.ownerAudit.unshift({ id: Date.now(), actor_id: 1, action: "force_leave", target_type: "group", target_id: String(groupId), detail: null, created_at: new Date().toISOString() });
          return { status: "left", group: mockDb.ownerGroups.find((group) => group.id === groupId) };
        }
      }

      if (path.startsWith("/webapp/owner/subscriptions/") && method === "POST") {
        const id = Number(path.split("/").pop());
        mockDb.ownerSubscriptions = mockDb.ownerSubscriptions.map((item) => item.id === id ? { ...item, status: body.status, response: body.response || null, updated_at: new Date().toISOString() } : item);
        mockDb.ownerAudit.unshift({ id: Date.now(), actor_id: 1, action: body.status === "approved" ? "approve_subscription" : body.status === "cancelled" ? "cancel_subscription" : "decline_subscription", target_type: "subscription", target_id: String(id), detail: { response: body.response || null }, created_at: new Date().toISOString() });
        return { status: "ok", request: mockDb.ownerSubscriptions.find((item) => item.id === id) };
      }
      if (path === "/webapp/owner/private-access-gate" && method === "PATCH") {
        mockDb.ownerPrivateAccessGate.required_group_tg_ids = body.required_group_tg_ids || [];
        mockDb.ownerAudit.unshift({ id: Date.now(), actor_id: 1, action: "update_private_access_gate", target_type: "private_access_gate", target_id: "global", detail: { required_group_tg_ids: body.required_group_tg_ids || [] }, created_at: new Date().toISOString() });
        return structuredClone(mockDb.ownerPrivateAccessGate);
      }

      throw new Error("Unhandled mock route: " + method + " " + path);
    }
