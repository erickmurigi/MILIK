# Statement Management UI Integration Guide

This guide explains how to integrate the new immutable statement management UI with the backend API and Redux store.

## Component Structure

### Pages
- **`src/pages/Landlord/Statements.jsx`** - Main statement management page

### Components
- **`src/components/Landlord/StatementsTable.jsx`** - Table listing all statements with status badges and action buttons
- **`src/components/Landlord/StatementDetailView.jsx`** - Detailed view of a single statement with ledger lines

### Modals
- **`src/components/Modals/GenerateStatementModal.jsx`** - Modal to create draft statements
- **`src/components/Modals/ApproveStatementModal.jsx`** - Modal to approve statements with notes
- **`src/components/Modals/CreateRevisionModal.jsx`** - Modal to create statement revisions

### Redux
- **`src/redux/statementsRedux.js`** - Redux slice for statement state management

## Integration Steps

### 1. Set Up Redux Store

**File: `src/redux/store.js`**

Add the statementsReducer to your store:

```javascript
import statementsReducer from "./statementsRedux";

const rootReducer = combineReducers({
  // ... existing reducers
  statements: statementsReducer,
});
```

### 2. Add API Call Functions

**File: `src/redux/apiCalls.js`**

The following API functions are already defined. Just ensure they're imported in your store/components:

```javascript
// Statement API calls (already in apiCalls.js)
export const getStatements = (landlordId, filters = {}) => async (dispatch) => { ... }
export const getStatement = (statementId) => async (dispatch) => { ... }
export const createDraftStatement = (payload) => async (dispatch) => { ... }
export const approveStatement = (statementId, approvalNotes = "") => async (dispatch) => { ... }
export const sendStatement = (statementId) => async (dispatch) => { ... }
export const createStatementRevision = (statementId, revisionReason) => async (dispatch) => { ... }
export const deleteDraftStatement = (statementId) => async (dispatch) => { ... }
export const validateStatementAudit = (statementId) => async (dispatch) => { ... }
export const downloadStatementPdf = async (statementId) => { ... }
```

### 3. Connect Page to Redux

**File: `src/pages/Landlord/Statements.jsx`**

Update the component to use Redux selectors and dispatch actions:

```javascript
import { useSelector, useDispatch } from 'react-redux';
import {
  getStatements,
  createDraftStatement,
  approveStatement,
  sendStatement,
  createStatementRevision,
  deleteDraftStatement,
  downloadStatementPdf,
} from '../../redux/apiCalls';

const Statements = () => {
  const dispatch = useDispatch();
  
  // Get state from Redux
  const { statements, loading, error } = useSelector((state) => state.statements);
  const currentUser = useSelector((state) => state.auth?.currentUser);
  const { landlords } = useSelector((state) => state.landlord);
  const { properties } = useSelector((state) => state.property);

  // Load statements on mount
  useEffect(() => {
    if (currentUser?.landlordId) {
      dispatch(getStatements(currentUser.landlordId)).catch(err => {
        toast.error('Failed to load statements');
      });
    }
  }, [dispatch, currentUser]);

  // Update handlers to use dispatch
  const handleGenerateDraft = async (formData) => {
    try {
      await dispatch(createDraftStatement(formData)).unwrap();
      toast.success('Draft statement generated successfully');
    } catch (err) {
      toast.error(err.message || 'Failed to generate statement');
    }
  };

  // ... similar for other handlers
};
```

### 4. Add Route to Application

**File: `src/App.jsx`**

Add the new Statements page route, preferably under the Landlord section:

```javascript
import Statements from './pages/Landlord/Statements';

// In your Routes:
<Route path="/landlord/statements" element={<Statements />} />
```

### 5. Add Navigation Link

**Update your Navigation Component**

Add a link to the statements page in the sidebar or menu:

```javascript
{
  label: 'Statements',
  path: '/landlord/statements',
  icon: <FaFileAlt />,
  active: location.pathname === '/landlord/statements'
}
```

## API Endpoint Mapping

The UI components call these backend endpoints:

```
POST   /api/statements/draft                    - Create draft statement
POST   /api/statements/:id/approve              - Approve statement
POST   /api/statements/:id/send                 - Mark as sent
POST   /api/statements/:id/revise               - Create revision
DELETE /api/statements/:id                      - Delete draft
GET    /api/statements/:id                      - Get statement with lines
GET    /api/statements/:id/pdf                  - Download PDF
GET    /api/statements/:id/validate             - Validate audit
GET    /api/statements?landlordId=X&status=Y   - List statements
GET    /api/statements/summary/stats            - Get statistics
```

## Data Flow

### Creating a Draft Statement
1. User clicks "Generate Statement" button
2. `GenerateStatementModal` opens
3. User fills in property, landlord, period dates
4. `onGenerateDraft()` dispatches `createDraftStatement` action
5. API creates draft from ledger snapshot
6. Redux state updated with new statement
7. UI refreshes to show new draft

### Approving a Statement
1. User clicks approval button in table
2. `ApproveStatementModal` opens showing statement summary
3. User reads warning that approval is immutable
4. User adds optional approval notes
5. User checks confirmation checkbox
6. `onApprove()` dispatches `approveStatement` action
7. API freezes statement as immutable
8. Redux state updated with approved status
9. PDF download becomes available

### Creating a Revision
1. User clicks "Create Revision" on approved/sent statement
2. `CreateRevisionModal` opens
3. User enters reason for revision
4. `onCreateRevision()` dispatches `createStatementRevision` action
5. API marks original as "revised"
6. API creates new draft with incremented version
7. Both statements linked in audit trail
8. UI shows both statements in list

## Status Workflow

```
draft → approved → sent
  ↓
reviewed (optional intermediate state)

Any approved/sent → revised (creates new draft)
```

## Conditional Button Display

Buttons appear based on statement status:

| Status | Actions Available |
|--------|------------------|
| Draft | Approve, Delete |
| Reviewed | Approve, Delete |
| Approved | Download PDF, Send, Revise |
| Sent | Download PDF, Revise |
| Revised | View only (for reference) |

## Error Handling

All API calls include error handling:

```javascript
try {
  await dispatch(createDraftStatement(formData)).unwrap();
  toast.success('Draft statement generated successfully');
  setShowGenerateModal(false);
} catch (err) {
  toast.error(err.message || 'Failed to generate statement');
  // Error stored in Redux state.statements.error
}
```

## Performance Optimization

- **Reusable Browser Instance**: PDFs use shared Puppeteer browser
- **Lazy Loading**: Statements loaded on demand
- **Pagination**: Implementation ready in API layer
- **Filtering**: Client-side filtering with debounce support

## Testing

Test scenarios covered:

1. **Generate Draft** - Create statement from period dates
2. **Approve Statement** - Freeze as immutable
3. **Download PDF** - Test PDF generation from snapshot
4. **Send Statement** - Mark approved statement as sent
5. **Create Revision** - Generate new version
6. **Delete Draft** - Only allow deletion of drafts
7. **Error Cases** - Invalid dates, missing fields, etc.
8. **Multi-tenant Isolation** - Verify business ID filtering

## Customization

### Styling
Colors can be customized by changing these constants:

```javascript
const MILIK_GREEN = "#0B3B2E";
const MILIK_ORANGE = "#FF8C00";
const MILIK_GRAY = "#6B7280";
```

### Status Badges
Customize status appearance in `StatementsTable.jsx`:

```javascript
const getStatusBadge = (status) => {
  const statusConfig = {
    draft: { bg: "#FEF3C7", text: "#92400E", icon: "📝" },
    // ... add more statuses
  };
};
```

### Date Formats
All date formatting uses `en-GB` locale. Change in format functions:

```javascript
const formatDate = (date) => {
  return new Date(date).toLocaleDateString('en-GB'); // Change locale here
};
```

## Security Considerations

✅ **Implemented:**
- Business ID isolation on all queries
- Token authentication on all endpoints
- Immutable approval prevents unauthorized changes
- Audit trail tracks all modifications

⚠️ **Remember:**
- Always validate user's company/business ID
- Restrict PDF downloads to approved statements only
- Never regenerate approved statement data
- Log all statement modifications

## Future Enhancements

1. **Email Delivery** - Send statement PDFs directly to landlords
2. **Batch Operations** - Approve multiple statements at once
3. **Statement Comparison** - Side-by-side view of original vs revised
4. **Custom Reports** - Generate reports from statement data
5. **Statement Templates** - Customize statement appearance
6. **Payment Integration** - Link payments to statement lines
7. **Landlord Portal** - Self-service statement viewing

## Troubleshooting

### Statements Not Loading
- Check business ID is correctly stored in Redux
- Verify API token is valid
- Check network tab for 401/403 errors

### PDF Download Not Working
- Ensure Puppeteer is installed on server
- Check browser instance initialization logs
- Verify statement has status "approved" or "sent"

### Modal Not Opening
- Check Redux store is properly configured
- Verify modal state variables are set correctly
- Check for console errors

### Redux State Not Updating
- Verify reducers are added to store
- Check dispatch calls are correct
- Look for async/await issues in API calls
