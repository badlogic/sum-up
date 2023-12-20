#!/bin/bash
set -e
npm run build
ssh -t slayer.marioslab.io "mkdir -p sum-up.xyz"
rsync -avz --exclude node_modules --exclude .git ./ badlogic@slayer.marioslab.io:/home/badlogic/sum-up.xyz/app
ssh -t slayer.marioslab.io "cd sum-up.xyz && SUMUP_OPENAI=$SUMUP_OPENAI SUMUP_BLUESKY_ACCOUNT=$SUMUP_BLUESKY_ACCOUNT SUMUP_BLUESKY_PASSWORD=$SUMUP_BLUESKY_PASSWORD ./reload.sh && docker compose logs -f"
