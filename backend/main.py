from fastapi import FastAPI, HTTPException, Depends, UploadFile, File, Form, Request
from fastapi.middleware.cors import CORSMiddleware
import json
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
from dotenv import load_dotenv

load_dotenv()
import cv2
import numpy as np
from PIL import Image
import io
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import inch
import textwrap
import requests as http_requests
import base64 as b64
import threading
from fastapi import BackgroundTasks

app = FastAPI(title="NoteHub API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

SECRET_KEY = os.getenv("SECRET_KEY", "notehub-dev-secret-key-do-not-use-in-prod")
ALGORITHM = "HS256"
PASSWORD_SALT = "notehub-salt-v1" # Simple salt for sha256
security = HTTPBearer()

# Semaphore to ensure only one OCR job runs at a time on the laptop
ocr_semaphore = threading.Semaphore(1)

# ── Database ──────────────────────────────────────────────────────────────────

def get_db():
    db_path = os.getenv("DB_PATH", "notehub.db")
    # Increase timeout to 30 seconds to wait for other processes
    conn = sqlite3.connect(db_path, timeout=30)
    # Enable WAL mode for better concurrency (allows simultaneous reads and writes)
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            username TEXT UNIQUE,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            is_verified INTEGER DEFAULT 0,
            otp_code TEXT,
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
            status TEXT DEFAULT 'completed', -- 'pending', 'processing', 'completed', 'failed'
            error_message TEXT,
            created_at TEXT NOT NULL,
            is_channel_copy INTEGER DEFAULT 0,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS channels (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            admin_id TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY (admin_id) REFERENCES users(id)
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS channel_members (
            channel_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'member',
            joined_at TEXT NOT NULL,
            PRIMARY KEY (channel_id, user_id),
            FOREIGN KEY (channel_id) REFERENCES channels(id),
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    """)
    # Migrations
    for query in [
        "ALTER TABLE users ADD COLUMN username TEXT",
        "ALTER TABLE users ADD COLUMN is_verified INTEGER DEFAULT 1",
        "ALTER TABLE users ADD COLUMN otp_code TEXT",
        "ALTER TABLE documents ADD COLUMN is_channel_copy INTEGER DEFAULT 0",
        "ALTER TABLE documents ADD COLUMN status TEXT DEFAULT 'completed'",
        "ALTER TABLE documents ADD COLUMN error_message TEXT",
        "ALTER TABLE channel_members ADD COLUMN role TEXT NOT NULL DEFAULT 'member'"
    ]:
        try:
            conn.execute(query)
            conn.commit()
            print(f"Migration success: {query}")
        except sqlite3.OperationalError as e:
            if "duplicate column name" in str(e) or "already exists" in str(e):
                pass
            else:
                print(f"Migration error for {query}: {e}")
        
    try:
        conn.execute("ALTER TABLE channel_notes ADD COLUMN order_index INTEGER DEFAULT 0")
        conn.execute("ALTER TABLE channel_notes ADD COLUMN heading TEXT")
        conn.execute("ALTER TABLE channel_notes ADD COLUMN subheading TEXT")
    except sqlite3.OperationalError:
        pass
        
    conn.execute("""
        CREATE TABLE IF NOT EXISTS channel_notes (
            id TEXT PRIMARY KEY,
            channel_id TEXT NOT NULL,
            document_id TEXT NOT NULL,
            status TEXT NOT NULL,
            submitted_by TEXT NOT NULL,
            submitted_at TEXT NOT NULL,
            order_index INTEGER DEFAULT 0,
            heading TEXT,
            subheading TEXT,
            FOREIGN KEY (channel_id) REFERENCES channels(id),
            FOREIGN KEY (document_id) REFERENCES documents(id),
            FOREIGN KEY (submitted_by) REFERENCES users(id)
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS notifications (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            type TEXT NOT NULL,
            sender_id TEXT NOT NULL,
            reference_id TEXT,
            status TEXT NOT NULL DEFAULT 'unread',
            created_at TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (sender_id) REFERENCES users(id)
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS document_pages (
            id TEXT PRIMARY KEY,
            document_id TEXT NOT NULL,
            page_number INTEGER NOT NULL,
            image_bytes BLOB,
            extracted_text TEXT,
            FOREIGN KEY (document_id) REFERENCES documents(id)
        )
    """)
    conn.commit()
    conn.close()

init_db()

# ── Auth helpers ──────────────────────────────────────────────────────────────

def hash_password(password: str) -> str:
    return hashlib.sha256((password + PASSWORD_SALT).encode()).hexdigest()

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

# ── Email Helpers ─────────────────────────────────────────────────────────────

SMTP_HOST = os.getenv("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD")

def send_otp_email(target_email: str, otp: str):
    if not SMTP_USER or not SMTP_PASSWORD:
        print(f"\n[MOCK EMAIL] To: {target_email}\nSubject: NoteHub Verification Code\nBody: Your code is {otp}\n")
        return

    import smtplib
    from email.mime.text import MIMEText
    from email.mime.multipart import MIMEMultipart

    msg = MIMEMultipart()
    msg['From'] = SMTP_USER
    msg['To'] = target_email
    msg['Subject'] = "NoteHub - Verify your email"

    body = f"""
    Hi there,

    Welcome to NoteHub! Your verification code is:

    {otp}

    Enter this code in the app to complete your registration.

    Best,
    The NoteHub Team
    """
    msg.attach(MIMEText(body, 'plain'))

    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
            server.starttls()
            server.login(SMTP_USER, SMTP_PASSWORD)
            server.send_message(msg)
            print(f"Email sent to {target_email}")
    except Exception as e:
        print(f"Failed to send email: {e}")

# ── Schemas ───────────────────────────────────────────────────────────────────

class SignupRequest(BaseModel):
    name: str
    username: str
    email: EmailStr
    password: str

class LoginRequest(BaseModel):
    email: EmailStr
    password: str

class UserResponse(BaseModel):
    id: str
    name: str
    username: str
    email: str
    created_at: str

class ChannelCreate(BaseModel):
    name: str
    description: Optional[str] = None

class SubmitNoteRequest(BaseModel):
    document_id: str

class RoleUpdate(BaseModel):
    role: str

class DocumentUpdate(BaseModel):
    title: str
    extracted_text: str

class ChannelUpdate(BaseModel):
    name: str
    description: Optional[str] = None

class ReorderRequest(BaseModel):
    submission_ids: List[str]

# ── Auth Routes ───────────────────────────────────────────────────────────────

@app.post("/auth/signup")
def signup(body: SignupRequest):
    conn = get_db()
    
    # Self-healing migrations
    try:
        conn.execute("SELECT username FROM users LIMIT 1")
    except sqlite3.OperationalError:
        try:
            conn.execute("ALTER TABLE users ADD COLUMN username TEXT")
            conn.execute("ALTER TABLE users ADD COLUMN is_verified INTEGER DEFAULT 1")
            conn.execute("ALTER TABLE users ADD COLUMN otp_code TEXT")
            conn.commit()
        except:
            pass
    
    # Check email
    existing_email = conn.execute("SELECT id FROM users WHERE email = ?", (body.email,)).fetchone()
    if existing_email:
        conn.close()
        raise HTTPException(status_code=400, detail="Email already registered")
        
    # Check username
    existing_user = conn.execute("SELECT id FROM users WHERE username = ?", (body.username.lower(),)).fetchone()
    if existing_user:
        conn.close()
        raise HTTPException(status_code=400, detail="Username already taken")
    
    user_id = str(uuid.uuid4())
    created_at = datetime.datetime.utcnow().isoformat()
    
    # Generate OTP
    import random
    otp = str(random.randint(100000, 999999))
    
    # Auto-verify specific accounts
    is_verified = 1 if body.email in ['bruh@bruh', 'admin@admin'] else 0
    
    conn.execute(
        "INSERT INTO users (id, name, username, email, password_hash, is_verified, otp_code, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (user_id, body.name, body.username.lower(), body.email, hash_password(body.password), is_verified, otp, created_at)
    )
    conn.commit()
    conn.close()
    
    # Send email
    send_otp_email(body.email, otp)
    
    return {"message": "Signup successful", "email": body.email, "is_verified": is_verified, "otp_debug": otp}

class VerifyRequest(BaseModel):
    email: EmailStr
    otp: str

@app.post("/auth/verify")
def verify_email(body: VerifyRequest):
    conn = get_db()
    user = conn.execute("SELECT * FROM users WHERE email = ? AND otp_code = ?", (body.email, body.otp)).fetchone()
    if not user:
        conn.close()
        raise HTTPException(status_code=400, detail="Invalid OTP")
        
    conn.execute("UPDATE users SET is_verified = 1, otp_code = NULL WHERE id = ?", (user["id"],))
    conn.commit()
    conn.close()
    return {"success": True}

@app.post("/auth/login")
def login(body: LoginRequest):
    conn = get_db()
    user = conn.execute(
        "SELECT * FROM users WHERE email = ?",
        (body.email,)
    ).fetchone()
    
    if not user:
        conn.close()
        raise HTTPException(status_code=401, detail="Invalid credentials")

    # Password bypass for test accounts as requested
    is_test_account = user["email"] in ['bruh@bruh', 'admin@admin']
    
    if not is_test_account and user["password_hash"] != hash_password(body.password):
        conn.close()
        raise HTTPException(status_code=401, detail="Invalid password")
    
    # Auto-verify test accounts on login if they aren't verified yet
    if user["is_verified"] == 0 and is_test_account:
        conn.execute("UPDATE users SET is_verified = 1 WHERE id = ?", (user["id"],))
        conn.commit()
        # Refresh user record
        user = conn.execute("SELECT * FROM users WHERE id = ?", (user["id"],)).fetchone()

    if user["is_verified"] == 0:
        conn.close()
        raise HTTPException(status_code=403, detail="Email not verified")
        
    token = create_token(user["id"])
    conn.close()
    return {"token": token, "user": dict(user)}

@app.get("/auth/me")
def me(user_id: str = Depends(verify_token)):
    conn = get_db()
    user = conn.execute("SELECT id, name, email, created_at FROM users WHERE id = ?", (user_id,)).fetchone()
    conn.close()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return dict(user)

def preprocess_image(image_bytes: bytes) -> bytes:
    """
    OpenCV preprocessing pipeline to improve OCR accuracy:
      1. Decode to numpy array
      2. Convert to grayscale
      3. Denoise (fastNlMeansDenoising)
      4. Adaptive threshold (improves contrast on uneven lighting)
      5. Re-encode to JPEG bytes
    """
    nparr = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

    # Resize if very large — keeps detail but reduces Ollama payload
    max_dim = 1600
    h, w = img.shape[:2]
    if max(h, w) > max_dim:
        scale = max_dim / max(h, w)
        img = cv2.resize(img, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    denoised = cv2.fastNlMeansDenoising(gray, h=10, templateWindowSize=7, searchWindowSize=21)
    thresh = cv2.adaptiveThreshold(
        denoised, 255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        blockSize=31, C=10
    )

    success, buf = cv2.imencode(".jpg", thresh, [cv2.IMWRITE_JPEG_QUALITY, 90])
    if not success:
        return image_bytes  # fall back to original if encoding fails
    return buf.tobytes()


def warp_perspective(image_bytes: bytes, points: List[dict]) -> bytes:
    """
    Performs perspective transformation (deskewing) on an image based on 4 points.
    points: List of 4 dicts [{"x": 0.1, "y": 0.1}, ...] in normalized coordinates (0-1).
    Expected order: Top-Left, Top-Right, Bottom-Right, Bottom-Left
    """
    try:
        nparr = np.frombuffer(image_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is None: return image_bytes
        h, w = img.shape[:2]

        src_pts = np.float32([[p["x"] * w, p["y"] * h] for p in points])
        
        width_a = np.sqrt(((src_pts[2][0] - src_pts[3][0]) ** 2) + ((src_pts[2][1] - src_pts[3][1]) ** 2))
        width_b = np.sqrt(((src_pts[1][0] - src_pts[0][0]) ** 2) + ((src_pts[1][1] - src_pts[0][1]) ** 2))
        max_width = max(int(width_a), int(width_b))

        height_a = np.sqrt(((src_pts[1][0] - src_pts[2][0]) ** 2) + ((src_pts[1][1] - src_pts[2][1]) ** 2))
        height_b = np.sqrt(((src_pts[0][0] - src_pts[3][0]) ** 2) + ((src_pts[0][1] - src_pts[3][1]) ** 2))
        max_height = max(int(height_a), int(height_b))

        dst_pts = np.float32([
            [0, 0],
            [max_width - 1, 0],
            [max_width - 1, max_height - 1],
            [0, max_height - 1]
        ])

        matrix = cv2.getPerspectiveTransform(src_pts, dst_pts)
        warped = cv2.warpPerspective(img, matrix, (max_width, max_height))

        success, buf = cv2.imencode(".jpg", warped, [cv2.IMWRITE_JPEG_QUALITY, 95])
        return buf.tobytes() if success else image_bytes
    except Exception as e:
        print(f"Warp error: {e}")
        return image_bytes

def extract_text_from_image(image_bytes: bytes) -> str:
    try:
        processed = preprocess_image(image_bytes)
        image_b64 = b64.b64encode(processed).decode("utf-8")

        ollama_url = os.getenv("OLLAMA_URL", "http://localhost:11434")
        ollama_model = os.getenv("OLLAMA_MODEL", "llava")
        res = http_requests.post(
            f"{ollama_url}/api/generate",
            json={
                "model": ollama_model,
                "prompt": "Extract all text from this image exactly as written, including any handwriting. Return only the extracted text, nothing else.",
                "images": [image_b64],
                "stream": False
            },
            timeout=480  # 8 min — llama3.2-vision is heavier, needs more time on CPU
        )

        result = res.json()
        print("OLLAMA RESPONSE:", result.get("response", "")[:200])
        return result["response"].strip()

    except Exception as e:
        return f"[OCR Error: {str(e)}]"

def run_ocr_background(doc_id: str):
    """
    Background worker that processes all 'pending' pages for a document.
    Uses a semaphore to ensure only one Ollama request runs at a time.
    """
    conn = get_db()
    doc = conn.execute("SELECT title FROM documents WHERE id = ?", (doc_id,)).fetchone()
    if not doc:
        conn.close()
        return

    pages = conn.execute("SELECT id, image_bytes FROM document_pages WHERE document_id = ? AND (extracted_text IS NULL OR extracted_text = '')", (doc_id,)).fetchall()
    
    all_extracted = []
    
    try:
        conn.execute("UPDATE documents SET status = 'processing' WHERE id = ?", (doc_id,))
        conn.commit()
        
        for p in pages:
            with ocr_semaphore:
                text = extract_text_from_image(p["image_bytes"])
                conn.execute("UPDATE document_pages SET extracted_text = ? WHERE id = ?", (text, p["id"]))
                conn.commit()
                all_extracted.append(text)

        # Re-generate PDF with all pages
        all_pages = conn.execute("SELECT image_bytes, extracted_text FROM document_pages WHERE document_id = ? ORDER BY page_number ASC", (doc_id,)).fetchall()
        pdf_bytes = create_pdf(doc["title"], [dict(ap) for ap in all_pages])
        pdf_b64 = base64.b64encode(pdf_bytes).decode()
        
        combined_text = "\n\n--- Page Break ---\n\n".join([ap["extracted_text"] or "" for ap in all_pages])
        
        conn.execute(
            "UPDATE documents SET extracted_text = ?, pdf_base64 = ?, status = 'completed' WHERE id = ?",
            (combined_text, pdf_b64, doc_id)
        )
        conn.commit()
    except Exception as e:
        print(f"Background OCR Error: {e}")
        conn.execute("UPDATE documents SET status = 'failed', error_message = ? WHERE id = ?", (str(e), doc_id))
        conn.commit()
    finally:
        conn.close()
    
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
            except Exception as e:
                print(f"PDF Image error: {e}")

        # Text
        c.setFont("Helvetica", 11)
        text = page.get("text", "")
        lines = []
        for line in text.split('\n'):
            wrapped = textwrap.wrap(line, width=80)
            lines.extend(wrapped if wrapped else [""])
            
        for line in lines:
            if y_start < inch:
                c.showPage()
                y_start = height - inch
            c.drawString(inch, y_start, line)
            y_start -= 14
        
        if i < len(pages) - 1:
            c.showPage()

    c.save()
    return buffer.getvalue()

def create_channel_pdf(channel_name: str, notes: List[dict]) -> bytes:
    buffer = io.BytesIO()
    c = canvas.Canvas(buffer, pagesize=A4)
    width, height = A4
    
    # Simple Header
    c.setFont("Helvetica-Bold", 26)
    c.drawCentredString(width/2, height - 1.5*inch, channel_name.upper())
    c.line(inch, height - 1.8*inch, width - inch, height - 1.8*inch)
    
    y = height - 2.2*inch
    for note in notes:
        # Check for new page
        if y < 1.5*inch:
            c.showPage()
            y = height - inch
            
        # Heading
        if note.get("heading"):
            c.setFont("Helvetica-Bold", 16)
            c.drawString(inch, y, note["heading"])
            y -= 22
            
        # Subheading
        if note.get("subheading"):
            c.setFont("Helvetica-Oblique", 12)
            c.setFillColorRGB(0.3, 0.3, 0.3) # Dark grey
            c.drawString(inch, y, note["subheading"])
            c.setFillColorRGB(0, 0, 0) # Reset to black
            y -= 18
            
        # Content
        c.setFont("Helvetica", 11)
        text = note.get("extracted_text", "")
        lines = []
        for line in text.split('\n'):
            wrapped = textwrap.wrap(line, width=75)
            lines.extend(wrapped if wrapped else [""])
            
        for line in lines:
            if y < inch:
                c.showPage()
                y = height - inch
            c.drawString(inch, y, line)
            y -= 14
        
        y -= 30 # Spacing between notes
        if y < inch:
            c.showPage()
            y = height - inch
        else:
            c.setDash(1, 2)
            c.line(inch, y + 15, width - inch, y + 15)
            c.setDash()
        
    c.save()
    return buffer.getvalue()

@app.get("/channels/{channel_id}/export-pdf")
def export_channel_pdf(channel_id: str, user_id: str = Depends(verify_token)):
    conn = get_db()
    channel = conn.execute("SELECT name FROM channels WHERE id = ?", (channel_id,)).fetchone()
    if not channel:
        conn.close()
        raise HTTPException(status_code=404, detail="Channel not found")
        
    member = conn.execute("SELECT 1 FROM channel_members WHERE channel_id = ? AND user_id = ?", (channel_id, user_id)).fetchone()
    if not member:
        conn.close()
        raise HTTPException(status_code=403, detail="Must be a member to export")
        
    notes = conn.execute("""
        SELECT cn.submitted_at, d.extracted_text, u.name as author_name
        FROM channel_notes cn
        JOIN documents d ON cn.document_id = d.id
        JOIN users u ON cn.submitted_by = u.id
        WHERE cn.channel_id = ? AND cn.status = 'approved'
        ORDER BY cn.order_index ASC, cn.submitted_at ASC
    """, (channel_id,)).fetchall()
    conn.close()
    
    pdf_bytes = create_channel_pdf(channel["name"], [dict(n) for n in notes])
    pdf_b64 = base64.b64encode(pdf_bytes).decode()
    return {"pdf_base64": pdf_b64, "filename": f"{channel['name']}_notes.pdf"}


# ── Document Routes ───────────────────────────────────────────────────────────

@app.post("/documents/create")
async def create_document(background_tasks: BackgroundTasks, request: Request, user_id: str = Depends(verify_token)):
    form = await request.form()
    title = form.get("title", "").strip()
    if not title:
        raise HTTPException(status_code=422, detail="title is required")

    image_files = []
    crops = []
    i = 0
    while True:
        field = form.get(f"image_{i}")
        if field is None: break
        image_files.append(field)
        crop_data = form.get(f"crop_{i}")
        if crop_data:
            try: crops.append(json.loads(crop_data))
            except: crops.append(None)
        else:
            crops.append(None)
        i += 1

    if not image_files:
        raise HTTPException(status_code=422, detail="No images received")

    doc_id = str(uuid.uuid4())
    created_at = datetime.datetime.utcnow().isoformat()
    
    conn = get_db()
    conn.execute(
        "INSERT INTO documents (id, user_id, title, status, image_count, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        (doc_id, user_id, title, 'pending', len(image_files), created_at)
    )
    
    for idx, img_file in enumerate(image_files):
        if hasattr(img_file, "read"):
            img_bytes = await img_file.read()
        else:
            # Handle base64 strings from web browsers
            img_str = str(img_file)
            if "," in img_str: # data:image/jpeg;base64,...
                img_str = img_str.split(",")[1]
            try:
                img_bytes = base64.b64decode(img_str)
            except:
                img_bytes = img_str.encode() # Fallback

        if crops[idx]:
            img_bytes = warp_perspective(img_bytes, crops[idx])
        
        page_id = str(uuid.uuid4())
        conn.execute(
            "INSERT INTO document_pages (id, document_id, page_number, image_bytes, extracted_text) VALUES (?, ?, ?, ?, ?)",
            (page_id, doc_id, idx, img_bytes, "")
        )
    conn.commit()
    conn.close()

    background_tasks.add_task(run_ocr_background, doc_id)

    return {
        "id": doc_id,
        "title": title,
        "status": "pending",
        "message": "OCR processing started in background"
    }

class DocumentTextCreate(BaseModel):
    title: str
    text: str

@app.post("/documents/create-text")
def create_text_document(body: DocumentTextCreate, user_id: str = Depends(verify_token)):
    doc_id = str(uuid.uuid4())
    created_at = datetime.datetime.utcnow().isoformat()
    
    # Generate PDF from text
    pages = [{"text": body.text, "image_bytes": None}]
    pdf_bytes = create_pdf(body.title, pages)
    pdf_b64 = base64.b64encode(pdf_bytes).decode()

    conn = get_db()
    conn.execute(
        "INSERT INTO documents (id, user_id, title, extracted_text, pdf_base64, image_count, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)",
        (doc_id, user_id, body.title, body.text, pdf_b64, created_at)
    )
    conn.commit()
    conn.close()
    return {"id": doc_id, "title": body.title, "extracted_text": body.text, "created_at": created_at}

@app.get("/documents")
def list_documents(user_id: str = Depends(verify_token)):
    conn = get_db()
    docs = conn.execute(
        "SELECT id, title, extracted_text, image_count, status, created_at FROM documents WHERE user_id = ? AND is_channel_copy = 0 ORDER BY created_at DESC",
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

@app.put("/documents/{doc_id}")
def update_document(doc_id: str, body: DocumentUpdate, user_id: str = Depends(verify_token)):
    conn = get_db()
    try:
        conn.execute(
            "UPDATE documents SET title = ?, extracted_text = ? WHERE id = ? AND user_id = ?",
            (body.title.strip(), body.extracted_text, doc_id, user_id)
        )
        if conn.total_changes == 0:
            raise HTTPException(status_code=404, detail="Document not found")
        conn.commit()
        return {"success": True}
    finally:
        conn.close()

@app.post("/documents/{doc_id}/pages")
async def append_document_pages(doc_id: str, background_tasks: BackgroundTasks, request: Request, user_id: str = Depends(verify_token)):
    form = await request.form()
    
    # Collect new images
    image_files = []
    crops = []
    i = 0
    while True:
        field = form.get(f"image_{i}")
        if field is None: break
        image_files.append(field)
        
        crop_data = form.get(f"crop_{i}")
        if crop_data:
            try: crops.append(json.loads(crop_data))
            except: crops.append(None)
        else:
            crops.append(None)
        i += 1

    if not image_files:
        raise HTTPException(status_code=422, detail="No images received")

    conn = get_db()
    # Get current max page number
    max_page_row = conn.execute("SELECT MAX(page_number) FROM document_pages WHERE document_id = ?", (doc_id,)).fetchone()
    current_idx = (max_page_row[0] if max_page_row and max_page_row[0] is not None else -1) + 1

    for idx, img_file in enumerate(image_files):
        if hasattr(img_file, "read"):
            img_bytes = await img_file.read()
        else:
            # Handle base64 strings from web browsers
            img_str = str(img_file)
            if "," in img_str: # data:image/jpeg;base64,...
                img_str = img_str.split(",")[1]
            try:
                img_bytes = base64.b64decode(img_str)
            except:
                img_bytes = img_str.encode() # Fallback

        if crops[idx]:
            img_bytes = warp_perspective(img_bytes, crops[idx])
        
        page_id = str(uuid.uuid4())
        conn.execute(
            "INSERT INTO document_pages (id, document_id, page_number, image_bytes, extracted_text) VALUES (?, ?, ?, ?, ?)",
            (page_id, doc_id, current_idx + idx, img_bytes, "")
        )
    
    conn.execute("UPDATE documents SET status = 'pending', image_count = image_count + ? WHERE id = ?", (len(image_files), doc_id))
    conn.commit()
    conn.close()

    background_tasks.add_task(run_ocr_background, doc_id)

    return {"success": True, "message": "Pages added, OCR processing started"}

@app.get("/")
def root():
    return {"message": "NoteHub API is running 📚"}

# ── Channel Routes ────────────────────────────────────────────────────────────

@app.post("/channels/create")
def create_channel(body: ChannelCreate, user_id: str = Depends(verify_token)):
    conn = get_db()
    channel_id = str(uuid.uuid4())
    created_at = datetime.datetime.utcnow().isoformat()
    conn.execute(
        "INSERT INTO channels (id, name, description, admin_id, created_at) VALUES (?, ?, ?, ?, ?)",
        (channel_id, body.name, body.description or "", user_id, created_at)
    )
    # Admin is automatically a member
    conn.execute(
        "INSERT INTO channel_members (channel_id, user_id, role, joined_at) VALUES (?, ?, 'admin', ?)",
        (channel_id, user_id, created_at)
    )
    conn.commit()
    conn.close()
    return {"id": channel_id}

@app.put("/channels/{channel_id}")
def update_channel(channel_id: str, body: ChannelUpdate, user_id: str = Depends(verify_token)):
    conn = get_db()
    channel = conn.execute("SELECT admin_id FROM channels WHERE id = ?", (channel_id,)).fetchone()
    if not channel:
        conn.close()
        raise HTTPException(status_code=404, detail="Channel not found")
        
    if channel["admin_id"] != user_id:
        conn.close()
        raise HTTPException(status_code=403, detail="Only the channel admin can edit the channel")
        
    conn.execute(
        "UPDATE channels SET name = ?, description = ? WHERE id = ?",
        (body.name.strip() if hasattr(body.name, 'strip') else body.name, body.description, channel_id)
    )
    conn.commit()
    conn.close()
    return {"success": True}

@app.get("/channels")
def list_channels(user_id: str = Depends(verify_token)):
    conn = get_db()
    # Only get channels where user is a member OR has an unread invite
    channels = conn.execute("""
        SELECT DISTINCT c.* 
        FROM channels c
        LEFT JOIN channel_members cm ON c.id = cm.channel_id
        LEFT JOIN notifications n ON c.id = n.reference_id AND n.type = 'channel_invite' AND n.status = 'unread'
        WHERE cm.user_id = ? OR c.admin_id = ? OR n.user_id = ?
        ORDER BY c.created_at DESC
    """, (user_id, user_id, user_id)).fetchall()
    
    joined = conn.execute("SELECT channel_id, role FROM channel_members WHERE user_id = ?", (user_id,)).fetchall()
    joined_dict = {row["channel_id"]: row["role"] for row in joined}
    conn.close()

    result = []
    for c in channels:
        d = dict(c)
        d["is_member"] = d["id"] in joined_dict
        d["role"] = joined_dict.get(d["id"])
        d["is_admin"] = d["admin_id"] == user_id
        result.append(d)
    return result

@app.post("/channels/{channel_id}/join")
def join_channel(channel_id: str, user_id: str = Depends(verify_token)):
    conn = get_db()
    try:
        conn.execute(
            "INSERT INTO channel_members (channel_id, user_id, joined_at) VALUES (?, ?, ?)",
            (channel_id, user_id, datetime.datetime.utcnow().isoformat())
        )
        conn.commit()
    except sqlite3.IntegrityError:
        pass # Already a member
    finally:
        conn.close()
    return {"success": True}

@app.delete("/channels/{channel_id}")
def delete_or_leave_channel(channel_id: str, user_id: str = Depends(verify_token)):
    conn = get_db()
    channel = conn.execute("SELECT admin_id FROM channels WHERE id = ?", (channel_id,)).fetchone()
    if not channel:
        conn.close()
        raise HTTPException(status_code=404, detail="Channel not found")
        
    if channel["admin_id"] != user_id:
        conn.execute("DELETE FROM channel_members WHERE channel_id = ? AND user_id = ?", (channel_id, user_id))
        conn.commit()
        conn.close()
        return {"message": "Left channel"}

    successor = conn.execute("""
        SELECT user_id FROM channel_members 
        WHERE channel_id = ? AND user_id != ? AND role = 'moderator'
        ORDER BY RANDOM() LIMIT 1
    """, (channel_id, user_id)).fetchone()
    
    if not successor:
        successor = conn.execute("""
            SELECT user_id FROM channel_members 
            WHERE channel_id = ? AND user_id != ? AND role = 'member'
            ORDER BY RANDOM() LIMIT 1
        """, (channel_id, user_id)).fetchone()
        
    if successor:
        new_owner_id = successor["user_id"]
        conn.execute("UPDATE channels SET admin_id = ? WHERE id = ?", (new_owner_id, channel_id))
        conn.execute("UPDATE channel_members SET role = 'admin' WHERE channel_id = ? AND user_id = ?", (channel_id, new_owner_id))
        conn.execute("DELETE FROM channel_members WHERE channel_id = ? AND user_id = ?", (channel_id, user_id))
        conn.commit()
        conn.close()
        return {"message": "Ownership transferred and left channel"}
    else:
        conn.execute("DELETE FROM channel_notes WHERE channel_id = ?", (channel_id,))
        conn.execute("DELETE FROM channel_members WHERE channel_id = ?", (channel_id,))
        conn.execute("DELETE FROM notifications WHERE reference_id = ? AND type = 'channel_invite'", (channel_id,))
        conn.execute("DELETE FROM channels WHERE id = ?", (channel_id,))
        conn.commit()
        conn.close()
        return {"message": "Channel deleted"}

@app.post("/channels/{channel_id}/submit")
def submit_note(channel_id: str, body: SubmitNoteRequest, user_id: str = Depends(verify_token)):
    conn = get_db()
    member = conn.execute("SELECT 1 FROM channel_members WHERE channel_id = ? AND user_id = ?", (channel_id, user_id)).fetchone()
    if not member:
        conn.close()
        raise HTTPException(status_code=403, detail="Must join channel first")

    doc = conn.execute("SELECT * FROM documents WHERE id = ? AND user_id = ?", (body.document_id, user_id)).fetchone()
    if not doc:
        conn.close()
        raise HTTPException(status_code=404, detail="Document not found")

    # Create a separate copy of the document for the channel
    new_doc_id = str(uuid.uuid4())
    conn.execute(
        "INSERT INTO documents (id, user_id, title, extracted_text, pdf_base64, image_count, created_at, is_channel_copy) VALUES (?, ?, ?, ?, ?, ?, ?, 1)",
        (new_doc_id, user_id, doc["title"], doc["extracted_text"], doc["pdf_base64"], doc["image_count"], doc["created_at"])
    )
    
    # Copy all associated pages
    pages = conn.execute("SELECT * FROM document_pages WHERE document_id = ?", (body.document_id,)).fetchall()
    for p in pages:
        new_page_id = str(uuid.uuid4())
        conn.execute(
            "INSERT INTO document_pages (id, document_id, page_number, image_bytes, extracted_text) VALUES (?, ?, ?, ?, ?)",
            (new_page_id, new_doc_id, p["page_number"], p["image_bytes"], p["extracted_text"])
        )

    # Get max order_index to append at the bottom
    res = conn.execute("SELECT MAX(order_index) FROM channel_notes WHERE channel_id = ?", (channel_id,)).fetchone()
    max_idx = res[0] if res and res[0] is not None else -1
    new_idx = max_idx + 1

    sub_id = str(uuid.uuid4())
    conn.execute(
        "INSERT INTO channel_notes (id, channel_id, document_id, status, submitted_by, submitted_at, order_index) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (sub_id, channel_id, new_doc_id, "pending", user_id, datetime.datetime.utcnow().isoformat(), new_idx)
    )
    conn.commit()
    conn.close()
    return {"id": sub_id, "status": "pending"}

@app.get("/channels/{channel_id}/notes")
def get_channel_notes(channel_id: str, limit: int = 20, offset: int = 0, user_id: str = Depends(verify_token)):
    conn = get_db()
    member = conn.execute("SELECT 1 FROM channel_members WHERE channel_id = ? AND user_id = ?", (channel_id, user_id)).fetchone()
    if not member:
        conn.close()
        raise HTTPException(status_code=403, detail="Must join channel first")

    notes = conn.execute("""
        SELECT cn.id as submission_id, cn.submitted_at, cn.heading, cn.subheading, d.id, d.title, d.extracted_text, d.image_count, d.created_at, u.name as author_name
        FROM channel_notes cn
        JOIN documents d ON cn.document_id = d.id
        JOIN users u ON cn.submitted_by = u.id
        WHERE cn.channel_id = ? AND cn.status = 'approved'
        ORDER BY cn.order_index ASC, cn.submitted_at ASC
        LIMIT ? OFFSET ?
    """, (channel_id, limit + 1, offset)).fetchall()
    
    has_more = len(notes) > limit
    notes = notes[:limit]
    
    my_pending = []
    if offset == 0:
        my_pending = conn.execute("""
            SELECT cn.id as submission_id, cn.submitted_at, d.id, d.title, d.extracted_text, d.image_count, cn.status
            FROM channel_notes cn
            JOIN documents d ON cn.document_id = d.id
            WHERE cn.channel_id = ? AND cn.submitted_by = ? AND cn.status IN ('pending', 'rejected')
        """, (channel_id, user_id)).fetchall()

    conn.close()
    return {
        "approved": [dict(n) for n in notes],
        "has_more": has_more,
        "my_submissions": [dict(n) for n in my_pending]
    }

@app.put("/channels/{channel_id}/notes/reorder")
def reorder_notes(channel_id: str, body: ReorderRequest, user_id: str = Depends(verify_token)):
    conn = get_db()
    channel = conn.execute("SELECT admin_id FROM channels WHERE id = ?", (channel_id,)).fetchone()
    if not channel:
        conn.close()
        raise HTTPException(status_code=404, detail="Channel not found")
        
    member = conn.execute("SELECT role FROM channel_members WHERE channel_id = ? AND user_id = ?", (channel_id, user_id)).fetchone()
    if channel["admin_id"] != user_id and (not member or member["role"] not in ['admin', 'moderator']):
        conn.close()
        raise HTTPException(status_code=403, detail="Admin or Moderator access required")

    for i, sub_id in enumerate(body.submission_ids):
        conn.execute(
            "UPDATE channel_notes SET order_index = ? WHERE id = ? AND channel_id = ?",
            (i, sub_id, channel_id)
        )
    conn.commit()
    conn.close()
    return {"success": True}

@app.get("/channels/{channel_id}/queue")
def get_channel_queue(channel_id: str, user_id: str = Depends(verify_token)):
    conn = get_db()
    channel = conn.execute("SELECT admin_id FROM channels WHERE id = ?", (channel_id,)).fetchone()
    if not channel:
        conn.close()
        raise HTTPException(status_code=404, detail="Channel not found")
        
    member = conn.execute("SELECT role FROM channel_members WHERE channel_id = ? AND user_id = ?", (channel_id, user_id)).fetchone()
    if channel["admin_id"] != user_id and (not member or member["role"] not in ['admin', 'moderator']):
        conn.close()
        raise HTTPException(status_code=403, detail="Admin or Moderator access required")

    pending = conn.execute("""
        SELECT cn.id as submission_id, cn.submitted_at, cn.status, d.id as doc_id, d.title, d.extracted_text, d.image_count, u.name as author_name
        FROM channel_notes cn
        JOIN documents d ON cn.document_id = d.id
        JOIN users u ON cn.submitted_by = u.id
        WHERE cn.channel_id = ? AND cn.status = 'pending'
        ORDER BY cn.submitted_at ASC
    """, (channel_id,)).fetchall()
    
    conn.close()
    return [dict(p) for p in pending]

class NoteUpdate(BaseModel):
    extracted_text: str
    heading: Optional[str] = None
    subheading: Optional[str] = None

@app.put("/channels/{channel_id}/notes/{submission_id}")
def update_channel_note(channel_id: str, submission_id: str, body: NoteUpdate, user_id: str = Depends(verify_token)):
    conn = get_db()
    channel = conn.execute("SELECT admin_id FROM channels WHERE id = ?", (channel_id,)).fetchone()
    member = conn.execute("SELECT role FROM channel_members WHERE channel_id = ? AND user_id = ?", (channel_id, user_id)).fetchone()
    if not channel or (channel["admin_id"] != user_id and (not member or member["role"] not in ['admin', 'moderator'])):
        conn.close()
        raise HTTPException(status_code=403, detail="Admin or Moderator access required")
    sub = conn.execute("SELECT document_id FROM channel_notes WHERE id = ? AND channel_id = ?", (submission_id, channel_id)).fetchone()
    if not sub:
        conn.close()
        raise HTTPException(status_code=404, detail="Submission not found")
    
    # Update document text
    conn.execute("UPDATE documents SET extracted_text = ? WHERE id = ?", (body.extracted_text, sub["document_id"]))
    # Update note heading/subheading
    conn.execute("UPDATE channel_notes SET heading = ?, subheading = ? WHERE id = ?", (body.heading, body.subheading, submission_id))
    
    conn.commit()
    conn.close()
    return {"success": True}

@app.delete("/channels/{channel_id}/notes/{submission_id}")
def delete_channel_note(channel_id: str, submission_id: str, user_id: str = Depends(verify_token)):
    conn = get_db()
    channel = conn.execute("SELECT admin_id FROM channels WHERE id = ?", (channel_id,)).fetchone()
    if not channel:
        conn.close()
        raise HTTPException(status_code=404, detail="Channel not found")
        
    member = conn.execute("SELECT role FROM channel_members WHERE channel_id = ? AND user_id = ?", (channel_id, user_id)).fetchone()
    if channel["admin_id"] != user_id and (not member or member["role"] not in ['admin', 'moderator']):
        conn.close()
        raise HTTPException(status_code=403, detail="Admin or Moderator access required")
        
    sub = conn.execute("SELECT document_id FROM channel_notes WHERE id = ? AND channel_id = ?", (submission_id, channel_id)).fetchone()
    if not sub:
        conn.close()
        raise HTTPException(status_code=404, detail="Note not found")
    
    doc_id = sub["document_id"]
    
    # Delete note entry
    conn.execute("DELETE FROM channel_notes WHERE id = ?", (submission_id,))
    
    # Cleanup associated document if it's a channel copy
    doc = conn.execute("SELECT is_channel_copy FROM documents WHERE id = ?", (doc_id,)).fetchone()
    if doc and doc["is_channel_copy"]:
        conn.execute("DELETE FROM document_pages WHERE document_id = ?", (doc_id,))
        conn.execute("DELETE FROM documents WHERE id = ?", (doc_id,))
    
    conn.commit()
    conn.close()
    return {"success": True}

class BulkNoteUpdate(BaseModel):
    updates: List[dict] # Each dict: {"submission_id": str, "extracted_text": str, "heading": str, "subheading": str}

@app.post("/channels/{channel_id}/notes/bulk-update")
def bulk_update_channel_notes(channel_id: str, body: BulkNoteUpdate, user_id: str = Depends(verify_token)):
    conn = get_db()
    channel = conn.execute("SELECT admin_id FROM channels WHERE id = ?", (channel_id,)).fetchone()
    member = conn.execute("SELECT role FROM channel_members WHERE channel_id = ? AND user_id = ?", (channel_id, user_id)).fetchone()
    
    if not channel or (channel["admin_id"] != user_id and (not member or member["role"] not in ['admin', 'moderator'])):
        conn.close()
        raise HTTPException(status_code=403, detail="Admin or Moderator access required")
        
    for up in body.updates:
        sub_id = up.get("submission_id")
        text = up.get("extracted_text")
        heading = up.get("heading")
        subheading = up.get("subheading")
        
        sub = conn.execute("SELECT document_id FROM channel_notes WHERE id = ? AND channel_id = ?", (sub_id, channel_id)).fetchone()
        if sub:
            conn.execute("UPDATE documents SET extracted_text = ? WHERE id = ?", (text, sub["document_id"]))
            conn.execute("UPDATE channel_notes SET heading = ?, subheading = ? WHERE id = ?", (heading, subheading, sub_id))
            
    conn.commit()
    conn.close()
    return {"success": True}

@app.post("/channels/submissions/{submission_id}/approve")
def approve_submission(submission_id: str, user_id: str = Depends(verify_token)):
    conn = get_db()
    sub = conn.execute("SELECT channel_id FROM channel_notes WHERE id = ?", (submission_id,)).fetchone()
    if not sub:
        conn.close()
        raise HTTPException(status_code=404, detail="Submission not found")
        
    channel = conn.execute("SELECT admin_id FROM channels WHERE id = ?", (sub["channel_id"],)).fetchone()
    member = conn.execute("SELECT role FROM channel_members WHERE channel_id = ? AND user_id = ?", (sub["channel_id"], user_id)).fetchone()
    
    if channel["admin_id"] != user_id and (not member or member["role"] not in ['admin', 'moderator']):
        conn.close()
        raise HTTPException(status_code=403, detail="Admin or Moderator access required")
        
    conn.execute("UPDATE channel_notes SET status = 'approved' WHERE id = ?", (submission_id,))
    conn.commit()
    conn.close()
    return {"success": True}

@app.post("/channels/submissions/{submission_id}/reject")
def reject_submission(submission_id: str, user_id: str = Depends(verify_token)):
    conn = get_db()
    sub = conn.execute("SELECT channel_id FROM channel_notes WHERE id = ?", (submission_id,)).fetchone()
    if not sub:
        conn.close()
        raise HTTPException(status_code=404, detail="Submission not found")
        
    channel = conn.execute("SELECT admin_id FROM channels WHERE id = ?", (sub["channel_id"],)).fetchone()
    member = conn.execute("SELECT role FROM channel_members WHERE channel_id = ? AND user_id = ?", (sub["channel_id"], user_id)).fetchone()
    
    if channel["admin_id"] != user_id and (not member or member["role"] not in ['admin', 'moderator']):
        conn.close()
        raise HTTPException(status_code=403, detail="Admin or Moderator access required")
        
    conn.execute("UPDATE channel_notes SET status = 'rejected' WHERE id = ?", (submission_id,))
    conn.commit()
    conn.close()
    return {"success": True}

# ── Invite & Notification Routes ──────────────────────────────────────────────

@app.get("/users/search")
def search_users(q: str, user_id: str = Depends(verify_token)):
    conn = get_db()
    users = conn.execute(
        "SELECT id, name, email FROM users WHERE (name LIKE ? OR email LIKE ?) LIMIT 10",
        (f"%{q}%", f"%{q}%")
    ).fetchall()
    conn.close()
    return [dict(u) for u in users if u["id"] != user_id]

@app.post("/channels/{channel_id}/invites")
def invite_user(channel_id: str, body: dict, user_id: str = Depends(verify_token)):
    target_user_id = body.get("user_id")
    if not target_user_id:
        raise HTTPException(status_code=400, detail="user_id required")
        
    conn = get_db()
    
    channel = conn.execute("SELECT admin_id FROM channels WHERE id = ?", (channel_id,)).fetchone()
    member = conn.execute("SELECT role FROM channel_members WHERE channel_id = ? AND user_id = ?", (channel_id, user_id)).fetchone()
    
    if channel["admin_id"] != user_id and (not member or member["role"] not in ['admin', 'moderator']):
        conn.close()
        raise HTTPException(status_code=403, detail="Admin or Moderator access required")
        
    existing_member = conn.execute("SELECT 1 FROM channel_members WHERE channel_id = ? AND user_id = ?", (channel_id, target_user_id)).fetchone()
    if existing_member:
        conn.close()
        raise HTTPException(status_code=400, detail="User is already a member")
        
    existing_invite = conn.execute(
        "SELECT 1 FROM notifications WHERE user_id = ? AND reference_id = ? AND type = 'channel_invite' AND status = 'unread'",
        (target_user_id, channel_id)
    ).fetchone()
    if existing_invite:
        conn.close()
        raise HTTPException(status_code=400, detail="Invite already sent")
        
    notif_id = str(uuid.uuid4())
    conn.execute(
        "INSERT INTO notifications (id, user_id, type, sender_id, reference_id, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        (notif_id, target_user_id, 'channel_invite', user_id, channel_id, datetime.datetime.utcnow().isoformat())
    )
    conn.commit()
    conn.close()
    return {"success": True}

@app.get("/notifications")
def get_notifications(user_id: str = Depends(verify_token)):
    conn = get_db()
    notifs = conn.execute("""
        SELECT n.*, u.name as sender_name, c.name as channel_name 
        FROM notifications n
        JOIN users u ON n.sender_id = u.id
        LEFT JOIN channels c ON n.reference_id = c.id
        WHERE n.user_id = ? AND n.status = 'unread'
        ORDER BY n.created_at DESC
    """, (user_id,)).fetchall()
    conn.close()
    return [dict(n) for n in notifs]

@app.post("/notifications/{notif_id}/accept")
def accept_notification(notif_id: str, user_id: str = Depends(verify_token)):
    conn = get_db()
    notif = conn.execute("SELECT * FROM notifications WHERE id = ? AND user_id = ? AND status = 'unread'", (notif_id, user_id)).fetchone()
    if not notif:
        conn.close()
        raise HTTPException(status_code=404, detail="Notification not found")
        
    conn.execute("UPDATE notifications SET status = 'accepted' WHERE id = ?", (notif_id,))
    
    if notif["type"] == 'channel_invite':
        try:
            conn.execute(
                "INSERT INTO channel_members (channel_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)",
                (notif["reference_id"], user_id, datetime.datetime.utcnow().isoformat())
            )
        except sqlite3.IntegrityError:
            pass # Already member
            
    conn.commit()
    conn.close()
    return {"success": True}

@app.post("/notifications/{notif_id}/decline")
def decline_notification(notif_id: str, user_id: str = Depends(verify_token)):
    conn = get_db()
    conn.execute("UPDATE notifications SET status = 'declined' WHERE id = ? AND user_id = ?", (notif_id, user_id))
    conn.commit()
    conn.close()
    return {"success": True}

@app.get("/channels/{channel_id}/members")
def get_channel_members(channel_id: str, user_id: str = Depends(verify_token)):
    conn = get_db()
    channel = conn.execute("SELECT admin_id FROM channels WHERE id = ?", (channel_id,)).fetchone()
    member = conn.execute("SELECT role FROM channel_members WHERE channel_id = ? AND user_id = ?", (channel_id, user_id)).fetchone()
    
    if channel["admin_id"] != user_id and (not member or member["role"] not in ['admin', 'moderator']):
        conn.close()
        raise HTTPException(status_code=403, detail="Admin or Moderator access required")
        
    members = conn.execute("""
        SELECT cm.user_id, cm.role, cm.joined_at, u.name, u.email
        FROM channel_members cm
        JOIN users u ON cm.user_id = u.id
        WHERE cm.channel_id = ?
        ORDER BY cm.joined_at DESC
    """, (channel_id,)).fetchall()
    conn.close()
    return [dict(m) for m in members]

@app.put("/channels/{channel_id}/members/{target_user_id}/role")
def update_member_role(channel_id: str, target_user_id: str, body: RoleUpdate, user_id: str = Depends(verify_token)):
    if body.role not in ['member', 'moderator']:
        raise HTTPException(status_code=400, detail="Invalid role. Must be 'member' or 'moderator'.")
        
    conn = get_db()
    channel = conn.execute("SELECT admin_id FROM channels WHERE id = ?", (channel_id,)).fetchone()
    if not channel or channel["admin_id"] != user_id:
        conn.close()
        raise HTTPException(status_code=403, detail="Only the channel admin can change roles")
        
    if target_user_id == channel["admin_id"]:
        conn.close()
        raise HTTPException(status_code=400, detail="Cannot change admin role")
        
    conn.execute("UPDATE channel_members SET role = ? WHERE channel_id = ? AND user_id = ?", (body.role, channel_id, target_user_id))
    conn.commit()
    conn.close()
    return {"success": True}

@app.delete("/channels/{channel_id}/members/{target_user_id}")
def remove_member(channel_id: str, target_user_id: str, user_id: str = Depends(verify_token)):
    conn = get_db()
    channel = conn.execute("SELECT admin_id FROM channels WHERE id = ?", (channel_id,)).fetchone()
    if not channel or channel["admin_id"] != user_id:
        conn.close()
        raise HTTPException(status_code=403, detail="Only the channel admin can remove members")
        
    if target_user_id == channel["admin_id"]:
        conn.close()
        raise HTTPException(status_code=400, detail="Cannot remove the admin from the channel")
        
    conn.execute("DELETE FROM channel_members WHERE channel_id = ? AND user_id = ?", (channel_id, target_user_id))
    # Also remove any pending notes by this user if they are being removed? 
    # Or keep them? Usually keep them, but they won't be able to submit more.
    conn.commit()
    conn.close()
    return {"success": True}
