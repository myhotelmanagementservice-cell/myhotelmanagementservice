#!/bin/bash
# Replace the lang-selector div with fixed bottom center
sed -i 's|<div class="lang-selector">|<div class="lang-selector" style="position:fixed !important; bottom:0 !important; left:0 !important; right:0 !important; z-index:9999 !important; display:flex !important; flex-wrap:wrap !important; justify-content:center !important; align-items:center !important; gap:6px !important; background:white !important; padding:8px 12px !important; margin:0 !important; border-radius:15px 15px 0 0 !important; box-shadow:0 -2px 8px rgba(0,0,0,0.1) !important;">|' ./inaya-hotel/public/index.html
