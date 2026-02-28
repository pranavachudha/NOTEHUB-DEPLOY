# NoteHub 📚

> Capture notes with your camera → extract text via OCR → save as PDF

## Quick Start

### 1. Backend (FastAPI)

```bash
cd backend

# Install system dependency (Tesseract OCR)
# macOS:   brew install tesseract
# Ubuntu:  sudo apt-get install tesseract-ocr
# Windows: https://github.com/UB-Mannheim/tesseract/wiki

pip install -r requirements.txt
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### 2. Frontend (React Native / Expo Go)

```bash
cd frontend
npm install

# Edit services/api.js → set BASE_URL to your LAN IP
# e.g. "http://192.168.1.42:8000"

npx expo start
```

Scan the QR code in Expo Go.

## Architecture

```
notehub/
├── backend/
│   ├── main.py            # FastAPI app (auth + OCR + PDF generation)
│   ├── requirements.txt
│   └── notehub.db         # Auto-created SQLite database
│
└── frontend/
    ├── app/
    │   ├── (auth)/        # Login + Signup
    │   └── (tabs)/        # Capture | Docs | Profile
    ├── context/
    │   └── AuthContext.jsx
    └── services/
        └── api.js
```

## Tech Stack

| Layer    | Tech                                |
|----------|-------------------------------------|
| Frontend | React Native, Expo Go, NativeWind   |
| Backend  | FastAPI, Python                     |
| OCR      | Tesseract via pytesseract           |
| PDF      | ReportLab                           |
| Database | SQLite                              |
| Auth     | JWT (HS256)                         |
