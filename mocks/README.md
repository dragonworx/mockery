# How to add mocks

## File System Management (Recommended)

Add mock files to the `mocks/` folder and configure URL patterns in `.mocks.json`:

1. **Add mock files** to the `mocks/` folder (or subfolders for organization)
2. **Edit `.mocks.json`** to add URL patterns and file paths
3. **Server automatically reloads** when `.mocks.json` changes

### Example Configuration
```json
[
  {
    "pattern": "api/users",
    "file": "mocks/users.json",
    "isRegex": false
  },
  {
    "pattern": ".*\\.example\\.com.*images.*",
    "file": "mocks/images/logo.png",
    "isRegex": true
  }
]
```

## Supported File Types

The extension supports a comprehensive range of MIME types:

### Text & Data
- **JSON** (`users.json`) - API responses, configuration data
- **HTML** (`page.html`) - Web pages, templates
- **XML** (`config.xml`) - Configuration files, SOAP responses
- **CSV** (`data.csv`) - Spreadsheet data
- **Plain text** (`readme.txt`) - Documentation, logs

### Images
- **PNG, JPG, GIF, WebP** - Web images
- **SVG** - Vector graphics, icons
- **ICO** - Favicons
- **BMP, TIFF** - Other image formats

### Documents
- **PDF** (`document.pdf`) - Printable documents
- **Office docs** (`.doc`, `.docx`, `.xls`, `.xlsx`) - Microsoft Office files

### Web Assets
- **JavaScript** (`script.js`) - Client-side code
- **CSS** (`styles.css`) - Stylesheets
- **Fonts** (`.woff`, `.woff2`, `.ttf`, `.otf`) - Web fonts

### Media & Archives
- **Audio** (`.mp3`, `.wav`) - Sound files
- **Video** (`.mp4`, `.avi`) - Video files
- **Archives** (`.zip`, `.tar`, `.gz`) - Compressed files

### Organization Examples
```
mocks/
├── api/
│   ├── users.json
│   ├── orders.json
│   └── auth/
│       └── login.json
├── images/
│   ├── logo.png
│   ├── avatar.jpg
│   └── icons/
│       └── star.svg
├── documents/
│   ├── manual.pdf
│   └── template.docx
├── assets/
│   ├── styles.css
│   ├── app.js
│   └── fonts/
│       └── roboto.woff2
└── data.csv
```

## Binary File Handling

The extension properly handles binary files by:
- Auto-detecting MIME types from file extensions
- Converting binary data to base64 during transport
- Reconstructing proper binary responses in the browser
- Supporting XMLHttpRequest responseTypes (`arraybuffer`, `blob`)
- Maintaining correct Content-Type headers

This means you can mock **any file type** - from JSON APIs to images to PDFs!