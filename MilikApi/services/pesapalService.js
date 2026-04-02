import axios from 'axios';
import crypto from 'crypto';

// Use the ngrok URL from environment variables
const API_BASE_URL = process.env.API_BASE_URL || process.env.BACKEND_URL;

const PESAPAL_BASE_URL = process.env.PESAPAL_ENVIRONMENT === 'live' 
  ? 'https://pay.pesapal.com/v3' 
  : 'https://cybqa.pesapal.com/pesapalv3';

// Generate a unique order ID
const generateUniqueOrderId = () => {
  const timestamp = Date.now();
  const randomString = Math.random().toString(36).substring(2, 10);
  return `order_${timestamp}_${randomString}`;
};
// Generate authentication token
export const getPesapalToken = async () => {
  try {
    const consumerKey = process.env.PESAPAL_CONSUMER_KEY;
    const consumerSecret = process.env.PESAPAL_CONSUMER_SECRET;
    
    // For production, ensure you're using live credentials
    if (process.env.PESAPAL_ENVIRONMENT === 'live') {
      console.log('Using LIVE Pesapal environment');
    } else {
      console.log('Using SANDBOX Pesapal environment (test amounts may vary)');
    }
       
    // Method 1: Form-data approach
    try {
      const requestData = {
        consumer_key: consumerKey,
        consumer_secret: consumerSecret
      };
     
      console.log('Trying JSON body authentication...');
     
      const response = await axios.post(
        `${PESAPAL_BASE_URL}/api/Auth/RequestToken`,
        requestData,
        {
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
          },
          timeout: 30000
        }
      );
     
      console.log('JSON body response:', response.data);
     
      if (!response.data.token) {
        throw new Error('No token received from Pesapal');
      }
     
      return response.data.token;
    } catch (formDataError) {
      console.log('Form-data failed, trying Basic auth...');
      console.log('Form-data error:', formDataError.response?.data || formDataError.message);
      
      // Method 2: Basic authentication
      const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
      
      const response = await axios.post(
        `${PESAPAL_BASE_URL}/api/Auth/RequestToken`,
        null,
        {
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'Authorization': `Basic ${auth}`
          },
          timeout: 30000
        }
      );
      
      console.log('Basic auth response:', response.data);
      
      if (!response.data.token) {
        throw new Error('No token received from Pesapal');
      }
      
      return response.data.token;
    }
  } catch (error) {
    console.error('Error getting Pesapal token:', error.response?.data || error.message);
    
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Headers:', error.response.headers);
      console.error('Response data:', error.response.data);
    }
    
    throw new Error('Failed to authenticate with Pesapal: ' + (error.response?.data?.message || error.message));
  }
};

// Submit payment request to Pesapal
export const submitOrderRequest = async (orderData, token) => {
  try {
      // Generate a unique ID for this transaction
    const uniqueOrderId = generateUniqueOrderId();
    
    // Use the ngrok URL for callback and notification
    const updatedOrderData = {
      ...orderData,
      id: uniqueOrderId, 
      callback_url: `${process.env.API_BASE_URL}/api/payments/pesapal-callback`,
      notification_id: process.env.PESAPAL_IPN_ID, // Use environment variable for IPN ID
      // Add payment method if specified
      ...(process.env.PREFERRED_PAYMENT_METHOD && { 
        preferred_payment_method: process.env.PREFERRED_PAYMENT_METHOD 
      }),
    };
    
    console.log('Submitting order to Pesapal with data:', updatedOrderData);
    
    const response = await axios.post(
      `${PESAPAL_BASE_URL}/api/Transactions/SubmitOrderRequest`,
      updatedOrderData,
      {
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        timeout: 30000
      }
    );
    
    console.log('Pesapal order submission response:', response.data);
    return response.data;
  } catch (error) {
    console.error('Error submitting order to Pesapal:', error.response?.data || error.message);
    throw new Error('Failed to submit order to Pesapal: ' + (error.response?.data?.message || error.message));
  }
};

// Get transaction status
export const getTransactionStatus = async (orderTrackingId, token) => {
  try {
    const response = await axios.get(
      `${PESAPAL_BASE_URL}/api/Transactions/GetTransactionStatus?orderTrackingId=${orderTrackingId}`,
      {
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        timeout: 30000
      }
    );
    
    return response.data;
  } catch (error) {
    console.error('Error getting transaction status:', error.response?.data || error.message);
    throw new Error('Failed to get transaction status from Pesapal: ' + (error.response?.data?.message || error.message));
  }
};

// Generate IPN verification signature
export const generateIPNSignature = (data) => {
  const keys = Object.keys(data).sort();
  let signatureString = '';
  
  keys.forEach(key => {
    if (key !== 'signature') {
      signatureString += `${key}${data[key]}`;
    }
  });
  
  const hash = crypto.createHash('sha256');
  hash.update(signatureString);
  return hash.digest('hex');
};