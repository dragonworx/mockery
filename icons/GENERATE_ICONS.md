# Icon Generation Instructions

The Chrome extension requires PNG icons in three sizes:
- icon16.png (16x16 pixels)
- icon48.png (48x48 pixels)
- icon128.png (128x128 pixels)

## Option 1: Use the provided SVG

Convert `icon.svg` to PNG at different sizes using:

### Online Tool:
1. Visit https://svgtopng.com/ or https://cloudconvert.com/svg-to-png
2. Upload `icon.svg`
3. Convert to 16x16, 48x48, and 128x128 PNG files
4. Save as `icon16.png`, `icon48.png`, `icon128.png` in this folder

### Command Line (ImageMagick):
```bash
convert -background none icon.svg -resize 16x16 icon16.png
convert -background none icon.svg -resize 48x48 icon48.png
convert -background none icon.svg -resize 128x128 icon128.png
```

### Command Line (Inkscape):
```bash
inkscape icon.svg -w 16 -h 16 -o icon16.png
inkscape icon.svg -w 48 -h 48 -o icon48.png
inkscape icon.svg -w 128 -h 128 -o icon128.png
```

## Option 2: Create Custom Icons

You can create your own icons using any image editor:
- Adobe Photoshop
- GIMP (free)
- Figma (free)
- Canva (free)

Just ensure you export as PNG at the required sizes.

## Option 3: Temporary Placeholder

For testing purposes, you can use any PNG images you have available. The extension will work with any PNG files named correctly, though they should ideally be square and simple.

## Quick Test Setup

If you want to test the extension immediately without icons, you can temporarily comment out the icon references in `manifest.json`:

```json
// "action": {
//   "default_popup": "popup.html"
// },
```

The extension will use Chrome's default extension icon until you add proper icons.
