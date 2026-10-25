# 转给工作进程池: 没有 WebSocket,Connection 置空才能复用 upstream keepalive 连接
proxy_http_version 1.1;
proxy_set_header Connection "";
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
# 只在连不上时换到 backup(8000)。不按超时重试: 一个慢 GET 跑满 300 秒再到主进程重跑一遍只会更糟
proxy_next_upstream error;
proxy_connect_timeout 3s;
proxy_send_timeout 300s;
proxy_read_timeout 300s;
client_max_body_size 520m;   # 音标教学视频上传(应用层上限 500MB)
