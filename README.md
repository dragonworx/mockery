# HTTP Request Mocker - Chrome Extension with Node.js Server

A comprehensive Chrome extension with companion Node.js server for intercepting HTTP requests and returning mock responses. Perfect for frontend development, testing, and API simulation without modifying backend services.

## Features

### Chrome Extension
- **Manifest V3** - Modern Chrome extension architecture
- **Advanced Request Interception** - Patches `fetch()` and `XMLHttpRequest` in the page context
- **Live Toast Notifications** - Visual feedback when requests are intercepted
- **Real-time Activity Tracking** - Monitor intercepted requests in the popup
- **Persistent Storage** - Rules and configuration persist across sessions
- **Enable/Disable Toggle** - Quick on/off control
- **Server Connection Status** - Visual indicator of server connectivity

### Node.js Companion Server
- **Zero Dependencies** - Pure Node.js server with no external packages
- **Hot Configuration Reload** - Automatically reloads `.mocks.json` when changed
- **File Upload Support** - Upload mock files directly from the extension
- **RESTful API** - Full CRUD operations for rules management
- **Health Monitoring** - Built-in health check endpoint
- **Flexible Matching** - Supports both exact string and regex pattern matching
- **MIME Type Detection** - Automatic content-type headers based on file extension
- **CORS Enabled** - Configured for extension communication

## Installation

### Chrome Extension

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" (toggle in top-right corner)
4. Click "Load unpacked"
5. Select the extension directory (containing `manifest.json`)

### Node.js Server

1. Navigate to the project directory
2. Start the server:
   ```bash
   npm start
   # or
   node mock-server.js
   ```
3. Server runs on `http://localhost:8756` by default

**Custom Configuration:**
```bash
# Custom port
node mock-server.js 9000

# Custom config file
node mock-server.js --config ./my-mocks.json

# Both
node mock-server.js 9000 --config ./my-mocks.json
```

## Quick Start

### 1. Start the Server
```bash
npm start
```

### 2. Configure the Extension
1. Click the extension icon in Chrome
2. Verify server connection (green dot = connected)
3. If offline, check the server URL (default: `http://localhost:8756`)

### 3. Add Your First Mock
1. In the extension popup, click "Choose file..."
2. Upload a JSON file with your mock response
3. Enter a URL pattern to match (e.g., `api.example.com/users`)
4. Check "Regex" if using regex patterns
5. Click "Add Rule"

### 4. Test It
1. Enable mocking with the toggle switch
2. Navigate to a page that makes the matching request
3. See the toast notification confirming interception
4. Check the "Activity" tab for intercepted requests

## Configuration

### Mock Configuration File (`.mocks.json`)

The server reads rules from `.mocks.json` in the working directory:

```json
[
  {
    "pattern": "https://api.example.com/users",
    "file": "./stubs/users.json",
    "isRegex": false
  },
  {
    "pattern": ".*\\.commbank\\.com\\.au.*address-book\\.json.*",
    "file": "./stubs/address-book.json",
    "isRegex": true
  }
]
```

**Fields:**
- `pattern` - URL pattern to match (string or regex)
- `file` - Path to mock file relative to config file location
- `isRegex` - Boolean indicating if pattern is a regex (optional, default: false)

### File Structure

```
http-request-mocker/
├── package.json              # Node.js package configuration
├── mock-server.js           # Companion Node.js server
├── .mocks.json             # Server configuration file
├── manifest.json           # Chrome extension config
├── background.js          # Extension service worker
├── content.js            # Content script (toast notifications)
├── content-bridge.js     # Bridge between content scripts
├── mock-injector.js     # Main-world script (request interception)
├── popup.html           # Extension popup UI
├── popup.js            # Popup logic and server communication
├── popup.css          # Popup styling
├── icons/            # Extension icons
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── mocks/           # Example mock files
│   ├── address-book.json
│   ├── users-list.json
│   ├── auth-login.json
│   └── error-404.json
└── stubs/          # Server mock files (auto-created)
    └── test.json
```

## Usage Examples

### Example 1: Banking API Mock

**Mock File (`stubs/address-book.json`):**
```json
{
  "addressBook": [
    {
      "id": "123",
      "nickname": "John's Account",
      "bsb": "062-001",
      "accountNumber": "12345678"
    }
  ]
}
```

**Rule Configuration:**
```json
{
  "pattern": ".*commbank.com.au.*address-book.*json.*",
  "file": "./stubs/address-book.json",
  "isRegex": true
}
```

### Example 2: User Authentication

**Mock File (`stubs/login-success.json`):**
```json
{
  "success": true,
  "user": {
    "id": 12345,
    "username": "testuser",
    "token": "mock-jwt-token-here"
  }
}
```

**Rule Configuration:**
```json
{
  "pattern": "https://api.myapp.com/auth/login",
  "file": "./stubs/login-success.json",
  "isRegex": false
}
```

### Example 3: API Error Simulation

**Mock File (`stubs/404-error.json`):**
```json
{
  "error": {
    "code": 404,
    "message": "User not found",
    "details": "The requested user ID does not exist"
  }
}
```

## Server API Endpoints

### GET `/health`
Check server status and rule count
```bash
curl http://localhost:8756/health
# Response: {"ok": true, "rules": 3}
```

### GET `/rules`
List all current rules
```bash
curl http://localhost:8756/rules
```

### POST `/rules`
Add a new rule
```bash
curl -X POST http://localhost:8756/rules \
  -H "Content-Type: application/json" \
  -d '{"pattern": "api.test.com", "file": "./stubs/test.json"}'
```

### DELETE `/rules`
Remove a rule by pattern
```bash
curl -X DELETE http://localhost:8756/rules \
  -H "Content-Type: application/json" \
  -d '{"pattern": "api.test.com"}'
```

### POST `/upload`
Upload a mock file
```bash
curl -X POST http://localhost:8756/upload \
  -H "Content-Type: application/json" \
  -d '{"filename": "test.json", "content": "{\"test\": true}"}'
# Response: {"ok": true, "file": "./stubs/test.json"}
```

### GET `/resolve?url=<encoded_url>`
Resolve a mock for a specific URL (used by extension)
```bash
curl "http://localhost:8756/resolve?url=https%3A//api.test.com/users"
```

## Pattern Matching

### Exact String Matching
```json
{
  "pattern": "https://api.example.com/users",
  "file": "./stubs/users.json",
  "isRegex": false
}
```
Matches:
- `https://api.example.com/users` (exact)
- `https://api.example.com/users?page=1` (contains)

### Regex Matching
```json
{
  "pattern": ".*api\\.example\\.com.*users.*",
  "file": "./stubs/users.json",
  "isRegex": true
}
```
Matches:
- `https://api.example.com/v1/users`
- `https://beta.api.example.com/users?filter=active`

**Common Regex Patterns:**

| Pattern | Description | Matches |
|---------|-------------|---------|
| `.*api\.example\.com.*` | Any request to api.example.com | `https://api.example.com/anything` |
| `.*\.json$` | URLs ending in .json | `https://site.com/data.json` |
| `^https://staging\..*` | URLs starting with staging | `https://staging.myapp.com/api` |
| `.*user/\d+/profile.*` | User profile endpoints | `https://api.com/user/123/profile` |

## Debugging

### Extension Console Logs
1. Open Chrome DevTools (F12)
2. Check Console for `[HTTP Mocker]` messages
3. View Service Worker logs at `chrome://extensions/`

### Server Logs
```bash
[mock-server] Listening on http://localhost:8756
[mock-server] Config: /path/to/.mocks.json
[mock-server] Loaded 2 rule(s) from /path/to/.mocks.json
[mock-server] ✓ https://api.example.com/users → ./stubs/users.json (application/json)
[mock-server] Rule added: api.test.com → ./stubs/test.json
```

### Activity Monitoring
The extension popup shows real-time activity:
- **Activity Tab**: Recently intercepted requests with timestamps
- **Rules Tab**: Current server rules with pattern/file mappings
- **Status Indicator**: Server connection status

### Troubleshooting

**Server connection issues:**
- Verify server is running: `curl http://localhost:8756/health`
- Check firewall/antivirus blocking port 8756
- Ensure no other service is using port 8756

**Rules not matching:**
- Test regex patterns in browser console: `new RegExp('your-pattern').test('actual-url')`
- Check for typos in patterns or file paths
- Verify mock files exist in the specified location

**File upload failures:**
- Ensure valid JSON format
- Check file permissions in stubs directory
- Verify server has write permissions

## Development

### Making Changes

**Extension:**
1. Modify source files
2. Go to `chrome://extensions/`
3. Click refresh icon on extension
4. Reload test pages

**Server:**
1. Modify `mock-server.js`
2. Restart server: `npm start`
3. Configuration changes (`.mocks.json`) reload automatically

### Adding Features

**Key Files:**
- `background.js` - Message handling between extension and server
- `mock-injector.js` - Request interception in page context
- `popup.js` - UI logic and server communication
- `mock-server.js` - Server-side rule management and file serving

## Supported File Types

The server automatically detects MIME types:
- `.json` → `application/json`
- `.html` → `text/html`
- `.xml` → `application/xml`
- `.js` → `application/javascript`
- `.css` → `text/css`
- `.csv` → `text/csv`
- `.txt` → `text/plain`
- `.svg` → `image/svg+xml`
- Default → `application/octet-stream`

## License

MIT License - Feel free to modify and use as needed.

## Credits

- Built with Chrome Extensions Manifest V3
- Uses `declarativeNetRequest` and `fetch` APIs
- Zero-dependency Node.js server implementation

---

**Version:** 1.0.0
**Server Port:** 8756 (default)
**Last Updated:** January 2025