# MadarBot AI Agent Guide

## Purpose
MadarBot is an AI-powered Telegram automation platform focused on:
- Telegram group monitoring
- Lead capture
- Automated agent workflows
- AI-assisted replies
- Task execution pipelines

## Runtime Modes
The application supports:
- BOT_APP_KIND=agents
- bot listener mode
- agent worker mode

## Core Responsibilities
AI agents should:
1. Listen to Telegram group messages
2. Detect trigger phrases
3. Execute automation tasks
4. Persist captured leads
5. Avoid duplicate lead insertion
6. Maintain healthy Telegram sessions
7. Retry failed transient jobs

## Required Environment Variables
- TELEGRAM_API_ID
- TELEGRAM_API_HASH
- DATABASE_URL
- REDIS_URL
- BOT_APP_KIND
- DEFAULT_LANGUAGE

## Lead Capture Rules
- Persist all valid lead_capture events
- Deduplicate by:
  - group_id
  - tg_user_id
  - source_group_tg_id
- Support nullable agent_id for bot-originated tasks

## Operational Notes
- Redis is required
- PostgreSQL is required
- Telethon sessions must remain persistent
- Agents should automatically reconnect on disconnect
- Docker restart policy should remain enabled

## Logging Requirements
Agents should log:
- session state changes
- listener startup
- group sync events
- received messages
- task execution events
- persistence failures
- retry attempts

## Deployment Checklist
- docker compose up -d
- verify Redis health
- verify Postgres health
- verify bot session connectivity
- verify lead insertion into DB
- verify automation tasks complete successfully
