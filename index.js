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
let USER_ACCESS_TOKEN = "EAAHEnds0DWQBO5081rvol3YOETWgDiNZBEEVIJJgoE0Ino5Uz8Nh5qTAvStTZAiBMxBFKf3TZCrsMZAACk5bquQuysjCcpEKnA3rAzRPHWXfxzqusJ5wbN6gDv1upRrJK0ZBgoVkjgjlZBhRZA9K71j6ktVn9LTZBH82TDP5mZCdDJBg2qkiMISX2zl8e"; // Replace with a valid token
const SYNC_FILE = "lastSyncTime.json"; // Save last sync time per form

// Utility to hash data
const hashValue = (value) => (value ? crypto.createHash("sha256").update(value).digest("hex") : null);

// Get last sync time for a specific form
const getLastSyncTimeForForm = (formId) => {
  if (fs.existsSync(SYNC_FILE)) {
    const syncData = JSON.parse(fs.readFileSync(SYNC_FILE, "utf8"));
    return syncData[formId] || null;
  }
  return null;
};

// Save last sync time for a specific form
const saveLastSyncTimeForForm = (formId, time) => {
  const syncData = fs.existsSync(SYNC_FILE) ? JSON.parse(fs.readFileSync(SYNC_FILE, "utf8")) : {};
  syncData[formId] = time;
  fs.writeFileSync(SYNC_FILE, JSON.stringify(syncData), "utf8");
};

// Refresh User Access Token
const refreshAccessToken = async () => {
  try {
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
    console.error("Failed to refresh User Access Token:", error.response?.data || error.message);
  }
};

// Fetch Page Access Token
const getPageAccessToken = async (pageId) => {
  try {
    const response = await axios.get(`https://graph.facebook.com/v17.0/me/accounts`, {
      params: { access_token: USER_ACCESS_TOKEN, fields: "id,name,access_token" },
    });

    const pages = response.data.data || [];
    const page = pages.find((p) => p.id === pageId);

    if (!page) {
      console.error(`No access to page with ID: ${pageId}`);
      return null;
    }

    return page.access_token;
  } catch (error) {
    console.error("Error fetching Page Access Token:", error.response?.data || error.message);
    return null;
  }
};

// Fetch Leads
const fetchLeads = async (formId, pageAccessToken, since = null) => {
  try {
    const params = { access_token: pageAccessToken };
    if (since) {
      params.filtering = JSON.stringify([
        { field: "time_created", operator: "GREATER_THAN", value: since },
      ]);
    }

    const response = await axios.get(`https://graph.facebook.com/v17.0/${formId}/leads`, { params });
    return response.data.data || [];
  } catch (error) {
    console.error("Error fetching leads:", error.response?.data || error.message);
    return [];
  }
};

// Process Leads
const processLeads = async (leads, pageName, formName) => {
  for (const lead of leads) {
    try {
      console.log(`Processing lead for Page: ${pageName}, Form: ${formName}`);

      const parsedFields = {};
      lead.field_data.forEach((field) => {
        parsedFields[field.name] = field.values && field.values.length ? field.values[0] : null;
      });

      console.log("Parsed Lead Data:", JSON.stringify(parsedFields, null, 2));

      const eventData = {
        email: hashValue(parsedFields.email),
        phone: hashValue(parsedFields.phone_number),
        fn: parsedFields.full_name ? hashValue(parsedFields.full_name.split(" ")[0]) : null,
        ln: parsedFields.full_name ? hashValue(parsedFields.full_name.split(" ").slice(1).join(" ")) : null,
      };

      console.log("Processed Lead Data:", eventData);
    } catch (error) {
      console.error("Error processing lead:", error.message);
    }
  }
};

// Fetch Forms and Leads from a Specific Page
const fetchFormsAndLeads = async (pageId, pageName) => {
  try {
    const pageAccessToken = await getPageAccessToken(pageId);
    if (!pageAccessToken) {
      console.error(`Failed to retrieve access token for Page ID: ${pageId}`);
      return;
    }

    const response = await axios.get(`https://graph.facebook.com/v17.0/${pageId}/leadgen_forms`, {
      params: { access_token: pageAccessToken, fields: "id,name" },
    });

    const forms = response.data.data || [];
    for (const form of forms) {
      console.log(`Fetching leads for Form: ${form.name} (ID: ${form.id})`);

      const lastSyncTime = getLastSyncTimeForForm(form.id);
      const leads = await fetchLeads(form.id, pageAccessToken, lastSyncTime);

      if (leads.length > 0) {
        await processLeads(leads, pageName, form.name);

        const latestCreatedTime = Math.max(...leads.map((lead) => lead.created_time));
        saveLastSyncTimeForForm(form.id, latestCreatedTime);
      } else {
        console.log(`No new leads for Form: ${form.name}`);
      }
    }
  } catch (error) {
    console.error("Error fetching forms and leads:", error.message);
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

  if (body.object === "page") {
    for (const entry of body.entry) {
      const pageId = entry.id;
      const pageName = entry.name || "Unknown Page";

      if (!pageId || pageId === "0") {
        console.log("Test Data Received:", JSON.stringify(entry, null, 2));
        continue;
      }

      console.log(`Processing webhook event for Page: ${pageName} (ID: ${pageId})`);

      if (entry.changes) {
        for (const change of entry.changes) {
          if (change.field === "leadgen") {
            console.log(`New lead generated on Page: ${pageName}`);
            await fetchFormsAndLeads(pageId, pageName);
          }
        }
      }
    }
  }

  res.status(200).send("EVENT_RECEIVED");
});

// Start the Server
app.listen(5000, async () => {
  console.log("Server is running on port 5000.");
  await refreshAccessToken(); // Automatically refresh the token at startup
});
