# 转给主进程: 与原来 location ^~ /api/ 的写法一致(带 WebSocket 升级头;$connection_upgrade 来自 0.websocket.conf)
proxy_http_version 1.1;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection $connection_upgrade;
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_connect_timeout 60s;
proxy_send_timeout 300s;
proxy_read_timeout 300s;
client_max_body_size 520m;   # 音标教学视频上传(应用层上限 500MB)
