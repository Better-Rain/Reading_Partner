# Reading Partner 0.3.0

## Highlights

- Added local OCR for scanned PDF pages using bundled Chinese and English Tesseract data.
- Added current-page OCR and full-document OCR actions.
- OCR results are written into the existing local text index, so search and AI document Q&A can use scanned pages after OCR.
- Added persistent OCR layout storage and a transparent OCR text layer for selecting text on scanned pages.
- Added collapsible left library and right inspector panels with a slim retained rail and smooth layout animation.
- Improved the reader status line so long status text stays on one line and only auto-scrolls when it overflows.

## Notes

- OCR is local and can be slow on long scanned PDFs. Full-document OCR can be cancelled from the reader toolbar.
- The OCR selection layer is line-based; word-level or character-level alignment can be improved in a future release.
