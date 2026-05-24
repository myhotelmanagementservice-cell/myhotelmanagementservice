#!/bin/bash
# Fix login page container - remove all gaps
sed -i 's|<div id="loginSelectionPage" class="min-h-screen gradient-bg flex items-center justify-center p-4">|<div id="loginSelectionPage" class="min-h-screen gradient-bg flex items-center justify-center" style="width:100%; max-width:100%; margin:0; padding:0; position:absolute; top:0; left:0;">|' ./inaya-hotel/public/index.html

# Fix the glass-card to take full width with small margin
sed -i 's|<div class="glass-card rounded-3xl shadow-2xl w-full max-w-md p-8 animate-fade-in">|<div class="glass-card rounded-3xl shadow-2xl animate-fade-in" style="width:92%; max-width:400px; margin:20px auto; padding:20px;">|' ./inaya-hotel/public/index.html

# Remove any padding from body on login page only
sed -i 's|<body class="bg-gray-100">|<body class="bg-gray-100" style="margin:0; padding:0; overflow-x:hidden;">|' ./inaya-hotel/public/index.html
