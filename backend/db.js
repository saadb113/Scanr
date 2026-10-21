const mongoose = require('mongoose');

let connected = false;

async function connectDB() {
    if (connected) return;
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error('MONGODB_URI is not set in .env');
    await mongoose.connect(uri);
    connected = true;
    console.log('MongoDB connected:', mongoose.connection.host);
}

mongoose.connection.on('error', err => {
    console.error('MongoDB error:', err.message);
});

module.exports = { connectDB };
