const express = require('express');
const router = express.Router();
const { protect, requireRole } = require('../middleware/authMiddleware');
const ProductController = require('../controllers/productController');
const parser = require('../middleware/upload'); // multer or cloudinary upload middleware

// -------------------
// ADMIN: CREATE PRODUCT WITH IMAGES
// -------------------
router.post(
  '/',
  protect,
  requireRole(['super_admin', 'admin', 'inventory_manager']),
  parser.array('images', 5), // upload up to 5 images
  ProductController.create
);

// -------------------
// ADMIN: UPDATE PRODUCT WITH IMAGES
// -------------------
router.put(
  '/:id',
  protect,
  requireRole(['super_admin', 'admin', 'inventory_manager']),
  parser.array('images', 5),
  ProductController.update
);

// -------------------
// PUBLIC: GET ALL PRODUCTS
// -------------------
router.get('/', ProductController.list);

// -------------------
// PUBLIC: GET ONE PRODUCT
// -------------------
router.get('/:id', ProductController.getOne);

// -------------------
// ADMIN: DELETE PRODUCT
// -------------------
router.delete(
  '/:id',
  protect,
  requireRole(['super_admin', 'admin', 'inventory_manager']),
  ProductController.remove
);

module.exports = router;
