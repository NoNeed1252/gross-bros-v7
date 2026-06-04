#!/bin/bash
git fetch origin && git reset --hard 272bdf8
ufw allow 8080/tcp
ufw allow 8000/tcp
pm2 delete all
pm2 start server.js --name "cockpit-v8.7"
pm2 start /root/gross-bros-v7/services/guardian-signal-receiver/receiver.py --name "guardian-signal-receiver" --interpreter python3
pm2 start /root/gross-bros-v7/services/guardian-ai/vtuber_engine.py --name "guardian-ai" --interpreter python3
pm2 save