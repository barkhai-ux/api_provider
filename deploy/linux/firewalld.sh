#!/usr/bin/env bash
# Opens only HTTPS/HTTP to the world and SSH to an administration network.
# Review before running. Usage: ADMIN_CIDR=203.0.113.0/24 ./firewalld.sh
set -euo pipefail
: "${ADMIN_CIDR:?Set ADMIN_CIDR to the network allowed to use SSH}"

systemctl enable --now firewalld
zone="$(firewall-cmd --get-default-zone)"

firewall-cmd --permanent --zone="$zone" --add-service=https
firewall-cmd --permanent --zone="$zone" --add-service=http     # only redirects to HTTPS
firewall-cmd --permanent --zone="$zone" --remove-service=ssh || true
firewall-cmd --permanent --zone="$zone" --remove-service=cockpit || true
firewall-cmd --permanent --zone="$zone" \
  --add-rich-rule="rule family=ipv4 source address=${ADMIN_CIDR} service name=ssh accept"
firewall-cmd --reload
firewall-cmd --zone="$zone" --list-all
