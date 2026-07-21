---
name: "Add Cooldown and Rate Limiting"
about: "Implement cooldown and rate limiting for adding users per account to prevent Telegram blocking"
title: "Add cooldown and rate limiting for user additions per account per hour"
labels: "enhancement, rate-limiting, telegram-constraints"
assignees: ""
---

## Description
Implement cooldown periods and rate limiting for adding users to groups per Telegram account to prevent the account from being blocked or restricted by Telegram. This should respect Telegram's constraints and best practices while excluding group source admins and labeled users (considered as admins) from rate limiting.

## Problem Statement
Telegram has strict anti-spam measures that can block or restrict accounts that perform too many actions (like adding users) in a short time period. We need to implement intelligent rate limiting that respects these constraints while allowing admins to bypass restrictions.

## Requirements
- [ ] Implement cooldown periods between user additions (configurable per action type)
- [ ] Track number of users added per account per hour
- [ ] Enforce maximum users that can be added per account per hour
- [ ] Implement exponential backoff when approaching limits
- [ ] Store and monitor rate limit metrics
- [ ] Exclude group source admins from rate limiting
- [ ] Exclude labeled users (considered as admins) from rate limiting
- [ ] Provide clear feedback when rate limits are reached
- [ ] Log all rate limit violations for monitoring

## Telegram Constraints to Consider
- Minimum cooldown between adding users (e.g., 2-5 seconds per user)
- Maximum users that can be added per hour per account (recommended: 50-100 users/hour)
- Maximum users per batch addition (recommended: 5-10 users at once)
- Account risk factors based on account age, history, etc.
- Different limits for new vs established accounts

## Technical Implementation

### Cooldown System
- [ ] Implement per-account cooldown tracking
- [ ] Support configurable cooldown durations
- [ ] Add exponential backoff strategy
- [ ] Store cooldown state in database/cache

### Rate Limiting System
- [ ] Implement per-account hourly user addition limit
- [ ] Track additions with timestamps
- [ ] Calculate remaining quota per account
- [ ] Support quota reset on hourly basis
- [ ] Store rate limit metrics and history

### Admin/Labeled User Exceptions
- [ ] Identify group source admins
- [ ] Identify labeled users with admin status
- [ ] Bypass rate limiting for these users
- [ ] Maintain audit trail of privileged actions

### Configuration
- [ ] Make cooldown duration configurable
- [ ] Make hourly limit configurable per account type
- [ ] Support per-group override settings
- [ ] Allow for different limits based on account age/reputation

## Acceptance Criteria
- [ ] Cooldown is enforced between user additions
- [ ] Hourly rate limit is enforced per account
- [ ] Users can see remaining quota before attempting bulk operations
- [ ] Group source admins are excluded from rate limits
- [ ] Labeled admins are excluded from rate limits
- [ ] Rate limit violations are logged
- [ ] Exponential backoff prevents account blocking
- [ ] Clear user-friendly error messages are shown when limits reached
- [ ] Configuration can be updated without redeployment
- [ ] Metrics can be monitored and tracked

## Database Schema Considerations
```
rate_limit_tracking:
  - account_id
  - user_additions_count (per hour)
  - last_addition_timestamp
  - cooldown_until_timestamp
  - hourly_quota_reset_at
  - account_type (new/established)
  - risk_level
```

## Error Handling
- [ ] Show specific error when cooldown is active
- [ ] Show remaining time until next action is allowed
- [ ] Show remaining quota for the hour
- [ ] Suggest retry time to user

## Monitoring & Alerts
- [ ] Track accounts approaching rate limits
- [ ] Alert on repeated limit violations
- [ ] Monitor for potential Telegram restrictions
- [ ] Log all rate limit events for analysis

## Configuration Examples
```
COOLDOWN_SECONDS: 3
MAX_USERS_PER_HOUR: 50
MAX_USERS_PER_BATCH: 5
EXPONENTIAL_BACKOFF_ENABLED: true
BACKOFF_MULTIPLIER: 1.5
```

## Priority
High

## Related Issues
- Usage limits per action implementation
- Bulk add members feature

## Notes
- This feature is critical to prevent account blocks from Telegram
- Should be implemented before bulk add members feature is heavily used
- Consider account age and history in rate limiting decisions
- Admins and labeled users should have seamless experience
