require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');

// Import Config & DB
const dbModule = require('./config/db');
const connectDB = dbModule.default || dbModule;
const prismaModule = require('./config/prisma');
const prisma = prismaModule.prisma || prismaModule.default || prismaModule;

// Import Routes
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

// 1. DATABASE CONNECTION
connectDB();

// 2. CORS CONFIGURATION
const normalizeOrigin = (value) =>
  value ? value.toString().trim().replace(/\/+$/, '').toLowerCase() : '';

const allowedOrigins = new Set(
  [
    process.env.CLIENT_URL,
    process.env.CLIENT_URL_ADMIN,
    'https://supplements.ng',
    'https://www.supplements.ng',
    'https://api.supplements.ng',
  ]
    .map(normalizeOrigin)
    .filter(Boolean)
);

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);

    const normalizedOrigin = normalizeOrigin(origin);

    const isAllowed = 
      allowedOrigins.has(normalizedOrigin) || 
      /\.oyedamolams-projects\.vercel\.app$/.test(normalizedOrigin) ||
      /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(normalizedOrigin);

    if (isAllowed) {
      return callback(null, true);
    }

    console.error("❌ CORS Blocked:", normalizedOrigin);
    // Use null, false instead of an Error object to prevent 500 crashes
    return callback(null, false); 
  },
  credentials: true,
  optionsSuccessStatus: 200,
};

// 3. GLOBAL MIDDLEWARE (Order is critical)
app.use(cors(corsOptions));
app.options('*', cors(corsOptions)); // Handle Preflight
app.use(express.json());
app.use(cookieParser());

// 4. HEALTH & PUBLIC ROUTES
app.get('/', (req, res) => res.send('Supplements.ng Backend is running!'));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/health/ready', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ready', database: 'reachable' });
  } catch (error) {
    res.status(503).json({ status: 'not ready', database: 'unreachable' });
  }
});

// 5. API ROUTES
app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/user', userRoutes);
app.use('/api/customer', customerRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/wishlist', wishlistRoutes);
app.use('/api/cart', cartRoutes);

// Admin / Management
app.use('/api/admin/products', productRoutes);
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

// 6. GLOBAL ERROR HANDLER (Prevents CORS blocks on 500 errors)
app.use((err, req, res, next) => {
  console.error("🔥 Server Error:", err.stack);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || "Internal Server Error",
  });
});

// 7. START SERVER
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
