const express = require('express');
const router = express.Router();
const { protect, adminOnly } = require('../middleware/authMiddleware');
const ProductController = require('../controllers/productController');
const parser = require('../middleware/upload');

// -------------------
// ADMIN: CREATE PRODUCT WITH IMAGES
// -------------------
router.post(
  '/',
  protect,
  adminOnly,
  parser.array('images', 5), // upload up to 5 images
  ProductController.create
);

// -------------------
// ADMIN: UPDATE PRODUCT WITH IMAGES
// -------------------
router.put(
  '/:id',
  protect,
  adminOnly,
  parser.array('images', 5), // upload new images (replace or append)
  ProductController.update
);

// -------------------
// PUBLIC ROUTES
// -------------------
router.get('/', ProductController.list);
router.get('/:id', ProductController.getOne);

// -------------------
// ADMIN: DELETE PRODUCT
// -------------------
router.delete('/:id', protect, adminOnly, ProductController.remove);

module.exports = router;
