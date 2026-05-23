const express = require('express');
const router = express.Router();
const FoodItem = require('../models/FoodItem');
const { protect, authorize, checkHotelAccess } = require('../middleware/auth');

// ============================================
// GET all food items for current hotel
// ============================================
router.get('/', protect, async (req, res) => {
    try {
        const hotelId = req.hotelId || req.user?.hotelId;
        const { category, available, search, limit = 100 } = req.query;

        let query = { hotelId, isDeleted: false };

        if (category) query.category = category;
        if (available !== undefined) query.available = available === 'true';
        if (search) {
            query.$or = [
                { name: { $regex: search, $options: 'i' } },
                { description: { $regex: search, $options: 'i' } },
                { category: { $regex: search, $options: 'i' } }
            ];
        }

        const foodItems = await FoodItem.find(query)
            .sort({ category: 1, name: 1 })
            .limit(parseInt(limit));

        res.json({
            success: true,
            count: foodItems.length,
            data: foodItems
        });
    } catch (error) {
        console.error('Get food items error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// GET single food item by ID
// ============================================
router.get('/:id', protect, async (req, res) => {
    try {
        const hotelId = req.hotelId || req.user?.hotelId;
        const foodItem = await FoodItem.findOne({
            _id: req.params.id,
            hotelId,
            isDeleted: false
        });

        if (!foodItem) {
            return res.status(404).json({
                success: false,
                error: 'Food item not found'
            });
        }

        res.json({
            success: true,
            data: foodItem
        });
    } catch (error) {
        console.error('Get food item error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// CREATE new food item (Admin only)
// ============================================
router.post('/', protect, authorize('super_admin', 'hotel_admin'), async (req, res) => {
    try {
        const hotelId = req.hotelId || req.user?.hotelId;
        const {
            name,
            price,
            category,
            description,
            available,
            isVegetarian,
            spicy,
            image
        } = req.body;

        // Validation
        if (!name || !price) {
            return res.status(400).json({
                success: false,
                error: 'Name and price are required'
            });
        }

        const foodItem = new FoodItem({
            hotelId,
            name,
            price,
            category: category || 'Main Course',
            description: description || '',
            available: available !== undefined ? available : true,
            isVegetarian: isVegetarian || false,
            spicy: spicy || false,
            image: image || ''
        });

        await foodItem.save();

        res.status(201).json({
            success: true,
            message: 'Food item created successfully',
            data: foodItem
        });
    } catch (error) {
        console.error('Create food item error:', error);

        if (error.code === 11000) {
            return res.status(400).json({
                success: false,
                error: 'Food item with this name already exists'
            });
        }

        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// UPDATE food item (Admin only)
// ============================================
router.put('/:id', protect, authorize('super_admin', 'hotel_admin'), async (req, res) => {
    try {
        const hotelId = req.hotelId || req.user?.hotelId;
        const {
            name,
            price,
            category,
            description,
            available,
            isVegetarian,
            spicy,
            image
        } = req.body;

        const foodItem = await FoodItem.findOne({
            _id: req.params.id,
            hotelId,
            isDeleted: false
        });

        if (!foodItem) {
            return res.status(404).json({
                success: false,
                error: 'Food item not found'
            });
        }

        // Update fields
        if (name) foodItem.name = name;
        if (price !== undefined) foodItem.price = price;
        if (category) foodItem.category = category;
        if (description !== undefined) foodItem.description = description;
        if (available !== undefined) foodItem.available = available;
        if (isVegetarian !== undefined) foodItem.isVegetarian = isVegetarian;
        if (spicy !== undefined) foodItem.spicy = spicy;
        if (image !== undefined) foodItem.image = image;

        foodItem.updatedAt = new Date();
        await foodItem.save();

        res.json({
            success: true,
            message: 'Food item updated successfully',
            data: foodItem
        });
    } catch (error) {
        console.error('Update food item error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// DELETE food item (Soft delete - Admin only)
// ============================================
router.delete('/:id', protect, authorize('super_admin', 'hotel_admin'), async (req, res) => {
    try {
        const hotelId = req.hotelId || req.user?.hotelId;
        const foodItem = await FoodItem.findOne({
            _id: req.params.id,
            hotelId,
            isDeleted: false
        });

        if (!foodItem) {
            return res.status(404).json({
                success: false,
                error: 'Food item not found'
            });
        }

        foodItem.isDeleted = true;
        foodItem.deletedAt = new Date();
        foodItem.updatedAt = new Date();
        await foodItem.save();

        res.json({
            success: true,
            message: 'Food item deleted successfully'
        });
    } catch (error) {
        console.error('Delete food item error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// BULK CREATE food items (Admin only)
// ============================================
router.post('/bulk', protect, authorize('super_admin', 'hotel_admin'), async (req, res) => {
    try {
        const hotelId = req.hotelId || req.user?.hotelId;
        const { items } = req.body;

        if (!items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Items array is required'
            });
        }

        const foodItems = items.map(item => ({
            ...item,
            hotelId,
            createdAt: new Date(),
            updatedAt: new Date()
        }));

        const created = await FoodItem.insertMany(foodItems, { ordered: false });

        res.status(201).json({
            success: true,
            message: `${created.length} food items created successfully`,
            count: created.length,
            data: created
        });
    } catch (error) {
        console.error('Bulk create food items error:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            partialSuccess: error.insertedDocs?.length || 0
        });
    }
});

// ============================================
// GET food items by category
// ============================================
router.get('/category/:category', protect, async (req, res) => {
    try {
        const hotelId = req.hotelId || req.user?.hotelId;
        const { category } = req.params;

        const foodItems = await FoodItem.find({
            hotelId,
            category,
            available: true,
            isDeleted: false
        }).sort({ name: 1 });

        res.json({
            success: true,
            count: foodItems.length,
            data: foodItems
        });
    } catch (error) {
        console.error('Get food by category error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// GET available food items (for guests)
// ============================================
router.get('/available/all', protect, async (req, res) => {
    try {
        const hotelId = req.hotelId || req.user?.hotelId;

        const foodItems = await FoodItem.find({
            hotelId,
            available: true,
            isDeleted: false
        }).sort({ category: 1, name: 1 });

        // Group by category
        const grouped = foodItems.reduce((acc, item) => {
            if (!acc[item.category]) {
                acc[item.category] = [];
            }
            acc[item.category].push(item);
            return acc;
        }, {});

        res.json({
            success: true,
            count: foodItems.length,
            categories: Object.keys(grouped),
            data: grouped
        });
    } catch (error) {
        console.error('Get available food error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// UPDATE availability (toggle)
// ============================================
router.patch('/:id/availability', protect, authorize('super_admin', 'hotel_admin'), async (req, res) => {
    try {
        const hotelId = req.hotelId || req.user?.hotelId;
        const { available } = req.body;

        const foodItem = await FoodItem.findOne({
            _id: req.params.id,
            hotelId,
            isDeleted: false
        });

        if (!foodItem) {
            return res.status(404).json({
                success: false,
                error: 'Food item not found'
            });
        }

        foodItem.available = available !== undefined ? available : !foodItem.available;
        foodItem.updatedAt = new Date();
        await foodItem.save();

        res.json({
            success: true,
            message: `Food item is now ${foodItem.available ? 'available' : 'unavailable'}`,
            data: foodItem
        });
    } catch (error) {
        console.error('Update availability error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// GET food items statistics
// ============================================
router.get('/stats/summary', protect, authorize('super_admin', 'hotel_admin'), async (req, res) => {
    try {
        const hotelId = req.hotelId || req.user?.hotelId;

        const total = await FoodItem.countDocuments({ hotelId, isDeleted: false });
        const available = await FoodItem.countDocuments({ hotelId, available: true, isDeleted: false });
        const unavailable = total - available;

        const byCategory = await FoodItem.aggregate([
            { $match: { hotelId, isDeleted: false } },
            { $group: {
                _id: '$category',
                count: { $sum: 1 },
                avgPrice: { $avg: '$price' },
                minPrice: { $min: '$price' },
                maxPrice: { $max: '$price' }
            }},
            { $sort: { count: -1 } }
        ]);

        const vegetarianCount = await FoodItem.countDocuments({
            hotelId,
            isVegetarian: true,
            isDeleted: false
        });

        const spicyCount = await FoodItem.countDocuments({
            hotelId,
            spicy: true,
            isDeleted: false
        });

        res.json({
            success: true,
            data: {
                total,
                available,
                unavailable,
                vegetarianCount,
                spicyCount,
                byCategory
            }
        });
    } catch (error) {
        console.error('Get food stats error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// SEARCH food items
// ============================================
router.get('/search/query', protect, async (req, res) => {
    try {
        const hotelId = req.hotelId || req.user?.hotelId;
        const { q, minPrice, maxPrice, category, vegetarian, spicy } = req.query;

        let query = { hotelId, isDeleted: false };

        if (q) {
            query.$or = [
                { name: { $regex: q, $options: 'i' } },
                { description: { $regex: q, $options: 'i' } }
            ];
        }

        if (minPrice) query.price = { ...query.price, $gte: parseFloat(minPrice) };
        if (maxPrice) query.price = { ...query.price, $lte: parseFloat(maxPrice) };
        if (category) query.category = category;
        if (vegetarian === 'true') query.isVegetarian = true;
        if (spicy === 'true') query.spicy = true;

        const results = await FoodItem.find(query)
            .sort({ name: 1 })
            .limit(50);

        res.json({
            success: true,
            count: results.length,
            data: results
        });
    } catch (error) {
        console.error('Search food error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;