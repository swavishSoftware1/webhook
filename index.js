const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const crypto = require("crypto");
const fs = require("fs");

const app = express();
app.use(bodyParser.json());

// Configurations
const VERIFY_TOKEN = "my_verify_token"; // Replace with your webhook verification token
const APP_ID = "497657243241828"; // Your App ID
const APP_SECRET = "6f6668bec23b20a09790e34f2d142f64"; // Your App Secret
let USER_ACCESS_TOKEN =
  "EAAHEnds0DWQBO5081rvol3YOETWgDiNZBEEVIJJgoE0Ino5Uz8Nh5qTAvStTZAiBMxBFKf3TZCrsMZAACk5bquQuysjCcpEKnA3rAzRPHWXfxzqusJ5wbN6gDv1upRrJK0ZBgoVkjgjlZBhRZA9K71j6ktVn9LTZBH82TDP5mZCdDJBg2qkiMISX2zl8e"; // Replace with a valid token
const SYNC_FILE = "lastSyncTime.txt";

// Utility to hash data
const hashValue = (value) => crypto.createHash("sha256").update(value).digest("hex");

// Get last sync time
const getLastSyncTime = () => {
  if (fs.existsSync(SYNC_FILE)) {
    return parseInt(fs.readFileSync(SYNC_FILE, "utf8"), 10);
  }
  return null; // First run
};

// Save last sync time
const saveLastSyncTime = (time) => {
  fs.writeFileSync(SYNC_FILE, time.toString(), "utf8");
};

// Refresh or regenerate User Access Token
const refreshAccessToken = async () => {
  try {
    console.log("Refreshing User Access Token...");
    const response = await axios.get(`https://graph.facebook.com/v17.0/oauth/access_token`, {
      params: {
        grant_type: "fb_exchange_token",
        client_id: APP_ID,
        client_secret: APP_SECRET,
        fb_exchange_token: USER_ACCESS_TOKEN,
      },
    });
    USER_ACCESS_TOKEN = response.data.access_token;
    console.log("User Access Token refreshed successfully.");
  } catch (error) {
    console.error("Failed to refresh User Access Token. Generating new app-level token...");
    await generateAppAccessToken();
  }
};

// Generate a new App-Level Access Token (fallback mechanism)
const generateAppAccessToken = async () => {
  try {
    console.log("Generating new App Access Token...");
    const response = await axios.get(`https://graph.facebook.com/v17.0/oauth/access_token`, {
      params: {
        client_id: APP_ID,
        client_secret: APP_SECRET,
        grant_type: "client_credentials",
      },
    });
    USER_ACCESS_TOKEN = response.data.access_token;
    console.log("App Access Token generated successfully.");
  } catch (error) {
    console.error("Failed to generate App Access Token:", error.response?.data || error.message);
    throw new Error("App Access Token generation failed.");
  }
};

// Fetch Page Access Token
const getPageAccessToken = async (pageId) => {
  try {
    console.log(`Fetching Page Access Token for Page ID: ${pageId}`);
    const response = await axios.get(`https://graph.facebook.com/v17.0/me/accounts`, {
      params: { access_token: USER_ACCESS_TOKEN, fields: "id,name,access_token" },
    });

    const pages = response.data.data;
    const page = pages.find((p) => p.id === pageId);

    if (!page) {
      throw new Error(`No access to page with ID: ${pageId}`);
    }

    console.log(`Page Access Token for Page ID ${pageId}: ${page.access_token}`);
    return page.access_token;
  } catch (error) {
    console.error("Error fetching Page Access Token:", error.response?.data || error.message);
    throw error;
  }
};

// Fetch all leads for a form, optionally filtered by last sync time
const fetchLeads = async (formId, pageAccessToken, since = null) => {
  try {
    const params = { access_token: pageAccessToken };

    if (since) {
      console.log(`Fetching leads created since: ${new Date(since * 1000).toISOString()}`);
      params.filtering = JSON.stringify([{ field: "time_created", operator: "GREATER_THAN", value: since }]);
    } else {
      console.log("Fetching all historical leads (first run).");
    }

    const response = await axios.get(`https://graph.facebook.com/v17.0/${formId}/leads`, { params });
    return response.data.data || [];
  } catch (error) {
    console.error("Error fetching leads:", error.response?.data || error.message);
    throw error;
  }
};

// Process Leads
const processLeads = async (leads, pageName, formName) => {
  for (const lead of leads) {
    try {
      console.log(`Page Name: ${pageName}, Form Name: ${formName}`);
      console.log("Lead Data:", lead);

      const parsedFields = {};
      lead.field_data.forEach((field) => {
        parsedFields[field.name] = field.values[0] || null;
      });

      console.log("Dynamic Fields:", parsedFields);
    } catch (error) {
      console.error("Error processing lead:", error.message);
    }
  }
};

// Fetch forms and their leads for a page
const fetchFormsAndLeads = async (pageId, pageName, isHistorical = false) => {
  try {
    const pageAccessToken = await getPageAccessToken(pageId);

    // Fetch leadgen forms for the page
    const response = await axios.get(`https://graph.facebook.com/v17.0/${pageId}/leadgen_forms`, {
      params: { access_token: pageAccessToken, fields: "id,name" },
    });

    const forms = response.data.data || [];
    const lastSyncTime = isHistorical ? null : getLastSyncTime(); // Use null for historical data fetch
    console.log("Last Sync Time:", lastSyncTime ? new Date(lastSyncTime * 1000).toISOString() : "First Run");

    for (const form of forms) {
      console.log(`Processing Form: ${form.name} (ID: ${form.id})`);
      const leads = await fetchLeads(form.id, pageAccessToken, lastSyncTime);
      await processLeads(leads, pageName, form.name);
    }
  } catch (error) {
    console.error("Error fetching forms and leads:", error.message);
  }
};

// Fetch historical leads on server startup
const fetchHistoricalLeads = async () => {
  try {
    console.log("Fetching historical leads...");
    const response = await axios.get(`https://graph.facebook.com/v17.0/me/accounts`, {
      params: { access_token: USER_ACCESS_TOKEN, fields: "id,name" },
    });

    const pages = response.data.data || [];
    if (pages.length === 0) {
      console.log("No pages found for the account.");
      return;
    }

    for (const page of pages) {
      console.log(`Fetching historical leads for Page: ${page.name} (ID: ${page.id})`);
      await fetchFormsAndLeads(page.id, page.name, true); // Fetch all historical data
    }

    const now = Math.floor(Date.now() / 1000);
    saveLastSyncTime(now); // Update sync time after fetching all historical data
    console.log("Historical data fetched. Sync time updated.");
  } catch (error) {
    console.error("Error fetching historical leads:", error.message);
  }
};

// Webhook Verification
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token === VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.status(403).send("Verification failed.");
  }
});

// Handle Webhook Events
app.post("/webhook", async (req, res) => {
  const body = req.body;

  console.log("Webhook Payload:", JSON.stringify(body, null, 2));
  if (body.object === "page") {
    for (const entry of body.entry) {
      const pageId = entry.id;
      const pageName = entry.name || "Unknown Page"; // Add logic to fetch page name if needed
      console.log(`Processing Page ID: ${pageId}`);
      await fetchFormsAndLeads(pageId, pageName);
    }
  }

  res.status(200).send("EVENT_RECEIVED");
});

// Start the Server
app.listen(5000, async () => {
  console.log("Server is running on port 5000.");
  await fetchHistoricalLeads(); // Fetch historical leads on startup
});
