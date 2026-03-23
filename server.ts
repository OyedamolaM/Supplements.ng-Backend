require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const dbModule = require('./config/db');
const connectDB = dbModule.default || dbModule;
const prismaModule = require('./config/prisma');
const prisma = prismaModule.prisma || prismaModule.default || prismaModule;

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

// ------------------------
// Normalize origins helper
// ------------------------
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

// ------------------------
// CORS middleware (robust)
// ------------------------
const corsOptions = {
  origin: (origin, callback) => {
    console.log("🔥 Incoming Origin:", origin);

    // No origin (server-to-server, mobile, curl, Postman)
    if (!origin) {
      console.log("✅ No origin (allowed)");
      return callback(null, true);
    }

    const normalizedOrigin = normalizeOrigin(origin);
    console.log("🔍 Normalized:", normalizedOrigin);

    // Allowed origins
    if (allowedOrigins.has(normalizedOrigin)) {
      console.log("✅ Matched allowedOrigins");
      return callback(null, true);
    }

    // Localhost for dev
    if (
      normalizedOrigin.startsWith('http://localhost:') ||
      normalizedOrigin.startsWith('http://127.0.0.1:')
    ) {
      console.log("✅ Allowed localhost");
      return callback(null, true);
    }

    // Any Vercel preview branch
    if (normalizedOrigin.includes('oyedamolams-projects.vercel.app')) {
      console.log("✅ Allowed Vercel preview");
      return callback(null, true);
    }

    console.log("❌ BLOCKED:", normalizedOrigin);
    return callback(new Error(`CORS blocked for origin: ${origin}`));
  },
  credentials: true,
};

// ------------------------
// Apply CORS BEFORE routes
// ------------------------
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// ------------------------
// Body parsers
// ------------------------
app.use(express.json());
app.use(cookieParser());

// ------------------------
// Test route
// ------------------------
app.get('/', (req, res) => {
  res.send('Supplements.ng Backend is running!');
});

// ------------------------
// Health checks
// ------------------------
const baseHealthPayload = () => ({
  status: 'ok',
  service: 'supplements.ng-backend',
  timestamp: new Date().toISOString(),
});

app.get('/api/health', (_req, res) => {
  res.json(baseHealthPayload());
});

app.get('/api/health/ready', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({
      ...baseHealthPayload(),
      status: 'ready',
      database: 'reachable',
    });
  } catch (error) {
    res.status(503).json({
      ...baseHealthPayload(),
      status: 'not ready',
      database: 'unreachable',
      message: error?.message || 'Database connection failed',
    });
  }
});

// ------------------------
// Public / Auth routes
// ------------------------
app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/user', userRoutes);
app.use('/api/customer', customerRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/wishlist', wishlistRoutes);
app.use('/api/cart', cartRoutes);

// ------------------------
// Admin routes
// ------------------------
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

// ------------------------
// Start server
// ------------------------
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

export {};