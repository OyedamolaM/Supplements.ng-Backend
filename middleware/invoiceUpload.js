const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("../utils/cloudinary");

const storage = new CloudinaryStorage({
  cloudinary,
  params: () => ({
    folder: "savans_pharmacy_invoices",
    resource_type: "auto",
    allowed_formats: ["jpg", "jpeg", "png", "pdf"],
  }),
});

const invoiceUpload = multer({ storage });

module.exports = invoiceUpload;
