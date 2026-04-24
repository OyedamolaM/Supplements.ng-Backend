require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');

// DB Imports
const dbModule = require('./config/db');
const connectDB = dbModule.default || dbModule;
const prismaModule = require('./config/prisma');
const prisma = prismaModule.prisma || prismaModule.default || prismaModule;

// Route Imports
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
const categoryRoutes = require('./routes/categories');
const webhookRoutes = require('./routes/webhooks');
const fezRoutes = require('./routes/fez');
const { startAccountPurgeLoop } = require('./services/accountLifecycleService');

const app = express();
app.set('etag', false);

// 1. Initialize DB
connectDB();
startAccountPurgeLoop();

// 2. CORS Helpers
const normalizeOrigin = (value) =>
  value ? value.toString().trim().replace(/\/+$/, '').toLowerCase() : '';

const allowedOrigins = new Set(
  [
    process.env.CLIENT_URL,
    process.env.CLIENT_URL_ADMIN,
    'https://supplements.ng',
    'https://www.supplements.ng',
    'https://api.supplements.ng',
    'https://supplements-ng-frontend-git-hero-edit-oyedamolams-projects.vercel.app',
    'http://localhost:8081'
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
      normalizedOrigin.includes('oyedamolams-projects.vercel.app') ||
      /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(normalizedOrigin);

    if (isAllowed) {
      return callback(null, true);
    }
    console.error("❌ CORS Blocked:", normalizedOrigin);
    return callback(null, false);
  },
  credentials: true,
  optionsSuccessStatus: 200,
};

// 3. Apply Middleware
app.use(cors(corsOptions));
// ✅ FIX: Changed '*' to '/*splat' for Express v5 compatibility
app.options('/*splat', cors(corsOptions)); 
app.use(express.json());
app.use(cookieParser());
app.use((req, res, next) => {
  const isAuthRequest = req.path.startsWith('/api/auth');
  const hasSessionContext = Boolean(req.headers.authorization || req.headers.cookie);

  if (isAuthRequest || hasSessionContext) {
    res.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.vary('Authorization');
    res.vary('Cookie');
    res.vary('Origin');
  }

  next();
});

// 4. Base Routes
app.get('/', (req, res) => res.send('Supplements.ng Backend is running!'));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/health/ready', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ready', database: 'reachable' });
  } catch (error) {
    res.status(503).json({ status: 'not ready', message: error.message });
  }
});

// 5. API Routes
app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/user', userRoutes);
app.use('/api/customer', customerRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/wishlist', wishlistRoutes);
app.use('/api/cart', cartRoutes);

// Admin Routes
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
app.use('/api/categories', categoryRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/fez', fezRoutes);

// 6. 404 Handler for undefined routes (Named wildcard fix)
app.use('/*splat', (req, res) => {
  res.status(404).json({ success: false, message: "Route not found" });
});

// 7. GLOBAL ERROR HANDLER
app.use((err, req, res, next) => {
  console.error("🔥 Error detected:", err.stack);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || "Internal Server Error"
  });
});

// 8. Start
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server on port ${PORT}`));
