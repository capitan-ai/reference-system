# Apple Wallet Pass Template

This directory contains the template files for Apple Wallet passes.

## Required Files

The `pass.json` file is required. Image files are optional but recommended for better appearance.

## Optional Image Files

You can add these image files to improve the pass appearance:

- **icon.png** - 29x29px icon (required for notifications)
- **icon@2x.png** - 58x58px icon (for Retina displays)
- **logo.png** - 160x50px logo (appears at the top of the pass)
- **logo@2x.png** - 320x100px logo (for Retina displays)

## How to Add Images

1. Use your existing logo from `/public/logo.png` or `/public/logo.webp`
2. Resize images to the required dimensions
3. Save them in this directory with the exact filenames listed above
4. The pass generator will automatically include them

## Notes

- Images should be PNG format
- Use transparent backgrounds for best results
- The pass will work without images, but will look more basic

