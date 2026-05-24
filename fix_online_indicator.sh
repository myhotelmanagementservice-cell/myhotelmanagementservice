#!/bin/bash
# Find the online indicator div and replace it
sed -i 's|<div id="onlineIndicator" class="online-indicator online">🟢 Online</div>|<div id="onlineIndicator" class="online-indicator online" style="position:fixed !important; top:15px !important; left:15px !important; z-index:9999 !important; background:#10b981 !important; color:white !important; padding:4px 12px !important; border-radius:20px !important; font-size:11px !important; font-weight:500 !important;">🟢 Online</div>|g' ./inaya-hotel/public/index.html
