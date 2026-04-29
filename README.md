# BillSplitter v2

Modern household bill splitter built with Node.js, React, TypeScript, and Firebase.

## Tech Stack

- **Frontend**: React 18 + TypeScript + Vite + Tailwind CSS
- **Backend**: Node.js + Express (Firebase Functions)
- **Database**: Firebase Firestore
- **Authentication**: Firebase Auth (Google OAuth)
- **Hosting**: Firebase Hosting
- **Charts**: Recharts

## Project Structure

```
billsplitter-v2/
├── functions/              # Firebase Functions (Backend)
│   ├── src/
│   │   ├── config/        # Firebase configuration
│   │   ├── models/        # TypeScript interfaces
│   │   ├── routes/        # API routes
│   │   ├── middleware/    # Auth & error handling
│   │   └── services/      # Business logic
│   └── package.json
├── client/                # React Frontend
│   ├── src/
│   │   ├── components/    # Reusable components
│   │   ├── pages/         # Page components
│   │   ├── hooks/         # Custom React hooks
│   │   ├── context/       # React Context
│   │   ├── services/      # API services
│   │   ├── types/         # TypeScript types
│   │   └── utils/         # Utility functions
│   └── package.json
├── firebase.json          # Firebase configuration
├── firestore.rules        # Firestore security rules
└── README.md
```

## Setup Instructions

### 1. Prerequisites

- Node.js 18+
- Firebase CLI: `npm install -g firebase-tools`
- Google account (for Firebase)

### 2. Create Firebase Project

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Create a new project: "billsplitter-v2"
3. Enable the following services:
   - **Authentication**: Enable Google Sign-in
   - **Firestore Database**: Create database (Start in production mode)
   - **Hosting**: Enable for frontend deployment
   - **Functions**: Enable for backend

### 3. Get Firebase Configuration

1. In Firebase Console, go to Project Settings → General
2. Scroll to "Your apps" section
3. Click "Web App" → Register app
4. Copy the `firebaseConfig` object

### 4. Get Service Account Key (for Functions)

1. Go to Project Settings → Service Accounts
2. Click "Generate new private key"
3. Save as `functions/service-account.json`
4. **Important**: Never commit this file to git!

### 5. Install Dependencies

```bash
# Install root dependencies
npm install

# Install functions dependencies
cd functions
npm install
cd ..

# Install client dependencies
cd client
npm install
cd ..
```

Or use the convenience script:
```bash
npm run install:all
```

### 6. Configure Environment Variables

**Root `.env`:**
```env
FIREBASE_PROJECT_ID=billsplitter-v2
FIREBASE_CLIENT_ID=your-google-client-id
FIREBASE_AUTH_DOMAIN=billsplitter-v2.firebaseapp.com
FIREBASE_API_KEY=your-api-key
FIREBASE_STORAGE_BUCKET=billsplitter-v2.appspot.com
FIREBASE_MESSAGING_SENDER_ID=your-sender-id
FIREBASE_APP_ID=your-app-id
```

**Functions `.env`:**
```env
FIREBASE_SERVICE_ACCOUNT_PATH=./service-account.json
```

**Client `.env`:**
```env
VITE_FIREBASE_API_KEY=your-api-key
VITE_FIREBASE_AUTH_DOMAIN=billsplitter-v2.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=billsplitter-v2
VITE_FIREBASE_STORAGE_BUCKET=billsplitter-v2.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=your-sender-id
VITE_FIREBASE_APP_ID=your-app-id
```

### 7. Update Firebase Project ID

Edit `.firebaserc`:
```json
{
  "projects": {
    "default": "your-project-id"
  }
}
```

### 8. Deploy Firestore Rules and Indexes

```bash
firebase deploy --only firestore:rules,firestore:indexes
```

### 9. Development

**Run locally with emulators:**
```bash
firebase emulators:start
```

**Run frontend dev server:**
```bash
cd client
npm run dev
```

### 10. Production Deployment

**Deploy everything:**
```bash
firebase deploy
```

**Deploy specific services:**
```bash
firebase deploy --only hosting
firebase deploy --only functions
firebase deploy --only firestore
```

## Features

### Implemented
- ✅ Project structure with TypeScript
- ✅ Firebase Functions backend with Express
- ✅ React frontend with Vite
- ✅ Tailwind CSS for styling
- ✅ Google OAuth authentication
- ✅ Bill calculation logic
- ✅ Basic routing (Landing, Dashboard, Calculator, Results, History)
- ✅ Firestore security rules
- ✅ Responsive design

### TODO
- ⏳ Chart components (Trends, Sankey, Pie charts)
- ⏳ Household management (create, join, invite)
- ⏳ Multi-user real-time sync
- ⏳ Expense history with filtering
- ⏳ Transfer status tracking
- ⏳ Data migration from MongoDB

## API Endpoints

### Authentication
- `POST /api/auth/google` - Exchange Google token for Firebase token

### Households
- `GET /api/households` - Get user's households
- `POST /api/households` - Create household
- `GET /api/households/:id` - Get household details
- `POST /api/households/:id/join` - Join household with invite code
- `DELETE /api/households/:id/members/:userId` - Remove member

### Expenses
- `GET /api/expenses?householdId=:id&month=:month` - Get expenses
- `POST /api/expenses` - Create expense calculation
- `GET /api/expenses/:id` - Get expense details
- `PUT /api/expenses/:id/transfers/:index` - Update transfer status

### Users
- `GET /api/users/me` - Get current user

## Firestore Data Structure

### users/{userId}
```typescript
{
  id: string;
  name: string;
  email: string;
  avatar?: string;
  households: string[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

### households/{householdId}
```typescript
{
  id: string;
  name: string;
  createdBy: string;
  inviteCode: string;
  members: {
    [userId: string]: {
      name: string;
      role: 'admin' | 'member';
      joinedAt: Timestamp;
    };
  };
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

### expenses/{expenseId}
```typescript
{
  id: string;
  householdId: string;
  createdBy: string;
  month: string;
  bills: number;
  contributors: {
    [name: string]: {
      income: number;
      contribution: number;
      remaining: number;
    };
  };
  transfers: {
    from: string;
    to: string;
    amount: number;
    status: 'pending' | 'completed';
  }[];
  targetRemainingBalance: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

## License

MIT
# Billsplitter v2
