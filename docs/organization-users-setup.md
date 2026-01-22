# Organization Users & Roles Setup

## ✅ Completed Implementation

### 1. Database Schema
- ✅ Created `organization_users` table with:
  - `user_id` (Supabase Auth user ID)
  - `organization_id` (FK to organizations)
  - `role` (owner, admin, viewer)
  - `is_primary` (boolean - main organization for user)
- ✅ Added trigger to ensure only one primary organization per user
- ✅ Added indexes for performance
- ✅ Enabled RLS (Row Level Security)

### 2. Prisma Schema
- ✅ Added `OrganizationUser` model
- ✅ Added `OrganizationUserRole` enum
- ✅ Updated `Organization` model with relation

### 3. API Endpoints

#### POST `/api/auth/signup`
Registers a new user and creates/links to organization.

**Request:**
```json
{
  "email": "owner@salon.com",
  "password": "secure-password",
  "organizationName": "My Salon",
  "squareMerchantId": "MLJSE2F6EE60D"
}
```

**Response:**
```json
{
  "success": true,
  "user": {
    "id": "uuid",
    "email": "owner@salon.com",
    "role": "owner",
    "is_primary": true,
    "organization": {
      "id": "uuid",
      "square_merchant_id": "MLJSE2F6EE60D",
      "locations": [...]
    }
  }
}
```

**Logic:**
- Creates Supabase Auth user
- Finds or creates organization by `square_merchant_id`
- First user in organization → `owner` role
- First organization for user → `is_primary = true`

#### GET `/api/auth/me`
Returns current authenticated user with all organizations.

**Headers:**
```
Authorization: Bearer <supabase_session_token>
```

**Response:**
```json
{
  "user": {
    "id": "uuid",
    "email": "owner@salon.com",
    "primary_organization": {
      "organization_id": "uuid",
      "role": "owner",
      "is_primary": true,
      "organization": {
        "id": "uuid",
        "square_merchant_id": "MLJSE2F6EE60D",
        "locations": [...]
      }
    },
    "organizations": [...]
  }
}
```

#### POST `/api/auth/primary-organization`
Changes user's primary organization.

**Request:**
```json
{
  "organizationId": "uuid"
}
```

**Headers:**
```
Authorization: Bearer <supabase_session_token>
```

### 4. Helper Functions

#### `checkOrganizationAccess(request, organizationId, allowedRoles)`
Verifies user token and checks organization access.

**Usage:**
```javascript
import { checkOrganizationAccess } from '../../../../lib/auth/check-access'

export async function GET(request, { params }) {
  const { organizationId } = params
  
  const access = await checkOrganizationAccess(request, organizationId, ['owner', 'admin'])
  if (!access) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  
  // access.user - Supabase user
  // access.organizationUser - OrganizationUser record with role
  // access.organizationUser.organization.locations - All locations
}
```

#### `getPrimaryOrganization(userId)`
Gets user's primary organization.

#### `getUserFromRequest(request)`
Extracts user from request token.

## Environment Variables Required

Add to `.env`:

```env
# Supabase Auth
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

## Key Features

1. **One Primary Organization**: Each user has exactly one primary organization (enforced by database trigger)
2. **Automatic Role Assignment**: First user in organization becomes `owner`
3. **Multiple Locations**: Organization can have multiple locations (already supported)
4. **Access Control**: Helper functions for protecting API endpoints

## Next Steps

1. Configure Supabase Auth in your Supabase dashboard
2. Add environment variables to `.env`
3. Test registration endpoint
4. Implement RLS policies (if needed)
5. Integrate with Lovable dashboard frontend

## Database Structure

```
organizations (1) ──< (many) organization_users (many) >── (1) auth.users
                      |
                      └── role: owner/admin/viewer
                      └── is_primary: true/false

organizations (1) ──< (many) locations
```

