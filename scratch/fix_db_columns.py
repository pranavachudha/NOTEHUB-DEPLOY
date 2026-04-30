import sqlite3
import os

DB_PATH = "backend/notehub.db"

def fix_db():
    if not os.path.exists(DB_PATH):
        print("DB not found")
        return
        
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # Check users table columns
    cursor.execute("PRAGMA table_info(users)")
    columns = [row[1] for row in cursor.fetchall()]
    print(f"Current columns in users: {columns}")
    
    missing = []
    if 'username' not in columns: missing.append("username TEXT UNIQUE")
    if 'is_verified' not in columns: missing.append("is_verified INTEGER DEFAULT 1") # Default 1 for existing
    if 'otp_code' not in columns: missing.append("otp_code TEXT")
    
    for col in missing:
        try:
            print(f"Adding column: {col}")
            cursor.execute(f"ALTER TABLE users ADD COLUMN {col}")
        except Exception as e:
            print(f"Error adding {col}: {e}")
            
    conn.commit()
    conn.close()
    print("DB Fix complete")

if __name__ == "__main__":
    fix_db()
