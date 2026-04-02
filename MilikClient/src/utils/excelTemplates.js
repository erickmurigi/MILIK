// utils/excelTemplates.js
import * as XLSX from 'xlsx';

/**
 * Generate Excel template for Landlords with instructions
 */
export const generateLandlordsTemplate = () => {
  // Sheet 1: Data Template (Headers only)
  const dataSheet = XLSX.utils.aoa_to_sheet([
    [
      'Landlord Name *',
      'Landlord Type *',
      'Reg/ID Number *',
      'Tax PIN *',
      'Email *',
      'Phone Number *',
      'Postal Address',
      'Location',
      'Status',
      'Portal Access'
    ]
  ]);

  // Set column widths
  dataSheet['!cols'] = [
    { wch: 25 }, // Landlord Name
    { wch: 18 }, // Landlord Type
    { wch: 20 }, // Reg/ID Number
    { wch: 20 }, // Tax PIN
    { wch: 30 }, // Email
    { wch: 18 }, // Phone Number
    { wch: 30 }, // Postal Address
    { wch: 20 }, // Location
    { wch: 12 }, // Status
    { wch: 15 }  // Portal Access
  ];

  // Sheet 2: Instructions & Examples
  const instructionsSheet = XLSX.utils.aoa_to_sheet([
    ['LANDLORD IMPORT INSTRUCTIONS'],
    [''],
    ['REQUIRED FIELDS (marked with *)'],
    ['• Landlord Name: Full name of the landlord or company'],
    ['• Landlord Type: Must be one of: Individual, Company, Partnership, Trust'],
    ['• Reg/ID Number: Registration or ID number (must be unique)'],
    ['• Tax PIN: Tax identification number (must be unique)'],
    ['• Email: Valid email address (must be unique)'],
    ['• Phone Number: Contact phone number (include country code if international)'],
    [''],
    ['OPTIONAL FIELDS'],
    ['• Postal Address: Mailing address'],
    ['• Location: Physical location or area'],
    ['• Status: Active or Archived (default: Active)'],
    ['• Portal Access: Enabled or Disabled (default: Disabled)'],
    [''],
    ['EXAMPLE DATA (Copy to Data Sheet)'],
    [''],
    // Headers
    [
      'Landlord Name',
      'Landlord Type',
      'Reg/ID Number',
      'Tax PIN',
      'Email',
      'Phone Number',
      'Postal Address',
      'Location',
      'Status',
      'Portal Access'
    ],
    // Example 1
    [
      'John Doe Properties Ltd',
      'Company',
      'C123456789',
      'A001234567K',
      'john.doe@example.com',
      '+254712345678',
      'P.O. Box 12345, Nairobi',
      'Westlands',
      'Active',
      'Enabled'
    ],
    // Example 2
    [
      'Mary Wanjiku',
      'Individual',
      '12345678',
      'A009876543L',
      'mary.wanjiku@example.com',
      '+254723456789',
      'P.O. Box 54321, Mombasa',
      'Nyali',
      'Active',
      'Disabled'
    ],
    // Example 3
    [
      'ABC Real Estate Partnership',
      'Partnership',
      'P987654321',
      'A005554443M',
      'info@abcrealestate.com',
      '+254734567890',
      'P.O. Box 98765, Kisumu',
      'Milimani',
      'Active',
      'Enabled'
    ],
    [''],
    ['IMPORTANT NOTES'],
    ['• Do not modify the column headers in the Data sheet'],
    ['• All required fields marked with * must have values'],
    ['• Landlord Type must match exactly: Individual, Company, Partnership, or Trust'],
    ['• Status must be either: Active or Archived'],
    ['• Portal Access must be either: Enabled or Disabled'],
    ['• Email, Reg/ID Number, and Tax PIN must be unique across all landlords'],
    ['• Delete these instruction rows before uploading'],
    ['• Maximum 1000 landlords per import']
  ]);

  instructionsSheet['!cols'] = [
    { wch: 80 }, { wch: 20 }, { wch: 20 }, { wch: 20 }, { wch: 30 }, { wch: 18 }, { wch: 30 }, { wch: 20 }, { wch: 12 }, { wch: 15 }
  ];

  // Sheet 3: Dropdown Values Reference
  const dropdownSheet = XLSX.utils.aoa_to_sheet([
    ['VALID VALUES FOR DROPDOWNS'],
    [''],
    ['Landlord Type Options:'],
    ['Individual'],
    ['Company'],
    ['Partnership'],
    ['Trust'],
    [''],
    ['Status Options:'],
    ['Active'],
    ['Archived'],
    [''],
    ['Portal Access Options:'],
    ['Enabled'],
    ['Disabled'],
    [''],
    ['TIPS:'],
    ['• Copy and paste these values into your Data sheet'],
    ['• Values are case-sensitive'],
    ['• Use exact spelling as shown']
  ]);

  dropdownSheet['!cols'] = [{ wch: 50 }];

  // Create workbook
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, dataSheet, 'Data');
  XLSX.utils.book_append_sheet(workbook, instructionsSheet, 'Instructions & Examples');
  XLSX.utils.book_append_sheet(workbook, dropdownSheet, 'Valid Values');

  // Generate Excel file
  const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  
  return blob;
};

/**
 * Download landlords template
 */
export const downloadLandlordsTemplate = () => {
  const blob = generateLandlordsTemplate();
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `MILIK_Landlords_Import_Template_${new Date().toISOString().split('T')[0]}.xlsx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
};

/**
 * Parse uploaded landlords Excel file
 */
export const parseLandlordsExcel = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        
        // Read the Data sheet
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        
        // Convert to JSON
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { 
          raw: false, // Keep dates as strings
          defval: '' // Default value for empty cells
        });
        
        if (jsonData.length === 0) {
          reject(new Error('No data found in Excel file'));
          return;
        }
        
        // Map Excel columns to database fields
        const mappedData = jsonData.map((row, index) => {
          // Handle various possible header names (with or without *)
          const getName = (row) => {
            return row['Landlord Name *'] || row['Landlord Name'] || row['landlordName'] || '';
          };
          
          const getType = (row) => {
            return row['Landlord Type *'] || row['Landlord Type'] || row['landlordType'] || 'Individual';
          };
          
          const getRegId = (row) => {
            return row['Reg/ID Number *'] || row['Reg/ID Number'] || row['regId'] || '';
          };
          
          const getTaxPin = (row) => {
            return row['Tax PIN *'] || row['Tax PIN'] || row['taxPin'] || '';
          };
          
          const getEmail = (row) => {
            return row['Email *'] || row['Email'] || row['email'] || '';
          };
          
          const getPhone = (row) => {
            return row['Phone Number *'] || row['Phone Number'] || row['phoneNumber'] || '';
          };
          
          const getAddress = (row) => {
            return row['Postal Address'] || row['postalAddress'] || '';
          };
          
          const getLocation = (row) => {
            return row['Location'] || row['location'] || '';
          };
          
          const getStatus = (row) => {
            return row['Status'] || row['status'] || 'Active';
          };
          
          const getPortalAccess = (row) => {
            return row['Portal Access'] || row['portalAccess'] || 'Disabled';
          };
          
          return {
            rowNumber: index + 2, // Excel row (1 is header)
            landlordName: getName(row).trim(),
            landlordType: getType(row).trim(),
            regId: getRegId(row).trim(),
            taxPin: getTaxPin(row).trim(),
            email: getEmail(row).trim().toLowerCase(),
            phoneNumber: getPhone(row).trim(),
            postalAddress: getAddress(row).trim(),
            location: getLocation(row).trim(),
            status: getStatus(row).trim(),
            portalAccess: getPortalAccess(row).trim()
          };
        });
        
        // Validate and categorize
        const validRecords = [];
        const errors = [];
        
        const validLandlordTypes = ['Individual', 'Company', 'Partnership', 'Trust'];
        const validStatuses = ['Active', 'Archived'];
        const validPortalAccess = ['Enabled', 'Disabled'];
        
        // Track duplicates within the file
        const seenEmails = new Set();
        const seenRegIds = new Set();
        const seenTaxPins = new Set();
        
        mappedData.forEach((record) => {
          const rowErrors = [];
          
          // Required field validations
          if (!record.landlordName) {
            rowErrors.push('Landlord Name is required');
          }
          if (!record.regId) {
            rowErrors.push('Reg/ID Number is required');
          }
          if (!record.taxPin) {
            rowErrors.push('Tax PIN is required');
          }
          if (!record.email) {
            rowErrors.push('Email is required');
          } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(record.email)) {
            rowErrors.push('Invalid email format');
          }
          if (!record.phoneNumber) {
            rowErrors.push('Phone Number is required');
          }
          
          // Enum validations
          if (record.landlordType && !validLandlordTypes.includes(record.landlordType)) {
            rowErrors.push(`Invalid Landlord Type. Must be one of: ${validLandlordTypes.join(', ')}`);
          }
          if (record.status && !validStatuses.includes(record.status)) {
            rowErrors.push(`Invalid Status. Must be one of: ${validStatuses.join(', ')}`);
          }
          if (record.portalAccess && !validPortalAccess.includes(record.portalAccess)) {
            rowErrors.push(`Invalid Portal Access. Must be one of: ${validPortalAccess.join(', ')}`);
          }
          
          // Check for duplicates within the file
          if (record.email) {
            if (seenEmails.has(record.email)) {
              rowErrors.push('Duplicate email within file');
            }
            seenEmails.add(record.email);
          }
          
          if (record.regId) {
            if (seenRegIds.has(record.regId)) {
              rowErrors.push('Duplicate Reg/ID Number within file');
            }
            seenRegIds.add(record.regId);
          }
          
          if (record.taxPin) {
            if (seenTaxPins.has(record.taxPin)) {
              rowErrors.push('Duplicate Tax PIN within file');
            }
            seenTaxPins.add(record.taxPin);
          }
          
          if (rowErrors.length > 0) {
            errors.push({
              row: record.rowNumber,
              errors: rowErrors,
              data: record
            });
          } else {
            validRecords.push(record);
          }
        });
        
        resolve({
          valid: validRecords,
          errors: errors,
          total: mappedData.length,
          validCount: validRecords.length,
          errorCount: errors.length
        });
        
      } catch (error) {
        reject(new Error(`Failed to parse Excel file: ${error.message}`));
      }
    };
    
    reader.onerror = () => {
      reject(new Error('Failed to read file'));
    };
    
    reader.readAsArrayBuffer(file);
  });
};

/**
 * Export current landlords to Excel
 */
export const exportLandlordsToExcel = (landlords) => {
  // Prepare data for export
  const exportData = landlords.map(landlord => ({
    'Landlord Code': landlord.landlordCode || landlord.code || '',
    'Landlord Name': landlord.landlordName || landlord.name || '',
    'Landlord Type': landlord.landlordType || 'Individual',
    'Reg/ID Number': landlord.regId || landlord.idNumber || '',
    'Tax PIN': landlord.taxPin || '',
    'Email': landlord.email || '',
    'Phone Number': landlord.phoneNumber || landlord.phone || '',
    'Postal Address': landlord.postalAddress || '',
    'Location': landlord.location || '',
    'Status': landlord.status || 'Active',
    'Portal Access': landlord.portalAccess || 'Disabled',
    'Active Properties': landlord.activeProperties || 0,
    'Created Date': landlord.createdAt ? new Date(landlord.createdAt).toLocaleDateString() : ''
  }));

  // Create worksheet
  const worksheet = XLSX.utils.json_to_sheet(exportData);
  
  // Set column widths
  worksheet['!cols'] = [
    { wch: 15 }, // Code
    { wch: 25 }, // Name
    { wch: 18 }, // Type
    { wch: 20 }, // Reg/ID
    { wch: 20 }, // Tax PIN
    { wch: 30 }, // Email
    { wch: 18 }, // Phone
    { wch: 30 }, // Address
    { wch: 20 }, // Location
    { wch: 12 }, // Status
    { wch: 15 }, // Portal
    { wch: 18 }, // Properties
    { wch: 15 }  // Created
  ];

  // Create workbook
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Landlords');

  // Generate Excel file
  const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  
  // Download
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `Landlords_Export_${new Date().toISOString().split('T')[0]}.xlsx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
};

// ============================================
// PROPERTIES EXCEL TEMPLATES
// ============================================

/**
 * Generate Excel template for Properties with instructions
 */
export const generatePropertiesTemplate = () => {
  // Sheet 1: Data Template (Headers only)
  const dataSheet = XLSX.utils.aoa_to_sheet([
    [
      'Property Name *',
      'Property Code',
      'LR Number *',
      'Property Type *',
      'Category',
      'Town/City *',
      'Estate/Area',
      'Road/Street',
      'Zone/Region',
      'Landlord Name *',
      'Total Units',
      'Status'
    ]
  ]);

  // Set column widths
  dataSheet['!cols'] = [
    { wch: 30 }, // Property Name
    { wch: 15 }, // Property Code
    { wch: 20 }, // LR Number
    { wch: 18 }, // Property Type
    { wch: 18 }, // Category
    { wch: 20 }, // Town/City
    { wch: 20 }, // Estate/Area
    { wch: 20 }, // Road/Street
    { wch: 20 }, // Zone/Region
    { wch: 25 }, // Landlord Name
    { wch: 12 }, // Total Units
    { wch: 12 }  // Status
  ];

  // Sheet 2: Instructions & Examples
  const instructionsSheet = XLSX.utils.aoa_to_sheet([
    ['PROPERTY IMPORT INSTRUCTIONS'],
    [''],
    ['REQUIRED FIELDS (marked with *)'],
    ['• Property Name: Full name of the property'],
    ['• LR Number: Land Registry Number (must be unique)'],
    ['• Property Type: Residential, Commercial, Mixed Use, Industrial, Agricultural, Special Purpose'],
    ['• Town/City: Town or city location'],
    ['• Landlord Name: Must match an existing landlord in the system'],
    [''],
    ['OPTIONAL FIELDS'],
    ['• Property Code: Unique code (e.g., PRO001, PRO002) - System auto-generates if not provided'],
    ['• Category: Property category (e.g., Apartment, House, Office)'],
    ['• Estate/Area: Estate or area name'],
    ['• Road/Street: Road or street name'],
    ['• Zone/Region: Zone or region'],
    ['• Total Units: Number of units (default: 0)'],
    ['• Status: active or archived (default: active)'],
    [''],
    ['EXAMPLE DATA (Copy to Data Sheet)'],
    [''],
    // Headers
    [
      'Property Name',
      'Property Code',
      'LR Number',
      'Property Type',
      'Category',
      'Town/City',
      'Estate/Area',
      'Road/Street',
      'Zone/Region',
      'Landlord Name',
      'Total Units',
      'Status'
    ],
    // Example 1
    [
      'Sunset Apartments',
      'PRO001',
      'LR/123/456',
      'Residential',
      'Apartment',
      'Nairobi',
      'Westlands',
      'Mpaka Road',
      'Central',
      'John Doe Properties Ltd',
      '24',
      'active'
    ],
    // Example 2 (No code - will be auto-generated)
    [
      'Green Valley Plaza',
      '',
      'LR/789/012',
      'Commercial',
      'Office',
      'Mombasa',
      'Nyali',
      'Links Road',
      'Coastal',
      'Mary Wanjiku',
      '12',
      'active'
    ],
    // Example 3
    [
      'Riverside Estate',
      'PRO003',
      'LR/345/678',
      'Mixed Use',
      'Complex',
      'Kisumu',
      'Milimani',
      'Oginga Odinga Road',
      'Western',
      'ABC Real Estate Partnership',
      '36',
      'active'
    ],
    [''],
    ['IMPORTANT NOTES'],
    ['• Do not modify the column headers in the Data sheet'],
    ['• All required fields marked with * must have values'],
    ['• Property Code is optional - if not provided, system generates automatically (PRO001, PRO002, etc.)'],
    ['• If you provide a Property Code, it must be unique and not already in the system'],
    ['• Property Code and LR Number must be unique'],
    ['• Property Type must match exactly: Residential, Commercial, Mixed Use, Industrial, Agricultural, or Special Purpose'],
    ['• Landlord Name must match an existing landlord in your system (first landlord will be set as primary)'],
    ['• Status must be either: active or archived (default: active if not specified)'],
    ['• Total Units is optional - you can add units later'],
    ['• Delete these instruction rows before uploading'],
    ['• Maximum 1000 properties per import']
  ]);

  instructionsSheet['!cols'] = [
    { wch: 80 }, { wch: 15 }, { wch: 20 }, { wch: 18 }, { wch: 18 }, { wch: 20 }, { wch: 20 }, { wch: 20 }, { wch: 20 }, { wch: 25 }, { wch: 12 }, { wch: 12 }
  ];

  // Sheet 3: Dropdown Values Reference
  const dropdownSheet = XLSX.utils.aoa_to_sheet([
    ['VALID VALUES FOR DROPDOWNS'],
    [''],
    ['Property Type Options:'],
    ['Residential'],
    ['Commercial'],
    ['Mixed Use'],
    ['Industrial'],
    ['Agricultural'],
    ['Special Purpose'],
    [''],
    ['Status Options:'],
    ['active'],
    ['archived'],
    [''],
    ['TIPS:'],
    ['• Copy and paste these values into your Data sheet'],
    ['• Values are case-sensitive for Property Type'],
    ['• Status values are lowercase'],
    ['• Use exact spelling as shown'],
    ['• Landlord Name must match exactly with existing landlords in your system']
  ]);

  dropdownSheet['!cols'] = [{ wch: 50 }];

  // Create workbook
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, dataSheet, 'Data');
  XLSX.utils.book_append_sheet(workbook, instructionsSheet, 'Instructions & Examples');
  XLSX.utils.book_append_sheet(workbook, dropdownSheet, 'Valid Values');

  // Generate Excel file
  const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  
  return blob;
};

/**
 * Download properties template
 */
export const downloadPropertiesTemplate = () => {
  const blob = generatePropertiesTemplate();
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `MILIK_Properties_Import_Template_${new Date().toISOString().split('T')[0]}.xlsx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
};

/**
 * Parse uploaded properties Excel file
 */
export const parsePropertiesExcel = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        
        // Read the Data sheet
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        
        // Convert to JSON
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { 
          raw: false,
          defval: ''
        });
        
        if (jsonData.length === 0) {
          reject(new Error('No data found in Excel file'));
          return;
        }
        
        // Map Excel columns to database fields
        const mappedData = jsonData.map((row, index) => {
          const getName = (row) => row['Property Name *'] || row['Property Name'] || row['propertyName'] || '';
          const getCode = (row) => row['Property Code'] || row['propertyCode'] || ''; // Optional
          const getLR = (row) => row['LR Number *'] || row['LR Number'] || row['lrNumber'] || '';
          const getType = (row) => row['Property Type *'] || row['Property Type'] || row['propertyType'] || 'Residential';
          const getCategory = (row) => row['Category'] || row['category'] || '';
          const getTown = (row) => row['Town/City *'] || row['Town/City'] || row['townCityState'] || '';
          const getEstate = (row) => row['Estate/Area'] || row['estateArea'] || '';
          const getRoad = (row) => row['Road/Street'] || row['roadStreet'] || '';
          const getZone = (row) => row['Zone/Region'] || row['zoneRegion'] || '';
          const getLandlord = (row) => row['Landlord Name *'] || row['Landlord Name'] || row['landlordName'] || '';
          const getUnits = (row) => {
            const val = row['Total Units'] || row['totalUnits'] || '0';
            const num = parseInt(val);
            return isNaN(num) ? 0 : num;
          };
          const getStatus = (row) => row['Status'] || row['status'] || 'active';
          
          return {
            rowNumber: index + 2,
            propertyName: getName(row).trim(),
            propertyCode: getCode(row).trim(), // Can be empty - system will auto-generate
            lrNumber: getLR(row).trim(),
            propertyType: getType(row).trim(),
            category: getCategory(row).trim(),
            townCityState: getTown(row).trim(),
            estateArea: getEstate(row).trim(),
            roadStreet: getRoad(row).trim(),
            zoneRegion: getZone(row).trim(),
            landlordName: getLandlord(row).trim(),
            totalUnits: getUnits(row),
            status: getStatus(row).trim().toLowerCase()
          };
        });
        
        // Validate and categorize
        const validRecords = [];
        const errors = [];
        
        const validPropertyTypes = ['Residential', 'Commercial', 'Mixed Use', 'Industrial', 'Agricultural', 'Special Purpose'];
        const validStatuses = ['active', 'archived'];
        
        // Track duplicates within the file
        const seenCodes = new Set();
        const seenLRNumbers = new Set();
        
        mappedData.forEach((record) => {
          const rowErrors = [];
          
          // Required field validations (Code is NOT required)
          if (!record.propertyName) {
            rowErrors.push('Property Name is required');
          }
          if (!record.lrNumber) {
            rowErrors.push('LR Number is required');
          }
          if (!record.townCityState) {
            rowErrors.push('Town/City is required');
          }
          if (!record.landlordName) {
            rowErrors.push('Landlord Name is required');
          }
          
          // Enum validations
          if (record.propertyType && !validPropertyTypes.includes(record.propertyType)) {
            rowErrors.push(`Invalid Property Type. Must be one of: ${validPropertyTypes.join(', ')}`);
          }
          if (record.status && !validStatuses.includes(record.status)) {
            rowErrors.push(`Invalid Status. Must be one of: ${validStatuses.join(', ')}`);
          }
          
          // Check for duplicates within the file (only if code is provided)
          if (record.propertyCode) {
            if (seenCodes.has(record.propertyCode)) {
              rowErrors.push('Duplicate Property Code within file');
            }
            seenCodes.add(record.propertyCode);
          }
          
          if (record.lrNumber) {
            if (seenLRNumbers.has(record.lrNumber)) {
              rowErrors.push('Duplicate LR Number within file');
            }
            seenLRNumbers.add(record.lrNumber);
          }
          
          if (rowErrors.length > 0) {
            errors.push({
              row: record.rowNumber,
              errors: rowErrors,
              data: record
            });
          } else {
            validRecords.push(record);
          }
        });
        
        resolve({
          valid: validRecords,
          errors: errors,
          total: mappedData.length,
          validCount: validRecords.length,
          errorCount: errors.length
        });
        
      } catch (error) {
        reject(new Error(`Failed to parse Excel file: ${error.message}`));
      }
    };
    
    reader.onerror = () => {
      reject(new Error('Failed to read file'));
    };
    
    reader.readAsArrayBuffer(file);
  });
};

/**
 * Export current properties to Excel
 */
export const exportPropertiesToExcel = (properties) => {
  // Prepare data for export
  const exportData = properties.map(property => ({
    'Property Code': property.propertyCode || '',
    'Property Name': property.propertyName || property.name || '',
    'LR Number': property.lrNumber || '',
    'Property Type': property.propertyType || '',
    'Category': property.category || '',
    'Town/City': property.townCityState || '',
    'Estate/Area': property.estateArea || '',
    'Road/Street': property.roadStreet || '',
    'Zone/Region': property.zoneRegion || '',
    'Landlord': property.landlords?.[0]?.name || '',
    'Total Units': property.totalUnits || 0,
    'Occupied Units': property.occupiedUnits || 0,
    'Vacant Units': property.vacantUnits || 0,
    'Status': property.status || 'active',
    'Created Date': property.createdAt ? new Date(property.createdAt).toLocaleDateString() : ''
  }));

  // Create worksheet
  const worksheet = XLSX.utils.json_to_sheet(exportData);
  
  // Set column widths
  worksheet['!cols'] = [
    { wch: 15 }, // Code
    { wch: 30 }, // Name
    { wch: 20 }, // LR Number
    { wch: 18 }, // Type
    { wch: 18 }, // Category
    { wch: 20 }, // Town/City
    { wch: 20 }, // Estate/Area
    { wch: 20 }, // Road/Street
    { wch: 20 }, // Zone/Region
    { wch: 25 }, // Landlord
    { wch: 12 }, // Total Units
    { wch: 15 }, // Occupied
    { wch: 12 }, // Vacant
    { wch: 12 }, // Status
    { wch: 15 }  // Created
  ];

  // Create workbook
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Properties');

  // Generate Excel file
  const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  
  // Download
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `Properties_Export_${new Date().toISOString().split('T')[0]}.xlsx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
};

// ============================================
// UNITS EXCEL TEMPLATES
// ============================================

/**
 * Generate Excel template for Units with instructions
 * @param {Array} properties - Optional array of property objects with propertyCode and propertyName
 */
export const generateUnitsTemplate = (properties = []) => {
  // Sheet 1: Data Template (Headers only)
  const dataSheet = XLSX.utils.aoa_to_sheet([
    [
      'Unit Number *',
      'Property Code *',
      'Unit Type *',
      'Rent *',
      'Deposit *',
      'Amenities',
      'Utilities Included',
      'Status',
      'Description'
    ]
  ]);

  // Set column widths
  dataSheet['!cols'] = [
    { wch: 20 }, // Unit Number
    { wch: 15 }, // Property Code
    { wch: 18 }, // Unit Type
    { wch: 15 }, // Rent
    { wch: 15 }, // Deposit
    { wch: 40 }, // Amenities
    { wch: 25 }, // Utilities Included
    { wch: 15 }, // Status
    { wch: 40 }  // Description
  ];

  // Sheet 2: Instructions & Examples
  const instructionsSheet = XLSX.utils.aoa_to_sheet([
    ['UNIT IMPORT INSTRUCTIONS'],
    [''],
    ['REQUIRED FIELDS (marked with *)'],
    ['• Unit Number: Unique identifier for the unit (e.g., A1, 101, UNIT-001)'],
    ['• Property Code: Must match an existing property code in the system (e.g., PRO001, PRO002)'],
    ['• Unit Type: studio, 1bed, 2bed, 3bed, 4bed, or commercial'],
    ['• Rent: Monthly rent in Kenyan Shillings (KES)'],
    ['• Deposit: Security deposit amount in KES'],
    [''],
    ['OPTIONAL FIELDS'],
    ['• Amenities: Comma-separated list (e.g., WiFi, AC, Parking, Garden)'],
    ['• Utilities Included: Comma-separated utilities (e.g., Water, Electricity, Garbage)'],
    ['• Status: vacant, occupied, maintenance, reserved, or archived (default: vacant)'],
    ['• Description: Additional notes about the unit'],
    [''],
    ['EXAMPLE DATA (Copy to Data Sheet)'],
    [''],
    // Headers
    [
      'Unit Number',
      'Property Code',
      'Unit Type',
      'Rent',
      'Deposit',
      'Amenities',
      'Utilities Included',
      'Status',
      'Description'
    ],
    // Example 1
    [
      'A1',
      'PRO001',
      '2bed',
      '35000',
      '70000',
      'WiFi, AC, Parking',
      'Water, Garbage',
      'vacant',
      'Ground floor, modern finishes'
    ],
    // Example 2
    [
      '201',
      'PRO002',
      '1bed',
      '25000',
      '50000',
      'Gym, Pool',
      'Water',
      'occupied',
      'Second floor, city view'
    ],
    // Example 3
    [
      'COMM-01',
      'PRO003',
      'commercial',
      '45000',
      '90000',
      'Parking, Security',
      'Electricity, Water',
      'vacant',
      'Ground floor retail space'
    ],
    // Example 4
    [
      'B3',
      'PRO001',
      'studio',
      '15000',
      '30000',
      '',
      '',
      'maintenance',
      'Under renovation'
    ],
    [''],
    ['IMPORTANT NOTES'],
    ['• Do not modify the column headers in the Data sheet'],
    ['• All required fields marked with * must have values'],
    ['• Unit Number must be unique within the same property'],
    ['• Property Code must match exactly with existing property codes in your system'],
    ['• Unit Type must be one of: studio, 1bed, 2bed, 3bed, 4bed, commercial (case-sensitive)'],
    ['• Rent and Deposit must be numeric values (numbers only, no currency symbols)'],
    ['• Status must be one of: vacant, occupied, maintenance, reserved, archived (lowercase)'],
    ['• Amenities and Utilities Included are optional - separate multiple items with commas'],
    ['• Delete these instruction rows before uploading'],
    ['• Maximum 1000 units per import']
  ]);

  instructionsSheet['!cols'] = [
    { wch: 80 }, { wch: 15 }, { wch: 18 }, { wch: 15 }, { wch: 15 }, { wch: 40 }, { wch: 25 }, { wch: 15 }, { wch: 40 }
  ];

  // Sheet 3: Dropdown Values Reference
  const dropdownData = [
    ['VALID VALUES FOR DROPDOWNS'],
    [''],
    ['Unit Type Options:'],
    ['studio'],
    ['1bed'],
    ['2bed'],
    ['3bed'],
    ['4bed'],
    ['commercial'],
    [''],
    ['Status Options:'],
    ['vacant'],
    ['occupied'],
    ['maintenance'],
    ['reserved'],
    ['archived'],
  ];

  // Add Property Codes section if properties are provided
  if (properties && properties.length > 0) {
    dropdownData.push(['']);
    dropdownData.push(['AVAILABLE PROPERTY CODES (Copy-Paste to Data Sheet):']);
    properties.forEach(prop => {
      dropdownData.push([`${prop.propertyCode} (${prop.propertyName})`]);
    });
  }

  dropdownData.push(['']);
  dropdownData.push(['TIPS:']);
  dropdownData.push(['• Copy and paste these values into your Data sheet']);
  dropdownData.push(['• All values are case-sensitive']);
  dropdownData.push(['• Property Code must match EXACTLY with the codes listed above']);
  dropdownData.push(['• Each unit must belong to an existing property']);
  dropdownData.push(['• Use exact spelling as shown - no spaces before/after']);

  const dropdownSheet = XLSX.utils.aoa_to_sheet(dropdownData);
  dropdownSheet['!cols'] = [{ wch: 60 }];

  // Create workbook
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, dataSheet, 'Data');
  XLSX.utils.book_append_sheet(workbook, instructionsSheet, 'Instructions & Examples');
  XLSX.utils.book_append_sheet(workbook, dropdownSheet, 'Valid Values');

  // Generate Excel file
  const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  
  return blob;
};

/**
 * Download units template
 * @param {Array} properties - Optional array of property objects with propertyCode and propertyName
 */
export const downloadUnitsTemplate = (properties = []) => {
  const blob = generateUnitsTemplate(properties);
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `MILIK_Units_Import_Template_${new Date().toISOString().split('T')[0]}.xlsx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
};

/**
 * Parse uploaded units Excel file
 */
export const parseUnitsExcel = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        
        // Read the Data sheet
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        
        // Convert to JSON
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { 
          raw: false,
          defval: ''
        });
        
        if (jsonData.length === 0) {
          reject(new Error('No data found in Excel file'));
          return;
        }
        
        // Map Excel columns to database fields
        const mappedData = jsonData.map((row, index) => {
          const getUnitNumber = (row) => row['Unit Number *'] || row['Unit Number'] || row['unitNumber'] || '';
          const getPropertyCode = (row) => row['Property Code *'] || row['Property Code'] || row['propertyCode'] || '';
          const getUnitType = (row) => row['Unit Type *'] || row['Unit Type'] || row['unitType'] || 'studio';
          const getRent = (row) => {
            const val = row['Rent *'] || row['Rent'] || row['rent'] || '0';
            const num = parseFloat(val);
            return isNaN(num) ? 0 : num;
          };
          const getDeposit = (row) => {
            const val = row['Deposit *'] || row['Deposit'] || row['deposit'] || '0';
            const num = parseFloat(val);
            return isNaN(num) ? 0 : num;
          };
          const getAmenities = (row) => {
            const val = row['Amenities'] || row['amenities'] || '';
            return val.split(',').map(a => a.trim()).filter(a => a);
          };
          const getUtilities = (row) => {
            const val = row['Utilities Included'] || row['utilities'] || '';
            return val.split(',').map(u => u.trim()).filter(u => u);
          };
          const getStatus = (row) => row['Status'] || row['status'] || 'vacant';
          const getDescription = (row) => row['Description'] || row['description'] || '';
          
          return {
            rowNumber: index + 2,
            unitNumber: getUnitNumber(row).trim(),
            propertyCode: getPropertyCode(row).trim(),
            unitType: getUnitType(row).trim().toLowerCase(),
            rent: getRent(row),
            deposit: getDeposit(row),
            amenities: getAmenities(row),
            utilities: getUtilities(row),
            status: getStatus(row).trim().toLowerCase(),
            description: getDescription(row).trim()
          };
        });
        
        // Validate and categorize
        const validRecords = [];
        const errors = [];
        
        const validUnitTypes = ['studio', '1bed', '2bed', '3bed', '4bed', 'commercial'];
        const validStatuses = ['vacant', 'occupied', 'maintenance', 'reserved', 'archived'];
        
        // Track duplicates within the file
        const seenUnits = new Set();
        
        mappedData.forEach((record) => {
          const rowErrors = [];
          
          // Required field validations
          if (!record.unitNumber) {
            rowErrors.push('Unit Number is required');
          }
          if (!record.propertyCode) {
            rowErrors.push('Property Code is required');
          }
          if (record.rent <= 0) {
            rowErrors.push('Rent must be greater than 0');
          }
          if (record.deposit < 0) {
            rowErrors.push('Deposit cannot be negative');
          }
          
          // Enum validations
          if (record.unitType && !validUnitTypes.includes(record.unitType)) {
            rowErrors.push(`Invalid Unit Type. Must be one of: ${validUnitTypes.join(', ')}`);
          }
          if (record.status && !validStatuses.includes(record.status)) {
            rowErrors.push(`Invalid Status. Must be one of: ${validStatuses.join(', ')}`);
          }
          
          // Check for duplicates within the file (per property)
          const unitKey = `${record.propertyCode}-${record.unitNumber}`;
          if (seenUnits.has(unitKey)) {
            rowErrors.push(`Duplicate Unit Number within same property`);
          }
          seenUnits.add(unitKey);
          
          if (rowErrors.length > 0) {
            errors.push({
              row: record.rowNumber,
              errors: rowErrors,
              data: record
            });
          } else {
            validRecords.push(record);
          }
        });
        
        resolve({
          valid: validRecords,
          errors: errors,
          total: mappedData.length,
          validCount: validRecords.length,
          errorCount: errors.length
        });
        
      } catch (error) {
        reject(new Error(`Failed to parse Excel file: ${error.message}`));
      }
    };
    
    reader.onerror = () => {
      reject(new Error('Failed to read file'));
    };
    
    reader.readAsArrayBuffer(file);
  });
};

/**
 * Export current units to Excel
 */
export const exportUnitsToExcel = (units) => {
  // Prepare data for export
  const exportData = units.map(unit => ({
    'Unit Number': unit.unitNumber || '',
    'Property Code': unit.property?.propertyCode || unit.propertyCode || '',
    'Unit Type': unit.unitType || '',
    'Rent (KES)': unit.rent || 0,
    'Deposit (KES)': unit.deposit || 0,
    'Status': unit.status || 'vacant',
    'Tenant': unit.currentTenant?.name || unit.tenant?.name || unit.tenantName || '-',
    'Amenities': unit.amenities?.join(', ') || '',
    'Description': unit.description || '',
    'Created Date': unit.createdAt ? new Date(unit.createdAt).toLocaleDateString() : ''
  }));

  // Create worksheet
  const worksheet = XLSX.utils.json_to_sheet(exportData);
  
  // Set column widths
  worksheet['!cols'] = [
    { wch: 15 }, // Number
    { wch: 25 }, // Property
    { wch: 15 }, // Type
    { wch: 15 }, // Rent
    { wch: 15 }, // Deposit
    { wch: 15 }, // Status
    { wch: 20 }, // Tenant
    { wch: 30 }, // Amenities
    { wch: 40 }, // Description
    { wch: 15 }  // Created
  ];

  // Create workbook
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Units');

  // Generate Excel file
  const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  
  // Download
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `Units_Export_${new Date().toISOString().split('T')[0]}.xlsx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
};

// ============================================
// TENANTS EXCEL TEMPLATES
// ============================================

/**
 * Generate Excel template for Tenants with instructions
 * @param {Array} units - Optional array of unit objects with unitNumber and property info
 */
export const generateTenantsTemplate = (units = []) => {
  // Sheet 1: Data Template (Headers only)
  const dataSheet = XLSX.utils.aoa_to_sheet([
    [
      'Tenant Name *',
      'Phone Number *',
      'ID Number *',
      'Property Code *',
      'Unit Number *',
      'Rent *',
      'Move-in Date *',
      'Lease Type',
      'Payment Method *',
      'Emergency Contact Name',
      'Emergency Contact Phone',
      'Status',
      'Move-out Date',
      'Notes'
    ]
  ]);

  // Set column widths
  dataSheet['!cols'] = [
    { wch: 25 }, // Tenant Name
    { wch: 18 }, // Phone Number
    { wch: 18 }, // ID Number
    { wch: 18 }, // Property Code
    { wch: 20 }, // Unit Number
    { wch: 15 }, // Rent
    { wch: 18 }, // Move-in Date
    { wch: 14 }, // Lease Type
    { wch: 18 }, // Payment Method
    { wch: 25 }, // Emergency Contact Name
    { wch: 18 }, // Emergency Contact Phone
    { wch: 15 }, // Status
    { wch: 18 }, // Move-out Date
    { wch: 30 }  // Notes
  ];

  // Sheet 2: Instructions & Examples
  const instructionsSheet = XLSX.utils.aoa_to_sheet([
    ['TENANT IMPORT INSTRUCTIONS'],
    [''],
    ['REQUIRED FIELDS (marked with *)'],
    ['• Tenant Name: Full name of the tenant'],
    ['• Phone Number: Contact phone number (must be unique)'],
    ['• ID Number: National ID or Passport number (must be unique)'],
    ['• Property Code: Must match an existing property code in the system (e.g., PRO001)'],
    ['• Unit Number: Must match an existing unit in the selected property'],
    ['• Rent: Monthly rent amount in Kenyan Shillings (KES)'],
    ['• Move-in Date: Date tenant moved in (format: MM/DD/YYYY)'],
    ['• Lease Type: at_will or fixed (default: at_will). If fixed, Move-out Date is required'],
    ['• Payment Method: How tenant pays rent (bank_transfer, mobile_money, cash, check, or credit_card)'],
    [''],
    ['OPTIONAL FIELDS'],
    ['• Emergency Contact Name: Name of emergency contact person'],
    ['• Emergency Contact Phone: Phone number of emergency contact'],
    ['• Status: active, inactive, overdue, evicted, or moved_out (default: active)'],
    ['• Move-out Date: Date tenant moved out (format: MM/DD/YYYY)'],
    ['• Notes: Additional information about the tenant'],
    [''],
    ['EXAMPLE DATA (Copy to Data Sheet)'],
    [''],
    // Headers
    [
      'Tenant Name',
      'Phone Number',
      'ID Number',
      'Property Code',
      'Unit Number',
      'Rent',
      'Move-in Date',
      'Lease Type',
      'Payment Method',
      'Emergency Contact Name',
      'Emergency Contact Phone',
      'Status',
      'Move-out Date',
      'Notes'
    ],
    // Example 1
    [
      'John Mwangi',
      '+254701234567',
      '12345678',
      'PRO001',
      'A1',
      '35000',
      '01/15/2023',
      'at_will',
      'mobile_money',
      'Jane Mwangi',
      '+254701234568',
      'active',
      '',
      'Excellent tenant, on-time payments'
    ],
    // Example 2
    [
      'Sarah Kipchoge',
      '+254722345678',
      '87654321',
      'PRO002',
      '201',
      '25000',
      '03/20/2023',
      'fixed',
      'bank_transfer',
      'David Kipchoge',
      '+254722345679',
      'active',
      '03/19/2024',
      'One-year fixed lease'
    ],
    // Example 3
    [
      'Michael Okonkwo',
      '+254733456789',
      '11223344',
      'PRO003',
      'B3',
      '15000',
      '06/10/2023',
      'at_will',
      'cash',
      'Mary Okonkwo',
      '+254733456790',
      'active',
      '',
      'Student, pays by cash monthly'
    ],
    [''],
    ['IMPORTANT NOTES'],
    ['• Do not modify the column headers in the Data sheet'],
    ['• All required fields marked with * must have values'],
    ['• Phone numbers must be unique within the system'],
    ['• ID numbers must be unique within the system'],
    ['• Property Code must match existing properties in your system'],
    ['• Unit Number must belong to the selected Property Code'],
    ['• Move-in Date must be a valid date (MM/DD/YYYY format)'],
    ['• Lease Type must be one of: at_will, fixed'],
    ['• If Lease Type is fixed, Move-out Date is required and must be after Move-in Date'],
    ['• Payment Method must be one of: bank_transfer, mobile_money, cash, check, credit_card'],
    ['• Status must be one of: active, inactive, overdue, evicted, moved_out (lowercase)'],
    ['• Rent must be a numeric value greater than 0'],
    ['• Delete these instruction rows before uploading'],
    ['• Maximum 1000 tenants per import']
  ]);

  instructionsSheet['!cols'] = [
    { wch: 80 }, { wch: 15 }, { wch: 18 }, { wch: 18 }, { wch: 20 }, { wch: 15 }, { wch: 18 }, { wch: 14 }, { wch: 18 }, { wch: 25 }, { wch: 18 }, { wch: 15 }, { wch: 18 }, { wch: 30 }
  ];

  // Sheet 3: Dropdown Values Reference
  const dropdownData = [
    ['VALID VALUES FOR DROPDOWNS'],
    [''],
    ['Payment Method Options:'],
    ['bank_transfer'],
    ['mobile_money'],
    ['cash'],
    ['check'],
    ['credit_card'],
    [''],
    ['Lease Type Options:'],
    ['at_will'],
    ['fixed'],
    [''],
    ['Status Options:'],
    ['active'],
    ['inactive'],
    ['overdue'],
    ['evicted'],
    ['moved_out'],
  ];

  // Add Property + Units section if units are provided
  if (units && units.length > 0) {
    dropdownData.push(['']);
    dropdownData.push(['AVAILABLE PROPERTY CODE + UNIT COMBINATIONS:']);
    dropdownData.push(['(Use both Property Code and Unit Number exactly as shown)']);
    const groupedByProperty = {};
    units.forEach(unit => {
      const propertyCode = unit.property?.propertyCode || 'UNKNOWN';
      const propName = unit.property?.propertyName || 'Unknown Property';
      const groupKey = `${propertyCode} - ${propName}`;
      if (!groupedByProperty[groupKey]) {
        groupedByProperty[groupKey] = [];
      }
      groupedByProperty[groupKey].push({
        propertyCode,
        unitNumber: unit.unitNumber
      });
    });
    
    Object.keys(groupedByProperty).forEach(groupKey => {
      dropdownData.push([`\n${groupKey}:`]);
      groupedByProperty[groupKey].forEach(({ propertyCode, unitNumber }) => {
        dropdownData.push([`  ${propertyCode} | ${unitNumber}`]);
      });
    });
  }

  dropdownData.push(['']);
  dropdownData.push(['TIPS:']);
  dropdownData.push(['• Copy and paste these values into your Data sheet']);
  dropdownData.push(['• All values are case-sensitive']);
  dropdownData.push(['• Property Code and Unit Number must both match EXACTLY']);
  dropdownData.push(['• Payment Method must be lowercase']);
  dropdownData.push(['• Each tenant must be assigned to an existing unit']);

  const dropdownSheet = XLSX.utils.aoa_to_sheet(dropdownData);
  dropdownSheet['!cols'] = [{ wch: 60 }];

  // Create workbook
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, dataSheet, 'Data');
  XLSX.utils.book_append_sheet(workbook, instructionsSheet, 'Instructions & Examples');
  XLSX.utils.book_append_sheet(workbook, dropdownSheet, 'Valid Values');

  // Generate Excel file
  const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  
  return blob;
};

/**
 * Download tenants template
 * @param {Array} units - Optional array of unit objects
 */
export const downloadTenantsTemplate = (units = []) => {
  const blob = generateTenantsTemplate(units);
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `MILIK_Tenants_Import_Template_${new Date().toISOString().split('T')[0]}.xlsx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
};

/**
 * Parse uploaded tenants Excel file
 */
export const parseTenantsExcel = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        
        // Read the Data sheet
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        
        // Convert to JSON
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { 
          raw: false,
          defval: ''
        });
        
        if (jsonData.length === 0) {
          reject(new Error('No data found in Excel file'));
          return;
        }
        
        // Normalize headers to support starred headers and minor header variations.
        const normalizeKey = (key = '') =>
          String(key)
            .replace(/\u00A0/g, ' ')
            .trim()
            .toLowerCase()
            .replace(/\*/g, '')
            .replace(/[\s_\-\/]+/g, '');

        const toStringValue = (value) => {
          if (value === null || value === undefined) return '';
          return String(value).trim();
        };

        const getRowValue = (row, aliases = []) => {
          const normalizedRow = {};
          Object.keys(row || {}).forEach((key) => {
            normalizedRow[normalizeKey(key)] = row[key];
          });

          for (const alias of aliases) {
            const match = normalizedRow[normalizeKey(alias)];
            if (match !== undefined && match !== null && String(match).trim() !== '') {
              return toStringValue(match);
            }
          }
          return '';
        };

        const safeIsoDate = (value) => {
          if (!value) return '';
          const parsed = new Date(value);
          if (Number.isNaN(parsed.getTime())) return '';
          return parsed.toISOString();
        };

        // Map Excel columns to database fields
        const mappedData = jsonData.map((row, index) => {
          const tenantName = getRowValue(row, ['Tenant Name *', 'Tenant Name', 'tenantName']);
          const phoneNumber = getRowValue(row, ['Phone Number *', 'Phone Number', 'phoneNumber']);
          const idNumber = getRowValue(row, ['ID Number *', 'ID Number', 'idNumber']);
          const propertyCode = getRowValue(row, ['Property Code *', 'Property Code', 'propertyCode']).toUpperCase();
          const unitNumber = getRowValue(row, ['Unit Number *', 'Unit Number', 'unitNumber']);
          const rentRaw = getRowValue(row, ['Rent *', 'Rent', 'rent']);
          const moveInDateRaw = getRowValue(row, ['Move-in Date *', 'Move-in Date', 'Move In Date', 'moveInDate']);
          const leaseType =
            getRowValue(row, ['Lease Type', 'Lease Type *', 'leaseType']).toLowerCase() ||
            'at_will';
          const paymentMethod =
            getRowValue(row, ['Payment Method *', 'Payment Method', 'paymentMethod']).toLowerCase() ||
            'bank_transfer';
          const emergencyContactName = getRowValue(row, [
            'Emergency Contact Name',
            'emergencyContactName',
          ]);
          const emergencyContactPhone = getRowValue(row, [
            'Emergency Contact Phone',
            'Emergency Contact Ph',
            'emergencyContactPhone',
          ]);
          const status = getRowValue(row, ['Status', 'status']).toLowerCase() || 'active';
          const moveOutDateRaw = getRowValue(row, ['Move-out Date', 'Move Out Date', 'moveOutDate']);
          const description = getRowValue(row, ['Notes', 'Description', 'description']);

          return {
            tenantName,
            phoneNumber,
            idNumber,
            propertyCode,
            unitNumber,
            rent: rentRaw ? parseFloat(rentRaw) : 0,
            moveInDate: safeIsoDate(moveInDateRaw),
            leaseType,
            paymentMethod,
            emergencyContactName,
            emergencyContactPhone,
            status,
            moveOutDate: safeIsoDate(moveOutDateRaw) || null,
            description,
            rowNumber: index + 2 // Excel row numbers start at 2 (after header)
          };
        });
        
        // Validate and categorize
        const validRecords = [];
        const errors = [];
        
        const validPaymentMethods = ['bank_transfer', 'mobile_money', 'cash', 'check', 'credit_card'];
        const validLeaseTypes = ['at_will', 'fixed'];
        const validStatuses = ['active', 'inactive', 'overdue', 'evicted', 'moved_out'];
        
        // Track duplicates within the file
        const seenPhones = new Set();
        const seenIds = new Set();
        
        mappedData.forEach((record) => {
          const rowErrors = [];
          
          // Required field validations
          if (!record.tenantName) {
            rowErrors.push('Tenant Name is required');
          }
          if (!record.phoneNumber) {
            rowErrors.push('Phone Number is required');
          }
          if (!record.idNumber) {
            rowErrors.push('ID Number is required');
          }
          if (!record.propertyCode) {
            rowErrors.push('Property Code is required');
          }
          if (!record.unitNumber) {
            rowErrors.push('Unit Number is required');
          }
          if (record.rent <= 0) {
            rowErrors.push('Rent must be greater than 0');
          }
          if (!record.moveInDate) {
            rowErrors.push('Move-in Date is required and must be valid');
          }
          if (!record.paymentMethod) {
            rowErrors.push('Payment Method is required');
          }

          if (!record.leaseType) {
            rowErrors.push('Lease Type is required');
          }
          
          // Enum validations
          if (record.leaseType && !validLeaseTypes.includes(record.leaseType)) {
            rowErrors.push(`Invalid Lease Type. Must be one of: ${validLeaseTypes.join(', ')}`);
          }
          if (record.paymentMethod && !validPaymentMethods.includes(record.paymentMethod)) {
            rowErrors.push(`Invalid Payment Method. Must be one of: ${validPaymentMethods.join(', ')}`);
          }
          if (record.status && !validStatuses.includes(record.status)) {
            rowErrors.push(`Invalid Status. Must be one of: ${validStatuses.join(', ')}`);
          }

          // Fixed leases require a valid move-out date after move-in date
          if (record.leaseType === 'fixed') {
            if (!record.moveOutDate) {
              rowErrors.push('Move-out Date is required when Lease Type is fixed');
            } else if (record.moveInDate) {
              const moveInDate = new Date(record.moveInDate);
              const moveOutDate = new Date(record.moveOutDate);
              if (!Number.isNaN(moveInDate.getTime()) && !Number.isNaN(moveOutDate.getTime()) && moveOutDate <= moveInDate) {
                rowErrors.push('Move-out Date must be after Move-in Date for fixed leases');
              }
            }
          }
          
          // Check for duplicates within the file
          if (seenPhones.has(record.phoneNumber)) {
            rowErrors.push('Duplicate Phone Number within file');
          }
          seenPhones.add(record.phoneNumber);
          
          if (seenIds.has(record.idNumber)) {
            rowErrors.push('Duplicate ID Number within file');
          }
          seenIds.add(record.idNumber);
          
          if (rowErrors.length > 0) {
            errors.push({
              row: record.rowNumber,
              tenantName: record.tenantName,
              errors: rowErrors,
              data: record
            });
          } else {
            validRecords.push(record);
          }
        });
        
        resolve({
          valid: validRecords,
          errors: errors,
          total: mappedData.length,
          validCount: validRecords.length,
          errorCount: errors.length
        });
        
      } catch (error) {
        reject(new Error(`Failed to parse Excel file: ${error.message}`));
      }
    };
    
    reader.onerror = () => {
      reject(new Error('Failed to read file'));
    };
    
    reader.readAsArrayBuffer(file);
  });
};

/**
 * Export current tenants to Excel
 */
export const exportTenantsToExcel = (tenants) => {
  // Prepare data for export
  const exportData = tenants.map(tenant => ({
    'Tenant Name': tenant.name || '',
    'Phone Number': tenant.phone || '',
    'ID Number': tenant.idNumber || '',
    'Property Code': tenant.unit?.property?.propertyCode || tenant.propertyCode || '',
    'Unit Number': tenant.unit?.unitNumber || tenant.unitNumber || '',
    'Rent (KES)': tenant.rent || 0,
    'Balance (KES)': tenant.balance || 0,
    'Move-in Date': tenant.moveInDate ? new Date(tenant.moveInDate).toLocaleDateString() : '',
    'Move-out Date': tenant.moveOutDate ? new Date(tenant.moveOutDate).toLocaleDateString() : '',
    'Lease Type': tenant.leaseType || 'at_will',
    'Payment Method': tenant.paymentMethod || '',
    'Status': tenant.status || 'active',
    'Emergency Contact': tenant.emergencyContact?.name || '',
    'Emergency Phone': tenant.emergencyContact?.phone || '',
    'Created Date': tenant.createdAt ? new Date(tenant.createdAt).toLocaleDateString() : ''
  }));

  // Create worksheet
  const worksheet = XLSX.utils.json_to_sheet(exportData);
  
  // Set column widths
  worksheet['!cols'] = [
    { wch: 25 }, // Name
    { wch: 18 }, // Phone
    { wch: 18 }, // ID
    { wch: 15 }, // Property Code
    { wch: 15 }, // Unit
    { wch: 12 }, // Rent
    { wch: 12 }, // Balance
    { wch: 15 }, // Move-in
    { wch: 15 }, // Move-out
    { wch: 12 }, // Lease Type
    { wch: 18 }, // Payment
    { wch: 12 }, // Status
    { wch: 20 }, // Emergency Contact
    { wch: 18 }, // Emergency Phone
    { wch: 15 }  // Created
  ];

  // Create workbook
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Tenants');

  // Generate Excel file
  const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  
  // Download
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `Tenants_Export_${new Date().toISOString().split('T')[0]}.xlsx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
};
