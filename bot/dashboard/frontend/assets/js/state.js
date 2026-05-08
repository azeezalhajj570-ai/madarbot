    const APP_VERSION = "v2.0.0";
    const INIT_DATA_STORAGE_KEY = "combot.telegramInitData";
    const readLaunchParams = (source) => new URLSearchParams(String(source || "").replace(/^[?#]/, ""));
    const searchParams = readLaunchParams(window.location.search);
    const hashParams = readLaunchParams(window.location.hash);

    const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
    const queryInitData =
      searchParams.get("init_data") ||
      searchParams.get("tgWebAppData") ||
      hashParams.get("init_data") ||
      hashParams.get("tgWebAppData") ||
      "";
    let telegramInitData = tg
      ? (tg.initData || "")
      : (
          queryInitData ||
          window.sessionStorage.getItem(INIT_DATA_STORAGE_KEY) ||
          window.localStorage.getItem(INIT_DATA_STORAGE_KEY) ||
          ""
        );
    const DEV_MODE = searchParams.get("mock") === "1";

    function refreshTelegramInitData() {
      const nextValue = tg
        ? (
            tg.initData ||
            queryInitData ||
            window.sessionStorage.getItem(INIT_DATA_STORAGE_KEY) ||
            window.localStorage.getItem(INIT_DATA_STORAGE_KEY) ||
            ""
          )
        : (
            queryInitData ||
            window.sessionStorage.getItem(INIT_DATA_STORAGE_KEY) ||
            window.localStorage.getItem(INIT_DATA_STORAGE_KEY) ||
            ""
          );
      telegramInitData = nextValue;
      if (telegramInitData) {
        window.sessionStorage.setItem(INIT_DATA_STORAGE_KEY, telegramInitData);
        window.localStorage.setItem(INIT_DATA_STORAGE_KEY, telegramInitData);
      }
      return telegramInitData;
    }

    if (tg) {
      tg.ready();
      tg.expand();
      tg.setHeaderColor("#0a0a0a");
      tg.setBackgroundColor("#0a0a0a");
      refreshTelegramInitData();
    } else if (DEV_MODE) {
      console.warn("Telegram WebApp SDK unavailable. Running in explicit mock mode.");
    } else {
      console.warn("Telegram WebApp SDK unavailable. Using HTTP API mode with stored or query init data.");
    }

    const state = {
      user: null,
      groups: [],
      activeGroupId: Number(localStorage.getItem("combot.activeGroupId")) || null,
      route: location.hash || "#/overview",
      isOwner: false,
      sessionExpired: false,
      subscriptionGate: {
        active: false,
        request: null,
      },
      loading: {
        auth: false,
        page: false,
      },
      cache: {
        overview: {},
        settings: {},
        settingsSchema: null,
        accessGate: {},
        joinRequestSettings: {},
        joinRequests: {},
        scraper: {},
        scraperList: {},
        scraperMembers: {},
        scraperMessages: {},
        warnings: {},
        logs: {},
        moderationActivity: {},
        members: {},
        liveMemberSearch: {},
        liveMemberDirectory: {},
        taskCatalog: null,
        tasks: {},
        scheduledMessages: {},
        agents: {},
        agentGroups: {},
        agentJobs: {},
        botInstallGroups: null,
        ownerStats: null,
        ownerGroups: null,
        ownerSubscriptions: null,
        ownerPrivateAccessGate: null,
        ownerAudit: null,
      },
      ui: {
        groupPopoverOpen: false,
        groupQuery: "",
        moderationTab: "warnings",
        ownerTab: "stats",
        scraperDraft: {
          agent_id: "",
          tg_group_id: "",
          member_limit: "100",
          message_limit: "50",
        },
        scraperListFilters: {
          agent_id: "",
          tg_group_id: "",
        },
        settingsCategory: "",
        accessGateProtectedGroupId: null,
        settingsStatus: {},
        moderationSettingsDraft: null,
        automationSelection: null,
        automationFormMode: "edit",
        automationEditorOpen: false,
        automationBindingGroupId: null,
        bulkMessageOpen: false,
        bulkMessageDraft: {
          agent_id: "",
          source_group_id: "",
          source_managed_group_id: "",
          message: "",
          threshold: "25",
          interval_seconds: "1",
          selected_user_ids: [],
          user_query: "",
          loading: false,
          error: "",
        },
        bulkAddMembersOpen: false,
        bulkAddMembersDraft: {
          agent_id: "",
          source_group_id: "",
          target_group_id: "",
          interval_seconds: "20",
          selected_user_ids: [],
          user_query: "",
          loading: false,
          error: "",
        },
        quickActionDraft: null,
        ownerGroupSearch: "",
        warningSearch: "",
        memberSearch: "",
        moderationActivityGroup: "all",
        moderationActivityFamily: "",
        moderationActivitySearch: "",
        logsActionFilter: "",
        logsDateFrom: "",
        logsDateTo: "",
        ownerAuditFilter: "",
        rowActionsOpenKey: "",
        pagination: {},
        paginationSizes: {},
        drawerContext: null,
        logJsonExpanded: {},
        agentJobsFilter: {},
        agentGroupsSearch: {},
        agentGroupMembersSearch: {},
        botInstallResult: null,
      },
      overlays: {
        modal: null,
        drawer: null,
      },
      toasts: [],
    };
