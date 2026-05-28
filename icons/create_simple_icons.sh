#!/bin/bash

# Create simple colored PNG icons using ImageMagick (if available)
# or provide instructions for manual creation

if command -v convert &> /dev/null; then
    echo "ImageMagick found, creating icons..."
    
    # Create 16x16 icon
    convert -size 16x16 xc:none -fill "#667eea" -draw "rectangle 0,0 16,16" \
            -fill white -draw "circle 8,5 8,7" \
            -fill white -draw "circle 5,11 5,12" \
            -fill white -draw "circle 11,11 11,12" \
            icon16.png
    
    # Create 48x48 icon
    convert -size 48x48 xc:none -fill "#667eea" -draw "rectangle 0,0 48,48" \
            -fill white -draw "circle 24,16 24,20" \
            -fill white -draw "circle 16,32 16,36" \
            -fill white -draw "circle 32,32 32,36" \
            -stroke white -strokewidth 2 -fill none \
            -draw "line 24,20 16,32" \
            -draw "line 24,20 32,32" \
            icon48.png
    
    # Create 128x128 icon
    convert -size 128x128 xc:none -fill "#667eea" -draw "rectangle 0,0 128,128" \
            -fill white -draw "circle 64,40 64,48" \
            -fill white -draw "circle 40,88 40,96" \
            -fill white -draw "circle 88,88 88,96" \
            -stroke white -strokewidth 4 -fill none \
            -draw "line 64,48 40,88" \
            -draw "line 64,48 88,88" \
            icon128.png
    
    echo "Icons created successfully!"
else
    echo "ImageMagick not found. Creating minimal PNG files..."
    
    # Create minimal 1x1 PNG and resize (base64 encoded minimal PNG)
    # This is a tiny valid PNG that will work but won't look great
    echo "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAEklEQVR42mNk+M/AAAUjGYYAM9gBCejuYvYAAAAASUVORK5CYII=" | base64 -d > icon16.png
    echo "iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAAEklEQVR42mNk+M/AAAUjGYYAM9gBCejuYvYAAAAASUVORK5CYII=" | base64 -d > icon48.png
    echo "iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADDPmHLAAAAEklEQVR42mNk+M/AAAUjGYYAM9gBCejuYvYAAAAASUVORK5CYII=" | base64 -d > icon128.png
    
    echo "Basic placeholder icons created. For better icons, see GENERATE_ICONS.md"
fi
