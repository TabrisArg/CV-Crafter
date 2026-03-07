import express from "express";
import { createServer as createViteServer } from "vite";
import session from "express-session";
import cookieParser from "cookie-parser";
import path from "path";
import { fileURLToPath } from "url";
import admin from "firebase-admin";
import { OAuth2Client } from "google-auth-library";
import Database from "better-sqlite3";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize SQLite fallback
const sqlite = new Database("cv_crafter.db");

// Session types
declare module 'express-session' {
  interface SessionData {
    user: {
      id: string;
      email: string;
      name: string;
      picture?: string;
    };
  }
}

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS cvs (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    parent_id TEXT,
    title TEXT,
    content TEXT,
    template TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Initialize Firebase Admin
let firestore: FirebaseFirestore.Firestore | null = null;
let useFirestore = false;

function initFirestore() {
  if (firestore) return firestore;
  
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
      firestore = admin.firestore();
      useFirestore = true;
      console.log("Firestore initialized successfully");
    } catch (err) {
      console.error("Failed to initialize Firestore with service account:", err);
      useFirestore = false;
    }
  } else {
    console.log("No FIREBASE_SERVICE_ACCOUNT found, using SQLite fallback");
    useFirestore = false;
  }
  return firestore;
}

// Unified DB Interface
const db = {
  async getCVs(userId: string) {
    if (useFirestore && firestore) {
      try {
        const snapshot = await firestore.collection("cvs")
          .where("user_id", "==", userId)
          .orderBy("updated_at", "desc")
          .get();
        
        return snapshot.docs.map(doc => {
          const data = doc.data();
          let content = data.content;
          // Handle cases where content might be stored as a string in Firestore
          if (typeof content === "string") {
            try {
              content = JSON.parse(content);
            } catch (e) {
              console.error("Failed to parse Firestore content string:", e);
            }
          }
          return {
            id: doc.id,
            ...data,
            content,
            updated_at: data.updated_at?.toDate?.()?.toISOString() || new Date().toISOString()
          };
        });
      } catch (err: any) {
        if (err.message?.includes("PERMISSION_DENIED") || err.message?.includes("disabled")) {
          console.log("Firestore access denied or disabled, switching to SQLite fallback.");
        } else {
          console.error("Firestore fetch failed:", err);
        }
        useFirestore = false;
      }
    }
    
    // SQLite Fallback
    try {
      const rows = sqlite.prepare("SELECT * FROM cvs WHERE user_id = ? ORDER BY updated_at DESC").all(userId);
      return rows.map((row: any) => {
        let content = row.content;
        if (typeof content === "string") {
          // Robust check for corrupted data
          if (content === "[object Object]" || !content) {
            content = {};
          } else {
            try {
              content = JSON.parse(content);
            } catch (e) {
              console.error(`Failed to parse SQLite content for CV ${row.id}:`, e);
              content = {}; 
            }
          }
        } else if (!content) {
          content = {};
        }
        
        // Ensure updated_at is an ISO string for the frontend
        let updatedAt = row.updated_at;
        if (updatedAt && !updatedAt.includes('T')) {
          // Convert SQLite format (YYYY-MM-DD HH:MM:SS) to ISO
          updatedAt = new Date(updatedAt + 'Z').toISOString();
        }

        return {
          ...row,
          content,
          updated_at: updatedAt || new Date().toISOString()
        };
      });
    } catch (err) {
      console.error("SQLite fetch failed:", err);
      return [];
    }
  },

  async saveCV(id: string, data: any) {
    // Ensure content is an object for Firestore and a string for SQLite
    let contentObj = data.content || {};
    let contentStr = "";

    if (typeof data.content === "string") {
      if (data.content === "[object Object]" || !data.content) {
        contentObj = {};
        contentStr = "{}";
      } else {
        try {
          contentObj = JSON.parse(data.content);
          contentStr = data.content;
        } catch (e) {
          console.error("Failed to parse content in saveCV:", e);
          contentObj = {};
          contentStr = "{}";
        }
      }
    } else {
      contentObj = data.content || {};
      contentStr = JSON.stringify(contentObj);
    }

    if (useFirestore && firestore) {
      try {
        const cvData = {
          ...data,
          content: contentObj,
          updated_at: admin.firestore.FieldValue.serverTimestamp()
        };
        await firestore.collection("cvs").doc(id).set(cvData, { merge: true });
        return;
      } catch (err: any) {
        if (err.message?.includes("PERMISSION_DENIED") || err.message?.includes("disabled")) {
          console.log("Firestore access denied or disabled during save, switching to SQLite.");
        } else {
          console.error("Firestore save failed:", err);
        }
        useFirestore = false;
      }
    }

    // SQLite Fallback
    const { user_id, parent_id, title, template } = data;
    const now = new Date().toISOString();
    try {
      sqlite.prepare(`
        INSERT INTO cvs (id, user_id, parent_id, title, content, template, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          user_id = excluded.user_id,
          parent_id = excluded.parent_id,
          title = excluded.title,
          content = excluded.content,
          template = excluded.template,
          updated_at = excluded.updated_at
      `).run(id, user_id, parent_id, title, contentStr, template, now);
      console.log(`Successfully saved CV ${id} to SQLite`);
    } catch (err) {
      console.error("SQLite save failed:", err);
      throw err;
    }
  },

  async deleteCV(id: string, userId: string) {
    if (useFirestore && firestore) {
      try {
        const docRef = firestore.collection("cvs").doc(id);
        const doc = await docRef.get();
        if (doc.exists && doc.data()?.user_id === userId) {
          await docRef.delete();
          return true;
        }
        return false;
      } catch (err) {
        console.error("Firestore delete failed, falling back to SQLite:", err);
        useFirestore = false;
      }
    }

    // SQLite Fallback
    // Delete children first to be clean, though not strictly necessary if we don't have foreign key constraints
    sqlite.prepare("DELETE FROM cvs WHERE parent_id = ? AND user_id = ?").run(id, userId);
    const result = sqlite.prepare("DELETE FROM cvs WHERE id = ? AND user_id = ?").run(id, userId);
    return result.changes > 0;
  }
};

async function startServer() {
  const app = express();
  const PORT = 3000;

  console.log(`Starting server in ${process.env.NODE_ENV} mode`);
  console.log(`APP_URL: ${process.env.APP_URL || "not set"}`);

  app.set("trust proxy", 1);
  app.use(express.json());
  app.use(cookieParser());
  app.use(
    session({
      secret: process.env.SESSION_SECRET || "cv-craft-secret-key",
      resave: true,
      saveUninitialized: true,
      cookie: {
        secure: process.env.NODE_ENV === "production" || !!process.env.APP_URL,
        sameSite: "none",
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
      },
    })
  );

  const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
  const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
  const AUTH_ENABLED = !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);

  console.log(`Auth enabled: ${AUTH_ENABLED} (Client ID: ${GOOGLE_CLIENT_ID ? "present" : "missing"})`);

  const oauthClient = new OAuth2Client(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET
  );

  // Initialize DB (try Firestore, fallback to SQLite)
  initFirestore();

  // Log DB Status
  try {
    const cvCount = sqlite.prepare("SELECT COUNT(*) as count FROM cvs").get() as { count: number };
    console.log(`Database initialized. Current CV count in SQLite: ${cvCount.count}`);
    if (useFirestore) {
      console.log("Firestore is also active as primary storage.");
    } else {
      console.warn("WARNING: Using SQLite fallback. Data will be lost if the container restarts.");
    }
  } catch (err) {
    console.error("Error checking DB status:", err);
  }

  // API Routes
  app.get("/api/config", (req, res) => {
    res.json({ 
      authEnabled: AUTH_ENABLED,
      persistenceType: useFirestore ? "cloud" : "local"
    });
  });

  app.get("/api/auth/google/url", (req, res) => {
    if (!AUTH_ENABLED) return res.status(400).json({ error: "Auth not configured" });

    const appUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    const redirectUri = `${appUrl}/auth/google/callback`;
    console.log(`Generating Auth URL with redirectUri: ${redirectUri}`);
    
    const url = oauthClient.generateAuthUrl({
      access_type: 'offline',
      scope: ['profile', 'email'],
      redirect_uri: redirectUri
    });
    res.json({ url });
  });

  app.get("/auth/google/callback", async (req, res) => {
    try {
      const { code } = req.query;
      const appUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
      const redirectUri = `${appUrl}/auth/google/callback`;
      console.log(`Callback received with redirectUri: ${redirectUri}`);
      
      const { tokens } = await oauthClient.getToken({
        code: code as string,
        redirect_uri: redirectUri
      });
      
      const ticket = await oauthClient.verifyIdToken({
        idToken: tokens.id_token!,
        audience: GOOGLE_CLIENT_ID
      });
      
      const payload = ticket.getPayload();
      if (payload) {
        console.log(`Auth successful for user: ${payload.email}`);
        req.session.user = {
          id: payload.sub,
          email: payload.email!,
          name: payload.name!,
          picture: payload.picture
        };
        
        // Explicitly save session to be sure
        req.session.save((err) => {
          if (err) {
            console.error("Session save error:", err);
          } else {
            console.log("Session saved successfully");
          }
        });
      }

      res.send(`
        <html>
          <head>
            <title>Authentication Successful</title>
            <style>
              body { font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; text-align: center; background: #f8fafc; }
              .card { background: white; padding: 2rem; border-radius: 1rem; shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1); border: 1px solid #e2e8f0; max-width: 400px; }
              .loader { border: 3px solid #f3f3f3; border-top: 3px solid #4f46e5; border-radius: 50%; width: 24px; height: 24px; animation: spin 1s linear infinite; margin: 0 auto 1rem; }
              @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
              .btn { margin-top: 1rem; padding: 0.5rem 1rem; background: #4f46e5; color: white; border: none; border-radius: 0.5rem; cursor: pointer; font-weight: 600; }
            </style>
          </head>
          <body>
            <div class="card">
              <div id="status-icon" class="loader"></div>
              <h2 id="status-title">Authenticating...</h2>
              <p id="status-text">We're syncing your account with the app.</p>
              <button id="close-btn" class="btn" style="display: none;" onclick="window.close()">Close Window</button>
            </div>
            <script>
              const statusTitle = document.getElementById('status-title');
              const statusText = document.getElementById('status-text');
              const statusIcon = document.getElementById('status-icon');
              const closeBtn = document.getElementById('close-btn');

              function complete() {
                statusTitle.innerText = "Success!";
                statusText.innerText = "You can close this window now.";
                statusIcon.style.display = "none";
                closeBtn.style.display = "inline-block";
                
                console.log("Popup: Sending success message...");
                if (window.opener) {
                  try {
                    window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS' }, '*');
                    console.log("Popup: Message sent.");
                  } catch (e) {
                    console.error("Popup: postMessage failed", e);
                  }
                  
                  setTimeout(() => {
                    console.log("Popup: Attempting to close...");
                    window.close();
                  }, 1500);
                } else {
                  statusText.innerText = "Authentication complete. Redirecting...";
                  setTimeout(() => { window.location.href = '/'; }, 1000);
                }
              }

              // Run completion
              setTimeout(complete, 500);
            </script>
          </body>
        </html>
      `);
    } catch (err) {
      console.error("Auth callback error:", err);
      res.status(500).send("Authentication failed");
    }
  });

  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy(() => {
      res.json({ success: true });
    });
  });

  app.get("/api/user", (req, res) => {
    if (!AUTH_ENABLED) {
      return res.json({ id: "debug-user", email: "debug@cvcraft.local", name: "Debug User" });
    }
    
    if (req.session.user) {
      res.json(req.session.user);
    } else {
      res.status(401).json({ error: "Unauthorized" });
    }
  });

  // CV Routes
  app.get("/api/cvs", async (req, res) => {
    try {
      const userId = AUTH_ENABLED ? req.session.user?.id : "debug-user";
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const cvs = await db.getCVs(userId);
      res.json(cvs);
    } catch (err: any) {
      console.error("Error fetching CVs:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/cvs", async (req, res) => {
    try {
      const { id, title, content, template, parent_id } = req.body;
      const userId = AUTH_ENABLED ? req.session.user?.id : "debug-user";
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      
      const cvData = {
        user_id: userId,
        parent_id: parent_id || null,
        title,
        content,
        template
      };

      await db.saveCV(id, cvData);
      res.json({ success: true });
    } catch (err: any) {
      console.error("Error saving CV:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/cvs/:id", async (req, res) => {
    try {
      const userId = AUTH_ENABLED ? req.session.user?.id : "debug-user";
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const success = await db.deleteCV(req.params.id, userId);
      if (!success) {
        return res.status(403).json({ error: "Forbidden or not found" });
      }

      res.json({ success: true });
    } catch (err: any) {
      console.error("Error deleting CV:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
