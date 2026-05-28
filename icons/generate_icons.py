#!/usr/bin/env python3
"""
Generate placeholder PNG icons for the Chrome extension.
This creates simple colored squares as temporary icons.
"""

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    print("PIL/Pillow not installed. Install with: pip install Pillow")
    print("Or use the SVG and online converter mentioned in GENERATE_ICONS.md")
    exit(1)

def create_icon(size, filename):
    """Create a simple gradient icon with size text"""
    # Create image with gradient background
    img = Image.new('RGB', (size, size), color='white')
    draw = ImageDraw.Draw(img)

    # Draw gradient-like background (purple gradient)
    for i in range(size):
        ratio = i / size
        r = int(102 + (118 - 102) * ratio)
        g = int(126 + (75 - 126) * ratio)
        b = int(234 + (162 - 234) * ratio)
        draw.rectangle([(0, i), (size, i+1)], fill=(r, g, b))

    # Draw network-like symbol
    if size >= 32:
        # Draw circles (nodes)
        node_size = max(2, size // 16)
        center_y = size // 3
        draw.ellipse([(size//2 - node_size, center_y - node_size),
                     (size//2 + node_size, center_y + node_size)],
                    fill='white')

        bottom_y = size * 2 // 3
        left_x = size // 3
        right_x = size * 2 // 3

        draw.ellipse([(left_x - node_size, bottom_y - node_size),
                     (left_x + node_size, bottom_y + node_size)],
                    fill='white')
        draw.ellipse([(right_x - node_size, bottom_y - node_size),
                     (right_x + node_size, bottom_y + node_size)],
                    fill='white')

        # Draw lines
        line_width = max(1, size // 40)
        draw.line([(size//2, center_y), (left_x, bottom_y)],
                 fill='white', width=line_width)
        draw.line([(size//2, center_y), (right_x, bottom_y)],
                 fill='white', width=line_width)

    # Save
    img.save(filename, 'PNG')
    print(f"Created {filename} ({size}x{size})")

# Generate all required sizes
sizes = [(16, 'icon16.png'), (48, 'icon48.png'), (128, 'icon128.png')]

for size, filename in sizes:
    create_icon(size, filename)

print("\nIcons generated successfully!")
print("You can now load the extension in Chrome.")
