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
      'Reg/ID Number',
      'Tax PIN',
      'Email',
      'Phone Number',
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
    [''],
    ['OPTIONAL FIELDS (leave blank or use a dash - if not available)'],
    ['• Reg/ID Number: National ID or company registration number (must be unique if provided)'],
    ['• Tax PIN: Tax identification number (must be unique if provided)'],
    ['• Email: Valid email address (must be unique if provided)'],
    ['• Phone Number: Contact phone number'],
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
    ['• Only Landlord Name and Landlord Type are required'],
    ['• For optional fields you do not have, leave the cell blank or enter a dash (-)'],
    ['• Landlord Type must match exactly: Individual, Company, Partnership, or Trust'],
    ['• Status must be either: Active or Archived'],
    ['• Portal Access must be either: Enabled or Disabled'],
    ['• Email, Reg/ID Number, and Tax PIN must be unique if provided — duplicates will be skipped'],
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
          
          // Treat dash placeholders the same as blank — user has no data for that field
          const stripPlaceholder = (v) => {
            const s = String(v || "").trim();
            return /^-+$|^n\/a$|^na$|^none$/i.test(s) ? "" : s;
          };

          return {
            rowNumber: index + 2, // Excel row (1 is header)
            landlordName: getName(row).trim(),
            landlordType: getType(row).trim(),
            regId: stripPlaceholder(getRegId(row)),
            taxPin: stripPlaceholder(getTaxPin(row)),
            email: stripPlaceholder(getEmail(row)).toLowerCase(),
            phoneNumber: stripPlaceholder(getPhone(row)),
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
          
          // Required field validations — only Name is truly required
          if (!record.landlordName) {
            rowErrors.push('Landlord Name is required');
          }
          // Optional fields: validate format only when a value is provided
          if (record.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(record.email)) {
            rowErrors.push('Invalid email format — leave blank or use a dash (-) if no email');
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
      'LR Number',
      'Property Type',
      'Category',
      'Town/City',
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
    ['• Landlord Name: Must match an existing landlord in the system'],
    [''],
    ['OPTIONAL FIELDS (leave blank or use a dash - if not available)'],
    ['• Property Code: Unique code (e.g., PRO001, PRO002) - System auto-generates if not provided'],
    ['• LR Number: Land Registry Number (must be unique if provided)'],
    ['• Property Type: Residential, Commercial, Mixed Use, Industrial, Agricultural, Special Purpose (default: Residential)'],
    ['• Category: Property category (e.g., Apartment, House, Office)'],
    ['• Town/City: Town or city location'],
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
    ['• Only Property Name and Landlord Name are required'],
    ['• For optional fields you do not have, leave the cell blank or enter a dash (-)'],
    ['• Property Code is optional - system auto-generates if left blank'],
    ['• LR Number must be unique if provided — duplicates will be skipped'],
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
          
          // Strip dash/N/A placeholders from optional text fields
          const stripPropPlaceholder = (v) => {
            const s = String(v || "").trim();
            return /^-+$|^n\/a$|^na$|^none$/i.test(s) ? "" : s;
          };

          return {
            rowNumber: index + 2,
            propertyName: getName(row).trim(),
            propertyCode: getCode(row).trim(), // Can be empty - system will auto-generate
            lrNumber: stripPropPlaceholder(getLR(row)),
            propertyType: getType(row).trim(),
            category: stripPropPlaceholder(getCategory(row)),
            townCityState: stripPropPlaceholder(getTown(row)),
            estateArea: stripPropPlaceholder(getEstate(row)),
            roadStreet: stripPropPlaceholder(getRoad(row)),
            zoneRegion: stripPropPlaceholder(getZone(row)),
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

const normalizeUnitBillingPeriodKey = (value = "") =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");

const UNIT_BILLING_PERIOD_ALIASES = {
  month: "monthly",
  monthly: "monthly",
  quarter: "quarterly",
  quarterly: "quarterly",
  semi_annual: "semi_annual",
  semiannual: "semi_annual",
  semi_annually: "semi_annual",
  biannual: "semi_annual",
  bi_annually: "semi_annual",
  annual: "annual",
  annually: "annual",
  year: "annual",
  yearly: "annual",
};

const canonicalUnitBillingPeriodKey = (value = "") => {
  const normalized = normalizeUnitBillingPeriodKey(value);
  return UNIT_BILLING_PERIOD_ALIASES[normalized] || normalized || "monthly";
};

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
      'Rent',
      'Deposit',
      'Billing Frequency',
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
    { wch: 20 }, // Billing Frequency
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
    [''],
    ['OPTIONAL FIELDS (leave blank or use a dash - if not available)'],
    ['• Rent: Monthly rent in Kenyan Shillings (KES) — defaults to 0 if left blank'],
    ['• Deposit: Security deposit amount in KES — defaults to 0 if left blank'],
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
      'Billing Frequency',
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
      'monthly',
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
      'quarterly',
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
      'annual',
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
      'semi_annual',
      '',
      '',
      'maintenance',
      'Under renovation'
    ],
    [''],
    ['IMPORTANT NOTES'],
    ['• Do not modify the column headers in the Data sheet'],
    ['• Only Unit Number, Property Code, and Unit Type are required'],
    ['• Leave Rent and Deposit blank (or use a dash -) to default to 0 — you can update them later'],
    ['• Unit Number must be unique within the same property'],
    ['• Property Code must match exactly with existing property codes in your system'],
    ['• Unit Type must be one of: studio, 1bed, 2bed, 3bed, 4bed, commercial (case-sensitive)'],
    ['• Rent and Deposit must be numeric values when provided (numbers only, no currency symbols)'],
    ['• Status must be one of: vacant, occupied, maintenance, reserved, archived (lowercase)'],
    ['• Amenities and Utilities Included are optional - separate multiple items with commas'],
    ['• Delete these instruction rows before uploading'],
    ['• Maximum 1000 units per import']
  ]);

  instructionsSheet['!cols'] = [
    { wch: 80 }, { wch: 15 }, { wch: 18 }, { wch: 15 }, { wch: 15 }, { wch: 20 }, { wch: 40 }, { wch: 25 }, { wch: 15 }, { wch: 40 }
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
    ['Billing Frequency Options:'],
    ['monthly'],
    ['quarterly'],
    ['semi_annual'],
    ['annual'],
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
          const isUnitPlaceholder = (v) => {
            const s = String(v || "").trim();
            return /^-+$|^n\/a$|^na$|^none$/i.test(s);
          };
          const getRent = (row) => {
            const val = row['Rent *'] || row['Rent'] || row['rent'] || '';
            if (String(val || '').trim() === '' || isUnitPlaceholder(val)) return undefined;
            const num = parseFloat(val);
            return isNaN(num) ? Number.NaN : num;
          };
          const getDeposit = (row) => {
            const val = row['Deposit *'] || row['Deposit'] || row['deposit'] || '';
            if (String(val || '').trim() === '' || isUnitPlaceholder(val)) return undefined;
            const num = parseFloat(val);
            return isNaN(num) ? Number.NaN : num;
          };
          const getAmenities = (row) => {
            const val = row['Amenities'] || row['amenities'] || '';
            return val.split(',').map(a => a.trim()).filter(a => a);
          };
          const getUtilities = (row) => {
            const val = row['Utilities Included'] || row['utilities'] || '';
            return val.split(',').map(u => u.trim()).filter(u => u);
          };
          const getBillingFrequency = (row) => {
            const val =
              row['Billing Frequency'] ||
              row['Billing Frequency *'] ||
              row['billingFrequency'] ||
              row['billingPeriodKey'] ||
              '';
            return canonicalUnitBillingPeriodKey(val || 'monthly');
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
            billingFrequency: getBillingFrequency(row),
            billingPeriodKey: getBillingFrequency(row),
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
        const validStatuses = ['vacant', 'maintenance', 'reserved', 'archived'];
        const validBillingFrequencies = ['monthly', 'quarterly', 'semi_annual', 'annual'];
        
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
          if (record.rent !== undefined && (!Number.isFinite(record.rent) || record.rent < 0)) {
            rowErrors.push('Rent must be a valid zero-or-greater amount when provided');
          }
          if (record.deposit !== undefined && (!Number.isFinite(record.deposit) || record.deposit < 0)) {
            rowErrors.push('Deposit must be a valid zero-or-greater amount when provided');
          }
          
          // Enum validations
          if (record.unitType && !validUnitTypes.includes(record.unitType)) {
            rowErrors.push(`Invalid Unit Type. Must be one of: ${validUnitTypes.join(', ')}`);
          }
          if (record.status && !validStatuses.includes(record.status)) {
            rowErrors.push(`Invalid Status. Must be one of: ${validStatuses.join(', ')}`);
          }
          if (record.billingFrequency && !validBillingFrequencies.includes(record.billingFrequency)) {
            rowErrors.push(`Invalid Billing Frequency. Must be one of: ${validBillingFrequencies.join(', ')}`);
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
    'Billing Frequency': unit.billingPeriodKey || unit.billingFrequency || 'monthly',
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
    { wch: 20 }, // Billing Frequency
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
  const headers = [
    "Tenant Code",
    "Tenant Name *",
    "Phone Number",
    "ID Number",
    "Property Code *",
    "Unit Number *",
    "Additional Unit Numbers",
    "Rent",
    "Deposit Amount",
    "Deposit Held By",
    "Move-in Date *",
    "Lease Type",
    "Move-out Date",
    "Status",
    "Additional Utilities",
    "Emergency Contact Name",
    "Emergency Contact Phone",
    "Emergency Contact Relationship",
    "Notes",
  ];

  const dataSheet = XLSX.utils.aoa_to_sheet([headers]);
  dataSheet["!cols"] = [
    { wch: 16 },
    { wch: 28 },
    { wch: 18 },
    { wch: 18 },
    { wch: 18 },
    { wch: 18 },
    { wch: 24 },
    { wch: 14 },
    { wch: 16 },
    { wch: 20 },
    { wch: 18 },
    { wch: 14 },
    { wch: 18 },
    { wch: 14 },
    { wch: 42 },
    { wch: 24 },
    { wch: 20 },
    { wch: 24 },
    { wch: 36 },
  ];

  const instructionsSheet = XLSX.utils.aoa_to_sheet([
    ["TENANT IMPORT INSTRUCTIONS"],
    [""],
    ["REQUIRED FIELDS (marked with *)"],
    ["• Tenant Name: Full tenant name"],
    ["• Property Code: Must match an existing property code in MILIK"],
    ["• Unit Number: Primary unit number under the selected property"],
    ["• Move-in Date: Use YYYY-MM-DD for best results"],
    [""],
    ["OPTIONAL FIELDS (leave blank or use a dash - if not available)"],
    ["• Tenant Code: Leave blank to let MILIK auto-generate TT codes"],
    ["• Phone Number: Contact number (leave blank or use - if not available)"],
    ["• ID Number: National ID / passport number (leave blank or use - if not available)"],
    ["• Additional Unit Numbers: Separate multiple units with commas or semicolons"],
    ["• Rent: Leave blank to let MILIK use the assigned unit rent total"],
    ["• Deposit Amount: Leave blank to fall back to current unit/property defaults"],
    ["• Deposit Held By: Landlord or Management Company"],
    ["• Lease Type: at_will or fixed (default: at_will)"],
    ["• Move-out Date: Required when Lease Type is fixed"],
    ["• Status: active, inactive, overdue, evicted, or moved_out (default: active)"],
    ["• Additional Utilities: Format each item as Utility:Amount or Utility:Amount:included"],
    ["• Emergency Contact Relationship: Example Family, Spouse, Employer, Relative"],
    ["• Notes: Optional tenant remarks"],
    [""],
    ["ADDITIONAL UTILITIES EXAMPLES"],
    ["• Water:1500"],
    ["• Garbage:500; Security:0:included"],
    ["• Internet:2500; Parking:1000; Service Charge:0:included"],
    [""],
    ["EXAMPLE DATA (Copy these rows into the Data sheet if helpful)"],
    [""],
    headers,
    [
      "",
      "John Mwangi",
      "+254701234567",
      "12345678",
      "PRO001",
      "A1",
      "A2",
      "",
      "35000",
      "Management Company",
      "2025-01-15",
      "at_will",
      "",
      "active",
      "Water:1500; Garbage:500",
      "Jane Mwangi",
      "+254701234568",
      "Family",
      "Auto-code, primary plus one extra unit",
    ],
    [
      "TT0042",
      "Sarah Kipchoge",
      "+254722345678",
      "87654321",
      "PRO002",
      "201",
      "",
      "25000",
      "25000",
      "Landlord",
      "2025-03-20",
      "fixed",
      "2026-03-19",
      "active",
      "Service Charge:0:included",
      "David Kipchoge",
      "+254722345679",
      "Brother",
      "Fixed lease with landlord-held deposit",
    ],
    [
      "",
      "Michael Okonkwo",
      "+254733456789",
      "11223344",
      "PRO003",
      "B3",
      "B4; B5",
      "",
      "",
      "",
      "2025-06-10",
      "at_will",
      "",
      "active",
      "",
      "Mary Okonkwo",
      "+254733456790",
      "Relative",
      "Rent and deposit will be derived by MILIK",
    ],
    [""],
    ["IMPORTANT NOTES"],
    ["• Do not rename the Data sheet headers"],
    ["• Only Tenant Name, Property Code, Unit Number, and Move-in Date are required"],
    ["• For Phone Number or ID Number you do not have, leave blank or enter a dash (-)"],
    ["• Property Code and Unit Number must already exist in MILIK"],
    ["• Additional Unit Numbers must belong to the same property as the primary unit"],
    ["• Fixed leases must include a Move-out Date after Move-in Date"],
    ["• Deposit Held By accepts Landlord or Management Company"],
    ["• Additional Utilities must use numeric amounts"],
    ["• Delete instruction rows before upload"],
  ]);

  instructionsSheet["!cols"] = headers.map(() => ({ wch: 28 }));

  const dropdownData = [
    ["VALID VALUES / REFERENCE"],
    [""],
    ["Lease Type Options"],
    ["at_will"],
    ["fixed"],
    [""],
    ["Status Options"],
    ["active"],
    ["inactive"],
    ["overdue"],
    ["evicted"],
    ["moved_out"],
    [""],
    ["Deposit Held By Options"],
    ["Management Company"],
    ["Landlord"],
  ];

  if (Array.isArray(units) && units.length > 0) {
    dropdownData.push([""]);
    dropdownData.push(["AVAILABLE PROPERTY CODE + UNIT NUMBER COMBINATIONS"]);
    dropdownData.push(["(Use Property Code and Unit Number exactly as listed)"]);

    const groupedByProperty = {};
    units.forEach((unit) => {
      const propertyCode = unit?.property?.propertyCode || "UNKNOWN";
      const propertyName = unit?.property?.propertyName || unit?.property?.name || "Unknown Property";
      const key = `${propertyCode} - ${propertyName}`;
      if (!groupedByProperty[key]) groupedByProperty[key] = [];
      groupedByProperty[key].push(unit?.unitNumber || "");
    });

    Object.keys(groupedByProperty)
      .sort()
      .forEach((groupKey) => {
        dropdownData.push([groupKey]);
        groupedByProperty[groupKey]
          .filter(Boolean)
          .sort()
          .forEach((unitNumber) => {
            dropdownData.push([`  ${unitNumber}`]);
          });
      });
  }

  dropdownData.push([""]);
  dropdownData.push(["UTILITY ENTRY TIPS"]);
  dropdownData.push(["• Separate utility rows with semicolons"]);
  dropdownData.push(["• Use Utility:Amount or Utility:Amount:included"]);
  dropdownData.push(["• Example: Water:1500; Garbage:500; Service Charge:0:included"]);

  const dropdownSheet = XLSX.utils.aoa_to_sheet(dropdownData);
  dropdownSheet["!cols"] = [{ wch: 60 }];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, dataSheet, "Data");
  XLSX.utils.book_append_sheet(workbook, instructionsSheet, "Instructions & Examples");
  XLSX.utils.book_append_sheet(workbook, dropdownSheet, "Valid Values");

  const excelBuffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
  return new Blob([excelBuffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
};

/**
 * Download tenants template
 * @param {Array} units - Optional array of unit objects
 */
export const downloadTenantsTemplate = (units = []) => {
  const blob = generateTenantsTemplate(units);
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `MILIK_Tenants_Import_Template_${new Date().toISOString().split("T")[0]}.xlsx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
};

const normalizeTenantImportKey = (key = "") =>
  String(key)
    .replace(/\u00A0/g, " ")
    .trim()
    .toLowerCase()
    .replace(/\*/g, "")
    .replace(/[\s_\-\/]+/g, "");

const getTenantImportValue = (row, aliases = []) => {
  const normalizedRow = {};
  Object.keys(row || {}).forEach((key) => {
    normalizedRow[normalizeTenantImportKey(key)] = row[key];
  });

  for (const alias of aliases) {
    const match = normalizedRow[normalizeTenantImportKey(alias)];
    if (match !== undefined && match !== null && String(match).trim() !== "") {
      return match;
    }
  }

  return "";
};

const cleanImportString = (value) => {
  if (value === null || value === undefined) return "";
  return String(value).trim();
};

const parseImportNumber = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const cleaned = String(value).replace(/,/g, "").trim();
  if (!cleaned) return null;
  const numericValue = Number(cleaned);
  return Number.isFinite(numericValue) ? numericValue : Number.NaN;
};

const parseImportDate = (value) => {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "number") {
    const parsedCode = XLSX.SSF.parse_date_code(value);
    if (parsedCode) {
      const parsedDate = new Date(Date.UTC(parsedCode.y, parsedCode.m - 1, parsedCode.d));
      return Number.isNaN(parsedDate.getTime()) ? "" : parsedDate.toISOString();
    }
  }

  const raw = String(value).trim();
  if (!raw) return "";

  const nativeParsed = new Date(raw);
  if (!Number.isNaN(nativeParsed.getTime())) {
    return nativeParsed.toISOString();
  }

  const match = raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (!match) return "";

  let [, first, second, year] = match;
  let month = Number(first);
  let day = Number(second);
  const yearValue = Number(year.length === 2 ? `20${year}` : year);

  if (month > 12 && day <= 12) {
    const swappedMonth = day;
    day = month;
    month = swappedMonth;
  }

  const fallbackDate = new Date(Date.UTC(yearValue, month - 1, day));
  return Number.isNaN(fallbackDate.getTime()) ? "" : fallbackDate.toISOString();
};

const parseAdditionalUnitNumbers = (value) =>
  Array.from(
    new Set(
      String(value || "")
        .split(/[;,|\n]+/)
        .map((item) => cleanImportString(item))
        .filter(Boolean)
    )
  );

const normalizeImportedDepositHolder = (value) => {
  const normalized = cleanImportString(value).toLowerCase();
  if (!normalized) return "";
  if (["landlord"].includes(normalized)) return "Landlord";
  if (
    [
      "management company",
      "managementcompany",
      "manager",
      "property manager",
      "propertymanager",
      "property_manager",
      "pm",
    ].includes(normalized)
  ) {
    return "Management Company";
  }
  return "";
};

const parseImportedUtilities = (value) => {
  const raw = cleanImportString(value);
  if (!raw) {
    return { utilities: [], errors: [] };
  }

  const utilities = [];
  const errors = [];

  raw
    .split(/[;\n]+/)
    .map((item) => cleanImportString(item))
    .filter(Boolean)
    .forEach((entry) => {
      const parts = entry.split(":").map((item) => cleanImportString(item));
      if (parts.length < 2) {
        errors.push(`Invalid utility format "${entry}". Use Utility:Amount or Utility:Amount:included`);
        return;
      }

      const utilityName = parts[0];
      const amountValue = parseImportNumber(parts[1]);
      const inclusionRaw = cleanImportString(parts[2]).toLowerCase();

      if (!utilityName) {
        errors.push(`Utility name is missing in "${entry}"`);
        return;
      }

      if (!Number.isFinite(amountValue)) {
        errors.push(`Utility amount is invalid in "${entry}"`);
        return;
      }

      let isIncluded = false;
      if (inclusionRaw) {
        if (["included", "include", "yes", "true", "1"].includes(inclusionRaw)) {
          isIncluded = true;
        } else if (["excluded", "exclude", "no", "false", "0"].includes(inclusionRaw)) {
          isIncluded = false;
        } else {
          errors.push(`Utility inclusion flag is invalid in "${entry}". Use included or excluded`);
          return;
        }
      }

      utilities.push({
        utility: utilityName,
        utilityLabel: utilityName,
        unitCharge: Number(amountValue || 0),
        isIncluded,
      });
    });

  return { utilities, errors };
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
        const workbook = XLSX.read(data, { type: "array" });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, {
          raw: true,
          defval: "",
        });

        if (jsonData.length === 0) {
          reject(new Error("No data found in Excel file"));
          return;
        }

        const mappedData = jsonData.map((row, index) => {
          const utilitiesResult = parseImportedUtilities(
            getTenantImportValue(row, ["Additional Utilities", "Utilities", "additionalUtilities", "utilities"])
          );

          const rentValue = parseImportNumber(
            getTenantImportValue(row, ["Rent", "Rent *", "rent"])
          );
          const depositAmountValue = parseImportNumber(
            getTenantImportValue(row, ["Deposit Amount", "depositAmount"])
          );

          // Treat dash-only values as absent for optional personal info fields
          const stripTenantPlaceholder = (v) => {
            const s = String(v || "").trim();
            return /^-+$|^n\/a$|^na$|^none$/i.test(s) ? "" : s;
          };

          return {
            rowNumber: index + 2,
            tenantCode: cleanImportString(
              getTenantImportValue(row, ["Tenant Code", "tenantCode"])
            ),
            tenantName: cleanImportString(
              getTenantImportValue(row, ["Tenant Name *", "Tenant Name", "tenantName"])
            ),
            phoneNumber: stripTenantPlaceholder(
              cleanImportString(getTenantImportValue(row, ["Phone Number *", "Phone Number", "phoneNumber"]))
            ),
            idNumber: stripTenantPlaceholder(
              cleanImportString(getTenantImportValue(row, ["ID Number *", "ID Number", "idNumber"]))
            ),
            propertyCode: cleanImportString(
              getTenantImportValue(row, ["Property Code *", "Property Code", "propertyCode"])
            ).toUpperCase(),
            unitNumber: cleanImportString(
              getTenantImportValue(row, ["Unit Number *", "Unit Number", "unitNumber"])
            ),
            additionalUnitNumbers: parseAdditionalUnitNumbers(
              getTenantImportValue(row, [
                "Additional Unit Numbers",
                "Additional Units",
                "additionalUnitNumbers",
                "additionalUnits",
              ])
            ),
            rent: Number.isFinite(rentValue) ? rentValue : rentValue === null ? undefined : Number.NaN,
            depositAmount:
              depositAmountValue === null
                ? undefined
                : Number.isFinite(depositAmountValue)
                ? depositAmountValue
                : Number.NaN,
            depositHeldByRaw: cleanImportString(
              getTenantImportValue(row, ["Deposit Held By", "depositHeldBy"])
            ),
            depositHeldBy: normalizeImportedDepositHolder(
              getTenantImportValue(row, ["Deposit Held By", "depositHeldBy"])
            ),
            moveInDate: parseImportDate(
              getTenantImportValue(row, ["Move-in Date *", "Move-in Date", "Move In Date", "moveInDate"])
            ),
            leaseType:
              cleanImportString(
                getTenantImportValue(row, ["Lease Type", "Lease Type *", "leaseType"])
              ).toLowerCase() || "at_will",
            moveOutDate:
              parseImportDate(
                getTenantImportValue(row, ["Move-out Date", "Move Out Date", "moveOutDate"])
              ) || null,
            status:
              cleanImportString(getTenantImportValue(row, ["Status", "status"])).toLowerCase() ||
              "active",
            utilities: utilitiesResult.utilities,
            utilityErrors: utilitiesResult.errors,
            emergencyContactName: cleanImportString(
              getTenantImportValue(row, ["Emergency Contact Name", "emergencyContactName"])
            ),
            emergencyContactPhone: cleanImportString(
              getTenantImportValue(row, ["Emergency Contact Phone", "Emergency Contact Ph", "emergencyContactPhone"])
            ),
            emergencyContactRelationship: cleanImportString(
              getTenantImportValue(row, [
                "Emergency Contact Relationship",
                "emergencyContactRelationship",
              ])
            ),
            description: cleanImportString(
              getTenantImportValue(row, ["Notes", "Description", "description"])
            ),
          };
        });

        const validRecords = [];
        const errors = [];
        const validLeaseTypes = ["at_will", "fixed"];
        const validStatuses = ["active", "inactive", "overdue", "evicted", "moved_out"];

        const seenPhones = new Set();
        const seenIds = new Set();
        const seenTenantCodes = new Set();

        mappedData.forEach((record) => {
          const rowErrors = [];

          if (!record.tenantName) rowErrors.push("Tenant Name is required");
          if (!record.propertyCode) rowErrors.push("Property Code is required");
          if (!record.unitNumber) rowErrors.push("Unit Number is required");
          if (!record.moveInDate) rowErrors.push("Move-in Date is required and must be valid");

          if (record.tenantCode) {
            const normalizedTenantCode = record.tenantCode.toLowerCase();
            if (seenTenantCodes.has(normalizedTenantCode)) {
              rowErrors.push("Duplicate Tenant Code within file");
            }
            seenTenantCodes.add(normalizedTenantCode);
          }

          if (record.phoneNumber) {
            const normalizedPhone = record.phoneNumber.toLowerCase();
            if (seenPhones.has(normalizedPhone)) {
              rowErrors.push("Duplicate Phone Number within file");
            }
            seenPhones.add(normalizedPhone);
          }

          if (record.idNumber) {
            const normalizedIdNumber = record.idNumber.toLowerCase();
            if (seenIds.has(normalizedIdNumber)) {
              rowErrors.push("Duplicate ID Number within file");
            }
            seenIds.add(normalizedIdNumber);
          }

          if (!validLeaseTypes.includes(record.leaseType)) {
            rowErrors.push(`Invalid Lease Type. Must be one of: ${validLeaseTypes.join(", ")}`);
          }

          if (!validStatuses.includes(record.status)) {
            rowErrors.push(`Invalid Status. Must be one of: ${validStatuses.join(", ")}`);
          }

          if (record.rent !== undefined && !Number.isFinite(record.rent)) {
            rowErrors.push("Rent must be numeric when provided");
          } else if (record.rent !== undefined && Number.isFinite(record.rent) && record.rent < 0) {
            rowErrors.push("Rent cannot be negative");
          }

          if (record.depositAmount !== undefined) {
            if (!Number.isFinite(record.depositAmount)) {
              rowErrors.push("Deposit Amount must be numeric when provided");
            } else if (record.depositAmount < 0) {
              rowErrors.push("Deposit Amount cannot be negative");
            }
          }

          if (record.depositHeldByRaw && !record.depositHeldBy) {
            rowErrors.push("Deposit Held By must be Landlord or Management Company");
          }

          if (
            Array.isArray(record.additionalUnitNumbers) &&
            record.additionalUnitNumbers.some(
              (unitNumber) =>
                String(unitNumber || "").trim().toLowerCase() ===
                String(record.unitNumber || "").trim().toLowerCase()
            )
          ) {
            rowErrors.push("Additional Unit Numbers cannot include the primary Unit Number");
          }

          if (record.leaseType === "fixed") {
            if (!record.moveOutDate) {
              rowErrors.push("Move-out Date is required when Lease Type is fixed");
            } else if (record.moveInDate) {
              const moveInDate = new Date(record.moveInDate);
              const moveOutDate = new Date(record.moveOutDate);
              if (
                !Number.isNaN(moveInDate.getTime()) &&
                !Number.isNaN(moveOutDate.getTime()) &&
                moveOutDate <= moveInDate
              ) {
                rowErrors.push("Move-out Date must be after Move-in Date for fixed leases");
              }
            }
          }

          if (Array.isArray(record.utilityErrors) && record.utilityErrors.length > 0) {
            rowErrors.push(...record.utilityErrors);
          }

          if (rowErrors.length > 0) {
            errors.push({
              row: record.rowNumber,
              tenantName: record.tenantName,
              errors: rowErrors,
              data: record,
            });
          } else {
            validRecords.push({
              tenantCode: record.tenantCode || undefined,
              tenantName: record.tenantName,
              phoneNumber: record.phoneNumber,
              idNumber: record.idNumber,
              propertyCode: record.propertyCode,
              unitNumber: record.unitNumber,
              additionalUnitNumbers: record.additionalUnitNumbers,
              rent: record.rent,
              depositAmount: record.depositAmount,
              depositHeldBy: record.depositHeldBy || undefined,
              moveInDate: record.moveInDate,
              leaseType: record.leaseType,
              moveOutDate: record.moveOutDate,
              status: record.status,
              utilities: Array.isArray(record.utilities) ? record.utilities : [],
              emergencyContactName: record.emergencyContactName,
              emergencyContactPhone: record.emergencyContactPhone,
              emergencyContactRelationship: record.emergencyContactRelationship,
              description: record.description,
            });
          }
        });

        resolve({
          valid: validRecords,
          errors,
          total: mappedData.length,
          validCount: validRecords.length,
          errorCount: errors.length,
        });
      } catch (error) {
        reject(new Error(`Failed to parse Excel file: ${error.message}`));
      }
    };

    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsArrayBuffer(file);
  });
};

// ============================================
// INVOICE NOTES (DEBIT / CREDIT) EXCEL TEMPLATES
// ============================================

export const generateInvoiceNotesTemplate = () => {
  const dataSheet = XLSX.utils.aoa_to_sheet([
    ['Note Type *', 'Tenant Code', 'Tenant Name *', 'Category *', 'Amount *', 'Note Date *', 'Source Invoice No', 'Narration'],
  ]);

  dataSheet['!cols'] = [
    { wch: 16 }, { wch: 16 }, { wch: 28 }, { wch: 22 }, { wch: 14 }, { wch: 16 }, { wch: 22 }, { wch: 40 },
  ];

  const instructionsSheet = XLSX.utils.aoa_to_sheet([
    ['CREDIT & DEBIT NOTE IMPORT INSTRUCTIONS'],
    [''],
    ['REQUIRED FIELDS (marked with *)'],
    ['• Note Type: DEBIT_NOTE or CREDIT_NOTE'],
    ['• Tenant Name (or Tenant Code): must match an existing tenant in MILIK'],
    ['• Category: must be a valid invoice charge category (see Valid Values sheet)'],
    ['• Amount: positive number (KES)'],
    ['• Note Date: YYYY-MM-DD format'],
    [''],
    ['CONDITIONAL FIELDS'],
    ['• Source Invoice No: REQUIRED for CREDIT_NOTE — must be a posted, open invoice for that tenant'],
    ['• Source Invoice No: optional for DEBIT_NOTE — leave blank for standalone debit note'],
    [''],
    ['OPTIONAL FIELDS'],
    ['• Tenant Code: preferred over Tenant Name if provided — must match exactly'],
    ['• Narration: description text for the note'],
    [''],
    ['CREDIT NOTE RULES'],
    ['• Source Invoice must be in "pending" or "partially_paid" status'],
    ['• Amount cannot exceed the remaining creditable amount on the source invoice'],
    [''],
    ['EXAMPLE DATA'],
    [''],
    ['Note Type', 'Tenant Code', 'Tenant Name', 'Category', 'Amount', 'Note Date', 'Source Invoice No', 'Narration'],
    ['CREDIT_NOTE', 'TT0012', 'John Mwangi', 'RENT', '5000', '2026-07-01', 'INV-2026-001', 'Credit for overpayment'],
    ['DEBIT_NOTE', 'TT0045', 'Sarah Kipchoge', 'SERVICE_CHARGE', '2500', '2026-07-01', '', 'Annual service charge adjustment'],
    ['DEBIT_NOTE', '', 'Michael Okonkwo', 'WATER', '1200', '2026-07-01', 'INV-2026-050', 'Debit against water invoice'],
    [''],
    ['IMPORTANT NOTES'],
    ['• Either Tenant Code or Tenant Name must be provided (Tenant Code takes priority)'],
    ['• Use YYYY-MM-DD for Note Date (e.g. 2026-07-01)'],
    ['• Maximum 500 notes per import'],
    ['• Delete these instruction rows before uploading'],
  ]);

  instructionsSheet['!cols'] = [{ wch: 80 }, { wch: 20 }, { wch: 28 }, { wch: 22 }, { wch: 14 }, { wch: 16 }, { wch: 22 }, { wch: 40 }];

  const dropdownSheet = XLSX.utils.aoa_to_sheet([
    ['VALID VALUES FOR DROPDOWNS'],
    [''],
    ['Note Type Options:'],
    ['DEBIT_NOTE'],
    ['CREDIT_NOTE'],
    [''],
    ['Common Category Options:'],
    ['RENT'],
    ['WATER'],
    ['ELECTRICITY'],
    ['GARBAGE'],
    ['SERVICE_CHARGE'],
    ['SECURITY'],
    ['PARKING'],
    ['INTERNET'],
    ['GAS'],
    ['AMENITY'],
    ['MANAGEMENT_FEE'],
    ['CARETAKER'],
    ['LATE_PENALTY'],
    ['OTHER'],
    [''],
    ['TIPS:'],
    ['• Category must match exactly (UPPERCASE, underscores as shown)'],
    ['• Use Tenant Code when possible to avoid ambiguous name matches'],
    ['• Leave Source Invoice No blank for standalone DEBIT_NOTEs'],
  ]);

  dropdownSheet['!cols'] = [{ wch: 50 }];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, dataSheet, 'Data');
  XLSX.utils.book_append_sheet(workbook, instructionsSheet, 'Instructions & Examples');
  XLSX.utils.book_append_sheet(workbook, dropdownSheet, 'Valid Values');

  const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  return new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
};

export const downloadInvoiceNotesTemplate = () => {
  const blob = generateInvoiceNotesTemplate();
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `MILIK_InvoiceNotes_Import_Template_${new Date().toISOString().split('T')[0]}.xlsx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
};

const normalizeNoteImportKey = (key = '') =>
  String(key).trim().toLowerCase().replace(/\*/g, '').replace(/[\s_\-\/]+/g, '');

const getNoteImportValue = (row, aliases = []) => {
  const normalizedRow = {};
  Object.keys(row || {}).forEach((key) => { normalizedRow[normalizeNoteImportKey(key)] = row[key]; });
  for (const alias of aliases) {
    const match = normalizedRow[normalizeNoteImportKey(alias)];
    if (match !== undefined && match !== null && String(match).trim() !== '') return match;
  }
  return '';
};

export const parseInvoiceNotesExcel = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array', cellDates: false });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { raw: true, defval: '' });

        if (jsonData.length === 0) {
          reject(new Error('No data found in Excel file'));
          return;
        }

        const parseNoteDate = (value) => {
          if (value === '' || value === null || value === undefined) return '';
          if (typeof value === 'number') {
            const parsed = XLSX.SSF.parse_date_code(value);
            if (parsed) {
              const d = new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d));
              return Number.isNaN(d.getTime()) ? '' : d.toISOString().split('T')[0];
            }
          }
          const raw = String(value).trim();
          if (!raw) return '';
          const native = new Date(raw);
          if (!Number.isNaN(native.getTime())) return native.toISOString().split('T')[0];
          return raw;
        };

        const mappedData = jsonData.map((row, index) => ({
          rowNumber: index + 2,
          noteType: String(getNoteImportValue(row, ['Note Type', 'noteType', 'NoteType']) || '').trim().toUpperCase(),
          tenantCode: String(getNoteImportValue(row, ['Tenant Code', 'tenantCode']) || '').trim(),
          tenantName: String(getNoteImportValue(row, ['Tenant Name', 'tenantName']) || '').trim(),
          category: String(getNoteImportValue(row, ['Category', 'category']) || '').trim().toUpperCase(),
          amount: (() => {
            const raw = getNoteImportValue(row, ['Amount', 'amount']);
            const n = parseFloat(String(raw || '').replace(/,/g, ''));
            return Number.isFinite(n) ? n : Number.NaN;
          })(),
          noteDate: parseNoteDate(getNoteImportValue(row, ['Note Date', 'noteDate', 'NoteDate'])),
          sourceInvoiceNo: String(getNoteImportValue(row, ['Source Invoice No', 'sourceInvoiceNo', 'SourceInvoiceNo', 'Invoice No']) || '').trim(),
          narration: String(getNoteImportValue(row, ['Narration', 'narration', 'Description', 'description']) || '').trim(),
        }));

        const validNoteTypes = ['DEBIT_NOTE', 'CREDIT_NOTE'];
        const validRecords = [];
        const errors = [];

        mappedData.forEach((record) => {
          const rowErrors = [];

          if (!validNoteTypes.includes(record.noteType)) {
            rowErrors.push(`Note Type must be DEBIT_NOTE or CREDIT_NOTE (got "${record.noteType || '(blank)'}")`);
          }
          if (!record.tenantCode && !record.tenantName) {
            rowErrors.push('Either Tenant Code or Tenant Name is required');
          }
          if (!record.category) {
            rowErrors.push('Category is required');
          }
          if (!Number.isFinite(record.amount) || record.amount <= 0) {
            rowErrors.push('Amount must be a positive number');
          }
          if (!record.noteDate) {
            rowErrors.push('Note Date is required and must be a valid date (YYYY-MM-DD)');
          }
          if (record.noteType === 'CREDIT_NOTE' && !record.sourceInvoiceNo) {
            rowErrors.push('Source Invoice No is required for CREDIT_NOTE');
          }

          if (rowErrors.length > 0) {
            errors.push({ row: record.rowNumber, errors: rowErrors, data: record });
          } else {
            validRecords.push({
              noteType: record.noteType,
              tenantCode: record.tenantCode || undefined,
              tenantName: record.tenantName || undefined,
              category: record.category,
              amount: record.amount,
              noteDate: record.noteDate,
              sourceInvoiceNo: record.sourceInvoiceNo || undefined,
              narration: record.narration || undefined,
            });
          }
        });

        resolve({
          valid: validRecords,
          errors,
          total: mappedData.length,
          validCount: validRecords.length,
          errorCount: errors.length,
        });
      } catch (error) {
        reject(new Error(`Failed to parse Excel file: ${error.message}`));
      }
    };

    reader.onerror = () => reject(new Error('Failed to read file'));
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
