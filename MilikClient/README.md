# MILIK Property Management - Client

A modern, responsive property management application built with React, featuring comprehensive tools for managing properties, tenants, landlords, and financial operations.

## 🎨 Tech Stack

- **Framework**: React 18 with Vite
- **Styling**: Tailwind CSS v4
- **State Management**: Redux Toolkit + Redux Persist
- **Data Fetching**: React Query + Axios
- **Routing**: React Router v6
- **Charts**: Recharts
- **Build Tool**: Vite

## 🚀 Quick Start

### Prerequisites

- Node.js >= 18.0.0
- npm or yarn
- MILIK API running (see [MilikApi](https://github.com/erickmurigi/MilikApi))

### Installation

1. Clone the repository
```bash
git clone https://github.com/erickmurigi/MilikClient.git
cd MilikClient
```

2. Install dependencies
```bash
npm install
```

3. Configure environment variables

Copy `.env.example` to `.env` and update with your API URL:

```bash
cp .env.example .env
```

Required environment variables:
```env
VITE_API_URL=http://localhost:8800/api
VITE_APP_NAME=MILIK Property Management
VITE_STORAGE_KEY=replace-with-a-long-random-key-min-32-chars
```

4. Start development server
```bash
npm run dev
```

The application will be available at `http://localhost:5173`

## 📦 Build

```bash
# Build for production
npm run build

# Preview production build
npm run preview
```

## 🏗️ Project Structure

```
MilikClient/
├── public/              # Static assets
├── src/
│   ├── assets/         # Images, fonts, etc.
│   ├── components/     # Reusable components
│   │   ├── AddCompany/
│   │   ├── CompanySetup/
│   │   ├── Dashboard/
│   │   ├── Landlord/
│   │   ├── Layout/
│   │   ├── Modals/
│   │   ├── Properties/
│   │   ├── StartMenu/
│   │   └── Units/
│   ├── context/        # React Context providers
│   │   ├── AuthContext.jsx
│   │   ├── BusinessContext.jsx
│   │   └── TabContext.jsx
│   ├── pages/          # Page components
│   │   ├── companySetup/
│   │   ├── Dashboard/
│   │   ├── Home/
│   │   ├── Landlord/
│   │   ├── Lease/
│   │   ├── Login/
│   │   ├── Maintenances/
│   │   ├── Properties/
│   │   ├── SystemSetup/
│   │   ├── Tenants/
│   │   └── Units/
│   ├── redux/          # Redux store and slices
│   │   ├── store.js
│   │   ├── authSlice.js
│   │   ├── companiesRedux.js
│   │   ├── propertyRedux.js
│   │   ├── landlordRedux.js
│   │   ├── tenantRedux.js
│   │   └── ...
│   ├── utils/          # Utility functions
│   │   └── requestMethods.js  # Axios client
│   ├── App.jsx         # Main app component
│   ├── main.jsx        # Entry point
│   └── index.css       # Global styles
├── .env.example        # Environment variables template
├── .gitignore
├── eslint.config.js
├── index.html
├── package.json
├── tailwind.config.js
└── vite.config.js
```

## ✨ Features

### 🏢 Company Management
- Multi-company support
- Company setup and configuration
- Business information management

### 🏘️ Property Management
- Property listing and details
- Property code generation
- Multi-property overview
- Property statistics and analytics

### 🏠 Unit Management
- Unit creation and editing
- Occupancy tracking
- Rent and utility management
- Unit status (vacant/occupied/maintenance)

### 👥 Tenant Management
- Tenant profiles
- Lease tracking
- Payment history
- Document management

### 🏪 Landlord Management
- Landlord profiles
- Property associations
- Contact information
- Performance statistics

### 💰 Financial Management
- Rent payment tracking
- Receipt generation
- Expense management
- Payment method support (Cash, M-Pesa, Bank Transfer, etc.)

### 📊 Dashboard & Analytics
- Property occupancy overview
- Revenue tracking
- Maintenance requests
- Notifications center

### 🔐 Authentication & Authorization
- Secure JWT-based authentication
- Role-based access control
- Company-scoped data access
- Session persistence

### 📱 Responsive Design
- Mobile-first approach
- Tablet and desktop optimized
- Modern UI/UX

## 🎨 Styling

The application uses Tailwind CSS v4 for styling:

```bash
# Tailwind configuration
tailwind.config.js

# Global styles
src/index.css
```

## 🔄 State Management

### Redux Store
- **Auth**: User authentication and session
- **Companies**: Company data and selection
- **Properties**: Property listings and details
- **Units**: Unit management
- **Tenants**: Tenant information
- **Landlords**: Landlord data
- **Leases**: Lease agreements
- **Payments**: Payment records

### Redux Persistence
User authentication and selected company persist across sessions.

## 🌐 API Integration

The application communicates with the MILIK API through a centralized Axios client:

```javascript
// src/utils/requestMethods.js
import { adminRequests } from './utils/requestMethods';

// Automatically includes JWT token
const response = await adminRequests.get('/properties');
```

Key features:
- Automatic token attachment
- Request/response interceptors
- Error handling
- 401 auto-redirect to login

## 🔐 Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `VITE_API_URL` | Backend API URL | Yes |
| `VITE_APP_NAME` | Application name | No |
| `VITE_APP_VERSION` | Application version | No |
| `VITE_NODE_ENV` | Environment mode | No |

## 📱 Features by Role

### System Administrator
- Full system access
- Multi-company management
- User management
- System configuration

### Super Admin
- Company-level admin access
- All company features
- User management within company

### Admin
- Property management
- Tenant management
- Financial operations
- Reporting

### Manager
- Property operations
- Tenant coordination
- Maintenance tracking

### Accountant
- Financial reporting
- Payment management
- Expense tracking

### Agent
- Property showings
- Tenant applications
- Basic operations

### Viewer
- Read-only access
- Reports and analytics

## 🚢 Deployment

### Vercel (Current)
The application is deployed on Vercel: [milik-client.vercel.app](https://milik-client.vercel.app)

```bash
# Deploy to Vercel
vercel --prod
```

### Other Platforms

#### Netlify
```bash
# Build command
npm run build

# Publish directory
dist
```

#### AWS S3 + CloudFront
```bash
npm run build
aws s3 sync dist/ s3://your-bucket-name
```

## 🧪 Development

### Code Style
- ESLint configured for React best practices
- Consistent component structure
- Modern React patterns (hooks, functional components)

### Best Practices
- Component composition
- Custom hooks for reusable logic
- Context for cross-cutting concerns
- Redux for global state
- React Query for server state

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

- Built with modern React best practices
- Designed for scalability and maintainability
- User-centric design approach

## 📞 Support

For support, email support@milik.com or open an issue on GitHub.

---

**Live Demo**: [milik-client.vercel.app](https://milik-client.vercel.app)
**API Documentation**: [MilikApi README](https://github.com/erickmurigi/MilikApi)


## 🚀 Hosting / Deployment Checklist

Before deploying the frontend:

1. Set **`VITE_API_URL`** to your real production API URL, for example:

```env
VITE_API_URL=https://api.example.com/api
```

2. Build from a clean Linux install:

```bash
npm ci
npm run build
```

3. Because the app uses **React Router BrowserRouter**, configure your host to rewrite unknown routes to `index.html`.
4. Do not deploy local artifacts such as `.git`, `node_modules`, or old `dist` folders copied from another machine.
5. Use the `.env.production.example` file as a template for production env variables.

### SPA rewrite reminder

Your hosting platform must return `index.html` for app routes such as:
- `/login`
- `/home`
- `/dashboard`
- `/reports/*`

Without rewrites, direct refreshes on nested routes will fail.
