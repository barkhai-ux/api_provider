# Shared proxy settings. Install next to geo-platform.conf as
# /etc/nginx/conf.d/geo-platform-proxy.inc (the .inc suffix keeps nginx from
# loading it as a server block on its own).

proxy_http_version 1.1;
proxy_set_header Connection "";

# Set, never append: the apps trust exactly one client address, the one nginx
# saw. Values sent by the client are discarded, so they cannot be spoofed.
proxy_set_header Host              $host;
proxy_set_header X-Forwarded-Host  $host;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-For   $remote_addr;
proxy_set_header X-Real-IP         $remote_addr;
# Headers the apps must never receive from outside.
proxy_set_header X-Client-IP       "";
proxy_set_header Forwarded         "";

proxy_connect_timeout 5s;
proxy_send_timeout    30s;
proxy_read_timeout    35s;

# Do not cache or buffer responses to disk; pass upstream errors through as-is.
proxy_buffering on;
proxy_max_temp_file_size 0;
proxy_redirect off;
