# Handler Functions Implementation - Complete!

## What We Built

Successfully implemented custom JavaScript handler functions for the HTTP Request Mocker extension's companion server. This allows developers to:

1. **Generate dynamic responses** based on request parameters, method, headers, etc.
2. **Modify existing file responses** by adding timestamps, user data, filtering, etc.
3. **Implement complex business logic** using full Node.js environment capabilities

## Key Features Implemented

### 1. Handler Function API
- **Function signature**: `async (request, originalResponse) => responseObject`
- **Request object**: Contains `url`, `method`, `headers`, `body`, `query`, `timestamp`
- **Response object**: Must return `{ status, headers, body }`
- **File + Handler combination**: Handlers can modify responses from existing files

### 2. Configuration Extensions
Enhanced `.mocks/config.json` format supports:
```json
[
  { "pattern": "https://api.example.com/users", "file": "users.json" },
  { "pattern": "https://api.example.com/dynamic", "handler": "handlers/dynamic.js" },
  { "pattern": "https://api.example.com/enhanced", "file": "users.json", "handler": "handlers/modify.js" }
]
```

### 3. Hot Reload Support
- Handlers automatically reload when files change (requires `chokidar`)
- No server restart needed during development
- Install with: `npm run install-hot-reload`

### 4. Utility Libraries
Created helper functions in `utils/common-responses.js`:
- `success(data)` - Standard success response format
- `error(message, status)` - Standard error response format
- `json(data, status, headers)` - JSON response helper
- `text(content)` - Text response helper
- `html(content)` - HTML response helper

## Example Handlers Created

### 1. Dynamic Response (`handlers/dynamic-response.js`)
- Generates completely dynamic responses
- Different behavior for GET vs POST requests
- Query parameter processing
- **Test**: `GET /resolve?url=https://api.example.com/dynamic?name=Test&count=3`

### 2. Response Modifier (`handlers/modify-response.js`)
- Takes existing JSON file and adds dynamic fields
- Adds timestamps, request metadata, processing info
- Preserves original data structure
- **Test**: `GET /resolve?url=https://api.example.com/users/enhanced`

### 3. Search & Filter (`handlers/search-filter.js`)
- Implements search, sorting, and pagination on data
- Query parameters: `?q=searchterm&sort=field&order=asc&limit=10`
- Works with both files and fallback sample data
- **Test**: `GET /resolve?url=https://api.example.com/search?q=john&sort=name&limit=2`

## Technical Improvements Made

### 1. Fixed Pattern Matching
- **Problem**: Substring matching was too broad (e.g. "/users" matched "/users/enhanced")
- **Solution**: Two-pass matching - exact matches first, then substring matches
- **Result**: More specific patterns now take precedence

### 2. Enhanced File Path Resolution
- **Problem**: Relative paths with directories weren't resolving to `.mocks/` folder
- **Solution**: Always try `.mocks/` prefix first for relative paths
- **Result**: `"data/users.json"` correctly resolves to `.mocks/data/users.json`

### 3. Robust Error Handling
- Handler loading errors are caught and logged
- Invalid handler responses return proper error messages
- File read errors include detailed information
- All errors include context for debugging

## Directory Structure Created

```
.mocks/
├── handlers/
│   ├── dynamic-response.js      # Pure dynamic handler
│   ├── modify-response.js       # File + handler example
│   ├── search-filter.js         # Search & filter example
│   ├── README.md               # Handler development guide
│   └── utils/
│       └── common-responses.js  # Response helper functions
└── data/
    └── users.json              # Sample data file
```

## Testing Results

All handlers working correctly:

1. ✅ **Static files**: Original file-only mocking still works
2. ✅ **Dynamic responses**: Pure handler-based responses work
3. ✅ **File + Handler**: Combination approach modifies existing files
4. ✅ **Complex logic**: Search, filtering, and pagination implemented
5. ✅ **Hot reload**: Handler changes reload without server restart
6. ✅ **Error handling**: Proper errors for missing files, bad handlers, etc.

## Developer Experience

### Easy Development Workflow:
1. Create handler in `.mocks/handlers/`
2. Add rule to `.mocks/config.json`
3. Save changes (auto-reloads if chokidar installed)
4. Test immediately with curl or browser

### Rich Debugging:
- Server console shows handler execution
- Request/response logging
- Detailed error messages with stack traces
- Handler validation catches common mistakes

## Backward Compatibility

- ✅ All existing `.mocks/config.json` configurations work unchanged
- ✅ File-only mocking behavior preserved
- ✅ No breaking changes to existing API endpoints
- ✅ Optional dependency (chokidar) doesn't break if not installed

## Documentation Updated

- ✅ Enhanced `CLAUDE.md` with handler examples and testing instructions
- ✅ Created comprehensive `handlers/README.md` for development
- ✅ Updated server startup logs to mention handler capabilities
- ✅ Added `package.json` script for optional hot-reload setup

The implementation is complete, tested, and ready for production use! 🎉