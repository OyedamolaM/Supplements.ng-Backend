const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const cloudinary = require('../utils/cloudinary');

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'savans_pharmacy_products',
    allowed_formats: ['jpg', 'jpeg', 'png']
  }
});

const parser = multer({ storage });

module.exports = parser;
