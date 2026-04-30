import sqlite3
import os

DB_PATH = "backend/notehub.db"

def check_user():
    if not os.path.exists(DB_PATH):
        print("DB not found")
        return
        
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    user = conn.execute("SELECT * FROM users WHERE email = 'idkwhyiamdoingthis270@gmail.com'").fetchone()
    if user:
        print(f"User exists: {dict(user)}")
    else:
        print("User does not exist.")
    conn.close()

if __name__ == "__main__":
    check_user()
