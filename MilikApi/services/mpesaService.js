import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

class MpesaService {
  constructor() {
    this.consumerKey = process.env.MPESA_CONSUMER_KEY;
    this.consumerSecret = process.env.MPESA_CONSUMER_SECRET;
    this.baseURL = process.env.MPESA_ENVIRONMENT === 'production' 
      ? 'https://api.safaricom.co.ke' 
      : 'https://sandbox.safaricom.co.ke';
    this.shortCode = process.env.MPESA_SHORTCODE;
    this.passKey = process.env.MPESA_PASSKEY;
  }

  // Generate access token
  async generateAccessToken() {
    try {
      const auth = Buffer.from(`${this.consumerKey}:${this.consumerSecret}`).toString('base64');
      
      const response = await axios.get(`${this.baseURL}/oauth/v1/generate?grant_type=client_credentials`, {
        headers: {
          Authorization: `Basic ${auth}`
        }
      });

      return response.data.access_token;
    } catch (error) {
      console.error('Error generating access token:', error.response?.data || error.message);
      throw error;
    }
  }

  // Register C2B URLs - FIXED VERSION
  async registerC2BUrls(confirmationURL, validationURL, responseType = 'Completed') {
    try {
      const accessToken = await this.generateAccessToken();
      
      // Validate responseType
      if (responseType !== 'Completed' && responseType !== 'Cancelled') {
        throw new Error('ResponseType must be either "Completed" or "Cancelled"');
      }
      
      const payload = {
        ShortCode: this.shortCode, // Uses environment variable
        ResponseType: responseType, // Should be 'Completed' or 'Cancelled'
        ConfirmationURL: confirmationURL,
        ValidationURL: validationURL
      };

      console.log('Registering URLs with payload:', payload);

      const response = await axios.post(
        `${this.baseURL}/mpesa/c2b/v1/registerurl`,
        payload,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      return response.data;
    } catch (error) {
      console.error('Error registering C2B URLs:', error.response?.data || error.message);
      throw error;
    }
  }

  // STK Push — prompts a customer's phone to pay via Lipa Na M-Pesa
  async stkPush({ phone, amount, accountRef, description, callbackUrl }) {
    const accessToken = await this.generateAccessToken();
    const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
    const password = Buffer.from(`${this.shortCode}${this.passKey}${timestamp}`).toString('base64');
    // Normalise phone: 07xx → 2547xx, +2547xx → 2547xx
    const normalised = String(phone || '').replace(/^\+/, '').replace(/^0/, '254');
    const payload = {
      BusinessShortCode: this.shortCode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: Math.ceil(Number(amount)),
      PartyA: normalised,
      PartyB: this.shortCode,
      PhoneNumber: normalised,
      CallBackURL: callbackUrl,
      AccountReference: String(accountRef || 'CarWash').slice(0, 12),
      TransactionDesc: String(description || 'Car Wash Payment').slice(0, 13),
    };
    try {
      const response = await axios.post(
        `${this.baseURL}/mpesa/stkpush/v1/processrequest`,
        payload,
        { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } }
      );
      return response.data;
    } catch (error) {
      console.error('STK Push error:', error.response?.data || error.message);
      throw error;
    }
  }

  // Check if STK push is configured (env vars present)
  isConfigured() {
    return Boolean(this.consumerKey && this.consumerSecret && this.shortCode && this.passKey);
  }

  // Simulate C2B payment (for sandbox testing)
  async simulateC2BPayment(amount, msisdn, billRefNumber) {
    try {
      const accessToken = await this.generateAccessToken();
      
      // Convert billRefNumber to string explicitly
      const billRefString = billRefNumber.toString();
      
      const payload = {
        ShortCode: this.shortCode,
        CommandID: 'CustomerPayBillOnline',
        Amount: amount,
        Msisdn: msisdn,
        BillRefNumber: billRefString
      };

      console.log('Simulating payment with payload:', payload);

      const response = await axios.post(
        `${this.baseURL}/mpesa/c2b/v1/simulate`,
        payload,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      return response.data;
    } catch (error) {
      console.error('Error simulating C2B payment:', error.response?.data || error.message);
      throw error;
    }
  }
}

export default new MpesaService();