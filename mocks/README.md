# Example Mock Files

This folder contains example mock JSON files that you can use as templates or for testing.

## Included Examples

### 1. `address-book.json`
Mock response for a banking address book API.

**Use case:** CommBank address book endpoint

**Example pattern:** `.*address-book\.json.*`

**Contains:**
- Contact list with names, account numbers, BSB codes
- Bank information
- Contact types (domestic, business)

---

### 2. `users-list.json`
Mock response for a user list API endpoint.

**Use case:** Generic user management system

**Example pattern:** `.*api/users.*` or `.*users\.json.*`

**Contains:**
- Array of user objects
- User profiles with roles and status
- Pagination metadata

---

### 3. `auth-login.json`
Mock successful authentication response.

**Use case:** Login endpoints

**Example pattern:** `.*api/auth/login.*` or `.*login\.json.*`

**Contains:**
- JWT token
- Refresh token
- User profile
- Permissions

---

### 4. `error-404.json`
Mock error response for testing error handling.

**Use case:** Testing error states

**Example pattern:** `.*api/missing.*` or `.*error.*`

**Contains:**
- Error status
- Error code (404)
- Error message and details

---

## Creating Your Own Mocks

### Template Structure

```json
{
  "success": true,
  "data": {
    // Your actual response data here
  },
  "metadata": {
    "timestamp": "2024-01-15T10:30:00Z"
  }
}
```

### Tips

1. **Match real API structure:** Copy the structure from a real API response
2. **Use realistic data:** Make test data believable
3. **Include edge cases:** Create separate files for empty states, errors, etc.
4. **Name descriptively:** Use names like `product-list-empty.json`, `user-profile-admin.json`

### Common Response Types

**Success Response:**
```json
{
  "success": true,
  "data": { /* your data */ }
}
```

**Error Response:**
```json
{
  "success": false,
  "error": {
    "code": 400,
    "message": "Bad request"
  }
}
```

**Paginated Response:**
```json
{
  "data": [ /* items */ ],
  "pagination": {
    "page": 1,
    "pageSize": 10,
    "total": 100
  }
}
```

## Adding Mock Files

1. Create a new `.json` file in this folder
2. Add your mock response data
3. Open the extension popup
4. Add a rule with the filename
5. Test on a page that makes the request

## Testing Your Mocks

### Method 1: Browser Console
```javascript
fetch('https://api.example.com/users')
  .then(r => r.json())
  .then(console.log)
```

### Method 2: DevTools Network Tab
1. Open DevTools (F12)
2. Go to Network tab
3. Trigger the request
4. Check if it's redirected to your mock

### Method 3: Console Logs
Look for these messages in the console:
- `[HTTP Mocker] Rule matched:` - Request was intercepted
- `[HTTP Mocker] Added X new rules` - Rules were updated

## Advanced Examples

### Dynamic User Profile
Create multiple versions:
- `user-profile-admin.json` - Admin user
- `user-profile-regular.json` - Regular user
- `user-profile-guest.json` - Guest user

Then switch between them by updating the rule.

### API State Progression
Create a sequence:
- `order-pending.json` - Initial state
- `order-processing.json` - Processing state
- `order-completed.json` - Final state

Change the rule to show different states.

### Error Testing
Create various errors:
- `error-400.json` - Bad request
- `error-401.json` - Unauthorized
- `error-403.json` - Forbidden
- `error-404.json` - Not found
- `error-500.json` - Server error

## Best Practices

✅ **DO:**
- Use descriptive filenames
- Format JSON properly (use a formatter)
- Include realistic test data
- Document what each mock is for
- Test your mocks before using in production testing

❌ **DON'T:**
- Include sensitive real data (passwords, tokens, etc.)
- Use special characters in filenames
- Forget to validate JSON syntax
- Hardcode today's date (use relative dates)
- Mix different API versions in one file

## Need More Examples?

Check online mock API services for inspiration:
- JSONPlaceholder (https://jsonplaceholder.typicode.com/)
- Mocky (https://designer.mocky.io/)
- ReqRes (https://reqres.in/)

Copy their response structures and modify for your needs.
