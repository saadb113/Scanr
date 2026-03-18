const mongoose = require('mongoose');
const { connectDB } = require('./db');

async function fixIndex() {
  try {
    await connectDB();
    const db = mongoose.connection.db;

    // Drop the old non-sparse unique index on referralCode
    try {
      await db.collection('users').dropIndex('referralCode_1');
      console.log('✓ Dropped old referralCode index');
    } catch (e) {
      console.log('Index doesn\'t exist or already dropped');
    }

    // Mongoose will create the new sparse index on next operation
    console.log('✓ Old index removed. New sparse index will be created automatically.');
    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

fixIndex();
