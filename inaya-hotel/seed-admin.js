const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const User = require('./server/models/User');

const createAdmin = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/inaya_hotel');
    
    const adminExists = await User.findOne({ email: 'admin@inaya.com' });
    if (!adminExists) {
      const hashedPassword = await bcrypt.hash('admin123', 10);
      const admin = new User({
        name: 'Admin User',
        email: 'admin@inaya.com',
        password: hashedPassword,
        role: 'super_admin',
        hotelId: 'INH001'
      });
      await admin.save();
      console.log('✅ Admin user created: admin@inaya.com / admin123');
    } else {
      console.log('⚠️ Admin user already exists');
    }
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
};

createAdmin();
