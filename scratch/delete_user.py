import sqlite3
import os

DB_PATH = "backend/notehub.db"
EMAIL_TO_DELETE = "idkwhyiamdoingthis270@gmail.com"

def delete_user():
    if not os.path.exists(DB_PATH):
        print("DB not found")
        return
        
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    # Find the user ID
    user = cursor.execute("SELECT id FROM users WHERE email = ?", (EMAIL_TO_DELETE,)).fetchone()
    if not user:
        print(f"User with email {EMAIL_TO_DELETE} not found.")
        conn.close()
        return
        
    user_id = user['id']
    print(f"Deleting user {user_id} ({EMAIL_TO_DELETE})...")
    
    try:
        # Delete related data
        cursor.execute("DELETE FROM notifications WHERE user_id = ? OR sender_id = ?", (user_id, user_id))
        cursor.execute("DELETE FROM channel_members WHERE user_id = ?", (user_id,))
        cursor.execute("DELETE FROM channel_notes WHERE submitted_by = ?", (user_id,))
        
        # Documents
        cursor.execute("DELETE FROM document_pages WHERE document_id IN (SELECT id FROM documents WHERE user_id = ?)", (user_id,))
        cursor.execute("DELETE FROM documents WHERE user_id = ?", (user_id,))
        
        # Channels where user is admin (this is tricky, but let's delete them for now)
        cursor.execute("DELETE FROM channels WHERE admin_id = ?", (user_id,))
        
        # Finally delete the user
        cursor.execute("DELETE FROM users WHERE id = ?", (user_id,))
        
        conn.commit()
        print("User and all related data deleted successfully.")
    except Exception as e:
        print(f"Error during deletion: {e}")
        conn.rollback()
    finally:
        conn.close()

if __name__ == "__main__":
    delete_user()
