const { ObjectId } = require('mongodb');
const { getDB, isConnected } = require('../../config/db');
const { broadcast } = require('../../utils/broadcast');
const { success, error, created, notFound } = require('../../utils/apiResponse');

exports.getRooms = async (req, res) => {
  try {
    const hotelId = req.hotelId;
    if (!isConnected()) return success(res, []);

    const db = getDB();
    const rooms = await db.collection('rooms').find({ hotelId }).sort({ number: 1 }).toArray();
    return success(res, rooms);
  } catch (err) {
    console.error('Rooms fetch error:', err);
    return error(res, err.message, 500);
  }
};

exports.getAvailableRooms = async (req, res) => {
  try {
    const hotelId = req.hotelId;
    if (!isConnected()) return success(res, []);

    const db = getDB();
    const rooms = await db.collection('rooms').find({ hotelId, status: 'Vacant' }).sort({ number: 1 }).toArray();
    return success(res, rooms);
  } catch (err) {
    console.error('Available rooms fetch error:', err);
    return error(res, err.message, 500);
  }
};

exports.createRoom = async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const { number, type, price, status, guestName, amenities } = req.body;

    if (!number || !type || !price) {
      return error(res, 'number, type, and price are required', 400);
    }

    if (!isConnected()) {
      const room = {
        _id: 'r_'+Date.now(),
        hotelId,
        number: parseInt(number),
        type,
        price: parseFloat(price),
        status: status || 'Vacant',
        guestName: guestName || null,
        amenities: amenities || [],
        createdAt: new Date(),
        updatedAt: new Date()
      };
      broadcast(hotelId, 'room_upd', room, req.clientId);
      return created(res, room, 'Room added (offline)');
    }

    const db = getDB();
    const existing = await db.collection('rooms').findOne({ hotelId, number: parseInt(number) });
    if (existing) {
      return error(res, 'Room number already exists', 400);
    }

    const room = {
      hotelId,
      number: parseInt(number),
      type,
      price: parseFloat(price),
      status: status || 'Vacant',
      guestName: guestName || null,
      amenities: amenities || [],
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const result = await db.collection('rooms').insertOne(room);
    room._id = result.insertedId;
    broadcast(hotelId, 'room_upd', room, req.clientId);
    return created(res, room, 'Room added');

  } catch (err) {
    console.error('Room create error:', err);
    return error(res, err.message, 500);
  }
};

exports.updateRoom = async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const { id } = req.params;
    const { number, type, price, status, guestName, amenities } = req.body;

    if (!isConnected()) {
      const updatedRoom = {
        _id: id,
        hotelId,
        number: number ? parseInt(number) : undefined,
        type,
        price: price ? parseFloat(price) : undefined,
        status,
        guestName,
        amenities,
        updatedAt: new Date()
      };
      broadcast(hotelId, 'room_upd', updatedRoom, req.clientId);
      return success(res, updatedRoom, 'Room updated (offline)');
    }

    const db = getDB();
    const updateData = {
      updatedAt: new Date(),
      ...(number && { number: parseInt(number) }),
      ...(type && { type }),
      ...(price && { price: parseFloat(price) }),
      ...(status && { status }),
      ...(guestName !== undefined && { guestName }),
      ...(amenities && { amenities })
    };

    const result = await db.collection('rooms').updateOne(
      { _id: new ObjectId(id), hotelId },
      { $set: updateData }
    );

    if (result.matchedCount === 0) {
      return notFound(res, 'Room not found');
    }

    const updatedRoom = await db.collection('rooms').findOne({ _id: new ObjectId(id) });
    broadcast(hotelId, 'room_upd', updatedRoom, req.clientId);
    return success(res, updatedRoom, 'Room updated');

  } catch (err) {
    console.error('Room update error:', err);
    return error(res, err.message, 500);
  }
};

exports.deleteRoom = async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const { id } = req.params;

    if (!isConnected()) {
      broadcast(hotelId, 'room_upd', { _id: id, hotelId, deleted: true }, req.clientId);
      return success(res, null, 'Room deleted (offline)');
    }

    const db = getDB();
    const result = await db.collection('rooms').deleteOne({ _id: new ObjectId(id), hotelId });
    if (result.deletedCount === 0) {
      return notFound(res, 'Room not found');
    }

    broadcast(hotelId, 'room_upd', { _id: id, hotelId, deleted: true }, req.clientId);
    return success(res, null, 'Room deleted');

  } catch (err) {
    console.error('Room delete error:', err);
    return error(res, err.message, 500);
  }
};