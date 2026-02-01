"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const cloudinary = require('../utils/cloudinary');
const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: 'REPLACE_WITH_CLOUDINARY_PRODUCTS_FOLDER',
        allowed_formats: ['jpg', 'jpeg', 'png']
    }
});
const parser = multer({ storage });
module.exports = parser;
