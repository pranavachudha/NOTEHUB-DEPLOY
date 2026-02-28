from fastapi import FastAPI, HTTPException, Depends, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, EmailStr
from typing import List, Optional
import sqlite3
import hashlib
import jwt
import datetime
import base64
import os
import uuid
import pytesseract
from PIL import Image
import io
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import inch
import textwrap
import requests as http_requests
import base64 as b64

app = FastAPI(title="NoteHub API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

SECRET_KEY = "notehub-super-secret-key-change-in-production"
ALGORITHM = "HS256"
security = HTTPBearer()

# ── Database ──────────────────────────────────────────────────────────────────

def get_db():
    conn = sqlite3.connect("notehub.db")
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS documents (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            title TEXT NOT NULL,
            extracted_text TEXT,
            pdf_base64 TEXT,
            image_count INTEGER DEFAULT 0,
            created_at TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    """)
    conn.commit()
    conn.close()

init_db()

# ── Auth helpers ──────────────────────────────────────────────────────────────

def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode()).hexdigest()

def create_token(user_id: str) -> str:
    payload = {
        "sub": user_id,
        "exp": datetime.datetime.utcnow() + datetime.timedelta(days=30)
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)

def verify_token(credentials: HTTPAuthorizationCredentials = Depends(security)) -> str:
    try:
        payload = jwt.decode(credentials.credentials, SECRET_KEY, algorithms=[ALGORITHM])
        return payload["sub"]
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

# ── Schemas ───────────────────────────────────────────────────────────────────

class SignupRequest(BaseModel):
    name: str
    email: str
    password: str

class LoginRequest(BaseModel):
    email: str
    password: str

class UserResponse(BaseModel):
    id: str
    name: str
    email: str
    created_at: str

# ── Auth Routes ───────────────────────────────────────────────────────────────

@app.post("/auth/signup")
def signup(body: SignupRequest):
    conn = get_db()
    existing = conn.execute("SELECT id FROM users WHERE email = ?", (body.email,)).fetchone()
    if existing:
        conn.close()
        raise HTTPException(status_code=400, detail="Email already registered")
    
    user_id = str(uuid.uuid4())
    created_at = datetime.datetime.utcnow().isoformat()
    conn.execute(
        "INSERT INTO users (id, name, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)",
        (user_id, body.name, body.email, hash_password(body.password), created_at)
    )
    conn.commit()
    conn.close()
    
    token = create_token(user_id)
    return {"token": token, "user": {"id": user_id, "name": body.name, "email": body.email, "created_at": created_at}}

@app.post("/auth/login")
def login(body: LoginRequest):
    conn = get_db()
    user = conn.execute(
        "SELECT * FROM users WHERE email = ? AND password_hash = ?",
        (body.email, hash_password(body.password))
    ).fetchone()
    conn.close()
    
    if not user:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    
    token = create_token(user["id"])
    return {"token": token, "user": dict(user)}

@app.get("/auth/me")
def me(user_id: str = Depends(verify_token)):
    conn = get_db()
    user = conn.execute("SELECT id, name, email, created_at FROM users WHERE id = ?", (user_id,)).fetchone()
    conn.close()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return dict(user)

def extract_text_from_image(image_bytes: bytes) -> str:
    try:
        image_b64 = b64.b64encode(image_bytes).decode("utf-8")

        res = http_requests.post(
            "http://localhost:11434/api/generate",
            json={
                "model": "llama3.2-vision",
                "prompt": "You are an OCR engine. Look at this image and transcribe ALL text you see, exactly as it appears, character by character. Do not summarize, explain, or add anything. Output only the raw text from the image.",
                "images": [image_b64],
                "stream": False
            },
            timeout=300
        )

        result = res.json()
        print("OLLAMA RESPONSE:", result.get("response", "")[:200])
        return result["response"].strip()

    except Exception as e:
        return f"[OCR Error: {str(e)}]"
    
def create_pdf(title: str, pages: List[dict]) -> bytes:
    """
    pages: list of {"image_bytes": bytes, "text": str}
    Returns PDF as bytes.
    """
    buffer = io.BytesIO()
    c = canvas.Canvas(buffer, pagesize=A4)
    width, height = A4

    for i, page in enumerate(pages):
        # Title on first page
        if i == 0:
            c.setFont("Helvetica-Bold", 20)
            c.drawString(inch, height - inch, title)
            c.setFont("Helvetica", 10)
            c.drawString(inch, height - 1.3 * inch, f"Generated by NoteHub • {datetime.datetime.now().strftime('%B %d, %Y')}")
            c.line(inch, height - 1.5 * inch, width - inch, height - 1.5 * inch)
            y_start = height - 2 * inch
        else:
            y_start = height - inch

        # Paste image (resized)
        if page.get("image_bytes"):
            try:
                img = Image.open(io.BytesIO(page["image_bytes"]))
                img_width, img_height = img.size
                max_w = width - 2 * inch
                max_h = 3.5 * inch
                ratio = min(max_w / img_width, max_h / img_height)
                new_w = img_width * ratio
                new_h = img_height * ratio
                img_path = f"/tmp/notehub_img_{uuid.uuid4()}.jpg"
                img.save(img_path, "JPEG")
                c.drawImage(img_path, inch, y_start - new_h, width=new_w, height=new_h)
                os.remove(img_path)
                y_start = y_start - new_h - 0.3 * inch
            except Exception:
                pass

        # Draw extracted text
        c.setFont("Helvetica-Bold", 11)
        c.drawString(inch, y_start, f"Extracted Text (Page {i+1})")
        y_start -= 0.2 * inch
        c.line(inch, y_start, width - inch, y_start)
        y_start -= 0.2 * inch

        c.setFont("Helvetica", 10)
        text = page.get("text", "No text detected.")
        wrapped = textwrap.wrap(text, width=90)
        for line in wrapped:
            if y_start < inch:
                c.showPage()
                y_start = height - inch
                c.setFont("Helvetica", 10)
            c.drawString(inch, y_start, line)
            y_start -= 0.18 * inch

        c.showPage()

    c.save()
    buffer.seek(0)
    return buffer.read()

# ── Document Routes ───────────────────────────────────────────────────────────

@app.post("/documents/create")
async def create_document(
    title: str = Form(...),
    images: List[UploadFile] = File(...),
    user_id: str = Depends(verify_token)
):
    pages = []
    all_text = []

    for img_file in images:
        img_bytes = await img_file.read()
        text = extract_text_from_image(img_bytes)
        pages.append({"image_bytes": img_bytes, "text": text})
        all_text.append(text)

    pdf_bytes = create_pdf(title, pages)
    pdf_b64 = base64.b64encode(pdf_bytes).decode()
    combined_text = "\n\n--- Page Break ---\n\n".join(all_text)

    doc_id = str(uuid.uuid4())
    created_at = datetime.datetime.utcnow().isoformat()

    conn = get_db()
    conn.execute(
        "INSERT INTO documents (id, user_id, title, extracted_text, pdf_base64, image_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (doc_id, user_id, title, combined_text, pdf_b64, len(images), created_at)
    )
    conn.commit()
    conn.close()

    return {
        "id": doc_id,
        "title": title,
        "extracted_text": combined_text,
        "image_count": len(images),
        "created_at": created_at
    }

@app.get("/documents")
def list_documents(user_id: str = Depends(verify_token)):
    conn = get_db()
    docs = conn.execute(
        "SELECT id, title, extracted_text, image_count, created_at FROM documents WHERE user_id = ? ORDER BY created_at DESC",
        (user_id,)
    ).fetchall()
    conn.close()
    return [dict(d) for d in docs]

@app.get("/documents/{doc_id}")
def get_document(doc_id: str, user_id: str = Depends(verify_token)):
    conn = get_db()
    doc = conn.execute(
        "SELECT * FROM documents WHERE id = ? AND user_id = ?",
        (doc_id, user_id)
    ).fetchone()
    conn.close()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    return dict(doc)

@app.delete("/documents/{doc_id}")
def delete_document(doc_id: str, user_id: str = Depends(verify_token)):
    conn = get_db()
    conn.execute("DELETE FROM documents WHERE id = ? AND user_id = ?", (doc_id, user_id))
    conn.commit()
    conn.close()
    return {"success": True}

@app.get("/")
def root():
    return {"message": "NoteHub API is running 📚"}
