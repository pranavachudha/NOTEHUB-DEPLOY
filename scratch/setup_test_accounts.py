import sqlite3
import hashlib
import os

DB_PATH = "backend/notehub.db"
PASSWORD_SALT = "notehub-salt-v1"

def hash_password(password: str) -> str:
    return hashlib.sha256((password + PASSWORD_SALT).encode()).hexdigest()

def check_and_fix():
    if not os.path.exists(DB_PATH):
        print(f"DB not found at {DB_PATH}")
        return

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    emails = ['bruh@bruh', 'admin@admin']
    
    for email in emails:
        user = conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
        if user:
            # Update password to 'password' with new salt
            new_hash = hash_password("password")
            conn.execute("UPDATE users SET password_hash = ? WHERE email = ?", (new_hash, email))
            print(f"Updated {email} password to 'password'")
        else:
            # Create user if not exists
            user_id = email.split('@')[0]
            new_hash = hash_password("password")
            conn.execute(
                "INSERT INTO users (id, name, username, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                (user_id, user_id.capitalize(), user_id, email, new_hash, "2026-04-28T16:00:00Z")
            )
            print(f"Created {email} with password 'password'")
    
    conn.commit()
    conn.close()

if __name__ == "__main__":
    check_and_fix()
