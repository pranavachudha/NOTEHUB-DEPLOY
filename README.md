# NoteHub 📚

> Capture notes with your camera → AI extracts text (via LLaVA) → save as searchable PDF

## Prerequisites

| Requirement | Link |
|---|---|
| Python 3.10+ | https://www.python.org/downloads/ |
| Node.js 18+ | https://nodejs.org/ |
| Ollama (runs LLaVA for OCR) | https://ollama.com/download |
| Expo Go app (on your phone) | App Store / Play Store |

## Quick Start

### 1. Start Ollama + pull the LLaVA model

```bash
# After installing Ollama, pull the vision model (one-time, ~4 GB):
ollama pull llava

# Keep Ollama running in the background (it starts automatically on most systems)
```

### 2. Backend (FastAPI)

```bash
cd backend

# Create & activate virtual environment
python -m venv venv

# Windows:
venv\Scripts\activate
# macOS/Linux:
source venv/bin/activate

pip install -r requirements.txt
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### 3. Frontend (React Native / Expo Go)

```bash
cd frontend
npm install
```

> ⚠️ **Important:** Open `services/api.js` and set `BASE_URL` to your machine's **local network IP** (not `localhost`).
> Your phone and laptop must be on the **same Wi-Fi network**.
>
> **Windows:** Run `ipconfig` → look for your IPv4 address (e.g. `192.168.1.42`)
> **macOS/Linux:** Run `ip addr` or `ifconfig`
>
> ```js
> export const BASE_URL = "http://192.168.1.42:8000";  // ← change this
> ```

```bash
npx expo start
```

Scan the QR code with the **Expo Go** app on your phone.

## Architecture

```
notehub/
├── backend/
│   ├── main.py            # FastAPI app (auth + OCR via Ollama + PDF generation)
│   ├── requirements.txt
│   └── notehub.db         # Auto-created SQLite database (git-ignored)
│
└── frontend/
    ├── app/
    │   ├── auth/          # Login + Signup
    │   └── tabs/          # Capture | Docs | Profile
    ├── context/
    │   └── AuthContext.jsx
    └── services/
        └── api.js         # ← Set BASE_URL here
```

## Tech Stack

| Layer    | Tech                                     |
|----------|------------------------------------------|
| Frontend | React Native, Expo Go, NativeWind        |
| Backend  | FastAPI, Python                          |
| OCR      | Ollama + LLaVA (local AI vision model)   |
| PDF      | ReportLab                                |
| Database | SQLite                                   |
| Auth     | JWT (HS256)                              |
