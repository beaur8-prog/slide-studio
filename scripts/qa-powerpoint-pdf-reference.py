"""Render the publisher's existing PowerPoint PDF, without editing it."""
import hashlib
import json
from pathlib import Path
import sys
import pypdfium2 as pdfium
from pypdf import PdfReader

source = Path(sys.argv[1])
output = Path(sys.argv[2])
pages = [1, 2, 22, 50, 75, 113, 151]
reader = PdfReader(source)
assert len(reader.pages) == 151
document = pdfium.PdfDocument(source)
result = {"sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
          "metadata": {str(k): str(v) for k, v in reader.metadata.items()},
          "pageCount": len(reader.pages), "renderer": "PDFium via pypdfium2",
          "pages": []}
for number in pages:
    page = document[number - 1]
    bitmap = page.render(scale=4 / 3)
    image = bitmap.to_pil()
    filename = f"powerpoint-pdf-{number:03}.png"
    image.save(output / filename)
    result["pages"].append({"page": number, "image": filename,
                            "width": image.width, "height": image.height,
                            "text": reader.pages[number - 1].extract_text()})
    image.close()
    bitmap.close()
    page.close()
document.close()
(output / "pdf.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")

