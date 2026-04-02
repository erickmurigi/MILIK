import { Subscription, SubscriptionPlan , Payment } from '../models/Subscription/Subcription.js';
import Business  from '../models/Business.js';
import axios from 'axios';

class SubscriptionService {
     async createSubscription(businessId, planId, billingCycle, paymentMethod) {
        const business = await Business.findById(businessId);
        if (!business) {
            throw new Error('Business not found');
        }

        // Check existing subscriptions
        const activeSubscriptions = await Subscription.find({
            business: businessId,
            status: { $in: ['active', 'pending'] }
        });

        if (activeSubscriptions.length >= 2) {
            throw new Error('Business can only have 2 active subscriptions');
        }

        // Check plan exists
        const plan = await SubscriptionPlan.findById(planId);
        if (!plan || !plan.isActive) throw new Error('Invalid subscription plan');

       
        return new Subscription({
            business: businessId,
            plan: planId,
            startDate: null,
            endDate: null,
            nextBillingDate: null,
            billingCycle,
            paymentMethod,
            status: 'pending'
        }).save();
    }

    async calculateRenewalDates(paymentDate, billingCycle) {
        const startDate = new Date(paymentDate);
        
        // Reset time components to avoid timezone issues
        startDate.setUTCHours(0, 0, 0, 0);

        const endDate = new Date(startDate);
        
        switch (billingCycle) {
            case 'monthly':
                endDate.setUTCMonth(endDate.getUTCMonth() + 1);
                break;
            case 'quarterly':
                endDate.setUTCMonth(endDate.getUTCMonth() + 3);
                break;
            case 'yearly':
                endDate.setUTCFullYear(endDate.getUTCFullYear() + 1);
                break;
            default: 
                throw new Error('Invalid billing cycle');
        }

        // Set to end of the period (23:59:59)
        endDate.setUTCHours(23, 59, 59, 999);

        return { 
            startDate, 
            endDate,
            nextBillingDate: new Date(endDate) 
        };
    }

    // Check for expiring subscriptions and send notifications
    async checkExpiringSubscriptions(daysBefore = 3) {
        const expiringSubscriptions = await Subscription.checkExpiringSubscriptions(daysBefore);
        
        for (const subscription of expiringSubscriptions) {
            await this.sendRenewalNotification(subscription);
            subscription.lastNotificationDate = new Date();
            await subscription.save();
        }
        
        return expiringSubscriptions;
    }

  async activateSubscription(subscriptionId, paymentDate) {
    const subscription = await Subscription.findById(subscriptionId);
    if (!subscription) throw new Error('Subscription not found');
    
    // Calculate dates based on EXACT payment time
    const { startDate, endDate, nextBillingDate } = 
      await this.calculateRenewalDates(paymentDate, subscription.billingCycle);

    subscription.startDate = startDate;
    subscription.endDate = endDate;
    subscription.nextBillingDate = nextBillingDate;
    subscription.status = 'active';
    
    await subscription.save();
    return subscription;
  }

  
    // Helper methods
    async processPaypalPayment(subscription, paymentDetails) {
        // Implement PayPal payment processing
        // This would actually call PayPal API
        try {
            // Mock implementation - replace with actual PayPal API calls
            const response = await axios.post('https://api-m.paypal.com/v2/checkout/orders', {
                intent: 'CAPTURE',
                purchase_units: [{
                    amount: {
                        currency_code: 'USD',
                        value: subscription.plan.price
                    }
                }]
            }, {
                headers: {
                    'Authorization': `Bearer ${process.env.PAYPAL_ACCESS_TOKEN}`,
                    'Content-Type': 'application/json'
                }
            });

            return {
                success: true,
                transactionId: response.data.id
            };
        } catch (error) {
            return {
                success: false,
                error: error.message,
                transactionId: null
            };
        }
    }

    async processMpesaPayment(subscription, paymentDetails) {
        // Implement M-Pesa payment processing
        // This would actually call M-Pesa API
        try {
            // Mock implementation - replace with actual M-Pesa API calls
            return {
                success: true,
                transactionId: `MPESA_${Date.now()}`
            };
        } catch (error) {
            return {
                success: false,
                error: error.message,
                transactionId: null
            };
        }
    }

    async sendRenewalNotification(subscription) {
        // Implement notification sending logic
        // This could be email, SMS, or in-app notification
        const business = await Business.findById(subscription.business);
        
        // Example: Send email
        const mailService = new MailService();
        await mailService.send({
            to: business.email,
            subject: 'Subscription Renewal Reminder',
            text: `Your subscription for ${business.businessName} will renew on ${subscription.nextBillingDate}.`
        });
    }

    generateInvoiceId() {
        return `INV-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    }
}
export default new SubscriptionService();