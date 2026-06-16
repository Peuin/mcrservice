#!/usr/bin/env bash
# One-time: authorize Mac SSH key on VPS so Cursor agent can connect.
set -euo pipefail
PUBKEY="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAILCtXyF2EnggPMYPFaL7ylw/S1C0PbmUg5T+yCbDyndJ peuin"
mkdir -p ~/.ssh && chmod 700 ~/.ssh
grep -qxF "$PUBKEY" ~/.ssh/authorized_keys 2>/dev/null || echo "$PUBKEY" >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
echo "SSH key added for peuin@$(hostname)"
