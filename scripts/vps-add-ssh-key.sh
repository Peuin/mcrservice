#!/usr/bin/env bash
# One-time: authorize Mac SSH key on VPS so Cursor agent can connect.
set -euo pipefail
PUBKEY="SHA256:ebzmQd0sBNWazGlVopnExRpFhtzkV8i561lTnB7Uq9U peuinssh-ed25519"
mkdir -p ~/.ssh && chmod 700 ~/.ssh
grep -qxF "$PUBKEY" ~/.ssh/authorized_keys 2>/dev/null || echo "$PUBKEY" >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
echo "SSH key added for peuin@$(hostname)"
