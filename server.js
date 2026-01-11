require('dotenv').config();
const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');

// Routes
const authRoutes = require('./routes/auth');
const productRoutes = require('./routes/products');
const orderRoutes = require('./routes/orders');
const userRoutes = require('./routes/user');
const customerRoutes = require('./routes/customer');
const adminOrdersRoutes = require('./routes/adminOrders');
const adminUsersRoutes = require('./routes/adminUsers');
const adminAnalyticsRoutes = require('./routes/adminAnalytics');
const paymentRoutes = require('./routes/payment');
const wishlistRoutes = require('./routes/wishlist');
const cartRoutes = require('./routes/cart');
const branchRoutes = require('./routes/branches');
const supplierRoutes = require('./routes/suppliers');
const supplierInvoiceRoutes = require('./routes/supplierInvoices');
const activityRoutes = require('./routes/activity');
const reportsRoutes = require('./routes/reports');
const taxRateRoutes = require('./routes/taxRates');
const approvalRoutes = require('./routes/approvals');

const app = express();
connectDB();

// Middleware
app.use(cors());
app.use(express.json());

// Test route
app.get('/', (req, res) => {
  res.send('Savans Pharmacy Backend is running!');
});

// Public / Auth routes
app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/user', userRoutes);
app.use('/api/customer', customerRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/wishlist', wishlistRoutes);
app.use('/api/cart', cartRoutes);

// Admin routes
app.use('/api/admin/products', productRoutes); // Admin product management
app.use('/api/admin/orders', adminOrdersRoutes);
app.use('/api/admin/users', adminUsersRoutes);
app.use('/api/admin/analytics', adminAnalyticsRoutes);
app.use('/api/branches', branchRoutes);
app.use('/api/suppliers', supplierRoutes);
app.use('/api/supplier-invoices', supplierInvoiceRoutes);
app.use('/api/activity', activityRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/tax-rates', taxRateRoutes);
app.use('/api/approvals', approvalRoutes);

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
