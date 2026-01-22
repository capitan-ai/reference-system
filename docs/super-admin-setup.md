# Super Admin Setup Guide

## ✅ Completed Implementation

### 1. Database Schema
- ✅ Updated `organization_users` table to support `super_admin` role
- ✅ `super_admin` has `organization_id = NULL` (not tied to specific organization)
- ✅ Added constraints to ensure super_admin always has NULL organization_id
- ✅ Added unique index to ensure only one super_admin record per user

### 2. Prisma Schema
- ✅ Added `super_admin` to `OrganizationUserRole` enum
- ✅ Made `organization_id` optional (nullable) in `OrganizationUser` model
- ✅ Updated relation to allow NULL organization

### 3. Helper Functions
- ✅ `isSuperAdmin(userId)` - Check if user is super admin
- ✅ `isSuperAdminFromRequest(request)` - Check super admin from request token
- ✅ `checkOrganizationAccess()` - Updated to grant super admin access to all organizations

### 4. API Endpoints

#### POST `/api/admin/super-admin/assign`
Assign super admin role to a user (only super admin can do this).

**Headers:**
```
Authorization: Bearer <super_admin_token>
```

**Request:**
```json
{
  "email": "admin@system.com"
}
```

**Response:**
```json
{
  "success": true,
  "message": "User admin@system.com is now super admin"
}
```

#### GET `/api/admin/organizations`
Get all organizations with statistics (super admin only).

**Headers:**
```
Authorization: Bearer <super_admin_token>
```

**Response:**
```json
{
  "organizations": [
    {
      "id": "uuid",
      "square_merchant_id": "MLJSE2F6EE60D",
      "created_at": "2024-01-01T00:00:00Z",
      "locations": [...],
      "stats": {
        "bookings": 38520,
        "payments": 27910,
        "customers": 7399,
        "users": 5
      }
    }
  ]
}
```

#### GET `/api/auth/me` (Updated)
Returns user info. For super admin, returns all organizations.

**Super Admin Response:**
```json
{
  "user": {
    "id": "uuid",
    "email": "admin@system.com",
    "is_super_admin": true,
    "organizations": [
      {
        "organization_id": "uuid",
        "role": "super_admin",
        "organization": {
          "id": "uuid",
          "square_merchant_id": "MLJSE2F6EE60D",
          "locations": [...],
          "stats": {...}
        }
      }
    ]
  }
}
```

## Creating First Super Admin

### Option 1: Via SQL (Recommended for first super admin)

1. Create user in Supabase Auth dashboard
2. Get user ID from Supabase Dashboard > Authentication > Users
3. Run SQL:

```sql
INSERT INTO organization_users (user_id, organization_id, role, is_primary)
VALUES ('<SUPABASE_USER_ID>', NULL, 'super_admin', false);
```

### Option 2: Via API (After first super admin exists)

```javascript
POST /api/admin/super-admin/assign
{
  "email": "new-admin@system.com"
}
```

## Super Admin Capabilities

1. **Access All Organizations**: Super admin can access any organization's data
2. **View All Organizations**: See list of all organizations with statistics
3. **Assign Super Admin**: Can promote other users to super admin
4. **System-Wide Access**: Not limited to single organization

## Security Notes

- Only super admin can assign super admin role
- Super admin bypasses organization-level access checks
- Super admin has `organization_id = NULL` in database
- Use `isSuperAdminFromRequest()` to protect admin endpoints

## Usage in Code

### Check if user is super admin:
```javascript
import { isSuperAdminFromRequest } from '../../../../lib/auth/check-access'

export async function GET(request) {
  const isSuperAdmin = await isSuperAdminFromRequest(request)
  if (!isSuperAdmin) {
    return Response.json({ error: 'Unauthorized' }, { status: 403 })
  }
  // Super admin logic...
}
```

### Check organization access (super admin auto-granted):
```javascript
import { checkOrganizationAccess } from '../../../../lib/auth/check-access'

export async function GET(request, { params }) {
  const { organizationId } = params
  
  const access = await checkOrganizationAccess(request, organizationId, ['owner', 'admin', 'viewer'])
  if (!access) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  
  // access.isSuperAdmin tells you if user is super admin
  // Super admin has access to all organizations automatically
}
```

## Database Constraints

- `super_admin` role → `organization_id` MUST be NULL
- Other roles → `organization_id` MUST be NOT NULL
- Only one super_admin record per user (enforced by unique index)

