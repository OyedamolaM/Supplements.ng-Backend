const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("../utils/cloudinary");

const storage = new CloudinaryStorage({
  cloudinary,
  params: () => ({
    folder: "REPLACE_WITH_CLOUDINARY_INVOICE_FOLDER",
    resource_type: "auto",
    allowed_formats: ["jpg", "jpeg", "png", "pdf"],
  }),
});

const invoiceUpload = multer({ storage });

module.exports = invoiceUpload;

export {};
