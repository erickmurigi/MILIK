export const API_BASE_URL = 'https://milikproperty.com/api';

export const APP_VERSION = '1.0.0';

export const STORAGE_KEYS = {
  AUTH_TOKEN:    'milik_auth_token',
  USER:          'milik_user',
  COMPANY:       'milik_company',
  PUSH_TOKEN:    'milik_push_token',
  LAST_COMPANY:  'milik_last_company_id',
  // Landlord Portal — kept fully separate from the staff keys above so a landlord's
  // session and a staff member's session can never clear/overwrite one another.
  LANDLORD_PORTAL_TOKEN:    'landlord_portal_token',
  LANDLORD_PORTAL_LANDLORD: 'landlord_portal_landlord',
  LANDLORD_PORTAL_COMPANY:  'landlord_portal_company',
};
