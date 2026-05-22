cat > server/models/FoodItem.js << 'EOF'
const mongoose = require('mongoose');

const FoodItemSchema = new mongoose.Schema({
  hotelId: { type: String, required: true, index: true },
  name: { type: String, required: true },
  price: { type: Number, required: true },
  category: { type: String, enum: ['Appetizer', 'Main Course', 'Dessert', 'Beverage', 'Snack'], default: 'Main Course' },
  description: { type: String, default: '' },
  available: { type: Boolean, default: true },
  image: { type: String, default: '' }
}, { timestamps: true });

module.exports = mongoose.model('FoodItem', FoodItemSchema);
EOF