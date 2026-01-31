const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");
const QRCode = require("qrcode");
const bwipjs = require("bwip-js");

const getCompanyInfo = () => ({
  name: process.env.RECEIPT_COMPANY_NAME || "Supplements.ng",
  phone: process.env.RECEIPT_COMPANY_PHONE || "+2348101490829",
  email: process.env.RECEIPT_COMPANY_EMAIL || "supplementsng@gmail.com",
  address: process.env.RECEIPT_COMPANY_ADDRESS || "",
  logoPath: process.env.RECEIPT_LOGO_PATH || "",
});

const formatMoney = (value = 0) =>
  Number(value || 0).toLocaleString("en-NG", { minimumFractionDigits: 0 });

const drawTableHeader = (doc, y) => {
  doc.fontSize(10).fillColor("#222");
  doc.text("Item", 40, y);
  doc.text("Qty", 300, y, { width: 50, align: "right" });
  doc.text("Price", 360, y, { width: 80, align: "right" });
  doc.text("Total", 450, y, { width: 90, align: "right" });
  doc.moveTo(40, y + 14).lineTo(550, y + 14).strokeColor("#e0e0e0").stroke();
};

const drawTableRow = (doc, y, item) => {
  doc.fontSize(10).fillColor("#222");
  doc.text(item.title, 40, y, { width: 250 });
  doc.text(item.quantity, 300, y, { width: 50, align: "right" });
  doc.text(`₦${formatMoney(item.price)}`, 360, y, { width: 80, align: "right" });
  doc.text(`₦${formatMoney(item.total)}`, 450, y, { width: 90, align: "right" });
};

const drawSummaryRow = (doc, y, label, value) => {
  doc.fontSize(10).fillColor("#555");
  doc.text(label, 360, y, { width: 80, align: "right" });
  doc.fillColor("#111").text(`₦${formatMoney(value)}`, 450, y, { width: 90, align: "right" });
};

const loadLogo = (logoPath) => {
  if (!logoPath) return null;
  const resolved = path.isAbsolute(logoPath)
    ? logoPath
    : path.join(process.cwd(), logoPath);
  if (!fs.existsSync(resolved)) return null;
  return resolved;
};

const generateReceipt = async ({ res, order, issuerName }) => {
  const company = getCompanyInfo();
  const doc = new PDFDocument({ size: "A4", margin: 40 });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `inline; filename=receipt-${order._id}.pdf`
  );

  doc.pipe(res);

  const logo = loadLogo(company.logoPath);
  if (logo) {
    doc.image(logo, 40, 30, { width: 70 });
  }

  doc
    .fontSize(18)
    .fillColor("#4e0781")
    .text(company.name, 120, 30, { align: "left" });
  doc.fontSize(10).fillColor("#555");
  doc.text(company.email, 120, 52);
  doc.text(company.phone, 120, 66);
  if (company.address) {
    doc.text(company.address, 120, 80);
  }

  const qrBuffer = await QRCode.toBuffer(order._id.toString(), { width: 110 });
  doc.image(qrBuffer, 450, 30, { width: 110 });

  const barcodeBuffer = await bwipjs.toBuffer({
    bcid: "code128",
    text: order._id.toString(),
    scale: 2,
    height: 12,
    includetext: true,
    textxalign: "center",
  });
  doc.image(barcodeBuffer, 40, 110, { width: 240 });

  doc.moveDown(4);
  doc.fontSize(12).fillColor("#111").text("Receipt", 40, 150);

  const branchName = order.branch?.name || "Online";
  const customerName = order.user?.name || "Customer";
  const paymentMethod = order.paymentMethod || "Cash on Delivery";
  const orderDate = new Date(order.createdAt).toLocaleString();
  const status = order.orderStatus || "Processing";

  doc.fontSize(10).fillColor("#555");
  doc.text(`Order ID: ${order._id}`, 40, 172);
  doc.text(`Date: ${orderDate}`, 40, 188);
  doc.text(`Status: ${status}`, 40, 204);
  doc.text(`Branch: ${branchName}`, 40, 220);
  doc.text(`Customer: ${customerName}`, 40, 236);
  doc.text(`Cashier: ${issuerName || "Online"}`, 40, 252);
  doc.text(`Payment Method: ${paymentMethod}`, 40, 268);

  if (order.shippingAddress?.fullName) {
    const address = [
      order.shippingAddress.fullName,
      order.shippingAddress.addressLine1,
      order.shippingAddress.addressLine2,
      order.shippingAddress.city,
      order.shippingAddress.state,
      order.shippingAddress.country,
      order.shippingAddress.postalCode,
      order.shippingAddress.phone,
    ]
      .filter(Boolean)
      .join(", ");
    doc.text(`Shipping: ${address}`, 40, 284, { width: 520 });
  }

  let tableY = 320;
  drawTableHeader(doc, tableY);
  tableY += 24;

  const items = order.products.map((product) => ({
    title: product.title || product.product?.title || "Item",
    quantity: product.quantity || 1,
    price: product.price || 0,
    total: (product.price || 0) * (product.quantity || 1),
  }));

  items.forEach((item) => {
    drawTableRow(doc, tableY, item);
    tableY += 20;
    if (tableY > 650) {
      doc.addPage();
      tableY = 60;
      drawTableHeader(doc, tableY);
      tableY += 24;
    }
  });

  const subtotal = order.subtotal || items.reduce((sum, item) => sum + item.total, 0);
  const tax = order.taxAmount || 0;
  const discount = order.discountAmount || 0;
  const total = order.totalPrice || subtotal + tax - discount;

  tableY += 10;
  drawSummaryRow(doc, tableY, "Subtotal", subtotal);
  tableY += 16;
  drawSummaryRow(doc, tableY, "Tax", tax);
  tableY += 16;
  drawSummaryRow(doc, tableY, "Discount", discount);
  tableY += 16;
  doc.fontSize(11).fillColor("#111");
  drawSummaryRow(doc, tableY, "Total", total);

  doc.moveDown(2);
  doc.fontSize(9).fillColor("#777").text("Thank you for your business.", 40, tableY + 30);

  doc.end();
};

module.exports = { generateReceipt };

export {};
