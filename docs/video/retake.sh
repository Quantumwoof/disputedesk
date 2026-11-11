#!/bin/bash
# Usage: REPO=/path/to/disputedesk WORK=/path/to/scratch ./retake.sh
# Restarts the two demo apps (offline engine on :4100, free-LLM on :4101 from a pre-triaged snapshot in $WORK/data-llm.bak).
# restart both demo apps in pristine recording state
cd "$REPO"
pkill -f "disputedesk.js demo"; sleep 1
rm -rf $WORK/data $WORK/data-llm; mkdir -p $WORK/data; cp -r $WORK/data-llm.bak $WORK/data-llm
(PORT=4100 MOCK_PORT=4110 DISPUTEDESK_DATA=$WORK/data nohup node bin/disputedesk.js demo > $WORK/app.log 2>&1 &)
(LLM_PROVIDER=pollinations PORT=4101 MOCK_PORT=4111 DISPUTEDESK_DATA=$WORK/data-llm nohup node bin/disputedesk.js demo > $WORK/app-llm.log 2>&1 &)
sleep 3
