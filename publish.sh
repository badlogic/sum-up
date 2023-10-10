#!/bin/bash
set -e
npm run build
rsync -avz --exclude node_modules --exclude .git ./ badlogic@marioslab.io:/home/badlogic/sum-up.xyz/app
ssh -t marioslab.io "cd sum-up.xyz && SUMUP_OPENAI=$SUMUP_OPENAI SUMUP_BLUESKY_ACCOUNT=$SUMUP_BLUESKY_ACCOUNT SUMUP_BLUESKY_PASSWORD=$SUMUP_BLUESKY_PASSWORD ./reload.sh && docker-compose logs -f"
