# 英语助手 /api/ 分流(2026-10-25,后端多进程)。两个站点(es.feiyingsteam.com.conf、42.193.250.250_3000.conf)
# 的 server 块里用 `include /www/server/panel/vhost/nginx/eh/api-locations.inc;` 替换原来的 `location ^~ /api/ { ... }`。
# 放在子目录 eh/ 且扩展名不是 .conf: nginx.conf 在 http 级 include 了 vhost/nginx/*.conf,location 写在 http 级会报错。
#
# ⚠️ 主进程路径清单必须与 backend/app/core/process_role.py 的 MAIN_ONLY_* / PREFER_MAIN_* 一致
#    (tests/test_multiprocess.py 解析本文件核对)。新加 WebSocket 或进程内状态的接口要两边一起加。
#
# 匹配顺序: `=` 精确 > 最长的 `^~` 前缀(命中后不再看正则)> 正则。所以视频串流那条正则写在 /api/ 里面(嵌套),
# 写在外面会被 `^~ /api/` 挡住永远匹配不到。proxy_* 指令不往嵌套 location 里继承 proxy_pass,每块都要写全。

# ---- 只能主进程(状态在主进程内存 / WebSocket / 本机语音模型)----
location ^~ /api/v1/pk/ {
    proxy_pass http://eh_main;
    include /www/server/panel/vhost/nginx/eh/proxy-main.inc;
}
location ^~ /api/v1/competition/ {
    proxy_pass http://eh_main;
    include /www/server/panel/vhost/nginx/eh/proxy-main.inc;
}
location ^~ /api/v1/live/ws/ {
    proxy_pass http://eh_main;
    include /www/server/panel/vhost/nginx/eh/proxy-main.inc;
}
location ^~ /api/v1/student/battle/ws/ {
    proxy_pass http://eh_main;
    include /www/server/panel/vhost/nginx/eh/proxy-main.inc;
}
location = /api/v1/pronunciation/verify-word {
    proxy_pass http://eh_main;
    include /www/server/panel/vhost/nginx/eh/proxy-main.inc;
}
location = /api/v1/assessment/evaluate {
    proxy_pass http://eh_main;
    include /www/server/panel/vhost/nginx/eh/proxy-main.inc;
}
# ---- 放主进程更好(落到工作进程也能用)----
location ^~ /api/v1/admin/server/ {
    proxy_pass http://eh_main;
    include /www/server/panel/vhost/nginx/eh/proxy-main.inc;
}

# ---- 其余接口: 工作进程池(8001 不在就走 8000)----
location ^~ /api/ {
    location ~ ^/api/v1/phonetics/videos/\d+/stream$ {
        proxy_pass http://eh_main;
        include /www/server/panel/vhost/nginx/eh/proxy-main.inc;
    }
    proxy_pass http://eh_workers;
    include /www/server/panel/vhost/nginx/eh/proxy-workers.inc;
}
