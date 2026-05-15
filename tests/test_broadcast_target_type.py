from __future__ import annotations


import pytest

from bot.agents.jobs import (
    normalize_group_member_broadcast_payload,
    GROUP_MEMBER_BROADCAST_JOB_TYPE,
)
from bot.agents.agent_job_service import _job_queued_notification


class TestNormalizeGroupMemberBroadcastPayload:
    def test_members_target_default(self):
        payload = normalize_group_member_broadcast_payload(
            {
                "source_group_id": -100123456,
                "message": "Hello!",
                "threshold": 25,
                "interval_seconds": 5,
            }
        )
        assert payload["target_type"] == "members"
        assert payload["source_group_id"] == -100123456
        assert payload["message"] == "Hello!"
        assert payload["selected_user_ids"] == []
        assert payload["threshold"] == 25

    def test_members_target_explicit(self):
        payload = normalize_group_member_broadcast_payload(
            {
                "target_type": "members",
                "source_group_id": -100123456,
                "message": "Test",
                "threshold": 10,
                "interval_seconds": 2,
                "selected_user_ids": [1001, 1002, 1003],
            }
        )
        assert payload["target_type"] == "members"
        assert payload["selected_user_ids"] == [1001, 1002, 1003]

    def test_members_target_requires_source_group_id(self):
        with pytest.raises(ValueError, match="source_group_id is required"):
            normalize_group_member_broadcast_payload(
                {
                    "target_type": "members",
                    "message": "Hi",
                    "threshold": 10,
                    "interval_seconds": 2,
                }
            )

    def test_groups_target(self):
        payload = normalize_group_member_broadcast_payload(
            {
                "target_type": "groups",
                "target_group_ids": [-100111, -100222, -100333],
                "message": "Group announcement",
                "threshold": 25,
                "interval_seconds": 3,
            }
        )
        assert payload["target_type"] == "groups"
        assert payload["target_group_ids"] == [-100111, -100222, -100333]
        assert payload["message"] == "Group announcement"
        assert "source_group_id" not in payload
        assert "selected_user_ids" not in payload

    def test_groups_target_requires_target_group_ids(self):
        with pytest.raises(ValueError, match="target_group_ids is required"):
            normalize_group_member_broadcast_payload(
                {
                    "target_type": "groups",
                    "message": "Hi",
                    "threshold": 10,
                    "interval_seconds": 2,
                }
            )

    def test_groups_target_empty_list_raises(self):
        with pytest.raises(ValueError, match="target_group_ids is required"):
            normalize_group_member_broadcast_payload(
                {
                    "target_type": "groups",
                    "target_group_ids": [],
                    "message": "Hi",
                    "threshold": 10,
                    "interval_seconds": 2,
                }
            )

    def test_invalid_target_type(self):
        with pytest.raises(ValueError, match="target_type must be 'members' or 'groups'"):
            normalize_group_member_broadcast_payload(
                {
                    "target_type": "channels",
                    "message": "Hi",
                    "threshold": 10,
                    "interval_seconds": 2,
                }
            )

    def test_message_required(self):
        with pytest.raises(ValueError, match="message is required"):
            normalize_group_member_broadcast_payload(
                {
                    "target_type": "members",
                    "source_group_id": -100123,
                    "message": "",
                    "threshold": 10,
                    "interval_seconds": 2,
                }
            )

    def test_threshold_validation(self):
        with pytest.raises(ValueError, match="threshold must be a positive integer"):
            normalize_group_member_broadcast_payload(
                {
                    "target_type": "members",
                    "source_group_id": -100123,
                    "message": "Hi",
                    "threshold": 0,
                    "interval_seconds": 2,
                }
            )

    def test_interval_seconds_validation(self):
        with pytest.raises(ValueError, match="interval_seconds must be a non-negative number"):
            normalize_group_member_broadcast_payload(
                {
                    "target_type": "members",
                    "source_group_id": -100123,
                    "message": "Hi",
                    "threshold": 10,
                    "interval_seconds": -1,
                }
            )

    def test_selected_user_ids_validation(self):
        with pytest.raises(
            ValueError, match="selected_user_ids must contain valid integer user ids"
        ):
            normalize_group_member_broadcast_payload(
                {
                    "target_type": "members",
                    "source_group_id": -100123,
                    "message": "Hi",
                    "threshold": 10,
                    "interval_seconds": 2,
                    "selected_user_ids": [1001, "invalid"],
                }
            )

    def test_target_group_ids_validation(self):
        with pytest.raises(
            ValueError, match="target_group_ids must contain valid integer group ids"
        ):
            normalize_group_member_broadcast_payload(
                {
                    "target_type": "groups",
                    "target_group_ids": [1, "bad"],
                    "message": "Hi",
                    "threshold": 10,
                    "interval_seconds": 2,
                }
            )

    def test_deduplicates_selected_user_ids(self):
        payload = normalize_group_member_broadcast_payload(
            {
                "target_type": "members",
                "source_group_id": -100123,
                "message": "Hi",
                "threshold": 10,
                "interval_seconds": 2,
                "selected_user_ids": [1001, 1002, 1001, 1003, 1002],
            }
        )
        assert payload["selected_user_ids"] == [1001, 1002, 1003]

    def test_deduplicates_target_group_ids(self):
        payload = normalize_group_member_broadcast_payload(
            {
                "target_type": "groups",
                "target_group_ids": [1, 2, 1, 3],
                "message": "Hi",
                "threshold": 10,
                "interval_seconds": 2,
            }
        )
        assert payload["target_group_ids"] == [1, 2, 3]

    def test_skip_bots_default_is_true(self):
        payload = normalize_group_member_broadcast_payload(
            {
                "target_type": "members",
                "source_group_id": -100123,
                "message": "Hi",
                "threshold": 10,
                "interval_seconds": 2,
            }
        )
        assert payload["skip_bots"] is True

    def test_string_group_id_accepted(self):
        payload = normalize_group_member_broadcast_payload(
            {
                "target_type": "members",
                "source_group_id": "-100123456",
                "message": "Hi",
                "threshold": 10,
                "interval_seconds": 2,
            }
        )
        assert payload["source_group_id"] == -100123456


class TestJobQueuedNotification:
    def test_members_notification(self):
        title, summary, notification_payload = _job_queued_notification(
            GROUP_MEMBER_BROADCAST_JOB_TYPE,
            {
                "target_type": "members",
                "source_group_title": "Test Group",
                "selected_user_ids": [1, 2, 3],
            },
        )
        assert title == "Bulk message queued"
        assert "Test Group" in summary
        assert notification_payload["target_type"] not in ("groups",)

    def test_groups_notification(self):
        title, summary, notification_payload = _job_queued_notification(
            GROUP_MEMBER_BROADCAST_JOB_TYPE,
            {
                "target_type": "groups",
                "target_group_ids": [1, 2, 3, 4, 5],
            },
        )
        assert title == "Bulk message queued"
        assert "5 group(s)" in summary
        assert notification_payload["target_type"] == "groups"
        assert notification_payload["target_count"] == 5

    def test_groups_notification_empty(self):
        title, summary, notification_payload = _job_queued_notification(
            GROUP_MEMBER_BROADCAST_JOB_TYPE,
            {
                "target_type": "groups",
                "target_group_ids": [],
            },
        )
        assert "0 group(s)" in summary
        assert notification_payload["target_count"] == 0
