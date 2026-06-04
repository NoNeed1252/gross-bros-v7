git fetch origin
git reset --hard 272bdf8
sed -i 's/#ClientAliveInterval.*/ClientAliveInterval 60/' /etc/ssh/sshd_config
sed -i 's/#ClientAliveCountMax.*/ClientAliveCountMax 720/' /etc/ssh/sshd_config
service ssh restart
pm2 delete all
pm2 start server.js --name "cockpit-v8.7"
pm2 start /root/gross-bros-v7/services/guardian-signal-receiver/receiver.py --name "guardian-signal-receiver" --interpreter python3
pm2 save