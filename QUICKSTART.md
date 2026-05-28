# Quick Start Guide

## Installation (5 minutes)

1. **Open Chrome Extensions Page**
   - Navigate to `chrome://extensions/`
   - Or click ⋮ menu → Extensions → Manage Extensions

2. **Enable Developer Mode**
   - Toggle "Developer mode" in the top-right corner

3. **Load the Extension**
   - Click "Load unpacked" button
   - Select this folder (the one containing `manifest.json`)
   - Extension should now appear in your toolbar

## First Mock Setup (2 minutes)

### Example: Mock CommBank Address Book API

1. **Open the Extension Popup**
   - Click the extension icon in your Chrome toolbar

2. **Add a Rule**
   - **Pattern:** `.*stg\.commbank\.com\.au.*address-book\.json.*`
   - **Filename:** `address-book.json`
   - Click "Add Rule"

3. **Enable the Extension**
   - Toggle the switch at the top to "Enabled"

4. **Test It**
   - Visit a page that makes this request
   - Check DevTools Console for `[HTTP Mocker]` logs
   - The request should return data from `mocks/address-book.json`

## Creating Your Own Mocks

### 1. Create a Mock File

Create a new JSON file in the `mocks/` folder:

```bash
# Example: mocks/users.json
{
  "users": [
    {"id": 1, "name": "Alice"},
    {"id": 2, "name": "Bob"}
  ]
}
```

### 2. Add a Rule

- **Pattern:** Create a regex to match the URL
  - Example: `.*api\.example\.com/users.*`
  - Tip: Use `.*` for "any characters"

- **Filename:** Enter your mock file name
  - Example: `users.json`

### 3. Test Your Rule

Open DevTools Console to see:
- `[HTTP Mocker] Rule matched:` - When your rule intercepts a request
- `[HTTP Mocker] Added X new rules` - When rules are updated

## Common Patterns

| Use Case | Pattern | Example URL |
|----------|---------|-------------|
| Specific endpoint | `.*api\.mysite\.com/endpoint.*` | https://api.mysite.com/endpoint |
| All JSON files | `.*\.json$` | Any URL ending in .json |
| Specific domain | `^https://example\.com/.*` | All requests to example.com |
| API v2 | `.*api/v2/.*` | Any API v2 endpoint |

## Troubleshooting

### Not working?

1. ✅ Is the extension enabled? (check toggle in popup)
2. ✅ Does the pattern match the URL? Test in console:
   ```javascript
   new RegExp('your-pattern').test('actual-url')
   ```
3. ✅ Is the mock file in the `mocks/` folder?
4. ✅ Did you refresh the page after adding the rule?

### Still stuck?

- Check the extension console: `chrome://extensions/` → "service worker"
- Check the page console: Look for `[HTTP Mocker]` messages
- Verify the mock file is valid JSON

## Next Steps

- Read the full [README.md](README.md) for detailed documentation
- Add more mock files to the `mocks/` folder
- Experiment with different regex patterns
- Toggle the extension off when you want real API responses

## Pro Tips

1. **Quick disable/enable:** Use the toggle instead of removing rules
2. **Test patterns:** Use browser console to test regex before adding rules
3. **Organize mocks:** Use descriptive filenames like `users-list.json`, `user-profile.json`
4. **Debug mode:** Keep DevTools Console open to see when rules match

---

**Need help?** Check the [README.md](README.md) or inspect the code comments.
