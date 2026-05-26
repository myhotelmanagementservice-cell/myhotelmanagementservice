const express = require('express');
const path = require('path');
const app = express();
app.use(express.static('inaya-hotel/public'));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'inaya-hotel/public/admin.html')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'inaya-hotel/public/index.html')));
app.listen(5000, '0.0.0.0', () => console.log('✅ Admin: http://localhost:5000/admin'));
