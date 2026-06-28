const { MongoClient } = require('mongodb');
const uri = 'mongodb+srv://hotel:hotelinaya@cluster0.hauipx7.mongodb.net/inaya_hotel?retryWrites=true&w=majority';
const client = new MongoClient(uri);
client.connect().then(async () => {
  const db = client.db('inaya_hotel');
  
  const tenants = await db.collection('tenants').find({}).toArray();
  console.log('Hotels:', tenants.map(t => t.hotelId));
  
  const defaultDepts = await db.collection('departments').find({hotelId: 'default'}).toArray();
  console.log('Default departments:', defaultDepts.length);
  
  for (const tenant of tenants) {
    const hotelId = tenant.hotelId;
    if (!hotelId || hotelId === 'default') continue;
    
    for (const dept of defaultDepts) {
      const exists = await db.collection('departments').findOne({hotelId, key: dept.key});
      if (exists) {
        console.log('Already exists:', hotelId, dept.key);
      } else {
        const newDept = {...dept, hotelId};
        delete newDept._id;
        await db.collection('departments').insertOne(newDept);
        console.log('Created:', hotelId, dept.key);
      }
    }
  }
  
  console.log('Done!');
  client.close();
});
