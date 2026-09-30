#!/bin/bash
# Setup script for the claude.ai cloud environment used by Sirius IDE cloud sessions.
# Paste it into the environment's "Setup script" field; it runs as root on Ubuntu 24.04
# before a new session and is snapshotted when it finishes in about five minutes.
# Node 20/21/22 are pre-installed: on the first session, ask Claude to run `check-tools`
# and confirm Node 22 is the default. npm ci for this fork is too large for the cached
# setup window, so sessions install dependencies only when a task needs them.

# Native libraries VS Code's node modules compile against
apt-get update -qq && apt-get install -y -qq libx11-dev libxkbfile-dev libsecret-1-dev libkrb5-dev || true

# build/npm/preinstall rejects npm >= 11.2.0
npm install -g npm@10 >/dev/null 2>&1 || true
