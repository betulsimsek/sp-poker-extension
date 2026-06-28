#!/usr/bin/env python3
# Run: python3 generate.py
# Requires: pip install Pillow
try:
    from PIL import Image, ImageDraw, ImageFont
    for size in [16, 48, 128]:
        img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
        draw = ImageDraw.Draw(img)
        draw.rounded_rectangle([0, 0, size-1, size-1], radius=size//6, fill=(137, 180, 250))
        text = "SP"
        try:
            font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", size // 2)
        except:
            font = ImageFont.load_default()
        bbox = draw.textbbox((0, 0), text, font=font)
        tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
        draw.text(((size - tw) // 2, (size - th) // 2 - bbox[1]), text, fill=(30, 30, 46), font=font)
        img.save(f"icon{size}.png")
    print("Icons generated.")
except ImportError:
    print("Pillow not installed. Run: pip3 install Pillow, then: python3 generate.py")
