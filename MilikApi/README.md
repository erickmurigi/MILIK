# MILIK Property Management API

A comprehensive RESTful API for property, tenant, and landlord management built with Node.js, Express, and MongoDB.

## 🏗️ Architecture

- **Framework**: Express.js
- **Database**: MongoDB with Mongoose ODM
- **Authentication**: JWT (JSON Web Tokens)
- **Security**: Helmet, CORS, Rate Limiting, Input Validation (Zod)
- **Real-time**: Socket.IO for live updates
- **Logging**: Morgan

## 🚀 Quick Start

### Prerequisites

- Node.js >= 22.0.0
- MongoDB Database
- npm or yarn

### Installation

1. Clone the repository
```bash
git clone https://github.com/erickmurigi/MilikApi.git
cd MilikApi
```

2. Install dependencies
```bash
npm install
```

3. Configure environment variables

Copy `.env.example` to `.env` and update with your values:

```bash
cp .env.example .env
```

Minimum required variables:
- `MONGO_URL` - MongoDB connection string
- `JWT_SECRET` - Secret key for JWT (min 32 characters)
- `NODE_ENV` - `development` or `production`
- `PORT` - API port (default: `8800`)
- `ALLOWED_ORIGINS` - Comma-separated list of real frontend origin(s)
- one public frontend URL such as `FRONTEND_URL` or `APP_BASE_URL`
- `MILIK_ADMIN_EMAIL` - System admin email
- `MILIK_ADMIN_PASSWORD` - System admin password

Email delivery variables are optional unless you want onboarding/demo emails:
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`
- `TRIAL_NOTIFICATION_EMAIL`, `ONBOARDING_NOTIFICATION_EMAIL`

4. Start the server
```bash
# Development mode with nodemon
npm run dev

# Production mode
npm start
```

## 📡 API Endpoints

### Authentication
- `POST /api/auth/login` - User login
- `POST /api/auth/logout` - User logout
- `GET /api/auth/me` - Get current user
- `POST /api/auth` - Create new user (admin only)

### Companies
- `GET /api/companies` - Get all companies
- `GET /api/companies/:id` - Get company by ID
- `POST /api/companies` - Create company
- `PUT /api/companies/:id` - Update company
- `DELETE /api/companies/:id` - Delete company

### Properties
- `GET /api/properties` - Get all properties
- `GET /api/properties/:id` - Get property by ID
- `POST /api/properties` - Create property
- `PUT /api/properties/:id` - Update property
- `DELETE /api/properties/:id` - Delete property

### Units
- `GET /api/units` - Get all units
- `GET /api/units/:id` - Get unit by ID
- `POST /api/units` - Create unit
- `PUT /api/units/:id` - Update unit
- `DELETE /api/units/:id` - Delete unit

### Tenants
- `GET /api/tenants` - Get all tenants
- `GET /api/tenants/:id` - Get tenant by ID
- `POST /api/tenants` - Create tenant
- `PUT /api/tenants/:id` - Update tenant
- `DELETE /api/tenants/:id` - Delete tenant

### Landlords
- `GET /api/landlords` - Get all landlords
- `GET /api/landlords/:id` - Get landlord by ID
- `POST /api/landlords` - Create landlord
- `PUT /api/landlords/:id` - Update landlord
- `DELETE /api/landlords/:id` - Delete landlord

### Leases
- `GET /api/leases` - Get all leases
- `GET /api/leases/:id` - Get lease by ID
- `POST /api/leases` - Create lease
- `PUT /api/leases/:id` - Update lease
- `DELETE /api/leases/:id` - Delete lease

### Rent Payments
- `GET /api/rent-payments` - Get all payments
- `GET /api/rent-payments/:id` - Get payment by ID
- `POST /api/rent-payments` - Create payment
- `PUT /api/rent-payments/:id` - Update payment

### Maintenance
- `GET /api/maintenances` - Get all maintenance requests
- `GET /api/maintenances/:id` - Get maintenance by ID
- `POST /api/maintenances` - Create maintenance request
- `PUT /api/maintenances/:id` - Update maintenance
- `DELETE /api/maintenances/:id` - Delete maintenance

### Expenses
- `GET /api/propertyexpenses` - Get all expenses
- `GET /api/propertyexpenses/:id` - Get expense by ID
- `POST /api/propertyexpenses` - Create expense
- `PUT /api/propertyexpenses/:id` - Update expense
- `DELETE /api/propertyexpenses/:id` - Delete expense

### Utilities
- `GET /api/utilities` - Get all utilities
- `GET /api/utilities/:id` - Get utility by ID
- `POST /api/utilities` - Create utility
- `PUT /api/utilities/:id` - Update utility
- `DELETE /api/utilities/:id` - Delete utility

### Notifications
- `GET /api/notifications` - Get all notifications
- `POST /api/notifications` - Create notification
- `PUT /api/notifications/:id/read` - Mark as read

### Dashboard
- `GET /api/dashboard/stats` - Get dashboard statistics

### System
- `GET /health` - Health check endpoint
- `GET /api` - API information and endpoints

## 🔒 Security Features

- **JWT Authentication**: Secure token-based authentication
- **Role-Based Access Control (RBAC)**: Super Admin, Admin, Manager, Accountant, Agent, Viewer
- **Company Scoping**: Users can only access data from their own company
- **Input Validation**: Zod schemas for request validation
- **Rate Limiting**: Prevents API abuse
- **CORS**: Configured cross-origin resource sharing
- **Helmet**: Security headers
- **Environment Variables**: Sensitive data stored securely

## 🛡️ Authorization Levels

- **System Admin**: Full system access across all companies
- **Super Admin**: Company-level administrative access
- **Admin**: Company management with restricted system access
- **Manager**: Property and tenant management
- **Accountant**: Financial operations and reporting
- **Agent**: Property and tenant operations
- **Viewer**: Read-only access

## 📊 Data Models

### User
- Personal information (name, ID, contact)
- Profile/Role
- Company association
- Module access permissions
- Authentication credentials

### Company
- Company details
- Registration information
- Contact information
- Tax details

### Property
- Property information
- Location details
- Banking information
- Associated landlord
- Unit counts and statistics

### Unit
- Unit details
- Rent information
- Status (vacant/occupied/maintenance)
- Associated property and tenant
- Utilities

### Tenant
- Personal information
- Lease details
- Payment history
- Associated unit

### Landlord
- Personal/business information
- Contact details
- Associated properties
- Statistics

### Payment
- Amount and date
- Payment method
- Receipt number
- Associated tenant and unit
- Month/year

### Maintenance
- Request details
- Priority level
- Status
- Associated unit and tenant
- Assignment

### Lease
- Start and end dates
- Rent amount
- Security deposit
- Associated tenant and unit
- Terms and conditions

## 🔧 Development

### Project Structure
```
MilikApi/
├── controllers/          # Business logic
│   ├── authController.js
│   ├── company.js
│   ├── verifyToken.js
│   └── propertyController/
├── models/              # MongoDB schemas
├── routes/              # API routes
├── services/            # External services (M-Pesa, PayPal)
├── utils/               # Utilities and helpers
├── server.js            # Entry point
└── package.json
```

### Adding New Features

1. Create model in `models/`
2. Create controller in `controllers/`
3. Create routes in `routes/`
4. Add validation schema in `utils/validationSchemas.js`
5. Register routes in `server.js`

## 🧪 Testing

```bash
# Run tests (if configured)
npm test
```

## 📝 Environment Variables Reference

See `.env.example` for all available configuration options.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License.

## 👥 Authors

- Erick Murigi - [@erickmurigi](https://github.com/erickmurigi)

## 🙏 Acknowledgments

- Built for professional property management
- Scalable architecture for multi-tenant systems
- Security-first design approach

## 📞 Support

For support, email support@milik.com or open an issue on GitHub.

---

**Note**: Never commit `.env` files or expose sensitive credentials. Always rotate any leaked secrets immediately.


## 🚀 Hosting / Deployment Checklist

Before deploying to a VPS, Render, Railway, or any Linux host:

1. **Rotate any secrets** that were ever committed or shared.
2. **Do not deploy local artifacts** such as `.git`, `node_modules`, log files, or backups.
3. Use **Node.js 22+**.
4. Set **`ALLOWED_ORIGINS`** to only your real frontend domain(s).
5. Set at least one public frontend URL for emails:
   - `FRONTEND_URL`, or
   - `APP_BASE_URL`, or
   - `CLIENT_URL`
6. Keep `TRUST_PROXY=1` when running behind Nginx, Cloudflare, or a managed proxy.
7. Build/install dependencies fresh on the target Linux host:

```bash
npm ci
npm start
```

8. Verify the public health endpoint:

```bash
GET /health
```

In production, the health payload is intentionally minimal.

## 📦 Source-only deployment guidance

Deploy from source only. Do **not** upload:
- `.env`
- `.git`
- `node_modules`
- local build artifacts
- exported ZIP backups
