// Audit script for misclassified invoices in RentPayment
// Run this in a Node.js environment with Mongoose connected to your database

const mongoose = require('mongoose');
const RentPayment = require('./models/RentPayment'); // Adjust path as needed

async function auditMisclassifiedInvoices() {
  // Find invoices with a receiptNumber (should not exist)
  const misclassified = await RentPayment.find({
    ledgerType: 'invoices',
    receiptNumber: { $exists: true, $ne: null, $ne: '' }
  });

  if (misclassified.length === 0) {
    console.log('No misclassified invoices found.');
  } else {
    console.log(`Found ${misclassified.length} misclassified invoices:`);
    misclassified.forEach((doc) => {
      console.log({
        _id: doc._id,
        receiptNumber: doc.receiptNumber,
        amount: doc.amount,
        paymentDate: doc.paymentDate,
        tenant: doc.tenant,
        property: doc.property,
        createdAt: doc.createdAt
      });
    });
  }
}

// Connect and run
mongoose.connect('mongodb://localhost:27017/YOUR_DB_NAME', { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => auditMisclassifiedInvoices())
  .catch(err => console.error('DB connection error:', err));
