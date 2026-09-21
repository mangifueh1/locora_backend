require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');

const businessesRoutes = require('./routes/businesses');
const driversRoutes = require('./routes/drivers');
const deliveriesRoutes = require('./routes/deliveries');
const customersRoutes = require('./routes/customers');

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/v1/businesses', businessesRoutes);
app.use('/api/v1/drivers', driversRoutes);
app.use('/api/v1/deliveries', deliveriesRoutes);
app.use('/api/v1/customers', customersRoutes);

app.get('/health', (req, res) => res.json({ status: 'ok' }));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// Driver's browser joins a room per delivery and streams its position.
// Anyone subscribed to that room (the business dashboard, a future customer view)
// gets it pushed live.
io.on('connection', (socket) => {
  socket.on('join-delivery', (deliveryId) => {
    socket.join(`delivery:${deliveryId}`);
  });

  socket.on('driver-location', ({ deliveryId, lat, lng }) => {
    io.to(`delivery:${deliveryId}`).emit('location-update', { lat, lng, at: Date.now() });
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`Locora backend running on port ${PORT}`));