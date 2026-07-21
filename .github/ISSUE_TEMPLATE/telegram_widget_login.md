---
name: "Add Telegram Widget Login"
about: "Implement Telegram widget button login instead of current manual process"
title: "Add Telegram widget button login feature"
labels: "enhancement, authentication, telegram"
assignees: ""
---

## Description
Implement Telegram widget login functionality to allow users to authenticate directly through a Telegram widget button instead of the current manual login process. This will provide a seamless and secure authentication experience using Telegram's official login mechanism.

## Problem Statement
The current login process requires users to:
1. Enter their phone number
2. Enter the verification code received via Telegram
3. Enter 2FA code (if enabled)

This multi-step process is cumbersome and error-prone. The Telegram Widget Login provides a native, unified authentication flow that's more user-friendly and secure.

## Current Flow
```
User → Enter Phone Number → Receive Code in TG → Enter Code → Enter 2FA → Logged In
```

## Proposed Flow
```
User → Click Telegram Widget Button → Authorize in Telegram App → Logged In
```

## Requirements
- [ ] Integrate Telegram Login Widget (official Telegram authentication)
- [ ] Replace or supplement existing login method with widget button
- [ ] Maintain backward compatibility with existing authentication if needed
- [ ] Handle Telegram widget callback and verification
- [ ] Validate user session after widget authentication
- [ ] Store authenticated user information securely
- [ ] Implement error handling for failed authentications
- [ ] Add fallback login method if widget is unavailable

## Technical Implementation

### Telegram Widget Setup
- [ ] Register bot with Telegram BotFather
- [ ] Configure Telegram Login Widget on login page
- [ ] Obtain bot token and configure redirect URL
- [ ] Implement widget HTML/JavaScript integration

### Backend Implementation
- [ ] Create endpoint to handle Telegram widget callback
- [ ] Verify authenticity of Telegram callback data (using hash validation)
- [ ] Extract user information from Telegram callback
  - User ID
  - First name
  - Last name
  - Username
  - Photo URL
  - Auth date
- [ ] Validate authentication timestamp (prevent replay attacks)
- [ ] Map Telegram user to local user account or create new account
- [ ] Generate session token/JWT
- [ ] Implement secure session management

### Security Considerations
- [ ] Validate Telegram widget callback hash using bot token
- [ ] Check authentication timestamp freshness (e.g., within 5 minutes)
- [ ] Use HTTPS for all communications
- [ ] Implement CSRF protection
- [ ] Securely store bot token (environment variables)
- [ ] Log authentication events for security auditing
- [ ] Implement rate limiting on authentication endpoint

### Frontend Implementation
- [ ] Add Telegram Login Widget button to login page
- [ ] Style widget button consistently with app design
- [ ] Handle authentication redirect and response
- [ ] Show loading state during authentication
- [ ] Display error messages if authentication fails
- [ ] Automatically redirect to dashboard on success

## Configuration
```
TELEGRAM_BOT_TOKEN: <your_bot_token>
TELEGRAM_BOT_USERNAME: <your_bot_username>
TELEGRAM_LOGIN_REDIRECT_URL: https://yourdomain.com/auth/telegram/callback
TELEGRAM_AUTH_TIMEOUT: 300  # 5 minutes
```

## User Flow Diagram
```
┌─────────────────────────────────────────┐
│          Login Page                     │
│  [Telegram Widget Login Button]         │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│     Open Telegram App (Deep Link)       │
│     OR Telegram Web Client              │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│   User Grants Permission in Telegram    │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│   Telegram Redirects with User Data     │
│   (Callback to /auth/telegram/callback) │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│   Verify & Validate Telegram Response   │
│   (Hash validation, Timestamp check)    │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│   Create/Update User Account            │
│   Generate Session Token                │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│   Redirect to Dashboard                 │
│   User Logged In ✓                      │
└─────────────────────────────────────────┘
```

## Acceptance Criteria
- [ ] Telegram Widget Login button displays on login page
- [ ] Users can log in via Telegram widget without manual steps
- [ ] Telegram callback is properly validated and verified
- [ ] User data is correctly extracted and stored
- [ ] Session is created after successful authentication
- [ ] Error handling for failed/cancelled authentications
- [ ] Security validations (hash, timestamp) are implemented
- [ ] Rate limiting is applied to prevent abuse
- [ ] Old login method still works (if keeping as backup)
- [ ] Unit and integration tests cover authentication flow

## Testing Checklist
- [ ] Test successful login via Telegram widget
- [ ] Test cancelled authentication
- [ ] Test invalid/tampered callback data
- [ ] Test replay attack prevention (old timestamps)
- [ ] Test with different Telegram user types
- [ ] Test mobile and desktop flows
- [ ] Test error messages display correctly
- [ ] Test rate limiting on auth endpoint

## Documentation Needed
- [ ] Setup guide for registering bot with BotFather
- [ ] Configuration instructions
- [ ] Security best practices guide
- [ ] User authentication flow documentation
- [ ] API endpoint documentation

## Benefits
- ✅ Streamlined user experience
- ✅ Reduced login errors
- ✅ No manual code entry required
- ✅ Leverages Telegram's secure authentication
- ✅ Prevents phishing (uses official Telegram)
- ✅ Better mobile experience
- ✅ Official Telegram integration

## References
- [Telegram Login Widget Documentation](https://core.telegram.org/widgets/login)
- [Telegram Bot API](https://core.telegram.org/bots/api)
- [Authentication Best Practices](https://core.telegram.org/widgets/login#widget-configuration)

## Priority
High

## Related Issues
- Current authentication system
- User session management

## Notes
- This implementation uses Telegram's official Login Widget
- Requires Telegram bot registration with BotFather
- Should be implemented with strong security validation
- Consider keeping old method as fallback option initially
