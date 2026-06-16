"""Domain-organized SQLAlchemy models."""

from strenum import StrEnum

from bot.db.base import Base
from bot.db.models.access import GroupAccessRequirement, PrivateAccessRequirement
from bot.db.models.agent import Agent, AgentJob, AgentLead, AgentNotification, SentBroadcastMessage
from bot.db.models.campaign import Campaign
from bot.db.models.contact_message import ContactMessage
from bot.db.models.audit import MembershipAuditLog, OwnerAuditLog
from bot.db.models.audit_log import AuditLog
from bot.db.models.billing import (
    CheckoutSession,
    Entitlement,
    Payment,
    Plan,
    PlanPrice,
    Product,
    Subscription,
    SubscriptionItem,
)
from bot.db.models.bulk_messaging import (
    BulkMessageBatch,
    BulkMessageRecipient,
    MessagingSuppression,
)
from bot.db.models.faq import (
    FAQEntry,
    FAQInteraction,
    FAQInteractionStatus,
    FAQMode,
    FAQSettings,
    FAQSourceType,
    UnansweredQuestion,
    UnansweredQuestionStatus,
)
from bot.db.models.group import Group, GroupAdminRole, GroupMember, GroupSetting, PluginEnabled
from bot.db.models.linked_account import LinkedAccount, LinkedAccountGroup
from bot.db.models.mcp_token import MCPToken
from bot.db.models.group_access import (
    GroupExpiryAction,
    GroupPaymentMode,
    GroupPaymentStatus,
    GroupSubscriber,
    GroupSubscriberStatus,
    GroupSubscriptionSettings,
    PaymentRecord,
    SubscriptionEvent,
    SubscriptionPlan,
)
from bot.db.models.join_request import JoinRequestApproval
from bot.db.models.messaging import (
    Automation,
    ChannelAccount,
    Contact,
    Conversation,
    Lead,
    Message,
    NotificationEvent,
    NotificationSettings,
    Skill,
    SkillRun,
    Tenant,
)
from bot.db.models.moderation import ModerationEvent, ModerationLog, ModerationSetting, Warning
from bot.db.models.scraper import (
    GroupKnowledge,
    ScrapedConversation,
    ScrapedDailySummary,
    ScrapedGroup,
    ScrapedLead,
    ScrapedMember,
    ScrapedMessage,
)
from bot.db.models.subscription import PromotionCode, PromotionCodeRedemption, SubscriptionRequest
from bot.db.models.summary import DailyGroupSummary, GroupMessageActivity, GroupSummarySettings
from bot.db.models.task import Task, TaskGroup, TaskRun
from bot.db.models.tenant import TenantMembership, UserIdentity
from bot.db.models.user import User


class AdminRole(StrEnum):
    OWNER = "owner"
    SUPER_ADMIN = "super_admin"
    ADMIN = "admin"
    MODERATOR = "moderator"


class SubscriptionStatus(StrEnum):
    PENDING = "pending"
    APPROVED = "approved"
    DECLINED = "declined"
    CANCELLED = "cancelled"
    SUPERSEDED = "superseded"


class SubscriptionBillingStatus(StrEnum):
    PENDING = "pending"
    ACTIVE = "active"
    PAST_DUE = "past_due"
    CANCELLED = "cancelled"
    EXPIRED = "expired"


class MemberRole(StrEnum):
    MEMBER = "member"
    ADMIN = "admin"
    CREATOR = "creator"
    RESTRICTED = "restricted"


class LinkedAccountRole(StrEnum):
    MEMBER = "member"
    PRIMARY = "primary"
    SCRAPER = "scraper"
    MODERATOR = "moderator"
    BACKUP = "backup"


class TaskStatus(StrEnum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


__all__ = [
    "AdminRole",
    "Agent",
    "AgentJob",
    "AgentLead",
    "AgentNotification",
    "AuditLog",
    "Automation",
    "Base",
    "BulkMessageBatch",
    "BulkMessageRecipient",
    "Campaign",
    "ChannelAccount",
    "CheckoutSession",
    "Contact",
    "ContactMessage",
    "Conversation",
    "DailyGroupSummary",
    "Entitlement",
    "FAQEntry",
    "FAQInteraction",
    "FAQInteractionStatus",
    "FAQMode",
    "FAQSettings",
    "FAQSourceType",
    "Group",
    "GroupAccessRequirement",
    "GroupAdminRole",
    "GroupExpiryAction",
    "GroupKnowledge",
    "GroupMember",
    "GroupMessageActivity",
    "GroupPaymentMode",
    "GroupPaymentStatus",
    "GroupSetting",
    "GroupSubscriber",
    "GroupSubscriberStatus",
    "GroupSubscriptionSettings",
    "GroupSummarySettings",
    "JoinRequestApproval",
    "Lead",
    "LinkedAccount",
    "LinkedAccountGroup",
    "LinkedAccountRole",
    "MCPToken",
    "Message",
    "MemberRole",
    "MembershipAuditLog",
    "MessagingSuppression",
    "ModerationEvent",
    "ModerationLog",
    "ModerationSetting",
    "NotificationEvent",
    "NotificationSettings",
    "OwnerAuditLog",
    "Payment",
    "PaymentRecord",
    "Plan",
    "PlanPrice",
    "PluginEnabled",
    "PrivateAccessRequirement",
    "Product",
    "PromotionCode",
    "PromotionCodeRedemption",
    "ScrapedConversation",
    "ScrapedDailySummary",
    "ScrapedGroup",
    "ScrapedLead",
    "ScrapedMember",
    "ScrapedMessage",
    "SentBroadcastMessage",
    "Skill",
    "SkillRun",
    "Subscription",
    "SubscriptionBillingStatus",
    "SubscriptionEvent",
    "SubscriptionItem",
    "SubscriptionPlan",
    "SubscriptionRequest",
    "SubscriptionStatus",
    "Task",
    "TaskGroup",
    "TaskRun",
    "TaskStatus",
    "Tenant",
    "TenantMembership",
    "UnansweredQuestion",
    "UnansweredQuestionStatus",
    "User",
    "UserIdentity",
    "Warning",
]
