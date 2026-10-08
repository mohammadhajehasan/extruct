import importlib, json
mods = ["fastapi","uvicorn","openai","httpx","numpy","cv2","PIL","fitz","openpyxl","pytesseract","pyzbar","multipart","pydantic"]
out = {}
for m in mods:
    try:
        importlib.import_module(m)
        out[m] = "OK"
    except Exception as e:
        out[m] = "MISSING: " + type(e).__name__ + ": " + str(e)[:120]
print(json.dumps(out, indent=1))
