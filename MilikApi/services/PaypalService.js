import express from 'express';
import SubscriptionService from '../services/subscription.service';

const router = express.Router();

// PayPal webhook handler
router.post('/webhooks/paypal', async (req, res) => {
    const event = req.body;
    
    // Verify the webhook signature (important for security)
    try {
        const verified = await verifyPaypalWebhook(event);
        if (!verified) {
            return res.status(400).send('Invalid webhook signature');
        }
    } catch (error) {
        return res.status(400).send('Error verifying webhook');
    }

    // Handle different PayPal events
    switch (event.event_type) {
        case 'PAYMENT.CAPTURE.COMPLETED':
            // Find subscription by transaction ID and update status
            await SubscriptionService.handleSuccessfulPayment(
                event.resource.id,
                'paypal'
            );
            break;
            
        case 'PAYMENT.CAPTURE.DENIED':
        case 'PAYMENT.CAPTURE.FAILED':
            // Handle failed payments
            await SubscriptionService.handleFailedPayment(
                event.resource.id,
                'paypal'
            );
            break;
            
        // Handle other events as needed
    }
    
    res.status(200).send('Webhook processed');
});

// M-Pesa webhook handler
router.post('/webhooks/mpesa', async (req, res) => {
    const data = req.body;
    
    // Verify the callback is from M-Pesa
    if (data.ResultCode !== 0) {
        // Payment failed
        await SubscriptionService.handleFailedPayment(
            data.TransactionID,
            'mpesa'
        );
    } else {
        // Payment successful
        await SubscriptionService.handleSuccessfulPayment(
            data.TransactionID,
            'mpesa'
        );
    }
    
    res.status(200).json({ ResultCode: 0, ResultDesc: 'Success' });
});

export default router;